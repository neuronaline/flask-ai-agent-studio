"""
Canvas viewport management.

Handles viewport state (pinned line ranges) for canvas documents,
including setting, clearing, TTL management, and payload generation.
"""

from __future__ import annotations

from services.canvas.normalize import (
    list_canvas_lines,
    _normalize_canvas_path,
    CANVAS_CONTEXT_MAX_CHARS,
)


def _normalize_canvas_viewports(runtime_state: dict) -> dict[str, dict]:
    viewports = runtime_state.get("viewports") if isinstance(runtime_state, dict) else None
    if not isinstance(viewports, dict):
        viewports = {}
        runtime_state["viewports"] = viewports
    return viewports


def extract_canvas_viewports(metadata: dict | None, documents: list[dict] | None = None) -> dict[str, dict]:
    from services.canvas.normalize import extract_canvas_documents
    source = metadata if isinstance(metadata, dict) else {}
    raw_viewports = source.get("canvas_viewports")
    if not isinstance(raw_viewports, dict):
        return {}

    normalized_documents = documents if isinstance(documents, list) else extract_canvas_documents(source)
    valid_document_ids = {str(document.get("id") or "") for document in normalized_documents}
    normalized_viewports: dict[str, dict] = {}
    for key, viewport in raw_viewports.items():
        if not isinstance(viewport, dict):
            continue
        document_id = str(viewport.get("document_id") or "").strip()
        if not document_id or document_id not in valid_document_ids:
            continue
        start_line = int(viewport.get("start_line") or 0)
        end_line = int(viewport.get("end_line") or 0)
        if start_line < 1 or end_line < start_line:
            continue
        normalized_key = str(key or viewport.get("document_path") or document_id).strip()
        if not normalized_key:
            continue
        normalized_viewports[normalized_key] = {
            "document_id": document_id,
            "document_path": _normalize_canvas_path(viewport.get("document_path")),
            "start_line": start_line,
            "end_line": end_line,
            "ttl_turns": max(0, int(viewport.get("ttl_turns") or 0)),
            "remaining_turns": max(0, int(viewport.get("remaining_turns") or 0)),
            "auto_unpin_on_edit": viewport.get("auto_unpin_on_edit") is True,
        }
        try:
            page_number = int(viewport.get("page_number") or 0)
        except (TypeError, ValueError):
            page_number = 0
        if page_number > 0:
            normalized_viewports[normalized_key]["page_number"] = page_number
    return normalized_viewports


def set_canvas_viewport(
    runtime_state: dict,
    *,
    start_line: int,
    end_line: int,
    ttl_turns: int = 3,
    permanent: bool = False,
    auto_unpin_on_edit: bool = True,
    document_id: str | None = None,
    document_path: str | None = None,
    page_number: int | None = None,
) -> dict:
    from services.canvas.lookup import _find_canvas_document_by_path_locator
    from services.canvas.runtime import get_canvas_runtime_documents
    from services.canvas.normalize import _require_canvas_document_text_addressable

    documents = get_canvas_runtime_documents(runtime_state)
    # Find document
    match = _find_canvas_document_by_path_locator(documents, document_path)
    if match:
        _, document = match
    elif document_id:
        document = next((d for d in documents if str(d.get("id") or "") == str(document_id)), None)
        if not document:
            raise ValueError("Canvas document not found for id.")
    else:
        raise ValueError("Canvas document not found.")
    _require_canvas_document_text_addressable(document, "set_canvas_viewport")
    total_lines = int(document.get("line_count") or 0)
    if start_line < 1 or end_line < start_line:
        raise ValueError("set_canvas_viewport requires a valid 1-based inclusive range.")
    if total_lines and end_line > total_lines:
        raise ValueError("set_canvas_viewport range exceeds the current canvas document.")
    viewport_key = str(document.get("path") or document.get("id") or "").strip()
    if not viewport_key:
        raise ValueError("Canvas viewport target is missing a stable document key.")
    normalized_ttl_turns = 0 if permanent else max(0, int(ttl_turns or 0))
    is_permanent_viewport = permanent is True or normalized_ttl_turns == 0
    normalized_auto_unpin_on_edit = False if is_permanent_viewport else auto_unpin_on_edit is True
    _normalize_canvas_viewports(runtime_state)[viewport_key] = {
        "document_id": document.get("id"),
        "document_path": document.get("path"),
        "start_line": int(start_line),
        "end_line": int(end_line),
        "ttl_turns": normalized_ttl_turns,
        "remaining_turns": normalized_ttl_turns,
        "auto_unpin_on_edit": normalized_auto_unpin_on_edit,
        "permanent": is_permanent_viewport,
    }
    if isinstance(page_number, int) and page_number > 0:
        _normalize_canvas_viewports(runtime_state)[viewport_key]["page_number"] = page_number
    return {
        "status": "ok",
        "action": "viewport_set",
        "pinned": dict(_normalize_canvas_viewports(runtime_state)[viewport_key]),
    }


