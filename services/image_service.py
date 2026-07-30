from __future__ import annotations

import base64

from core.config import (
    IMAGE_UPLOADS_DISABLED_FEATURE_ERROR,
    coerce_image_helper_max_images,
    get_runtime_setting,
)
from core.prompts import get_prompt
from utils.image_utils import (
    build_image_analysis_prompt,
    extract_json_object,
    extract_text_from_response_content,
    normalize_freeform_answer_text,
    normalize_image_analysis,
    optimize_image_for_processing,
)
from lib.model_registry import (
    apply_model_target_request_options,
    can_model_process_images,
    can_model_use_structured_outputs,
    get_image_helper_model_id,
    normalize_image_processing_method,
    resolve_model_target,
)
from services.ocr_service import extract_image_text


def _build_multimodal_request(image_url: str, prompt_text: str) -> list[dict]:
    return [
        {
            "role": "user",
            "content": [
                {"type": "text", "text": prompt_text},
                {"type": "image_url", "image_url": {"url": image_url}},
            ],
        }
    ]


def _resolve_helper_model_id(settings: dict | None = None, *, fallback_model_id: str = "") -> str:
    candidate = get_image_helper_model_id(settings)
    if candidate and can_model_process_images(candidate, settings):
        return candidate

    fallback_candidate = str(fallback_model_id or "").strip()
    if fallback_candidate and can_model_process_images(fallback_candidate, settings):
        return fallback_candidate

    return ""


def can_answer_image_questions(settings: dict | None = None, *, fallback_model_id: str = "") -> bool:
    return bool(_resolve_helper_model_id(settings, fallback_model_id=fallback_model_id))


def _run_helper_llm_image_analysis(
    image_bytes: bytes,
    mime_type: str,
    *,
    user_text: str = "",
    model_id: str,
    settings: dict | None = None,
    conversation_id: int | None = None,
    source_message_id: int | None = None,
) -> dict:
    helper_model_id = _resolve_helper_model_id(settings, fallback_model_id=model_id)
    if not helper_model_id:
        raise RuntimeError("No helper image model is available for visual analysis.")

    optimized_bytes, optimized_mime_type = optimize_image_for_processing(image_bytes, mime_type, purpose="vision")
    image_b64 = base64.b64encode(optimized_bytes).decode("utf-8")
    image_url = f"data:{optimized_mime_type};base64,{image_b64}"
    target = resolve_model_target(helper_model_id, settings)

    request_kwargs = {
        "model": target["api_model"],
        "messages": _build_multimodal_request(image_url, build_image_analysis_prompt(user_text=user_text)),
        "temperature": 0.2,
    }
    if can_model_use_structured_outputs(helper_model_id, settings):
        request_kwargs["response_format"] = {
            "type": "json_schema",
            "json_schema": {
                "name": "image_analysis",
                "strict": True,
                "schema": {
                    "type": "object",
                    "properties": {
                        "vision_summary": {
                            "type": "string",
                            "description": "Concise non-text visual summary in English.",
                        },
                        "key_points": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "Short English bullets with relevant visual observations.",
                        },
                        "assistant_guidance": {
                            "type": "string",
                            "description": "One short English sentence telling a downstream LLM how to use the analysis.",
                        },
                    },
                    "required": ["vision_summary", "key_points", "assistant_guidance"],
                    "additionalProperties": False,
                },
            },
        }

    request_kwargs = apply_model_target_request_options(request_kwargs, target)
    from services.activity_service import ActivityTimer, STATUS_OK, STATUS_ERROR, extract_usage_from_response, log_activity_call
    from services.activity_types import ActivityCallParams
    _timer = ActivityTimer()
    try:
        with _timer:
            response = target["client"].chat.completions.create(**request_kwargs)
    except Exception as _exc:
        log_activity_call(
            conversation_id=max(0, int(conversation_id or 0)),
            params={
                "provider": str((target.get("record") or {}).get("provider") or ""),
                "api_model": str(target.get("api_model") or ""),
                "operation": "image_analysis",
                "call_type": "image_analysis",
                "request_payload": _sanitize_request_payload_for_activity(request_kwargs),
                "response_status": STATUS_ERROR,
                "error_type": type(_exc).__name__,
                "error_message": str(_exc),
                "latency_ms": _timer.elapsed_ms,
                "source_message_id": source_message_id,
            },
        )
        raise
    _usage = extract_usage_from_response(response)
    _log_params: ActivityCallParams = {
        "provider": str((target.get("record") or {}).get("provider") or ""),
        "api_model": str(target.get("api_model") or ""),
        "operation": "image_analysis",
        "call_type": "image_analysis",
        "request_payload": _sanitize_request_payload_for_activity(request_kwargs),
        "response_status": STATUS_OK,
        "latency_ms": _timer.elapsed_ms,
        "source_message_id": source_message_id,
    }
    if _usage:
        _log_params.update(_usage)
    log_activity_call(
        conversation_id=max(0, int(conversation_id or 0)),
        params=_log_params,
    )
    choice = response.choices[0] if getattr(response, "choices", None) else None
    message = getattr(choice, "message", None) if choice else None
    raw_output = extract_text_from_response_content(getattr(message, "content", "")).strip()
    parsed_output = extract_json_object(raw_output)
    normalized = normalize_image_analysis(parsed_output, fallback_text=raw_output)
    normalized["analysis_method"] = "multimodal"
    return normalized


