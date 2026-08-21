# ruff: noqa: I001  (normalize.py: docstring precedes __future__ per project style)
"""Pure normalization helpers used by the data layer (``core/db.py``).

These helpers were extracted from ``core/db.py`` so the data layer can focus on
persistence and migration, while this module owns the per-field shaping
(trimming whitespace, clamping lengths, dropping unknown values, …).

Each helper is intentionally kept small and pure: it accepts a single field or
shallow structure and returns the canonical form. Callers should never mutate
the original input.

Cross-module dependencies (e.g. ``_coerce_positive_int``,
``_compact_canvas_tool_call_arguments``, ``normalize_scratchpad_text``) are
imported lazily inside the affected helpers. This keeps ``core/normalize.py``
free of import cycles with ``core/db.py`` while letting ``core/db.py`` import
these helpers at module load time.
"""
from __future__ import annotations

from core.config import (
    CONTENT_MAX_CHARS,
    MAX_PERSONA_NAME_LENGTH,
    RAG_TOOL_RESULT_MAX_TEXT_CHARS,
    RAG_TOOL_RESULT_SUMMARY_MAX_CHARS,
    get_runtime_setting,
)


# ---------------------------------------------------------------------------
# String and length-clamping primitives (used directly by the helpers below).
# Kept private; the 24 normalized public helpers are the only contract.
# ---------------------------------------------------------------------------

def _clamped_text(value, max_length: int, *, required: bool = False) -> str:
    """Squash, trim, and clamp free-form text. Raise on empty when required."""
    normalized = " ".join(str(value or "").strip().split())[:max_length]
    if required and not normalized:
        raise ValueError("Value is required.")
    return normalized


def _coerce_positive_int_local(value) -> int | None:
    """Local copy of ``core.db._coerce_positive_int`` to keep this module free
    of cross-module deps at module-init time. Returns ``None`` when the value is
    missing, not coercible, or not strictly positive.
    """
    if value in (None, ""):
        return None
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed > 0 else None


def _coerce_non_negative_int_local(value) -> int | None:
    """Local copy of ``core.db._coerce_non_negative_int``."""
    if value in (None, ""):
        return None
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed >= 0 else None


# ---------------------------------------------------------------------------
# 1. User profile
# ---------------------------------------------------------------------------

def _normalize_user_profile_value(value, max_length: int = 500) -> str:
    return " ".join(str(value or "").strip().split())[:max_length]


def _normalize_persona_behavior(value, max_length: int) -> str:
    from core.db import normalize_assistant_behavior_text  # lazy to avoid cycle

    return normalize_assistant_behavior_text(value)[:max_length]


# ---------------------------------------------------------------------------
# 2. Conversation memory
# ---------------------------------------------------------------------------

def _normalize_conversation_memory_entry_type(value: str) -> str:
    from core.db import CONVERSATION_MEMORY_ENTRY_TYPES  # lazy to avoid cycle

    normalized = str(value or "").strip().lower()
    if normalized not in CONVERSATION_MEMORY_ENTRY_TYPES:
        raise ValueError("Unsupported conversation memory entry type.")
    return normalized


def _normalize_conversation_memory_key(value: str, max_length: int = 120) -> str:
    return _clamped_text(value, max_length, required=True)


def _normalize_conversation_memory_value(value: str, max_length: int = 1500) -> str:
    return _clamped_text(value, max_length, required=True)


def _normalize_conversation_memory_snapshot_entries(entries, conversation_id: int) -> list[dict]:
    from core.db import datetime_utc_now_iso  # lazy to avoid cycle

    normalized_conversation_id = int(conversation_id or 0)
    if normalized_conversation_id <= 0:
        return []

    normalized_entries_by_key: dict[str, dict] = {}
    ordered_keys: list[str] = []
    for entry in entries or []:
        if not isinstance(entry, dict):
            continue
        normalized_entry = {
            "id": _coerce_positive_int_local(entry.get("id")),
            "conversation_id": normalized_conversation_id,
            "message_id": _coerce_positive_int_local(entry.get("message_id")),
            "entry_type": _normalize_conversation_memory_entry_type(entry.get("entry_type") or "task_context"),
            "key": _normalize_conversation_memory_key(entry.get("key") or ""),
            "value": _normalize_conversation_memory_value(entry.get("value") or ""),
            "created_at": str(entry.get("created_at") or "").strip() or datetime_utc_now_iso(),
        }
        normalized_key = normalized_entry["key"].casefold()
        if normalized_key not in normalized_entries_by_key:
            ordered_keys.append(normalized_key)
        normalized_entries_by_key[normalized_key] = normalized_entry

    return [normalized_entries_by_key[key] for key in ordered_keys]


