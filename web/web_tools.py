from __future__ import annotations

import asyncio
import contextlib
import hashlib
import ipaddress
import json
import os
import re
import socket
import unicodedata
from concurrent.futures import ThreadPoolExecutor
from typing import Any
from urllib.parse import quote, urlencode, urlparse

import httpx

from core.config import (
    CONTENT_MAX_CHARS,
    DEFAULT_SEARCH_TOOL_QUERY_LIMIT,
    SEARCH_MAX_RESULTS,
)
from core.db import (
    cache_get,
    cache_set,
    get_app_settings,
)
from core.db import (
    get_search_tool_query_limit as load_search_tool_query_limit,
)
from utils.logging_config import get_logger
from utils import proxy_settings
from services.scholar_scraper import search_scholar as search_scholar_tool

LOGGER = get_logger(__name__)
BRIGHT_DATA_ENDPOINT = "https://api.brightdata.com/request"
_GN_LANG = {
    "tr": {"hl": "tr", "gl": "TR"},
    "en": {"hl": "en", "gl": "US"},
}
_NEWS_TIME_FILTERS = {"d": "qdr:d", "w": "qdr:w", "m": "qdr:m", "y": "qdr:y"}
_ZERO_WIDTH_TRANSLATION = dict.fromkeys(map(ord, "\u200b\u200c\u200d\ufeff"), None)


def _bright_data_setting(name: str, default: str) -> str:
    """Read non-secret Bright Data preferences from the Settings page."""
    try:
        value = get_app_settings().get(name, default)
    except Exception:
        value = default
    return str(value or default).strip()


def _bright_data_credentials() -> tuple[str, str]:
    api_key = str(os.getenv("BRIGHT_DATA_API_KEY") or "").strip()
    zone = str(os.getenv("BRIGHT_DATA_SERP_ZONE") or "").strip()
    if not api_key or not zone:
        raise RuntimeError(
            "Bright Data SERP is not configured. Set BRIGHT_DATA_API_KEY "
            "and BRIGHT_DATA_SERP_ZONE."
        )
    return api_key, zone


def _bright_data_serp_request(target_url: str) -> dict[str, Any]:
    """Request a fast parsed SERP response from Bright Data."""
    api_key, zone = _bright_data_credentials()
    payload = {
        "zone": zone,
        "url": target_url,
        "format": "raw",
        "data_format": "parsed_light",
    }
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    try:
        timeout = float(_bright_data_setting("bright_data_serp_timeout_seconds", "30"))
    except ValueError:
        timeout = 30.0
    timeout = max(1.0, min(120.0, timeout))

    LOGGER.debug("Bright Data SERP request target=%s", urlparse(target_url).netloc)
    try:
        with httpx.Client(timeout=timeout, trust_env=False) as client:
            response = client.post(BRIGHT_DATA_ENDPOINT, headers=headers, json=payload)
    except httpx.RequestError as exc:
        raise RuntimeError(f"Bright Data SERP connection failed: {exc}") from exc

    if response.status_code in {401, 403}:
        raise RuntimeError(
            "Bright Data SERP authentication failed; check the API key and zone."
        )
    if response.status_code == 429:
        raise RuntimeError("Bright Data SERP rate limit exceeded.")
    try:
        response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        raise RuntimeError(
            f"Bright Data SERP returned HTTP {response.status_code}."
        ) from exc

    try:
        body = response.json()
    except (json.JSONDecodeError, ValueError) as exc:
        raise RuntimeError("Bright Data SERP returned an invalid JSON response.") from exc
    if not isinstance(body, dict):
        raise RuntimeError("Bright Data SERP returned an unexpected response.")
    return body


