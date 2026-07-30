"""Tests for the context_blocks backfill migration and repository functions.

Uses the migration fixture database defined in conftest.py.
"""

from __future__ import annotations

import json

import pytest

try:
    from core.db import (
        backfill_context_blocks,
        backfill_all_conversations,
        count_context_blocks,
        list_context_blocks,
        get_context_block_by_public_id,
        get_context_blocks_by_public_ids,
        get_context_blocks_token_total,
        delete_context_blocks,
        delete_all_context_blocks,
        insert_context_mutation,
        allocate_context_block_sequence,
        insert_context_block,
    )
    HAS_DB = True
except ImportError:
    HAS_DB = False

pytestmark = pytest.mark.skipif(not HAS_DB, reason="core.db not importable")


class TestBackfillPlainConversation:
    """Backfill a conversation with plain user/assistant messages."""

    def test_backfill_creates_blocks(self, migration_fixture_db):
        conn, conv_ids = migration_fixture_db
        result = backfill_context_blocks(conv_ids["plain"], conn=conn)
        assert result["blocks_created"] == 4  # user, assistant, user, assistant
        assert result["errors"] == []

    def test_backfill_is_idempotent(self, migration_fixture_db):
        conn, conv_ids = migration_fixture_db
        # First backfill
        r1 = backfill_context_blocks(conv_ids["plain"], conn=conn)
        # Second backfill should be a no-op
        r2 = backfill_context_blocks(conv_ids["plain"], conn=conn)
        assert r2["blocks_created"] == 0

    def test_backfill_creates_correct_public_ids(self, migration_fixture_db):
        conn, conv_ids = migration_fixture_db
        backfill_context_blocks(conv_ids["plain"], conn=conn)
        blocks = list_context_blocks(conv_ids["plain"], conn=conn)
        assert len(blocks) == 4
        for block in blocks:
            assert block["public_id"].startswith("msg_")
            assert block["conversation_id"] == conv_ids["plain"]

    def test_backfill_preserves_content(self, migration_fixture_db):
        conn, conv_ids = migration_fixture_db
        backfill_context_blocks(conv_ids["plain"], conn=conn)
        blocks = list_context_blocks(conv_ids["plain"], conn=conn)
        # First message should be the user's greeting
        user_blocks = [b for b in blocks if b["api_role"] == "user"]
        assert len(user_blocks) == 2
        assert "Hello" in user_blocks[0]["content"]


class TestBackfillToolCallConversation:
    """Backfill a conversation with parallel tool calls and results."""

    def test_backfill_creates_tool_call_blocks(self, migration_fixture_db):
        conn, conv_ids = migration_fixture_db
        result = backfill_context_blocks(conv_ids["tool_calls"], conn=conn)
        assert result["blocks_created"] > 0

    def test_tool_calls_get_individual_blocks(self, migration_fixture_db):
        conn, conv_ids = migration_fixture_db
        backfill_context_blocks(conv_ids["tool_calls"], conn=conn)
        blocks = list_context_blocks(conv_ids["tool_calls"], conn=conn)
        tool_call_blocks = [b for b in blocks if b["kind"] == "tool_call"]
        # Should have 2 tool_call blocks (one per parallel call)
        assert len(tool_call_blocks) == 2

    def test_tool_results_have_parent_links(self, migration_fixture_db):
        conn, conv_ids = migration_fixture_db
        backfill_context_blocks(conv_ids["tool_calls"], conn=conn)
        blocks = list_context_blocks(conv_ids["tool_calls"], conn=conn)
        tool_result_blocks = [b for b in blocks if b["kind"] == "tool_result"]
        assert len(tool_result_blocks) == 2
        for tr_block in tool_result_blocks:
            assert tr_block["parent_public_id"] is not None
            # parent should be a tool_call block
            assert tr_block["parent_public_id"].startswith("tool_call_")

    def test_tool_result_provider_call_id_preserved(self, migration_fixture_db):
        conn, conv_ids = migration_fixture_db
        backfill_context_blocks(conv_ids["tool_calls"], conn=conn)
        blocks = list_context_blocks(conv_ids["tool_calls"], conn=conn)
        tool_result_blocks = [b for b in blocks if b["kind"] == "tool_result"]
        call_ids = {b["provider_call_id"] for b in tool_result_blocks}
        assert call_ids == {"call_aaa", "call_bbb"}


class TestBackfillSummaryConversation:
    """Backfill a conversation with legacy summary messages."""

    def test_summary_blocks_created(self, migration_fixture_db):
        conn, conv_ids = migration_fixture_db
        result = backfill_context_blocks(conv_ids["summary"], conn=conn)
        assert result["blocks_created"] > 0

    def test_summary_has_summary_kind(self, migration_fixture_db):
        conn, conv_ids = migration_fixture_db
        backfill_context_blocks(conv_ids["summary"], conn=conn)
        blocks = list_context_blocks(conv_ids["summary"], conn=conn)
        summary_blocks = [b for b in blocks if b["kind"] == "summary"]
        assert len(summary_blocks) == 1
        assert summary_blocks[0]["api_role"] == "assistant"

    def test_summary_content_preserved(self, migration_fixture_db):
        conn, conv_ids = migration_fixture_db
        backfill_context_blocks(conv_ids["summary"], conn=conn)
        blocks = list_context_blocks(conv_ids["summary"], conn=conn)
        summary_blocks = [b for b in blocks if b["kind"] == "summary"]
        assert "Summary of the AI essay discussion" in summary_blocks[0]["content"]


