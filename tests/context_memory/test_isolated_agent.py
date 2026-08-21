"""Tests for Phase 6 — Isolated Agent Runner and web/delegation tools."""

from __future__ import annotations

import threading
from unittest.mock import MagicMock, patch

import pytest

from agent.isolated_agent import (
    _build_isolated_system_message,
    _build_web_agent_system_message,
    run_isolated_agent,
    ISOLATED_AGENT_DEFAULT_MAX_STEPS,
    ISOLATED_AGENT_DEFAULT_TIMEOUT,
)


class TestBuildSystemMessages:
    """Unit tests for system message builders."""

    def test_isolated_system_message_basic(self):
        msg = _build_isolated_system_message("Fix the bug in auth.py")
        assert "auth.py" in msg
        assert "Available Tools" in msg
        assert "Output Format" in msg
        # Recursion prevention: child must only use the tools it was given
        assert "complete the work directly" in msg
        assert "You only have access to the tools listed above" in msg

    def test_isolated_system_message_with_constraints(self):
        msg = _build_isolated_system_message(
            "Refactor module", constraints="Do not change public API."
        )
        assert "Do not change public API" in msg
        assert "## Constraints" in msg

    def test_isolated_system_message_with_canvas_snapshot(self):
        msg = _build_isolated_system_message(
            "Review the design doc",
            canvas_readonly_snapshot="# Design\nContent here",
        )
        assert "Canvas (Read-Only Reference)" in msg
        assert "# Design" in msg

    def test_isolated_system_message_lists_available_tools(self):
        msg = _build_isolated_system_message(
            "Task", allowlist_tools=["search_web", "fetch_url"]
        )
        assert "search_web" in msg
        assert "fetch_url" in msg

    def test_web_agent_system_message_basic(self):
        msg = _build_web_agent_system_message("What is Python 3.13?")
        assert "Python 3.13" in msg
        assert "Research Query" in msg
        assert "search" in msg.lower()

    def test_web_agent_system_message_with_focus(self):
        msg = _build_web_agent_system_message(
            "Python typing", focus="Protocols and TypeGuard"
        )
        assert "Protocols and TypeGuard" in msg
        assert "Focus Areas" in msg


