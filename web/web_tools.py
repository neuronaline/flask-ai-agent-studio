from __future__ import annotations

import hashlib
import httpx
import ipaddress
import json
import logging
import os
import re
import socket
import unicodedata
from urllib.parse import urlparse
from defusedxml import ElementTree as ET
from core.config import (
    CONTENT_MAX_CHARS,
    DEFAULT_SEARCH_TOOL_QUERY_LIMIT,
    SEARCH_MAX_RESULTS,
)
from core.db import cache_get, cache_set, get_search_tool_query_limit as load_search_tool_query_limit
import contextlib as _contextlib


# ---------------------------------------------------------------------------
# SERP API configuration
# ---------------------------------------------------------------------------
SERP_API_BASE_URL = os.environ.get(
    "SERP_API_BASE_URL", "https://serp.signalique.com"
).rstrip("/")
SERP_API_KEY = os.environ.get(
    "SERP_API_KEY", "Vy1UtOKTi77P1QkWxchm9rqxR1kBflzz8hO_Z-Fqe54"
)


def _serp_api_request(endpoint: str, payload: dict) -> dict:
    """Make a request to the SERP REST API and return the parsed response.

    Args:
        endpoint: API path, e.g. "/api/v1/search"
        payload: JSON body to send

    Returns:
        The ``data`` field from the API response on success.

    Raises:
        RuntimeError: On API error (non-200, or ``success`` is false).
    """
    url = f"{SERP_API_BASE_URL}{endpoint}"
    headers = {
        "Content-Type": "application/json",
        "X-API-Key": SERP_API_KEY,
    }
    LOGGER.debug("SERP API POST %s (payload keys=%s)", endpoint, list(payload.keys()))
    try:
        with httpx.Client(timeout=60, follow_redirects=True) as client:
            resp = client.post(url, json=payload, headers=headers)
    except httpx.RequestError as exc:
        LOGGER.error("SERP API connection error %s: %s", endpoint, exc)
        raise RuntimeError(f"SERP API connection failed: {exc}") from exc

    if resp.status_code == 401:
        LOGGER.error("SERP API 401 Unauthorized — check SERP_API_KEY")
        raise RuntimeError("SERP API authentication failed (401)")
    if resp.status_code == 429:
        LOGGER.warning("SERP API rate limited (429) on %s", endpoint)
        raise RuntimeError("SERP API rate limit exceeded (429)")

    try:
        body = resp.json()
    except json.JSONDecodeError as exc:
        LOGGER.error("SERP API non-JSON response %s (status=%d): %.200s", endpoint, resp.status_code, resp.text)
        raise RuntimeError(f"SERP API returned non-JSON (status {resp.status_code})") from exc

    if not body.get("success"):
        err = body.get("error") or {}
        code = err.get("code", "UNKNOWN")
        msg = err.get("message", resp.text[:200])
        LOGGER.error("SERP API error on %s: [%s] %s", endpoint, code, msg)
        raise RuntimeError(f"SERP API error [{code}]: {msg}")

    data = body.get("data")
    if data is None:
        LOGGER.error("SERP API %s returned success but data is None", endpoint)
        raise RuntimeError("SERP API returned empty data")
    return data


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
_GN_LANG = {
    "tr": {"hl": "tr", "gl": "TR", "ceid": "TR:tr"},
    "en": {"hl": "en", "gl": "US", "ceid": "US:en"},
}
_THIN_CONTENT_MIN_CHARS = 80
_ZERO_WIDTH_TRANSLATION = dict.fromkeys(map(ord, "\u200b\u200c\u200d\ufeff"), None)
LOGGER = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# URL / SSRF safety
# ---------------------------------------------------------------------------
def _is_safe_url(url: str) -> tuple[bool, str]:
    """Validate URL for safety: scheme, hostname, and private-IP checks."""
    try:
        parsed = urlparse(url)
    except Exception:
        return False, "Invalid URL"
    if parsed.scheme not in ("http", "https"):
        return False, "Only http and https are supported"
    hostname = parsed.hostname or ""
    if not hostname:
        return False, "Hostname not found"
    if hostname.lower() in ("localhost", "localhost."):
        return False, "Local addresses are prohibited"
    # Block private/reserved IP addresses (SSRF protection)
    try:
        ip = ipaddress.ip_address(hostname)
    except ValueError:
        return True, ""
    if ip.is_private or ip.is_loopback or ip.is_link_local:
        return False, "Private or local IP addresses are prohibited"
    return True, ""