def _prepare_direct_multimodal_analysis(model_id: str, settings: dict | None = None) -> dict:
    if not model_id or not can_model_process_images(model_id, settings):
        raise RuntimeError("The selected chat model does not support direct image input.")
    return normalize_image_analysis(
        {
            "analysis_method": "multimodal",
            "assistant_guidance": get_prompt("image.analysis.multimodal_assistant_guidance"),
        }
    )


def _run_local_ocr_analysis(image_bytes: bytes, mime_type: str) -> dict:
    if not get_runtime_setting("OCR_ENABLED"):
        raise RuntimeError("Local OCR is disabled.")
    return {
        "ocr_text": extract_image_text(image_bytes, mime_type),
        "analysis_method": "local_ocr",
    }


def _resolve_processing_plan(processing_method: str, model_id: str, settings: dict | None = None) -> list[str]:
    multimodal_available = bool(model_id and can_model_process_images(model_id, settings))

    if processing_method == "multimodal":
        if multimodal_available:
            return ["multimodal"]
        return ["local_ocr"]
    if processing_method == "local_ocr":
        return ["local_ocr"]

    # Default fallback
    if multimodal_available:
        return ["multimodal"]
    return ["local_ocr"]


def analyze_uploaded_image(
    image_bytes: bytes,
    mime_type: str,
    user_text: str = "",
    *,
    model_id: str = "",
    settings: dict | None = None,
    processing_method: str = "multimodal",
    conversation_id: int | None = None,
    source_message_id: int | None = None,
) -> dict:
    if not get_runtime_setting("IMAGE_UPLOADS_ENABLED"):
        raise RuntimeError(IMAGE_UPLOADS_DISABLED_FEATURE_ERROR)

    normalized_method = normalize_image_processing_method(processing_method)
    last_error: Exception | None = None

    for step in _resolve_processing_plan(normalized_method, model_id, settings):
        try:
            if step == "multimodal":
                return _prepare_direct_multimodal_analysis(model_id, settings)
            if step == "local_ocr":
                return normalize_image_analysis(_run_local_ocr_analysis(image_bytes, mime_type))
        except Exception as exc:
            last_error = exc

    if last_error is not None:
        raise last_error
    raise RuntimeError("No image processing method is currently available.")