# ---------------------------------------------------------------------------
# 3. Persona memory
# ---------------------------------------------------------------------------

def _normalize_persona_memory_key(value: str, max_length: int = 120) -> str:
    return _clamped_text(value, max_length, required=True)


def _normalize_persona_memory_value(value: str, max_length: int = 1500) -> str:
    return _clamped_text(value, max_length, required=True)


# ---------------------------------------------------------------------------
# 4. Conversation state mutations
# ---------------------------------------------------------------------------

def _normalize_state_mutation_target_kind(value: str) -> str:
    from core.db import STATE_MUTATION_TARGET_KINDS  # lazy to avoid cycle

    normalized = str(value or "").strip()
    if normalized not in STATE_MUTATION_TARGET_KINDS:
        raise ValueError(f"Unsupported state mutation target kind: {value!r}")
    return normalized


def _normalize_state_mutation_operation(value: str) -> str:
    from core.db import STATE_MUTATION_OPERATIONS  # lazy to avoid cycle

    normalized = str(value or "").strip()
    if normalized not in STATE_MUTATION_OPERATIONS:
        raise ValueError(f"Unsupported state mutation operation: {value!r}")
    return normalized


def _normalize_state_mutation_target_key(value: str) -> str:
    normalized = str(value or "").strip()
    if not normalized:
        raise ValueError("State mutation target key is required.")
    return normalized[:200]


def _normalize_state_mutation_source_message_id(value) -> int | None:
    return _coerce_positive_int_local(value)


# ---------------------------------------------------------------------------
# 5. Image assets (initial analysis payload)
# ---------------------------------------------------------------------------

def _normalize_initial_image_analysis(value) -> dict | None:
    import json

    if isinstance(value, str):
        try:
            value = json.loads(value)
        except Exception:
            return None
    if not isinstance(value, dict):
        return None

    cleaned = {}
    analysis_method = str(value.get("analysis_method") or "").strip()
    if analysis_method:
        cleaned["analysis_method"] = analysis_method[:40]

    for key in ("ocr_text", "vision_summary", "assistant_guidance"):
        text = str(value.get(key) or "").strip()
        if text:
            cleaned[key] = text[:CONTENT_MAX_CHARS]

    key_points = value.get("key_points") if isinstance(value.get("key_points"), list) else []
    normalized_points = []
    for point in key_points[:8]:
        point_text = str(point or "").strip()
        if point_text and point_text not in normalized_points:
            normalized_points.append(point_text[:300])
    if normalized_points:
        cleaned["key_points"] = normalized_points

    return cleaned or None


# ---------------------------------------------------------------------------
# 6. Message metadata
# ---------------------------------------------------------------------------