def _validate_resolved_ip_address(address: str) -> None:
    """Validate that a DNS-resolved IP address is not private/reserved.

    Raises socket.gaierror if the address is in a non-public range,
    mimicking a DNS resolution failure.
    """
    try:
        ip = ipaddress.ip_address(str(address).strip())
    except ValueError:
        raise socket.gaierror(f"Invalid IP address: {address}")
    if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
        raise socket.gaierror(f"Resolution blocked for non-public address: {address}")


@_contextlib.contextmanager
def _guarded_dns_resolution(enabled: bool = True):
    """Context manager that patches socket.getaddrinfo for SSRF protection.

    Inside the context, all DNS resolutions are validated against private/
    reserved IP ranges. The original getaddrinfo is always restored on exit,
    even if an exception occurs.

    Args:
        enabled: If False, the context is a no-op (yields without patching).
    """
    if not enabled:
        yield
        return

    original_getaddrinfo = socket.getaddrinfo

    def guarded_getaddrinfo(host, port, family=0, type=0, proto=0, flags=0):
        result = original_getaddrinfo(host, port, family, type, proto, flags)
        for entry in result:
            addr = entry[4][0] if len(entry) > 4 else None
            if addr:
                _validate_resolved_ip_address(addr)
        return result

    socket.getaddrinfo = guarded_getaddrinfo
    try:
        yield
    finally:
        socket.getaddrinfo = original_getaddrinfo


# ---------------------------------------------------------------------------
# Text cleaning helpers
# ---------------------------------------------------------------------------
def _clean_extracted_text(text: str) -> str:
    cleaned = unicodedata.normalize("NFKC", str(text or ""))
    cleaned = cleaned.translate(_ZERO_WIDTH_TRANSLATION)
    cleaned = cleaned.replace("\xa0", " ").replace("\r\n", "\n").replace("\r", "\n")
    cleaned = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", cleaned)
    cleaned = re.sub(r"[ \t]+", " ", cleaned)

    normalized_lines = []
    for line in cleaned.split("\n"):
        stripped = re.sub(r"\s+", " ", line).strip()
        if stripped and re.fullmatch(r"[-_=|~•·*.]{3,}", stripped):
            continue
        normalized_lines.append(stripped)

    cleaned = "\n".join(normalized_lines)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned.strip()


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


def _coerce_bool(value, default: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    if value in (None, ""):
        return default
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "on"}
    return bool(value)


def _get_search_tool_query_limit_value() -> int:
    try:
        return int(load_search_tool_query_limit())
    except Exception:
        return DEFAULT_SEARCH_TOOL_QUERY_LIMIT


def _iter_limited_search_queries(queries: list):
    limit = _get_search_tool_query_limit_value()
    for raw_query in list(queries or [])[:limit]:
        yield raw_query


def _extract_title_from_markdown(markdown: str) -> str:
    """Extract the first H1 heading from Markdown content."""
    for line in markdown.splitlines():
        stripped = line.strip()
        if stripped.startswith("# ") and not stripped.startswith("## "):
            return stripped[2:].strip()
    return ""


