"""Phase 4 — Conversation-memory tool executors.

Covers the model-callable save_to_conversation_memory and
delete_conversation_memory_entry tools:
- new entry creation
- upsert on existing key
- cross-conversation isolation
- missing conversation context
- disabled conversation memory
- empty and oversized values
- registry integrity coverage
- audit / mutation context propagation
"""

from __future__ import annotations

import pytest

import core.config as config_module
from core.db import (
    get_conversation_memory,
    get_conversation_memory_entry,
    get_db,
)


def _make_conversation() -> int:
    with get_db() as conn:
        cursor = conn.execute(
            "INSERT INTO conversations (title, model, created_at, updated_at) "
            "VALUES (?, ?, datetime('now'), datetime('now'))",
            ("Test Chat", "deepseek-chat"),
        )
        return int(cursor.lastrowid)


def _runtime_state(conversation_id: int) -> dict:
    return {"agent_context": {"conversation_id": conversation_id}}


@pytest.fixture(autouse=True)
def _enable_conversation_memory():
    """Ensure conversation memory is enabled for these tests."""
    previous = config_module._runtime_settings.CONVERSATION_MEMORY_ENABLED
    config_module._runtime_settings = config_module.RuntimeSettings.from_defaults()
    config_module._runtime_settings.CONVERSATION_MEMORY_ENABLED = True
    yield
    config_module._runtime_settings.CONVERSATION_MEMORY_ENABLED = previous


VALID_ENTRY_TYPE = "task_context"


class TestSaveToConversationMemory:
    """Tool executor: save_to_conversation_memory."""

    def test_creates_new_entry(self):
        from agent.agent import _run_save_to_conversation_memory

        conversation_id = _make_conversation()
        result, summary = _run_save_to_conversation_memory(
            {
                "entry_type": VALID_ENTRY_TYPE,
                "key": "repo_goal",
                "value": "ship the AI cleanup plan",
            },
            _runtime_state(conversation_id),
        )

        assert result["status"] == "ok"
        assert result["updated_existing"] is False
        entry = result["entry"]
        assert entry["key"] == "repo_goal"
        assert entry["value"] == "ship the AI cleanup plan"
        assert entry["entry_type"] == VALID_ENTRY_TYPE
        assert entry["conversation_id"] == conversation_id
        assert "created" in summary.lower()

    def test_upsert_on_existing_key(self):
        from agent.agent import _run_save_to_conversation_memory

        conversation_id = _make_conversation()
        state = _runtime_state(conversation_id)

        first, _ = _run_save_to_conversation_memory(
            {"entry_type": VALID_ENTRY_TYPE, "key": "goal", "value": "first"},
            state,
        )
        second, summary = _run_save_to_conversation_memory(
            {"entry_type": VALID_ENTRY_TYPE, "key": "goal", "value": "second"},
            state,
        )

        assert second["updated_existing"] is True
        assert second["entry"]["id"] == first["entry"]["id"]
        assert second["entry"]["value"] == "second"
        assert "updated" in summary.lower()

        # Database confirms the upsert: only one entry, latest value
        entries = get_conversation_memory(conversation_id)
        assert len(entries) == 1
        assert entries[0]["value"] == "second"

    def test_missing_conversation_context(self):
        from agent.agent import _run_save_to_conversation_memory

        result, summary = _run_save_to_conversation_memory(
            {"entry_type": VALID_ENTRY_TYPE, "key": "goal", "value": "value"},
            {},
        )
        assert result["status"] == "error"
        assert "missing conversation context" in summary.lower()

    def test_disabled_returns_disabled_status(self, monkeypatch):
        from agent.agent import _run_save_to_conversation_memory

        monkeypatch.setattr(
            config_module._runtime_settings,
            "CONVERSATION_MEMORY_ENABLED",
            False,
        )
        result, summary = _run_save_to_conversation_memory(
            {"entry_type": VALID_ENTRY_TYPE, "key": "k", "value": "v"},
            _runtime_state(_make_conversation()),
        )
        assert result["status"] == "disabled"
        assert "disabled" in summary.lower()

    def test_rejects_empty_value(self):
        from agent.agent import _run_save_to_conversation_memory

        with pytest.raises(ValueError):
            _run_save_to_conversation_memory(
                {"entry_type": VALID_ENTRY_TYPE, "key": "k", "value": "   "},
                _runtime_state(_make_conversation()),
            )

    def test_rejects_oversized_value(self):
        from agent.agent import _run_save_to_conversation_memory

        with pytest.raises(ValueError):
            _run_save_to_conversation_memory(
                {"entry_type": VALID_ENTRY_TYPE, "key": "k", "value": "x" * 4001},
                _runtime_state(_make_conversation()),
            )

    def test_rejects_oversized_key(self):
        from agent.agent import _run_save_to_conversation_memory

        with pytest.raises(ValueError):
            _run_save_to_conversation_memory(
                {"entry_type": VALID_ENTRY_TYPE, "key": "k" * 65, "value": "v"},
                _runtime_state(_make_conversation()),
            )

    def test_rejects_non_string_value(self):
        from agent.agent import _run_save_to_conversation_memory

        with pytest.raises(ValueError):
            _run_save_to_conversation_memory(
                {"entry_type": VALID_ENTRY_TYPE, "key": "k", "value": 123},
                _runtime_state(_make_conversation()),
            )

    def test_does_not_return_full_collection(self):
        from agent.agent import _run_save_to_conversation_memory

        conversation_id = _make_conversation()
        state = _runtime_state(conversation_id)

        # Seed two existing entries
        _run_save_to_conversation_memory(
            {"entry_type": VALID_ENTRY_TYPE, "key": "k1", "value": "v1"}, state
        )
        _run_save_to_conversation_memory(
            {"entry_type": VALID_ENTRY_TYPE, "key": "k2", "value": "v2"}, state
        )

        result, _ = _run_save_to_conversation_memory(
            {"entry_type": VALID_ENTRY_TYPE, "key": "k3", "value": "v3"}, state
        )

        # Compact result must NOT expose the full collection.
        assert "entry" in result
        assert "entries" not in result
        assert "conversation_memory" not in result


