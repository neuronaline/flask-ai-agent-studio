"""
Core canvas document operations.

Provides functions for creating, rewriting, finding, storing, and
editing individual canvas documents within a runtime state.
"""

from __future__ import annotations

from typing import Iterable

from services.canvas.normalize import (
    normalize_canvas_document,
    list_canvas_lines,
    join_canvas_lines,
    _normalize_canvas_path,
    _normalize_document_path_for_lookup,
    _normalize_canvas_bool,
    _clip_text,
    get_canvas_document_capabilities,
    is_canvas_document_editable,
    _require_canvas_document_text_addressable,
    _validate_canvas_expected_lines,
    extract_canvas_documents,
    CANVAS_MAX_DOCUMENTS,
    CANVAS_MAX_CONTENT_LENGTH,
    CANVAS_MAX_TITLE_LENGTH,
    CanvasValidationError,
    CanvasContextDriftError,
)

from services.canvas.lookup import (
    _find_canvas_document_by_path_locator,
    _describe_canvas_path_matches,
)

from services.canvas.runtime import _refresh_canvas_runtime_state


def _find_canvas_document(
    runtime_state: dict,
    document_id: str | None = None,
    document_path: str | None = None,
) -> tuple[int, dict]:
    documents = runtime_state.get("documents") if isinstance(runtime_state, dict) else None
    if not isinstance(documents, list) or not documents:
        raise ValueError("No canvas document is available yet.")

    normalized_path = _normalize_document_path_for_lookup(document_path)
    if normalized_path:
        match = _find_canvas_document_by_path_locator(documents, normalized_path)
        if match:
            return match
        candidate_text = _describe_canvas_path_matches(documents, normalized_path)
        if candidate_text:
            raise ValueError(f"Canvas document path is ambiguous for {normalized_path}. Matches: {candidate_text}")
        raise ValueError(f"Canvas document not found for path: {normalized_path}")

    target_id = str(document_id or runtime_state.get("active_document_id") or "").strip()
    if target_id:
        for index, document in enumerate(documents):
            if str(document.get("id") or "") == target_id:
                return index, document
        raise ValueError(f"Canvas document not found for id: {target_id}")

    return len(documents) - 1, documents[-1]


def find_canvas_document(
    runtime_state: dict,
    document_id: str | None = None,
    document_path: str | None = None,
) -> tuple[int, dict]:
    """Public wrapper around _find_canvas_document for use outside this module."""
    return _find_canvas_document(runtime_state, document_id=document_id, document_path=document_path)


def _store_canvas_document(runtime_state: dict, document: dict) -> dict:
    normalized = normalize_canvas_document(document)
    if not normalized:
        raise ValueError("Canvas document is invalid.")

    documents = runtime_state.setdefault("documents", [])
    updated = False
    for index, existing in enumerate(documents):
        if existing.get("id") == normalized["id"]:
            documents[index] = normalized
            updated = True
            break
    if not updated:
        if len(documents) >= CANVAS_MAX_DOCUMENTS:
            existing_titles = [str(item.get("title") or "Canvas") for item in documents]
            raise ValueError(
                f"Canvas document limit reached ({CANVAS_MAX_DOCUMENTS}). Delete one first. Existing documents: {existing_titles}"
            )
        documents.append(normalized)
    runtime_state["active_document_id"] = normalized["id"]
    _refresh_canvas_runtime_state(runtime_state)
    return normalized


def _update_canvas_document_in_place(runtime_state: dict, document_id: str, content: str) -> dict:
    documents = runtime_state.setdefault("documents", [])
    for index, existing in enumerate(documents):
        if str(existing.get("id") or "") != document_id:
            continue
        next_document = dict(existing)
        next_document["content"] = _clip_text(content, CANVAS_MAX_CONTENT_LENGTH)
        normalized = normalize_canvas_document(next_document)
        documents[index] = normalized
        runtime_state["active_document_id"] = normalized["id"]
        _refresh_canvas_runtime_state(runtime_state)
        return normalized
    raise ValueError(f"Canvas document not found for id: {document_id}")


def create_canvas_document(
    runtime_state: dict,
    title: str,
    content: str,
    format_name: str = "markdown",
    language_name: str | None = None,
    path: str | None = None,
    role: str | None = None,
    summary: str | None = None,
    imports: list[str] | None = None,
    exports: list[str] | None = None,
    symbols: list[str] | None = None,
    dependencies: list[str] | None = None,
    project_id: str | None = None,
    workspace_id: str | None = None,
    content_mode: str | None = None,
    canvas_mode: str | None = None,
    source_file_id: str | None = None,
    source_mime_type: str | None = None,
    source_url: str | None = None,
    source_title: str | None = None,
    source_kind: str | None = None,
    import_group_id: str | None = None,
    chunk_index: int | None = None,
    chunk_count: int | None = None,
    visual_page_image_ids: list[str] | None = None,
) -> dict:
    documents = runtime_state.get("documents") if isinstance(runtime_state, dict) else None
    if isinstance(documents, list) and len(documents) >= CANVAS_MAX_DOCUMENTS:
        existing_titles = [str(item.get("title") or "Canvas") for item in documents]
        raise ValueError(
            f"Canvas document limit reached ({CANVAS_MAX_DOCUMENTS}). Delete one first. Existing documents: {existing_titles}"
        )
    normalized = normalize_canvas_document(
        {
            "id": None,  # let normalize generate
            "title": title or "Canvas",
            "format": format_name,
            "content": content,
            "language": language_name,
            "path": path,
            "role": role,
            "summary": summary,
            "imports": imports,
            "exports": exports,
            "symbols": symbols,
            "dependencies": dependencies,
            "project_id": project_id,
            "workspace_id": workspace_id,
            "content_mode": content_mode,
            "canvas_mode": canvas_mode,
            "source_file_id": source_file_id,
            "source_mime_type": source_mime_type,
            "source_url": source_url,
            "source_title": source_title,
            "source_kind": source_kind,
            "import_group_id": import_group_id,
            "chunk_index": chunk_index,
            "chunk_count": chunk_count,
            "visual_page_image_ids": visual_page_image_ids,
        }
    )
    return _store_canvas_document(runtime_state, normalized)