# ---------------------------------------------------------------------------
# Web search
# ---------------------------------------------------------------------------
def search_web_tool(queries: list) -> list:
    """Web search using the SERP REST API.

    Args:
        queries: List of search query strings

    Returns:
        List of dicts with keys: title, url, snippet (or error, query on failure)
    """
    if not queries:
        LOGGER.debug("search_web_tool: empty query list, returning []")
        return []

    results = []
    seen_urls = set()
    LOGGER.info("search_web_tool: starting %d query(s)", len(queries))

    for raw_query in _iter_limited_search_queries(queries):
        query = str(raw_query).strip()
        if not query:
            continue

        cache_key = f"search:{hashlib.md5(query.lower().encode()).hexdigest()}"
        cached = cache_get(cache_key)
        if cached is not None:
            LOGGER.debug("search_web_tool: cache HIT for query='%.60s' (%d cached results)", query, len(cached))
            for row in cached:
                if row.get("url") not in seen_urls:
                    seen_urls.add(row["url"])
                    results.append(row)
            continue

        LOGGER.debug("search_web_tool: cache MISS for query='%.60s' — calling SERP API", query)
        try:
            api_data = _serp_api_request("/api/v1/search", {"query": query, "page": 1})
            LOGGER.info("search_web_tool: query='%.60s' returned %d raw results", query, len(api_data))

            normalized = []
            for r in api_data[:SEARCH_MAX_RESULTS]:
                if isinstance(r, dict):
                    normalized.append({
                        "title": r.get("title", ""),
                        "url": r.get("url", ""),
                        "snippet": r.get("description", ""),
                    })
                else:
                    normalized.append({
                        "title": getattr(r, "title", ""),
                        "url": getattr(r, "url", ""),
                        "snippet": getattr(r, "description", ""),
                    })

            cache_set(cache_key, normalized)
            LOGGER.debug("search_web_tool: cached %d normalized results for query='%.60s'", len(normalized), query)
            for row in normalized:
                if row["url"] not in seen_urls:
                    seen_urls.add(row["url"])
                    results.append(row)
        except Exception as exc:
            LOGGER.error("search_web_tool: query='%.60s' FAILED: %s", query, exc)
            results.append({"error": str(exc), "query": query})

    LOGGER.info("search_web_tool: total %d unique results for %d query(s)", len(results), len(queries))
    return results


# ---------------------------------------------------------------------------
# News search
# ---------------------------------------------------------------------------
def _search_news_internal(
    queries: list,
    lang: str,
    when: str | None,
    country: str,
    cache_prefix: str,
) -> list:
    """Internal news search helper shared by search_news_tool and search_news_google_tool."""
    if not queries:
        LOGGER.debug("_search_news_internal[%s]: empty query list, returning []", cache_prefix)
        return []

    results = []
    seen_urls = set()
    LOGGER.info("_search_news_internal[%s]: starting %d query(s), lang=%s", cache_prefix, len(queries), lang)

    for raw_query in _iter_limited_search_queries(queries):
        query = str(raw_query).strip()
        if not query:
            continue

        cache_key = f"{cache_prefix}:{hashlib.md5((query + lang + (when or '')).lower().encode()).hexdigest()}"
        cached = cache_get(cache_key)
        if cached is not None:
            LOGGER.debug("_search_news_internal[%s]: cache HIT for query='%.60s'", cache_prefix, query)
            for row in cached:
                if row.get("link") not in seen_urls:
                    seen_urls.add(row["link"])
                    results.append(row)
            continue

        LOGGER.debug("_search_news_internal[%s]: cache MISS for query='%.60s' — calling SERP API", cache_prefix, query)
        try:
            # Build payload; include when for forward-compatibility (SERP API
            # silently ignores unknown fields; the old serp-scraper client
            # supported timelimit via DuckDuckGo's API, but the hosted SERP API
            # (Google News RSS) currently does not support time filtering).
            payload: dict[str, object] = {
                "query": query,
                "max_results": SEARCH_MAX_RESULTS,
                "language": lang,
                "country": country,
            }
            if when:
                payload["time_range"] = when

            api_data = _serp_api_request("/api/v1/news", payload)
            LOGGER.info("_search_news_internal[%s]: query='%.60s' returned %d raw news results", cache_prefix, query, len(api_data))

            normalized = []
            for r in api_data:
                if isinstance(r, dict):
                    normalized.append({
                        "title": r.get("title", ""),
                        "link": r.get("url", ""),
                        "time": r.get("published", ""),
                        "source": r.get("source", ""),
                    })
                else:
                    normalized.append({
                        "title": getattr(r, "title", ""),
                        "link": getattr(r, "url", ""),
                        "time": getattr(r, "published", ""),
                        "source": getattr(r, "source", ""),
                    })

            cache_set(cache_key, normalized)
            LOGGER.debug("_search_news_internal[%s]: cached %d normalized results for query='%.60s'", cache_prefix, len(normalized), query)
            for row in normalized:
                if row.get("link") not in seen_urls:
                    seen_urls.add(row["link"])
                    results.append(row)
        except Exception as exc:
            LOGGER.error("_search_news_internal[%s]: query='%.60s' FAILED: %s", cache_prefix, query, exc)
            results.append({"error": str(exc), "query": query})

    LOGGER.info("_search_news_internal[%s]: total %d unique results for %d query(s)", cache_prefix, len(results), len(queries))
    return results


