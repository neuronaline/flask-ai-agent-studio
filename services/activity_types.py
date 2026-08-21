"""Typed types for the activity logging service.

Defines the structured payload used by both
``services.activity_service.log_activity_call`` and the lower-level recorders
``agent.agent._append_model_invocation_log`` / ``core.db.insert_model_invocation``.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, TypedDict


class ActivityCallParams(TypedDict, total=False):
    """Parameters for log_activity_call(), excluding conversation_id and conn.

    All fields are optional to accommodate callers that pass only a subset.
    The more commonly required fields (provider, api_model, operation) are
    expected to always be present at runtime.
    """

    provider: str
    api_model: str
    operation: str
    call_type: str
    request_payload: Any
    response_summary: Any
    response_status: str
    error_type: str | None
    error_message: str | None
    latency_ms: int | None
    prompt_tokens: int | None
    completion_tokens: int | None
    total_tokens: int | None
    estimated_input_tokens: int | None
    prompt_cache_hit_tokens: int | None
    prompt_cache_miss_tokens: int | None
    prompt_cache_write_tokens: int | None
    assistant_message_id: int | None
    source_message_id: int | None
    step: int
    call_index: int
    is_retry: bool
    retry_reason: str | None


@dataclass
class ModelInvocationLog:
    """Unified payload for one model invocation row.

    This is the canonical record shape consumed by both ``insert_model_invocation``
    (DB persistence) and ``_append_model_invocation_log`` (in-memory sink used by
    the streaming agent loop). Callers build one instance and pass it to either
    function; adding a new metric only requires touching this dataclass and the
    two readers, not the dozens of positional call sites that the original 25-
    and 22-argument signatures encouraged.

    Fields set to ``None`` / falsy are stored as ``NULL`` in the DB and omitted
    from the in-memory sink's log record.
    """

    conversation_id: int | None = None
    source_message_id: int | None = None
    step: int = 0
    call_index: int | None = None
    call_type: str = "agent_step"
    is_retry: bool = False
    retry_reason: str | None = None
    provider: str = ""
    api_model: str = ""
    operation: str | None = None
    request_payload: Any = None
    response_summary: Any = None
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    total_tokens: int | None = None
    estimated_input_tokens: int | None = None
    prompt_cache_hit_tokens: int | None = None
    prompt_cache_miss_tokens: int | None = None
    prompt_cache_write_tokens: int | None = None
    cost: float | None = None
    latency_ms: int | None = None
    response_status: str | None = None
    error_type: str | None = None
    error_message: str | None = None
    assistant_message_id: int | None = None


def activity_call_params_to_log(params: "ActivityCallParams") -> ModelInvocationLog:
    """Materialize a dataclass log entry from a TypedDict bag (legacy callers)."""
    return ModelInvocationLog(
        provider=str(params.get("provider", "") or ""),
        api_model=str(params.get("api_model", "") or ""),
        operation=params.get("operation"),
        call_type=str(params.get("call_type", "agent_step") or "agent_step"),
        request_payload=params.get("request_payload"),
        response_summary=params.get("response_summary"),
        response_status=params.get("response_status"),
        error_type=params.get("error_type"),
        error_message=params.get("error_message"),
        latency_ms=params.get("latency_ms"),
        prompt_tokens=params.get("prompt_tokens"),
        completion_tokens=params.get("completion_tokens"),
        total_tokens=params.get("total_tokens"),
        estimated_input_tokens=params.get("estimated_input_tokens"),
        prompt_cache_hit_tokens=params.get("prompt_cache_hit_tokens"),
        prompt_cache_miss_tokens=params.get("prompt_cache_miss_tokens"),
        prompt_cache_write_tokens=params.get("prompt_cache_write_tokens"),
        assistant_message_id=params.get("assistant_message_id"),
        source_message_id=params.get("source_message_id"),
        step=int(params.get("step", 0) or 0),
        call_index=params.get("call_index"),
        is_retry=bool(params.get("is_retry")),
        retry_reason=params.get("retry_reason"),
    )
