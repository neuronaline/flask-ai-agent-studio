"""
Canvas line transformation operations.

Provides regex and literal find-and-replace operations on document lines.
"""

from __future__ import annotations

import re

from services.canvas.normalize import (
    list_canvas_lines,
    join_canvas_lines,
    get_canvas_document_capabilities,
    is_canvas_document_editable,
    _clip_text,
    CANVAS_MAX_CONTENT_LENGTH,
)

from services.canvas.documents import _find_canvas_document, _update_canvas_document_in_place


def _parse_canvas_transform_scope(scope: str | None, total_lines: int) -> tuple[int, int]:
    normalized_scope = str(scope or "all").strip().lower()
    if not normalized_scope or normalized_scope == "all":
        return 1, total_lines

    match = re.fullmatch(r"lines_(\d+)_(\d+)", normalized_scope)
    if not match:
        raise ValueError("transform_canvas_lines scope must be 'all' or 'lines_<start>_<end>'.")

    start_line = int(match.group(1))
    end_line = int(match.group(2))
    if start_line < 1 or end_line < start_line:
        raise ValueError("transform_canvas_lines scope must define a valid 1-based inclusive range.")
    if total_lines == 0:
        return 1, 0
    if end_line > total_lines:
        raise ValueError("transform_canvas_lines scope exceeds the current canvas document.")
    return start_line, end_line


def _compile_canvas_transform_pattern(pattern: str, *, is_regex: bool, case_sensitive: bool):
    if pattern == "":
        raise ValueError("transform_canvas_lines pattern must not be empty.")
    if len(pattern) > 500:
        raise ValueError("transform_canvas_lines pattern is too long.")
    flags = 0 if case_sensitive else re.IGNORECASE
    try:
        return re.compile(pattern if is_regex else re.escape(pattern), flags)
    except re.error as exc:
        raise ValueError(f"Invalid transform_canvas_lines pattern: {exc}") from exc


def _format_canvas_regex_replacement(replacement: str) -> str:
    return re.sub(r"\$(\d+)", r"\\g<\1>", str(replacement))


def _iter_canvas_transform_affected_lines(text: str, compiled_pattern) -> list[int]:
    line_offsets = [0]
    for index, char in enumerate(text):
        if char == "\n":
            line_offsets.append(index + 1)

    affected_lines: list[int] = []
    for match in compiled_pattern.finditer(text):
        start_offset = match.start()
        line_number = 1
        for candidate_index, offset in enumerate(line_offsets, start=1):
            if offset > start_offset:
                break
            line_number = candidate_index
        if line_number not in affected_lines:
            affected_lines.append(line_number)
    return affected_lines


def transform_canvas_lines(
    runtime_state: dict,
    pattern: str,
    replacement: str,
    *,
    document_id: str | None = None,
    document_path: str | None = None,
    scope: str = "all",
    is_regex: bool = False,
    case_sensitive: bool = True,
    count_only: bool = False,
) -> dict:
    _, document = _find_canvas_document(runtime_state, document_id=document_id, document_path=document_path)
    if count_only:
        # Use capability check that doesn't require editable
        caps = get_canvas_document_capabilities(document)
        if not caps.get("line_addressable"):
            from services.canvas.constants import CanvasCapabilityError
            raise CanvasCapabilityError("transform_canvas_lines", document, "line_addressable")
    else:
        if not is_canvas_document_editable(document):
            from services.canvas.constants import CanvasCapabilityError
            raise CanvasCapabilityError("transform_canvas_lines", document, "editable")
    document_id = str(document.get("id") or "")
    all_lines = list_canvas_lines(document.get("content") or "")
    scope_start, scope_end = _parse_canvas_transform_scope(scope, len(all_lines))
    scoped_lines = [] if scope_end <= 0 else all_lines[scope_start - 1 : scope_end]
    scoped_text = join_canvas_lines(scoped_lines)

    compiled_pattern = _compile_canvas_transform_pattern(str(pattern), is_regex=is_regex, case_sensitive=case_sensitive)
    matches = list(compiled_pattern.finditer(scoped_text))
    affected_line_numbers = [
        scope_start + line_number - 1
        for line_number in _iter_canvas_transform_affected_lines(scoped_text, compiled_pattern)
    ]
    result = {
        "status": "ok",
        "action": "transformed",
        "document_id": document.get("id"),
        "document_path": document.get("path"),
        "title": document.get("title"),
        "matches_found": len(matches),
        "matches_replaced": 0 if count_only else len(matches),
        "affected_lines": affected_line_numbers,
        "scope": scope,
    }
    if count_only or not matches:
        result["document"] = document
        return result

    replacement_text = _format_canvas_regex_replacement(replacement) if is_regex else str(replacement)
    transformed_text = compiled_pattern.sub(replacement_text, scoped_text)
    next_lines = list(all_lines)
    replacement_lines = list_canvas_lines(transformed_text)
    next_lines[scope_start - 1 : scope_end] = replacement_lines
    updated_document = _update_canvas_document_in_place(runtime_state, document_id, join_canvas_lines(next_lines))
    result["document"] = updated_document
    return result