def _build_google_url(
    query: str,
    *,
    lang: str | None = None,
    country: str | None = None,
    news: bool = False,
    when: str | None = None,
) -> str:
    default_lang = _bright_data_setting("bright_data_serp_language", "en").lower()
    if default_lang not in _GN_LANG:
        default_lang = "en"
    default_country = _bright_data_setting(
        "bright_data_serp_country", _GN_LANG[default_lang]["gl"]
    ).upper()
    language = str(lang or default_lang).strip().lower()
    geo = _GN_LANG.get(language, {"hl": language or default_lang, "gl": default_country})
    params: dict[str, str] = {
        "q": query,
        "hl": geo["hl"],
        "gl": str(country or geo["gl"] or default_country).upper(),
    }
    if news:
        params["tbm"] = "nws"
        if when in _NEWS_TIME_FILTERS:
            params["tbs"] = _NEWS_TIME_FILTERS[when]
    return "https://www.google.com/search?" + urlencode(params, quote_via=quote)


def _organic_results(body: dict[str, Any]) -> list[dict[str, Any]]:
    rows = body.get("organic")
    if not isinstance(rows, list):
        return []
    return [row for row in rows if isinstance(row, dict)]


def _first_value(row: dict[str, Any], *keys: str, default: Any = "") -> Any:
    for key in keys:
        value = row.get(key)
        if value not in (None, "", []):
            return value
    return default


def _get_search_tool_query_limit_value() -> int:
    try:
        return int(load_search_tool_query_limit())
    except Exception:
        return DEFAULT_SEARCH_TOOL_QUERY_LIMIT


def _iter_limited_search_queries(queries: list):
    for raw_query in list(queries or [])[:_get_search_tool_query_limit_value()]:
        query = str(raw_query or "").strip()
        if query:
            yield query


def _append_unique(
    target: list[dict[str, Any]],
    rows: list[dict[str, Any]],
    seen_urls: set[str],
    *,
    url_key: str,
) -> None:
    for row in rows:
        url = str(row.get(url_key) or "").strip()
        if not url or url in seen_urls:
            continue
        seen_urls.add(url)
        target.append(row)


def search_web_tool(queries: list) -> list:
    """Search Google through Bright Data SERP and return organic results."""
    results: list[dict[str, Any]] = []
    seen_urls: set[str] = set()

    for query in _iter_limited_search_queries(queries):
        cache_key = f"search:bright-data:{hashlib.md5(query.lower().encode()).hexdigest()}"
        cached = cache_get(cache_key)
        if cached is not None:
            _append_unique(results, cached, seen_urls, url_key="url")
            continue
        try:
            rows = _organic_results(_bright_data_serp_request(_build_google_url(query)))
            normalized = [
                {
                    "title": str(_first_value(row, "title")),
                    "url": str(_first_value(row, "link", "url")),
                    "snippet": str(_first_value(row, "description", "snippet")),
                }
                for row in rows[:SEARCH_MAX_RESULTS]
            ]
            normalized = [row for row in normalized if row["url"]]
            cache_set(cache_key, normalized)
            _append_unique(results, normalized, seen_urls, url_key="url")
        except Exception as exc:
            LOGGER.error("Bright Data web search failed for query='%.60s': %s", query, exc)
            results.append({"error": str(exc), "query": query})
    return results


def _is_safe_url(url: str) -> tuple[bool, str]:
    """Reject unsupported schemes and direct local/private network targets."""
    try:
        parsed = urlparse(url)
    except Exception:
        return False, "Invalid URL"
    if parsed.scheme not in {"http", "https"}:
        return False, "Only http and https are supported"
    hostname = parsed.hostname or ""
    if not hostname:
        return False, "Hostname not found"
    if hostname.lower() in {"localhost", "localhost."}:
        return False, "Local addresses are prohibited"
    try:
        address = ipaddress.ip_address(hostname)
    except ValueError:
        return True, ""
    if not address.is_global:
        return False, "Private or local IP addresses are prohibited"
    return True, ""


