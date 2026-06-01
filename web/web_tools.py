from __future__ import annotations

import asyncio
import contextlib
import hashlib
import httpx
import ipaddress
import json
import logging
import os
import re
import socket
import threading
import unicodedata
from urllib.parse import urlparse
from defusedxml import ElementTree as ET
from core.config import (
    CONTENT_MAX_CHARS,
    DEFAULT_SEARCH_TOOL_QUERY_LIMIT,
    SEARCH_MAX_RESULTS,
)
from core.db import cache_get, cache_set, get_search_tool_query_limit as load_search_tool_query_limit
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


# ---------------------------------------------------------------------------
# Monkey-patch serp-scraper: _setup_proxy_auth hiç çağrılmıyor, bu yüzden
# Chrome proxy auth popup'ı gösteriyor. CDP auth handler'ı sayfaya gitmeden
# önce kaydedecek şekilde _fetch_browser_impl ve _search_impl'i yamalıyoruz.
# ---------------------------------------------------------------------------
def _patch_serp_proxy_auth():
    """Apply proxy auth monkey-patches to serp.parsers (safe to call multiple times)."""
    if _patch_serp_proxy_auth._applied:
        return
    try:
        import serp.parsers as _p
        import markdownify as _md

        async def _patched_fetch(url, proxy=None, headless=False):
            browser = await _p._create_browser(proxy, headless)
            if browser is None:
                raise _p.ParseError("Failed to start browser")
            tab = None
            try:
                tab = await browser.get("about:blank")
                if proxy:
                    _p._setup_proxy_auth(tab, proxy)
                await tab.get(url)
                await tab.wait("load")
                await asyncio.sleep(1)
                if not tab.url or tab.url == "about:blank":
                    raise _p.PageTimeoutError("Page did not load")
                content = await tab.get_content()
                if _p._check_captcha(tab.url, content):
                    raise _p.CaptchaError("Captcha detected")
                markdown = _md.markdownify(_p.clean_html(content), heading_style="ATX")
                return _p.clean_markdown(markdown)
            finally:
                if tab:
                    try:
                        await tab.close()
                    except Exception:
                        pass
                try:
                    await _p._cleanup_browser(browser)
                except Exception:
                    pass

        async def _patched_search(query, page_num=1, proxy=None, headless=False, source="google"):
            url = (
                f"https://www.google.com/search?q={query}&start={(page_num-1)*10}&hl=en&gl=us&lr=lang_en"
                if source == "google"
                else f"https://www.bing.com/search?q={query}&first={(page_num-1)*10+1}&FORM=PERE"
            )
            captcha_msg = f"CAPTCHA detected on {source.capitalize()}"
            browser = await _p._create_browser(proxy, headless)
            if browser is None:
                raise _p.ParseError("Failed to start browser")
            tab = None
            try:
                tab = await browser.get("about:blank")
                if proxy:
                    _p._setup_proxy_auth(tab, proxy)
                await tab.get(url)
                for sel in ([
                    "li.b_algo", "#b_results", "ol#b_results"
                ] if source == "bing" else [
                    "div.g", "div#rso > div", "div.MjjYud", "div[data-hveid]"
                ]):
                    try:
                        await tab.select(sel, timeout=8)
                        break
                    except Exception:
                        continue
                if "sorry/app" in (tab.url or "").lower() or "/captcha/" in (tab.url or "").lower():
                    raise _p.CaptchaError(captcha_msg)
                if not tab.url or tab.url == "about:blank":
                    raise _p.PageTimeoutError("Failed to navigate")
                html = await tab.get_content()
                if _p._check_captcha(tab.url, html):
                    raise _p.CaptchaError(captcha_msg)
                return await (
                    _p._parse_bing_results(tab, page_num)
                    if source == "bing"
                    else _p._parse_google_results(tab, page_num)
                )
            finally:
                if tab:
                    try:
                        await tab.close()
                    except Exception:
                        pass
                try:
                    await _p._cleanup_browser(browser)
                except Exception:
                    pass

        _p._fetch_browser_impl = _patched_fetch
        _p._search_impl = _patched_search
        _patch_serp_proxy_auth._applied = True
        LOGGER.info("serp-scraper proxy auth patch applied inline")
    except Exception as exc:
        LOGGER.warning("serp proxy auth patch failed: %s", exc)


