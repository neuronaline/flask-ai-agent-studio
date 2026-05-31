"""
Canvas document normalization and helper functions.

This module contains the core normalize_canvas_document function along with
all text/path/language/role normalization utilities.
"""

from __future__ import annotations

import re
from typing import Iterable
from uuid import uuid4

from services.canvas.constants import (
    CANVAS_MAX_DOCUMENTS,
    CANVAS_MAX_TITLE_LENGTH,
    CANVAS_MAX_CONTENT_LENGTH,
    CANVAS_MAX_LANGUAGE_LENGTH,
    CANVAS_MAX_PATH_LENGTH,
    CANVAS_MAX_SUMMARY_LENGTH,
    CANVAS_MAX_IGNORE_REASON_LENGTH,
    CANVAS_MAX_SOURCE_URL_LENGTH,
    CANVAS_MAX_SCOPE_ID_LENGTH,
    CANVAS_MAX_RELATION_COUNT,
    CANVAS_MAX_RELATION_ITEM_LENGTH,
    CANVAS_MAX_ID_LENGTH,
    CANVAS_CONTEXT_MAX_CHARS,
    CANVAS_CONTEXT_MAX_LINES,
    CANVAS_MAX_RELATIONSHIP_ITEMS_PER_CATEGORY,
    CANVAS_MAX_RELATIONSHIP_AGGREGATE,
    CANVAS_MAX_DEPENDENCY_SUMMARIES,
    CANVAS_ALLOWED_FORMATS,
    CANVAS_ALLOWED_ROLES,
    CANVAS_MODE_DOCUMENT,
    CANVAS_MODE_PROJECT,
    CANVAS_CONTENT_MODE_TEXT,
    CANVAS_CONTENT_MODE_VISUAL,
    CANVAS_CONTENT_MODE_HYBRID,
    CANVAS_ALLOWED_CONTENT_MODES,
    CANVAS_DOCUMENT_MODE_EDITABLE,
    CANVAS_DOCUMENT_MODE_PREVIEW_ONLY,
    CANVAS_ALLOWED_DOCUMENT_MODES,
    CANVAS_FILE_PRIORITY,
    EXTENSION_LANGUAGE_MAP,
    NAME_LANGUAGE_MAP,
    SHEBANG_LANGUAGE_MAP,
    CanvasCapabilityError,
    CanvasContextDriftError,
    CanvasBatchOverlapError,
    CanvasValidationError,
)

from services.canvas.page import _extract_canvas_page_sections


# ─── Text Utilities ─────────────────────────────────────────────────────────────

def _normalize_line_endings(text: str) -> str:
    return str(text or "").replace("\r\n", "\n").replace("\r", "\n")


def _clip_text(text: str, max_length: int) -> str:
    normalized = _normalize_line_endings(text)
    if len(normalized) <= max_length:
        return normalized
    return normalized[:max_length]


def _line_count(text: str) -> int:
    if not text:
        return 0
    return len(text.split("\n"))


def _normalize_canvas_expected_line(line: str) -> str:
    return _normalize_line_endings(str(line)).rstrip()


# ─── Language Normalization ──────────────────────────────────────────────────────

def _normalize_canvas_language(value) -> str | None:
    language = re.sub(r"[^a-z0-9_+.#-]", "", str(value or "").strip().lower())[:CANVAS_MAX_LANGUAGE_LENGTH]
    return language or None


def _infer_canvas_language_from_content(content: str) -> str | None:
    """Infer language from a shebang line (#!) at the top of the content."""
    first_line = content.split("\n", 1)[0].strip() if content else ""
    if not first_line.startswith("#!"):
        return None
    # e.g. "#!/usr/bin/env python3" or "#!/usr/bin/python3"
    parts = first_line[2:].strip().split()
    if not parts:
        return None
    interpreter = parts[-1].rsplit("/", 1)[-1].lower()
    return SHEBANG_LANGUAGE_MAP.get(interpreter)


def _infer_canvas_language(path_or_name: str | None) -> str | None:
    if not path_or_name:
        return None
    name = str(path_or_name).rsplit("/", 1)[-1].lower().strip()
    if not name:
        return None
    stem_lang = NAME_LANGUAGE_MAP.get(name)
    if stem_lang:
        return stem_lang
    dot_idx = name.rfind(".")
    if dot_idx < 0:
        return None
    return EXTENSION_LANGUAGE_MAP.get(name[dot_idx:])


