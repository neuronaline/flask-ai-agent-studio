"""Tests for the ContextPlan assembly pipeline (Phase 2)."""

from __future__ import annotations

import pytest

try:
    from services.context_assembly import (
        build_tier1_system_message,
        build_tier2_messages,
        build_tier3_footer,
        assemble_context_plan,
        build_full_api_messages,
    )
    from core.context_memory import ContextPlan, ContextTokenUsage
    HAS_ASSEMBLY = True
except ImportError:
    HAS_ASSEMBLY = False

pytestmark = pytest.mark.skipif(not HAS_ASSEMBLY, reason="services.context_assembly not importable")


class TestTier1SystemMessage:
    """Tier 1 is a single, immutable system message."""

    def test_returns_single_dict(self):
        msg = build_tier1_system_message()
        assert isinstance(msg, dict)
        assert msg["role"] == "system"
        assert isinstance(msg["content"], str)
        assert len(msg["content"]) > 0

    def test_byte_stable_across_calls(self):
        """Tier 1 must be byte-identical across calls with same inputs."""
        msg1 = build_tier1_system_message()
        msg2 = build_tier1_system_message()
        assert msg1["content"] == msg2["content"]

    def test_includes_user_preferences(self):
        msg = build_tier1_system_message(user_preferences="Use Python 3.12")
        assert "Python 3.12" in msg["content"]

    def test_includes_persona_instructions(self):
        msg = build_tier1_system_message(persona_instructions="Be concise.")
        assert "Be concise." in msg["content"]


class TestTier2Messages:
    """Tier 2 renders all active context_blocks in sequence order."""

    def test_empty_conversation_returns_empty(self, migration_fixture_db):
        conn, conv_ids = migration_fixture_db
        msgs, blocks, usage = build_tier2_messages(conv_ids["plain"], conn=conn)
        assert msgs == []
        assert blocks == []
        assert usage.tier2_tokens == 0

    def test_backfilled_conversation_has_messages(self, migration_fixture_db):
        conn, conv_ids = migration_fixture_db
        from core.db import backfill_context_blocks
        backfill_context_blocks(conv_ids["plain"], conn=conn)
        msgs, blocks, usage = build_tier2_messages(conv_ids["plain"], conn=conn)
        assert len(msgs) == 4
        assert len(blocks) == 4
        # All messages should have public ID labels
        for msg in msgs:
            assert "[" in msg["content"]
            assert "]" in msg["content"]

    def test_parallel_tool_calls_keep_one_provider_assistant_message(self, migration_fixture_db):
        """Visible per-call IDs must not break the provider tool-call chain."""
        conn, conv_ids = migration_fixture_db
        from core.db import backfill_context_blocks

        backfill_context_blocks(conv_ids["tool_calls"], conn=conn)
        msgs, blocks, _usage = build_tier2_messages(conv_ids["tool_calls"], conn=conn)

        assert len(blocks) == 6  # user, two calls, two results, final assistant
        tool_call_messages = [msg for msg in msgs if msg.get("tool_calls")]
        assert len(tool_call_messages) == 1
        assert [call["id"] for call in tool_call_messages[0]["tool_calls"]] == ["call_aaa", "call_bbb"]
        assert "[tool_call_11_0]" in tool_call_messages[0]["content"]
        assert "[tool_call_11_1]" in tool_call_messages[0]["content"]


