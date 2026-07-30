"""
Context Assembly Service — Tier 1 / Tier 2 / Tier 3 prompt construction.

Per AI Memory and Context Management design:
- Tier 1: Static system message + tool contracts (byte-stable).
- Tier 2: All active context_blocks rendered in sequence order (append-only).
- Tier 3: Volatile footer rebuilt per request (never persisted as history).

This module replaces the legacy history-window functions in core/messages.py
with a clean, testable ContextPlan-based pipeline.
"""

from __future__ import annotations

import copy
import json
import sqlite3
from datetime import datetime, timezone
from typing import Any

from core.context_memory import (
    ContextBlock,
    ContextBlockKind,
    ContextPlan,
    ContextTokenUsage,
)
from core.db import list_context_blocks, get_context_blocks_token_total
from core.messages import build_runtime_context_user_message
from core.prompts import get_prompt
from lib.tool_registry import get_enabled_tool_specs, get_prompt_tool_context
from utils.token_utils import estimate_text_tokens


# ---------------------------------------------------------------------------
# Tier 1 — Static system message
# ---------------------------------------------------------------------------

def build_tier1_system_message(
    *,
    active_tool_names: list[str] | None = None,
    user_preferences: str | None = None,
    persona_instructions: str | None = None,
    model_input_limit: int = 128_000,
) -> dict[str, Any]:
    """Build the single, immutable Tier 1 system message.

    This message MUST be byte-stable across normal turns for cache hits.
    Dynamic data (time, telemetry, RAG, canvas) belongs in Tier 3 ONLY.
    """
    parts: list[str] = []

    # Core role and directives
    try:
        role_header = get_prompt("role_header")
    except Exception:
        role_header = None
    if role_header:
        parts.append(role_header)

    # User preferences
    if user_preferences and user_preferences.strip():
        parts.append("## User Preferences\n" + user_preferences.strip())

    # Persona instructions
    if persona_instructions and persona_instructions.strip():
        parts.append("## Persona\n" + persona_instructions.strip())

    # Tool calling contract
    try:
        tool_contract = get_prompt("tool_calling_contract")
    except Exception:
        tool_contract = None
    if tool_contract:
        parts.append(tool_contract)

    # Batching strategy
    try:
        batching = get_prompt("batching_strategy")
    except Exception:
        batching = None
    if batching:
        parts.append(batching)

    # Active tools context
    if active_tool_names:
        tools_context = get_prompt_tool_context(active_tool_names)
        if tools_context:
            parts.append(tools_context)

    # Memory guidance
    try:
        memory_guidance = get_prompt("memory_guidance")
    except Exception:
        memory_guidance = None
    if memory_guidance:
        parts.append(memory_guidance)

    content = "\n\n".join(parts)
    if not content.strip():
        content = "You are a helpful AI assistant."
    return {"role": "system", "content": content}


# ---------------------------------------------------------------------------
# Tier 2 — Active context_blocks rendered in sequence order
# ---------------------------------------------------------------------------

def build_tier2_messages(
    conversation_id: int,
    *,
    model_input_limit: int = 128_000,
    conn: sqlite3.Connection | None = None,
) -> tuple[list[dict[str, Any]], list[ContextBlock], ContextTokenUsage]:
    """Render all active context_blocks into provider-compatible API messages.

    Returns (api_messages, context_blocks, token_usage).
    Every active block appears exactly once in sequence order.
    No recency selection, automatic summaries, or hidden deletion.
    """
    block_dicts = list_context_blocks(conversation_id, conn=conn)
    blocks = [ContextBlock.from_row(bd) for bd in block_dicts]

    api_messages: list[dict[str, Any]] = []
    tier2_tokens = 0

    index = 0
    while index < len(blocks):
        block = blocks[index]

        # The ledger intentionally gives every parallel call its own visible
        # block/ID.  OpenAI-compatible providers, however, require sibling
        # calls from one assistant response to be sent as *one* assistant
        # message before any matching tool result.  Render that provider-safe
        # companion message while retaining every individual label.
        if block.kind == ContextBlockKind.TOOL_CALL.value and block.source_message_id is not None:
            sibling_calls = [block]
            index += 1
            while (
                index < len(blocks)
                and blocks[index].kind == ContextBlockKind.TOOL_CALL.value
                and blocks[index].source_message_id == block.source_message_id
            ):
                sibling_calls.append(blocks[index])
                index += 1

            tool_calls: list[Any] = []
            for sibling in sibling_calls:
                if sibling.tool_calls_json:
                    try:
                        decoded = json.loads(sibling.tool_calls_json)
                    except (json.JSONDecodeError, TypeError):
                        decoded = []
                    if isinstance(decoded, list):
                        tool_calls.extend(decoded)
            api_messages.append(
                {
                    "role": "assistant",
                    "content": " ".join(f"[{s.public_id}]" for s in sibling_calls),
                    "tool_calls": tool_calls,
                }
            )
            tier2_tokens += sum(s.token_estimate for s in sibling_calls)
            continue

        msg = block.to_api_message()
        api_messages.append(msg)
        tier2_tokens += block.token_estimate
        index += 1

    usage = ContextTokenUsage(
        tier2_tokens=tier2_tokens,
        total_tokens=tier2_tokens,
        model_input_limit=model_input_limit,
        free_capacity=model_input_limit - tier2_tokens,
    )

    return api_messages, blocks, usage


