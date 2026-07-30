"""Unit tests for CompactedState validation and ContextBlock rendering."""

from __future__ import annotations

import json
import pytest

from core.context_memory import (
    ContextBlock,
    ContextBlockKind,
    COMPACTED_STATE_SCHEMA,
    validate_compacted_state,
)


# ---------------------------------------------------------------------------
# CompactedState schema validation
# ---------------------------------------------------------------------------

class TestCompactedStateValidation:
    """Validation of the CompactedState JSON schema."""

    def make_valid_state(self):
        return {
            "project_summary": "Building a Flask AI agent studio.",
            "established_context": [
                "The app uses SQLite with WAL mode.",
                "DeepSeek is the primary AI provider.",
            ],
            "key_decisions": ["Use SQLite instead of PostgreSQL."],
            "completed_tasks": ["Set up Flask app factory."],
            "current_tasks": ["Implement context memory system."],
            "blockers": ["None"],
            "affected_files": ["core/db.py", "core/messages.py"],
        }

    def test_valid_state_passes(self):
        data = self.make_valid_state()
        assert validate_compacted_state(data) == []

    def test_missing_project_summary(self):
        data = self.make_valid_state()
        del data["project_summary"]
        errors = validate_compacted_state(data)
        assert any("project_summary" in e for e in errors)

    def test_empty_project_summary(self):
        data = self.make_valid_state()
        data["project_summary"] = ""
        errors = validate_compacted_state(data)
        assert any("project_summary" in e for e in errors)

    def test_missing_established_context(self):
        data = self.make_valid_state()
        del data["established_context"]
        errors = validate_compacted_state(data)
        assert any("established_context" in e for e in errors)

    def test_empty_established_context(self):
        data = self.make_valid_state()
        data["established_context"] = []
        errors = validate_compacted_state(data)
        assert any("established_context" in e for e in errors)

    def test_established_context_with_empty_strings(self):
        data = self.make_valid_state()
        data["established_context"] = ["valid", ""]
        errors = validate_compacted_state(data)
        assert any("established_context" in e for e in errors)

    def test_missing_current_tasks(self):
        data = self.make_valid_state()
        del data["current_tasks"]
        errors = validate_compacted_state(data)
        assert any("current_tasks" in e for e in errors)

    def test_empty_current_tasks(self):
        data = self.make_valid_state()
        data["current_tasks"] = []
        errors = validate_compacted_state(data)
        assert any("current_tasks" in e for e in errors)

    def test_current_tasks_with_empty_strings(self):
        data = self.make_valid_state()
        data["current_tasks"] = ["valid", ""]
        errors = validate_compacted_state(data)
        assert any("current_tasks" in e for e in errors)

    def test_optional_arrays_can_be_empty(self):
        data = self.make_valid_state()
        data["key_decisions"] = []
        data["completed_tasks"] = []
        data["blockers"] = []
        data["affected_files"] = []
        # These are optional arrays — empty is fine
        errors = validate_compacted_state(data)
        assert errors == []

    def test_extra_fields_rejected(self):
        data = self.make_valid_state()
        data["unexpected_field"] = "nope"
        errors = validate_compacted_state(data)
        assert any("unexpected_field" in e for e in errors)

    def test_non_array_fields_rejected(self):
        data = self.make_valid_state()
        data["key_decisions"] = "not an array"
        errors = validate_compacted_state(data)
        assert any("key_decisions" in e for e in errors)

    def test_non_string_array_items_rejected(self):
        data = self.make_valid_state()
        data["blockers"] = [1, 2, 3]
        errors = validate_compacted_state(data)
        assert any("blockers" in e for e in errors)

    def test_not_a_dict(self):
        errors = validate_compacted_state("not a dict")  # type: ignore[arg-type]
        assert any("JSON object" in e for e in errors)

    def test_schema_is_valid_json_schema(self):
        """Verify the schema itself is a valid JSON Schema draft."""
        # It should have the required top-level keys
        assert COMPACTED_STATE_SCHEMA["type"] == "object"
        assert "required" in COMPACTED_STATE_SCHEMA
        assert "properties" in COMPACTED_STATE_SCHEMA
        assert "additionalProperties" in COMPACTED_STATE_SCHEMA


# ---------------------------------------------------------------------------
# ContextBlock
# ---------------------------------------------------------------------------

