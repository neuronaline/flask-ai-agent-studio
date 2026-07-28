"""Activity logging service.

Provides a single, normalized entry point for recording every outbound LLM
provider call to the model_invocations Activity log. All call-paths
(agent loop, prune, image, summarize, title generation, …) route through
``log_activity_call`` so the Activity table always contains comparable rows.
"""
from __future__ import annotations

import time
from typing import Any

from services.activity_types import ActivityCallParams
from utils.logging_config import get_logger

LOGGER = get_logger(__name__)


# ---------------------------------------------------------------------------
# Response-status constants
# ---------------------------------------------------------------------------
STATUS_OK = "ok"
STATUS_ERROR = "error"
STATUS_STREAM_ERROR = "stream_error"
STATUS_CANCELLED = "cancelled"


# ---------------------------------------------------------------------------
# Public helper
# ---------------------------------------------------------------------------

def log_activity_call(
    *,
    conversation_id: int,
    params: ActivityCallParams | None = None,
    conn=None,
    **kwargs,
) -> int | None:
    """Insert a normalized activity record.

    Accepts either *params* (an ``ActivityCallParams`` dict) or individual
    keyword arguments (backward-compatible).  When both are provided the
    keyword arguments take precedence over *params*.

    Returns the new row id, or None if logging fails (non-fatal).
    If *conn* is provided the insert runs inside the caller's transaction;
    otherwise a new connection is obtained from ``get_db()``.
    """
    if params is None:
        params = ActivityCallParams()
    if kwargs:
        _merged = dict(params)
        _merged.update(kwargs)
        params = ActivityCallParams(**_merged)
    try:
        from core.db import get_db, insert_model_invocation  # local to avoid circular imports

        kwargs = dict(
            provider=params.get("provider", ""),
            api_model=params.get("api_model", ""),
            operation=params.get("operation", ""),
            call_type=params.get("call_type", "agent_step"),
            request_payload=params.get("request_payload") or {},
            response_summary=params.get("response_summary") or {},
            response_status=params.get("response_status", STATUS_OK),
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
            step=params.get("step", 0),
            call_index=params.get("call_index", 0),
            is_retry=params.get("is_retry", False),
            retry_reason=params.get("retry_reason"),
        )

        if conn is not None:
            return insert_model_invocation(conn, conversation_id, **kwargs)

        with get_db() as _conn:
            return insert_model_invocation(_conn, conversation_id, **kwargs)

    except Exception:
        LOGGER.exception("activity_service: failed to log activity call (non-fatal)")
        return None


def extract_usage_from_response(response) -> dict:
    """Extract token/cost fields from an OpenAI-compat response object."""
    usage = getattr(response, "usage", None)
    if usage is None:
        return {}

    result: dict = {}
    prompt_tokens = getattr(usage, "prompt_tokens", None)
    completion_tokens = getattr(usage, "completion_tokens", None)
    total_tokens = getattr(usage, "total_tokens", None)
    if prompt_tokens is not None:
        result["prompt_tokens"] = int(prompt_tokens)
    if completion_tokens is not None:
        result["completion_tokens"] = int(completion_tokens)
    if total_tokens is not None:
        result["total_tokens"] = int(total_tokens)

    # Anthropic extended fields (input_tokens → prompt, output_tokens → completion)
    for attr in ("input_tokens", "prompt_tokens"):
        val = getattr(usage, attr, None)
        if val is not None and result.get("prompt_tokens") is None:
            result["prompt_tokens"] = int(val)
            break
    for attr in ("output_tokens", "completion_tokens"):
        val = getattr(usage, attr, None)
        if val is not None and result.get("completion_tokens") is None:
            result["completion_tokens"] = int(val)
            break

    # prompt_tokens_details (OpenAI / DeepSeek cache fields)
    ptd = getattr(usage, "prompt_tokens_details", None)
    if ptd:
        cached = getattr(ptd, "cached_tokens", None)
        if cached is not None:
            result["prompt_cache_hit_tokens"] = int(cached)

    # OpenRouter / DeepSeek extended fields
    for attr in ("cache_read_input_tokens", "cache_hit_tokens"):
        val = getattr(usage, attr, None)
        if val is not None:
            result["prompt_cache_hit_tokens"] = int(val)
            break
    for attr in ("cache_miss_input_tokens", "cache_miss_tokens"):
        val = getattr(usage, attr, None)
        if val is not None:
            result["prompt_cache_miss_tokens"] = int(val)
            break
    for attr in ("cache_creation_input_tokens", "cache_write_tokens"):
        val = getattr(usage, attr, None)
        if val is not None:
            result["prompt_cache_write_tokens"] = int(val)
            break

    return result


class ActivityTimer:
    """Context manager that measures wall-clock latency in milliseconds."""

    def __init__(self) -> None:
        self._start: float = 0.0
        self.elapsed_ms: int = 0

    def __enter__(self) -> "ActivityTimer":
        self._start = time.monotonic()
        return self

    def __exit__(self, *_) -> None:
        self.elapsed_ms = max(0, round((time.monotonic() - self._start) * 1000))
