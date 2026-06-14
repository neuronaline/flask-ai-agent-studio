from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from unittest.mock import Mock, patch

import pytest
import services.rag_service
from core.db import get_app_settings, get_user_profile_entries, save_app_settings
from rag.chunker import Chunk, chunk_text_document
from rag.ingestor import chunks_from_records
from rag.store import _build_metadata_filter_where, query_chunks, upsert_chunks
from services.rag_service import (
    build_rag_auto_context,
    ensure_supported_rag_sources,
    search_knowledge_base_tool,
    sync_conversations_to_rag_background,
)
from routes.chat import maybe_create_conversation_summary


def test_build_metadata_filter_where_defaults_to_and_across_fields_and_or_within_field():
    where = _build_metadata_filter_where(
        {
            "workspace_id": ["conversation:12", "conversation:13"],
            "section_id": ["intro", "details"],
        },
        filter_mode="and",
        base_where={"category": "conversation"},
    )

    assert where == {
        "$and": [
            {"category": "conversation"},
            {
                "$and": [
                    {"$or": [{"workspace_id": "conversation:12"}, {"workspace_id": "conversation:13"}]},
                    {"$or": [{"section_id": "intro"}, {"section_id": "details"}]},
                ]
            },
        ]
    }


def test_build_metadata_filter_where_supports_or_across_fields():
    where = _build_metadata_filter_where(
        {
            "workspace_id": ["conversation:12", "conversation:13"],
            "section_id": ["intro"],
        },
        filter_mode="or",
        base_where={"category": "conversation"},
    )

    assert where == {
        "$and": [
            {"category": "conversation"},
            {
                "$or": [
                    {"$or": [{"workspace_id": "conversation:12"}, {"workspace_id": "conversation:13"}]},
                    {"section_id": "intro"},
                ]
            },
        ]
    }