class TestContextBlockFromRow:
    """Construction from a context_blocks DB row dict."""

    def test_minimal_row(self):
        row = {
            "id": 1,
            "public_id": "msg_104",
            "conversation_id": 42,
            "sequence": 1,
            "kind": "message",
            "api_role": "user",
            "source_message_id": None,
            "parent_public_id": None,
            "provider_call_id": None,
            "tool_name": None,
            "content": "Hello",
            "tool_calls_json": None,
            "metadata_json": None,
            "token_estimate": 10,
            "created_at": "2026-01-01",
        }
        block = ContextBlock.from_row(row)
        assert block.id == 1
        assert block.public_id == "msg_104"
        assert block.content == "Hello"
        assert block.source_message_id is None

    def test_row_with_nulls_as_empty_strings(self):
        row = {
            "id": 2,
            "public_id": "tool_call_105_1",
            "conversation_id": 42,
            "sequence": 2,
            "kind": "tool_call",
            "api_role": "assistant",
            "source_message_id": 105,
            "parent_public_id": None,
            "provider_call_id": "call_abc",
            "tool_name": "search_web",
            "content": "",
            "tool_calls_json": json.dumps([{"id": "call_abc", "function": {"name": "search_web", "arguments": "{}"}}]),
            "metadata_json": None,
            "token_estimate": 50,
            "created_at": "2026-01-01",
        }
        block = ContextBlock.from_row(row)
        assert block.provider_call_id == "call_abc"
        assert block.tool_name == "search_web"
        assert block.tool_calls_json is not None

    def test_all_optional_fields_none_come_through(self):
        row = {
            "id": 3,
            "public_id": "msg_1",
            "conversation_id": 1,
            "sequence": 1,
            "kind": "message",
            "api_role": "user",
            "content": "x",
            "token_estimate": 0,
            "created_at": "",
            # Missing optional fields
        }
        block = ContextBlock.from_row(row)
        assert block.source_message_id is None
        assert block.parent_public_id is None
        assert block.provider_call_id is None
        assert block.tool_name is None
        assert block.tool_calls_json is None
        assert block.metadata_json is None


class TestContextBlockToApiMessage:
    """Rendering blocks to provider-compatible API messages."""

    def test_user_message_with_label(self):
        block = ContextBlock(
            id=1, public_id="msg_104", conversation_id=1, sequence=1,
            kind="message", api_role="user", content="Hello world",
        )
        msg = block.to_api_message()
        assert msg["role"] == "user"
        assert msg["content"] == "[msg_104] Hello world"

    def test_assistant_message_with_tool_calls(self):
        tool_calls = [{"id": "call_1", "type": "function", "function": {"name": "search_web", "arguments": "{}"}}]
        block = ContextBlock(
            id=2, public_id="tool_call_105_1", conversation_id=1, sequence=2,
            kind="tool_call", api_role="assistant", content="",
            tool_calls_json=json.dumps(tool_calls),
        )
        msg = block.to_api_message()
        assert msg["role"] == "assistant"
        assert msg["content"] == "[tool_call_105_1]"
        assert "tool_calls" in msg
        assert len(msg["tool_calls"]) == 1

    def test_tool_result_message_with_label(self):
        block = ContextBlock(
            id=3, public_id="tool_res_106", conversation_id=1, sequence=3,
            kind="tool_result", api_role="tool", content='{"results": [1,2,3]}',
            provider_call_id="call_1",
        )
        msg = block.to_api_message()
        assert msg["role"] == "tool"
        assert msg["tool_call_id"] == "call_1"
        assert "[tool_res_106]" in msg["content"]

    def test_delegate_report_renders_as_user(self):
        block = ContextBlock(
            id=4, public_id="delegate_res_abc", conversation_id=1, sequence=4,
            kind="delegate_report", api_role="user", content="Sub-agent report",
        )
        msg = block.to_api_message()
        assert msg["role"] == "user"
        assert "[delegate_res_abc]" in msg["content"]

    def test_invalid_tool_calls_json_does_not_raise(self):
        block = ContextBlock(
            id=5, public_id="tool_call_1_1", conversation_id=1, sequence=5,
            kind="tool_call", api_role="assistant", content="",
            tool_calls_json="not valid json",
        )
        msg = block.to_api_message()
        assert msg["role"] == "assistant"
        assert "tool_calls" not in msg  # gracefully omitted
