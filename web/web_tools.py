from __future__ import annotations

import asyncio
import hashlib
import httpx
import ipaddress
import json
import logging
import re
import unicodedata
from urllib.parse import urlparse
from defusedxml import ElementTree as ET

from core.config import (
    CONTENT_MAX_CHARS,
    DEFAULT_SEARCH_TOOL_QUERY_LIMIT,
    SEARCH_MAX_RESULTS,
)
from core.db import cache_get, cache_set, get_proxy_enabled_operations, get_search_tool_query_limit as load_search_tool_query_limit
from serp import (
    SerpClient,
    SerpConfig,
    GoogleNewsClient,
    ScholarClient,
    SearchResult,
    NewsResult,
    ScholarResult,
)
from serp.utils import require_virtual_display


_NEWS_TIMELIMIT = {"d": "d", "w": "w", "m": "m", "y": "y"}
_NEWS_REGION = {"tr": "tr-tr", "en": "us-en"}
_GN_LANG = {
    "tr": {"hl": "tr", "gl": "TR", "ceid": "TR:tr"},
    "en": {"hl": "en", "gl": "US", "ceid": "US:en"},
}
_THIN_CONTENT_MIN_CHARS = 80
_ZERO_WIDTH_TRANSLATION = dict.fromkeys(map(ord, "\u200b\u200c\u200d\ufeff"), None)
LOGGER = logging.getLogger(__name__)
_ASYNC_LOOP: asyncio.AbstractEventLoop | None = None


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


def _run_async(coro):
    """Run an async coroutine in a synchronous context.

    Uses a reusable module-level event loop to avoid the overhead of
    creating and destroying a new loop on every call.
    """
    global _ASYNC_LOOP
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            # Already inside an async context; create a temporary loop
            temp_loop = asyncio.new_event_loop()
            asyncio.set_event_loop(temp_loop)
            try:
                return temp_loop.run_until_complete(coro)
            finally:
                temp_loop.close()
                asyncio.set_event_loop(loop)
    except RuntimeError:
        pass
    # Reuse the module-level singleton loop
    if _ASYNC_LOOP is None or _ASYNC_LOOP.is_closed():
        _ASYNC_LOOP = asyncio.new_event_loop()
        asyncio.set_event_loop(_ASYNC_LOOP)
    return _ASYNC_LOOP.run_until_complete(coro)


def _get_serp_config():
    """Get SerpClient configuration from environment/proxy settings.

    Uses headless=False (visible browser) by default with virtual display
    check. To override, set SERP_HEADLESS=true in environment.
    """
    require_virtual_display()
    config = SerpConfig(
        headless=False,
        cache_enabled=True,
        log_level="WARNING",
    )
    return config


def search_web_tool(queries: list) -> list:
    """Web search using serp-scraper SerpClient.

    Args:
        queries: List of search query strings

    Returns:
        List of dicts with keys: title, url, snippet (or error, query on failure)
    """
    if not queries:
        return []

    results = []
    seen_urls = set()

    config = _get_serp_config()

    for raw_query in _iter_limited_search_queries(queries):
        query = str(raw_query).strip()
        if not query:
            continue

        cache_key = f"search:{hashlib.md5(query.lower().encode()).hexdigest()}"
        cached = cache_get(cache_key)
        if cached is not None:
            for row in cached:
                if row.get("url") not in seen_urls:
                    seen_urls.add(row["url"])
                    results.append(row)
            continue

        try:
            async def _do_search():
                async with SerpClient(config) as client:
                    return await client.search(query)

            search_results = _run_async(_do_search())

            normalized = []
            for r in search_results[:SEARCH_MAX_RESULTS]:
                if isinstance(r, SearchResult):
                    normalized.append({
                        "title": r.title,
                        "url": r.url,
                        "snippet": r.description,
                    })
                elif isinstance(r, dict):
                    normalized.append({
                        "title": r.get("title", ""),
                        "url": r.get("url", ""),
                        "snippet": r.get("description", ""),
                    })
                else:
                    normalized.append({
                        "title": r.title,
                        "url": r.url,
                        "snippet": r.description,
                    })

            cache_set(cache_key, normalized)
            for row in normalized:
                if row["url"] not in seen_urls:
                    seen_urls.add(row["url"])
                    results.append(row)
        except Exception as exc:
            results.append({"error": str(exc), "query": query})

    return results