def search_news_tool(queries: list, lang: str = "tr", when: str | None = None) -> list:
    """News search using the SERP REST API.

    Args:
        queries: List of search query strings
        lang: Language code (tr, en, etc.)
        when: Time range (d, w, m, y) — passed to API but may be ignored

    Returns:
        List of dicts with keys: title, link, time, source (or error, query on failure)
    """
    geo = _GN_LANG.get(lang, _GN_LANG["tr"])
    country = geo["gl"]  # "TR", "US" — proper ISO country code for SERP API
    return _search_news_internal(queries, lang, when, country, cache_prefix="news")


def search_news_google_tool(queries: list, lang: str = "tr", when: str | None = None) -> list:
    """News search using the SERP REST API (Google hl/gl/ceid params).

    Args:
        queries: List of search query strings
        lang: Language code (tr, en, etc.)
        when: Time range (d, w, m, y) — passed to API but may be ignored

    Returns:
        List of dicts with keys: title, link, time, source (or error, query on failure)
    """
    geo = _GN_LANG.get(lang, _GN_LANG["tr"])
    country = geo["gl"]
    return _search_news_internal(queries, lang, when, country, cache_prefix="news_google")


# ---------------------------------------------------------------------------
# Scholar search
# ---------------------------------------------------------------------------
def search_scholar_tool(
    queries: list,
    lang: str = "en",
    year_from: int | None = None,
    year_to: int | None = None,
    sort_by: str = "relevance",
) -> list:
    """Academic paper search using the SERP REST API.

    Args:
        queries: List of search query strings
        lang: Language code (en, tr, etc.)
        year_from: Optional start year filter
        year_to: Optional end year filter
        sort_by: Sort order ("relevance" or "date")

    Returns:
        List of dicts with keys: title, url, snippet, authors, year, venue, citations
        (or error, query on failure)
    """
    if not queries:
        LOGGER.debug("search_scholar_tool: empty query list, returning []")
        return []

    scholar_language = lang if lang in ("en", "tr") else "en"
    results = []
    seen_urls = set()
    LOGGER.info("search_scholar_tool: starting %d query(s), lang=%s, year_from=%s, year_to=%s, sort=%s",
                len(queries), lang, year_from, year_to, sort_by)

    for raw_query in _iter_limited_search_queries(queries):
        query = str(raw_query).strip()
        if not query:
            continue

        cache_key = (
            f"scholar:{hashlib.md5((query + scholar_language + str(year_from or '') + str(year_to or '') + sort_by).lower().encode()).hexdigest()}"
        )
        cached = cache_get(cache_key)
        if cached is not None:
            LOGGER.debug("search_scholar_tool: cache HIT for query='%.60s' (%d results)", query, len(cached))
            for row in cached:
                if row.get("url") not in seen_urls:
                    seen_urls.add(row["url"])
                    results.append(row)
            continue

        LOGGER.debug("search_scholar_tool: cache MISS for query='%.60s' — calling SERP API", query)
        try:
            api_data = _serp_api_request("/api/v1/scholar", {
                "query": query,
                "max_results": SEARCH_MAX_RESULTS,
                "language": scholar_language,
                "year_from": year_from,
                "year_to": year_to,
                "sort_by": sort_by,
            })
            LOGGER.info("search_scholar_tool: query='%.60s' returned %d raw scholar results", query, len(api_data))

            normalized = []
            for r in api_data:
                if isinstance(r, dict):
                    authors = r.get("authors")
                    if isinstance(authors, list):
                        authors = ", ".join(authors)
                    normalized.append({
                        "title": r.get("title", ""),
                        "url": r.get("url", ""),
                        "snippet": r.get("snippet", ""),
                        "authors": authors or "",
                        "year": r.get("publication_year"),
                        "venue": r.get("venue", ""),
                        "citations": r.get("citation_count", 0),
                    })
                else:
                    a = getattr(r, "authors", None) or []
                    normalized.append({
                        "title": getattr(r, "title", ""),
                        "url": getattr(r, "url", ""),
                        "snippet": getattr(r, "snippet", ""),
                        "authors": ", ".join(a) if isinstance(a, list) else str(a or ""),
                        "year": getattr(r, "publication_year", None),
                        "venue": getattr(r, "venue", ""),
                        "citations": getattr(r, "citation_count", 0),
                    })

            cache_set(cache_key, normalized)
            LOGGER.debug("search_scholar_tool: cached %d normalized results for query='%.60s'", len(normalized), query)
            for row in normalized:
                if row["url"] not in seen_urls:
                    seen_urls.add(row["url"])
                    results.append(row)
        except Exception as exc:
            LOGGER.error("search_scholar_tool: query='%.60s' FAILED: %s", query, exc)
            results.append({"error": str(exc), "query": query})

    LOGGER.info("search_scholar_tool: total %d unique results for %d query(s)", len(results), len(queries))
    return results


