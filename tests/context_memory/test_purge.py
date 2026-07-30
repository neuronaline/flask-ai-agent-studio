"""Tests for the purge tool dependency closure and transactional removal.

Uses the migration fixture database defined in conftest.py
(which includes context_blocks and context_mutations tables).
"""

from __future__ import annotations

import pytest

try:
    from core.db import (
        resolve_purge_dependency_closure,
        execute_purge_transaction,
        backfill_context_blocks,
        list_context_blocks,
        get_context_blocks_by_public_ids,
        count_context_blocks,
        insert_context_block,
        allocate_context_block_sequence,
    )
    from core.context_memory import ContextBlockKind, make_public_id, validate_public_id
    HAS_DB = True
except ImportError:
    HAS_DB = False

pytestmark = pytest.mark.skipif(not HAS_DB, reason="core.db not importable")


# ---------------------------------------------------------------------------
# Fixture: conversation with tool_call + tool_result blocks pre-populated
# ---------------------------------------------------------------------------

def _make_tool_chain_fixture(conn, conv_id, id_prefix=""):
    """Add a user + assistant(tool_call) + tool_result chain directly to context_blocks."""
    pre = f"{id_prefix}_" if id_prefix else ""
    seq1 = allocate_context_block_sequence(conv_id, conn=conn)
    insert_context_block(
        public_id=f"msg_{pre}9001", conversation_id=conv_id, sequence=seq1,
        kind="message", api_role="user", content="Hello", conn=conn,
    )
    seq2 = allocate_context_block_sequence(conv_id, conn=conn)
    insert_context_block(
        public_id=f"tool_call_{pre}9002_0", conversation_id=conv_id, sequence=seq2,
        kind="tool_call", api_role="assistant", tool_name="search_web",
        provider_call_id="call_abc", content="", conn=conn,
    )
    seq3 = allocate_context_block_sequence(conv_id, conn=conn)
    insert_context_block(
        public_id=f"tool_call_{pre}9002_1", conversation_id=conv_id, sequence=seq3,
        kind="tool_call", api_role="assistant", tool_name="fetch_url",
        provider_call_id="call_def", content="", conn=conn,
    )
    seq4 = allocate_context_block_sequence(conv_id, conn=conn)
    insert_context_block(
        public_id=f"tool_res_{pre}9003", conversation_id=conv_id, sequence=seq4,
        kind="tool_result", api_role="tool",
        parent_public_id=f"tool_call_{pre}9002_0",
        provider_call_id="call_abc", content="search results", conn=conn,
    )
    seq5 = allocate_context_block_sequence(conv_id, conn=conn)
    insert_context_block(
        public_id=f"tool_res_{pre}9004", conversation_id=conv_id, sequence=seq5,
        kind="tool_result", api_role="tool",
        parent_public_id=f"tool_call_{pre}9002_1",
        provider_call_id="call_def", content="fetch results", conn=conn,
    )


# ---------------------------------------------------------------------------
# resolve_purge_dependency_closure
# ---------------------------------------------------------------------------