class TestRagRuntime:
    @pytest.fixture(autouse=True)
    def _setup(self, app, client, create_conversation):
        self.app = app
        self.client = client
        self._create_conversation = create_conversation

    def test_structured_summary_persists_user_profile_facts(self):
        conversation_id = self._create_conversation()
        with self.app.app_context():
            from db import get_db, insert_message

            with get_db() as conn:
                insert_message(
                    conn, conversation_id, "user", "Please keep answers short and concise in future replies."
                )
                insert_message(conn, conversation_id, "assistant", "Understood. I will keep future answers concise.")

        summary_payload = {
            "content": json.dumps(
                {
                    "facts": [
                        "The user prefers concise answers in future replies and wants the assistant to keep responses short unless more detail is explicitly requested.",
                        "The user is actively working on an os-chatbot codebase and expects continuity across iterations so the assistant should preserve implementation context when responding.",
                    ],
                    "decisions": [
                        "Future replies should stay concise while still preserving implementation-critical details and current repository context."
                    ],
                    "open_issues": [
                        "Need to keep tracking codebase-specific preferences across future maintenance tasks."
                    ],
                    "entities": ["os-chatbot"],
                    "tool_outcomes": [
                        "No external tool results were required for this summary; the key persistent preference is concise reply style."
                    ],
                }
            )
        }
        settings = get_app_settings()
        settings.update(
            {
                "chat_summary_mode": "auto",
                "chat_summary_detail_level": "detailed",
                "summary_skip_first": 0,
                "summary_skip_last": 0,
            }
        )

        with patch("routes.chat.collect_agent_response", return_value=summary_payload) as mocked_collect:
            outcome = maybe_create_conversation_summary(
                conversation_id,
                "deepseek-chat",
                settings,
                fetch_url_token_threshold=4_000,
                fetch_url_clip_aggressiveness=0,
                force=True,
                bypass_mode=True,
            )

        assert outcome["applied"]
        prompt_messages = mocked_collect.call_args.args[0]
        prompt_text = "\n".join(str(message.get("content") or "") for message in prompt_messages)
        assert "Write a detailed summary" in prompt_text
        stored_entries = get_user_profile_entries()
        assert any("concise answers" in entry["value"].lower() for entry in stored_entries)
        assert outcome.get("stored_profile_fact_count", 0) >= 1

    def test_query_chunks_skips_expired_metadata(self):
        now_ts = int(datetime.now(timezone.utc).timestamp())
        future_ts = now_ts + 3600
        past_ts = now_ts - 3600

        fake_collection = Mock()
        fake_collection.query.return_value = {
            "documents": [["expired result", "fresh result"]],
            "metadatas": [
                [
                    {
                        "source_key": "expired",
                        "source_type": "tool_result",
                        "category": "tool_result",
                        "expires_at_ts": past_ts,
                    },
                    {
                        "source_key": "fresh",
                        "source_type": "tool_result",
                        "category": "tool_result",
                        "expires_at_ts": future_ts,
                    },
                ]
            ],
            "distances": [[0.1, 0.05]],
            "ids": [["old-id", "fresh-id"]],
        }

        with (
            patch("rag.store._iter_query_collections", return_value=[(fake_collection, {"category": "tool_result"})]),
            patch("rag.store.embed_texts", return_value=[[0.1, 0.2]]),
        ):
            rows = query_chunks("latest result", top_k=5, category="tool_result")

        assert len(rows) == 1
        assert rows[0]["id"] == "fresh-id"
        assert rows[0]["metadata"]["source_key"] == "fresh"

    def test_upsert_chunks_writes_to_category_collections(self):
        collection_conversation = Mock()
        collection_tool_result = Mock()

        chunks = [
            Chunk(
                id="chunk-1",
                text="conversation text",
                source_name="conversation-doc",
                source_type="conversation",
                category="conversation",
                chunk_index=0,
                metadata={"source_key": "src-1"},
            ),
            Chunk(
                id="chunk-2",
                text="tool memory text",
                source_name="tool-memory-doc",
                source_type="tool_result",
                category="tool_result",
                chunk_index=0,
                metadata={"source_key": "src-2"},
            ),
        ]

        def fake_get_collection(name="knowledge_base"):
            if name == "knowledge_base__conversation":
                return collection_conversation
            if name == "knowledge_base__tool_result":
                return collection_tool_result
            return Mock()

        with (
            patch("rag.store.get_collection", side_effect=fake_get_collection),
            patch("rag.store.embed_texts", return_value=[[0.1, 0.2], [0.3, 0.4]]),
        ):
            inserted = upsert_chunks(chunks)

        assert inserted == 2
        collection_conversation.upsert.assert_called_once()
        collection_tool_result.upsert.assert_called_once()

    def test_search_knowledge_base_tool_adds_context_metadata(self):
        fake_hits = [
            {
                "id": "chunk-1",
                "text": "sort docs",
                "metadata": {
                    "source_key": "src-1",
                    "source_name": "doc-1",
                    "source_type": "conversation",
                    "category": "conversation",
                    "chunk_index": 0,
                    "indexed_at_ts": 2_000,
                },
                "similarity": 0.52,
            },
            {
                "id": "chunk-2",
                "text": "sort docs tail",
                "metadata": {
                    "source_key": "src-1",
                    "source_name": "doc-1",
                    "source_type": "conversation",
                    "category": "conversation",
                    "chunk_index": 2,
                    "indexed_at_ts": 2_000,
                },
                "similarity": 0.51,
            },
        ]

        with (
            patch("rag_service.RAG_ENABLED", True),
            patch("rag_service.ensure_supported_rag_sources"),
            patch("rag_service.rag_query_chunks", return_value=fake_hits),
            patch("rag_service.get_db") as mocked_db,
            patch("rag_service.time.time", return_value=2_000),
        ):
            mocked_db.return_value.__enter__.return_value.execute.return_value.fetchall.return_value = [
                {"source_key": "src-1", "chunk_count": 3}
            ]
            result = search_knowledge_base_tool("python sort", top_k=5)

        assert result["matches"][0]["total_chunks"] == 3
        assert result["matches"][0]["has_more_context"]
        assert not result["matches"][1]["has_more_context"]

    def test_search_knowledge_base_tool_uses_query_expansion_and_dedupes_hits(self):
        original_query = "python liste sıralama nasıl yapılır"

        def fake_query(
            query,
            top_k=5,
            category=None,
            source_type_hint=None,
            metadata_filters=None,
            metadata_filter_mode="and",
        ):
            del source_type_hint
            del metadata_filters
            del metadata_filter_mode
            if query == original_query:
                return [
                    {
                        "id": "chunk-1",
                        "text": "sort docs",
                        "metadata": {
                            "source_key": "src-1",
                            "source_name": "doc-1",
                            "source_type": "conversation",
                            "category": "conversation",
                            "chunk_index": 0,
                            "indexed_at_ts": 2_000,
                        },
                        "similarity": 0.40,
                    }
                ]
            return [
                {
                    "id": "chunk-1",
                    "text": "sort docs",
                    "metadata": {
                        "source_key": "src-1",
                        "source_name": "doc-1",
                        "source_type": "conversation",
                        "category": "conversation",
                        "chunk_index": 0,
                        "indexed_at_ts": 2_000,
                    },
                    "similarity": 0.52,
                },
                {
                    "id": "chunk-2",
                    "text": "list order",
                    "metadata": {
                        "source_key": "src-2",
                        "source_name": "doc-2",
                        "source_type": "conversation",
                        "category": "conversation",
                        "chunk_index": 1,
                        "indexed_at_ts": 2_000,
                    },
                    "similarity": 0.45,
                },
            ]

        with (
            patch("rag_service.RAG_ENABLED", True),
            patch("rag_service.ensure_supported_rag_sources"),
            patch("rag_service.rag_query_chunks", side_effect=fake_query) as mocked_query,
            patch("rag_service.time.time", return_value=2_000),
        ):
            result = search_knowledge_base_tool(original_query, top_k=5)

        assert mocked_query.call_count >= 2
        assert result["count"] == 2

    def test_ensure_supported_rag_sources_uses_cooldown(self):
        fake_conn = Mock()
        fake_conn.execute.return_value.fetchall.return_value = []

        with (
            patch("rag_service.RAG_ENABLED", True),
            patch("rag_service._rag_sources_verified", True),
            patch("rag_service._rag_sources_last_verified_at", 100.0),
            patch("rag_service.time.time", return_value=120.0),
            patch(
                "rag_service.get_db",
                return_value=Mock(__enter__=Mock(return_value=fake_conn), __exit__=Mock(return_value=False)),
            ),
            patch("rag_service.get_expired_rag_document_source_keys") as mocked_expired,
        ):
            removed = ensure_supported_rag_sources()

        assert removed == 0
        mocked_expired.assert_called_once()

    def test_chunk_text_document_normalizes_unicode_and_stable_ids(self):
        first = chunk_text_document("Cafe\u0301\u200b", "doc", "conversation", "conversation")
        second = chunk_text_document("Café", "doc", "conversation", "conversation")

        assert first[0].text == "Café"
        assert first[0].id == second[0].id

    def test_chunk_text_document_assigns_page_number_metadata(self):
        text = "## Page 1\n\n" + ("Alpha " * 80) + "\n\n## Page 2\n\n" + ("Beta " * 80)

        chunks = chunk_text_document(text, "doc", "uploaded-document", "general", chunk_size=160, overlap=40)

        page_numbers = [chunk.metadata.get("page_number") for chunk in chunks]
        assert 1 in page_numbers
        assert 2 in page_numbers
        assert page_numbers[0] == 1

    def test_chunk_text_document_assigns_section_metadata(self):
        text = "# Intro\n\nAlpha content\n\n## Details\n\nBeta content"

        chunks = chunk_text_document(text, "doc", "uploaded-document", "general", chunk_size=120, overlap=0)

        section_ids = [str(chunk.metadata.get("section_id") or "") for chunk in chunks]
        section_titles = [str(chunk.metadata.get("section_title") or "") for chunk in chunks]
        assert "intro" in section_ids
        assert "details" in section_ids
        assert "Intro" in section_titles
        assert "Details" in section_titles
        assert all("chunk_id_in_document" in chunk.metadata for chunk in chunks)

    def test_chunks_from_records_skips_short_noise_messages(self):
        chunks = chunks_from_records(
            [
                {"role": "user", "content": "Tamam"},
                {"role": "assistant", "content": "Bu yanıt indekslenmesi gereken kadar uzun ve anlamlıdır."},
            ],
            source_name="conversation:1:Test",
            source_type="conversation",
            category="conversation",
        )

        assert len(chunks) == 1
        assert "Tamam" not in chunks[0].text

    def test_build_rag_auto_context_respects_allowed_source_types(self):
        fake_hits = [
            {
                "id": "upload-disabled",
                "text": "manual memory disabled",
                "metadata": {
                    "source_key": "upload-1",
                    "source_name": "Manual disabled",
                    "source_type": "uploaded_document",
                    "category": "uploaded_document",
                    "chunk_index": 0,
                    "auto_inject_enabled": False,
                },
                "similarity": 0.93,
            },
            {
                "id": "tool-hit",
                "text": "tool memory",
                "metadata": {
                    "source_key": "tool-1",
                    "source_name": "Tool memory",
                    "source_type": "tool_result",
                    "category": "tool_result",
                    "chunk_index": 0,
                },
                "similarity": 0.92,
            },
            {
                "id": "upload-enabled",
                "text": "manual memory enabled",
                "metadata": {
                    "source_key": "upload-2",
                    "source_name": "Manual enabled",
                    "source_type": "uploaded_document",
                    "category": "uploaded_document",
                    "chunk_index": 0,
                    "auto_inject_enabled": True,
                },
                "similarity": 0.91,
            },
        ]

        with (
            patch("rag_service.RAG_ENABLED", True),
            patch("rag_service.ensure_supported_rag_sources"),
            patch("rag_service.rag_query_chunks", return_value=fake_hits),
        ):
            result = build_rag_auto_context(
                "manual memory",
                True,
                threshold=0.1,
                top_k=5,
                allowed_source_types={"uploaded_document"},
            )

        assert result is not None
        assert [match["source_name"] for match in result["matches"]] == ["Manual enabled"]

    def test_build_rag_auto_context_prefers_recent_hits_with_temporal_decay(self):
        old_timestamp = int((datetime.now(timezone.utc) - timedelta(days=60)).timestamp())
        new_timestamp = int(datetime.now(timezone.utc).timestamp())
        fake_hits = [
            {
                "id": "old-hit",
                "text": "older memory",
                "metadata": {
                    "source_key": "old",
                    "source_name": "Old",
                    "source_type": "tool_result",
                    "category": "tool_result",
                    "chunk_index": 0,
                    "indexed_at_ts": old_timestamp,
                },
                "similarity": 0.50,
            },
            {
                "id": "new-hit",
                "text": "newer memory",
                "metadata": {
                    "source_key": "new",
                    "source_name": "New",
                    "source_type": "tool_result",
                    "category": "tool_result",
                    "chunk_index": 0,
                    "indexed_at_ts": new_timestamp,
                },
                "similarity": 0.50,
            },
        ]

        with (
            patch("rag_service.RAG_ENABLED", True),
            patch("rag_service.ensure_supported_rag_sources"),
            patch("rag_service.rag_query_chunks", return_value=fake_hits),
            patch("rag_service.time.time", return_value=new_timestamp),
        ):
            result = build_rag_auto_context("recent memory", True, threshold=0.1, top_k=5)

        assert result is not None
        assert result["matches"][0]["source_name"] == "New"
        assert result["matches"][0]["similarity"] > result["matches"][1]["similarity"]
        assert "id" not in result["matches"][0]
        assert "source_key" not in result["matches"][0]

    def test_build_rag_auto_context_excludes_current_conversation_sources(self):
        fake_hits = [
            {
                "id": "conversation-hit",
                "text": "conversation memory",
                "metadata": {
                    "source_key": "conversation-1",
                    "source_name": "Conversation",
                    "source_type": "conversation",
                    "category": "conversation",
                    "chunk_index": 0,
                },
                "similarity": 0.98,
            },
            {
                "id": "tool-hit",
                "text": "tool memory",
                "metadata": {
                    "source_key": "tool-1",
                    "source_name": "Tool result",
                    "source_type": "tool_result",
                    "category": "tool_result",
                    "chunk_index": 0,
                },
                "similarity": 0.95,
            },
            {
                "id": "archived-hit",
                "text": "archived conversation memory",
                "metadata": {
                    "source_key": "conversation-1-archived",
                    "source_name": "Conversation archive",
                    "source_type": "conversation",
                    "category": "conversation",
                    "chunk_index": 0,
                    "archived_conversation": True,
                    "archived_message_count": 12,
                },
                "similarity": 0.93,
            },
            {
                "id": "other-hit",
                "text": "other memory",
                "metadata": {
                    "source_key": "other-1",
                    "source_name": "Other",
                    "source_type": "tool_result",
                    "category": "tool_result",
                    "chunk_index": 0,
                },
                "similarity": 0.90,
            },
        ]

        with (
            patch("rag_service.RAG_ENABLED", True),
            patch("rag_service.ensure_supported_rag_sources"),
            patch("rag_service.rag_query_chunks", return_value=fake_hits),
        ):
            result = build_rag_auto_context(
                "recent memory",
                True,
                threshold=0.1,
                top_k=5,
                exclude_source_keys={"conversation-1", "tool-1"},
            )

        assert result is not None
        # Archived conversation chunks are now excluded from auto-inject
        # (exclude_archived_conversations=True), so only non-archived
        # non-excluded sources remain.
        assert [match["source_name"] for match in result["matches"]] == ["Other"]

    def test_build_rag_auto_context_limits_chunks_per_source(self):
        fake_hits = [
            {
                "id": "same-1",
                "text": "same source chunk 1",
                "metadata": {
                    "source_key": "same",
                    "source_name": "Same Source",
                    "source_type": "uploaded_document",
                    "category": "uploaded_document",
                    "chunk_index": 0,
                    "auto_inject_enabled": True,
                },
                "similarity": 0.99,
            },
            {
                "id": "same-2",
                "text": "same source chunk 2",
                "metadata": {
                    "source_key": "same",
                    "source_name": "Same Source",
                    "source_type": "uploaded_document",
                    "category": "uploaded_document",
                    "chunk_index": 1,
                    "auto_inject_enabled": True,
                },
                "similarity": 0.98,
            },
            {
                "id": "same-3",
                "text": "same source chunk 3",
                "metadata": {
                    "source_key": "same",
                    "source_name": "Same Source",
                    "source_type": "uploaded_document",
                    "category": "uploaded_document",
                    "chunk_index": 2,
                    "auto_inject_enabled": True,
                },
                "similarity": 0.97,
            },
            {
                "id": "other-1",
                "text": "other source chunk",
                "metadata": {
                    "source_key": "other",
                    "source_name": "Other Source",
                    "source_type": "uploaded_document",
                    "category": "uploaded_document",
                    "chunk_index": 0,
                    "auto_inject_enabled": True,
                },
                "similarity": 0.96,
            },
        ]

        with (
            patch("rag_service.RAG_ENABLED", True),
            patch("rag_service.ensure_supported_rag_sources"),
            patch("rag_service.rag_query_chunks", return_value=fake_hits),
            patch(
                "rag_service.RAG_MAX_CHUNKS_PER_SOURCE",
                2,
            ),
        ):
            result = build_rag_auto_context("memory", True, threshold=0.1, top_k=4)

        assert result is not None
        assert [match["source_name"] for match in result["matches"]] == ["Same Source", "Same Source", "Other Source"]

    def test_build_rag_auto_context_overfetches_candidates_for_source_diversity(self):
        with (
            patch("rag_service.RAG_ENABLED", True),
            patch("rag_service.ensure_supported_rag_sources"),
            patch("rag_service.rag_query_chunks", return_value=[]) as mocked_query,
            patch(
                "rag_service.RAG_MAX_CHUNKS_PER_SOURCE",
                2,
            ),
        ):
            build_rag_auto_context("memory", True, threshold=0.1, top_k=3)

        assert mocked_query.call_count >= 1
        assert mocked_query.call_args.kwargs["top_k"] == 6

    def test_search_knowledge_base_tool_stops_query_expansion_after_sufficient_first_variant_hits(self):
        first_variant_hits = [
            {
                "id": f"hit-{index}",
                "text": f"hit {index}",
                "metadata": {
                    "source_key": f"source-{index}",
                    "source_name": f"Source {index}",
                    "source_type": "uploaded_document",
                    "category": "uploaded_document",
                    "chunk_index": 0,
                },
                "similarity": 0.9 - (index * 0.01),
            }
            for index in range(4)
        ]

        with (
            patch("rag_service.RAG_ENABLED", True),
            patch("rag_service.ensure_supported_rag_sources"),
            patch(
                "rag_service._expand_query_variants",
                return_value=["memory", "memory variant"],
            ),
            patch(
                "rag_service.rag_query_chunks",
                side_effect=[first_variant_hits, RuntimeError("Second variant should not run")],
            ) as mocked_query,
            patch("rag_service.RAG_MAX_CHUNKS_PER_SOURCE", 2),
        ):
            result = search_knowledge_base_tool("memory", top_k=2)

        assert mocked_query.call_count == 1
        assert result["count"] == 2

    def test_rag_search_route_uses_saved_source_type_settings(self):
        settings = get_app_settings()
        settings["rag_source_types"] = json.dumps(["uploaded_document"], ensure_ascii=False)
        save_app_settings(settings)

        with patch(
            "routes.conversations.search_knowledge_base_tool",
            return_value={"query": "memory", "count": 0, "matches": []},
        ) as mocked_search:
            response = self.client.get("/api/rag/search?q=memory")

        assert response.status_code == 200
        assert mocked_search.call_args.kwargs["allowed_source_types"] == ["uploaded_document"]

        with patch(
            "routes.conversations.search_knowledge_base_tool",
            return_value={"query": "memory", "count": 0, "matches": []},
        ) as mocked_search:
            response = self.client.get("/api/rag/search?q=memory&source_types=conversation,tool_result")

        assert response.status_code == 200
        assert mocked_search.call_args.kwargs["allowed_source_types"] == ["conversation", "tool_result"]

        with patch(
            "routes.conversations.search_knowledge_base_tool",
            return_value={"query": "memory", "count": 0, "matches": []},
        ) as mocked_search:
            response = self.client.get("/api/rag/search?q=memory&source_type=conversation,tool_result")

        assert response.status_code == 200
        assert mocked_search.call_args.kwargs["allowed_source_types"] == ["conversation", "tool_result"]

    def test_rag_search_route_passes_min_similarity(self):
        with patch(
            "routes.conversations.search_knowledge_base_tool",
            return_value={"query": "memory", "count": 0, "matches": []},
        ) as mocked_search:
            response = self.client.get("/api/rag/search?q=memory&min_similarity=0.75")

        assert response.status_code == 200
        assert mocked_search.call_args.kwargs["min_similarity"] == 0.75

    def test_rag_search_route_passes_hierarchical_metadata_filters(self):
        with patch(
            "routes.conversations.search_knowledge_base_tool",
            return_value={"query": "memory", "count": 0, "matches": []},
        ) as mocked_search:
            response = self.client.get(
                "/api/rag/search?q=memory&workspace_id=conversation:12&project_id=chat-history&document_path=conversations/12&section_id=intro"
            )

        assert response.status_code == 200
        assert mocked_search.call_args.kwargs["metadata_filters"] == {
            "workspace_id": ["conversation:12"],
            "project_id": ["chat-history"],
            "document_path": ["conversations/12"],
            "section_id": ["intro"],
        }
        assert mocked_search.call_args.kwargs["metadata_filter_mode"] == "and"

    def test_rag_search_route_passes_multi_value_filters_with_or_mode(self):
        with patch(
            "routes.conversations.search_knowledge_base_tool",
            return_value={"query": "memory", "count": 0, "matches": []},
        ) as mocked_search:
            response = self.client.get(
                "/api/rag/search?q=memory&workspace_id=conversation:12&workspace_id=conversation:13&section_id=intro,details&metadata_filter_mode=or"
            )

        assert response.status_code == 200
        assert mocked_search.call_args.kwargs["metadata_filters"] == {
            "workspace_id": ["conversation:12", "conversation:13"],
            "section_id": ["intro", "details"],
        }
        assert mocked_search.call_args.kwargs["metadata_filter_mode"] == "or"

    @pytest.mark.parametrize(
        ("query_string", "error_fragment"),
        [
            ("metadata_filter_mode=xor", "metadata_filter_mode"),
            ("min_similarity=abc", "min_similarity"),
            ("min_similarity=-0.1", "min_similarity"),
            ("min_similarity=1.1", "min_similarity"),
        ],
    )
    def test_rag_search_route_rejects_invalid_params(self, query_string, error_fragment):
        response = self.client.get(f"/api/rag/search?q=memory&{query_string}")

        assert response.status_code == 400
        assert error_fragment in response.get_json()["error"]