def _validate_resolved_ip_address(address: str) -> None:
    try:
        resolved = ipaddress.ip_address(str(address).strip())
    except ValueError as exc:
        raise socket.gaierror(f"Invalid IP address: {address}") from exc
    if not resolved.is_global:
        raise socket.gaierror(
            f"Resolution blocked for non-public address: {address}"
        )


@contextlib.contextmanager
def _guarded_dns_resolution(enabled: bool = True):
    """Deprecated: was a process-global monkeypatch with thread-safety issues.

    Replaced by _validate_hostname_dns() (pre-fetch) and final_url re-validation
    in fetch_url_tool(). Kept as a no-op for backward compatibility of any
    internal callers; emits a deprecation warning when used.
    """
    import warnings
    warnings.warn(
        "_guarded_dns_resolution is deprecated and has no effect. "
        "DNS validation is now handled per-call via _validate_hostname_dns().",
        DeprecationWarning,
        stacklevel=2,
    )
    yield


def _validate_hostname_dns(hostname: str) -> None:
    """Resolve hostname and verify all returned IP addresses are global.

    Raises socket.gaierror if any resolved address is non-global (private,
    loopback, link-local, etc.). This is a per-call, thread-safe alternative
    to the previous process-global socket monkeypatch.
    """
    if not hostname or not hostname.strip():
        return
    hostname = hostname.strip()
    # Skip pure IP addresses — _is_safe_url already handles those
    try:
        ipaddress.ip_address(hostname)
        return
    except ValueError:
        pass
    try:
        results = socket.getaddrinfo(hostname, None)
    except socket.gaierror:
        raise
    for entry in results:
        address = entry[4][0] if len(entry) > 4 else None
        if address:
            _validate_resolved_ip_address(address)


def _clean_extracted_text(text: str) -> str:
    cleaned = unicodedata.normalize("NFKC", str(text or ""))
    cleaned = cleaned.translate(_ZERO_WIDTH_TRANSLATION)
    cleaned = cleaned.replace("\xa0", " ").replace("\r\n", "\n").replace("\r", "\n")
    cleaned = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", cleaned)
    cleaned = re.sub(r"[ \t]+", " ", cleaned)
    cleaned = "\n".join(line.rstrip() for line in cleaned.splitlines())
    return re.sub(r"\n{3,}", "\n\n", cleaned).strip()


def _normalize_fetch_content_max_chars(value) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        parsed = CONTENT_MAX_CHARS
    return max(2_000, min(1_000_000, parsed))


def _truncate_content(text: str, max_chars: int = CONTENT_MAX_CHARS) -> str:
    normalized_max_chars = _normalize_fetch_content_max_chars(max_chars)
    if len(text) <= normalized_max_chars:
        return text
    return text[:normalized_max_chars].rstrip() + "\n[Content truncated]"


def _extract_title_from_markdown(markdown: str) -> str:
    for line in markdown.splitlines():
        stripped = line.strip()
        if stripped.startswith("# ") and not stripped.startswith("## "):
            return stripped[2:].strip()
    return ""


def _pagefetch_settings() -> dict[str, Any]:
    config = proxy_settings.load_pagefetch_config()

    # PageFetch reads provider credentials from env vars internally
    for key in ("decodo_url", "dataimpulse_url"):
        if config.get(key):
            env_key = key.upper()
            os.environ[env_key] = config[key]

    return {
        "mode": config["mode"],
        "proxy": config["proxy"],
        "http_concurrency": config["http_concurrency"],
        "browser_concurrency": config["browser_concurrency"],
        "cache_enabled": config["cache_enabled"],
        "cache_ttl": config["cache_ttl"],
        "http_timeout": config["http_timeout"],
        "browser_timeout": config["browser_timeout"],
        "retries_http": config["http_retries"],
        "retries_browser": config["browser_retries"],
        "raise_on_error": False,
    }


