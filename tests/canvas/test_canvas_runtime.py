from __future__ import annotations

import pytest

from services.canvas_service import (
    batch_read_canvas_documents,
    create_canvas_runtime_state,
    focus_canvas_page,
    get_canvas_viewport_payloads,
    normalize_canvas_document,
    scroll_canvas_document,
    search_canvas_document,
    set_canvas_viewport,
    validate_canvas_document,
)
from core.db import (
    get_app_settings,
    get_canvas_expand_max_lines,
    get_canvas_prompt_code_line_max_chars,
    get_canvas_prompt_max_chars,
    get_canvas_prompt_max_lines,
    get_canvas_prompt_max_tokens,
    get_canvas_prompt_text_line_max_chars,
    get_canvas_scroll_window_lines,
)
from core.messages import _build_canvas_prompt_payload, build_runtime_system_message


class TestCanvasRuntime:
    def test_canvas_limit_getters_clamp_values(self):
        settings = {}
        settings["canvas_prompt_max_lines"] = "50000"
        settings["canvas_prompt_max_tokens"] = "60000"
        settings["canvas_prompt_max_chars"] = "999999"
        settings["canvas_prompt_code_line_max_chars"] = "0"
        settings["canvas_prompt_text_line_max_chars"] = "5000"
        settings["canvas_expand_max_lines"] = "-1"
        settings["canvas_scroll_window_lines"] = "nope"

        assert get_canvas_prompt_max_lines(settings) == 3000
        assert get_canvas_prompt_max_tokens(settings) == 50000
        assert get_canvas_prompt_max_chars(settings) == 200000
        assert get_canvas_prompt_code_line_max_chars(settings) == 40
        assert get_canvas_prompt_text_line_max_chars(settings) == 1000
        assert get_canvas_expand_max_lines(settings) == 100
        assert get_canvas_scroll_window_lines(settings) == 200

    def test_build_canvas_prompt_payload_respects_max_lines(self):
        content = "\n".join(f"line {index}" for index in range(1, 51))
        document = normalize_canvas_document(
            {
                "id": "doc-1",
                "title": "Large file",
                "format": "code",
                "language": "python",
                "content": content,
            }
        )

        payload = _build_canvas_prompt_payload([document], max_lines=10)

        assert payload is not None
        assert len(payload["visible_lines"]) == 10
        assert payload["visible_line_end"] == 10
        assert payload["is_truncated"]

        small_document = normalize_canvas_document(
            {
                "id": "doc-2",
                "title": "Small file",
                "format": "code",
                "language": "python",
                "content": "line 1\nline 2\nline 3",
            }
        )

        full_payload = _build_canvas_prompt_payload([small_document], max_lines=10)

        assert full_payload is not None
        assert len(full_payload["visible_lines"]) == 3
        assert full_payload["visible_line_end"] == 3
        assert not full_payload["is_truncated"]

    def test_build_canvas_prompt_payload_hides_ignored_active_document_content(self):
        payload = _build_canvas_prompt_payload(
            [
                {
                    "id": "canvas-1",
                    "title": "legacy.py",
                    "path": "src/legacy.py",
                    "format": "code",
                    "language": "python",
                    "role": "source",
                    "content": "SECRET_VALUE = 'hidden'\nprint(SECRET_VALUE)",
                    "ignored": True,
                    "ignored_reason": "Superseded by src/app.py",
                    "symbols": ["legacy_main"],
                },
                {
                    "id": "canvas-2",
                    "title": "app.py",
                    "path": "src/app.py",
                    "format": "code",
                    "language": "python",
                    "role": "source",
                    "content": "print('active')",
                },
            ],
            active_document_id="canvas-1",
            canvas_viewports=[
                {"document_id": "canvas-1", "document_path": "src/legacy.py", "start_line": 1, "end_line": 1},
                {"document_id": "canvas-2", "document_path": "src/app.py", "start_line": 1, "end_line": 1},
            ],
            max_lines=10,
        )

        assert payload is not None
        assert payload["active_document_ignored"]
        assert payload["visible_lines"] == []
        assert payload["visible_line_end"] == 0
        assert [entry["id"] for entry in payload["ignored_documents"]] == ["canvas-1"]
        assert payload["ignored_documents"][0]["ignored_reason"] == "Superseded by src/app.py"
        assert [entry["id"] for entry in payload["other_documents"]] == ["canvas-2"]
        assert [viewport["document_id"] for viewport in payload["viewports"]] == ["canvas-2"]

    def test_build_canvas_prompt_payload_keeps_full_long_markdown_lines_when_document_fits_budget(self):
        long_line = "A" * 220
        document = normalize_canvas_document(
            {
                "id": "doc-1",
                "title": "report.md",
                "format": "markdown",
                "language": "markdown",
                "content": f"{long_line}\nshort line",
            }
        )

        payload = _build_canvas_prompt_payload([document], max_lines=10)

        assert payload is not None
        assert payload["clipped_line_count"] == 0
        assert payload["visible_lines"][0] == f"1: {long_line}"
        assert payload["visible_lines"][1] == "2: short line"

    def test_build_canvas_prompt_payload_clips_long_markdown_lines_when_needed_to_fit_budget(self):
        long_line = "A" * 220
        document = normalize_canvas_document(
            {
                "id": "doc-1",
                "title": "report.md",
                "format": "markdown",
                "language": "markdown",
                "content": f"{long_line}\nshort line",
            }
        )

        payload = _build_canvas_prompt_payload([document], max_lines=10, max_chars=120)

        assert payload is not None
        assert payload["clipped_line_count"] == 1
        assert payload["visible_lines"][0].startswith("1: ")
        assert payload["visible_lines"][0].endswith("..")
        assert len(payload["visible_lines"][0]) < len(f"1: {long_line}")

    def test_build_canvas_prompt_payload_uses_custom_line_clip_limits(self):
        code_line = "x" * 220
        markdown_line = "A" * 220
        code_document = normalize_canvas_document(
            {
                "id": "doc-code",
                "title": "app.py",
                "format": "code",
                "language": "python",
                "content": f"{code_line}\nprint('done')",
            }
        )
        markdown_document = normalize_canvas_document(
            {
                "id": "doc-md",
                "title": "notes.md",
                "format": "markdown",
                "language": "markdown",
                "content": f"{markdown_line}\nshort line",
            }
        )

        code_payload = _build_canvas_prompt_payload(
            [code_document],
            max_lines=10,
            max_chars=120,
            code_line_max_chars=60,
        )
        markdown_payload = _build_canvas_prompt_payload(
            [markdown_document],
            max_lines=10,
            max_chars=120,
            text_line_max_chars=55,
        )

        assert code_payload is not None
        assert markdown_payload is not None
        assert code_payload["visible_lines"][0].endswith("..")
        assert markdown_payload["visible_lines"][0].endswith("..")
        assert len(code_payload["visible_lines"][0]) <= len("1: ") + 60
        assert len(markdown_payload["visible_lines"][0]) <= len("1: ") + 55

    def test_normalize_canvas_document_detects_page_count_from_markers(self):
        document = normalize_canvas_document(
            {
                "id": "pdf-1",
                "title": "report.pdf",
                "format": "markdown",
                "content": "## Page 1\n\nAlpha\n\n---\n\n## Page 2\n\nBeta",
            }
        )

        assert document["page_count"] == 2

    def test_normalize_canvas_document_ignores_page_markers_in_code_documents(self):
        document = normalize_canvas_document(
            {
                "id": "code-1",
                "title": "app.py",
                "format": "code",
                "content": "## Page 1\nprint('hello')",
            }
        )

        assert "page_count" not in document

    def test_scroll_canvas_document_returns_window_flags(self):
        content = "\n".join(f"line {index}" for index in range(1, 101))
        runtime_state = create_canvas_runtime_state(
            [
                {
                    "id": "doc-1",
                    "title": "Large file",
                    "format": "code",
                    "language": "python",
                    "content": content,
                }
            ]
        )

        result = scroll_canvas_document(runtime_state, 20, 60, max_window_lines=15)

        assert result["start_line"] == 20
        assert result["end_line_actual"] == 34
        assert len(result["visible_lines"]) == 15
        assert result["has_more_above"]
        assert result["has_more_below"]

    def test_scroll_canvas_document_visual_mode_error_includes_guidance(self):
        runtime_state = create_canvas_runtime_state(
            [
                {
                    "id": "doc-visual",
                    "title": "scan.pdf",
                    "path": "docs/scan.pdf",
                    "format": "markdown",
                    "content_mode": "visual",
                    "canvas_mode": "preview_only",
                    "content": "## Page 1\n\n[Visual page 1 preview is available in the Canvas panel.]",
                }
            ],
            active_document_id="doc-visual",
        )

        with pytest.raises(ValueError, match="image-backed"):
            scroll_canvas_document(runtime_state, 1, 3)

    def test_search_canvas_document_defaults_to_active_document(self):
        runtime_state = create_canvas_runtime_state(
            [
                {
                    "id": "doc-1",
                    "title": "a.py",
                    "path": "src/a.py",
                    "format": "code",
                    "content": "alpha\nbeta\ngamma",
                },
                {
                    "id": "doc-2",
                    "title": "b.py",
                    "path": "src/b.py",
                    "format": "code",
                    "content": "beta only",
                },
            ],
            active_document_id="doc-1",
        )

        result = search_canvas_document(runtime_state, "beta")

        assert result["match_count"] == 1
        assert result["matches"][0]["document_id"] == "doc-1"
        assert result["matches"][0]["line"] == 2

    def test_search_canvas_document_can_search_all_documents(self):
        runtime_state = create_canvas_runtime_state(
            [
                {
                    "id": "doc-1",
                    "title": "a.py",
                    "path": "src/a.py",
                    "format": "code",
                    "content": "alpha\nbeta",
                },
                {
                    "id": "doc-2",
                    "title": "b.py",
                    "path": "src/b.py",
                    "format": "code",
                    "content": "beta\ngamma",
                },
            ],
            active_document_id="doc-1",
        )

        result = search_canvas_document(runtime_state, "beta", all_documents=True)

        assert result["match_count"] == 2
        assert [match["document_id"] for match in result["matches"]] == ["doc-1", "doc-2"]

    def test_search_canvas_document_supports_context_lines_and_offset(self):
        runtime_state = create_canvas_runtime_state(
            [
                {
                    "id": "doc-1",
                    "title": "a.py",
                    "path": "src/a.py",
                    "format": "code",
                    "content": "zero\nalpha\nbeta\ngamma\nbeta again\ndelta",
                }
            ],
            active_document_id="doc-1",
        )

        result = search_canvas_document(runtime_state, "beta", context_lines=1, offset=1, max_results=1)

        assert result["match_count"] == 2
        assert result["returned_count"] == 1
        assert not result["has_more"]
        assert result["matches"][0]["line"] == 5
        assert result["matches"][0]["context_before"] == ["4: gamma"]
        assert result["matches"][0]["context_after"] == ["6: delta"]

    def test_batch_read_canvas_documents_combines_expand_and_scroll_requests(self):
        runtime_state = create_canvas_runtime_state(
            [
                {
                    "id": "doc-1",
                    "title": "a.py",
                    "path": "src/a.py",
                    "format": "code",
                    "content": "one\ntwo\nthree\nfour",
                },
                {
                    "id": "doc-2",
                    "title": "README.md",
                    "path": "README.md",
                    "format": "markdown",
                    "content": "# Title\n\nHello",
                },
            ],
            active_document_id="doc-1",
        )

        result = batch_read_canvas_documents(
            runtime_state,
            [
                {"document_path": "src/a.py", "start_line": 2, "end_line": 3},
                {"document_path": "README.md"},
                {"document_path": "missing.py"},
            ],
        )

        assert result["requested_count"] == 3
        assert result["success_count"] == 2
        assert result["results"][0]["action"] == "scrolled"
        assert result["results"][0]["visible_lines"] == ["2: two", "3: three"]
        assert result["results"][1]["action"] == "expanded"
        assert result["results"][2]["status"] == "error"

    def test_set_canvas_viewport_permanent_disables_auto_unpin(self):
        runtime_state = create_canvas_runtime_state(
            [
                {
                    "id": "doc-1",
                    "title": "app.py",
                    "path": "src/app.py",
                    "format": "code",
                    "content": "line 1\nline 2\nline 3",
                }
            ]
        )

        result = set_canvas_viewport(
            runtime_state,
            document_path="src/app.py",
            start_line=2,
            end_line=3,
            permanent=True,
            auto_unpin_on_edit=True,
        )

        assert result["pinned"]["permanent"]
        assert not result["pinned"]["auto_unpin_on_edit"]
        assert result["pinned"]["ttl_turns"] == 0

    def test_set_canvas_viewport_ttl_zero_is_treated_as_permanent(self):
        runtime_state = create_canvas_runtime_state(
            [
                {
                    "id": "doc-1",
                    "title": "app.py",
                    "path": "src/app.py",
                    "format": "code",
                    "content": "line 1\nline 2\nline 3",
                }
            ]
        )

        result = set_canvas_viewport(
            runtime_state,
            document_path="src/app.py",
            start_line=1,
            end_line=2,
            ttl_turns=0,
            auto_unpin_on_edit=True,
        )

        assert result["pinned"]["permanent"]
        assert not result["pinned"]["auto_unpin_on_edit"]
        assert result["pinned"]["ttl_turns"] == 0
        assert result["pinned"]["remaining_turns"] == 0

    def test_set_canvas_viewport_rejects_visual_canvas_documents(self):
        runtime_state = create_canvas_runtime_state(
            [
                {
                    "id": "doc-visual",
                    "title": "scan.pdf",
                    "path": "docs/scan.pdf",
                    "format": "markdown",
                    "content": "# scan.pdf",
                    "content_mode": "visual",
                    "canvas_mode": "preview_only",
                    "page_count": 2,
                }
            ]
        )

        with pytest.raises(ValueError, match="text-addressable lines"):
            set_canvas_viewport(runtime_state, document_path="docs/scan.pdf", start_line=1, end_line=2)

    def test_validate_canvas_document_detects_python_and_markdown_issues(self):
        runtime_state = create_canvas_runtime_state(
            [
                {
                    "id": "doc-1",
                    "title": "broken.py",
                    "path": "broken.py",
                    "format": "code",
                    "language": "python",
                    "content": "def broken(:\n    pass\n",
                },
                {
                    "id": "doc-2",
                    "title": "README.md",
                    "path": "README.md",
                    "format": "markdown",
                    "content": "# Title\n### Skipped\n```python\nprint('x')\n",
                },
            ],
            active_document_id="doc-1",
        )

        python_result = validate_canvas_document(runtime_state, document_path="broken.py")
        markdown_result = validate_canvas_document(runtime_state, document_path="README.md")

        assert not python_result["is_valid"]
        assert python_result["validator_used"] == "python"
        assert python_result["issues"][0]["severity"] == "error"
        assert markdown_result["validator_used"] == "markdown"
        assert any(issue["message"] == "Unclosed fenced code block." for issue in markdown_result["issues"])

    def test_validate_canvas_document_marks_visual_canvas_documents_invalid_for_text_validation(self):
        runtime_state = create_canvas_runtime_state(
            [
                {
                    "id": "doc-visual",
                    "title": "scan.pdf",
                    "path": "docs/scan.pdf",
                    "format": "markdown",
                    "content": "# scan.pdf",
                    "content_mode": "visual",
                    "canvas_mode": "preview_only",
                    "page_count": 2,
                }
            ]
        )

        result = validate_canvas_document(runtime_state, document_path="docs/scan.pdf")

        assert not result["is_valid"]
        assert result["validator_used"] == "none"
        assert "image-backed previews" in result["issues"][0]["message"]

    def test_focus_canvas_page_pins_detected_page_range(self):
        runtime_state = create_canvas_runtime_state(
            [
                {
                    "id": "doc-1",
                    "title": "report.pdf",
                    "path": "docs/report.pdf",
                    "format": "markdown",
                    "content": "## Page 1\n\nAlpha\n\n---\n\n## Page 2\n\nBeta",
                }
            ]
        )

        result = focus_canvas_page(runtime_state, document_path="docs/report.pdf", page_number=2, ttl_turns=2)
        payloads = get_canvas_viewport_payloads(runtime_state)

        assert result["action"] == "page_focused"
        assert result["page_number"] == 2
        assert result["start_line"] == 7
        assert result["end_line"] == 9
        assert payloads[0]["page_number"] == 2
        assert payloads[0]["start_line"] == 7
        assert payloads[0]["end_line"] == 9

    def test_runtime_system_message_mentions_canvas_scroll_for_truncated_excerpt(self):
        content = "\n".join(f"line {index}" for index in range(1, 51))
        document = normalize_canvas_document(
            {
                "id": "doc-1",
                "title": "Large file",
                "format": "code",
                "language": "python",
                "content": content,
            }
        )

        message = build_runtime_system_message(
            canvas_documents=[document],
            canvas_prompt_max_lines=10,
        )

        assert "This canvas excerpt is truncated" in message["content"]
        assert "when no canvas read tool is enabled" in message["content"]
        assert "scroll_canvas_document" not in message["content"]
        assert "expand_canvas_document" not in message["content"]

    def test_runtime_system_message_does_not_ask_expand_scroll_for_full_canvas(self):
        content = "\n".join(f"line {index}" for index in range(1, 11))
        document = normalize_canvas_document(
            {
                "id": "doc-1",
                "title": "Small file",
                "format": "code",
                "language": "python",
                "content": content,
            }
        )

        message = build_runtime_system_message(
            canvas_documents=[document],
            canvas_prompt_max_lines=20,
        )

        assert "fully visible in the current excerpt" in message["content"]
        assert "Canvas is already fully visible" in message["content"]
        assert "If this excerpt is truncated" not in message["content"]