# ─── String Field Normalizers ──────────────────────────────────────────────────

def _normalize_canvas_short_text(value, max_length: int) -> str | None:
    text = re.sub(r"\s+", " ", _normalize_line_endings(str(value or "")).strip())[:max_length]
    return text or None


def _normalize_canvas_bool(value) -> bool:
    if isinstance(value, bool):
        return value
    if value in (None, ""):
        return False
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "on"}
    return bool(value)


def _normalize_canvas_ignore_reason(value) -> str | None:
    return _normalize_canvas_short_text(value, CANVAS_MAX_IGNORE_REASON_LENGTH)


def _normalize_canvas_identifier(value) -> str | None:
    identifier = re.sub(r"[^a-z0-9_.:-]", "", str(value or "").strip().lower())[:CANVAS_MAX_SCOPE_ID_LENGTH]
    return identifier or None


def _normalize_canvas_path(value) -> str | None:
    raw_path = _normalize_line_endings(str(value or "")).strip().replace("\\", "/")
    if not raw_path:
        return None
    raw_path = re.sub(r"/{2,}", "/", raw_path)
    while raw_path.startswith("./"):
        raw_path = raw_path[2:]
    raw_path = raw_path.lstrip("/")

    normalized_parts = []
    for part in raw_path.split("/"):
        cleaned_part = part.strip()
        if not cleaned_part or cleaned_part == ".":
            continue
        if cleaned_part == "..":
            if normalized_parts:
                normalized_parts.pop()
            continue
        normalized_parts.append(cleaned_part)

    normalized_path = "/".join(normalized_parts)[:CANVAS_MAX_PATH_LENGTH]
    return normalized_path or None


def _normalize_canvas_source_url(value) -> str | None:
    source_url = _normalize_line_endings(str(value or "")).strip()[:CANVAS_MAX_SOURCE_URL_LENGTH]
    return source_url or None


def _normalize_canvas_chunk_position(value) -> int | None:
    try:
        normalized_value = int(value)
    except (TypeError, ValueError):
        return None
    if normalized_value < 1:
        return None
    return min(999, normalized_value)


def _normalize_canvas_role(value) -> str | None:
    role = re.sub(r"[^a-z]", "", str(value or "").strip().lower())
    if role in CANVAS_ALLOWED_ROLES:
        return role
    return None


def _normalize_canvas_content_mode(value) -> str:
    normalized = re.sub(r"[^a-z]", "", str(value or "").strip().lower())
    if normalized in CANVAS_ALLOWED_CONTENT_MODES:
        return normalized
    return CANVAS_CONTENT_MODE_TEXT


def _normalize_canvas_document_mode(value, *, content_mode: str = CANVAS_CONTENT_MODE_TEXT) -> str:
    normalized = re.sub(r"[^a-z_]", "", str(value or "").strip().lower())
    if normalized in CANVAS_ALLOWED_DOCUMENT_MODES:
        return normalized
    if content_mode == CANVAS_CONTENT_MODE_VISUAL:
        return CANVAS_DOCUMENT_MODE_PREVIEW_ONLY
    return CANVAS_DOCUMENT_MODE_EDITABLE


def _normalize_canvas_asset_ids(values, *, limit: int = 8) -> list[str]:
    if not isinstance(values, (list, tuple, set)):
        return []

    normalized: list[str] = []
    seen: set[str] = set()
    for raw_value in values:
        asset_id = re.sub(r"[^a-z0-9]", "", str(raw_value or "").strip().lower())[:80]
        if not asset_id or asset_id in seen:
            continue
        normalized.append(asset_id)
        seen.add(asset_id)
        if len(normalized) >= max(1, int(limit or 1)):
            break
    return normalized


# ─── Document Capability Queries ───────────────────────────────────────────────

def get_canvas_document_content_mode(document: dict | None) -> str:
    source = document if isinstance(document, dict) else {}
    return _normalize_canvas_content_mode(source.get("content_mode"))