async def _fetch_with_pagefetch_async(url: str):
    try:
        from pagefetch import PageFetch
    except ImportError as exc:
        raise RuntimeError(
            "PageFetch is not installed. Install the project requirements."
        ) from exc

    async with PageFetch(**_pagefetch_settings()) as client:
        return await client.fetch(url)


def _run_pagefetch(url: str):
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(_fetch_with_pagefetch_async(url))
    with ThreadPoolExecutor(max_workers=1, thread_name_prefix="pagefetch") as executor:
        return executor.submit(
            lambda: asyncio.run(_fetch_with_pagefetch_async(url))
        ).result()


def _pagefetch_error_message(error: Any) -> str:
    if error is None:
        return "PageFetch could not retrieve the URL."
    message = getattr(error, "message", None)
    return str(message or error)


def _content_format(content_type: str, markdown: str) -> str:
    lowered = content_type.lower()
    if "pdf" in lowered:
        return "pdf"
    if "json" in lowered:
        return "json"
    if "xml" in lowered:
        return "xml"
    if markdown:
        return "markdown"
    return "text"


def fetch_url_tool(
    url: str,
    *,
    compress: bool = True,
    content_max_chars: int = CONTENT_MAX_CHARS,
    cache_namespace: str = "fetch",
) -> dict:
    """Fetch and extract one URL exclusively through PageFetch."""
    safe, reason = _is_safe_url(url)
    if not safe:
        return {"url": url, "error": reason, "content": ""}

    normalized_max_chars = _normalize_fetch_content_max_chars(content_max_chars)
    digest = hashlib.md5(
        f"{url}|{normalized_max_chars}|compress={bool(compress)}|pagefetch".encode()
    ).hexdigest()
    cache_key = f"{cache_namespace}:{digest}"
    cached = cache_get(cache_key)
    if cached is not None:
        return cached

    try:
        # Pre-fetch DNS validation: thread-safe per-call check
        parsed = urlparse(url)
        if parsed.hostname:
            _validate_hostname_dns(parsed.hostname)
        fetched = _run_pagefetch(url)
    except Exception as exc:
        LOGGER.error("PageFetch failed for %s: %s", url, exc)
        return {"url": url, "error": str(exc), "content": ""}

    if not getattr(fetched, "success", False):
        return {
            "url": url,
            "error": _pagefetch_error_message(getattr(fetched, "error", None)),
            "content": "",
        }

    markdown = _clean_extracted_text(getattr(fetched, "markdown", "") or "")
    text = _clean_extracted_text(getattr(fetched, "text", "") or "")
    content = markdown or text
    if not content:
        return {"url": url, "error": "PageFetch returned empty content.", "content": ""}

    content_type = str(getattr(fetched, "content_type", "") or "")
    final_url = str(getattr(fetched, "final_url", "") or url)

    # Validate final_url after redirects to prevent DNS rebinding bypass
    if final_url != url:
        final_safe, final_reason = _is_safe_url(final_url)
        if not final_safe:
            return {"url": url, "error": f"Redirect target rejected: {final_reason}", "content": ""}
        final_parsed = urlparse(final_url)
        if final_parsed.hostname:
            try:
                _validate_hostname_dns(final_parsed.hostname)
            except (socket.gaierror, OSError) as dns_err:
                return {"url": url, "error": f"Redirect target DNS rejected: {dns_err}", "content": ""}

    clipped_content = _truncate_content(content, normalized_max_chars)
    result = {
        "url": final_url,
        "requested_url": url,
        "title": str(getattr(fetched, "title", "") or _extract_title_from_markdown(markdown)),
        "content": clipped_content,
        "raw_content": clipped_content,
        "content_format": _content_format(content_type, markdown),
        "content_type": content_type,
        "cleanup_applied": True,
        "status": getattr(fetched, "status_code", None) or 200,
        "fetch_method": getattr(fetched, "fetch_method", None),
        "from_cache": bool(getattr(fetched, "from_cache", False)),
    }
    cache_set(cache_key, result)
    return result