class TestRunIsolatedAgent:
    """Integration-adjacent tests for the isolated agent runner."""

    def _fake_stream_events(self, text: str = "Report content", errors: list | None = None):
        """Build a fake SSE stream that returns text and finishes."""
        errors = errors or []

        def _generator(*args, **kwargs):
            yield {"type": "answer_delta", "text": text}
            yield {"type": "done"}

        return _generator

    def test_run_isolated_agent_returns_report(self):
        with patch("agent.agent.run_agent_stream") as mock_run:
            mock_run.return_value = self._fake_stream_events("Task completed successfully.")()

            result = run_isolated_agent(
                task_messages=[{"role": "user", "content": "Hello"}],
                allowlist_tools=["search_web"],
                max_steps=2,
            )

            assert result["report"] == "Task completed successfully."
            assert result["success"] is True
            assert result["elapsed_ms"] >= 0

    def test_run_isolated_agent_strips_delegate_task(self):
        """Delegate task must never be in child context."""
        with patch("agent.agent.run_agent_stream") as mock_run:
            mock_run.return_value = self._fake_stream_events("Done.")()

            result = run_isolated_agent(
                task_messages=[{"role": "user", "content": "Test"}],
                allowlist_tools=["search_web", "delegate_task", "fetch_url"],
                max_steps=2,
            )

            assert result["success"] is True
            # Check that delegate_task was stripped from the call
            call_args = mock_run.call_args
            enabled_tools = call_args.kwargs.get("enabled_tool_names", [])
            assert "delegate_task" not in enabled_tools
            assert "search_web" in enabled_tools
            assert "fetch_url" in enabled_tools

    def test_run_isolated_agent_handles_error(self):
        def _error_stream(*args, **kwargs):
            yield {"type": "tool_error", "error": "API call failed"}
            yield {"type": "answer_delta", "text": "Partial..."}
            yield {"type": "done"}

        with patch("agent.agent.run_agent_stream") as mock_run:
            mock_run.return_value = _error_stream()

            result = run_isolated_agent(
                task_messages=[{"role": "user", "content": "Test"}],
                allowlist_tools=[],
                max_steps=2,
            )

            assert "Partial" in result["report"]
            assert len(result["errors"]) == 1
            assert "API call failed" in result["errors"][0]

    def test_run_isolated_agent_timeout(self):
        """Simulate timeout via a stream that takes longer than timeout_seconds.
        
        We patch time.monotonic to simulate elapsed time exceeding the limit.
        """
        import time as _time

        call_count = [0]

        def _fake_monotonic():
            call_count[0] += 1
            # First call = started_at, subsequent calls return 999 (way past timeout)
            if call_count[0] == 1:
                return 0.0
            return 999.0

        def _stream(*args, **kwargs):
            yield {"type": "answer_delta", "text": "Started..."}
            yield {"type": "done"}

        with patch("agent.agent.run_agent_stream") as mock_run, \
             patch("agent.isolated_agent.time.monotonic", side_effect=_fake_monotonic):
            mock_run.return_value = _stream()

            result = run_isolated_agent(
                task_messages=[{"role": "user", "content": "Test"}],
                allowlist_tools=[],
                max_steps=2,
                timeout_seconds=5.0,
            )

            assert result["errors"], "Should have timeout error"
            assert any("timed out" in e.lower() for e in result["errors"])

    def test_run_isolated_agent_watchdog_timeout_after_cooperative_stop(self):
        """A stream can stop on cancellation without yielding a later event."""
        def _stream(*args, **kwargs):
            cancel_event = kwargs["agent_context"]["cancel_event"]
            cancel_event.wait()
            if False:  # pragma: no cover - preserves generator form
                yield {}

        with patch("agent.agent.run_agent_stream") as mock_run:
            mock_run.side_effect = _stream

            result = run_isolated_agent(
                task_messages=[{"role": "user", "content": "Test"}],
                allowlist_tools=[],
                max_steps=2,
                timeout_seconds=0.01,
            )

        assert result["success"] is False
        assert any("timed out" in error.lower() for error in result["errors"])

    def test_run_isolated_agent_truncates_long_report(self):
        long_text = "A" * 40_000

        def _long_stream(*args, **kwargs):
            yield {"type": "answer_delta", "text": long_text}
            yield {"type": "done"}

        with patch("agent.agent.run_agent_stream") as mock_run:
            mock_run.return_value = _long_stream()

            result = run_isolated_agent(
                task_messages=[{"role": "user", "content": "Test"}],
                allowlist_tools=[],
                max_steps=2,
            )

            assert len(result["report"]) <= 30_000 + 50  # + margin for truncation note
            assert "truncated" in result["report"].lower()

    def test_run_isolated_agent_defaults(self):
        """Verify default parameter values are set correctly."""
        with patch("agent.agent.run_agent_stream") as mock_run:
            mock_run.return_value = self._fake_stream_events("Ok.")()

            run_isolated_agent(
                task_messages=[{"role": "user", "content": "Test"}],
                allowlist_tools=["search_web"],
            )

            call_args = mock_run.call_args
            assert call_args.kwargs.get("max_steps") == ISOLATED_AGENT_DEFAULT_MAX_STEPS
            assert call_args.kwargs.get("temperature") == 0.7