def get_canvas_document_canvas_mode(document: dict | None) -> str:
    source = document if isinstance(document, dict) else {}
    return _normalize_canvas_document_mode(
        source.get("canvas_mode"),
        content_mode=get_canvas_document_content_mode(source),
    )


def is_canvas_document_visual(document: dict | None) -> bool:
    return get_canvas_document_content_mode(document) == CANVAS_CONTENT_MODE_VISUAL


def is_canvas_document_editable(document: dict | None) -> bool:
    return get_canvas_document_canvas_mode(document) == CANVAS_DOCUMENT_MODE_EDITABLE


def is_canvas_document_ignored(document: dict | None) -> bool:
    return isinstance(document, dict) and document.get("ignored") is True


def get_canvas_document_capabilities(document: dict | None) -> dict[str, bool]:
    content_mode = get_canvas_document_content_mode(document)
    ignored = is_canvas_document_ignored(document)
    return {
        "editable": is_canvas_document_editable(document),
        "line_addressable": content_mode != CANVAS_CONTENT_MODE_VISUAL and not ignored,
        "page_addressable": int((document or {}).get("page_count") or 0) > 0 and not ignored,
        "region_addressable": content_mode in {CANVAS_CONTENT_MODE_VISUAL, CANVAS_CONTENT_MODE_HYBRID} and not ignored,
        "visual": content_mode == CANVAS_CONTENT_MODE_VISUAL,
        "hybrid": content_mode == CANVAS_CONTENT_MODE_HYBRID,
        "ignored": ignored,
    }


def _raise_canvas_document_capability_error(document: dict, action: str, capability: str) -> None:
    raise CanvasCapabilityError(action, document, capability)


def _require_canvas_document_editable(document: dict, action: str) -> None:
    if not is_canvas_document_editable(document):
        _raise_canvas_document_capability_error(document, action, "editable")


def _require_canvas_document_text_addressable(document: dict, action: str) -> None:
    if not get_canvas_document_capabilities(document)["line_addressable"]:
        _raise_canvas_document_capability_error(document, action, "line_addressable")


# ─── List Normalizers ───────────────────────────────────────────────────────────

def _normalize_canvas_string_list(values) -> list[str]:
    if not isinstance(values, (list, tuple, set)):
        return []

    normalized = []
    seen = set()
    for raw_value in values:
        item = _normalize_canvas_short_text(raw_value, CANVAS_MAX_RELATION_ITEM_LENGTH)
        if not item:
            continue
        dedupe_key = item.lower()
        if dedupe_key in seen:
            continue
        normalized.append(item)
        seen.add(dedupe_key)
        if len(normalized) >= CANVAS_MAX_RELATION_COUNT:
            break
    return normalized


# ─── Role Inference ─────────────────────────────────────────────────────────────

def _infer_canvas_role(path: str | None, title: str, format_name: str) -> str | None:
    candidate = (path or title or "").strip().lower()
    if not candidate:
        return None
    filename = candidate.rsplit("/", 1)[-1]
    if filename.startswith("test_") or "/tests/" in f"/{candidate}" or candidate.endswith("_test.py"):
        return "test"
    if filename in {"readme", "readme.md", "readme.txt"} or candidate.startswith("docs/"):
        return "docs"
    if filename in {
        "requirements.txt",
        "requirements-dev.txt",
        "package.json",
        "pyproject.toml",
        ".env",
        ".env.example",
    }:
        return "dependency" if "requirements" in filename or filename == "package.json" else "config"
    if filename.endswith((".ini", ".cfg", ".toml", ".yaml", ".yml", ".json", ".env")):
        return "config"
    if filename.endswith((".sh", ".bash")):
        return "script"
    if format_name == "code":
        return "source"
    return "note"


# ─── Summary Building ───────────────────────────────────────────────────────────

def _build_canvas_summary(title: str, path: str | None, role: str | None, content: str) -> str:
    label = path or title or "Canvas"
    first_meaningful_line = ""
    for line in _normalize_line_endings(content).split("\n"):
        stripped = re.sub(r"\s+", " ", line.strip())
        if not stripped:
            continue
        first_meaningful_line = stripped.lstrip("#*- ").strip()
        if first_meaningful_line:
            break

    role_label = (role or "document").replace("_", " ")
    if first_meaningful_line:
        return f"{role_label.capitalize()} {label}: {first_meaningful_line}"[:CANVAS_MAX_SUMMARY_LENGTH]
    return f"{role_label.capitalize()} {label}"[:CANVAS_MAX_SUMMARY_LENGTH]