def rewrite_canvas_document(
    runtime_state: dict,
    content: str,
    document_id: str | None = None,
    document_path: str | None = None,
    title: str | None = None,
    format_name: str | None = None,
    language_name: str | None = None,
    path: str | None = None,
    role: str | None = None,
    summary: str | None = None,
    imports: list[str] | None = None,
    exports: list[str] | None = None,
    symbols: list[str] | None = None,
    dependencies: list[str] | None = None,
    project_id: str | None = None,
    workspace_id: str | None = None,
) -> dict:
    from services.canvas.normalize import is_canvas_document_editable

    _, document = _find_canvas_document(runtime_state, document_id=document_id, document_path=document_path)
    if not is_canvas_document_editable(document):
        from services.canvas.constants import CanvasCapabilityError
        raise CanvasCapabilityError("rewrite_canvas_document", document, "editable")
    next_document = dict(document)
    next_document["content"] = _clip_text(content, CANVAS_MAX_CONTENT_LENGTH)
    if title is not None:
        next_document["title"] = str(title or "Canvas").strip()[:CANVAS_MAX_TITLE_LENGTH] or "Canvas"
    if format_name is not None:
        next_document["format"] = format_name
    if language_name is not None:
        next_document["language"] = language_name
    if path is not None:
        next_document["path"] = path
    if role is not None:
        next_document["role"] = role
    if summary is not None:
        next_document["summary"] = summary
    if imports is not None:
        next_document["imports"] = imports
    if exports is not None:
        next_document["exports"] = exports
    if symbols is not None:
        next_document["symbols"] = symbols
    if dependencies is not None:
        next_document["dependencies"] = dependencies
    if project_id is not None:
        next_document["project_id"] = project_id
    if workspace_id is not None:
        next_document["workspace_id"] = workspace_id
    return _store_canvas_document(runtime_state, next_document)


def replace_canvas_lines(
    runtime_state: dict,
    start_line: int,
    end_line: int,
    lines: list[str],
    document_id: str | None = None,
    document_path: str | None = None,
    expected_lines: list[str] | None = None,
    expected_start_line: int | None = None,
) -> dict:
    _, document = _find_canvas_document(runtime_state, document_id=document_id, document_path=document_path)
    if not is_canvas_document_editable(document):
        from services.canvas.constants import CanvasCapabilityError
        raise CanvasCapabilityError("replace_canvas_lines", document, "editable")
    existing_lines = list_canvas_lines(document.get("content") or "")
    if start_line < 1 or end_line < start_line:
        raise ValueError("start_line and end_line must define a valid 1-based inclusive range.")
    if start_line > len(existing_lines):
        raise ValueError("Line range exceeds the current canvas document.")
    if end_line > len(existing_lines):
        raise ValueError("Line range exceeds the current canvas document.")

    _validate_canvas_expected_lines(
        existing_lines,
        expected_lines=expected_lines,
        expected_start_line=expected_start_line,
        default_start_line=start_line,
    )

    replacement = [str(line) for line in (lines or [])]
    next_lines = [*existing_lines[: start_line - 1], *replacement, *existing_lines[end_line:]]
    next_document = dict(document)
    next_document["content"] = join_canvas_lines(next_lines)
    return _store_canvas_document(runtime_state, next_document)


def insert_canvas_lines(
    runtime_state: dict,
    after_line: int,
    lines: list[str],
    document_id: str | None = None,
    document_path: str | None = None,
    expected_lines: list[str] | None = None,
    expected_start_line: int | None = None,
) -> dict:
    _, document = _find_canvas_document(runtime_state, document_id=document_id, document_path=document_path)
    if not is_canvas_document_editable(document):
        from services.canvas.constants import CanvasCapabilityError
        raise CanvasCapabilityError("insert_canvas_lines", document, "editable")
    existing_lines = list_canvas_lines(document.get("content") or "")
    if after_line < 0 or after_line > len(existing_lines):
        raise ValueError("after_line must be between 0 and the current line count.")

    expected_count = len(expected_lines or [])
    default_start_line = 1 if after_line <= 0 else max(1, after_line - max(0, expected_count - 1))
    _validate_canvas_expected_lines(
        existing_lines,
        expected_lines=expected_lines,
        expected_start_line=expected_start_line,
        default_start_line=default_start_line,
    )

    additions = [str(line) for line in (lines or [])]
    next_lines = [*existing_lines[:after_line], *additions, *existing_lines[after_line:]]
    next_document = dict(document)
    next_document["content"] = join_canvas_lines(next_lines)
    return _store_canvas_document(runtime_state, next_document)


def delete_canvas_lines(
    runtime_state: dict,
    start_line: int,
    end_line: int,
    document_id: str | None = None,
    document_path: str | None = None,
    expected_lines: list[str] | None = None,
    expected_start_line: int | None = None,
) -> dict:
    return replace_canvas_lines(
        runtime_state,
        start_line,
        end_line,
        [],
        document_id=document_id,
        document_path=document_path,
        expected_lines=expected_lines,
        expected_start_line=expected_start_line,
    )