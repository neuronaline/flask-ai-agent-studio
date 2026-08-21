"""Phase 6 — Connection-time URL policy and DNS enforcement.

Exercises the policy module directly (no network access) plus the
fetch_url integration for the public-redirect, redirect-loop, and
policy-version cases.
"""

from __future__ import annotations

import socket
from types import SimpleNamespace

import pytest

from web import url_security, web_tools


def _ipv4(answers):
    return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (addr, 0)) for addr in answers]


def _ipv6(answers):
    return [(socket.AF_INET6, socket.SOCK_STREAM, 6, "", (addr, 0, 0, 0)) for addr in answers]


class TestLiteralAddresses:
    """Literal IPv4 and IPv6 forms must be rejected when not public."""

    @pytest.mark.parametrize(
        "address",
        [
            "127.0.0.1",       # loopback
            "0.0.0.0",         # current network
            "10.0.0.5",        # RFC 1918
            "172.16.0.1",      # RFC 1918
            "192.168.1.1",     # RFC 1918
            "169.254.169.254", # cloud metadata
            "100.64.1.1",      # CGNAT
            "224.0.0.1",       # multicast
            "255.255.255.255", # broadcast
            "2130706433",      # decimal 127.0.0.1
        ],
    )
    def test_literal_ipv4_rejected(self, address):
        with pytest.raises(url_security.URLSecurityError):
            url_security.assert_public_addresses([address])

    @pytest.mark.parametrize(
        "address",
        [
            "::1",                       # loopback
            "fc00::1",                   # unique local
            "fe80::1",                   # link-local
            "2001:db8::1",               # documentation
            "ff02::1",                   # multicast
            "::ffff:10.0.0.1",           # IPv4-mapped IPv6 → private
        ],
    )
    def test_literal_ipv6_rejected(self, address):
        with pytest.raises(url_security.URLSecurityError):
            url_security.assert_public_addresses([address])

    def test_public_ipv4_accepted(self):
        public = url_security.assert_public_addresses(["8.8.8.8"])
        assert public == ["8.8.8.8"]


class TestHostnameNormalization:
    """Hostname normalization handles IDN, trailing dots, and blocklists."""

    def test_empty_hostname_rejected(self):
        with pytest.raises(url_security.URLSecurityError):
            url_security._normalize_hostname("")

    def test_trailing_dot_normalized(self):
        normalized = url_security._normalize_hostname("Example.COM.")
        assert normalized == "example.com"

    def test_idna_punycode(self):
        normalized = url_security._normalize_hostname("Bücher.example")
        assert normalized.endswith(".example")

    def test_blocked_metadata_hostname(self):
        with pytest.raises(url_security.URLSecurityError):
            url_security._normalize_hostname("metadata.google.internal")

    def test_blocked_literal_metadata_ip(self):
        with pytest.raises(url_security.URLSecurityError):
            url_security._normalize_hostname("169.254.169.254")

    def test_invalid_label_rejected(self):
        with pytest.raises(url_security.URLSecurityError):
            url_security._normalize_hostname("-bad-label.com")


class TestPortAndScheme:
    """Disallowed ports and embedded credentials must be rejected."""

    def test_embedded_credentials_rejected(self):
        with pytest.raises(url_security.URLSecurityError):
            url_security.validate_url("https://user:pass@example.com/")

    def test_known_dangerous_port_rejected(self):
        with pytest.raises(url_security.URLSecurityError):
            url_security.validate_url("https://example.com:22/")

    def test_default_port_normalized_away(self):
        info = url_security.validate_url("https://example.com:443/path")
        assert info["port"] is None

    def test_unsupported_scheme_rejected(self):
        with pytest.raises(url_security.URLSecurityError):
            url_security.validate_url("ftp://example.com/file.txt")

    def test_out_of_range_port_rejected(self):
        # urllib drops an out-of-range port to None; verify the helper
        # rejects the unsafe variant via a literal numeric port.
        with pytest.raises(url_security.URLSecurityError):
            url_security._normalize_port(99999, scheme="https")
        with pytest.raises(url_security.URLSecurityError):
            url_security._normalize_port(0, scheme="https")