class TestTier3Footer:
    """Tier 3 is a volatile footer rebuilt per request."""

    def test_returns_string(self):
        footer = build_tier3_footer()
        assert isinstance(footer, str)
        assert "Status:" in footer

    def test_includes_time(self):
        from datetime import datetime, timezone
        now = datetime(2026, 1, 15, 12, 0, 0, tzinfo=timezone.utc)
        footer = build_tier3_footer(current_time=now)
        assert "2026-01-15" in footer

    def test_warns_at_80_percent(self):
        footer = build_tier3_footer(
            tier1_tokens=4000,
            tier2_tokens=120_000,
            model_input_limit=150_000,
        )
        assert "Warning" in footer
        assert "purge" in footer.lower() or "compact_context" in footer.lower()

    def test_no_warning_below_80_percent(self):
        footer = build_tier3_footer(
            tier1_tokens=4000,
            tier2_tokens=10_000,
            model_input_limit=128_000,
        )
        assert "Optimal" in footer

    def test_includes_canvas_context(self):
        footer = build_tier3_footer(canvas_context="Document: notes.md\n5 lines")
        assert "notes.md" in footer

    def test_includes_rag_context(self):
        footer = build_tier3_footer(rag_context="Found 3 relevant chunks")
        assert "Found 3 relevant chunks" in footer

    def test_includes_scratchpad(self):
        footer = build_tier3_footer(scratchpad_sections={"notes": "Important note"})
        assert "Important note" in footer
        assert "Scratchpad" in footer

    def test_includes_memory_texts(self):
        footer = build_tier3_footer(
            conversation_memory_text="User prefers dark mode",
            persona_memory_text="The user is a senior developer",
        )
        assert "dark mode" in footer
        assert "senior developer" in footer

    def test_includes_active_tools(self):
        footer = build_tier3_footer(active_tool_names=["search_web", "read_scratchpad"])
        assert "search_web" in footer
        assert "read_scratchpad" in footer

    def test_critical_status_at_95_percent(self):
        footer = build_tier3_footer(
            tier1_tokens=4000,
            tier2_tokens=125_000,
            model_input_limit=130_000,
        )
        assert "Critical" in footer


class TestAssembleContextPlan:
    """Full ContextPlan assembly."""

    def test_returns_context_plan(self, migration_fixture_db):
        conn, conv_ids = migration_fixture_db
        plan = assemble_context_plan(conv_ids["plain"], conn=conn)
        assert isinstance(plan, ContextPlan)
        assert len(plan.tier1_messages) == 1
        assert plan.tier1_messages[0]["role"] == "system"
        assert isinstance(plan.tier2_messages, list)
        assert isinstance(plan.tier3_footer, str)
        assert isinstance(plan.token_usage, ContextTokenUsage)

    def test_token_usage_is_consistent(self, migration_fixture_db):
        conn, conv_ids = migration_fixture_db
        plan = assemble_context_plan(conv_ids["plain"], conn=conn)
        tu = plan.token_usage
        assert tu.total_tokens >= 0
        assert tu.total_tokens == tu.tier1_tokens + tu.tier2_tokens + tu.tier3_tokens + tu.tool_schema_tokens
        assert tu.free_capacity >= 0
        assert tu.free_capacity <= tu.model_input_limit


class TestBuildFullApiMessages:
    """Converting a ContextPlan into provider-ready messages."""

    def test_appends_tier3_to_last_user(self, migration_fixture_db):
        conn, conv_ids = migration_fixture_db
        plan = assemble_context_plan(conv_ids["plain"], conn=conn)
        msgs = build_full_api_messages(plan)
        assert len(msgs) >= 1
        assert "Status:" in msgs[-1]["content"]

    def test_first_message_is_system(self, migration_fixture_db):
        conn, conv_ids = migration_fixture_db
        plan = assemble_context_plan(conv_ids["plain"], conn=conn)
        msgs = build_full_api_messages(plan)
        assert msgs[0]["role"] == "system"

    def test_byte_stable_tier1_prefix(self, migration_fixture_db):
        """Normal turns should produce identical Tier 1 prefixes."""
        conn, conv_ids = migration_fixture_db
        plan1 = assemble_context_plan(conv_ids["plain"], conn=conn)
        plan2 = assemble_context_plan(conv_ids["plain"], conn=conn)
        assert plan1.tier1_messages == plan2.tier1_messages

    def test_rendering_a_plan_twice_does_not_duplicate_tier3(self, migration_fixture_db):
        conn, conv_ids = migration_fixture_db
        from core.db import backfill_context_blocks

        backfill_context_blocks(conv_ids["plain"], conn=conn)
        plan = assemble_context_plan(conv_ids["plain"], conn=conn)
        first = build_full_api_messages(plan)
        second = build_full_api_messages(plan)
        assert first == second
