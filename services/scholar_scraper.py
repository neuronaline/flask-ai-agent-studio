"""Google Scholar HTML scraper via HTTP with proxy support.

Replaces the hosted SERP API with direct Scholar scraping. Fetches
the HTML search results page via httpx, parses it with BeautifulSoup,
and returns structured result dicts.
"""

from __future__ import annotations

import re
from typing import Any
from urllib.parse import urlencode

import httpx
from bs4 import BeautifulSoup, Tag

from core.config import DEFAULT_SEARCH_TOOL_QUERY_LIMIT, SEARCH_MAX_RESULTS
from utils.logging_config import get_logger
from utils import proxy_settings

LOGGER = get_logger(__name__)


def _normalize_legacy_row(row: dict) -> dict:
    """Convert legacy Bright Data format to the new scraper format.

    Legacy format used keys ``publication_year``, ``citation_count``,
    and ``authors`` as ``list[str]``.  Normalise to ``year``,
    ``citations``, and ``authors`` as a single string.
    """
    if "publication_year" in row and "year" not in row:
        row["year"] = row.pop("publication_year")
    if "citation_count" in row and "citations" not in row:
        row["citations"] = row.pop("citation_count")
    if isinstance(row.get("authors"), list):
        row["authors"] = ", ".join(str(a) for a in row["authors"])
    return row


SCHOLAR_BASE_URL = "https://scholar.google.com/scholar"
_SCHOLAR_TIMEOUT = 30.0
_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
)


def _resolve_proxy_url() -> str | None:
    """Return the first proxy URL for the ``scholar`` operation, or None."""
    try:
        from core.db import get_app_settings
        settings = get_app_settings()
    except Exception:
        return None
    candidates = proxy_settings.get_proxy_candidates_for_operation(
        proxy_settings.PROXY_OPERATION_SCHOLAR, settings=settings,
    )
    for candidate in candidates:
        if candidate is not None:
            return str(candidate).strip()
    return None


def _build_proxy_url(proxy_url: str | None) -> str | None:
    if not proxy_url:
        return None
    return proxy_url.strip() or None


def _get_search_tool_query_limit_value() -> int:
    """Return the configured search-tool query limit, falling back to the default."""
    try:
        from core.db import load_search_tool_query_limit
        return int(load_search_tool_query_limit())
    except Exception:
        return DEFAULT_SEARCH_TOOL_QUERY_LIMIT


def _http_client(proxy_url: str | None = None) -> httpx.Client:
    transport_kwargs: dict[str, Any] = {}
    if proxy_url:
        transport_kwargs["proxy"] = proxy_url
    transport = httpx.HTTPTransport(**transport_kwargs)
    return httpx.Client(
        transport=transport,
        timeout=_SCHOLAR_TIMEOUT,
        headers={"User-Agent": _USER_AGENT},
        follow_redirects=True,
        trust_env=False,
    )


def _build_search_url(
    query: str,
    *,
    lang: str = "en",
    year_from: int | None = None,
    year_to: int | None = None,
    sort_by: str = "relevance",
    start: int = 0,
) -> str:
    """Build a Google Scholar search URL."""
    params: dict[str, str] = {
        "q": query,
        "hl": lang or "en",
        "start": str(start),
    }
    if year_from is not None:
        params["as_ylo"] = str(year_from)
    if year_to is not None:
        params["as_yhi"] = str(year_to)
    if sort_by == "date":
        params["scisbd"] = "1"
    return f"{SCHOLAR_BASE_URL}?{urlencode(params)}"


def _parse_authors(metadata_text: str) -> str:
    """Extract comma-separated authors from the metadata line.

    Scholar metadata looks like: "A Author, B Author - Venue, 2024"
    """
    if not metadata_text:
        return ""
    # Split on " - " — first part is authors
    parts = metadata_text.split(" - ", 1)
    author_part = parts[0].strip()
    # Filter out fragments that look like years or journal abbreviations
    authors = [a.strip() for a in re.split(r"[,;]", author_part) if a.strip()]
    # Reject entries that are just a year
    filtered = [a for a in authors if not re.match(r"^\d{4}[a-z]?$", a)]
    return ", ".join(filtered)


def _parse_year(metadata_text: str) -> int | None:
    """Extract publication year (4-digit number starting with 19 or 20)."""
    if not metadata_text:
        return None
    match = re.search(r"\b((?:19|20)\d{2})\b", metadata_text)
    if match:
        try:
            return int(match.group(1))
        except ValueError:
            pass
    return None


def _parse_venue(metadata_text: str) -> str:
    """Extract venue/journal name from metadata, stripping year."""
    if not metadata_text:
        return ""
    # Take the part after the last " - " (venue + year)
    parts = metadata_text.split(" - ")
    if len(parts) < 2:
        return ""
    venue_part = parts[-1].strip()
    # Remove year
    venue = re.sub(r"\b(?:19|20)\d{2}\b", "", venue_part)
    # Clean up separators
    venue = re.sub(r"\s*,\s*$", "", venue)
    venue = venue.strip(" ,-")
    return venue


def _parse_citations(footer_text: str) -> int:
    """Extract citation count from the footer text like 'Cited by 42'."""
    if not footer_text:
        return 0
    match = re.search(r"Cited by (\d+)", footer_text, re.IGNORECASE)
    if match:
        try:
            return int(match.group(1))
        except ValueError:
            pass
    return 0