class TestDNSValidation:
    """DNS answers with a private address must be rejected."""

    def test_dns_with_private_answer_rejected(self, monkeypatch):
        def fake_getaddrinfo(host, port, family=0, type=0, proto=0, flags=0):
            return _ipv4(["10.0.0.5"])
        monkeypatch.setattr(
            url_security.socket, "getaddrinfo", fake_getaddrinfo
        )
        with pytest.raises(url_security.URLSecurityError):
            url_security.validate_url("https://example.com/")

    def test_dns_with_mixed_public_and_private_rejected(self, monkeypatch):
        def fake_getaddrinfo(host, port, family=0, type=0, proto=0, flags=0):
            return _ipv4(["8.8.8.8", "10.0.0.5"])
        monkeypatch.setattr(
            url_security.socket, "getaddrinfo", fake_getaddrinfo
        )
        with pytest.raises(url_security.URLSecurityError):
            url_security.validate_url("https://example.com/")

    def test_dns_with_public_answer_accepted(self, monkeypatch):
        def fake_getaddrinfo(host, port, family=0, type=0, proto=0, flags=0):
            return _ipv4(["93.184.216.34"])
        monkeypatch.setattr(
            url_security.socket, "getaddrinfo", fake_getaddrinfo
        )
        info = url_security.validate_url("https://example.com/")
        assert info["hostname"] == "example.com"
        assert info["addresses"] == ["93.184.216.34"]

    def test_dns_resolution_failure_rejected(self, monkeypatch):
        def fake_getaddrinfo(host, port, family=0, type=0, proto=0, flags=0):
            raise socket.gaierror("no answer")
        monkeypatch.setattr(
            url_security.socket, "getaddrinfo", fake_getaddrinfo
        )
        with pytest.raises(url_security.URLSecurityError):
            url_security.validate_url("https://example.com/")


class TestRedirectLoop:
    """Loop detection caps redirect hops."""

    def test_redirect_loop_detected(self):
        seen = {"https://x.example/" : (url_security.MAX_REDIRECT_HOPS + 1)}
        assert url_security.detect_redirect_loop(seen, "https://x.example/")

    def test_no_loop_for_fresh_url(self):
        assert not url_security.detect_redirect_loop({}, "https://x.example/")


class TestPolicyVersionedCache:
    """The cache key must change when the policy version changes."""

    def test_default_versioned_key(self):
        key = url_security.make_policy_versioned_cache_key(
            "fetch", "https://example.com", 1000, True, "pagefetch"
        )
        assert key.startswith(f"fetch:v{url_security.URL_SECURITY_POLICY_VERSION}:")

    def test_version_bump_changes_key(self, monkeypatch):
        first = url_security.make_policy_versioned_cache_key(
            "fetch", "https://example.com", 1000, True, "pagefetch"
        )
        monkeypatch.setattr(
            url_security, "URL_SECURITY_POLICY_VERSION",
            url_security.URL_SECURITY_POLICY_VERSION + 1,
        )
        second = url_security.make_policy_versioned_cache_key(
            "fetch", "https://example.com", 1000, True, "pagefetch"
        )
        assert first != second


