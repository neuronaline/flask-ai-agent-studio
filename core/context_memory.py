"""
Context Memory — Tier 2 ledger types, IDs, and schemas.

Per AI Memory and Context Management design:
- Tier 2 is an append-only, visible-ID ledger of conversation blocks.
- Only `purge` and `compact_context` may mutate Tier 2 after insertion.
- This module defines the data types, public-ID system, and validation
  contracts that the context_blocks ledger, prompt assembly, and mutation
  tools all share.
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass, field
from enum import Enum
from typing import Any


# ---------------------------------------------------------------------------
# ContextBlockKind — enumerates every block kind that can appear in Tier 2
# ---------------------------------------------------------------------------

class ContextBlockKind(str, Enum):
    """Every distinct kind of Tier 2 context block."""

    MESSAGE = "message"                # User or plain assistant message
    TOOL_CALL = "tool_call"           # Individual provider tool call
    TOOL_RESULT = "tool_result"       # Tool execution result
    DELEGATE_REPORT = "delegate_report"  # Isolated delegation result
    WEB_REPORT = "web_report"         # Synthesised web-agent report
    COMPACTED_STATE = "compacted_state"  # Post-compaction state baseline
    RESUME_INSTRUCTION = "resume_instruction"  # Post-compaction resume
    SUMMARY = "summary"               # Legacy summary (migration only)


# ---------------------------------------------------------------------------
# Public ID system — stable, visible, never derived from mutable position
# ---------------------------------------------------------------------------

# Regex patterns for each public-ID format
_PUBLIC_ID_PATTERNS: dict[ContextBlockKind, re.Pattern] = {
    ContextBlockKind.MESSAGE: re.compile(r"^msg_(\d+)$"),
    ContextBlockKind.TOOL_CALL: re.compile(r"^tool_call_(\d+)_(\d+)$"),
    ContextBlockKind.TOOL_RESULT: re.compile(r"^tool_res_(\d+)$"),
    ContextBlockKind.DELEGATE_REPORT: re.compile(r"^delegate_res_([-\w]+)$"),
    ContextBlockKind.WEB_REPORT: re.compile(r"^web_res_([-\w]+)$"),
    ContextBlockKind.COMPACTED_STATE: re.compile(r"^state_([-\w]+)$"),
    ContextBlockKind.RESUME_INSTRUCTION: re.compile(r"^resume_([-\w]+)$"),
    ContextBlockKind.SUMMARY: re.compile(r"^summary_([-\w]+)$"),
}

# Reverse mapping: prefix → kind (for classification without full parsing)
_PREFIX_TO_KIND: dict[str, ContextBlockKind] = {
    "msg_": ContextBlockKind.MESSAGE,
    "tool_call_": ContextBlockKind.TOOL_CALL,
    "tool_res_": ContextBlockKind.TOOL_RESULT,
    "delegate_res_": ContextBlockKind.DELEGATE_REPORT,
    "web_res_": ContextBlockKind.WEB_REPORT,
    "state_": ContextBlockKind.COMPACTED_STATE,
    "resume_": ContextBlockKind.RESUME_INSTRUCTION,
    "summary_": ContextBlockKind.SUMMARY,
}

_VALID_PREFIXES = tuple(_PREFIX_TO_KIND.keys())


def classify_public_id(public_id: str) -> ContextBlockKind | None:
    """Return the block kind for a public-ID string, or None if unrecognised."""
    if not isinstance(public_id, str) or not public_id:
        return None
    for prefix, kind in _PREFIX_TO_KIND.items():
        if public_id.startswith(prefix):
            return kind
    return None


def validate_public_id(public_id: str) -> bool:
    """Return True if `public_id` matches exactly one recognised format."""
    kind = classify_public_id(public_id)
    if kind is None:
        return False
    pattern = _PUBLIC_ID_PATTERNS[kind]
    return bool(pattern.fullmatch(public_id))


def validate_public_ids(public_ids: list[str]) -> list[str]:
    """Return the subset of IDs that pass `validate_public_id`.

    Useful for diagnostic messages; the purge path also requires IDs to be
    resolvable against the active conversation ledger.
    """
    return [pid for pid in public_ids if validate_public_id(pid)]


def make_public_id(kind: ContextBlockKind, *parts: str | int) -> str:
    """Build a public ID from its kind and positional parts.

    >>> make_public_id(ContextBlockKind.MESSAGE, 104)
    'msg_104'
    >>> make_public_id(ContextBlockKind.TOOL_CALL, 105, 1)
    'tool_call_105_1'
    >>> make_public_id(ContextBlockKind.TOOL_RESULT, 106)
    'tool_res_106'
    """
    if kind == ContextBlockKind.MESSAGE:
        return f"msg_{parts[0]}"
    if kind == ContextBlockKind.TOOL_CALL:
        return f"tool_call_{parts[0]}_{parts[1]}"
    if kind == ContextBlockKind.TOOL_RESULT:
        return f"tool_res_{parts[0]}"
    # Generic opaque-suffix forms
    suffix = "_".join(str(p) for p in parts)
    prefix_map: dict[ContextBlockKind, str] = {
        ContextBlockKind.DELEGATE_REPORT: "delegate_res_",
        ContextBlockKind.WEB_REPORT: "web_res_",
        ContextBlockKind.COMPACTED_STATE: "state_",
        ContextBlockKind.RESUME_INSTRUCTION: "resume_",
        ContextBlockKind.SUMMARY: "summary_",
    }
    prefix = prefix_map.get(kind)
    if prefix is None:
        raise ValueError(f"No public-ID prefix for kind {kind}")
    return f"{prefix}{suffix}"


def resolve_kind_from_public_id(public_id: str) -> ContextBlockKind:
    """Return the kind for a validated public ID, raising on unknown format."""
    kind = classify_public_id(public_id)
    if kind is None:
        raise ValueError(f"Unrecognised public-ID format: {public_id!r}")
    return kind


# ---------------------------------------------------------------------------
# ContextBlock — the rich representation of one Tier 2 ledger row
# ---------------------------------------------------------------------------

@dataclass
class ContextBlock:
    """A single entry in the context_blocks ledger (Tier 2)."""

    id: int                                  # DB primary key
    public_id: str                           # Stable visible ID
    conversation_id: int
    sequence: int                            # Monotonic ordering
    kind: str                                # ContextBlockKind value
    api_role: str                            # "user" | "assistant" | "tool"
    source_message_id: int | None = None    # FK → messages.id
    parent_public_id: str | None = None     # e.g. tool_res_ → tool_call_
    provider_call_id: str | None = None     # Provider-side tool_call_id
    tool_name: str | None = None
    content: str = ""
    tool_calls_json: str | None = None
    metadata_json: str | None = None
    token_estimate: int = 0
    created_at: str = ""

    @classmethod
    def from_row(cls, row: dict[str, Any]) -> ContextBlock:
        """Construct from a context_blocks row dict."""
        return cls(
            id=int(row["id"]),
            public_id=str(row["public_id"]),
            conversation_id=int(row["conversation_id"]),
            sequence=int(row["sequence"]),
            kind=str(row["kind"]),
            api_role=str(row["api_role"]),
            source_message_id=int(row["source_message_id"]) if row.get("source_message_id") is not None else None,
            parent_public_id=str(row["parent_public_id"]) if row.get("parent_public_id") else None,
            provider_call_id=str(row["provider_call_id"]) if row.get("provider_call_id") else None,
            tool_name=str(row["tool_name"]) if row.get("tool_name") else None,
            content=str(row.get("content", "") or ""),
            tool_calls_json=str(row["tool_calls_json"]) if row.get("tool_calls_json") else None,
            metadata_json=str(row["metadata_json"]) if row.get("metadata_json") else None,
            token_estimate=int(row.get("token_estimate", 0) or 0),
            created_at=str(row.get("created_at", "") or ""),
        )

    def to_api_message(self) -> dict[str, Any]:
        """Render this block into a provider-compatible API message dict.

        Labels public IDs in content for model visibility without adding
        non-provider fields to the outbound request.
        """
        label = f"[{self.public_id}]"
        if self.api_role in ("user", "assistant"):
            msg: dict[str, Any] = {
                "role": self.api_role,
                "content": f"{label} {self.content}".rstrip(),
            }
            if self.tool_calls_json:
                try:
                    msg["tool_calls"] = json.loads(self.tool_calls_json)
                except (json.JSONDecodeError, TypeError):
                    pass
            return msg
        if self.api_role == "tool":
            if not self.provider_call_id:
                raise ValueError(
                    f"Tool-role block {self.public_id!r} has no provider_call_id; "
                    "cannot build a provider-compatible tool message."
                )
            return {
                "role": "tool",
                "content": f"{label} {self.content}".rstrip(),
                "tool_call_id": self.provider_call_id,
            }
        # Fallback — render as user message with label
        return {"role": "user", "content": f"{label} {self.content}".rstrip()}


# ---------------------------------------------------------------------------
# Mutation audit types
# ---------------------------------------------------------------------------

class MutationOperation(str, Enum):
    """Audit operation types stored in context_mutations."""

    PURGE = "purge"
    COMPACT_CONTEXT = "compact_context"


# ---------------------------------------------------------------------------
# CompactedState JSON schema
# ---------------------------------------------------------------------------

COMPACTED_STATE_SCHEMA: dict[str, Any] = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "required": [
        "project_summary",
        "established_context",
        "key_decisions",
        "completed_tasks",
        "current_tasks",
        "blockers",
        "affected_files",
    ],
    "properties": {
        "project_summary": {
            "type": "string",
            "minLength": 1,
            "description": "Concise summary of the project and current session scope.",
        },
        "established_context": {
            "type": "array",
            "minItems": 1,
            "items": {"type": "string", "minLength": 1},
            "description": "Key facts, constraints, and context established during the session.",
        },
        "key_decisions": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Important decisions made so far.",
        },
        "completed_tasks": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Tasks that have been fully completed.",
        },
        "current_tasks": {
            "type": "array",
            "minItems": 1,
            "items": {"type": "string", "minLength": 1},
            "description": "Tasks currently in progress (before compaction).",
        },
        "blockers": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Active blockers, errors, or unresolved issues.",
        },
        "affected_files": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Files modified or under investigation.",
        },
    },
    "additionalProperties": False,
}


def validate_compacted_state(data: dict[str, Any]) -> list[str]:
    """Validate data against the CompactedState schema.

    Returns a list of validation error messages (empty = valid).
    """
    errors: list[str] = []

    if not isinstance(data, dict):
        return ["CompactedState must be a JSON object."]

    for field in COMPACTED_STATE_SCHEMA["required"]:
        if field not in data:
            errors.append(f"Missing required field: {field}")

    # Validate values of present fields too, so all errors are collected in one pass.

    # project_summary
    if "project_summary" in data:
        ps = data.get("project_summary")
        if not isinstance(ps, str) or not ps.strip():
            errors.append("project_summary must be a non-empty string.")

    # established_context
    if "established_context" in data:
        ec = data.get("established_context")
        if not isinstance(ec, list) or len(ec) < 1:
            errors.append("established_context must be a non-empty array.")
        elif not all(isinstance(item, str) and item.strip() for item in ec):
            errors.append("Every established_context entry must be a non-empty string.")

    # current_tasks
    if "current_tasks" in data:
        ct = data.get("current_tasks")
        if not isinstance(ct, list) or len(ct) < 1:
            errors.append("current_tasks must be a non-empty array.")
        elif not all(isinstance(item, str) and item.strip() for item in ct):
            errors.append("Every current_tasks entry must be a non-empty string.")

    # Array fields — must be arrays of strings if present
    for field in ("key_decisions", "completed_tasks", "blockers", "affected_files"):
        if field in data:
            value = data.get(field)
            if not isinstance(value, list):
                errors.append(f"{field} must be an array.")
            elif not all(isinstance(item, str) for item in value):
                errors.append(f"Every {field} entry must be a string.")

    # No additional properties
    allowed = set(COMPACTED_STATE_SCHEMA["required"])
    extra = set(data.keys()) - allowed
    if extra:
        errors.append(f"Unexpected fields: {', '.join(sorted(extra))}")

    return errors


# ---------------------------------------------------------------------------
# ContextPlan — typed result of Tier assembly
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class ContextTokenUsage:
    """Token accounting broken down by tier and component."""

    tier1_tokens: int = 0
    tier2_tokens: int = 0
    tier3_tokens: int = 0
    tool_schema_tokens: int = 0
    multimodal_tokens: int = 0
    total_tokens: int = 0
    model_input_limit: int = 128_000
    free_capacity: int = 128_000


@dataclass(frozen=True)
class ContextPlan:
    """Typed result of Tier 1 / Tier 2 / Tier 3 assembly.

    The request builder must return this dataclass so callers can inspect
    tier membership and token accounting without parsing message arrays.
    """

    tier1_messages: list[dict[str, Any]] = field(default_factory=list)
    tier2_blocks: list[ContextBlock] = field(default_factory=list)
    tier2_messages: list[dict[str, Any]] = field(default_factory=list)
    tier3_footer: str = ""
    token_usage: ContextTokenUsage = field(default_factory=ContextTokenUsage)