def _normalize_message_attachment(entry) -> dict | None:
    if not isinstance(entry, dict):
        return None

    kind = str(entry.get("kind") or "").strip().lower()
    if kind not in {"image", "document", "video"}:
        return None

    cleaned = {"kind": kind}
    if kind == "image":
        image_id = str(entry.get("image_id") or "").strip()[:64]
        image_name = str(entry.get("image_name") or "").strip()[:255]
        image_mime_type = str(entry.get("image_mime_type") or "").strip()[:120]
        analysis_method = str(entry.get("analysis_method") or "").strip()[:40]
        ocr_text = str(entry.get("ocr_text") or "").strip()[:CONTENT_MAX_CHARS]
        vision_summary = str(entry.get("vision_summary") or "").strip()[:CONTENT_MAX_CHARS]
        assistant_guidance = str(entry.get("assistant_guidance") or "").strip()[:CONTENT_MAX_CHARS]
        key_points = entry.get("key_points") if isinstance(entry.get("key_points"), list) else []

        if image_id:
            cleaned["image_id"] = image_id
        if image_name:
            cleaned["image_name"] = image_name
        if image_mime_type:
            cleaned["image_mime_type"] = image_mime_type
        if analysis_method:
            cleaned["analysis_method"] = analysis_method
        if ocr_text:
            cleaned["ocr_text"] = ocr_text
        if vision_summary:
            cleaned["vision_summary"] = vision_summary
        if assistant_guidance:
            cleaned["assistant_guidance"] = assistant_guidance
        if key_points:
            normalized_points = []
            for point in key_points[:8]:
                point_text = str(point or "").strip()
                if point_text and point_text not in normalized_points:
                    normalized_points.append(point_text[:300])
            if normalized_points:
                cleaned["key_points"] = normalized_points

        if not cleaned.get("image_id") and not cleaned.get("image_name"):
            return None
        return cleaned

    if kind == "document":
        file_id = str(entry.get("file_id") or "").strip()[:64]
        file_name = str(entry.get("file_name") or "").strip()[:255]
        file_mime_type = str(entry.get("file_mime_type") or "").strip()[:120]
        file_context_block = str(entry.get("file_context_block") or "").strip()[:CONTENT_MAX_CHARS]
        submission_mode = str(entry.get("submission_mode") or "").strip().lower()[:20]
        canvas_mode = str(entry.get("canvas_mode") or "").strip().lower()[:40]
        visual_page_image_ids = (
            entry.get("visual_page_image_ids") if isinstance(entry.get("visual_page_image_ids"), list) else []
        )
        visual_page_numbers = entry.get("visual_page_numbers") if isinstance(entry.get("visual_page_numbers"), list) else []
        visual_failed_pages = entry.get("visual_failed_pages") if isinstance(entry.get("visual_failed_pages"), list) else []
        visual_page_count = entry.get("visual_page_count")
        visual_total_page_count = entry.get("visual_total_page_count")
        visual_page_limit = entry.get("visual_page_limit")

        if file_id:
            cleaned["file_id"] = file_id
        if file_name:
            cleaned["file_name"] = file_name
        if file_mime_type:
            cleaned["file_mime_type"] = file_mime_type
        if entry.get("file_text_truncated") is True:
            cleaned["file_text_truncated"] = True
        if file_context_block:
            cleaned["file_context_block"] = file_context_block
        if submission_mode in {"text", "visual"}:
            cleaned["submission_mode"] = submission_mode
        if canvas_mode:
            cleaned["canvas_mode"] = canvas_mode
        normalized_visual_page_ids = []
        for value in visual_page_image_ids[:8]:
            image_id = str(value or "").strip()[:64]
            if image_id and image_id not in normalized_visual_page_ids:
                normalized_visual_page_ids.append(image_id)
        if normalized_visual_page_ids:
            cleaned["visual_page_image_ids"] = normalized_visual_page_ids

        normalized_visual_page_numbers = []
        for value in visual_page_numbers[:16]:
            try:
                page_number = int(value)
            except (TypeError, ValueError):
                continue
            if page_number < 1 or page_number in normalized_visual_page_numbers:
                continue
            normalized_visual_page_numbers.append(page_number)
        if normalized_visual_page_numbers:
            cleaned["visual_page_numbers"] = normalized_visual_page_numbers

        normalized_visual_failed_pages = []
        for value in visual_failed_pages[:16]:
            try:
                page_number = int(value)
            except (TypeError, ValueError):
                continue
            if page_number < 1 or page_number in normalized_visual_failed_pages:
                continue
            normalized_visual_failed_pages.append(page_number)
        if normalized_visual_failed_pages:
            cleaned["visual_failed_pages"] = normalized_visual_failed_pages

        if entry.get("visual_pages_partial") is True:
            cleaned["visual_pages_partial"] = True

        try:
            page_count = int(visual_page_count)
        except (TypeError, ValueError):
            page_count = 0
        if page_count > 0:
            cleaned["visual_page_count"] = min(page_count, len(normalized_visual_page_ids) or page_count)
        try:
            total_page_count = int(visual_total_page_count)
        except (TypeError, ValueError):
            total_page_count = 0
        if total_page_count > 0:
            cleaned["visual_total_page_count"] = max(total_page_count, cleaned.get("visual_page_count") or 0)
        try:
            normalized_page_limit = int(visual_page_limit)
        except (TypeError, ValueError):
            normalized_page_limit = 0
        if normalized_page_limit > 0:
            cleaned["visual_page_limit"] = normalized_page_limit
        if entry.get("visual_pages_truncated") is True:
            cleaned["visual_pages_truncated"] = True

        if not cleaned.get("file_id") and not cleaned.get("file_name"):
            return None
        return cleaned

    if kind == "video":
        video_id = str(entry.get("video_id") or "").strip()[:64]
        video_title = str(entry.get("video_title") or "").strip()[:255]
        video_url = str(entry.get("video_url") or "").strip()[:2000]
        video_platform = str(entry.get("video_platform") or "").strip()[:40]
        transcript_context_block = str(entry.get("transcript_context_block") or "").strip()[:CONTENT_MAX_CHARS]
        transcript_language = str(entry.get("transcript_language") or "").strip()[:40]

        if video_id:
            cleaned["video_id"] = video_id
        if video_title:
            cleaned["video_title"] = video_title
        if video_url:
            cleaned["video_url"] = video_url
        if video_platform:
            cleaned["video_platform"] = video_platform
        if transcript_context_block:
            cleaned["transcript_context_block"] = transcript_context_block
        if transcript_language:
            cleaned["transcript_language"] = transcript_language
        if entry.get("transcript_text_truncated") is True:
            cleaned["transcript_text_truncated"] = True

        if not cleaned.get("video_id") and not cleaned.get("video_url"):
            return None
        return cleaned

    file_id = str(entry.get("file_id") or "").strip()[:64]
    file_name = str(entry.get("file_name") or "").strip()[:255]
    file_mime_type = str(entry.get("file_mime_type") or "").strip()[:120]
    file_context_block = str(entry.get("file_context_block") or "").strip()[:CONTENT_MAX_CHARS]
    submission_mode = str(entry.get("submission_mode") or "").strip().lower()[:20]
    canvas_mode = str(entry.get("canvas_mode") or "").strip().lower()[:40]
    visual_page_image_ids = (
        entry.get("visual_page_image_ids") if isinstance(entry.get("visual_page_image_ids"), list) else []
    )
    visual_page_numbers = entry.get("visual_page_numbers") if isinstance(entry.get("visual_page_numbers"), list) else []
    visual_failed_pages = entry.get("visual_failed_pages") if isinstance(entry.get("visual_failed_pages"), list) else []
    visual_page_count = entry.get("visual_page_count")
    visual_total_page_count = entry.get("visual_total_page_count")
    visual_page_limit = entry.get("visual_page_limit")

    if file_id:
        cleaned["file_id"] = file_id
    if file_name:
        cleaned["file_name"] = file_name
    if file_mime_type:
        cleaned["file_mime_type"] = file_mime_type
    if entry.get("file_text_truncated") is True:
        cleaned["file_text_truncated"] = True
    if file_context_block:
        cleaned["file_context_block"] = file_context_block
    if submission_mode in {"text", "visual"}:
        cleaned["submission_mode"] = submission_mode
    if canvas_mode:
        cleaned["canvas_mode"] = canvas_mode
    normalized_visual_page_ids = []
    for value in visual_page_image_ids[:8]:
        image_id = str(value or "").strip()[:64]
        if image_id and image_id not in normalized_visual_page_ids:
            normalized_visual_page_ids.append(image_id)
    if normalized_visual_page_ids:
        cleaned["visual_page_image_ids"] = normalized_visual_page_ids

    normalized_visual_page_numbers = []
    for value in visual_page_numbers[:16]:
        try:
            page_number = int(value)
        except (TypeError, ValueError):
            continue
        if page_number < 1 or page_number in normalized_visual_page_numbers:
            continue
        normalized_visual_page_numbers.append(page_number)
    if normalized_visual_page_numbers:
        cleaned["visual_page_numbers"] = normalized_visual_page_numbers

    normalized_visual_failed_pages = []
    for value in visual_failed_pages[:16]:
        try:
            page_number = int(value)
        except (TypeError, ValueError):
            continue
        if page_number < 1 or page_number in normalized_visual_failed_pages:
            continue
        normalized_visual_failed_pages.append(page_number)
    if normalized_visual_failed_pages:
        cleaned["visual_failed_pages"] = normalized_visual_failed_pages

    if entry.get("visual_pages_partial") is True:
        cleaned["visual_pages_partial"] = True

    try:
        page_count = int(visual_page_count)
    except (TypeError, ValueError):
        page_count = 0
    if page_count > 0:
        cleaned["visual_page_count"] = min(page_count, len(normalized_visual_page_ids) or page_count)
    try:
        total_page_count = int(visual_total_page_count)
    except (TypeError, ValueError):
        total_page_count = 0
    if total_page_count > 0:
        cleaned["visual_total_page_count"] = max(total_page_count, cleaned.get("visual_page_count") or 0)
    try:
        normalized_page_limit = int(visual_page_limit)
    except (TypeError, ValueError):
        normalized_page_limit = 0
    if normalized_page_limit > 0:
        cleaned["visual_page_limit"] = normalized_page_limit
    if entry.get("visual_pages_truncated") is True:
        cleaned["visual_pages_truncated"] = True

    if not cleaned.get("file_id") and not cleaned.get("file_name"):
        return None
    return cleaned


