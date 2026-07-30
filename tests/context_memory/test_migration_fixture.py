"""Tests verifying the migration fixture database integrity."""

from __future__ import annotations

import json

import pytest

pytestmark = pytest.mark.usefixtures("migration_fixture_db")


class TestMigrationFixtureIntegrity:
    """Verify the fixture DB is well-formed and complete."""

    def test_all_conversations_present(self, migration_fixture_db):
        conn, conv_ids = migration_fixture_db
        row = conn.execute("SELECT COUNT(*) as cnt FROM conversations").fetchone()
        assert row["cnt"] == 5

    def test_plain_conversation_messages(self, migration_fixture_db):
        conn, conv_ids = migration_fixture_db
        rows = conn.execute(
            "SELECT * FROM messages WHERE conversation_id = ? ORDER BY position",
            (conv_ids["plain"],)
        ).fetchall()
        assert len(rows) == 4
        assert rows[0]["role"] == "user"
        assert rows[1]["role"] == "assistant"

    def test_tool_call_conversation_has_tool_calls(self, migration_fixture_db):
        conn, conv_ids = migration_fixture_db
        rows = conn.execute(
            "SELECT * FROM messages WHERE conversation_id = ? ORDER BY position",
            (conv_ids["tool_calls"],)
        ).fetchall()
        assert len(rows) == 5

        # Assistant message should have tool_calls JSON
        assistant = [r for r in rows if r["role"] == "assistant" and r["tool_calls"]][0]
        tool_calls = json.loads(assistant["tool_calls"])
        assert len(tool_calls) == 2
        assert tool_calls[0]["function"]["name"] == "search_web"

        # Tool result messages should have tool_call_id
        tools = [r for r in rows if r["role"] == "tool"]
        assert len(tools) == 2
        assert tools[0]["tool_call_id"] in ("call_aaa", "call_bbb")

    def test_summary_conversation_has_summary_role(self, migration_fixture_db):
        conn, conv_ids = migration_fixture_db
        rows = conn.execute(
            "SELECT * FROM messages WHERE conversation_id = ? ORDER BY position",
            (conv_ids["summary"],)
        ).fetchall()
        assert len(rows) == 5
        summaries = [r for r in rows if r["role"] == "summary"]
        assert len(summaries) == 1

    def test_canvas_conversation_has_canvas_metadata(self, migration_fixture_db):
        conn, conv_ids = migration_fixture_db
        rows = conn.execute(
            "SELECT * FROM messages WHERE conversation_id = ? ORDER BY position",
            (conv_ids["canvas"],)
        ).fetchall()
        # First user message should have canvas_documents in metadata
        first_user = rows[0]
        metadata = json.loads(first_user["metadata"])
        assert "canvas_documents" in metadata
        assert metadata["canvas_documents"][0]["name"] == "notes.md"

        # Third message should have context_injection
        third = rows[2]
        metadata = json.loads(third["metadata"])
        assert "context_injection" in metadata

    def test_rag_conversation_has_rag_document(self, migration_fixture_db):
        conn, conv_ids = migration_fixture_db
        row = conn.execute(
            "SELECT * FROM rag_documents WHERE source_key = 'rag_test_source'"
        ).fetchone()
        assert row is not None
        assert row["source_type"] == "uploaded_document"

    def test_context_blocks_table_exists(self, migration_fixture_db):
        conn, conv_ids = migration_fixture_db
        # Should be empty but queryable
        rows = conn.execute("SELECT COUNT(*) as cnt FROM context_blocks").fetchone()
        assert rows["cnt"] == 0

    def test_context_mutations_table_exists(self, migration_fixture_db):
        conn, conv_ids = migration_fixture_db
        rows = conn.execute("SELECT COUNT(*) as cnt FROM context_mutations").fetchone()
        assert rows["cnt"] == 0