def answer_image_question(
    image_bytes: bytes,
    mime_type: str,
    question: str,
    initial_analysis: dict | None = None,
    *,
    settings: dict | None = None,
    model_id: str = "",
    conversation_id: int | None = None,
    source_message_id: int | None = None,
) -> str:
    normalized_question = str(question or "").strip()
    if not normalized_question:
        raise ValueError("question is required.")

    helper_model_id = _resolve_helper_model_id(settings, fallback_model_id=model_id)
    if not helper_model_id:
        raise RuntimeError("No helper image model is available for follow-up image questions.")

    optimized_bytes, optimized_mime_type = optimize_image_for_processing(image_bytes, mime_type, purpose="vision")
    image_b64 = base64.b64encode(optimized_bytes).decode("utf-8")
    image_url = f"data:{optimized_mime_type};base64,{image_b64}"

    analysis = initial_analysis if isinstance(initial_analysis, dict) else {}
    analysis_method = str(analysis.get("analysis_method") or "").strip()
    summary = str(analysis.get("vision_summary") or "").strip()
    guidance = str(analysis.get("assistant_guidance") or "").strip()
    ocr_text = str(analysis.get("ocr_text") or "").strip()
    key_points = analysis.get("key_points") if isinstance(analysis.get("key_points"), list) else []

    prompt_parts = [
        get_prompt("image.followup.intro"),
        get_prompt("image.followup.source_truth"),
        get_prompt("image.followup.language"),
        f"User question: {normalized_question}",
    ]
    if analysis_method:
        prompt_parts.append(f"Stored analysis source: {analysis_method}")
    if summary:
        prompt_parts.append(f"Stored summary hint: {summary}")
    if key_points:
        prompt_parts.append("Stored key observations:\n- " + "\n- ".join(str(point) for point in key_points if str(point or "").strip()))
    if guidance:
        prompt_parts.append(f"Stored guidance hint: {guidance}")
    if ocr_text:
        prompt_parts.append(f"Stored OCR hint: {ocr_text[:1500]}")
    prompt_parts.append(
        get_prompt("image.followup.answer_footer")
    )

    target = resolve_model_target(helper_model_id, settings)
    request_kwargs = {
        "model": target["api_model"],
        "messages": _build_multimodal_request(image_url, "\n".join(prompt_parts)),
        "temperature": 0.2,
    }
    request_kwargs = apply_model_target_request_options(request_kwargs, target)
    from services.activity_service import ActivityTimer, STATUS_OK, STATUS_ERROR, extract_usage_from_response, log_activity_call
    from services.activity_types import ActivityCallParams
    _timer = ActivityTimer()
    try:
        with _timer:
            response = target["client"].chat.completions.create(**request_kwargs)
    except Exception as _exc:
        log_activity_call(
            conversation_id=max(0, int(conversation_id or 0)),
            params={
                "provider": str((target.get("record") or {}).get("provider") or ""),
                "api_model": str(target.get("api_model") or ""),
                "operation": "image_question",
                "call_type": "image_question",
                "request_payload": _sanitize_request_payload_for_activity(request_kwargs),
                "response_status": STATUS_ERROR,
                "error_type": type(_exc).__name__,
                "error_message": str(_exc),
                "latency_ms": _timer.elapsed_ms,
                "source_message_id": source_message_id,
            },
        )
        raise
    _usage = extract_usage_from_response(response)
    _log_params: ActivityCallParams = {
        "provider": str((target.get("record") or {}).get("provider") or ""),
        "api_model": str(target.get("api_model") or ""),
        "operation": "image_question",
        "call_type": "image_question",
        "request_payload": _sanitize_request_payload_for_activity(request_kwargs),
        "response_status": STATUS_OK,
        "latency_ms": _timer.elapsed_ms,
        "source_message_id": source_message_id,
    }
    if _usage:
        _log_params.update(_usage)
    log_activity_call(
        conversation_id=max(0, int(conversation_id or 0)),
        params=_log_params,
    )
    choice = response.choices[0] if getattr(response, "choices", None) else None
    message = getattr(choice, "message", None) if choice else None
    raw_output = extract_text_from_response_content(getattr(message, "content", "")).strip()
    answer = normalize_freeform_answer_text(raw_output)
    if not answer:
        raise RuntimeError("Image follow-up model returned an empty answer.")
    return answer


