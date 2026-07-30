"""Test fixtures for context memory migration tests.

Provides a factory that creates an in-memory SQLite database mirroring the
current production schema plus the new context_blocks / context_mutations
tables, pre-populated with representative test data.
"""

from __future__ import annotations

import json
import os
import sqlite3
import tempfile
from pathlib import Path

import pytest


# ---------------------------------------------------------------------------
# Schema DDL — mirrors the production init_db() plus Phase 1 tables
# ---------------------------------------------------------------------------

_BASE_SCHEMA = """
CREATE TABLE IF NOT EXISTS conversations (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    title             TEXT NOT NULL DEFAULT 'Untitled',
    title_source      TEXT NOT NULL DEFAULT 'auto',
    title_overridden  INTEGER NOT NULL DEFAULT 0,
    tool_overrides    TEXT DEFAULT NULL,
    parameter_overrides TEXT DEFAULT NULL,
    model             TEXT NOT NULL DEFAULT 'deepseek-chat',
    persona_id        INTEGER REFERENCES personas(id) ON DELETE SET NULL,
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS messages (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id   INTEGER NOT NULL,
    position          INTEGER,
    role              TEXT NOT NULL,
    content           TEXT NOT NULL,
    metadata          TEXT,
    tool_calls        TEXT,
    tool_call_id      TEXT,
    prompt_tokens     INTEGER,
    completion_tokens INTEGER,
    total_tokens      INTEGER,
    deleted_at        TEXT,
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS personas (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    name                 TEXT NOT NULL,
    general_instructions TEXT NOT NULL DEFAULT '',
    ai_personality       TEXT NOT NULL DEFAULT '',
    created_at           TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS context_nodes (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    node_id           TEXT NOT NULL UNIQUE,
    tool_name         TEXT NOT NULL,
    args_preview      TEXT NOT NULL DEFAULT '',
    result_preview    TEXT NOT NULL DEFAULT '',
    full_content      TEXT,
    token_count       INTEGER NOT NULL DEFAULT 0,
    summary           TEXT NOT NULL DEFAULT '',
    compressed        INTEGER NOT NULL DEFAULT 0,
    status            TEXT NOT NULL DEFAULT 'active',
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    archived_at       TEXT,
    deleted_at        TEXT,
    deletion_reason   TEXT,
    archived_reason   TEXT,
    conversation_id   INTEGER NOT NULL,
    message_id        INTEGER,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS rag_documents (
    source_key  TEXT PRIMARY KEY,
    source_name TEXT NOT NULL,
    source_type TEXT NOT NULL,
    category    TEXT NOT NULL DEFAULT 'general',
    chunk_count INTEGER NOT NULL DEFAULT 0,
    metadata    TEXT,
    expires_at  TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS conversation_memory (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL,
    message_id      INTEGER,
    entry_type      TEXT NOT NULL,
    key             TEXT NOT NULL,
    value           TEXT NOT NULL,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
    FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE SET NULL
);

-- Phase 1 tables (for forward compatibility during migration testing)

CREATE TABLE IF NOT EXISTS context_blocks (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    public_id           TEXT NOT NULL UNIQUE,
    conversation_id     INTEGER NOT NULL,
    sequence            INTEGER NOT NULL,
    kind                TEXT NOT NULL,
    api_role            TEXT NOT NULL,
    source_message_id   INTEGER,
    parent_public_id    TEXT,
    provider_call_id    TEXT,
    tool_name           TEXT,
    content             TEXT NOT NULL DEFAULT '',
    tool_calls_json     TEXT,
    metadata_json       TEXT,
    token_estimate      INTEGER NOT NULL DEFAULT 0,
    created_at          TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
    FOREIGN KEY (source_message_id) REFERENCES messages(id) ON DELETE SET NULL,
    UNIQUE (conversation_id, sequence)
);

CREATE INDEX IF NOT EXISTS idx_context_blocks_active_order
    ON context_blocks(conversation_id, sequence, id);

CREATE TABLE IF NOT EXISTS context_mutations (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id     INTEGER NOT NULL,
    operation            TEXT NOT NULL,
    requested_ids_json  TEXT NOT NULL,
    resolved_ids_json   TEXT NOT NULL,
    removed_tokens      INTEGER NOT NULL DEFAULT 0,
    replacement_id      TEXT,
    content_hashes_json TEXT NOT NULL DEFAULT '[]',
    actor               TEXT NOT NULL,
    created_at          TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);
"""


