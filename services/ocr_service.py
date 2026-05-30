from __future__ import annotations

import os
import warnings
import threading
from contextlib import redirect_stderr, redirect_stdout
from io import BytesIO, StringIO

from core.config import (
    OCR_DISABLED_FEATURE_ERROR,
    OCR_ENABLED,
    OCR_PRELOAD_ON_STARTUP,
)
from utils.image_utils import optimize_image_for_processing
from utils.logging_config import get_logger

LOGGER = get_logger(__name__)

_ocr_engine = None
_ocr_engine_lock = threading.Lock()


def _configure_paddle_runtime() -> None:
    os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")
    os.environ.setdefault("FLAGS_enable_pir_api", "False")
    os.environ.setdefault("FLAGS_enable_pir_in_executor", "False")
    os.environ.setdefault("FLAGS_use_mkldnn", "False")
    os.environ.setdefault("FLAGS_use_onednn", "False")

    import paddle

    try:
        paddle.set_flags(
            {
                "FLAGS_enable_pir_api": False,
                "FLAGS_enable_pir_in_executor": False,
                "FLAGS_use_mkldnn": False,
                "FLAGS_use_onednn": False,
            }
        )
    except Exception:
        pass


def _build_paddleocr_engine() -> dict:
    try:
        with warnings.catch_warnings(), redirect_stdout(StringIO()), redirect_stderr(StringIO()):
            warnings.filterwarnings("ignore", message=r"No ccache found.*")
            _configure_paddle_runtime()
            from paddleocr import PaddleOCR

            reader = PaddleOCR(
                use_doc_orientation_classify=False,
                use_doc_unwarping=False,
                use_textline_orientation=False,
            )
    except ImportError as exc:
        raise RuntimeError(
            "PaddleOCR dependencies are missing. Ensure paddleocr and a compatible paddlepaddle runtime are installed."
        ) from exc
    return {
        "provider": "paddleocr",
        "reader": reader,
    }


def get_ocr_engine() -> dict:
    global _ocr_engine

    if not OCR_ENABLED:
        raise RuntimeError(OCR_DISABLED_FEATURE_ERROR)

    if _ocr_engine is not None:
        return _ocr_engine

    with _ocr_engine_lock:
        if _ocr_engine is not None:
            return _ocr_engine

        try:
            _ocr_engine = _build_paddleocr_engine()
        except RuntimeError:
            raise

        return _ocr_engine


def preload_ocr_engine(app) -> None:
    if not OCR_ENABLED or not OCR_PRELOAD_ON_STARTUP:
        return

    is_reloader_child = os.environ.get("WERKZEUG_RUN_MAIN") == "true"
    if app.debug and not is_reloader_child:
        LOGGER.info("Flask reloader main process: OCR preload skipped.")
        return

    LOGGER.info("Loading OCR engine (paddleocr)...")
    try:
        get_ocr_engine()
    except RuntimeError as exc:
        LOGGER.info("OCR preload skipped: %s", exc)
        return

    LOGGER.info("OCR engine ready (paddleocr).")


def _dedupe_preserve_order(values: list[str]) -> list[str]:
    seen = set()
    deduped = []
    for value in values:
        normalized = str(value or "").strip()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        deduped.append(normalized)
    return deduped


def _coerce_mapping(value):
    if isinstance(value, dict):
        return value

    keys = getattr(value, "keys", None)
    if callable(keys):
        try:
            return {key: value[key] for key in value.keys()}
        except Exception:
            pass

    to_dict = getattr(value, "to_dict", None)
    if callable(to_dict):
        try:
            result = to_dict()
            if isinstance(result, dict):
                return result
        except Exception:
            pass

    raw_dict = getattr(value, "__dict__", None)
    if isinstance(raw_dict, dict):
        return raw_dict

    return None


def _extract_paddle_text_lines(value) -> list[str]:
    if isinstance(value, (list, tuple)):
        lines = []
        for item in value:
            lines.extend(_extract_paddle_text_lines(item))
        return _dedupe_preserve_order(lines)

    mapping = _coerce_mapping(value)
    if mapping is None:
        return []

    direct_texts = mapping.get("rec_texts")
    if isinstance(direct_texts, list):
        return _dedupe_preserve_order([str(item or "").strip() for item in direct_texts])

    single_text = str(mapping.get("rec_text") or mapping.get("text") or "").strip()
    if single_text:
        return [single_text]

    nested_lines = []
    for key in ("res", "result", "prunedResult", "ocrResults"):
        nested_lines.extend(_extract_paddle_text_lines(mapping.get(key)))
    return _dedupe_preserve_order(nested_lines)


def _run_paddleocr(image_bytes: bytes) -> str:
    try:
        import numpy as np
        from PIL import Image
    except ImportError as exc:
        raise RuntimeError("Pillow and numpy are required for PaddleOCR image processing.") from exc

    engine = get_ocr_engine()
    reader = engine["reader"]
    with Image.open(BytesIO(image_bytes)) as image:
        image = image.convert("RGB")
        image_array = np.array(image)

    result = reader.predict(
        input=image_array,
        use_doc_orientation_classify=False,
        use_doc_unwarping=False,
        use_textline_orientation=False,
    )
    lines = _extract_paddle_text_lines(result)
    return "\n".join(lines).strip()


def extract_image_text(image_bytes: bytes, mime_type: str) -> str:
    if not OCR_ENABLED:
        raise RuntimeError(OCR_DISABLED_FEATURE_ERROR)

    optimized_bytes, _ = optimize_image_for_processing(image_bytes, mime_type, purpose="ocr")
    return _run_paddleocr(optimized_bytes)
