"""Tests for the compact_context transaction and lock mechanism.

Uses the migration fixture database defined in conftest.py
(which includes context_blocks and context_mutations tables).
"""

from __future__ import annotations

import json
import threading
import time

import pytest

try:
    from core.db import (
        execute_compact_context_transaction,
        acquire_compaction_lock,
        release_compaction_lock,
        backfill_context_blocks,
        list_context_blocks,
        count_context_blocks,
        insert_context_block,
        allocate_context_block_sequence,
        get_context_blocks_by_public_ids,
        delete_all_context_blocks,
    )
    from core.context_memory import ContextBlockKind, validate_compacted_state
    HAS_DB = True
except ImportError:
    HAS_DB = False

pytestmark = pytest.mark.skipif(not HAS_DB, reason="core.db not importable")


# ---------------------------------------------------------------------------
# Valid CompactedState fixture
# ---------------------------------------------------------------------------

VALID_COMPACTED_STATE = {
    "project_summary": "Testing the context compaction feature for Flask AI Agent Studio.",
    "established_context": [
        "The project is a Flask-based AI agent chat application.",
        "Context memory system uses a tiered architecture (T1/T2/T3).",
    ],
    "key_decisions": [
        "Use context_blocks ledger as the single source of truth for Tier 2.",
    ],
    "completed_tasks": [
        "Implemented purge tool (Phase 4).",
    ],
    "current_tasks": [
        "Implement compact_context tool (Phase 5).",
    ],
    "blockers": [],
    "affected_files": [
        "agent/agent.py",
        "core/db.py",
        "lib/tool_registry.py",
    ],
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _add_simple_blocks(conn, conv_id, count=3):
    """Add a few simple user/assistant message blocks."""
    for i in range(count):
        seq = allocate_context_block_sequence(conv_id, conn=conn)
        insert_context_block(
            public_id=f"msg_comp_{i}",
            conversation_id=conv_id,
            sequence=seq,
            kind="message",
            api_role="user" if i % 2 == 0 else "assistant",
            content=f"Test message {i}",
            token_estimate=10,
            conn=conn,
        )


# ---------------------------------------------------------------------------
# Compaction transaction tests
# ---------------------------------------------------------------------------

class TestCompactionTransaction:
    """Tests for execute_compact_context_transaction()."""

    def test_compaction_removes_all_blocks(self, migration_fixture_db):
        conn, conv_ids = migration_fixture_db
        _add_simple_blocks(conn, conv_ids["plain"])
        before = count_context_blocks(conv_ids["plain"], conn=conn)
        assert before >= 3

        state_json = json.dumps(VALID_COMPACTED_STATE)
        result = execute_compact_context_transaction(
            conv_ids["plain"],
            state_json,
            resume_instruction="Continue testing.",
            actor="test",
            conn=conn,
        )

        assert result.get("error") is None
        assert result["blocks_removed"] == before
        assert result["removed_tokens"] >= 0
        assert result["cache_reset_required"] is True
        assert result["state_public_id"].startswith("state_")
        assert result["resume_public_id"].startswith("resume_")

        # Only 2 blocks remain: state + resume
        after = count_context_blocks(conv_ids["plain"], conn=conn)
        assert after == 2

    def test_compaction_creates_state_and_resume_blocks(self, migration_fixture_db):
        conn, conv_ids = migration_fixture_db
        _add_simple_blocks(conn, conv_ids["plain"])

        state_json = json.dumps(VALID_COMPACTED_STATE)
        result = execute_compact_context_transaction(
            conv_ids["plain"],
            state_json,
            resume_instruction="Continue testing.",
            actor="test",
            conn=conn,
        )

        blocks = list_context_blocks(conv_ids["plain"], conn=conn)
        assert len(blocks) == 2

        state_block = blocks[0]
        assert state_block["kind"] == "compacted_state"
        assert state_block["public_id"].startswith("state_")
        assert state_block["sequence"] == 1

        resume_block = blocks[1]
        assert resume_block["kind"] == "resume_instruction"
        assert resume_block["public_id"].startswith("resume_")
        assert resume_block["sequence"] == 2
        assert "Continue testing" in resume_block["content"]

    def test_compaction_writes_audit_record(self, migration_fixture_db):
        conn, conv_ids = migration_fixture_db
        _add_simple_blocks(conn, conv_ids["plain"])

        state_json = json.dumps(VALID_COMPACTED_STATE)
        execute_compact_context_transaction(
            conv_ids["plain"],
            state_json,
            resume_instruction="Resume after compaction.",
            actor="model",
            conn=conn,
        )

        rows = conn.execute(
            "SELECT * FROM context_mutations WHERE conversation_id = ? ORDER BY id DESC LIMIT 1",
            (conv_ids["plain"],),
        ).fetchall()
        assert len(rows) == 1
        mutation = dict(rows[0])
        assert mutation["operation"] == "compact_context"
        assert mutation["actor"] == "model"
        assert mutation["removed_tokens"] >= 0

    def test_compaction_empty_blocks_still_inserts_state(self, migration_fixture_db):
        """Even with 0 blocks, compaction should insert state+resume."""
        conn, conv_ids = migration_fixture_db
        state_json = json.dumps(VALID_COMPACTED_STATE)
        result = execute_compact_context_transaction(
            conv_ids["plain"],
            state_json,
            resume_instruction="Start fresh.",
            actor="test",
            conn=conn,
        )
        assert result.get("error") is None
        assert result["blocks_removed"] == 0

        blocks = list_context_blocks(conv_ids["plain"], conn=conn)
        assert len(blocks) == 2

    def test_compaction_preserves_state_content(self, migration_fixture_db):
        conn, conv_ids = migration_fixture_db
        _add_simple_blocks(conn, conv_ids["plain"])

        state_json = json.dumps(VALID_COMPACTED_STATE)
        execute_compact_context_transaction(
            conv_ids["plain"],
            state_json,
            resume_instruction="Continue.",
            actor="test",
            conn=conn,
        )

        # Read back state block and verify content
        blocks = list_context_blocks(conv_ids["plain"], conn=conn)
        state_block = blocks[0]
        parsed = json.loads(state_block["content"])
        assert parsed["project_summary"] == VALID_COMPACTED_STATE["project_summary"]
        assert len(parsed["established_context"]) == 2
        assert len(parsed["current_tasks"]) == 1

    def test_compaction_idempotent_after_clear(self, migration_fixture_db):
        """Running compaction twice in a row should work (second clears then re-creates)."""
        conn, conv_ids = migration_fixture_db
        _add_simple_blocks(conn, conv_ids["plain"])

        state_json = json.dumps(VALID_COMPACTED_STATE)
        result1 = execute_compact_context_transaction(
            conv_ids["plain"], state_json, "First.", actor="test", conn=conn,
        )
        assert result1.get("error") is None

        # Run again
        result2 = execute_compact_context_transaction(
            conv_ids["plain"], state_json, "Second.", actor="test", conn=conn,
        )
        assert result2.get("error") is None
        assert result2["blocks_removed"] == 2  # removed the first state+resume

        # Should still have exactly 2 blocks
        blocks = list_context_blocks(conv_ids["plain"], conn=conn)
        assert len(blocks) == 2


# ---------------------------------------------------------------------------
# Compaction lock tests
# ---------------------------------------------------------------------------

class TestCompactionLock:
    """Tests for acquire/release compaction lock."""

    def test_acquire_lock(self, migration_fixture_db):
        conn, conv_ids = migration_fixture_db
        acquired = acquire_compaction_lock(conv_ids["plain"], timeout=1.0)
        assert acquired is True
        release_compaction_lock(conv_ids["plain"])

    def test_concurrent_lock_denied(self, migration_fixture_db):
        conn, conv_ids = migration_fixture_db

        acquired1 = acquire_compaction_lock(conv_ids["plain"], timeout=0.5)
        assert acquired1 is True

        # Second attempt should fail (timeout=0 means immediate)
        acquired2 = acquire_compaction_lock(conv_ids["plain"], timeout=0.0)
        assert acquired2 is False

        release_compaction_lock(conv_ids["plain"])

    def test_lock_release_allows_reacquire(self, migration_fixture_db):
        conn, conv_ids = migration_fixture_db

        acquired1 = acquire_compaction_lock(conv_ids["plain"], timeout=1.0)
        assert acquired1 is True
        release_compaction_lock(conv_ids["plain"])

        acquired2 = acquire_compaction_lock(conv_ids["plain"], timeout=1.0)
        assert acquired2 is True
        release_compaction_lock(conv_ids["plain"])

    def test_different_conversations_independent(self, migration_fixture_db):
        conn, conv_ids = migration_fixture_db

        acquired_a = acquire_compaction_lock(conv_ids["plain"], timeout=1.0)
        acquired_b = acquire_compaction_lock(conv_ids["tool_calls"], timeout=1.0)
        assert acquired_a is True
        assert acquired_b is True

        release_compaction_lock(conv_ids["plain"])
        release_compaction_lock(conv_ids["tool_calls"])

    def test_threaded_lock_contention(self, migration_fixture_db):
        """Verify that a separate thread cannot acquire the lock while held."""
        conn, conv_ids = migration_fixture_db
        results = {"thread_got_lock": None}

        def _try_lock():
            results["thread_got_lock"] = acquire_compaction_lock(conv_ids["plain"], timeout=0.5)

        acquired = acquire_compaction_lock(conv_ids["plain"], timeout=0.5)
        assert acquired is True

        t = threading.Thread(target=_try_lock)
        t.start()
        t.join(timeout=2.0)

        assert results["thread_got_lock"] is False  # Should be denied

        release_compaction_lock(conv_ids["plain"])


# ---------------------------------------------------------------------------
# CompactedState validation tests
# ---------------------------------------------------------------------------

class TestCompactedStateValidation:
    """Tests for validate_compacted_state() function."""

    def test_valid_state_passes(self):
        errors = validate_compacted_state(VALID_COMPACTED_STATE)
        assert errors == []

    def test_missing_field_fails(self):
        state = dict(VALID_COMPACTED_STATE)
        del state["project_summary"]
        errors = validate_compacted_state(state)
        assert len(errors) >= 1
        assert any("project_summary" in e for e in errors)

    def test_empty_project_summary_fails(self):
        state = dict(VALID_COMPACTED_STATE)
        state["project_summary"] = ""
        errors = validate_compacted_state(state)
        assert len(errors) >= 1

    def test_empty_established_context_fails(self):
        state = dict(VALID_COMPACTED_STATE)
        state["established_context"] = []
        errors = validate_compacted_state(state)
        assert len(errors) >= 1

    def test_empty_current_tasks_fails(self):
        state = dict(VALID_COMPACTED_STATE)
        state["current_tasks"] = []
        errors = validate_compacted_state(state)
        assert len(errors) >= 1

    def test_non_string_array_elements_fail(self):
        state = dict(VALID_COMPACTED_STATE)
        state["established_context"] = [123]  # ints, not strings
        errors = validate_compacted_state(state)
        assert len(errors) >= 1

    def test_extra_fields_fail(self):
        state = dict(VALID_COMPACTED_STATE)
        state["extra_field"] = "should not be here"
        errors = validate_compacted_state(state)
        assert len(errors) >= 1
        assert any("Unexpected fields" in e for e in errors)

    def test_non_dict_fails(self):
        errors = validate_compacted_state("not a dict")
        assert len(errors) >= 1
