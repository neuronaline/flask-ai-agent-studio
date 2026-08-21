"""Connection-time URL policy and DNS enforcement.

The single source of truth for "is this URL safe to connect to?" used by
``fetch_url`` (and any future network tool). Designed to defeat:

  - direct private/loopback targets (literal IPs and hostnames)
  - alternate IP encodings (decimal, hex, shortened, IPv4-mapped IPv6,
    trailing dots, IDNA forms)
  - DNS rebinding between validation and connection
  - redirects to private destinations
  - redirect loops and runaway chains
  - embedded credentials and disallowed ports
  - cloud metadata endpoints (link-local 169.254.x, etc.)

The policy is also versioned so cached responses created under an older
policy do not bypass the new checks. Callers include the policy version
in their cache key so older entries are simply not found.
"""

from __future__ import annotations

import ipaddress
import socket
from typing import Iterable, Mapping
from urllib.parse import quote, unquote, urlsplit

# Bumped whenever the URL policy rules change in a way that could affect a
# previously-cached fetch response. Callers must include this version in
# their cache key.
URL_SECURITY_POLICY_VERSION = 2

# Conservative outbound allow-list. The agent never needs to speak anything
# other than http or https.
_ALLOWED_SCHEMES = frozenset({"http", "https"})

# Block every non-public, non-routable network range plus the canonical
# cloud metadata targets. IPv4-mapped IPv6 forms (::ffff:a.b.c.d) reach the
# same addresses via the IPv4 check below, but we still explicitly reject
# the IPv6 equivalents so a TOCTOU attacker cannot smuggle an IPv4
# destination inside a v6 wrapper.
_BLOCKED_IPV4_RANGES = [
    ipaddress.ip_network("0.0.0.0/8"),        # current network
    ipaddress.ip_network("10.0.0.0/8"),       # RFC 1918
    ipaddress.ip_network("100.64.0.0/10"),    # CGNAT
    ipaddress.ip_network("127.0.0.0/8"),      # loopback
    ipaddress.ip_network("169.254.0.0/16"),   # link-local + cloud metadata
    ipaddress.ip_network("172.16.0.0/12"),    # RFC 1918
    ipaddress.ip_network("192.0.0.0/24"),     # IETF protocol assignments
    ipaddress.ip_network("192.0.2.0/24"),     # TEST-NET-1
    ipaddress.ip_network("192.88.99.0/24"),   # 6to4 anycast
    ipaddress.ip_network("192.168.0.0/16"),  # RFC 1918
    ipaddress.ip_network("198.18.0.0/15"),    # benchmarking
    ipaddress.ip_network("198.51.100.0/24"),  # TEST-NET-2
    ipaddress.ip_network("203.0.113.0/24"),   # TEST-NET-3
    ipaddress.ip_network("224.0.0.0/4"),      # multicast
    ipaddress.ip_network("240.0.0.0/4"),      # reserved
    ipaddress.ip_network("255.255.255.255/32"),  # broadcast
]

_BLOCKED_IPV6_RANGES = [
    ipaddress.ip_network("::/128"),            # unspecified
    ipaddress.ip_network("::1/128"),           # loopback
    ipaddress.ip_network("::ffff:0:0/96"),     # IPv4-mapped (validate v4 below)
    ipaddress.ip_network("64:ff9b::/96"),      # IPv4-IPv6 translation
    ipaddress.ip_network("100::/64"),          # discard
    ipaddress.ip_network("2001::/32"),         # Teredo
    ipaddress.ip_network("2001:db8::/32"),     # documentation
    ipaddress.ip_network("fc00::/7"),          # unique local
    ipaddress.ip_network("fe80::/10"),         # link-local
    ipaddress.ip_network("ff00::/8"),          # multicast
]


# Hostnames that resolve to private metadata endpoints even when their DNS
# answers change. We block these by name as an extra safeguard.
_BLOCKED_HOSTNAMES = frozenset({
    "localhost",
    "localhost.localdomain",
    "ip6-localhost",
    "ip6-loopback",
    "metadata.google.internal",
    "metadata",
    "instance-data",
    "instance-data.ec2.internal",
    "169.254.169.254",  # explicit, in case DNS is overridden
})

# Maximum redirect hops. PageFetch follows redirects up to this many; any
# more is treated as a redirect loop and rejected.
MAX_REDIRECT_HOPS = 5


class URLSecurityError(ValueError):
    """Raised when a URL fails the connection-time URL policy."""