# ---------------------------------------------------------------------------
# Fixture data — conversations with representative message patterns
# ---------------------------------------------------------------------------

def _populate_conversation_plain(conn: sqlite3.Connection) -> int:
    """A conversation with plain user/assistant messages only."""
    conn.execute("INSERT INTO conversations (id, title, model) VALUES (1, 'Plain Chat', 'deepseek-chat')")
    messages = [
        (1, 1, 'user', 'Hello, how are you?', '{}', None, None),
        (1, 2, 'assistant', 'I am doing well, thank you!', '{}', None, None),
        (1, 3, 'user', 'Tell me about Python.', '{}', None, None),
        (1, 4, 'assistant', 'Python is a programming language...', '{}', None, None),
    ]
    for conv_id, pos, role, content, metadata, tool_calls, tool_call_id in messages:
        conn.execute(
            "INSERT INTO messages (conversation_id, position, role, content, metadata, tool_calls, tool_call_id) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (conv_id, pos, role, content, metadata, tool_calls, tool_call_id),
        )
    return 1


def _populate_conversation_tool_calls(conn: sqlite3.Connection) -> int:
    """A conversation with multiple parallel tool calls and results."""
    conn.execute("INSERT INTO conversations (id, title, model) VALUES (2, 'Tool Call Chat', 'deepseek-chat')")

    # User message
    conn.execute(
        "INSERT INTO messages (id, conversation_id, position, role, content, metadata) "
        "VALUES (10, 2, 1, 'user', 'Search for Python and JavaScript', '{}')"
    )

    # Assistant with tool calls (parallel search_web calls)
    tool_calls_json = json.dumps([
        {"id": "call_aaa", "type": "function", "function": {"name": "search_web", "arguments": '{"query":"Python"}'}},
        {"id": "call_bbb", "type": "function", "function": {"name": "search_web", "arguments": '{"query":"JavaScript"}'}},
    ])
    conn.execute(
        "INSERT INTO messages (id, conversation_id, position, role, content, tool_calls) "
        "VALUES (11, 2, 2, 'assistant', 'Let me search for both.', ?)",
        (tool_calls_json,)
    )

    # Tool results (tool name inferred from preceding assistant tool_calls)
    conn.execute(
        "INSERT INTO messages (id, conversation_id, position, role, content, tool_call_id) "
        "VALUES (12, 2, 3, 'tool', 'Python search results here...', 'call_aaa')"
    )
    conn.execute(
        "INSERT INTO messages (id, conversation_id, position, role, content, tool_call_id) "
        "VALUES (13, 2, 4, 'tool', 'JavaScript search results here...', 'call_bbb')"
    )

    # Final assistant response
    conn.execute(
        "INSERT INTO messages (id, conversation_id, position, role, content, metadata) "
        "VALUES (14, 2, 5, 'assistant', 'Here are the results for both searches.', '{}')"
    )
    return 2


def _populate_conversation_with_summary(conn: sqlite3.Connection) -> int:
    """A conversation with legacy summary messages."""
    conn.execute("INSERT INTO conversations (id, title, model) VALUES (3, 'Summary Chat', 'deepseek-chat')")
    messages = [
        (3, 1, 'user', 'Write a long essay about AI.', '{}', None, None),
        (3, 2, 'assistant', 'AI is a broad field... (long essay)', '{}', None, None),
        (3, 3, 'summary', 'Summary of the AI essay discussion.', '{"summary": true, "type": "auto"}', None, None),
        (3, 4, 'user', 'Now tell me about ML specifically.', '{}', None, None),
        (3, 5, 'assistant', 'ML is a subset of AI...', '{}', None, None),
    ]
    for conv_id, pos, role, content, metadata, tool_calls, tool_call_id in messages:
        conn.execute(
            "INSERT INTO messages (conversation_id, position, role, content, metadata, tool_calls, tool_call_id) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (conv_id, pos, role, content, metadata, tool_calls, tool_call_id),
        )
    return 3