def clear_canvas_viewport(
    runtime_state: dict, *, document_path: str | None = None, document_id: str | None = None
) -> dict:
    viewports = _normalize_canvas_viewports(runtime_state)
    if document_path is None and document_id is None:
        cleared_count = len(viewports)
        viewports.clear()
        return {"status": "ok", "action": "viewport_cleared", "cleared_count": cleared_count}

    cleared_count = 0
    target_document_id = str(document_id or "").strip()
    target_document_path = _normalize_canvas_path(document_path)
    for key in list(viewports.keys()):
        viewport = viewports.get(key) or {}
        if target_document_id and str(viewport.get("document_id") or "") == target_document_id:
            viewports.pop(key, None)
            cleared_count += 1
            continue
        if target_document_path and _normalize_canvas_path(viewport.get("document_path")) == target_document_path:
            viewports.pop(key, None)
            cleared_count += 1
    return {"status": "ok", "action": "viewport_cleared", "cleared_count": cleared_count}


def decrement_canvas_viewport_ttls(runtime_state: dict) -> None:
    viewports = _normalize_canvas_viewports(runtime_state)
    for key in list(viewports.keys()):
        remaining_turns = int(viewports[key].get("remaining_turns") or 0)
        ttl_turns = int(viewports[key].get("ttl_turns") or 0)
        if ttl_turns <= 0:
            continue
        remaining_turns -= 1
        if remaining_turns <= 0:
            viewports.pop(key, None)
            continue
        viewports[key]["remaining_turns"] = remaining_turns


def get_canvas_viewport_payloads(runtime_state: dict) -> list[dict]:
    from services.canvas.runtime import get_canvas_runtime_documents

    documents = get_canvas_runtime_documents(runtime_state)
    document_by_id = {str(document.get("id") or ""): document for document in documents}
    payloads: list[dict] = []
    total_chars = 0
    truncated_count = 0
    char_budget = max(1, int(CANVAS_CONTEXT_MAX_CHARS * 0.4))
    for viewport in _normalize_canvas_viewports(runtime_state).values():
        document = document_by_id.get(str(viewport.get("document_id") or ""))
        if not document:
            continue
        start_line = int(viewport.get("start_line") or 0)
        end_line = int(viewport.get("end_line") or 0)
        all_lines = list_canvas_lines(document.get("content") or "")
        if start_line < 1 or end_line < start_line or end_line > len(all_lines):
            continue
        visible_lines = [
            f"{line_number}: {all_lines[line_number - 1]}" for line_number in range(start_line, end_line + 1)
        ]
        payload_chars = len("\n".join(visible_lines))
        if payloads and total_chars + payload_chars > char_budget:
            truncated_count += 1
            continue
        payloads.append(
            {
                "document_id": document.get("id"),
                "document_path": document.get("path"),
                "title": document.get("title"),
                "start_line": start_line,
                "end_line": end_line,
                "page_number": int(viewport.get("page_number") or 0),
                "remaining_turns": int(viewport.get("remaining_turns") or 0),
                "auto_unpin_on_edit": viewport.get("auto_unpin_on_edit") is True,
                "permanent": viewport.get("permanent") is True or int(viewport.get("ttl_turns") or 0) == 0,
                "visible_lines": visible_lines,
            }
        )
        total_chars += payload_chars
    if truncated_count and payloads:
        payloads[-1]["viewport_budget_truncated"] = True
        payloads[-1]["truncated_viewport_count"] = truncated_count
    return payloads


def clear_overlapping_canvas_viewports(
    runtime_state: dict,
    *,
    document_id: str | None = None,
    document_path: str | None = None,
    edit_start_line: int,
    edit_end_line: int,
) -> int:
    viewports = _normalize_canvas_viewports(runtime_state)
    cleared_count = 0
    normalized_path = _normalize_canvas_path(document_path)
    for key in list(viewports.keys()):
        viewport = viewports.get(key) or {}
        if viewport.get("auto_unpin_on_edit") is not True:
            continue
        same_document = False
        if document_id and str(viewport.get("document_id") or "") == str(document_id):
            same_document = True
        if normalized_path and _normalize_canvas_path(viewport.get("document_path")) == normalized_path:
            same_document = True
        if not same_document:
            continue
        viewport_start = int(viewport.get("start_line") or 0)
        viewport_end = int(viewport.get("end_line") or 0)
        if max(viewport_start, edit_start_line) <= min(viewport_end, edit_end_line):
            viewports.pop(key, None)
            cleared_count += 1
    return cleared_count