"""
Canvas search and document reading operations.

Provides scroll, search, batch read, and context result building
for canvas documents.
"""

from __future__ import annotations

import re

from services.canvas.normalize import (
    list_canvas_lines,
    join_canvas_lines,
    scale_canvas_char_limit,
    get_canvas_document_capabilities,
    _normalize_canvas_path,
    _number_canvas_lines,
    extract_canvas_primary_locator,
    CANVAS_CONTENT_MODE_TEXT,
    CANVAS_DOCUMENT_MODE_EDITABLE,
    CANVAS_CONTEXT_MAX_LINES,
)

from services.canvas.documents import _find_canvas_document

from services.canvas.runtime import get_canvas_runtime_documents

from services.canvas.manifest import build_canvas_project_manifest

from services.canvas.runtime import get_canvas_runtime_active_document_id


def scroll_canvas_document(
    runtime_state: dict,
    start_line: int,
    end_line: int,
    document_id: str | None = None,
    document_path: str | None = None,
    max_window_lines: int = 200,
    max_chars: int | None = None,
) -> dict:
    _, document = _find_canvas_document(runtime_state, document_id=document_id, document_path=document_path)
    caps = get_canvas_document_capabilities(document)
    if not caps.get("line_addressable"):
        from services.canvas.constants import CanvasCapabilityError
        raise CanvasCapabilityError("scroll_canvas_document", document, "line_addressable")
    existing_lines = list_canvas_lines(document.get("content") or "")
    total_lines = len(existing_lines)
    if start_line < 1 or end_line < start_line:
        raise ValueError("start_line and end_line must define a valid 1-based inclusive range.")
    if total_lines == 0:
        return {
            "status": "ok",
            "action": "scrolled",
            "document_id": document.get("id"),
            "document_path": document.get("path"),
            "title": document.get("title"),
            "start_line": 1,
            "end_line_actual": 0,
            "total_lines": 0,
            "visible_lines": [],
            "has_more_above": False,
            "has_more_below": False,
        }

    window_limit = max(1, int(max_window_lines or 1))
    effective_start = min(start_line, total_lines)
    effective_end = min(total_lines, end_line, effective_start + window_limit - 1)
    if max_chars is None:
        max_chars = scale_canvas_char_limit(max_window_lines, default_lines=200, default_chars=8_000)

    visible_lines = []
    visible_char_count = 0
    for index in range(effective_start, effective_end + 1):
        numbered_line = f"{index}: {existing_lines[index - 1]}"
        extra_chars = len(numbered_line) + (1 if visible_lines else 0)
        if visible_lines and visible_char_count + extra_chars > max_chars:
            effective_end = index - 1
            break
        if not visible_lines and extra_chars > max_chars:
            visible_lines.append(numbered_line[:max_chars])
            effective_end = index
            break
        visible_lines.append(numbered_line)
        visible_char_count += extra_chars

    return {
        "status": "ok",
        "action": "scrolled",
        "document_id": document.get("id"),
        "document_path": document.get("path"),
        "title": document.get("title"),
        "start_line": effective_start,
        "end_line_actual": effective_end,
        "total_lines": total_lines,
        "visible_lines": visible_lines,
        "has_more_above": effective_start > 1,
        "has_more_below": effective_end < total_lines,
    }


def search_canvas_document(
    runtime_state: dict,
    query: str,
    *,
    document_id: str | None = None,
    document_path: str | None = None,
    all_documents: bool = False,
    match_type: str = "text",
    case_sensitive: bool = False,
    context_lines: int = 0,
    offset: int = 0,
    max_results: int = 10,
) -> dict:
    documents = get_canvas_runtime_documents(runtime_state)
    if not documents:
        raise ValueError("No canvas document is available yet.")

    raw_query = str(query or "")
    if not raw_query.strip():
        raise ValueError("Search query is required.")

    result_limit = max(1, min(50, int(max_results or 10)))
    normalized_offset = max(0, int(offset or 0))
    normalized_context_lines = max(0, min(10, int(context_lines or 0)))
    flags = 0 if case_sensitive else re.IGNORECASE
    pattern = None
    is_regex = match_type == "regex"

    if match_type == "regex":
        try:
            pattern = re.compile(raw_query, flags)
        except re.error as exc:
            raise ValueError(f"Invalid regex pattern: {exc}") from exc
    elif match_type == "glob":
        try:
            import fnmatch
            pattern = lambda line: fnmatch.fnmatch(line, raw_query) if not case_sensitive else fnmatch.fnmatch(line.lower(), raw_query.lower())
        except Exception as exc:
            raise ValueError(f"Invalid glob pattern: {exc}") from exc
    elif match_type == "find":
        try:
            pattern = lambda line: line.startswith(raw_query) if case_sensitive else line.lower().startswith(raw_query.lower())
        except Exception as exc:
            raise ValueError(f"Invalid find pattern: {exc}") from exc

    target_documents = documents
    if not all_documents:
        _, target_document = _find_canvas_document(
            runtime_state,
            document_id=document_id,
            document_path=document_path,
        )
        caps = get_canvas_document_capabilities(target_document)
        if not caps.get("line_addressable"):
            from services.canvas.constants import CanvasCapabilityError
            raise CanvasCapabilityError("search_canvas_document", target_document, "line_addressable")
        target_documents = [target_document]
    else:
        target_documents = [
            document for document in target_documents if get_canvas_document_capabilities(document)["line_addressable"]
        ]

    matches: list[dict] = []
    total_match_count = 0
    for document in target_documents:
        document_lines = list_canvas_lines(document.get("content") or "")
        for index, line in enumerate(document_lines, start=1):
            haystack = line if case_sensitive else line.casefold()
            if match_type == "text":
                found = raw_query in haystack
            elif match_type == "regex":
                found = bool(pattern.search(line))
            elif match_type == "glob":
                found = pattern(line)
            elif match_type == "find":
                found = pattern(line)
            else:
                found = raw_query in haystack
            if not found:
                continue
            total_match_count += 1
            if total_match_count <= normalized_offset:
                continue
            if len(matches) >= result_limit:
                continue
            context_before = []
            context_after = []
            if normalized_context_lines > 0:
                before_start = max(1, index - normalized_context_lines)
                after_end = min(len(document_lines), index + normalized_context_lines)
                context_before = [
                    f"{line_number}: {document_lines[line_number - 1]}" for line_number in range(before_start, index)
                ]
                context_after = [
                    f"{line_number}: {document_lines[line_number - 1]}"
                    for line_number in range(index + 1, after_end + 1)
                ]
            matches.append(
                {
                    "document_id": document.get("id"),
                    "document_path": document.get("path"),
                    "title": document.get("title"),
                    "line": index,
                    "excerpt": line[:200],
                    "context_before": context_before,
                    "context_after": context_after,
                }
            )

    return {
        "status": "ok",
        "action": "searched",
        "query": query,
        "match_type": match_type,
        "case_sensitive": case_sensitive,
        "all_documents": all_documents,
        "context_lines": normalized_context_lines,
        "offset": normalized_offset,
        "match_count": total_match_count,
        "returned_count": len(matches),
        "has_more": total_match_count > normalized_offset + len(matches),
        "matches": matches,
    }