def search_news_tool(queries: list, lang: str = "tr", when: str | None = None) -> list:
    """News search using serp-scraper GoogleNewsClient.

    Args:
        queries: List of search query strings
        lang: Language code (tr, en, etc.)
        when: Time range (d, w, m, y)

    Returns:
        List of dicts with keys: title, link, time, source (or error, query on failure)
    """
    if not queries:
        return []

    region = _NEWS_REGION.get(lang, "tr-tr")
    time_range = _NEWS_TIMELIMIT.get(when) if when else None
    news_language = lang
    news_country = region.upper().replace("-", "_")
    results = []
    seen_urls = set()

    for raw_query in _iter_limited_search_queries(queries):
        query = str(raw_query).strip()
        if not query:
            continue

        cache_key = f"news:{hashlib.md5((query + lang + (when or '')).lower().encode()).hexdigest()}"
        cached = cache_get(cache_key)
        if cached is not None:
            for row in cached:
                if row.get("link") not in seen_urls:
                    seen_urls.add(row["link"])
                    results.append(row)
            continue

        try:
            async def _do_news():
                async with GoogleNewsClient(
                    language=news_language,
                    country=news_country,
                    time_range=time_range,
                ) as client:
                    return await client.get_news(query, max_results=SEARCH_MAX_RESULTS)

            news_results = _run_async(_do_news())

            normalized = []
            for r in news_results:
                if isinstance(r, NewsResult):
                    normalized.append({
                        "title": r.title,
                        "link": r.original_url or r.url,
                        "time": r.published.isoformat() if r.published else "",
                        "source": r.source,
                    })
                elif isinstance(r, dict):
                    normalized.append({
                        "title": r.get("title", ""),
                        "link": r.get("original_url") or r.get("url", ""),
                        "time": r.get("published", ""),
                        "source": r.get("source", ""),
                    })
                else:
                    normalized.append({
                        "title": r.title,
                        "link": r.original_url or r.url,
                        "time": r.published.isoformat() if r.published else "",
                        "source": r.source,
                    })

            cache_set(cache_key, normalized)
            for row in normalized:
                if row.get("link") not in seen_urls:
                    seen_urls.add(row["link"])
                    results.append(row)
        except Exception as exc:
            results.append({"error": str(exc), "query": query})

    return results