def _parse_results(html: str) -> list[dict[str, Any]]:
    """Parse Google Scholar HTML results page.

    Uses the same DOM selectors as the browser-based serp-scraper.
    """
    soup = BeautifulSoup(html, "lxml")
    results: list[dict[str, Any]] = []

    # Primary selector: div.gs_r.gs_or.gs_scl
    containers = soup.select("div.gs_r.gs_or.gs_scl")

    # Fallback: div.gs_ri (Scholar sometimes wraps differently)
    if not containers:
        containers = soup.select("div.gs_ri")

    # Fallback: elements with data-cid that have an h3 > a
    if not containers:
        containers = [
            el for el in soup.select("[data-cid]")
            if el.get("data-cid", "").strip()
            and len(el.get("data-cid", "").strip()) > 5
            and el.select_one("h3 a")
        ]

    for container in containers:
        result_item = container.select_one("div.gs_ri") or container

        # Title
        title_el = (
            result_item.select_one("h3.gs_rt a")
            or result_item.select_one("h3 a")
            or result_item.select_one("a[data-clk]")
        )
        if not title_el:
            continue
        title = (title_el.get_text(strip=True) or "").strip()
        url = (title_el.get("href") or "").strip()
        if not title or not url:
            continue

        # Snippet
        snippet_el = result_item.select_one("div.gs_rs")
        snippet = snippet_el.get_text(" ", strip=True) if snippet_el else ""

        # Metadata line (authors, venue, year)
        meta_el = result_item.select_one("div.gs_a")
        metadata_text = meta_el.get_text(" ", strip=True) if meta_el else ""

        # Footer (citations, PDF link)
        footer_el = container.select_one("div.gs_fl")
        footer_text = footer_el.get_text(" ", strip=True) if footer_el else ""
        citations = _parse_citations(footer_text)

        # PDF link
        pdf_el = (
            container.select_one("div.gs_ggs a")
            or (footer_el.select_one("a[href$='.pdf']") if footer_el else None)
        )
        pdf_url = pdf_el.get("href", "").strip() if pdf_el else ""

        # Cluster ID
        cluster_id = (container.get("data-cid") or "").strip()

        results.append({
            "title": title,
            "url": url,
            "snippet": snippet,
            "authors": _parse_authors(metadata_text),
            "year": _parse_year(metadata_text),
            "venue": _parse_venue(metadata_text),
            "citations": citations,
            "pdf_url": pdf_url,
            "cluster_id": cluster_id,
        })

    return results


def search_scholar(
    queries: list[str],
    *,
    lang: str = "en",
    year_from: int | None = None,
    year_to: int | None = None,
    sort_by: str = "relevance",
) -> list[dict[str, Any]]:
    """Search Google Scholar directly via HTTP with proxy support.

    Args:
        queries: List of search query strings (1-N).
        lang: Language code (default 'en').
        year_from: Optional start publication year.
        year_to: Optional end publication year.
        sort_by: Sort order: 'relevance' (default) or 'date'.

    Returns:
        List of result dicts with keys: title, url, snippet, authors,
        year, venue, citations, pdf_url, cluster_id.
    """
    import hashlib
    from core.db import cache_get, cache_set

    language = lang if lang in {"en", "tr"} else "en"
    results: list[dict[str, Any]] = []
    seen_urls: set[str] = set()
    proxy_url = _resolve_proxy_url()

    for query in queries[:_get_search_tool_query_limit_value()]:
        query = str(query or "").strip()
        if not query:
            continue
        cache_hash = hashlib.md5(
            f"{query}|{language}|{year_from or ''}|{year_to or ''}|{sort_by}".lower().encode()
        ).hexdigest()
        cache_key = f"scholar:local:{cache_hash}"
        cached = cache_get(cache_key)
        if cached is not None:
            for row in cached:
                u = str(row.get("url", "")).strip()
                if u and u not in seen_urls:
                    seen_urls.add(u)
                    results.append(row)
            continue

        # Try legacy "scholar:bright-data:" key for existing cached data
        legacy_key = f"scholar:bright-data:{cache_hash}"
        legacy_cached = cache_get(legacy_key)
        if legacy_cached is not None:
            normalized = [_normalize_legacy_row(r) for r in legacy_cached]
            cache_set(cache_key, normalized)
            for row in normalized:
                u = str(row.get("url", "")).strip()
                if u and u not in seen_urls:
                    seen_urls.add(u)
                    results.append(row)
            continue

        try:
            url = _build_search_url(
                query, lang=language, year_from=year_from,
                year_to=year_to, sort_by=sort_by,
            )
            with _http_client(_build_proxy_url(proxy_url)) as client:
                response = client.get(url)

            if response.status_code in {429, 503}:
                raise RuntimeError(
                    "Google Scholar rate-limited the request. Try again later."
                )
            response.raise_for_status()

            rows = _parse_results(response.text)[:SEARCH_MAX_RESULTS]
            rows = [r for r in rows if r["url"]]

            cache_set(cache_key, rows)
            for row in rows:
                u = str(row.get("url", "")).strip()
                if u and u not in seen_urls:
                    seen_urls.add(u)
                    results.append(row)
        except Exception as exc:
            LOGGER.error("Scholar search failed for query='%.60s': %s", query, exc)
            results.append({"error": str(exc), "query": query})

    return results