class TestFetchUrlIntegration:
    """fetch_url_tool must enforce the policy end-to-end."""

    def test_public_url_redirect_to_private_rejected(self, monkeypatch):
        """A redirect to a private address must short-circuit before any
        network call to the rejected target."""
        monkeypatch.setattr(web_tools, "cache_get", lambda key: None)
        monkeypatch.setattr(web_tools, "cache_set", lambda *args, **kwargs: None)

        def fake_getaddrinfo(host, port, family=0, type=0, proto=0, flags=0):
            if host == "public.example":
                return _ipv4(["93.184.216.34"])
            return _ipv4(["10.0.0.5"])
        monkeypatch.setattr(
            url_security.socket, "getaddrinfo", fake_getaddrinfo
        )

        pagefetch_called = []

        def fake_pagefetch(url):
            pagefetch_called.append(url)
            return SimpleNamespace(
                success=True,
                markdown="# OK",
                text="OK",
                content_type="text/html",
                final_url="https://private.example/secret",
                title="",
                status_code=200,
                fetch_method="http",
                from_cache=False,
            )

        monkeypatch.setattr(web_tools, "_run_pagefetch", fake_pagefetch)

        result = web_tools.fetch_url_tool("https://public.example/page")

        assert result["code"] == "redirect_rejected"
        assert "private.example" in result["error"]
        assert "10.0.0.5" in result["error"]
        # The pagefetch call itself is allowed (the public host is valid),
        # but the redirect target is rejected post-hoc. The critical
        # invariant is that the private target is never connected to again.
        assert pagefetch_called == ["https://public.example/page"]

    def test_redirect_chain_exceeds_cap_rejected(self, monkeypatch):
        """A redirect chain that exceeds the cap must short-circuit."""
        monkeypatch.setattr(web_tools, "cache_get", lambda key: None)
        monkeypatch.setattr(web_tools, "cache_set", lambda *args, **kwargs: None)

        def fake_getaddrinfo(host, port, family=0, type=0, proto=0, flags=0):
            return _ipv4(["93.184.216.34"])
        monkeypatch.setattr(
            url_security.socket, "getaddrinfo", fake_getaddrinfo
        )

        monkeypatch.setattr(
            web_tools,
            "_run_pagefetch",
            lambda url: SimpleNamespace(
                success=True,
                markdown="# OK",
                text="OK",
                content_type="text/html",
                final_url="https://public.example/final",
                title="",
                status_code=200,
                fetch_method="http",
                from_cache=False,
                redirect_count=url_security.MAX_REDIRECT_HOPS + 1,
            ),
        )

        result = web_tools.fetch_url_tool("https://public.example/page")
        assert result["code"] == "redirect_rejected"
        assert "exceeded" in result["error"].lower()

    def test_dns_rebind_rejected(self, monkeypatch):
        """A hostname that resolves to a private address after validation
        must be caught by the policy."""
        monkeypatch.setattr(web_tools, "cache_get", lambda key: None)
        monkeypatch.setattr(web_tools, "cache_set", lambda *args, **kwargs: None)

        def fake_getaddrinfo(host, port, family=0, type=0, proto=0, flags=0):
            return _ipv4(["10.0.0.1"])
        monkeypatch.setattr(
            url_security.socket, "getaddrinfo", fake_getaddrinfo
        )

        result = web_tools.fetch_url_tool("https://public.example/page")

        assert result["code"] in {"url_rejected", "dns_rejected"}
        assert "non-public" in result["error"]

    def test_policy_version_in_cache_key(self, monkeypatch):
        monkeypatch.setattr(web_tools, "cache_get", lambda key: None)
        captured: dict[str, str] = {}

        def fake_set(key, value, **kwargs):
            captured["key"] = key
            captured["value"] = value
        monkeypatch.setattr(web_tools, "cache_set", fake_set)

        def fake_getaddrinfo(host, port, family=0, type=0, proto=0, flags=0):
            return _ipv4(["93.184.216.34"])
        monkeypatch.setattr(
            url_security.socket, "getaddrinfo", fake_getaddrinfo
        )

        monkeypatch.setattr(
            web_tools,
            "_run_pagefetch",
            lambda url: SimpleNamespace(
                success=True,
                markdown="# OK",
                text="OK",
                content_type="text/html",
                final_url=url,
                title="Title",
                status_code=200,
                fetch_method="http",
                from_cache=False,
            ),
        )

        result = web_tools.fetch_url_tool("https://public.example/page")

        # Cache miss → PageFetch is called → result is cached under the
        # versioned key.
        assert captured["key"].startswith(
            f"fetch:v{url_security.URL_SECURITY_POLICY_VERSION}:"
        )
        assert "error" not in result

    def test_cloud_metadata_blocked(self):
        result = web_tools.fetch_url_tool(
            "http://169.254.169.254/latest/meta-data/"
        )
        assert result["code"] in {"url_rejected", "dns_rejected"}
        assert result["content"] == ""

    def test_disallowed_port_blocked(self):
        result = web_tools.fetch_url_tool("https://example.com:22/")
        assert result["code"] == "url_rejected"
        assert "port" in result["error"].lower()
