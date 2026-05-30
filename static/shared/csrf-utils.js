// CSRF utilities - shared between app.js and settings.js
(function () {
  "use strict";

  // ── Bootstrap data parsing ───────────────────────────────────────
  var bootstrapEl = document.getElementById("app-bootstrap");
  var bootstrapData;
  if (!bootstrapEl) {
    bootstrapData = { settings: {} };
  } else {
    try {
      bootstrapData = JSON.parse(bootstrapEl.textContent || "{}") || { settings: {} };
    } catch (_) {
      bootstrapData = { settings: {} };
    }
  }

  // Export globally so app.js / settings.js can use them without duplication
  window.__bootstrapData = bootstrapData;
  window.__appSettings = bootstrapData.settings || {};
  window.__csrfToken = String(bootstrapData.csrf_token || "").trim();
  window.__featureFlags = bootstrapData.features || window.__appSettings.features || {};

  // ── CSRF-aware fetch wrapper ─────────────────────────────────────
  // Fixes: Original code used spread operator `{ ...init }` which loses
  // non-enumerable properties like AbortSignal, ReadableStream, etc.
  // Fix: Use Request constructor properly to merge headers while preserving
  // all other Request properties.

  var nativeFetch = typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) : null;
  var CSRF_SAFE_HTTP_METHODS = new Set(["GET", "HEAD", "OPTIONS", "TRACE"]);

  function resolveFetchMethod(input, init) {
    var explicitMethod = String(init?.method || "").trim();
    if (explicitMethod) {
      return explicitMethod.toUpperCase();
    }
    if (input instanceof Request) {
      return String(input.method || "GET").trim().toUpperCase() || "GET";
    }
    return "GET";
  }

  function resolveFetchUrl(input) {
    if (input instanceof Request) {
      return input.url;
    }
    return String(input || "").trim();
  }

  function shouldAttachCsrfHeader(input, init) {
    if (!nativeFetch || !window.__csrfToken) {
      return false;
    }
    var method = resolveFetchMethod(input, init);
    if (CSRF_SAFE_HTTP_METHODS.has(method)) {
      return false;
    }
    var rawUrl = resolveFetchUrl(input);
    if (!rawUrl) {
      return true;
    }
    try {
      var resolvedUrl = new URL(rawUrl, window.location.href);
      return resolvedUrl.origin === window.location.origin;
    } catch (_) {
      return true;
    }
  }

  function buildHeaders(input, init) {
    // Build a Headers object from init.headers or Request.headers
    var sourceHeaders = null;
    if (init && init.headers instanceof Headers) {
      sourceHeaders = init.headers;
    } else if (input instanceof Request && input.headers instanceof Headers) {
      sourceHeaders = input.headers;
    } else if (init && typeof init.headers === "object" && init.headers !== null) {
      sourceHeaders = new Headers(init.headers);
    }
    var headers = sourceHeaders ? new Headers(sourceHeaders) : new Headers();
    if (!headers.has("X-CSRF-Token")) {
      headers.set("X-CSRF-Token", window.__csrfToken);
    }
    return headers;
  }

  /**
   * CSRF-aware fetch that properly preserves Request properties.
   * Uses the Request constructor to merge headers while keeping
   * signal, body, mode, credentials, cache, redirect, referrer, etc.
   *
   * @param {string|Request} input - URL or Request object
   * @param {RequestInit} [init] - Optional request init
   * @returns {Promise<Response>}
   */
  function csrfAwareFetch(input, init) {
    if (!shouldAttachCsrfHeader(input, init)) {
      return nativeFetch(input, init);
    }

    var headers = buildHeaders(input, init);

    if (input instanceof Request) {
      // For Request objects: create a new Request with merged headers.
      // This preserves all other Request properties (signal, body, etc.)
      // as the Request constructor copies them from the source Request.
      return nativeFetch(new Request(input, { headers: headers }));
    }

    // For URL strings: use Object.assign to create a plain object,
    // then set headers. Object.assign only copies enumerable properties,
    // which is acceptable for RequestInit as all its properties are enumerable.
    return nativeFetch(input, Object.assign({}, init, { headers: headers }));
  }

  // Export as both the recommended API client and patch global fetch
  window.__apiFetch = csrfAwareFetch;

  // Patch globalThis.fetch for backward compatibility with existing code.
  // This is the safer version that doesn't lose Request properties.
  if (nativeFetch) {
    globalThis.fetch = csrfAwareFetch;
  }
})();
