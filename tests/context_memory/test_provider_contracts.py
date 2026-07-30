"""Contract tests for current provider message normalisation rules.

These tests freeze the existing behaviour of the message assembly pipeline
so that Phase 1-3 changes do not accidentally break DeepSeek tool chains,
OpenRouter cache-control blocks, or other provider-specific requirements.

Per CACHE_AND_MESSAGE_RULES.md:
- Exactly ONE system message at messages[0]
- Internal keys (reasoning, reasoning_details, _forge_*) stripped from ALL
  assistant messages before sending to the API
- DeepSeek content-stripping isolated to DeepSeekAdapter.normalize_messages
- Static System / Dynamic Footer pattern (context injection in last user msg)
"""

from __future__ import annotations

import pytest

try:
    from core.messages import (
        build_api_messages,
        build_runtime_system_message,
        _sanitize_tool_call_chain,
    )
    HAS_MESSAGES = True
except ImportError:
    HAS_MESSAGES = False


pytestmark = pytest.mark.skipif(not HAS_MESSAGES, reason="core.messages not importable in this context")


# ---------------------------------------------------------------------------
# System message invariants
# ---------------------------------------------------------------------------

class TestSystemMessageInvariants:
    """The system message must be a single static block."""

    def test_build_runtime_system_message_returns_dict(self):
        msg = build_runtime_system_message(
            include_dynamic_context=False,
            include_volatile_context=False,
        )
        assert isinstance(msg, dict)
        assert msg["role"] == "system"
        assert isinstance(msg["content"], str)
        assert len(msg["content"]) > 0

    def test_system_message_is_single_block(self):
        """build_runtime_system_message returns exactly one message."""
        msg = build_runtime_system_message(
            include_dynamic_context=False,
            include_volatile_context=False,
        )
        # Should be a plain dict, not a list
        assert "role" in msg


# ---------------------------------------------------------------------------
# API message normalisation invariants
# ---------------------------------------------------------------------------

class TestApiMessageNormalisation:
    """Provider-agnostic normalisation rules for outbound API messages."""

    def _build_test_messages(self):
        """Minimal message list: system + user + assistant + tool."""
        return [
            {"role": "system", "content": "You are a helpful assistant."},
            {"role": "user", "content": "Hello", "metadata": "{}"},
            {
                "role": "assistant",
                "content": "Hi!",
                "tool_calls": json_like("[{\"id\":\"call_1\",\"type\":\"function\",\"function\":{\"name\":\"search_web\",\"arguments\":\"{\\\"query\\\":\\\"test\\\"}\"}}]"),
            },
            {"role": "tool", "content": "Result", "tool_call_id": "call_1", "tool_name": "search_web"},
        ]


def json_like(s):
    import json
    return json.loads(s)
