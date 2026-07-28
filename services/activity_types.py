"""TypedDict types for the activity logging service."""

from __future__ import annotations

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