# ─── Line Numbering ─────────────────────────────────────────────────────────────

def scale_canvas_char_limit(max_lines: int | None, *, default_lines: int, default_chars: int) -> int:
    try:
        normalized_max_lines = int(max_lines or 0)
    except (TypeError, ValueError):
        return default_chars
    if normalized_max_lines <= 0 or default_lines <= 0 or default_chars <= 0:
        return default_chars
    return max(1, int(round(default_chars * (normalized_max_lines / default_lines))))


def _number_canvas_lines(
    content: str,
    *,
    max_lines: int = CANVAS_CONTEXT_MAX_LINES,
    max_chars: int | None = None,
) -> tuple[list[str], bool]:
    if max_chars is None:
        max_chars = scale_canvas_char_limit(
            max_lines,
            default_lines=CANVAS_CONTEXT_MAX_LINES,
            default_chars=CANVAS_CONTEXT_MAX_CHARS,
        )
    normalized = _normalize_line_endings(content)
    all_lines = normalized.split("\n") if normalized else []
    visible_lines = []
    visible_char_count = 0

    for index, line in enumerate(all_lines, start=1):
        numbered_line = f"{index}: {line}"
        extra_chars = len(numbered_line) + (1 if visible_lines else 0)
        if visible_lines and (len(visible_lines) >= max_lines or visible_char_count + extra_chars > max_chars):
            return visible_lines, True
        if not visible_lines and extra_chars > max_chars:
            visible_lines.append(numbered_line[:max_chars])
            return visible_lines, True
        visible_lines.append(numbered_line)
        visible_char_count += extra_chars

    return visible_lines, False


# ─── Relationship Map ───────────────────────────────────────────────────────────

def build_canvas_relationship_map(documents: list[dict] | None) -> dict | None:
    normalized_documents = extract_canvas_documents({"canvas_documents": documents or []})
    if not normalized_documents:
        return None

    files = []
    aggregate_imports = []
    aggregate_exports = []
    aggregate_symbols = []
    aggregate_dependencies = []
    seen_buckets = {
        "imports": set(),
        "exports": set(),
        "symbols": set(),
        "dependencies": set(),
    }

    for document in sorted(normalized_documents, key=_document_sort_key):
        entry = {
            "file": document.get("path") or document.get("title") or document.get("id"),
            "role": document.get("role") or "note",
        }
        for key in ("imports", "exports", "symbols", "dependencies"):
            values = document.get(key) if isinstance(document.get(key), list) else []
            if values:
                entry[key] = values[:CANVAS_MAX_RELATIONSHIP_ITEMS_PER_CATEGORY]
            for value in values:
                normalized_value = str(value).strip()
                dedupe_key = normalized_value.lower()
                if not normalized_value or dedupe_key in seen_buckets[key]:
                    continue
                seen_buckets[key].add(dedupe_key)
                if key == "imports":
                    aggregate_imports.append(normalized_value)
                elif key == "exports":
                    aggregate_exports.append(normalized_value)
                elif key == "symbols":
                    aggregate_symbols.append(normalized_value)
                elif key == "dependencies":
                    aggregate_dependencies.append(normalized_value)
        files.append(entry)

    return {
        "files": files,
        "imports": aggregate_imports[:CANVAS_MAX_RELATIONSHIP_AGGREGATE],
        "exports": aggregate_exports[:CANVAS_MAX_RELATIONSHIP_AGGREGATE],
        "symbols": aggregate_symbols[:CANVAS_MAX_RELATIONSHIP_AGGREGATE],
        "dependencies": aggregate_dependencies[:CANVAS_MAX_RELATIONSHIP_AGGREGATE],
    }


# ─── Document Sort Key ─────────────────────────────────────────────────────────

def _document_sort_key(document: dict) -> tuple[int, str, str, str]:
    role = str(document.get("role") or "note")
    priority = CANVAS_FILE_PRIORITY.get(role, 999)
    path = str(document.get("path") or "").strip().lower()
    title = str(document.get("title") or "").strip().lower()
    document_id = str(document.get("id") or "").strip()
    return priority, path, title, document_id