class TestDependencyClosure:
    """Tests for resolve_purge_dependency_closure()."""

    def test_empty_ids_returns_error(self, migration_fixture_db):
        conn, conv_ids = migration_fixture_db
        resolved, errors = resolve_purge_dependency_closure([], conv_ids["plain"], conn=conn)
        assert resolved == []
        assert len(errors) == 1
        assert "No public IDs" in errors[0]

    def test_invalid_format_returns_error(self, migration_fixture_db):
        conn, conv_ids = migration_fixture_db
        resolved, errors = resolve_purge_dependency_closure(
            ["bad_format", "also_bad"], conv_ids["plain"], conn=conn
        )
        assert resolved == []
        assert len(errors) == 1
        assert "Invalid public ID format" in errors[0]

    def test_missing_ids_returns_error(self, migration_fixture_db):
        conn, conv_ids = migration_fixture_db
        resolved, errors = resolve_purge_dependency_closure(
            ["msg_99999"], conv_ids["plain"], conn=conn
        )
        assert resolved == []
        assert len(errors) == 1
        assert "not found" in errors[0]

    def test_cross_conversation_rejected(self, migration_fixture_db):
        conn, conv_ids = migration_fixture_db
        # Backfill plain conversation
        backfill_context_blocks(conv_ids["plain"], conn=conn)
        blocks = list_context_blocks(conv_ids["plain"], conn=conn)
        assert len(blocks) > 0
        pid = blocks[0]["public_id"]

        # Try to resolve from a different conversation
        resolved, errors = resolve_purge_dependency_closure(
            [pid], conv_ids["tool_calls"], conn=conn
        )
        assert resolved == []
        assert len(errors) == 1

    def test_resolves_existing_block(self, migration_fixture_db):
        conn, conv_ids = migration_fixture_db
        _make_tool_chain_fixture(conn, conv_ids["plain"])
        resolved, errors = resolve_purge_dependency_closure(
            ["msg_9001"], conv_ids["plain"], conn=conn
        )
        assert errors == []
        assert resolved == ["msg_9001"]

    def test_tool_call_includes_children(self, migration_fixture_db):
        conn, conv_ids = migration_fixture_db
        _make_tool_chain_fixture(conn, conv_ids["plain"])
        resolved, errors = resolve_purge_dependency_closure(
            ["tool_call_9002_0"], conv_ids["plain"], conn=conn
        )
        assert errors == []
        assert "tool_call_9002_0" in resolved
        assert "tool_res_9003" in resolved  # child included
        assert "tool_call_9002_1" not in resolved  # sibling not included
        assert "tool_res_9004" not in resolved  # sibling's child not included

    def test_tool_result_includes_parent(self, migration_fixture_db):
        conn, conv_ids = migration_fixture_db
        _make_tool_chain_fixture(conn, conv_ids["plain"])
        resolved, errors = resolve_purge_dependency_closure(
            ["tool_res_9003"], conv_ids["plain"], conn=conn
        )
        assert errors == []
        assert "tool_res_9003" in resolved
        assert "tool_call_9002_0" in resolved  # parent included

    def test_multiple_ids_closure(self, migration_fixture_db):
        conn, conv_ids = migration_fixture_db
        _make_tool_chain_fixture(conn, conv_ids["plain"])
        resolved, errors = resolve_purge_dependency_closure(
            ["tool_call_9002_1", "msg_9001"], conv_ids["plain"], conn=conn
        )
        assert errors == []
        assert "msg_9001" in resolved
        assert "tool_call_9002_1" in resolved
        assert "tool_res_9004" in resolved  # child of tool_call_9002_1
        assert "tool_call_9002_0" not in resolved  # sibling not included
        assert "tool_res_9003" not in resolved


# ---------------------------------------------------------------------------
# execute_purge_transaction
# ---------------------------------------------------------------------------