class TestBackfillAllConversations:
    """Test the batch backfill_all_conversations function."""

    def test_backfills_all(self, migration_fixture_db):
        conn, conv_ids = migration_fixture_db
        result = backfill_all_conversations(conn=conn)
        assert result["conversations_processed"] == 5
        assert result["total_blocks_created"] > 0

    def test_backfill_is_idempotent_globally(self, migration_fixture_db):
        conn, conv_ids = migration_fixture_db
        r1 = backfill_all_conversations(conn=conn)
        r2 = backfill_all_conversations(conn=conn)
        # Second run should create 0 new blocks
        assert r2["total_blocks_created"] == 0


class TestRepositoryFunctions:
    """Test the individual repository operations."""

    def test_allocate_sequence_starts_at_1(self, migration_fixture_db):
        conn, conv_ids = migration_fixture_db
        seq = allocate_context_block_sequence(conv_ids["plain"], conn=conn)
        assert seq >= 1

    def test_insert_and_get_block(self, migration_fixture_db):
        conn, conv_ids = migration_fixture_db
        seq = allocate_context_block_sequence(conv_ids["plain"], conn=conn)
        block = insert_context_block(
            public_id="test_msg_999", conversation_id=conv_ids["plain"],
            sequence=seq, kind="message", api_role="user",
            content="Test content", token_estimate=10, conn=conn,
        )
        assert block["public_id"] == "test_msg_999"

        # Retrieve by public ID
        found = get_context_block_by_public_id("test_msg_999", conv_ids["plain"], conn=conn)
        assert found is not None
        assert found["content"] == "Test content"

    def test_get_blocks_by_public_ids(self, migration_fixture_db):
        conn, conv_ids = migration_fixture_db
        backfill_context_blocks(conv_ids["plain"], conn=conn)
        blocks = list_context_blocks(conv_ids["plain"], conn=conn)
        pids = [b["public_id"] for b in blocks[:2]]
        result = get_context_blocks_by_public_ids(pids, conv_ids["plain"], conn=conn)
        assert len(result) == 2
        for pid in pids:
            assert pid in result

    def test_delete_blocks(self, migration_fixture_db):
        conn, conv_ids = migration_fixture_db
        # Insert a block then delete it
        seq = allocate_context_block_sequence(conv_ids["plain"], conn=conn)
        insert_context_block(
            public_id="to_delete_1", conversation_id=conv_ids["plain"],
            sequence=seq, kind="message", api_role="user",
            content="Will be deleted", conn=conn,
        )
        count_before = count_context_blocks(conv_ids["plain"], conn=conn)
        deleted = delete_context_blocks(["to_delete_1"], conv_ids["plain"], conn=conn)
        assert deleted == 1
        count_after = count_context_blocks(conv_ids["plain"], conn=conn)
        assert count_after == count_before - 1

    def test_delete_all_blocks(self, migration_fixture_db):
        conn, conv_ids = migration_fixture_db
        seq = allocate_context_block_sequence(conv_ids["plain"], conn=conn)
        insert_context_block(
            public_id="temp_1", conversation_id=conv_ids["plain"],
            sequence=seq, kind="message", api_role="user",
            content="Temp", conn=conn,
        )
        deleted = delete_all_context_blocks(conv_ids["plain"], conn=conn)
        assert deleted >= 1
        remaining = count_context_blocks(conv_ids["plain"], conn=conn)
        assert remaining == 0

    def test_insert_mutation(self, migration_fixture_db):
        conn, conv_ids = migration_fixture_db
        mutation_id = insert_context_mutation(
            conversation_id=conv_ids["plain"],
            operation="purge",
            requested_ids=["msg_1", "msg_2"],
            resolved_ids=["msg_1", "msg_2"],
            removed_tokens=100,
            actor="test",
            conn=conn,
        )
        assert mutation_id > 0

    def test_token_total(self, migration_fixture_db):
        conn, conv_ids = migration_fixture_db
        backfill_context_blocks(conv_ids["plain"], conn=conn)
        total = get_context_blocks_token_total(conv_ids["plain"], conn=conn)
        assert total >= 0

    def test_cross_conversation_isolation(self, migration_fixture_db):
        conn, conv_ids = migration_fixture_db
        backfill_context_blocks(conv_ids["plain"], conn=conn)
        # Blocks from conv 1 should not appear in conv 2's listing
        blocks_c2 = list_context_blocks(conv_ids["tool_calls"], conn=conn)
        for block in blocks_c2:
            assert block["conversation_id"] == conv_ids["tool_calls"]

    def test_monotonically_increasing_sequences(self, migration_fixture_db):
        conn, conv_ids = migration_fixture_db
        backfill_context_blocks(conv_ids["tool_calls"], conn=conn)
        blocks = list_context_blocks(conv_ids["tool_calls"], conn=conn)
        sequences = [b["sequence"] for b in blocks]
        assert sequences == sorted(sequences)
        # Should be monotonically increasing
        for i in range(1, len(sequences)):
            assert sequences[i] > sequences[i - 1]