def _sanitize_request_payload_for_activity(request_kwargs: dict) -> dict:
    """Return a copy of request_kwargs safe for activity logging.

    Strips base64 data URLs from image_url content blocks to prevent
    raw image bytes from leaking into the activity/invocation log.
    """
    import copy

    safe = copy.deepcopy(request_kwargs)
    messages = safe.get("messages")
    if not isinstance(messages, list):
        return safe
    for msg in messages:
        content = msg.get("content") if isinstance(msg, dict) else None
        if not isinstance(content, list):
            continue
        for block in content:
            if not isinstance(block, dict):
                continue
            image_url = block.get("image_url") if isinstance(block.get("image_url"), dict) else None
            if image_url and isinstance(image_url.get("url"), str):
                url_val = image_url["url"]
                if url_val.startswith("data:"):
                    mime_prefix = url_val.split(";")[0] if ";" in url_val else url_val.split(",")[0]
                    image_url["url"] = f"{mime_prefix};base64,<stripped>"
    return safe


def analyze_images_with_vl(
    image_ids: list[str],
    question: str,
    *,
    conversation_id: int,
    settings: dict | None = None,
    source_message_id: int | None = None,
) -> dict:
    """Answer a question about one or more conversation-scoped images.

    Sends the question and up to ``image_helper_max_images`` images to the
    configured vision-language helper model. On VL failure, falls back to
    local OCR when available.

    Returns a dict with keys: ``answer``, ``image_ids``, ``helper_model``,
    ``usage``, ``fallback_ocr``, ``fallback_details``.
    """
    from core.db import (
        get_image_asset,
        list_conversation_image_assets,
        read_image_asset_bytes,
    )

    normalized_question = str(question or "").strip()
    if not normalized_question:
        raise ValueError("question is required.")

    max_images = coerce_image_helper_max_images(settings)
    if len(image_ids) > max_images:
        raise ValueError(
            f"Too many images: {len(image_ids)} requested, max {max_images} allowed."
        )

    helper_model_id = _resolve_helper_model_id(settings)
    if not helper_model_id:
        raise RuntimeError("No vision-capable helper model is configured. Set one in Settings > Image processing.")

    # Resolve all images — they must belong to this conversation and remain
    # visible.  In particular, do not allow a remembered ID to revive an image
    # from a deleted message.
    visible_image_ids = {
        asset["image_id"] for asset in list_conversation_image_assets(conversation_id)
    }
    assets: list[dict] = []
    for img_id in image_ids:
        normalized_id = str(img_id or "").strip()
        if not normalized_id:
            raise ValueError("Invalid empty image_id.")
        if normalized_id not in visible_image_ids:
            raise ValueError(f"Image '{normalized_id}' is not available in this conversation.")
        asset = get_image_asset(normalized_id, conversation_id=conversation_id)
        if not asset:
            raise ValueError(f"Image '{normalized_id}' not found in this conversation.")
        assets.append(asset)

    # Build multimodal request with all images
    image_urls: list[str] = []
    for asset in assets:
        _, img_bytes = read_image_asset_bytes(asset["image_id"], conversation_id=conversation_id)
        if img_bytes is None:
            raise RuntimeError(f"Image '{asset['image_id']}' file is missing from disk.")
        optimized_bytes, optimized_mime = optimize_image_for_processing(
            img_bytes, asset.get("mime_type", "image/png"), purpose="vision"
        )
        image_b64 = base64.b64encode(optimized_bytes).decode("utf-8")
        image_urls.append(f"data:{optimized_mime};base64,{image_b64}")

    content_blocks: list[dict] = [{"type": "text", "text": normalized_question}]
    for url in image_urls:
        content_blocks.append({"type": "image_url", "image_url": {"url": url}})

    target = resolve_model_target(helper_model_id, settings)
    request_kwargs = {
        "model": target["api_model"],
        "messages": [{"role": "user", "content": content_blocks}],
        "temperature": 0.2,
    }
    request_kwargs = apply_model_target_request_options(request_kwargs, target)

    from services.activity_service import (
        ActivityTimer,
        STATUS_ERROR,
        STATUS_OK,
        extract_usage_from_response,
        log_activity_call,
    )
    _timer = ActivityTimer()

    # --- VL attempt ---
    try:
        with _timer:
            response = target["client"].chat.completions.create(**request_kwargs)
    except Exception as _exc:
        log_activity_call(
            conversation_id=max(0, int(conversation_id)),
            params={
                "provider": str((target.get("record") or {}).get("provider") or ""),
                "api_model": str(target.get("api_model") or ""),
                "operation": "analyze_images",
                "call_type": "analyze_images",
                "request_payload": _sanitize_request_payload_for_activity(request_kwargs),
                "response_status": STATUS_ERROR,
                "error_type": type(_exc).__name__,
                "error_message": str(_exc),
                "latency_ms": _timer.elapsed_ms,
                "source_message_id": source_message_id,
            },
        )
        # Fall back to OCR
        if not get_runtime_setting("OCR_ENABLED"):
            raise RuntimeError(
                f"Vision helper model failed ({type(_exc).__name__}) and OCR is disabled."
            ) from _exc
        return _fallback_ocr_for_images(assets, normalized_question, conversation_id, source_message_id,
                                        vl_error=str(_exc), vl_latency_ms=_timer.elapsed_ms)

    _usage = extract_usage_from_response(response)
    log_activity_call(
        conversation_id=max(0, int(conversation_id)),
        params={
            "provider": str((target.get("record") or {}).get("provider") or ""),
            "api_model": str(target.get("api_model") or ""),
            "operation": "analyze_images",
            "call_type": "analyze_images",
            "request_payload": _sanitize_request_payload_for_activity(request_kwargs),
            "response_status": STATUS_OK,
            "latency_ms": _timer.elapsed_ms,
            "source_message_id": source_message_id,
            **(_usage or {}),
        },
    )

    choice = response.choices[0] if getattr(response, "choices", None) else None
    message = getattr(choice, "message", None) if choice else None
    answer = normalize_freeform_answer_text(
        extract_text_from_response_content(getattr(message, "content", "")).strip()
    )
    if not answer:
        answer = "(The vision model returned an empty response.)"

    return {
        "answer": answer,
        "image_ids": [a["image_id"] for a in assets],
        "helper_model": helper_model_id,
        "usage": _usage or {},
        "fallback_ocr": False,
        "fallback_details": None,
    }