_NEWS_TIMELIMIT = {"d": "d", "w": "w", "m": "m", "y": "y"}
_NEWS_REGION = {"tr": "tr-tr", "en": "us-en"}
_GN_LANG = {
    "tr": {"hl": "tr", "gl": "TR", "ceid": "TR:tr"},
    "en": {"hl": "en", "gl": "US", "ceid": "US:en"},
}
_THIN_CONTENT_MIN_CHARS = 80
_ZERO_WIDTH_TRANSLATION = dict.fromkeys(map(ord, "\u200b\u200c\u200d\ufeff"), None)
LOGGER = logging.getLogger(__name__)
_ASYNC_LOOP_LOCAL = threading.local()

# Apply serp-scraper proxy auth fix (LOGGER must be defined first)
_patch_serp_proxy_auth._applied = False
_patch_serp_proxy_auth()


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


@contextlib.contextmanager
def _guarded_dns_resolution(enabled: bool = True):
    """Context manager that wraps socket.getaddrinfo to validate resolved IPs.

    When enabled, temporarily replaces socket.getaddrinfo with a version that
    calls _validate_resolved_ip_address on every resolved IP address, blocking
    DNS rebinding / SSRF attacks that resolve public hostnames to private IPs.
    Restores the original socket.getaddrinfo on exit, even on exception.
    """
    if not enabled:
        yield
        return

    original_getaddrinfo = socket.getaddrinfo

    def guarded_getaddrinfo(host, port, family=0, type=0, proto=0, flags=0):
        results = original_getaddrinfo(host, port, family, type, proto, flags)
        for result in results:
            addr = result[4][0] if len(result) >= 5 else None
            if addr:
                _validate_resolved_ip_address(addr)
        return results

    try:
        socket.getaddrinfo = guarded_getaddrinfo
        yield
    finally:
        socket.getaddrinfo = original_getaddrinfo


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

    Uses a thread-local event loop to avoid race conditions when
    multiple threads call search/fetch tools concurrently.
    """
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            # Already inside an async context; create a temporary loop
            temp_loop = asyncio.new_event_loop()
            try:
                return temp_loop.run_until_complete(coro)
            finally:
                temp_loop.close()
    except RuntimeError:
        pass
    # Use thread-local loop singleton
    loop = getattr(_ASYNC_LOOP_LOCAL, "loop", None)
    if loop is None or loop.is_closed():
        loop = asyncio.new_event_loop()
        _ASYNC_LOOP_LOCAL.loop = loop
    return loop.run_until_complete(coro)


def _get_serp_config():
    """Get SerpClient configuration from environment/proxy settings.

    Respects SERP_HEADLESS, SERP_LOG_LEVEL, and SERP_DEBUG env vars.
    Uses headless=False by default with virtual display check when not
    headless. To override, set SERP_HEADLESS=true in .env.
    """
    headless = os.environ.get("SERP_HEADLESS", "false").strip().lower() in {"1", "true", "yes", "on"}
    log_level = (os.environ.get("SERP_LOG_LEVEL") or "WARNING").strip().upper()
    serp_debug = os.environ.get("SERP_DEBUG", "false").strip().lower() in {"1", "true", "yes", "on"}

    if serp_debug and log_level == "WARNING":
        log_level = "DEBUG"

    if not headless:
        # Non-headless mode requires a virtual display (xvfb)
        require_virtual_display()

    config = SerpConfig(
        headless=headless,
        cache_enabled=True,
        log_level=log_level,
    )
    LOGGER.info("SerpConfig created: headless=%s, log_level=%s, debug=%s", headless, log_level, serp_debug)
    return config


def search_web_tool(queries: list) -> list:
    """Web search using serp-scraper SerpClient.

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

    config = _get_serp_config()
    LOGGER.info("search_web_tool: starting %d query(s), headless=%s", len(queries), config.headless)

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

        LOGGER.debug("search_web_tool: cache MISS for query='%.60s' — calling SerpClient.search()", query)
        try:
            async def _do_search():
                async with SerpClient(config) as client:
                    return await client.search(query)

            search_results = _run_async(_do_search())
            LOGGER.info("search_web_tool: query='%.60s' returned %d raw results", query, len(search_results))

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

    time_range = _NEWS_TIMELIMIT.get(when) if when else None
    results = []
    seen_urls = set()
    LOGGER.info("_search_news_internal[%s]: starting %d query(s), lang=%s, when=%s", cache_prefix, len(queries), lang, when)

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

        LOGGER.debug("_search_news_internal[%s]: cache MISS for query='%.60s' — calling GoogleNewsClient.get_news()", cache_prefix, query)
        try:
            async def _do_news():
                async with GoogleNewsClient(
                    language=lang,
                    country=country,
                    time_range=time_range,
                ) as client:
                    return await client.get_news(query, max_results=SEARCH_MAX_RESULTS)

            news_results = _run_async(_do_news())
            LOGGER.info("_search_news_internal[%s]: query='%.60s' returned %d raw news results", cache_prefix, query, len(news_results))

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
    """News search using serp-scraper GoogleNewsClient (DuckDuckGo region codes).

    Args:
        queries: List of search query strings
        lang: Language code (tr, en, etc.)
        when: Time range (d, w, m, y)

    Returns:
        List of dicts with keys: title, link, time, source (or error, query on failure)
    """
    region = _NEWS_REGION.get(lang, "tr-tr")
    country = region.upper().replace("-", "_")
    return _search_news_internal(queries, lang, when, country, cache_prefix="news")