def _normalize_message_tool_calls(raw_tool_calls) -> list[dict]:
    import json

    from core.db import _compact_canvas_tool_call_arguments  # lazy to avoid cycle

    if isinstance(raw_tool_calls, str):
        try:
            raw_tool_calls = json.loads(raw_tool_calls)
        except Exception:
            return []

    if not isinstance(raw_tool_calls, list):
        return []

    normalized = []
    for entry in raw_tool_calls[:32]:
        if not isinstance(entry, dict):
            continue
        tool_id = str(entry.get("id") or "").strip()[:120]
        tool_type = str(entry.get("type") or "function").strip()[:40] or "function"
        function = entry.get("function") if isinstance(entry.get("function"), dict) else {}
        function_name = str(function.get("name") or "").strip()[:80]
        raw_arguments = _compact_canvas_tool_call_arguments(function_name, function.get("arguments"))
        if isinstance(raw_arguments, (dict, list)):
            arguments = json.dumps(raw_arguments, ensure_ascii=False)
        else:
            arguments = str(raw_arguments or "").strip()
        if not function_name:
            continue
        normalized.append(
            {
                "id": tool_id,
                "type": tool_type,
                "function": {
                    "name": function_name,
                    "arguments": arguments,
                },
            }
        )

    return normalized


def _normalize_usage_breakdown(breakdown: dict | None) -> dict | None:
    """Normalize usage breakdown without retroactive alignment.

    Previously this function attempted to align local token estimates with provider totals
    using unknown_provider_overhead and BREAKDOWN_REDUCTION_ORDER. This was over-engineering
    that produced misleading numbers. Now returns breakdown as-is (all values are estimates).
    """
    from core.db import (  # lazy to avoid cycle
        LEGACY_MESSAGE_USAGE_BREAKDOWN_KEYS,
        MESSAGE_USAGE_BREAKDOWN_KEYS,
    )

    if not isinstance(breakdown, dict):
        return None

    normalized_breakdown = {}
    for key in MESSAGE_USAGE_BREAKDOWN_KEYS:
        if key == "core_instructions":
            has_core_source = "core_instructions" in breakdown or any(
                legacy_key in breakdown for legacy_key in LEGACY_MESSAGE_USAGE_BREAKDOWN_KEYS.get(key, ())
            )
            if not has_core_source:
                normalized = None
            else:
                raw_total = breakdown.get("core_instructions")
                normalized = _coerce_non_negative_int_local(raw_total) or 0
                for legacy_key in LEGACY_MESSAGE_USAGE_BREAKDOWN_KEYS.get(key, ()):
                    normalized += _coerce_non_negative_int_local(breakdown.get(legacy_key)) or 0
        else:
            raw_value = breakdown.get(key)
            if raw_value is None:
                for legacy_key in LEGACY_MESSAGE_USAGE_BREAKDOWN_KEYS.get(key, ()):
                    if legacy_key in breakdown:
                        raw_value = breakdown.get(legacy_key)
                        break
            normalized = _coerce_non_negative_int_local(raw_value)
        if normalized is not None:
            normalized_breakdown[key] = normalized

    if not normalized_breakdown:
        return None

    # Return breakdown as-is - all values are estimates
    return {key: value for key, value in normalized_breakdown.items() if value and value > 0}