# ---------------------------------------------------------------------------
# URL fetch helpers
# ---------------------------------------------------------------------------
def _fetch_url_direct(url: str, timeout: int = 30) -> tuple[bytes | None, str, Exception | None]:
    """Detect content type and optionally fetch content via httpx.

    Uses HEAD first for content-type detection. Only downloads the full
    body for non-HTML types (PDF, JSON, XML, plain text) so that HTML
    pages are fetched once by the SERP API.

    Returns (raw_bytes, content_type, error).
      raw_bytes=None  on connection/HTTP failure
      raw_bytes=b''   for HTML / unknown types (content-type detected only)
      raw_bytes=...   for non-HTML content (full body)
    """
    try:
        with httpx.Client(timeout=timeout, follow_redirects=True) as client:
            LOGGER.debug("_fetch_url_direct: HEAD %s", url)
            head_resp = client.head(url)
            head_resp.raise_for_status()
            content_type = (head_resp.headers.get("content-type") or "").lower()
            LOGGER.debug("_fetch_url_direct: HEAD %s -> %s (status=%d)", url, content_type, head_resp.status_code)

            # HTML and unknown types → return content-type only; SERP API performs the fetch
            if "html" in content_type or not content_type:
                LOGGER.debug("_fetch_url_direct: HTML/unknown type -> SERP API will handle fetch for %s", url)
                return b"", content_type, None

            # Non-HTML → download full body
            LOGGER.debug("_fetch_url_direct: GET %s (non-HTML: %s)", url, content_type)
            get_resp = client.get(url)
            get_resp.raise_for_status()
            raw = get_resp.content
            content_type = (get_resp.headers.get("content-type") or "").lower()
            LOGGER.info("_fetch_url_direct: fetched %d bytes from %s (type=%s)", len(raw), url, content_type)
            return raw, content_type, None
    except Exception as exc:
        LOGGER.error("_fetch_url_direct: FAILED for %s: %s", url, exc)
        return None, "", exc