# ─── Active Document Resolution ────────────────────────────────────────────────

def _resolve_active_canvas_document(documents: list[dict], active_document_id: str | None = None) -> dict | None:
    target_id = str(active_document_id or "").strip()
    if target_id:
        for document in documents:
            if str(document.get("id") or "") == target_id:
                return document
    return documents[-1] if documents else None


# ─── Lookup Key Normalization ──────────────────────────────────────────────────

def _normalize_document_path_for_lookup(document_path: str | None) -> str | None:
    normalized_path = _normalize_canvas_path(document_path)
    return normalized_path or None


def _normalize_canvas_lookup_key(value) -> str | None:
    normalized_value = _normalize_document_path_for_lookup(value)
    if not normalized_value:
        return None
    return normalized_value.casefold()


def _normalize_canvas_lookup_basename(value) -> str | None:
    lookup_key = _normalize_canvas_lookup_key(value)
    if not lookup_key:
        return None
    return lookup_key.rsplit("/", 1)[-1]


# ─── Primary Locator ────────────────────────────────────────────────────────────

def extract_canvas_primary_locator(document: dict | None) -> dict | None:
    if not isinstance(document, dict):
        return None
    path = _normalize_document_path_for_lookup(document.get("path"))
    if path:
        return {"type": "path", "value": path}
    document_id = str(document.get("id") or "").strip()
    if document_id:
        return {"type": "id", "value": document_id}
    return None


# ─── Active Document ID ────────────────────────────────────────────────────────

def extract_canvas_active_document_id(metadata: dict | None, documents: list[dict] | None = None) -> str | None:
    source = metadata if isinstance(metadata, dict) else {}
    normalized_documents = documents if isinstance(documents, list) else extract_canvas_documents(source)
    active_document_id = str(source.get("active_document_id") or "").strip()[:CANVAS_MAX_ID_LENGTH]
    if active_document_id and any(
        str(document.get("id") or "") == active_document_id for document in normalized_documents
    ):
        return active_document_id
    active_document = _resolve_active_canvas_document(normalized_documents)
    if not active_document:
        return None
    return str(active_document.get("id") or "").strip() or None


# ─── Canvas Mode ───────────────────────────────────────────────────────────────

def determine_canvas_mode(documents: list[dict] | None) -> str:
    normalized_documents = documents if isinstance(documents, list) else []
    scope_ids = {
        str(document.get("project_id") or document.get("workspace_id") or "").strip()
        for document in normalized_documents
        if str(document.get("project_id") or document.get("workspace_id") or "").strip()
    }
    paths = {
        str(document.get("path") or "").strip()
        for document in normalized_documents
        if str(document.get("path") or "").strip()
    }
    if len(normalized_documents) > 1 or scope_ids or len(paths) > 1:
        return CANVAS_MODE_PROJECT
    return CANVAS_MODE_DOCUMENT


def _infer_canvas_target_type(documents: list[dict], active_document: dict | None) -> str:
    active_path = str((active_document or {}).get("path") or "").lower()
    dependency_paths = {
        str(document.get("path") or "").lower()
        for document in documents
        if str(document.get("role") or "") == "dependency"
    }
    if active_path.endswith(".py") or "pyproject.toml" in dependency_paths or "requirements.txt" in dependency_paths:
        return "python-project"
    if any(str(document.get("role") or "") == "source" for document in documents):
        return "multi-file-project"
    return "document-set"


def _infer_manifest_name(documents: list[dict], active_document: dict | None) -> str:
    active_document = active_document or {}
    for key in ("project_id", "workspace_id"):
        value = str(active_document.get(key) or "").strip()
        if value:
            return value
    for document in documents:
        for key in ("project_id", "workspace_id"):
            value = str(document.get(key) or "").strip()
            if value:
                return value
    active_path = str(active_document.get("path") or "").strip()
    if active_path:
        top_level = active_path.split("/", 1)[0].strip()
        if top_level:
            return top_level
    return str(active_document.get("title") or "Canvas").strip() or "Canvas"


# ─── List / Join Lines ─────────────────────────────────────────────────────────