def search_news_google_tool(queries: list, lang: str = "tr", when: str | None = None) -> list:
    """News search using Google News RSS via serp-scraper 2.0.9+.

    Args:
        queries: List of search query strings
        lang: Language code (tr, en, etc.)
        when: Time range (d, w, m, y)

    Returns:
        List of dicts with keys: title, link, time, source (or error, query on failure)
    """
    if not queries:
        return []

    geo = _GN_LANG.get(lang, _GN_LANG["tr"])
    time_range = when if when and when in _NEWS_TIMELIMIT else None
    news_language = lang
    news_country = geo["gl"]
    results = []
    seen_urls = set()

    for raw_query in _iter_limited_search_queries(queries):
        query = str(raw_query).strip()
        if not query:
            continue

        cache_key = f"news_google:{hashlib.md5((query + lang + (when or '')).lower().encode()).hexdigest()}"
        cached = cache_get(cache_key)
        if cached is not None:
            for row in cached:
                if row.get("link") not in seen_urls:
                    seen_urls.add(row["link"])
                    results.append(row)
            continue

        try:
            async def _do_news():
                async with GoogleNewsClient(
                    language=news_language,
                    country=news_country,
                    time_range=time_range,
                ) as client:
                    return await client.get_news(query, max_results=SEARCH_MAX_RESULTS)

            news_results = _run_async(_do_news())

            normalized = []
            for r in news_results:
                if isinstance(r, NewsResult):
                    normalized.append({
                        "title": r.title,
                        "link": r.original_url or r.url,
                        "time": r.published.isoformat() if r.published else "",
                        "source": r.source,
                    })
                elif isinstance(r, dict):
                    normalized.append({
                        "title": r.get("title", ""),
                        "link": r.get("original_url") or r.get("url", ""),
                        "time": r.get("published", ""),
                        "source": r.get("source", ""),
                    })
                else:
                    normalized.append({
                        "title": r.title,
                        "link": r.original_url or r.url,
                        "time": r.published.isoformat() if r.published else "",
                        "source": r.source,
                    })

            cache_set(cache_key, normalized)
            for row in normalized:
                if row.get("link") not in seen_urls:
                    seen_urls.add(row["link"])
                    results.append(row)
        except Exception as exc:
            results.append({"error": str(exc), "query": raw_query})

    return results


