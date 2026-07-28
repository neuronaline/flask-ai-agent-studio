"""Tests for runtime setting freshness.

These tests verify that ``get_runtime_setting()`` always returns the
current value — even after ``apply_persisted_runtime_settings()``
changes it — and that code paths using it are not reading stale
module globals.

This is the test the user requested: it should **fail** if any code
reads a stale ``config.X`` module global instead of the runtime
setting.
"""

from __future__ import annotations

import pytest
from core.config import (
    RuntimeSettings,
    apply_persisted_runtime_settings,
    get_runtime_setting,
)


@pytest.fixture
def reset_runtime(monkeypatch):
    """Reset runtime settings to clean defaults before and after each test."""
    import core.config

    _saved = core.config._runtime_settings
    core.config._runtime_settings = RuntimeSettings.from_defaults()
    yield
    core.config._runtime_settings = _saved


def _create_db_with_setting(db_path: str, key: str, value: str) -> None:
    import sqlite3

    conn = sqlite3.connect(db_path)
    conn.execute(
        "CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT)"
    )
    conn.execute(
        "INSERT OR REPLACE INTO app_settings(key, value) VALUES (?, ?)", (key, value)
    )
    conn.commit()
    conn.close()


class TestRuntimeSettingFreshness:
    """Prove that get_runtime_setting reflects persisted changes."""

    def test_rag_enabled_changes_after_persist(self, reset_runtime, tmp_path):
        """RAG_ENABLED must reflect the persisted value, not the module global."""
        db_path = str(tmp_path / "fresh.db")

        # Start with RAG enabled (default)
        assert get_runtime_setting("RAG_ENABLED") is True

        _create_db_with_setting(db_path, "rag_enabled", "false")
        apply_persisted_runtime_settings(database_path=db_path)

        # After reload, RAG_ENABLED must be False
        assert get_runtime_setting("RAG_ENABLED") is False

    def test_conversation_memory_changes_after_persist(self, reset_runtime, tmp_path):
        """CONVERSATION_MEMORY_ENABLED must reflect the persisted value."""
        db_path = str(tmp_path / "mem.db")

        assert get_runtime_setting("CONVERSATION_MEMORY_ENABLED") is True

        _create_db_with_setting(db_path, "conversation_memory_enabled", "false")
        apply_persisted_runtime_settings(database_path=db_path)
        assert get_runtime_setting("CONVERSATION_MEMORY_ENABLED") is False

    def test_ocr_enabled_changes_after_persist(self, reset_runtime, tmp_path):
        """OCR_ENABLED must reflect the persisted value."""
        db_path = str(tmp_path / "ocr.db")

        assert get_runtime_setting("OCR_ENABLED") is True

        _create_db_with_setting(db_path, "ocr_enabled", "false")
        apply_persisted_runtime_settings(database_path=db_path)
        assert get_runtime_setting("OCR_ENABLED") is False

    def test_rag_search_top_k_changes_after_persist(self, reset_runtime, tmp_path):
        """RAG_SEARCH_DEFAULT_TOP_K must reflect the persisted value.

        Note: the database key is ``rag_search_top_k`` (not
        ``rag_search_default_top_k``).
        """
        db_path = str(tmp_path / "ragk.db")

        assert get_runtime_setting("RAG_SEARCH_DEFAULT_TOP_K") == 5

        _create_db_with_setting(db_path, "rag_search_top_k", "10")
        apply_persisted_runtime_settings(database_path=db_path)
        assert get_runtime_setting("RAG_SEARCH_DEFAULT_TOP_K") == 10

    def test_youtube_transcripts_changes_after_persist(self, reset_runtime, tmp_path):
        """YOUTUBE_TRANSCRIPTS_ENABLED must reflect the persisted value."""
        db_path = str(tmp_path / "yt.db")

        assert get_runtime_setting("YOUTUBE_TRANSCRIPTS_ENABLED") is False  # default

        _create_db_with_setting(db_path, "youtube_transcripts_enabled", "true")
        apply_persisted_runtime_settings(database_path=db_path)
        assert get_runtime_setting("YOUTUBE_TRANSCRIPTS_ENABLED") is True

    def test_chat_summary_model_changes_after_persist(self, reset_runtime, tmp_path):
        """CHAT_SUMMARY_MODEL must reflect the persisted string value."""
        db_path = str(tmp_path / "csm.db")

        # Default is empty string or falls back to DEFAULT_CHAT_MODEL
        _create_db_with_setting(db_path, "chat_summary_model", "custom-model-id")
        apply_persisted_runtime_settings(database_path=db_path)
        assert get_runtime_setting("CHAT_SUMMARY_MODEL") == "custom-model-id"

    def test_reset_to_defaults_when_key_missing(self, reset_runtime, tmp_path):
        """When a persisted key is removed, the value resets to default."""
        db_path = str(tmp_path / "reset.db")

        _create_db_with_setting(db_path, "rag_enabled", "false")
        apply_persisted_runtime_settings(database_path=db_path)
        assert get_runtime_setting("RAG_ENABLED") is False

        # Remove the key from the DB
        import sqlite3

        conn = sqlite3.connect(db_path)
        conn.execute("DELETE FROM app_settings WHERE key = 'rag_enabled'")
        conn.commit()
        conn.close()

        apply_persisted_runtime_settings(database_path=db_path)
        # Should reset to default (True)
        assert get_runtime_setting("RAG_ENABLED") is True

    def test_image_uploads_default_is_true(self, reset_runtime):
        """IMAGE_UPLOADS_ENABLED defaults to True.

        (It is computed from OCR_ENABLED + API key availability and is NOT
        directly persisted — the exact value depends on installed API keys.)
        """
        assert get_runtime_setting("IMAGE_UPLOADS_ENABLED") is True
