from __future__ import annotations

import socket
from types import SimpleNamespace
from unittest.mock import Mock

import httpx
import pytest

from web import web_tools


@pytest.mark.parametrize(
    ("url", "expected_reason"),
    [
        ("ftp://example.com/file.txt", "Only http and https are supported"),
        ("https:///missing-host", "Hostname not found"),
        ("http://localhost/internal", "Local addresses are prohibited"),
    ],
)
def test_is_safe_url_rejects_invalid_and_local_urls(url, expected_reason):
    safe, reason = web_tools._is_safe_url(url)

    assert safe is False
    assert reason == expected_reason


@pytest.mark.parametrize("address", ["127.0.0.1", "10.0.0.5", "169.254.169.254"])
def test_validate_resolved_ip_address_rejects_non_public_ranges(address):
    with pytest.raises(socket.gaierror):
        web_tools._validate_resolved_ip_address(address)



def test_validate_resolved_ip_address_accepts_public_ip():
    web_tools._validate_resolved_ip_address("93.184.216.34")



def test_guarded_dns_resolution_emits_deprecation_warning():
    import warnings
    with warnings.catch_warnings(record=True) as w:
        warnings.simplefilter("always")
        with web_tools._guarded_dns_resolution(enabled=True):
            pass
    deprecations = [x for x in w if issubclass(x.category, DeprecationWarning)]
    assert len(deprecations) >= 1
    assert "_guarded_dns_resolution is deprecated" in str(deprecations[0].message)


def test_validate_hostname_dns_rejects_private_ip(monkeypatch):
    def fake_getaddrinfo(host, port, family=0, type=0, proto=0, flags=0):
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("10.0.0.1", 0))]
    monkeypatch.setattr(web_tools.socket, "getaddrinfo", fake_getaddrinfo)
    with pytest.raises(socket.gaierror, match="non-public"):
        web_tools._validate_hostname_dns("internal.example.com")


def test_validate_hostname_dns_accepts_public_ip(monkeypatch):
    def fake_getaddrinfo(host, port, family=0, type=0, proto=0, flags=0):
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", 0))]
    monkeypatch.setattr(web_tools.socket, "getaddrinfo", fake_getaddrinfo)
    web_tools._validate_hostname_dns("example.com")  # should not raise



def test_fetch_url_tool_rejects_localhost_without_network_access():
    result = web_tools.fetch_url_tool("http://localhost/private")

    assert result["url"] == "http://localhost/private"
    assert result["content"] == ""
    assert result["error"] == "Local addresses are prohibited"


def test_search_web_tool_uses_cached_results_without_hitting_provider(monkeypatch):
    cached_rows = [{"title": "Cached", "url": "https://example.com", "snippet": "From cache"}]
    monkeypatch.setattr(web_tools, "cache_get", lambda key: cached_rows)
    monkeypatch.setattr(web_tools, "cache_set", lambda *args, **kwargs: None)

    monkeypatch.setattr(
        web_tools,
        "_bright_data_serp_request",
        Mock(side_effect=AssertionError("provider should not be called on cache hit")),
    )

    results = web_tools.search_web_tool(["cached query"])

    assert results == cached_rows



def test_search_web_tool_deduplicates_urls_across_cached_queries(monkeypatch):
    cached_rows = iter([
        [
            {"title": "One", "url": "https://example.com/shared", "snippet": "A"},
            {"title": "Two", "url": "https://example.com/first", "snippet": "B"},
        ],
        [
            {"title": "Three", "url": "https://example.com/shared", "snippet": "C"},
            {"title": "Four", "url": "https://example.com/second", "snippet": "D"},
        ],
    ])

    def fake_cache_get(cache_key):
        assert cache_key.startswith("search:")
        return next(cached_rows)

    monkeypatch.setattr(web_tools, "cache_get", fake_cache_get)
    monkeypatch.setattr(web_tools, "cache_set", lambda *args, **kwargs: None)

    monkeypatch.setattr(
        web_tools,
        "_bright_data_serp_request",
        Mock(side_effect=AssertionError("provider should not run")),
    )

    results = web_tools.search_web_tool(["first", "second"])

    assert [row["url"] for row in results] == [
        "https://example.com/shared",
        "https://example.com/first",
        "https://example.com/second",
    ]


def test_bright_data_request_uses_documented_contract(monkeypatch):
    captured = {}

    class FakeClient:
        def __init__(self, **kwargs):
            captured["client_kwargs"] = kwargs

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return None

        def post(self, url, *, headers, json):
            captured.update(url=url, headers=headers, payload=json)
            request = httpx.Request("POST", url)
            return httpx.Response(200, json={"organic": []}, request=request)

    monkeypatch.setenv("BRIGHT_DATA_API_KEY", "secret-token")
    monkeypatch.setenv("BRIGHT_DATA_SERP_ZONE", "serp-zone")
    monkeypatch.setattr(web_tools.httpx, "Client", FakeClient)

    result = web_tools._bright_data_serp_request(
        "https://www.google.com/search?q=test&hl=en&gl=US"
    )

    assert result == {"organic": []}
    assert captured["url"] == "https://api.brightdata.com/request"
    assert captured["headers"]["Authorization"] == "Bearer secret-token"
    assert captured["payload"] == {
        "zone": "serp-zone",
        "url": "https://www.google.com/search?q=test&hl=en&gl=US",
        "format": "raw",
        "data_format": "parsed_light",
    }
    assert captured["client_kwargs"]["trust_env"] is False