def search_scholar_tool(
    queries: list,
    lang: str = "en",
    year_from: int | None = None,
    year_to: int | None = None,
    sort_by: str = "relevance",
) -> list:
    """Academic paper search using serp-scraper ScholarClient.

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
        return []

    scholar_language = lang if lang in ("en", "tr") else "en"
    results = []
    seen_urls = set()

    for raw_query in _iter_limited_search_queries(queries):
        query = str(raw_query).strip()
        if not query:
            continue

        cache_key = (
            f"scholar:{hashlib.md5((query + scholar_language + str(year_from or '') + str(year_to or '') + sort_by).lower().encode()).hexdigest()}"
        )
        cached = cache_get(cache_key)
        if cached is not None:
            for row in cached:
                if row.get("url") not in seen_urls:
                    seen_urls.add(row["url"])
                    results.append(row)
            continue

        try:
            async def _do_scholar():
                async with ScholarClient(
                    language=scholar_language,
                    year_from=year_from,
                    year_to=year_to,
                    sort_by=sort_by,
                ) as client:
                    return await client.search_scholar(query, max_results=SEARCH_MAX_RESULTS)

            scholar_results = _run_async(_do_scholar())

            normalized = []
            for r in scholar_results:
                if isinstance(r, ScholarResult):
                    normalized.append({
                        "title": r.title,
                        "url": r.url,
                        "snippet": r.snippet,
                        "authors": ", ".join(r.authors) if r.authors else "",
                        "year": r.publication_year,
                        "venue": r.venue,
                        "citations": r.citation_count,
                    })
                elif isinstance(r, dict):
                    normalized.append({
                        "title": r.get("title", ""),
                        "url": r.get("url", ""),
                        "snippet": r.get("snippet", ""),
                        "authors": r.get("authors", ""),
                        "year": r.get("publication_year"),
                        "venue": r.get("venue", ""),
                        "citations": r.get("citation_count", 0),
                    })
                else:
                    normalized.append({
                        "title": r.title,
                        "url": r.url,
                        "snippet": r.snippet,
                        "authors": ", ".join(r.authors) if r.authors else "",
                        "year": r.publication_year,
                        "venue": r.venue,
                        "citations": r.citation_count,
                    })

            cache_set(cache_key, normalized)
            for row in normalized:
                if row["url"] not in seen_urls:
                    seen_urls.add(row["url"])
                    results.append(row)
        except Exception as exc:
            results.append({"error": str(exc), "query": query})

    return results


def _extract_title_from_markdown(markdown: str) -> str:
    """Extract the first H1 heading from Markdown content."""
    for line in markdown.splitlines():
        stripped = line.strip()
        if stripped.startswith("# ") and not stripped.startswith("## "):
            return stripped[2:].strip()
    return ""


def _fetch_url_direct(url: str, timeout: int = 30) -> tuple[bytes | None, str, Exception | None]:
    """Detect content type and optionally fetch content via httpx.

    Uses HEAD first for content-type detection. Only downloads the full
    body for non-HTML types (PDF, JSON, XML, plain text) so that HTML
    pages are fetched only once (serp-scraper handles them separately).

    Returns (raw_bytes, content_type, error).
      raw_bytes=None  on connection/HTTP failure
      raw_bytes=b''   for HTML / unknown types (content-type detected only)
      raw_bytes=...   for non-HTML content (full body)
    """
    try:
        with httpx.Client(timeout=timeout, follow_redirects=True) as client:
            head_resp = client.head(url)
            head_resp.raise_for_status()
            content_type = (head_resp.headers.get("content-type") or "").lower()

            # HTML and unknown types → return content-type only; serp-scraper does the fetch
            if "html" in content_type or not content_type:
                return b"", content_type, None

            # Non-HTML → download full body
            get_resp = client.get(url)
            get_resp.raise_for_status()
            raw = get_resp.content
            content_type = (get_resp.headers.get("content-type") or "").lower()
            return raw, content_type, None
    except Exception as exc:
        return None, "", exc


def _cache_fetch_scroll_key(url: str, title: str, content_format: str, full_text: str) -> None:
    """Cache full (untruncated) content under the simple URL key for scroll/grep tools.

    The main fetch_url_tool caches truncated content under a key that includes
    the converter mode and content_max_chars.  scroll_fetched_content and
    grep_fetched_content look up a simpler ``fetch:{md5(url)}`` key and need
    the full text so they can window or search through it without re-fetching.
    """
    key = f"fetch:{hashlib.md5(url.encode()).hexdigest()}"
    cache_set(
        key,
        {
            "url": url,
            "title": title,
            "content": full_text,
            "raw_content": full_text,
            "content_format": content_format,
        },
    )


def fetch_url_tool(
    url: str,
    *,
    content_max_chars: int = CONTENT_MAX_CHARS,
    cache_namespace: str = "fetch",
) -> dict:
    """Fetch URL content using serp-scraper (with type detection).

    Args:
        url: Target URL to fetch
        content_max_chars: Maximum characters in content
        cache_namespace: Cache namespace for this fetch

    Returns:
        Dict with url, title, content, raw_content, content_format, etc.
    """
    safe, reason = _is_safe_url(url)
    if not safe:
        return {"url": url, "error": reason, "content": ""}

    normalized_content_max_chars = _normalize_fetch_content_max_chars(content_max_chars)
    normalized_cache_namespace = str(cache_namespace or "").strip()
    fetch_html_converter_mode = "hybrid"

    if normalized_cache_namespace == "fetch" and normalized_content_max_chars == CONTENT_MAX_CHARS:
        cache_key = f"fetch:{hashlib.md5((url + '|' + fetch_html_converter_mode).encode()).hexdigest()}"
    elif normalized_cache_namespace:
        digest = hashlib.md5(f"{url}|{normalized_content_max_chars}|{fetch_html_converter_mode}".encode()).hexdigest()
        cache_key = f"{normalized_cache_namespace}:{digest}"
    else:
        cache_key = None

    cached = cache_get(cache_key) if cache_key else None
    if cached is not None:
        return cached

    # --- Content-type detection (and download for non-HTML) ---
    raw_bytes, content_type, head_error = _fetch_url_direct(url)

    # PDF handling
    if (raw_bytes is not None and "pdf" in (content_type or "")) or (url.lower().endswith(".pdf") and head_error is None):
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
            if cache_key:
                cache_set(cache_key, result)
            _cache_fetch_scroll_key(url, result["title"], "pdf", text)
            return result
        except Exception as exc:
            return {"url": url, "error": f"Could not read PDF: {exc}", "content": ""}

    # JSON / XML / plain text handling
    if raw_bytes is not None and head_error is None:
        ct = content_type or ""
        if "json" in ct:
            try:
                parsed = json.loads(raw_bytes)
                text = json.dumps(parsed, ensure_ascii=False, indent=2)
            except Exception:
                text = raw_bytes.decode("utf-8", errors="replace")
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
            if cache_key:
                cache_set(cache_key, result)
            _cache_fetch_scroll_key(url, title, "json", _clean_extracted_text(text))
            return result

        if "xml" in ct and "html" not in ct:
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
            result = {
                "url": url,
                "title": _extract_title_from_markdown(text) or "",
                "content": _truncate_content(_clean_extracted_text(text), normalized_content_max_chars),
                "raw_content": _truncate_content(_clean_extracted_text(text), normalized_content_max_chars),
                "content_format": "xml",
                "cleanup_applied": False,
                "status": 200,
            }
            if cache_key:
                cache_set(cache_key, result)
            _cache_fetch_scroll_key(url, result["title"], "xml", _clean_extracted_text(text))
            return result

        if "text/plain" in ct:
            text = raw_bytes.decode("utf-8", errors="replace")
            result = {
                "url": url,
                "title": _extract_title_from_markdown(text) or "",
                "content": _truncate_content(_clean_extracted_text(text), normalized_content_max_chars),
                "raw_content": _truncate_content(_clean_extracted_text(text), normalized_content_max_chars),
                "content_format": "text",
                "cleanup_applied": False,
                "status": 200,
            }
            if cache_key:
                cache_set(cache_key, result)
            _cache_fetch_scroll_key(url, result["title"], "text", _clean_extracted_text(text))
            return result

    # --- Default: use serp-scraper SerpClient for HTML pages ---
    config = _get_serp_config()
    config.cache_enabled = False

    try:
        async def _do_fetch():
            async with SerpClient(config) as client:
                return await client.fetch(url, compress=False)

        content = _run_async(_do_fetch())

        if not content:
            return {"url": url, "error": "Empty content returned", "content": ""}

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

        if cache_key:
            cache_set(cache_key, result)
        _cache_fetch_scroll_key(url, title, "html", content)
        return result

    except Exception as exc:
        return {"url": url, "error": str(exc), "content": ""}


_GREP_CONTEXT_MAX_LINES = 5
_GREP_MAX_MATCHES = 30
_FETCH_SCROLL_DEFAULT_WINDOW_LINES = 120
_FETCH_SCROLL_MIN_WINDOW_LINES = 20
_FETCH_SCROLL_MAX_WINDOW_LINES = 400


def _coerce_grep_int(value, default: int, minimum: int, maximum: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        parsed = default
    return max(minimum, min(maximum, parsed))


def _normalize_fetched_snapshot_text(text: str) -> str:
    return str(text or "").replace("\r\n", "\n").replace("\r", "\n").strip()


def _load_fetched_content_snapshot(url: str, *, refresh_if_missing: bool = True) -> dict:
    searched_source = ""
    refetch_error = ""
    raw_text = ""
    title = ""
    content_format = ""

    def _apply_snapshot(candidate: dict, source_name: str) -> bool:
        nonlocal raw_text, searched_source, title, content_format
        if not isinstance(candidate, dict):
            return False
        normalized_text = _normalize_fetched_snapshot_text(candidate.get("raw_content") or candidate.get("content") or "")
        if not normalized_text:
            return False
        raw_text = normalized_text
        searched_source = source_name
        title = str(candidate.get("title") or "").strip()
        content_format = str(candidate.get("content_format") or "").strip()
        return True

    cache_key = f"fetch:{hashlib.md5(url.encode()).hexdigest()}"
    cached = cache_get(cache_key)
    if _apply_snapshot(cached, "fetch_cache"):
        return {
            "raw_text": raw_text,
            "searched_source": searched_source,
            "refetch_error": refetch_error,
            "title": title,
            "content_format": content_format,
        }

    if refresh_if_missing:
        refreshed = fetch_url_tool(url)
        if _apply_snapshot(refreshed, "live_refetch") and not refreshed.get("error"):
            return {
                "raw_text": raw_text,
                "searched_source": searched_source,
                "refetch_error": refetch_error,
                "title": title,
                "content_format": content_format,
            }
        refetch_error = str(refreshed.get("error") or refreshed.get("fetch_warning") or "").strip()

    return {
        "raw_text": raw_text,
        "searched_source": searched_source,
        "refetch_error": refetch_error,
        "title": title,
        "content_format": content_format,
    }


def scroll_fetched_content_tool(
    url: str,
    start_line: int = 1,
    window_lines: int = _FETCH_SCROLL_DEFAULT_WINDOW_LINES,
    refresh_if_missing: bool = True,
) -> dict:
    """Read a line window from a previously fetched URL without importing it into Canvas."""
    url = str(url or "").strip()
    if not url:
        return {"error": "url is required", "url": ""}

    start_line = _coerce_grep_int(start_line, default=1, minimum=1, maximum=1_000_000)
    window_lines = _coerce_grep_int(
        window_lines,
        default=_FETCH_SCROLL_DEFAULT_WINDOW_LINES,
        minimum=_FETCH_SCROLL_MIN_WINDOW_LINES,
        maximum=_FETCH_SCROLL_MAX_WINDOW_LINES,
    )
    refresh_if_missing = _coerce_bool(refresh_if_missing, default=True)

    snapshot = _load_fetched_content_snapshot(url, refresh_if_missing=refresh_if_missing)
    raw_text = snapshot.get("raw_text") or ""
    searched_source = str(snapshot.get("searched_source") or "").strip()
    refetch_error = str(snapshot.get("refetch_error") or "").strip()

    if not raw_text:
        error_message = (
            "URL content not found in cache, live fetch, or tool memory. "
            "Call fetch_url for this URL first, then use scroll_fetched_content."
        )
        if refetch_error:
            error_message += f" Live refetch also failed: {refetch_error}"
        return {
            "error": error_message,
            "url": url,
            "line_count": 0,
            "visible_lines": [],
        }

    lines = raw_text.splitlines()
    if not lines:
        lines = [raw_text]

    line_count = len(lines)
    max_start_line = max(1, line_count - window_lines + 1)
    requested_start_line = start_line
    actual_start_line = min(requested_start_line, max_start_line)
    actual_end_line = min(line_count, actual_start_line + window_lines - 1)
    visible_lines = [
        f"{line_number}: {line}"
        for line_number, line in enumerate(lines[actual_start_line - 1 : actual_end_line], start=actual_start_line)
    ]

    result: dict = {
        "url": url,
        "line_count": line_count,
        "start_line": actual_start_line,
        "end_line_actual": actual_end_line,
        "visible_lines": visible_lines,
        "has_more_above": actual_start_line > 1,
        "has_more_below": actual_end_line < line_count,
        "searched_source": searched_source or "unknown",
        "window_lines": window_lines,
    }
    title = str(snapshot.get("title") or "").strip()
    if title:
        result["title"] = title
    content_format = str(snapshot.get("content_format") or "").strip()
    if content_format:
        result["content_format"] = content_format
    if searched_source == "live_refetch":
        result["refetched"] = True
    if requested_start_line != actual_start_line:
        result["requested_start_line"] = requested_start_line

    note_parts = []
    if requested_start_line != actual_start_line:
        note_parts.append(
            f"Requested start line {requested_start_line} exceeded the available content window; showing the last available window instead."
        )
    if note_parts:
        result["note"] = " ".join(note_parts)

    return result


def grep_fetched_content_tool(
    url: str,
    pattern: str,
    context_lines: int = 2,
    max_matches: int = 20,
    refresh_if_missing: bool = True,
) -> dict:
    """Search for a pattern in the cached content of a previously fetched URL.

    Looks up the raw page content from the fetch cache or tool memory, then
    performs a case-insensitive regex search line-by-line and returns matching
    lines with surrounding context.
    """
    url = str(url or "").strip()
    pattern = str(pattern or "").strip()
    if not url:
        return {"error": "url is required", "url": ""}
    if not pattern:
        return {"error": "pattern is required", "url": url}

    context_lines = _coerce_grep_int(context_lines, default=2, minimum=0, maximum=_GREP_CONTEXT_MAX_LINES)
    max_matches = _coerce_grep_int(max_matches, default=20, minimum=1, maximum=_GREP_MAX_MATCHES)
    refresh_if_missing = _coerce_bool(refresh_if_missing, default=True)
    snapshot = _load_fetched_content_snapshot(url, refresh_if_missing=refresh_if_missing)
    raw_text = str(snapshot.get("raw_text") or "")
    searched_source = str(snapshot.get("searched_source") or "").strip()
    refetch_error = str(snapshot.get("refetch_error") or "").strip()

    if not raw_text:
        error_message = (
            "URL content not found in cache, live fetch, or tool memory. "
            "Call fetch_url for this URL first, then use grep_fetched_content."
        )
        if refetch_error:
            error_message += f" Live refetch also failed: {refetch_error}"
        return {
            "error": error_message,
            "url": url,
            "match_count": 0,
            "matches": [],
        }

    try:
        compiled = re.compile(pattern, re.IGNORECASE)
    except re.error as exc:
        return {"error": f"Invalid regex pattern: {exc}", "url": url, "match_count": 0, "matches": []}

    lines = raw_text.splitlines()
    matches: list[dict] = []
    for line_index, line in enumerate(lines):
        if len(matches) >= max_matches:
            break
        if not compiled.search(line):
            continue
        before_start = max(0, line_index - context_lines)
        after_end = min(len(lines), line_index + context_lines + 1)
        matches.append(
            {
                "line_number": line_index + 1,
                "line": line,
                "context_before": lines[before_start:line_index],
                "context_after": lines[line_index + 1 : after_end],
            }
        )

    truncated = len(matches) >= max_matches and any(
        compiled.search(line) for line in lines[matches[-1]["line_number"] :]
    )
    result: dict = {
        "url": url,
        "pattern": pattern,
        "match_count": len(matches),
        "matches": matches,
        "searched_source": searched_source or "unknown",
    }
    if searched_source == "live_refetch":
        result["refetched"] = True
    if truncated:
        result["truncated"] = True
        result["note"] = f"Results limited to {max_matches} matches. Refine the pattern or increase max_matches to see more."
    if not matches:
        result["note"] = "No matches found. The pattern may not appear in the fetched content, or the content was not cached."
    return result


def get_proxy_candidates_for_operation(
    operation: str,
    *,
    include_direct_fallback: bool = False,
    settings: dict | None = None,
) -> list[str | None]:
    """Get proxy candidates for an operation.

    Note: serp-scraper handles proxy rotation internally. This function
    is kept for backward compatibility with code that still needs it.
    """
    enabled_operations = set(get_proxy_enabled_operations(settings))
    normalized_operation = str(operation or "").strip().lower()
    if normalized_operation not in enabled_operations:
        return [None]
    return [None]


def load_proxies() -> list[str]:
    """Load proxies from file.

    Note: serp-scraper uses environment variables for proxy configuration.
    This function is kept for backward compatibility.
    """
    return []


def get_proxy_candidates(include_direct_fallback: bool = False) -> list[str | None]:
    """Get proxy candidates.

    Note: serp-scraper handles proxy rotation internally.
    This function is kept for backward compatibility.
    """
    return [None] if not include_direct_fallback else [None, None]