def search_news_google_tool(queries: list, lang: str = "tr", when: str | None = None) -> list:
    """News search using Google News RSS via serp-scraper (Google hl/gl/ceid params).

    Args:
        queries: List of search query strings
        lang: Language code (tr, en, etc.)
        when: Time range (d, w, m, y)

    Returns:
        List of dicts with keys: title, link, time, source (or error, query on failure)
    """
    geo = _GN_LANG.get(lang, _GN_LANG["tr"])
    country = geo["gl"]
    return _search_news_internal(queries, lang, when, country, cache_prefix="news_google")

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
        LOGGER.debug("search_scholar_tool: empty query list, returning []")
        return []

    scholar_language = lang if lang in ("en", "tr") else "en"
    results = []
    seen_urls = set()
    LOGGER.info("search_scholar_tool: starting %d query(s), lang=%s, year_from=%s, year_to=%s, sort=%s", len(queries), lang, year_from, year_to, sort_by)

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

        LOGGER.debug("search_scholar_tool: cache MISS for query='%.60s' — calling ScholarClient.search_scholar()", query)
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
            LOGGER.info("search_scholar_tool: query='%.60s' returned %d raw scholar results", query, len(scholar_results))

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
            LOGGER.debug("_fetch_url_direct: HEAD %s", url)
            head_resp = client.head(url)
            head_resp.raise_for_status()
            content_type = (head_resp.headers.get("content-type") or "").lower()
            LOGGER.debug("_fetch_url_direct: HEAD %s -> %s (status=%d)", url, content_type, head_resp.status_code)

            # HTML and unknown types → return content-type only; serp-scraper does the fetch
            if "html" in content_type or not content_type:
                LOGGER.debug("_fetch_url_direct: HTML/unknown type -> serp-scraper will handle fetch for %s", url)
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


def fetch_url_tool(
    url: str,
    *,
    compress: bool = True,
    content_max_chars: int = CONTENT_MAX_CHARS,
    cache_namespace: str = "fetch",
) -> dict:
    """Fetch URL content using serp-scraper (with type detection).
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

    # --- Default: use serp-scraper SerpClient for HTML pages ---
    LOGGER.info("fetch_url_tool: delegating to SerpClient.fetch() for HTML: %s", url)
    config = _get_serp_config()
    config.cache_enabled = False

    try:
        async def _do_fetch():
            async with SerpClient(config) as client:
                return await client.fetch(url, compress=compress)

        content = _run_async(_do_fetch())

        if not content:
            LOGGER.warning("fetch_url_tool: SerpClient returned empty content for %s", url)
            return {"url": url, "error": "Empty content returned", "content": ""}

        LOGGER.info("fetch_url_tool: SerpClient fetch succeeded for %s (%d chars)", url, len(content))
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
        LOGGER.error("fetch_url_tool: SerpClient.fetch FAILED for %s: %s", url, exc)
        return {"url": url, "error": str(exc), "content": ""}


def get_proxy_candidates_for_operation(
    operation: str,
    *,
    include_direct_fallback: bool = False,
    settings: dict | None = None,
) -> list[str | None]:
    """Return proxy candidates for a given operation.

    Proxy management is delegated to serp-scraper (via environment variables).
    This function always returns [None] (direct connection) and exists only for
    backward compatibility with callers that still iterate proxy candidates.
    """
    return [None]


def load_proxies() -> list[str]:
    """Load proxies from file (stub — serp-scraper handles proxy configuration)."""
    return []


def get_proxy_candidates(include_direct_fallback: bool = False) -> list[str | None]:
    """Return proxy candidates (stub — serp-scraper handles proxy configuration)."""
    return [None]