# ---------------------------------------------------------------------------
# Tier 3 — Volatile footer (rebuilt per request, never persisted)
# ---------------------------------------------------------------------------

def build_tier3_footer(
    *,
    tier1_tokens: int = 0,
    tier2_tokens: int = 0,
    tool_schema_tokens: int = 0,
    model_input_limit: int = 128_000,
    current_time: datetime | None = None,
    canvas_context: str | None = None,
    rag_context: str | None = None,
    scratchpad_sections: dict[str, str] | None = None,
    conversation_memory_text: str | None = None,
    persona_memory_text: str | None = None,
    active_tool_names: list[str] | None = None,
    extra_context: str | None = None,
    warn_at_80_percent: bool = True,
) -> str:
    """Build the Tier 3 volatile footer string.

    This is emitted as a distinct final user message for provider cache safety.
    It is NEVER persisted in messages.metadata.context_injection.
    """
    total_used = tier1_tokens + tier2_tokens + tool_schema_tokens + tier3_estimate_tokens(
        current_time=current_time,
        canvas_context=canvas_context,
        rag_context=rag_context,
        scratchpad_sections=scratchpad_sections,
        conversation_memory_text=conversation_memory_text,
        persona_memory_text=persona_memory_text,
        active_tool_names=active_tool_names,
        extra_context=extra_context,
    )
    free = max(0, model_input_limit - total_used)
    usage_pct = (total_used / model_input_limit * 100) if model_input_limit > 0 else 0

    # Status line
    if usage_pct >= 95:
        status = "Critical"
    elif warn_at_80_percent and usage_pct >= 80:
        status = "Warning"
    else:
        status = "Optimal"

    parts: list[str] = []
    parts.append(f"Status: Context: {total_used:,} / {model_input_limit:,} ({usage_pct:.1f}%) | System Status: {status}")

    # Time context (rounded for cache friendliness)
    now = current_time or datetime.now(timezone.utc)
    parts.append(f"Current time: {now.strftime('%Y-%m-%d %H:%M UTC')}")

    # Context management guidance
    if usage_pct >= 80:
        parts.append(
            "Context usage is high. Consider using `purge` to remove completed or irrelevant "
            "conversation blocks, or `compact_context` to reset with a dense state summary."
        )

    # Active tools (compact)
    if active_tool_names:
        parts.append("Active tools: " + ", ".join(sorted(active_tool_names)))

    # RAG context
    if rag_context and rag_context.strip():
        parts.append("## Knowledge Base Results\n" + rag_context.strip())

    # Canvas context
    if canvas_context and canvas_context.strip():
        parts.append("## Canvas Workspace\n" + canvas_context.strip())

    # Scratchpad
    if scratchpad_sections:
        for section_name, text in scratchpad_sections.items():
            if text and text.strip():
                parts.append(f"## Scratchpad: {section_name}\n{text.strip()}")

    # Conversation memory
    if conversation_memory_text and conversation_memory_text.strip():
        parts.append("## Conversation Memory\n" + conversation_memory_text.strip())

    # Persona memory
    if persona_memory_text and persona_memory_text.strip():
        parts.append("## Persona Memory\n" + persona_memory_text.strip())

    # Some product features (Canvas previews, clarification state, and the
    # existing RAG formatter) have richer, provider-tested renderers.  Their
    # output is still volatile: callers pass it here rather than attaching it
    # to a stored transcript message or adding another system message.
    if extra_context and extra_context.strip():
        parts.append(extra_context.strip())

    return "\n\n".join(parts)