def _normalize_message_usage_call(value: dict | None) -> dict | None:
    if not isinstance(value, dict):
        return None

    cleaned = {}
    for key in (
        "index",
        "step",
        "message_count",
        "tool_schema_tokens",
        "prompt_tokens",
        "prompt_cache_hit_tokens",
        "prompt_cache_miss_tokens",
        "prompt_cache_write_tokens",
        "completion_tokens",
        "total_tokens",
        "estimated_input_tokens",
    ):
        normalized = _coerce_non_negative_int_local(value.get(key))
        if normalized is not None:
            cleaned[key] = normalized

    call_type = str(value.get("call_type") or "").strip()[:40]
    if call_type:
        cleaned["call_type"] = call_type

    retry_reason = str(value.get("retry_reason") or "").strip()[:80]
    if retry_reason:
        cleaned["retry_reason"] = retry_reason

    if value.get("is_retry") is True:
        cleaned["is_retry"] = True
    if value.get("missing_provider_usage") is True:
        cleaned["missing_provider_usage"] = True
    if value.get("cache_metrics_estimated") is True:
        cleaned["cache_metrics_estimated"] = True

    normalized_breakdown = _normalize_usage_breakdown(value.get("input_breakdown"))
    if normalized_breakdown:
        cleaned["input_breakdown"] = normalized_breakdown

    # Keep estimated_input_tokens as-is (local estimate), never overwrite with provider total
    if normalized_breakdown and cleaned.get("estimated_input_tokens") is None:
        cleaned["estimated_input_tokens"] = sum(normalized_breakdown.values())

    return cleaned or None