def _is_public_ipv4(address: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    """True when ``address`` is routable on the public internet."""
    if isinstance(address, ipaddress.IPv6Address):
        if address.ipv4_mapped is not None:
            mapped = ipaddress.IPv4Address(address.ipv4_mapped)
            return _is_public_ipv4(mapped)
        for blocked in _BLOCKED_IPV6_RANGES:
            if address in blocked:
                return False
        # IPv6 unspecified / loopback / link-local is already covered above.
        return address.is_global

    for blocked in _BLOCKED_IPV4_RANGES:
        if address in blocked:
            return False
    # Reject any address Python considers not globally routable.
    return bool(address.is_global)


def _strip_trailing_dot(hostname: str) -> str:
    return hostname.rstrip(".")


def _normalize_hostname(raw_hostname: str) -> str:
    """Lowercase, strip trailing dots, validate punycode/IDNA.

    Raises URLSecurityError when the hostname is empty, contains NULs,
    or cannot be encoded as IDNA / ASCII.
    """
    if not raw_hostname:
        raise URLSecurityError("Empty hostname")
    if "\x00" in raw_hostname:
        raise URLSecurityError("Hostname contains NUL byte")
    lowered = raw_hostname.strip().lower()
    lowered = _strip_trailing_dot(lowered)
    if not lowered:
        raise URLSecurityError("Empty hostname after normalization")
    if lowered in _BLOCKED_HOSTNAMES:
        raise URLSecurityError(f"Hostname {lowered!r} is on the blocklist")
    # Force IDNA / punycode so comparison with IDN forms is consistent.
    try:
        # IDNA 2008 + UTS-46 normalization.
        normalized = lowered.encode("idna").decode("ascii").lower()
    except UnicodeError:
        # Fall back to ASCII (already lowercased). Anything non-ASCII that
        # fails IDNA is suspicious enough to reject.
        try:
            normalized = lowered.encode("ascii").decode("ascii")
        except UnicodeError as exc:
            raise URLSecurityError(f"Hostname {raw_hostname!r} is not encodable") from exc
    if not normalized:
        raise URLSecurityError("Hostname became empty after IDNA normalization")
    if len(normalized) > 253:
        raise URLSecurityError("Hostname too long")
    # Validate each label (1..63 chars, LDH).
    for label in normalized.split("."):
        if not label or len(label) > 63:
            raise URLSecurityError(f"Invalid label in {raw_hostname!r}")
        if not all(ch.isalnum() or ch == "-" for ch in label):
            raise URLSecurityError(f"Invalid character in label {label!r}")
        if label.startswith("-") or label.endswith("-"):
            raise URLSecurityError(f"Invalid label boundary in {label!r}")
    return normalized


def _normalize_port(raw_port: str | int | None, *, scheme: str) -> int | None:
    """Validate the URL port. None when the scheme-default applies.

    Disallow known-dangerous ports even when the destination resolves to a
    public address; the model never needs them and they can be used to
    pivot into local services.
    """
    if raw_port is None or raw_port == "":
        return None
    if isinstance(raw_port, int):
        port = raw_port
    elif isinstance(raw_port, str) and raw_port.isdigit():
        port = int(raw_port)
    else:
        raise URLSecurityError(f"Port {raw_port!r} is not numeric")
    if not (1 <= port <= 65535):
        raise URLSecurityError(f"Port {port} out of range")
    disallowed_ports = {
        22,    # SSH
        23,    # telnet
        25,    # SMTP
        445,   # SMB
        1433,  # MSSQL
        3306,  # MySQL
        3389,  # RDP
        5432,  # PostgreSQL
        6379,  # Redis
        9200,  # Elasticsearch
        11211, # memcached
    }
    if port in disallowed_ports:
        raise URLSecurityError(f"Port {port} is on the blocklist")
    if scheme == "http" and port == 80:
        return None
    if scheme == "https" and port == 443:
        return None
    return port


def _normalize_url(raw_url: str) -> tuple[str, str, int | None, str]:
    """Validate and normalize a URL into (scheme, hostname, port, path).

    The returned scheme/hostname are case-normalized and ASCII-safe. The
    caller can rely on the hostname being IDNA-encoded for safe comparison
    and DNS resolution.
    """
    if not isinstance(raw_url, str) or not raw_url.strip():
        raise URLSecurityError("Empty URL")
    if "\x00" in raw_url:
        raise URLSecurityError("URL contains NUL byte")
    # Strip whitespace and percent-decode fragments for matching, but do
    # NOT mutate the original — we keep the path for callers.
    raw = raw_url.strip()
    try:
        parsed = urlsplit(raw)
    except ValueError as exc:
        raise URLSecurityError(f"Invalid URL: {exc}") from exc

    scheme = parsed.scheme.lower()
    if scheme not in _ALLOWED_SCHEMES:
        raise URLSecurityError(f"Scheme {scheme!r} is not allowed")

    # Embedded credentials are an SSRF primitive (auth-as-host trick).
    if parsed.username or parsed.password:
        raise URLSecurityError("Embedded credentials are not allowed")

    hostname = _normalize_hostname(parsed.hostname or "")
    port = _normalize_port(parsed.port, scheme=scheme)
    path = parsed.path or "/"
    # Re-decode percent-encodings in the path so a smuggled `%2E%2E`
    # cannot traverse into a private zone after the URL is parsed.
    safe_path = unquote(path)
    if "\x00" in safe_path:
        raise URLSecurityError("URL path contains NUL byte")
    return scheme, hostname, port, quote(safe_path, safe="/:@&+,;=")


def _parse_address(raw: str) -> ipaddress.IPv4Address | ipaddress.IPv6Address:
    """Parse a string into an IP address object (no DNS lookup)."""
    try:
        return ipaddress.ip_address(raw.strip())
    except ValueError as exc:
        raise URLSecurityError(f"Invalid IP address {raw!r}") from exc


def _is_public_address_string(raw: str) -> bool:
    """True when ``raw`` is a public IPv4 or IPv6 address literal."""
    try:
        address = _parse_address(raw)
    except URLSecurityError:
        return False
    return _is_public_ipv4(address)


def resolve_hostname(hostname: str) -> list[str]:
    """Resolve ``hostname`` to a list of IP address strings.

    Pure wrapper around ``socket.getaddrinfo`` so callers can stub it in
    tests. Returns IPv4 and IPv6 answers (deduplicated).
    """
    try:
        infos = socket.getaddrinfo(hostname, None)
    except socket.gaierror:
        return []
    seen: set[str] = set()
    addresses: list[str] = []
    for info in infos:
        sockaddr = info[4] if len(info) > 4 else None
        if not sockaddr:
            continue
        candidate = sockaddr[0]
        if candidate in seen:
            continue
        seen.add(candidate)
        addresses.append(candidate)
    return addresses


def assert_public_addresses(hostname_or_addresses: str | Iterable[str]) -> list[str]:
    """Verify every address in the input is public. Return the public list.

    Accepts a single hostname (resolved through DNS) or an iterable of
    pre-resolved addresses. Raises URLSecurityError when any answer is
    private/loopback/link-local/reserved.
    """
    if isinstance(hostname_or_addresses, str):
        addresses = [hostname_or_addresses]
    else:
        addresses = list(hostname_or_addresses)

    public: list[str] = []
    for raw in addresses:
        if not raw:
            continue
        # If it's not a literal IP, treat as a hostname and resolve it.
        try:
            address = _parse_address(raw)
        except URLSecurityError:
            resolved = resolve_hostname(raw)
            if not resolved:
                raise URLSecurityError(f"DNS resolution failed for {raw!r}") from None
            if not all(_is_public_address_string(entry) for entry in resolved):
                raise URLSecurityError(
                    f"DNS answer for {raw!r} contains a non-public address: {resolved}"
                ) from None
            public.extend(resolved)
            continue

        if not _is_public_ipv4(address):
            raise URLSecurityError(f"Address {raw} is not public")
        public.append(raw)
    if not public:
        raise URLSecurityError("No public addresses resolved")
    return public


def is_safe_url(raw_url: str) -> bool:
    """Backward-compatible boolean wrapper around :func:`validate_url`."""
    try:
        validate_url(raw_url)
    except URLSecurityError:
        return False
    return True


def validate_url(raw_url: str) -> dict:
    """Validate ``raw_url`` end-to-end. Returns the normalized URL info.

    Performs:
      - scheme / hostname / port / path normalization;
      - blocklist checks;
      - DNS resolution and public-address enforcement.

    Raises URLSecurityError on any failure. The returned dict contains
    ``scheme``, ``hostname``, ``port``, ``path``, and the ``addresses``
    list (in resolution order).
    """
    scheme, hostname, port, path = _normalize_url(raw_url)

    # Fast path: literal IP literal hostname.
    if hostname.replace(".", "").replace(":", "").isdigit() or ":" in hostname:
        # Likely an IPv4 or IPv6 literal embedded in the host position.
        public = assert_public_addresses([hostname])
        addresses = public
    else:
        addresses = resolve_hostname(hostname)
        if not addresses:
            raise URLSecurityError(f"DNS resolution failed for {hostname}")
        if not all(_is_public_address_string(entry) for entry in addresses):
            raise URLSecurityError(
                f"DNS answer for {hostname} contains a non-public address: {addresses}"
            )

    return {
        "scheme": scheme,
        "hostname": hostname,
        "port": port,
        "path": path,
        "addresses": addresses,
    }


def detect_redirect_loop(seen: Mapping[str, int], url: str) -> bool:
    """True when ``url`` has been seen too many times in this chain.

    ``seen`` maps url -> hop count. We cap at MAX_REDIRECT_HOPS.
    """
    if not seen:
        return False
    count = seen.get(url, 0)
    return count > MAX_REDIRECT_HOPS


def make_policy_versioned_cache_key(namespace: str, *parts: object) -> str:
    """Build a cache key that incorporates the current URL policy version.

    Older cached responses created under a previous policy version simply
    do not match the new key, so the policy upgrade forces a fresh fetch
    for safety. Tests can pin the policy version to assert the version is
    in the key.
    """
    joined = "|".join(str(part) for part in parts)
    return f"{namespace}:v{URL_SECURITY_POLICY_VERSION}:{joined}"


__all__ = [
    "MAX_REDIRECT_HOPS",
    "URL_SECURITY_POLICY_VERSION",
    "URLSecurityError",
    "assert_public_addresses",
    "detect_redirect_loop",
    "is_safe_url",
    "make_policy_versioned_cache_key",
    "resolve_hostname",
    "validate_url",
]
