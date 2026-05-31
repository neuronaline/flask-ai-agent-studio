"""
Canvas result snapshot building.

Provides functions for building various result snapshots returned
by canvas tool operations.
"""

from __future__ import annotations

from services.canvas.normalize import (
    normalize_canvas_document,
    list_canvas_lines,
    _normalize_line_endings,
    extract_canvas_primary_locator,
    CANVAS_CONTENT_MODE_TEXT,
    CANVAS_DOCUMENT_MODE_EDITABLE,
    CANVAS_MAX_RELATIONSHIP_ITEMS_PER_CATEGORY,
)


def build_canvas_document_result_snapshot(document: dict | None) -> dict | None:
    """Build a minimal snapshot of a canvas document for tool results."""
    normalized = normalize_canvas_document(document)
    if not normalized:
        return None

    snapshot = {
        "id": normalized["id"],
        "title": normalized["title"],
        "format": normalized["format"],
        "line_count": normalized["line_count"],
        "content_mode": normalized.get("content_mode") or CANVAS_CONTENT_MODE_TEXT,
        "canvas_mode": normalized.get("canvas_mode") or CANVAS_DOCUMENT_MODE_EDITABLE,
    }
    if int(normalized.get("page_count") or 0) > 0:
        snapshot["page_count"] = int(normalized["page_count"])
    if normalized.get("language"):
        snapshot["language"] = normalized["language"]
    for key in (
        "path",
        "role",
        "summary",
        "project_id",
        "workspace_id",
        "source_file_id",
        "source_mime_type",
        "source_url",
        "source_title",
        "source_kind",
        "import_group_id",
    ):
        if normalized.get(key):
            snapshot[key] = normalized[key]
    for key in ("chunk_index", "chunk_count"):
        if int(normalized.get(key) or 0) > 0:
            snapshot[key] = int(normalized[key])
    for key in ("imports", "exports", "symbols", "dependencies"):
        values = normalized.get(key) if isinstance(normalized.get(key), list) else []
        if values:
            snapshot[key] = values
    visual_page_image_ids = (
        normalized.get("visual_page_image_ids") if isinstance(normalized.get("visual_page_image_ids"), list) else []
    )
    if visual_page_image_ids:
        snapshot["visual_page_image_ids"] = visual_page_image_ids
    if normalized.get("ignored") is True:
        snapshot["ignored"] = True
    if normalized.get("ignored_reason"):
        snapshot["ignored_reason"] = normalized["ignored_reason"]
    return snapshot


def build_canvas_tool_result(
    document: dict,
    *,
    action: str,
    edit_start_line: int | None = None,
    edit_end_line: int | None = None,
    expected_start_line: int | None = None,
    expected_lines: list[str] | None = None,
) -> dict:
    normalized = normalize_canvas_document(document)
    if not normalized:
        raise ValueError("Canvas document is invalid.")
    content = normalized["content"]
    # For localized edits on code documents, show a context window around the
    # affected region rather than the first 2000 chars. This lets the model
    # verify its changes in place without having to scroll through the file.
    if normalized.get("ignored") is True:
        preview = ""
        content_truncated = False
    elif (
        edit_start_line is not None
        and normalized.get("format") == "code"
        and action in ("lines_replaced", "lines_inserted", "lines_deleted", "lines_batch_edited")
    ):
        all_lines = list_canvas_lines(content)
        total = len(all_lines)
        end_ref = edit_end_line if edit_end_line is not None else edit_start_line
        context_start = max(1, edit_start_line - 4)
        context_end = min(total, end_ref + 4)
        preview = "\n".join(f"{i}: {all_lines[i - 1]}" for i in range(context_start, context_end + 1))
        content_truncated = total > (context_end - context_start + 1)
    else:
        preview = content[:2000]
        content_truncated = len(content) > len(preview)
    result = {
        "status": "ok",
        "action": action,
        "document": build_canvas_document_result_snapshot(normalized),
        "document_id": normalized["id"],
        "primary_locator": extract_canvas_primary_locator(normalized),
        "title": normalized["title"],
        "format": normalized["format"],
        "line_count": normalized["line_count"],
        "content": preview,
        "content_truncated": content_truncated,
    }
    if isinstance(expected_start_line, int) and expected_start_line >= 1:
        result["expected_start_line"] = expected_start_line
    if isinstance(expected_lines, list) and expected_lines:
        result["expected_lines"] = [str(line) for line in expected_lines]
    if normalized.get("language"):
        result["language"] = normalized["language"]
    if int(normalized.get("page_count") or 0) > 0:
        result["page_count"] = int(normalized["page_count"])
    for key in (
        "path",
        "role",
        "summary",
        "project_id",
        "workspace_id",
        "source_url",
        "source_title",
        "source_kind",
        "import_group_id",
    ):
        if normalized.get(key):
            result[key] = normalized[key]
    for key in ("chunk_index", "chunk_count"):
        if int(normalized.get(key) or 0) > 0:
            result[key] = int(normalized[key])
    for key in ("imports", "exports", "symbols", "dependencies"):
        values = normalized.get(key) if isinstance(normalized.get(key), list) else []
        if values:
            result[key] = values
    if normalized.get("ignored") is True:
        result["ignored"] = True
    if normalized.get("ignored_reason"):
        result["ignored_reason"] = normalized["ignored_reason"]
    return result