from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

from utils.logging_config import get_logger

LOGGER = get_logger(__name__)

PROXY_OPERATION_OPENROUTER = "openrouter"
PROXY_OPERATION_PAGEFETCH = "pagefetch"
PROXY_OPERATION_KEYS = (PROXY_OPERATION_OPENROUTER, PROXY_OPERATION_PAGEFETCH)
DEFAULT_PROXY_ENABLED_OPERATIONS: list[str] = []
DEFAULT_PROXIES_PATH = Path(__file__).resolve().parents[1] / "proxy.yaml"

# ── defaults for pagefetch section ───────────────────────────────────────────

_PAGEFETCH_DEFAULTS: dict[str, Any] = {
    "mode": "auto",
    "provider": "none",
    "decodo_url": "",
    "dataimpulse_url": "",
    "proxies": [],
    "http_concurrency": 10,
    "browser_concurrency": 4,
    "http_timeout": 20,
    "browser_timeout": 45,
    "http_retries": 3,
    "browser_retries": 2,
    "cache_enabled": True,
    "cache_ttl": "24h",
    "auto_install": 1,
}


def _read_yaml(path: str | Path | None = None) -> dict[str, Any] | None:
    proxy_path = Path(path) if path is not None else DEFAULT_PROXIES_PATH
    try:
        raw = yaml.safe_load(proxy_path.read_text(encoding="utf-8"))
    except OSError:
        if path is None and not DEFAULT_PROXIES_PATH.exists():
            LOGGER.debug("No proxy file found at %s — proxies disabled", DEFAULT_PROXIES_PATH)
        return None
    except yaml.YAMLError as exc:
        LOGGER.warning("Invalid YAML in %s: %s — proxies disabled", proxy_path, exc)
        return None
    if not isinstance(raw, dict):
        return None
    return raw


def normalize_proxy_enabled_operations(raw_value: Any) -> list[str]:
    if raw_value in (None, ""):
        return list(DEFAULT_PROXY_ENABLED_OPERATIONS)

    if isinstance(raw_value, str):
        try:
            import json

            parsed = json.loads(raw_value)
        except Exception:
            return list(DEFAULT_PROXY_ENABLED_OPERATIONS)
    elif isinstance(raw_value, (list, tuple, set)):
        parsed = list(raw_value)
    else:
        return list(DEFAULT_PROXY_ENABLED_OPERATIONS)

    normalized: list[str] = []
    for item in parsed:
        candidate = str(item or "").strip().lower()
        if candidate in PROXY_OPERATION_KEYS and candidate not in normalized:
            normalized.append(candidate)
    return normalized


def is_proxy_operation_enabled(operation: str, raw_value: Any) -> bool:
    return str(operation or "").strip().lower() in normalize_proxy_enabled_operations(raw_value)


def load_proxies(path: str | Path | None = None) -> dict[str, list[str]]:
    """Load per-operation proxy URL lists from proxy.yaml.

    Supports both old flat-list format and new nested-object format.

    Old (still supported):
        openrouter: ["http://1.2.3.4:8080"]
        pagefetch: ["http://1.2.3.4:8080"]

    New:
        openrouter:
          proxies: ["http://1.2.3.4:8080"]
        pagefetch:
          proxies: ["http://1.2.3.4:8080"]
    """
    raw = _read_yaml(path)
    if raw is None:
        return {}

    proxies: dict[str, list[str]] = {}
    for op_key in PROXY_OPERATION_KEYS:
        section = raw.get(op_key)
        if section is None:
            continue

        entries: list[Any] = []
        if isinstance(section, list):
            # Old flat format:  pagefetch: ["http://...", ...]
            entries = section
        elif isinstance(section, dict):
            # New nested format: pagefetch: { proxies: ["http://..."] }
            entries = section.get("proxies", [])

        if not isinstance(entries, list):
            continue

        op_proxies: list[str] = []
        for entry in entries:
            value = str(entry or "").strip()
            if value and value not in op_proxies:
                op_proxies.append(value)
        if op_proxies:
            proxies[op_key] = op_proxies

    return proxies


def get_proxy_candidates_for_operation(
    operation: str,
    *,
    include_direct_fallback: bool = False,
    settings: dict | None = None,
) -> list[str | None]:
    if settings is None:
        from core.db import get_app_settings

        settings = get_app_settings()
    enabled = normalize_proxy_enabled_operations(
        settings.get("proxy_enabled_operations") if isinstance(settings, dict) else None
    )
    op_key = str(operation or "").strip().lower()
    if op_key not in enabled:
        return [None]

    all_proxies = load_proxies()
    candidates: list[str | None] = list(all_proxies.get(op_key, []))
    if include_direct_fallback or not candidates:
        candidates.append(None)
    return candidates


def load_pagefetch_config(path: str | Path | None = None) -> dict[str, Any]:
    """Load PageFetch configuration from the ``pagefetch`` section of proxy.yaml.

    Falls back to environment variables (PAGEFETCH_*) for backward
    compatibility, then to built-in defaults.

    Returns a flat dict suitable for passing to ``PageFetch(**result)``.
    """
    raw = _read_yaml(path)
    section: dict[str, Any] = {}
    if raw is not None:
        section = raw.get("pagefetch", {})
    if not isinstance(section, dict):
        section = {}

    env = __import__("os").environ  # keep import lazy

    def _pick(yaml_key: str, env_key: str, default: Any, *, coerce: type | None = None) -> Any:
        """Value precedence: proxy.yaml > env var > default."""
        val = section.get(yaml_key)
        if val is not None:
            if coerce is not None:
                try:
                    val = coerce(val)
                except (ValueError, TypeError):
                    val = default
            return val
        val = env.get(env_key)
        if val is not None and val != "":
            if coerce is not None:
                try:
                    val = coerce(val)
                except (ValueError, TypeError):
                    val = default
            return val
        return default

    config: dict[str, Any] = {
        "mode": _pick("mode", "PAGEFETCH_MODE", "auto"),
        "proxy": _pick("provider", "PAGEFETCH_PROXY", "none"),
        "decodo_url": _pick("decodo_url", "DECODO_PROXY_URL", ""),
        "dataimpulse_url": _pick("dataimpulse_url", "DATAIMPULSE_PROXY_URL", ""),
        "http_concurrency": _pick("http_concurrency", "PAGEFETCH_HTTP_CONCURRENCY", 10, coerce=int),
        "browser_concurrency": _pick("browser_concurrency", "PAGEFETCH_BROWSER_CONCURRENCY", 4, coerce=int),
        "http_timeout": _pick("http_timeout", "PAGEFETCH_HTTP_TIMEOUT_SECONDS", 20.0, coerce=float),
        "browser_timeout": _pick("browser_timeout", "PAGEFETCH_BROWSER_TIMEOUT_SECONDS", 45.0, coerce=float),
        "http_retries": _pick("http_retries", "PAGEFETCH_HTTP_RETRIES", 3, coerce=int),
        "browser_retries": _pick("browser_retries", "PAGEFETCH_BROWSER_RETRIES", 2, coerce=int),
        "cache_enabled": _pick("cache_enabled", "PAGEFETCH_CACHE_ENABLED", True, coerce=lambda v: str(v).lower() in ("true", "1", "yes", "on")),
        "cache_ttl": _pick("cache_ttl", "PAGEFETCH_CACHE_TTL", "24h"),
        "auto_install": _pick("auto_install", "PAGEFETCH_AUTO_INSTALL", 1, coerce=int),
    }
    return config