class TestDeleteConversationMemoryEntry:
    """Tool executor: delete_conversation_memory_entry."""

    def test_delete_in_active_conversation(self):
        from agent.agent import _run_delete_conversation_memory_entry, _run_save_to_conversation_memory

        conversation_id = _make_conversation()
        state = _runtime_state(conversation_id)

        _run_save_to_conversation_memory(
            {"entry_type": VALID_ENTRY_TYPE, "key": "k", "value": "v"}, state
        )
        entries = get_conversation_memory(conversation_id)
        assert entries, "expected a saved entry"
        target_id = int(entries[0]["id"])

        result, summary = _run_delete_conversation_memory_entry(
            {"entry_id": target_id}, state
        )
        assert result["status"] == "ok"
        assert result["deleted"] is True
        assert result["entry_id"] == target_id
        assert "removed" in summary.lower()

        assert get_conversation_memory_entry(target_id, conversation_id) is None

    def test_rejects_cross_conversation_delete(self):
        from agent.agent import _run_delete_conversation_memory_entry, _run_save_to_conversation_memory

        # Entry belongs to conversation A
        conv_a = _make_conversation()
        state_a = _runtime_state(conv_a)
        _run_save_to_conversation_memory(
            {"entry_type": VALID_ENTRY_TYPE, "key": "k", "value": "v"}, state_a
        )
        entries = get_conversation_memory(conv_a)
        assert entries, "expected a saved entry"
        entry_id = int(entries[0]["id"])

        # Attempt to delete it from conversation B
        conv_b = _make_conversation()
        state_b = _runtime_state(conv_b)
        result, summary = _run_delete_conversation_memory_entry(
            {"entry_id": entry_id}, state_b
        )
        assert result["status"] == "not_found"
        assert result["deleted"] is False
        assert "not found" in summary.lower()

        # The entry still exists in conversation A.
        assert get_conversation_memory_entry(entry_id, conv_a) is not None

    def test_missing_conversation_context(self):
        from agent.agent import _run_delete_conversation_memory_entry

        result, summary = _run_delete_conversation_memory_entry(
            {"entry_id": 1}, {}
        )
        assert result["status"] == "error"
        assert "missing conversation context" in summary.lower()

    def test_disabled_returns_disabled_status(self, monkeypatch):
        from agent.agent import _run_delete_conversation_memory_entry

        monkeypatch.setattr(
            config_module._runtime_settings,
            "CONVERSATION_MEMORY_ENABLED",
            False,
        )
        result, summary = _run_delete_conversation_memory_entry(
            {"entry_id": 1}, _runtime_state(_make_conversation())
        )
        assert result["status"] == "disabled"
        assert "disabled" in summary.lower()

    def test_idempotent_when_missing(self):
        from agent.agent import _run_delete_conversation_memory_entry

        conversation_id = _make_conversation()
        result, summary = _run_delete_conversation_memory_entry(
            {"entry_id": 999_999}, _runtime_state(conversation_id)
        )
        assert result["status"] == "not_found"
        assert result["deleted"] is False
        assert "not found" in summary.lower()

    def test_rejects_non_positive_entry_id(self):
        from agent.agent import _run_delete_conversation_memory_entry

        with pytest.raises(ValueError):
            _run_delete_conversation_memory_entry(
                {"entry_id": 0}, _runtime_state(_make_conversation())
            )

        with pytest.raises(ValueError):
            _run_delete_conversation_memory_entry(
                {"entry_id": -3}, _runtime_state(_make_conversation())
            )

    def test_rejects_non_integer_entry_id(self):
        from agent.agent import _run_delete_conversation_memory_entry

        with pytest.raises(ValueError):
            _run_delete_conversation_memory_entry(
                {"entry_id": "1"}, _runtime_state(_make_conversation())
            )