def _normalize_message_usage(value: dict | None) -> dict | None:
    if not isinstance(value, dict):
        return None

    cleaned = {}
    provider_usage_partial = value.get("provider_usage_partial") is True
    for key in (
        "prompt_tokens",
        "prompt_cache_hit_tokens",
        "prompt_cache_miss_tokens",
        "prompt_cache_write_tokens",
        "completion_tokens",
        "total_tokens",
        "estimated_input_tokens",
        "max_input_tokens_per_call",
        "configured_prompt_max_input_tokens",
    ):
        normalized = _coerce_non_negative_int_local(value.get(key))
        if normalized is not None:
            cleaned[key] = normalized

    normalized_breakdown = _normalize_usage_breakdown(value.get("input_breakdown"))
    if normalized_breakdown:
        cleaned["input_breakdown"] = normalized_breakdown

    model_calls = []
    raw_model_calls = value.get("model_calls") if isinstance(value.get("model_calls"), list) else []
    for entry in raw_model_calls[:32]:
        normalized_call = _normalize_message_usage_call(entry)
        if normalized_call:
            model_calls.append(normalized_call)
    if model_calls:
        cleaned["model_calls"] = model_calls

    model_call_count = _coerce_non_negative_int_local(value.get("model_call_count"))
    if model_call_count is None and model_calls:
        model_call_count = len(model_calls)
    elif model_call_count is not None and model_calls:
        model_call_count = max(model_call_count, len(model_calls))
    if model_call_count is not None:
        cleaned["model_call_count"] = model_call_count

    if value.get("cache_metrics_estimated") is True:
        cleaned["cache_metrics_estimated"] = True
    if provider_usage_partial:
        cleaned["provider_usage_partial"] = True

    currency = str(value.get("currency") or "").strip()[:16]
    if currency:
        cleaned["currency"] = currency

    provider = str(value.get("provider") or "").strip()[:40]
    if provider:
        cleaned["provider"] = provider

    model = str(value.get("model") or "").strip()[:80]
    if model:
        cleaned["model"] = model

    # Keep estimated_input_tokens as-is (local estimate), never overwrite with provider total
    if normalized_breakdown and cleaned.get("estimated_input_tokens") is None:
        cleaned["estimated_input_tokens"] = sum(normalized_breakdown.values())

    return cleaned or None


