"""Shared explicit context-compaction operation.

Both the user endpoint and the model tool call this module so validation,
locking, and destructive mutation semantics cannot drift apart.
"""

from __future__ import annotations

import json
import time
from typing import Any

from core.context_memory import validate_compacted_state
from core.db import (
    acquire_compaction_lock,
    execute_compact_context_transaction,
    get_app_settings,
    list_context_blocks,
    release_compaction_lock,
)
from lib.model_registry import (
    apply_model_target_request_options,
    get_operation_model,
    resolve_model_target,
)
from utils.shared_extract import extract_chat_completion_text


def _build_compaction_prompt(blocks_text: str, resume_instruction: str) -> tuple[str, str]:
    system = (
        "You are a context compaction assistant. Analyze the complete conversation "
        "ledger and return exactly one valid CompactedState JSON object. Do not omit "
        "decisions, completed work, current tasks, blockers, or affected files. "
        "Do not include the conversation messages themselves and do not use markdown fences."
    )
    user = (
        "Complete conversation ledger:\n\n"
        f"{blocks_text}\n\n"
        f"Resume instruction after compaction: {resume_instruction}"
    )
    return system, user


def _format_blocks(blocks: list[dict[str, Any]]) -> str:
    lines: list[str] = []
    for block in blocks:
        label = f"[{str(block.get('public_id') or '')}] ({str(block.get('kind') or '')}/{str(block.get('api_role') or '')}"
        tool_name = str(block.get("tool_name") or "").strip()
        if tool_name:
            label += f", tool={tool_name}"
        label += ")"
        # Compaction is the one deliberate full-ledger replacement operation:
        # its operation model must inspect the complete active payload before
        # anything is deleted.
        lines.append(f"{label}\n{str(block.get('content') or '')}")
    return "\n\n".join(lines)


def _generate_compacted_state(blocks_text: str, resume_instruction: str) -> tuple[dict[str, Any] | None, str | None]:
    settings = get_app_settings()
    target = resolve_model_target(get_operation_model("compaction", settings), settings)
    last_error: str | None = None

    for attempt in range(3):
        try:
            system_msg, user_msg = _build_compaction_prompt(blocks_text, resume_instruction)
            response = target["client"].chat.completions.create(
                **apply_model_target_request_options(
                    {
                        "model": target["api_model"],
                        "messages": [
                            {"role": "system", "content": system_msg},
                            {"role": "user", "content": user_msg},
                        ],
                        "max_tokens": 4096,
                        "temperature": 0.2,
                    },
                    target,
                )
            )
            raw_text = str(extract_chat_completion_text(response) or "").strip()
            if raw_text.startswith("```"):
                raw_lines = raw_text.splitlines()
                if raw_lines and raw_lines[-1].strip() == "```":
                    raw_lines = raw_lines[:-1]
                raw_text = "\n".join(raw_lines[1:])
            parsed = json.loads(raw_text)
            errors = validate_compacted_state(parsed)
            if not errors:
                return parsed, None
            last_error = "; ".join(errors)
        except Exception as exc:  # Provider failures preserve the ledger.
            last_error = str(exc)
        if attempt < 2:
            time.sleep(1)

    return None, last_error or "operation model returned no valid CompactedState"


def compact_conversation(
    conversation_id: int,
    resume_instruction: str,
    *,
    actor: str,
) -> dict[str, Any]:
    """Validate then atomically replace a conversation's Tier 2 ledger.

    Errors are returned as data so the model tool and HTTP API can choose their
    own transport/status code without implementing a second mutation path.
    """
    resume_instruction = str(resume_instruction or "").strip()
    if not resume_instruction:
        return {"error": "resume_instruction is required and must be non-empty.", "retryable": False}
    if not acquire_compaction_lock(int(conversation_id), timeout=10.0):
        return {"error": "Another compaction is already in progress. Please retry.", "retryable": True}

    try:
        blocks = list_context_blocks(int(conversation_id))
        if not blocks:
            return {"error": "No conversation blocks to compact.", "retryable": False}
        state, error = _generate_compacted_state(_format_blocks(blocks), resume_instruction)
        if state is None:
            return {"error": f"Failed to produce a valid CompactedState: {error}", "retryable": True}

        result = execute_compact_context_transaction(
            int(conversation_id), json.dumps(state, ensure_ascii=False, indent=2), resume_instruction, actor=actor
        )
        # Conversation RAG sources are derived from visible messages. Rebuild
        # them immediately after the committed mutation; a failed rebuild is
        # explicitly reported so callers can retry it rather than serving stale
        # history silently.
        try:
            from services.rag_service import sync_conversations_to_rag_safe

            sync_conversations_to_rag_safe(conversation_id=int(conversation_id), force=True)
            result["rag_cleanup_pending"] = False
        except Exception:
            result["rag_cleanup_pending"] = True
        return result
    finally:
        release_compaction_lock(int(conversation_id))