class TestRegistryIntegrity:
    """Phase 4 — Both conversation-memory executors must satisfy the registry contract."""

    def test_save_executor_registered(self):
        from agent.agent import _TOOL_EXECUTORS

        assert "save_to_conversation_memory" in _TOOL_EXECUTORS

    def test_delete_executor_registered(self):
        from agent.agent import _TOOL_EXECUTORS

        assert "delete_conversation_memory_entry" in _TOOL_EXECUTORS

    def test_schema_enforces_length_constraints(self):
        from lib.tool_registry import TOOL_SPEC_BY_NAME

        spec = TOOL_SPEC_BY_NAME["save_to_conversation_memory"]
        properties = spec["parameters"]["properties"]
        assert properties["entry_type"]["minLength"] == 1
        assert properties["entry_type"]["maxLength"] == 64
        assert properties["key"]["minLength"] == 1
        assert properties["key"]["maxLength"] == 64
        assert properties["value"]["minLength"] == 1
        assert properties["value"]["maxLength"] == 4000

    def test_schema_disables_additional_properties(self):
        from lib.tool_registry import TOOL_SPEC_BY_NAME

        for name in ("save_to_conversation_memory", "delete_conversation_memory_entry"):
            spec = TOOL_SPEC_BY_NAME[name]
            assert spec["parameters"].get("additionalProperties") is False

    def test_memory_domain_metadata(self):
        from lib.tool_registry import get_tool_runtime_metadata

        save_meta = get_tool_runtime_metadata("save_to_conversation_memory")
        delete_meta = get_tool_runtime_metadata("delete_conversation_memory_entry")
        # Both are memory-domain mutators and NOT parallel-safe.
        assert "memory" in save_meta["state_domains"]
        assert save_meta["parallel_safe"] is False
        assert "memory" in delete_meta["state_domains"]
        assert delete_meta["parallel_safe"] is False
