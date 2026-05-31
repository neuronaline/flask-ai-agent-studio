"""
Canvas document validation.

Provides content validation for Python, JSON, and Markdown document formats.
"""

from __future__ import annotations

import json
import re

from services.canvas.normalize import list_canvas_lines

from services.canvas.page import CANVAS_PAGE_HEADING_RE


def _detect_canvas_validator(document: dict, validator: str | None) -> str:
    normalized_validator = str(validator or "auto").strip().lower() or "auto"
    if normalized_validator != "auto":
        return normalized_validator
    language = str(document.get("language") or "").strip().lower()
    path = str(document.get("path") or "").strip().lower()
    format_name = str(document.get("format") or "").strip().lower()
    if language == "python" or path.endswith((".py", ".pyw")):
        return "python"
    if language == "json" or path.endswith((".json", ".jsonc")):
        return "json"
    if format_name == "markdown" or path.endswith((".md", ".mdx")):
        return "markdown"
    return "none"


def _build_canvas_validation_issue(
    severity: str,
    message: str,
    *,
    line: int | None = None,
    col: int | None = None,
    suggestion: str | None = None,
) -> dict:
    issue = {
        "severity": severity,
        "line": line,
        "col": col,
        "message": message,
    }
    if suggestion:
        issue["suggestion"] = suggestion
    return issue


def _validate_canvas_python_content(content: str) -> list[dict]:
    try:
        import ast
        ast.parse(content)
    except SyntaxError as exc:
        return [
            _build_canvas_validation_issue(
                "error",
                exc.msg or "Invalid Python syntax.",
                line=getattr(exc, "lineno", None),
                col=getattr(exc, "offset", None),
            )
        ]
    return []


def _validate_canvas_json_content(content: str) -> list[dict]:
    try:
        json.loads(content)
    except json.JSONDecodeError as exc:
        return [
            _build_canvas_validation_issue(
                "error",
                f"Invalid JSON syntax at line {exc.lineno}, column {exc.colno}: {exc.msg}",
                line=exc.lineno,
                suggestion=None,
            )
        ]
    return []


def _validate_canvas_markdown_content(content: str) -> list[dict]:
    issues: list[dict] = []
    lines = list_canvas_lines(content)
    code_fence_open_line = None
    previous_heading_level = 0
    expected_page_number = None
    heading_re = re.compile(r"^\s{0,3}(#{1,6})\s+\S")

    for line_number, line in enumerate(lines, start=1):
        if re.match(r"^\s*```", line):
            code_fence_open_line = None if code_fence_open_line is not None else line_number

        heading_match = heading_re.match(line)
        if heading_match:
            heading_level = len(heading_match.group(1))
            if previous_heading_level and heading_level > previous_heading_level + 1:
                issues.append(
                    _build_canvas_validation_issue(
                        "warning",
                        f"Heading level jumps from H{previous_heading_level} to H{heading_level}.",
                        line=line_number,
                    )
                )
            previous_heading_level = heading_level

        page_match = CANVAS_PAGE_HEADING_RE.match(line)
        if page_match:
            page_number = int(page_match.group(1))
            if expected_page_number is None:
                expected_page_number = page_number
            if page_number != expected_page_number:
                issues.append(
                    _build_canvas_validation_issue(
                        "warning",
                        f"Page numbering is out of sequence. Expected Page {expected_page_number}, found Page {page_number}.",
                        line=line_number,
                    )
                )
                expected_page_number = page_number
            expected_page_number += 1

    if code_fence_open_line is not None:
        issues.append(
            _build_canvas_validation_issue(
                "error",
                "Unclosed fenced code block.",
                line=code_fence_open_line,
            )
        )

    return issues


def validate_canvas_document(document: dict, *, validator: str | None = None) -> dict:
    """
    Validate canvas document content and return a validation report.

    Args:
        document: Canvas document dict with content, language, path, format fields
        validator: Force a specific validator ("python", "json", "markdown", "auto")

    Returns:
        dict with status, validation_type, issues list, and error_count/warning_count
    """
    content = str(document.get("content") or "")
    if not content:
        return {
            "status": "ok",
            "validation_type": "none",
            "issues": [],
            "error_count": 0,
            "warning_count": 0,
        }

    validation_type = _detect_canvas_validator(document, validator)

    if validation_type == "python":
        issues = _validate_canvas_python_content(content)
    elif validation_type == "json":
        issues = _validate_canvas_json_content(content)
    elif validation_type == "markdown":
        issues = _validate_canvas_markdown_content(content)
    else:
        issues = []

    error_count = sum(1 for issue in issues if issue.get("severity") == "error")
    warning_count = sum(1 for issue in issues if issue.get("severity") == "warning")

    return {
        "status": "ok" if error_count == 0 else "errors_found",
        "validation_type": validation_type,
        "issues": issues,
        "error_count": error_count,
        "warning_count": warning_count,
    }