def list_canvas_lines(content: str) -> list[str]:
    normalized = _normalize_line_endings(content)
    if normalized == "":
        return []
    return normalized.split("\n")


def join_canvas_lines(lines: Iterable[str]) -> str:
    return "\n".join(str(line) for line in lines)


# ─── Expected Lines Validation ────────────────────────────────────────────────

def _validate_canvas_expected_lines(
    existing_lines: list[str],
    *,
    expected_lines: list[str] | None,
    expected_start_line: int | None,
    default_start_line: int,
) -> None:
    if expected_lines is None:
        return

    normalized_expected = [_normalize_canvas_expected_line(line) for line in expected_lines]
    if not normalized_expected:
        return

    compare_start = expected_start_line if expected_start_line is not None else default_start_line
    if compare_start < 1:
        raise CanvasValidationError("expected_start_line must be at least 1 when expected_lines are provided.")

    compare_end = compare_start + len(normalized_expected) - 1
    if compare_end > len(existing_lines):
        raise CanvasContextDriftError(
            "Canvas context drift detected: the expected lines no longer fit at the current location. Reinspect the document before editing.",
            expected_start_line=compare_start,
            expected_end_line=compare_end,
        )

    current_slice = [_normalize_canvas_expected_line(line) for line in existing_lines[compare_start - 1 : compare_end]]
    if current_slice != normalized_expected:
        raise CanvasContextDriftError(
            f"Canvas context drift detected around lines {compare_start}-{compare_end}. Reinspect the document before editing.",
            expected_start_line=compare_start,
            expected_end_line=compare_end,
        )


# ─── Core Document Normalization ──────────────────────────────────────────────