# ---------------------------------------------------------------------------
# URL fetch (main entry point)
# ---------------------------------------------------------------------------
def fetch_url_tool(
    url: str,
    *,
    compress: bool = True,
    content_max_chars: int = CONTENT_MAX_CHARS,
    cache_namespace: str = "fetch",
) -> dict:
    """Fetch URL content using the SERP REST API (with local type detection for non-HTML).

    Args:
        url: Target URL to fetch
        compress: When true (default), auto-compress by keeping head/middle/tail
                  for pages >~10k chars. Set false for full uncompressed content.
        content_max_chars: Maximum characters in content
        cache_namespace: Cache namespace for this fetch

    Returns:
        Dict with url, title, content, raw_content, content_format, etc.
    """
    safe, reason = _is_safe_url(url)
    if not safe:
        LOGGER.warning("fetch_url_tool: BLOCKED unsafe URL %s: %s", url, reason)
        return {"url": url, "error": reason, "content": ""}

    normalized_content_max_chars = _normalize_fetch_content_max_chars(content_max_chars)
    fetch_html_converter_mode = "hybrid"

    # Unified cache key: includes content_max_chars, converter mode, and compress flag
    digest = hashlib.md5(
        f"{url}|{normalized_content_max_chars}|{fetch_html_converter_mode}|compress={compress}".encode()
    ).hexdigest()
    cache_key = f"fetch:{digest}"

    cached = cache_get(cache_key)
    if cached is not None:
        LOGGER.debug("fetch_url_tool: cache HIT for %s", url)
        return cached

    LOGGER.info("fetch_url_tool: fetching %s (compress=%s, max_chars=%d)", url, compress, normalized_content_max_chars)

    # --- Content-type detection (and download for non-HTML) ---
    raw_bytes, content_type, head_error = _fetch_url_direct(url)

    # PDF handling
    if (raw_bytes is not None and "pdf" in (content_type or "")) or (url.lower().endswith(".pdf") and head_error is None):
        LOGGER.info("fetch_url_tool: detected PDF for %s", url)
        try:
            from services.doc_service import _extract_text_from_pdf

            total_pages = None
            try:
                import pdfplumber
                from io import BytesIO

                with pdfplumber.open(BytesIO(raw_bytes)) as pdf:
                    total_pages = len(pdf.pages)
            except Exception:
                total_pages = None

            text = _clean_extracted_text(_extract_text_from_pdf(raw_bytes))
            LOGGER.info("fetch_url_tool: extracted %d chars from PDF %s (pages=%s)", len(text), url, total_pages)
            result = {
                "url": url,
                "title": f"PDF: {url.rstrip('/').split('/')[-1]}",
                "content": _truncate_content(text, normalized_content_max_chars),
                "raw_content": _truncate_content(text, normalized_content_max_chars),
                "content_format": "pdf",
                "cleanup_applied": False,
                "status": 200,
            }
            if total_pages is not None:
                result["page_count"] = total_pages
                result["pages_extracted"] = total_pages
            cache_set(cache_key, result)
            return result
        except Exception as exc:
            LOGGER.error("fetch_url_tool: PDF extraction FAILED for %s: %s", url, exc)
            return {"url": url, "error": f"Could not read PDF: {exc}", "content": ""}

    # JSON / XML / plain text handling
    if raw_bytes is not None and head_error is None:
        ct = content_type or ""
        if "json" in ct:
            LOGGER.info("fetch_url_tool: detected JSON for %s", url)
            try:
                parsed = json.loads(raw_bytes)
                text = json.dumps(parsed, ensure_ascii=False, indent=2)
            except Exception:
                text = raw_bytes.decode("utf-8", errors="replace")
            LOGGER.debug("fetch_url_tool: JSON %s -> %d chars", url, len(text))
            title = _extract_title_from_markdown(text) or ""
            result = {
                "url": url,
                "title": title,
                "content": _truncate_content(_clean_extracted_text(text), normalized_content_max_chars),
                "raw_content": _truncate_content(_clean_extracted_text(text), normalized_content_max_chars),
                "content_format": "json",
                "cleanup_applied": False,
                "status": 200,
            }
            cache_set(cache_key, result)
            return result

        if "xml" in ct and "html" not in ct:
            LOGGER.info("fetch_url_tool: detected XML for %s", url)
            try:
                decoded = raw_bytes.decode("utf-8", errors="replace")
                root = ET.fromstring(decoded)
                text_fragments = []
                for element in root.iter():
                    value = (element.text or "").strip()
                    if not value:
                        continue
                    label = re.sub(r"\s+", " ", str(element.tag or "")).strip()
                    text_fragments.append(f"{label}: {value}" if label else value)
                text = "\n".join(text_fragments) or decoded
            except Exception:
                text = raw_bytes.decode("utf-8", errors="replace")
            LOGGER.debug("fetch_url_tool: XML %s -> %d chars", url, len(text))
            result = {
                "url": url,
                "title": _extract_title_from_markdown(text) or "",
                "content": _truncate_content(_clean_extracted_text(text), normalized_content_max_chars),
                "raw_content": _truncate_content(_clean_extracted_text(text), normalized_content_max_chars),
                "content_format": "xml",
                "cleanup_applied": False,
                "status": 200,
            }
            cache_set(cache_key, result)
            return result

        if "text/plain" in ct:
            LOGGER.info("fetch_url_tool: detected plain text for %s", url)
            text = raw_bytes.decode("utf-8", errors="replace")
            LOGGER.debug("fetch_url_tool: text %s -> %d chars", url, len(text))
            result = {
                "url": url,
                "title": _extract_title_from_markdown(text) or "",
                "content": _truncate_content(_clean_extracted_text(text), normalized_content_max_chars),
                "raw_content": _truncate_content(_clean_extracted_text(text), normalized_content_max_chars),
                "content_format": "text",
                "cleanup_applied": False,
                "status": 200,
            }
            cache_set(cache_key, result)
            return result

    # --- Default: use SERP API for HTML pages ---
    LOGGER.info("fetch_url_tool: delegating to SERP API for HTML: %s", url)
    try:
        api_data = _serp_api_request("/api/v1/fetch", {
            "url": url,
            "prefer_browser": False,
            "compress": compress,
        })

        content = api_data.get("content", "")
        if not content:
            LOGGER.warning("fetch_url_tool: SERP API returned empty content for %s", url)
            return {"url": url, "error": "Empty content returned", "content": ""}

        LOGGER.info("fetch_url_tool: SERP API fetch succeeded for %s (%d chars)", url, len(content))
        title = _extract_title_from_markdown(content)
        result = {
            "url": url,
            "title": title,
            "content": _truncate_content(content, normalized_content_max_chars),
            "raw_content": _truncate_content(content, normalized_content_max_chars),
            "content_format": "html",
            "cleanup_applied": False,
            "status": 200,
        }

        cache_set(cache_key, result)
        return result

    except Exception as exc:
        LOGGER.error("fetch_url_tool: SERP API fetch FAILED for %s: %s", url, exc)
        return {"url": url, "error": str(exc), "content": ""}


# ---------------------------------------------------------------------------
# Proxy stubs (proxy management delegated to SERP API)
# ---------------------------------------------------------------------------
def get_proxy_candidates_for_operation(
    operation: str,
    *,
    include_direct_fallback: bool = False,
    settings: dict | None = None,
) -> list[str | None]:
    """Return proxy candidates for a given operation.

    Proxy management is delegated to the SERP API (server-side).
    This function always returns [None] (direct connection) and exists only for
    backward compatibility with callers that still iterate proxy candidates.
    """
    return [None]


def load_proxies() -> list[str]:
    """Load proxies from file (stub — proxy management is handled by SERP API)."""
    return []


def get_proxy_candidates(include_direct_fallback: bool = False) -> list[str | None]:
    """Return proxy candidates (stub — proxy management is handled by SERP API)."""
    return [None]