def batch_read_canvas_documents(runtime_state: dict, documents: list[dict]) -> dict:
    if not isinstance(documents, list) or not documents:
        raise ValueError("batch_read_canvas_documents requires a non-empty documents array.")

    results: list[dict] = []
    success_count = 0
    for index, request in enumerate(documents, start=1):
        if not isinstance(request, dict):
            results.append({"status": "error", "request_index": index, "error": "Document request must be an object."})
            continue
        try:
            document_id = request.get("document_id")
            document_path = request.get("document_path")
            start_line = request.get("start_line")
            end_line = request.get("end_line")
            max_lines = request.get("max_lines")
            if start_line is not None or end_line is not None:
                if start_line is None or end_line is None:
                    raise ValueError("start_line and end_line must both be provided for ranged reads.")
                result = scroll_canvas_document(
                    runtime_state,
                    int(start_line),
                    int(end_line),
                    document_id=document_id,
                    document_path=document_path,
                    max_window_lines=max_lines or 200,
                )
            else:
                result = build_canvas_document_context_result(
                    runtime_state,
                    document_id=document_id,
                    document_path=document_path,
                    max_lines=max_lines,
                )
            result["request_index"] = index
            results.append(result)
            success_count += 1
        except Exception as exc:
            results.append(
                {
                    "status": "error",
                    "request_index": index,
                    "document_id": request.get("document_id"),
                    "document_path": request.get("document_path"),
                    "error": str(exc),
                }
            )

    return {
        "status": "ok",
        "action": "batch_read",
        "results": results,
        "requested_count": len(documents),
        "success_count": success_count,
    }


def build_canvas_document_context_result(
    runtime_state: dict,
    *,
    document_id: str | None = None,
    document_path: str | None = None,
    max_lines: int | None = None,
    max_chars: int | None = None,
) -> dict:
    _, document = _find_canvas_document(runtime_state, document_id=document_id, document_path=document_path)
    caps = get_canvas_document_capabilities(document)
    if not caps.get("line_addressable"):
        from services.canvas.constants import CanvasCapabilityError
        raise CanvasCapabilityError("expand_canvas_document", document, "line_addressable")
    normalized = document
    if not normalized:
        raise ValueError("Canvas document is invalid.")

    numbered_lines, is_truncated = _number_canvas_lines(
        normalized.get("content") or "",
        max_lines=max_lines or CANVAS_CONTEXT_MAX_LINES,
        max_chars=max_chars,
    )
    if is_truncated:
        total = normalized.get("line_count") or 0
        shown = len(numbered_lines)
        numbered_lines = [
            f"[Excerpt: lines 1\u2013{shown} of {total}. Use scroll_canvas_document to view hidden lines.]",
            *numbered_lines,
        ]
    else:
        shown = len(numbered_lines)
    documents = get_canvas_runtime_documents(runtime_state)
    manifest = build_canvas_project_manifest(
        documents, active_document_id=get_canvas_runtime_active_document_id(runtime_state)
    )
    relationship_map = document.get("relationship_map") if isinstance(document, dict) else None
    return {
        "status": "ok",
        "action": "expanded",
        "document": document,
        "document_id": normalized.get("id"),
        "document_path": normalized.get("path"),
        "title": normalized.get("title"),
        "format": normalized.get("format"),
        "language": normalized.get("language"),
        "role": normalized.get("role"),
        "summary": normalized.get("summary"),
        "line_count": normalized.get("line_count"),
        "visible_lines": numbered_lines,
        "visible_line_end": shown,
        "is_truncated": is_truncated,
        "snapshot_semantics": "call_time",
        "snapshot_notice": (
            "This expansion is a call-time snapshot of the canvas runtime state. "
            "If the canvas may have changed after this tool call, re-run expand_canvas_document to refresh it."
        ),
        "primary_locator": extract_canvas_primary_locator(normalized),
        "manifest_excerpt": {
            "project_name": (manifest or {}).get("project_name"),
            "target_type": (manifest or {}).get("target_type"),
            "active_file": (manifest or {}).get("active_file"),
        },
        "relationship_map": relationship_map,
    }