class TestToolHandlers:
    """Test the tool handler functions in agent.py directly."""

    def test_web_search_agent_missing_query(self):
        from agent.agent import _run_web_search_agent

        result, summary = _run_web_search_agent({}, {})
        assert "error" in result
        assert "missing query" in summary.lower()

    def test_summarized_fetch_missing_url(self):
        from agent.agent import _run_summarized_fetch

        result, summary = _run_summarized_fetch({}, {})
        assert "error" in result
        assert "missing url" in summary.lower()

    def test_delegate_task_removed(self):
        """delegate_task was removed; it must not be callable or registered."""
        from lib.tool_registry import TOOL_SPEC_BY_NAME

        assert "delegate_task" not in TOOL_SPEC_BY_NAME
        from agent.agent import _TOOL_EXECUTORS
        assert "delegate_task" not in _TOOL_EXECUTORS
        import agent.agent as agent_module

        assert not hasattr(agent_module, "_run_delegate_task_real")

    def test_web_search_agent_calls_isolated_runner(self):
        from agent.agent import _run_web_search_agent

        with patch("agent.isolated_agent.run_isolated_agent") as mock_run:
            mock_run.return_value = {
                "report": "Research findings...",
                "errors": [],
                "success": True,
                "elapsed_ms": 1234,
            }
            result, _ = _run_web_search_agent(
                {"query": "Python 3.13 features"}, {}
            )
            assert result["report"] == "Research findings..."
            assert result["success"] is True
            assert result["elapsed_ms"] == 1234

    def test_summarized_fetch_calls_isolated_runner(self):
        from agent.agent import _run_summarized_fetch

        with patch("agent.isolated_agent.run_isolated_agent") as mock_run:
            mock_run.return_value = {
                "report": "Page summary...",
                "errors": [],
                "success": True,
                "elapsed_ms": 500,
            }
            result, _ = _run_summarized_fetch(
                {"url": "https://example.com", "focus": "security"}, {}
            )
            assert result["report"] == "Page summary..."
            assert result["url"] == "https://example.com"

    def test_delegate_task_calls_isolated_runner_removed(self):
        """delegate_task is removed; this behavior is no longer applicable."""
        from lib.tool_registry import TOOL_SPEC_BY_NAME

        assert "delegate_task" not in TOOL_SPEC_BY_NAME

    def test_web_search_agent_with_focus(self):
        from agent.agent import _run_web_search_agent

        with patch("agent.isolated_agent.run_isolated_agent") as mock_run:
            mock_run.return_value = {
                "report": "Focused results...",
                "errors": [],
                "success": True,
                "elapsed_ms": 999,
            }
            result, _ = _run_web_search_agent(
                {"query": "AI safety", "focus": "alignment techniques"}, {}
            )
            assert result["focus"] == "alignment techniques"

    def test_isolated_runner_drops_unknown_tools(self):
        """The isolated runner silently drops any unknown tool — including delegate_task."""
        with patch("agent.agent.run_agent_stream") as mock_run:

            def _generator(*args, **kwargs):
                yield {"type": "answer_delta", "text": "Done."}
                yield {"type": "done"}

            mock_run.return_value = _generator()

            result = run_isolated_agent(
                task_messages=[{"role": "user", "content": "Test"}],
                allowlist_tools=["search_web", "delegate_task", "fetch_url"],
                max_steps=2,
            )

            assert result["success"] is True
            call_args = mock_run.call_args
            enabled_tools = call_args.kwargs.get("enabled_tool_names", [])
            assert "delegate_task" not in enabled_tools
            assert "search_web" in enabled_tools
            assert "fetch_url" in enabled_tools


class TestToolRegistrySpecs:
    """Verify new tool specs are registered correctly."""

    def test_web_search_agent_spec_exists(self):
        from lib.tool_registry import TOOL_SPEC_BY_NAME

        spec = TOOL_SPEC_BY_NAME.get("web_search_agent")
        assert spec is not None, "web_search_agent should be in TOOL_SPECS"
        assert spec["parameters"]["required"] == ["query"]

    def test_summarized_fetch_spec_exists(self):
        from lib.tool_registry import TOOL_SPEC_BY_NAME

        spec = TOOL_SPEC_BY_NAME.get("summarized_fetch")
        assert spec is not None, "summarized_fetch should be in TOOL_SPECS"
        assert spec["parameters"]["required"] == ["url"]

    def test_delegate_task_spec_exists(self):
        """delegate_task was removed — verify it is no longer registered."""
        from lib.tool_registry import TOOL_SPEC_BY_NAME

        assert "delegate_task" not in TOOL_SPEC_BY_NAME

    def test_new_tools_in_executor_registry(self):
        from agent.agent import _TOOL_EXECUTORS

        assert "web_search_agent" in _TOOL_EXECUTORS
        assert "summarized_fetch" in _TOOL_EXECUTORS
        assert "delegate_task" not in _TOOL_EXECUTORS

    def test_web_search_agent_metadata(self):
        from lib.tool_registry import get_tool_runtime_metadata

        meta = get_tool_runtime_metadata("web_search_agent")
        assert meta["ui_hidden"] is True
        assert meta["exclusive_turn"] is True
        assert meta["read_only"] is True
        assert meta["parallel_safe"] is True

    def test_summarized_fetch_metadata(self):
        from lib.tool_registry import get_tool_runtime_metadata

        meta = get_tool_runtime_metadata("summarized_fetch")
        assert meta["ui_hidden"] is True
        assert meta["exclusive_turn"] is True
        assert meta["read_only"] is True

    def test_delegate_task_metadata_not_registered(self):
        """delegate_task was removed; no runtime metadata entry should exist."""
        from lib.tool_registry import get_tool_runtime_metadata

        meta = get_tool_runtime_metadata("delegate_task")
        # When the spec is gone, the metadata helper must return the safe
        # default entry rather than a leftover ui_hidden/exclusive flag.
        assert meta["ui_hidden"] is False
        assert meta["exclusive_turn"] is False
        assert meta["read_only"] is False
