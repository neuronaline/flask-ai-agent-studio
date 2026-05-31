"""
Page heading detection for canvas documents.

Detects ## Page N markers in document content and computes page section boundaries.
"""

from __future__ import annotations

import re

# Page heading regex: safe pattern with bounded whitespace quantifiers.
# - Leading whitespace: 0-3 spaces max (prevents unbounded matching)
# - ## Page marker: literal match
# - Page number: captured digits only
# - Trailing whitespace: 0-3 spaces max
# Note: \s+ (one or more) is safe here because it's followed by literal chars
# and the overall pattern structure prevents exponential backtracking.
CANVAS_PAGE_HEADING_RE = re.compile(r"^\s{0,3}##\s+Page\s+(\d+)\s*$", re.IGNORECASE)


def list_canvas_lines(content: str) -> list[str]:
    """Split content into lines (normalized to LF)."""
    normalized = _normalize_line_endings(content)
    if normalized == "":
        return []
    return normalized.split("\n")


def _normalize_line_endings(text: str) -> str:
    return str(text or "").replace("\r\n", "\n").replace("\r", "\n")


def _extract_canvas_page_sections(content: str) -> list[dict]:
    lines = list_canvas_lines(content)
    if not lines:
        return []

    sections: list[dict] = []
    for line_number, line in enumerate(lines, start=1):
        match = CANVAS_PAGE_HEADING_RE.match(line)
        if not match:
            continue
        sections.append(
            {
                "page_number": int(match.group(1)),
                "start_line": line_number,
            }
        )

    if not sections:
        return []

    for index, section in enumerate(sections):
        next_start_line = sections[index + 1]["start_line"] if index + 1 < len(sections) else len(lines) + 1
        end_line = next_start_line - 1
        while end_line >= section["start_line"] and not lines[end_line - 1].strip():
            end_line -= 1
        if end_line >= section["start_line"] and lines[end_line - 1].strip() == "---":
            end_line -= 1
        while end_line >= section["start_line"] and not lines[end_line - 1].strip():
            end_line -= 1
        section["end_line"] = max(section["start_line"], end_line)

    return sections


def _get_canvas_page_range(content: str, page_number: int) -> tuple[int, int] | None:
    for section in _extract_canvas_page_sections(content):
        if int(section.get("page_number") or 0) == int(page_number):
            return int(section["start_line"]), int(section["end_line"])
    return None