def _populate_conversation_with_canvas(conn: sqlite3.Connection) -> int:
    """A conversation with Canvas document operations."""
    conn.execute("INSERT INTO conversations (id, title, model) VALUES (4, 'Canvas Chat', 'deepseek-chat')")

    # User creates a canvas document
    metadata_canvas = json.dumps({
        "canvas_documents": [
            {"name": "notes.md", "language": "markdown", "content": "# Project Notes\n\n- Item 1\n- Item 2"}
        ]
    })
    conn.execute(
        "INSERT INTO messages (id, conversation_id, position, role, content, metadata) "
        "VALUES (20, 4, 1, 'user', 'Create a notes document.', ?)",
        (metadata_canvas,)
    )

    # Assistant acknowledges
    conn.execute(
        "INSERT INTO messages (id, conversation_id, position, role, content, metadata) "
        "VALUES (21, 4, 2, 'assistant', 'Created notes.md for you.', '{}')"
    )

    # User with canvas context injection
    metadata_with_injection = json.dumps({
        "canvas_documents": [
            {"name": "notes.md", "language": "markdown", "content": "# Project Notes\n\n- Item 1\n- Item 2"}
        ],
        "context_injection": "[CANVAS WORKSPACE]\nActive document: notes.md\nLines: 5"
    })
    conn.execute(
        "INSERT INTO messages (id, conversation_id, position, role, content, metadata) "
        "VALUES (22, 4, 3, 'user', 'Add item 3 to the notes.', ?)",
        (metadata_with_injection,)
    )
    return 4


def _populate_conversation_with_rag(conn: sqlite3.Connection) -> int:
    """A conversation with RAG-linked tool results."""
    conn.execute("INSERT INTO conversations (id, title, model) VALUES (5, 'RAG Chat', 'deepseek-chat')")

    # RAG document record
    conn.execute(
        "INSERT INTO rag_documents (source_key, source_name, source_type, category, chunk_count) "
        "VALUES ('rag_test_source', 'test_doc.txt', 'uploaded_document', 'general', 3)"
    )

    # User uploads a document
    conn.execute(
        "INSERT INTO messages (id, conversation_id, position, role, content, metadata) "
        "VALUES (30, 5, 1, 'user', 'I have uploaded test_doc.txt.', '{}')"
    )

    # Assistant with search_knowledge_base tool call
    tool_calls_json = json.dumps([
        {"id": "call_rag", "type": "function", "function": {"name": "search_knowledge_base", "arguments": '{"query":"test content"}'}},
    ])
    conn.execute(
        "INSERT INTO messages (id, conversation_id, position, role, content, tool_calls) "
        "VALUES (31, 5, 2, 'assistant', '', ?)",
        (tool_calls_json,)
    )

    # Tool result with RAG source metadata
    rag_metadata = json.dumps({
        "rag_source": "rag_test_source",
        "rag_chunks": ["chunk_0", "chunk_1"],
    })
    conn.execute(
        "INSERT INTO messages (id, conversation_id, position, role, content, tool_call_id, metadata) "
        "VALUES (32, 5, 3, 'tool', 'Found relevant content in the knowledge base.', 'call_rag', ?)",
        (rag_metadata,)
    )

    # Final assistant response
    conn.execute(
        "INSERT INTO messages (id, conversation_id, position, role, content, metadata) "
        "VALUES (33, 5, 4, 'assistant', 'Based on the document, here is what I found...', '{}')"
    )
    return 5


# ---------------------------------------------------------------------------
# Fixture factory
# ---------------------------------------------------------------------------

@pytest.fixture
def migration_fixture_db():
    """Create an in-memory DB with representative test conversations.

    Returns (connection, dict_of_conversation_ids) so tests can inspect
    the data and verify migration correctness.
    """
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.executescript(_BASE_SCHEMA)

    conv_ids = {}
    conv_ids["plain"] = _populate_conversation_plain(conn)
    conv_ids["tool_calls"] = _populate_conversation_tool_calls(conn)
    conv_ids["summary"] = _populate_conversation_with_summary(conn)
    conv_ids["canvas"] = _populate_conversation_with_canvas(conn)
    conv_ids["rag"] = _populate_conversation_with_rag(conn)

    conn.commit()
    return conn, conv_ids


@pytest.fixture
def migration_fixture_path(tmp_path):
    """Create a file-based DB fixture for tests that need persistent storage."""
    db_path = tmp_path / "migration_fixture.db"
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.executescript(_BASE_SCHEMA)

    conv_ids = {}
    conv_ids["plain"] = _populate_conversation_plain(conn)
    conv_ids["tool_calls"] = _populate_conversation_tool_calls(conn)
    conv_ids["summary"] = _populate_conversation_with_summary(conn)
    conv_ids["canvas"] = _populate_conversation_with_canvas(conn)
    conv_ids["rag"] = _populate_conversation_with_rag(conn)

    conn.commit()
    conn.close()
    return str(db_path), conv_ids