def test_bright_data_request_requires_both_credentials(monkeypatch):
    monkeypatch.delenv("BRIGHT_DATA_API_KEY", raising=False)
    monkeypatch.delenv("BRIGHT_DATA_SERP_ZONE", raising=False)

    with pytest.raises(RuntimeError, match="BRIGHT_DATA_API_KEY"):
        web_tools._bright_data_serp_request("https://www.google.com/search?q=test")


def test_google_target_url_encodes_non_ascii_query(monkeypatch):
    settings = {
        "bright_data_serp_language": "tr",
        "bright_data_serp_country": "TR",
    }
    monkeypatch.setattr(web_tools, "_bright_data_setting", lambda name, default: settings.get(name, default))

    target = web_tools._build_google_url("İstanbul en iyi restoranlar")

    assert "q=%C4%B0stanbul%20en%20iyi%20restoranlar" in target
    assert "hl=tr" in target
    assert "gl=TR" in target


def test_google_news_target_applies_vertical_and_time_filter():
    target = web_tools._build_google_url(
        "latest markets",
        lang="en",
        country="US",
        news=True,
        when="w",
    )

    assert "tbm=nws" in target
    assert "tbs=qdr%3Aw" in target


def test_scholar_target_applies_year_and_sort_filters():
    target = web_tools._build_scholar_url(
        "language models",
        lang="en",
        year_from=2024,
        year_to=2026,
        sort_by="date",
    )

    assert "as_ylo=2024" in target
    assert "as_yhi=2026" in target
    assert "scisbd=1" in target


def test_search_web_normalizes_bright_data_organic_results(monkeypatch):
    monkeypatch.setattr(web_tools, "cache_get", lambda key: None)
    monkeypatch.setattr(web_tools, "cache_set", lambda *args, **kwargs: None)
    monkeypatch.setattr(
        web_tools,
        "_bright_data_serp_request",
        lambda target_url: {
            "organic": [
                {
                    "title": "Example",
                    "link": "https://example.com",
                    "description": "Result snippet",
                }
            ]
        },
    )

    assert web_tools.search_web_tool(["example query"]) == [
        {
            "title": "Example",
            "url": "https://example.com",
            "snippet": "Result snippet",
        }
    ]


def test_fetch_url_tool_uses_pagefetch_result(monkeypatch):
    monkeypatch.setattr(web_tools, "cache_get", lambda key: None)
    monkeypatch.setattr(web_tools, "cache_set", lambda *args, **kwargs: None)
    monkeypatch.setattr(
        web_tools,
        "_run_pagefetch",
        lambda url: SimpleNamespace(
            success=True,
            final_url="https://example.com/final",
            title="Example title",
            markdown="# Example title\n\nClean body",
            text="Example title Clean body",
            content_type="text/html; charset=utf-8",
            status_code=200,
            fetch_method="http",
            from_cache=False,
            error=None,
        ),
    )

    result = web_tools.fetch_url_tool("https://example.com")

    assert result["url"] == "https://example.com/final"
    assert result["requested_url"] == "https://example.com"
    assert result["title"] == "Example title"
    assert result["content"] == "# Example title\n\nClean body"
    assert result["content_format"] == "markdown"
    assert result["fetch_method"] == "http"


def test_pagefetch_settings_map_environment(monkeypatch):
    monkeypatch.setenv("PAGEFETCH_MODE", "browser")
    monkeypatch.setenv("PAGEFETCH_PROXY", "decodo")
    monkeypatch.setenv("PAGEFETCH_CACHE_ENABLED", "false")
    monkeypatch.setenv("PAGEFETCH_HTTP_CONCURRENCY", "7")
    monkeypatch.setenv("PAGEFETCH_HTTP_RETRIES", "4")

    settings = web_tools._pagefetch_settings()

    assert settings["mode"] == "browser"
    assert settings["proxy"] == "decodo"
    assert settings["cache_enabled"] is False
    assert settings["http_concurrency"] == 7
    assert settings["retries_http"] == 4


def test_fetch_url_tool_surfaces_pagefetch_error(monkeypatch):
    monkeypatch.setattr(web_tools, "cache_get", lambda key: None)
    monkeypatch.setattr(
        web_tools,
        "_run_pagefetch",
        lambda url: SimpleNamespace(
            success=False,
            error=SimpleNamespace(message="blocked upstream"),
        ),
    )

    result = web_tools.fetch_url_tool("https://example.com")

    assert result == {
        "url": "https://example.com",
        "error": "blocked upstream",
        "content": "",
    }