def tier3_estimate_tokens(
    *,
    current_time: datetime | None = None,
    canvas_context: str | None = None,
    rag_context: str | None = None,
    scratchpad_sections: dict[str, str] | None = None,
    conversation_memory_text: str | None = None,
    persona_memory_text: str | None = None,
    active_tool_names: list[str] | None = None,
    extra_context: str | None = None,
) -> int:
    """Estimate the token cost of the Tier 3 footer without building it.

    Useful for budget planning before full assembly.
    """
    text = ""
    if canvas_context:
        text += canvas_context
    if rag_context:
        text += rag_context
    if scratchpad_sections:
        for v in scratchpad_sections.values():
            text += v
    if conversation_memory_text:
        text += conversation_memory_text
    if persona_memory_text:
        text += persona_memory_text
    if extra_context:
        text += extra_context
    # Status line and headers overhead (~200 chars)
    overhead = 500
    return estimate_text_tokens(text) + (overhead // 4)


# ---------------------------------------------------------------------------
# Full ContextPlan assembly
# ---------------------------------------------------------------------------

def assemble_context_plan(
    conversation_id: int,
    *,
    active_tool_names: list[str] | None = None,
    user_preferences: str | None = None,
    persona_instructions: str | None = None,
    model_input_limit: int = 128_000,
    current_time: datetime | None = None,
    canvas_context: str | None = None,
    rag_context: str | None = None,
    scratchpad_sections: dict[str, str] | None = None,
    conversation_memory_text: str | None = None,
    persona_memory_text: str | None = None,
    tier1_message: dict[str, Any] | None = None,
    tier3_extra_context: str | None = None,
    conn: sqlite3.Connection | None = None,
) -> ContextPlan:
    """Assemble the complete ContextPlan for a model request.

    This is the single entry point that replaces the legacy
    build_runtime_context_injection + build_api_messages pipeline.
    """
    # Tier 1
    tier1_msg = dict(tier1_message) if isinstance(tier1_message, dict) else build_tier1_system_message(
        active_tool_names=active_tool_names,
        user_preferences=user_preferences,
        persona_instructions=persona_instructions,
        model_input_limit=model_input_limit,
    )
    # ContextPlan always exposes exactly one provider-valid static system
    # message, even when an integration supplies its established renderer.
    tier1_msg = {
        "role": "system",
        "content": str(tier1_msg.get("content") or "You are a helpful AI assistant."),
    }
    tier1_tokens = estimate_text_tokens(tier1_msg["content"])

    # Tool schemas (estimated separately for cache breakpoints)
    enabled_specs = get_enabled_tool_specs(active_tool_names or [])
    tool_schema_tokens = estimate_text_tokens(json.dumps(enabled_specs, default=str))

    # Tier 2
    tier2_msgs, tier2_blocks, tier2_usage = build_tier2_messages(
        conversation_id, model_input_limit=model_input_limit, conn=conn
    )

    # Tier 3
    tier3_footer = build_tier3_footer(
        tier1_tokens=tier1_tokens,
        tier2_tokens=tier2_usage.tier2_tokens,
        tool_schema_tokens=tool_schema_tokens,
        model_input_limit=model_input_limit,
        current_time=current_time,
        canvas_context=canvas_context,
        rag_context=rag_context,
        scratchpad_sections=scratchpad_sections,
        conversation_memory_text=conversation_memory_text,
        persona_memory_text=persona_memory_text,
        active_tool_names=active_tool_names,
        extra_context=tier3_extra_context,
    )
    tier3_tokens = estimate_text_tokens(tier3_footer)

    total_tokens = tier1_tokens + tier2_usage.tier2_tokens + tier3_tokens + tool_schema_tokens
    free_capacity = max(0, model_input_limit - total_tokens)

    token_usage = ContextTokenUsage(
        tier1_tokens=tier1_tokens,
        tier2_tokens=tier2_usage.tier2_tokens,
        tier3_tokens=tier3_tokens,
        tool_schema_tokens=tool_schema_tokens,
        total_tokens=total_tokens,
        model_input_limit=model_input_limit,
        free_capacity=free_capacity,
    )

    return ContextPlan(
        tier1_messages=[tier1_msg],
        tier2_blocks=tier2_blocks,
        tier2_messages=tier2_msgs,
        tier3_footer=tier3_footer,
        token_usage=token_usage,
    )


def build_full_api_messages(context_plan: ContextPlan) -> list[dict[str, Any]]:
    """Convert a ContextPlan into the final provider-ready message array.

    Pattern: [Tier 1 system] + [Tier 2 messages] + [Tier 3 user-footer message]
    """
    # Do not mutate ContextPlan's frozen-by-contract message payloads.  A plan
    # is also used for telemetry and may be rendered more than once.
    messages: list[dict[str, Any]] = copy.deepcopy(context_plan.tier1_messages)
    messages.extend(copy.deepcopy(context_plan.tier2_messages))

    if context_plan.tier3_footer:
        messages.append(build_runtime_context_user_message(context_plan.tier3_footer))

    return messages