def _normalize_message_tool_result(entry: dict) -> dict | None:
    if not isinstance(entry, dict):
        return None

    tool_name = str(entry.get("tool_name") or "").strip()[:80]
    content = str(entry.get("content") or "").strip()[:RAG_TOOL_RESULT_MAX_TEXT_CHARS]
    if not tool_name or not content:
        return None

    cleaned = {
        "tool_name": tool_name,
        "content": content,
    }
    summary = str(entry.get("summary") or "").strip()[:RAG_TOOL_RESULT_SUMMARY_MAX_CHARS]
    if summary:
        cleaned["summary"] = summary
    input_preview = str(entry.get("input_preview") or "").strip()[:300]
    if input_preview:
        cleaned["input_preview"] = input_preview

    raw_content = str(entry.get("raw_content") or "").strip()[:get_runtime_setting("FETCH_RAW_TOOL_RESULT_MAX_TEXT_CHARS")]
    if raw_content:
        cleaned["raw_content"] = raw_content

    content_mode = str(entry.get("content_mode") or "").strip()[:80]
    if content_mode:
        cleaned["content_mode"] = content_mode

    summary_notice = str(entry.get("summary_notice") or "").strip()[:300]
    if summary_notice:
        cleaned["summary_notice"] = summary_notice

    for key, max_length in (
        ("recovery_hint", 300),
        ("fetch_diagnostic", 600),
        ("meta_description", 300),
        ("structured_data", 600),
        ("fetch_outcome", 120),
        ("model", 120),
        ("focus", 300),
        ("error", 400),
    ):
        value = str(entry.get(key) or "").strip()[:max_length]
        if value:
            cleaned[key] = value

    if isinstance(entry.get("cleanup_applied"), bool):
        cleaned["cleanup_applied"] = entry["cleanup_applied"]

    if entry.get("raw_content_available") is True:
        cleaned["raw_content_available"] = True

    token_estimate = _coerce_non_negative_int_local(entry.get("content_token_estimate"))
    if token_estimate is not None:
        cleaned["content_token_estimate"] = token_estimate

    content_char_count = _coerce_non_negative_int_local(entry.get("content_char_count"))
    if content_char_count is not None:
        cleaned["content_char_count"] = content_char_count

    return cleaned


def _normalize_message_tool_trace_entry(entry: dict) -> dict | None:
    from core.db import MESSAGE_TOOL_TRACE_STATES  # lazy to avoid cycle

    if not isinstance(entry, dict):
        return None

    tool_name = str(entry.get("tool_name") or entry.get("tool") or "").strip()[:80]
    if not tool_name:
        return None

    state = str(entry.get("state") or "").strip().lower()
    if state not in MESSAGE_TOOL_TRACE_STATES:
        state = "done"

    cleaned = {
        "tool_name": tool_name,
        "state": state,
    }

    step = _coerce_non_negative_int_local(entry.get("step"))
    if step is not None:
        cleaned["step"] = max(1, step)

    preview = str(entry.get("preview") or "").strip()[:300]
    if preview:
        cleaned["preview"] = preview

    summary = str(entry.get("summary") or "").strip()[:RAG_TOOL_RESULT_SUMMARY_MAX_CHARS]
    if summary:
        cleaned["summary"] = summary

    executed_at = str(entry.get("executed_at") or "").strip()[:40]
    if executed_at:
        cleaned["executed_at"] = executed_at

    if isinstance(entry.get("cached"), bool):
        cleaned["cached"] = entry["cached"]

    return cleaned


# ---------------------------------------------------------------------------
# 7. Clarification payloads
# ---------------------------------------------------------------------------