def normalize_canvas_document(value, *, fallback_title: str = "Canvas") -> dict | None:
    if not isinstance(value, dict):
        return None

    document_id = str(value.get("id") or "").strip()[:CANVAS_MAX_ID_LENGTH] or uuid4().hex
    title = str(value.get("title") or fallback_title).strip()[:CANVAS_MAX_TITLE_LENGTH] or fallback_title
    content = _clip_text(value.get("content") or "", CANVAS_MAX_CONTENT_LENGTH)

    # Resolve path and language early so we can auto-infer format.
    path = _normalize_canvas_path(value.get("path"))
    language = (
        _normalize_canvas_language(value.get("language"))
        or _infer_canvas_language(path)
        or _infer_canvas_language(str(value.get("title") or "").strip())
        or _infer_canvas_language_from_content(str(value.get("content") or "").lstrip())
    )

    # Promote format to "code" when path/title extension indicates source code and
    # no explicit format was given by the caller.
    explicit_format = str(value.get("format") or "").strip().lower()
    if explicit_format in CANVAS_ALLOWED_FORMATS:
        format_name = explicit_format
    elif language and language != "markdown":
        format_name = "code"
    else:
        format_name = "markdown"
    created_at = str(value.get("created_at") or "").strip()[:CANVAS_MAX_ID_LENGTH]
    updated_at = str(value.get("updated_at") or "").strip()[:CANVAS_MAX_ID_LENGTH]
    role = _normalize_canvas_role(value.get("role")) or _infer_canvas_role(path, title, format_name)
    summary = _normalize_canvas_short_text(value.get("summary"), CANVAS_MAX_SUMMARY_LENGTH)
    ignored_explicit = "ignored" in value
    ignored = _normalize_canvas_bool(value.get("ignored")) if ignored_explicit else False
    ignored_reason = _normalize_canvas_ignore_reason(value.get("ignored_reason"))
    if ignored_reason and not ignored and not ignored_explicit:
        ignored = True
    always_expanded = _normalize_canvas_bool(value.get("always_expanded")) or False
    imports = _normalize_canvas_string_list(value.get("imports"))
    exports = _normalize_canvas_string_list(value.get("exports"))
    symbols = _normalize_canvas_string_list(value.get("symbols"))
    dependencies = _normalize_canvas_string_list(value.get("dependencies"))
    project_id = _normalize_canvas_identifier(value.get("project_id"))
    workspace_id = _normalize_canvas_identifier(value.get("workspace_id"))
    content_mode = _normalize_canvas_content_mode(value.get("content_mode"))
    canvas_mode = _normalize_canvas_document_mode(value.get("canvas_mode"), content_mode=content_mode)
    source_file_id = _normalize_canvas_identifier(value.get("source_file_id"))
    source_mime_type = str(value.get("source_mime_type") or "").strip().lower()[:120]
    source_url = _normalize_canvas_source_url(value.get("source_url"))
    source_title = _normalize_canvas_short_text(value.get("source_title"), CANVAS_MAX_TITLE_LENGTH)
    source_kind = _normalize_canvas_identifier(value.get("source_kind"))
    import_group_id = _normalize_canvas_identifier(value.get("import_group_id"))
    chunk_index = _normalize_canvas_chunk_position(value.get("chunk_index"))
    chunk_count = _normalize_canvas_chunk_position(value.get("chunk_count"))
    visual_page_image_ids = _normalize_canvas_asset_ids(value.get("visual_page_image_ids"), limit=8)

    cleaned = {
        "id": document_id,
        "title": title,
        "format": format_name,
        "content": content,
        "line_count": _line_count(content),
        "content_mode": content_mode,
        "canvas_mode": canvas_mode,
    }
    raw_page_count = value.get("page_count")
    if format_name != "code":
        detected_page_count = len(_extract_canvas_page_sections(content))
        if detected_page_count > 0:
            page_count = detected_page_count
        else:
            try:
                page_count = max(0, int(raw_page_count or 0))
            except (TypeError, ValueError):
                page_count = 0
        if visual_page_image_ids:
            page_count = max(page_count, len(visual_page_image_ids))
        if page_count > 0:
            cleaned["page_count"] = page_count

    if path:
        cleaned["path"] = path
    if role:
        cleaned["role"] = role
    cleaned["summary"] = summary or _build_canvas_summary(title, path, role, content)

    if language:
        cleaned["language"] = language
    if imports:
        cleaned["imports"] = imports
    if exports:
        cleaned["exports"] = exports
    if symbols:
        cleaned["symbols"] = symbols
    if dependencies:
        cleaned["dependencies"] = dependencies
    if project_id:
        cleaned["project_id"] = project_id
    if workspace_id:
        cleaned["workspace_id"] = workspace_id
    if source_file_id:
        cleaned["source_file_id"] = source_file_id
    if source_mime_type:
        cleaned["source_mime_type"] = source_mime_type
    if source_url:
        cleaned["source_url"] = source_url
    if source_title:
        cleaned["source_title"] = source_title
    if source_kind:
        cleaned["source_kind"] = source_kind
    if import_group_id:
        cleaned["import_group_id"] = import_group_id
    if chunk_index:
        cleaned["chunk_index"] = chunk_index
    if chunk_count:
        cleaned["chunk_count"] = max(chunk_index or 1, chunk_count)
    if visual_page_image_ids:
        cleaned["visual_page_image_ids"] = visual_page_image_ids

    if created_at:
        cleaned["created_at"] = created_at
    if updated_at:
        cleaned["updated_at"] = updated_at

    source_message_id = value.get("source_message_id")
    if isinstance(source_message_id, int) and source_message_id > 0:
        cleaned["source_message_id"] = source_message_id
    if ignored:
        cleaned["ignored"] = True
        if ignored_reason:
            cleaned["ignored_reason"] = ignored_reason
    if always_expanded:
        cleaned["always_expanded"] = True
    elif "always_expanded" in value:
        # Explicit false from PATCH should be preserved so the field can be toggled off
        cleaned["always_expanded"] = False

    return cleaned


def extract_canvas_documents(metadata: dict | None) -> list[dict]:
    source = metadata if isinstance(metadata, dict) else {}
    raw_documents = source.get("canvas_documents")
    if not isinstance(raw_documents, list):
        return []

    normalized = []
    seen_ids = set()
    seen_paths = set()
    for entry in raw_documents[:CANVAS_MAX_DOCUMENTS]:
        cleaned = normalize_canvas_document(entry)
        if not cleaned:
            continue
        if cleaned["id"] in seen_ids:
            continue
        normalized_path = str(cleaned.get("path") or "").strip().lower()
        if normalized_path and normalized_path in seen_paths:
            continue
        normalized.append(cleaned)
        seen_ids.add(cleaned["id"])
        if normalized_path:
            seen_paths.add(normalized_path)
    return normalized