def _fallback_ocr_for_images(
    assets: list[dict],
    question: str,
    conversation_id: int,
    source_message_id: int | None,
    vl_error: str = "",
    vl_latency_ms: int = 0,
) -> dict:
    """Run OCR on each image and return a degraded result."""
    from core.db import read_image_asset_bytes

    ocr_results: list[dict] = []
    for asset in assets:
        _, img_bytes = read_image_asset_bytes(asset["image_id"], conversation_id=conversation_id)
        if img_bytes is None:
            ocr_results.append({"image_id": asset["image_id"], "error": "image file missing"})
            continue
        try:
            ocr_text = extract_image_text(img_bytes, asset.get("mime_type", "image/png"))
            ocr_results.append({"image_id": asset["image_id"], "ocr_text": ocr_text})
        except Exception as _exc:
            ocr_results.append({"image_id": asset["image_id"], "error": str(_exc)})

    combined_ocr = "\n\n".join(
        f"--- Image {r['image_id'][:8]} ---\n{r.get('ocr_text') or r.get('error', 'OCR failed')}"
        for r in ocr_results
    )
    answer = (
        f"[OCR fallback — VL model unavailable: {vl_error}]\n\n"
        f"Question: {question}\n\n"
        f"Extracted text:\n{combined_ocr}"
    )
    return {
        "answer": answer,
        "image_ids": [a["image_id"] for a in assets],
        "helper_model": "ocr_fallback",
        "usage": {},
        "fallback_ocr": True,
        "fallback_details": {
            "vl_error": vl_error,
            "vl_latency_ms": vl_latency_ms,
            "ocr_results": ocr_results,
        },
    }