def _normalize_clarification_question_payload(value) -> dict | None:
    """Normalize one stored clarification question preserving every canonical field.

    Display text is sanitized; stable identifiers (id, option value) and
    dependency targets are preserved verbatim so the form can match them
    after a reload. Legacy string options are upgraded to the canonical
    object form on read so older stored messages still render.
    """
    if not isinstance(value, dict):
        return None

    label = str(value.get("label") or "").strip()[:300]
    if not label:
        return None

    cleaned: dict = {}

    raw_id = value.get("id")
    if isinstance(raw_id, str) and raw_id.strip():
        cleaned["id"] = raw_id.strip()[:80]

    cleaned["label"] = label

    raw_input_type = str(value.get("input_type") or "text").strip().lower()
    cleaned["input_type"] = raw_input_type if raw_input_type in {
        "text",
        "single_select",
        "multi_select",
    } else "text"

    if isinstance(value.get("required"), bool):
        cleaned["required"] = value["required"]
    else:
        cleaned["required"] = True

    placeholder = str(value.get("placeholder") or "").strip()[:200]
    if placeholder:
        cleaned["placeholder"] = placeholder

    if isinstance(value.get("allow_free_text"), bool):
        cleaned["allow_free_text"] = value["allow_free_text"]

    raw_options = value.get("options")
    if isinstance(raw_options, list):
        normalized_options: list[dict] = []
        for option in raw_options[:20]:
            normalized_option = _normalize_clarification_option_payload(option)
            if normalized_option is not None:
                normalized_options.append(normalized_option)
        if normalized_options:
            cleaned["options"] = normalized_options

    raw_depends_on = value.get("depends_on")
    normalized_depends_on = _normalize_clarification_dependency_payload(raw_depends_on)
    if normalized_depends_on is not None:
        cleaned["depends_on"] = normalized_depends_on

    return cleaned


def _normalize_clarification_option_payload(option) -> dict | None:
    if isinstance(option, str):
        text = option.strip()[:120]
        if not text:
            return None
        # Legacy: stored string options are upgraded to objects on read.
        return {"label": text, "value": text, "description": ""}
    if not isinstance(option, dict):
        return None
    label = str(option.get("label") or option.get("value") or "").strip()[:120]
    raw_value = option.get("value")
    value = str(raw_value if raw_value not in (None, "") else option.get("label") or "").strip()[:120]
    if not label or not value:
        return None
    description = str(option.get("description") or "").strip()[:200]
    normalized = {"label": label, "value": value}
    if description:
        normalized["description"] = description
    return normalized


def _normalize_clarification_dependency_payload(value) -> dict | None:
    if not isinstance(value, dict):
        return None
    question_id = str(value.get("question_id") or value.get("id") or "").strip()[:80]
    raw_values = value.get("values")
    if not question_id or not isinstance(raw_values, list):
        return None
    normalized_values: list[str] = []
    for raw_value in raw_values:
        text = str(raw_value or "").strip()[:120]
        if text and text not in normalized_values:
            normalized_values.append(text)
    if not normalized_values:
        return None
    return {"question_id": question_id, "values": normalized_values}


# ---------------------------------------------------------------------------
# 8. App settings
# ---------------------------------------------------------------------------

def _normalize_app_setting_value(key: str, value):
    from core.config import SCRATCHPAD_SECTION_SETTING_KEYS  # lazy to avoid cycle
    from core.db import (  # lazy to avoid cycle
        normalize_assistant_behavior_text,
        normalize_scratchpad_text,
    )

    if key == "scratchpad" or key in SCRATCHPAD_SECTION_SETTING_KEYS.values():
        return normalize_scratchpad_text(value)
    if key == "default_persona_id":
        return str(_coerce_positive_int_local(value) or "")
    if key in {"user_preferences", "general_instructions", "ai_personality"}:
        return normalize_assistant_behavior_text(value)
    return value


# Public re-export so callers can ``from core.normalize import normalize_persona_name``
# (the only non-``_normalize_*`` helper still defined here). The original helper
# lived alongside the user-profile normalizers in db.py.
def normalize_persona_name(value) -> str:
    return _clamped_text(value, MAX_PERSONA_NAME_LENGTH)