class TestPurgeTransaction:
    """Tests for execute_purge_transaction()."""

    def test_purge_removes_blocks(self, migration_fixture_db):
        conn, conv_ids = migration_fixture_db
        _make_tool_chain_fixture(conn, conv_ids["plain"])
        before = count_context_blocks(conv_ids["plain"], conn=conn)
        assert before >= 5

        result = execute_purge_transaction(
            conv_ids["plain"], ["msg_9001"], summary=None, actor="test", conn=conn
        )
        assert result.get("error") is None
        assert result["resolved_ids"] == ["msg_9001"]
        assert result["removed_tokens"] >= 0
        assert result["replacement_id"] is None
        assert result["cache_reset_required"] is True

        after = count_context_blocks(conv_ids["plain"], conn=conn)
        assert after == before - 1

        # Block should no longer exist
        blocks = get_context_blocks_by_public_ids(["msg_9001"], conv_ids["plain"], conn=conn)
        assert "msg_9001" not in blocks

    def test_purge_with_summary_creates_block(self, migration_fixture_db):
        conn, conv_ids = migration_fixture_db
        _make_tool_chain_fixture(conn, conv_ids["plain"])
        before = count_context_blocks(conv_ids["plain"], conn=conn)

        result = execute_purge_transaction(
            conv_ids["plain"], ["msg_9001"],
            summary="Important fact retained.", actor="test", conn=conn,
        )
        assert result.get("error") is None
        assert result["replacement_id"] is not None
        assert result["replacement_id"].startswith("summary_")

        after = count_context_blocks(conv_ids["plain"], conn=conn)
        # -1 for purged block, +1 for summary = same count
        assert after == before

        # Summary block should be findable
        blocks = get_context_blocks_by_public_ids(
            [result["replacement_id"]], conv_ids["plain"], conn=conn
        )
        assert result["replacement_id"] in blocks
        assert "Important fact retained" in blocks[result["replacement_id"]]["content"]

    def test_purge_removes_tool_chain(self, migration_fixture_db):
        conn, conv_ids = migration_fixture_db
        _make_tool_chain_fixture(conn, conv_ids["plain"])
        before = count_context_blocks(conv_ids["plain"], conn=conn)

        # Purge tool_call + its child should remove both
        resolved, errors = resolve_purge_dependency_closure(
            ["tool_call_9002_0"], conv_ids["plain"], conn=conn
        )
        assert errors == []
        assert "tool_call_9002_0" in resolved
        assert "tool_res_9003" in resolved

        result = execute_purge_transaction(
            conv_ids["plain"], resolved, actor="test", conn=conn,
        )
        assert result.get("error") is None
        assert set(result["resolved_ids"]) == {"tool_call_9002_0", "tool_res_9003"}

        after = count_context_blocks(conv_ids["plain"], conn=conn)
        assert after == before - 2

    def test_partial_parallel_tool_purge_keeps_shared_transcript_row(self, migration_fixture_db):
        conn, conv_ids = migration_fixture_db
        conv_id = conv_ids["tool_calls"]
        backfill_context_blocks(conv_id, conn=conn)

        resolved, errors = resolve_purge_dependency_closure(
            ["tool_call_11_0"], conv_id, conn=conn
        )
        assert errors == []
        execute_purge_transaction(conv_id, resolved, actor="test", conn=conn)

        # Both parallel calls originated from assistant message 11.  Removing
        # one call/result group must not hide the shared transcript row while
        # the sibling context block remains active.
        message = conn.execute("SELECT deleted_at FROM messages WHERE id = 11").fetchone()
        assert message["deleted_at"] is None
        remaining = get_context_blocks_by_public_ids(
            ["tool_call_11_1", "tool_res_13"], conv_id, conn=conn
        )
        assert set(remaining) == {"tool_call_11_1", "tool_res_13"}

    def test_purge_empty_ids_returns_error(self, migration_fixture_db):
        conn, conv_ids = migration_fixture_db
        result = execute_purge_transaction(
            conv_ids["plain"], [], actor="test", conn=conn,
        )
        assert result.get("error") is not None

    def test_purge_nonexistent_ids_silently_noops(self, migration_fixture_db):
        conn, conv_ids = migration_fixture_db
        result = execute_purge_transaction(
            conv_ids["plain"], ["msg_99999"], actor="test", conn=conn,
        )
        # The IDs don't exist, so no blocks were found
        assert result.get("error") is not None
        assert "No matching blocks" in result["error"]

    def test_purge_is_not_cross_conversation(self, migration_fixture_db):
        conn, conv_ids = migration_fixture_db
        _make_tool_chain_fixture(conn, conv_ids["plain"], id_prefix="a")
        _make_tool_chain_fixture(conn, conv_ids["tool_calls"], id_prefix="b")

        # Try to purge a block from plain using tool_calls conversation
        result = execute_purge_transaction(
            conv_ids["tool_calls"], ["msg_a_9001"], actor="test", conn=conn,
        )
        assert result.get("error") is not None

        # Block should still exist in plain
        blocks = get_context_blocks_by_public_ids(["msg_a_9001"], conv_ids["plain"], conn=conn)
        assert "msg_a_9001" in blocks

    def test_purge_writes_audit_record(self, migration_fixture_db):
        conn, conv_ids = migration_fixture_db
        _make_tool_chain_fixture(conn, conv_ids["plain"])

        execute_purge_transaction(
            conv_ids["plain"], ["msg_9001"], summary="test summary", actor="model", conn=conn,
        )

        # Check context_mutations table
        rows = conn.execute(
            "SELECT * FROM context_mutations WHERE conversation_id = ? ORDER BY id DESC LIMIT 1",
            (conv_ids["plain"],),
        ).fetchall()
        assert len(rows) == 1
        mutation = dict(rows[0])
        assert mutation["operation"] == "purge"
        assert mutation["actor"] == "model"
        assert mutation["removed_tokens"] >= 0

    def test_purge_closure_is_sequence_ordered(self, migration_fixture_db):
        conn, conv_ids = migration_fixture_db
        _make_tool_chain_fixture(conn, conv_ids["plain"])

        # Purge the user message — closure should return sequence-ordered
        resolved, errors = resolve_purge_dependency_closure(
            ["msg_9001"], conv_ids["plain"], conn=conn
        )
        assert errors == []
        assert resolved == ["msg_9001"]
