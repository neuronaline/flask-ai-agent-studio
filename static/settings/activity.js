// Activity log panel — loaded on /settings page only
(function initActivityTab() {
  const PAGE_SIZE = 50;
  let activityOffset = 0;
  let activityTotal = 0;
  let activityFilters = { conversation_id: "", provider: "", operation: "", response_status: "" };
  let activityDetailRecord = null;
  let activityDetailView = "full";
  let conversationOptionsLoaded = false;
  const conversationTitleMap = new Map();

  const conversationFilterEl = document.getElementById("activity-filter-conversation");
  const providerFilterEl = document.getElementById("activity-filter-provider");
  const operationFilterEl = document.getElementById("activity-filter-operation");
  const statusFilterEl = document.getElementById("activity-filter-status");
  const applyBtnEl = document.getElementById("activity-filter-apply-btn");
  const resetBtnEl = document.getElementById("activity-filter-reset-btn");
  const purgeBtnEl = document.getElementById("activity-purge-btn");
  const placeholderEl = document.getElementById("activity-list-placeholder");
  const tableEl = document.getElementById("activity-table");
  const tbodyEl = document.getElementById("activity-table-body");
  const paginationEl = document.getElementById("activity-pagination");
  const prevBtnEl = document.getElementById("activity-prev-btn");
  const nextBtnEl = document.getElementById("activity-next-btn");
  const pageInfoEl = document.getElementById("activity-page-info");
  const detailSectionEl = document.getElementById("activity-detail-section");
  const detailTitleEl = document.getElementById("activity-detail-title");
  const detailSummaryEl = document.getElementById("activity-detail-summary");
  const detailPayloadEl = document.getElementById("activity-detail-payload");
  const detailCopyBtnEl = document.getElementById("activity-detail-copy-btn");
  const detailCloseBtnEl = document.getElementById("activity-detail-close-btn");
  const detailViewBtnEls = Array.from(document.querySelectorAll("[data-activity-detail-view]"));

  if (!providerFilterEl || !tableEl) return; // panel not in DOM

  function fmtNum(n) {
    if (n == null) return "—";
    return Number(n).toLocaleString();
  }
  function fmtMs(ms) {
    if (ms == null) return "—";
    if (ms >= 1000) return (ms / 1000).toFixed(1) + "s";
    return ms + "ms";
  }
  function fmtTime(iso) {
    if (!iso) return "—";
    try { return new Date(iso + "Z").toLocaleString(); } catch { return iso; }
  }
  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
  function getConversationTitle(conversationId) {
    if (!conversationId) return "—";
    const title = conversationTitleMap.get(String(conversationId));
    return title || `#${conversationId}`;
  }
  function statusBadge(s) {
    const tone = s === "ok" ? "ok" : "error";
    return `<span class="activity-status-pill" data-tone="${tone}">${escapeHtml(s || "—")}</span>`;
  }

  async function loadConversationOptions() {
    if (!conversationFilterEl || conversationOptionsLoaded) return;
    try {
      const resp = await fetch("/api/conversations");
      if (!resp.ok) return;
      const conversations = await resp.json();
      if (!Array.isArray(conversations)) return;
      for (const conv of conversations) {
        const id = String(conv?.id || "").trim();
        if (!id || conversationTitleMap.has(id)) continue;
        const title = String(conv?.title || `#${id}`).trim() || `#${id}`;
        conversationTitleMap.set(id, title);
        const option = document.createElement("option");
        option.value = id;
        option.textContent = title.length > 60 ? `${title.slice(0, 57)}…` : title;
        conversationFilterEl.appendChild(option);
      }
      conversationOptionsLoaded = true;
    } catch {
      // best-effort only
    }
  }

  async function loadActivity() {
    if (!placeholderEl || !tableEl) return;
    placeholderEl.hidden = false;
    placeholderEl.textContent = "Loading activity log…";
    tableEl.hidden = true;
    if (paginationEl) paginationEl.hidden = true;

    const params = new URLSearchParams({
      limit: PAGE_SIZE,
      offset: activityOffset,
      sort_by: "created_at",
      sort_dir: "DESC",
    });
    if (activityFilters.conversation_id) params.set("conversation_id", activityFilters.conversation_id);
    if (activityFilters.provider) params.set("provider", activityFilters.provider);
    if (activityFilters.operation) params.set("operation", activityFilters.operation);
    if (activityFilters.response_status) params.set("response_status", activityFilters.response_status);

    try {
      const resp = await fetch("/api/activity?" + params.toString());
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        placeholderEl.textContent = "Failed to load activity: " + (err.error || resp.status);
        return;
      }
      const data = await resp.json();
      activityTotal = data.total || 0;
      renderActivityTable(data.records || []);
    } catch (e) {
      placeholderEl.textContent = "Network error loading activity.";
    }
  }

  function renderActivityTable(records) {
    if (!tbodyEl || !tableEl) return;
    tbodyEl.innerHTML = "";
    if (!records.length) {
      if (placeholderEl) { placeholderEl.textContent = "No activity records found."; placeholderEl.hidden = false; }
      tableEl.hidden = true;
      if (paginationEl) paginationEl.hidden = true;
      return;
    }
    if (placeholderEl) placeholderEl.hidden = true;
    tableEl.hidden = false;

    for (const r of records) {
      const tr = document.createElement("tr");
      const cacheHit = r.prompt_cache_hit_tokens;
      const cacheInfo = cacheHit != null ? `${fmtNum(cacheHit)} hit` : "—";
      tr.innerHTML = [
        `<td class="activity-cell-nowrap">${escapeHtml(fmtTime(r.created_at))}</td>`,
        `<td>${escapeHtml(r.provider || "—")}</td>`,
        `<td class="activity-cell-model" title="${escapeHtml(r.api_model || "")}">${escapeHtml(r.api_model || "—")}</td>`,
        `<td title="${escapeHtml(getConversationTitle(r.conversation_id))}">${escapeHtml(r.operation || r.call_type || "—")}</td>`,
        `<td>${statusBadge(r.response_status)}</td>`,
        `<td>${escapeHtml(fmtNum(r.prompt_tokens))} / ${escapeHtml(fmtNum(r.completion_tokens))}</td>`,
        `<td>${escapeHtml(cacheInfo)}</td>`,
        `<td>${escapeHtml(fmtMs(r.latency_ms))}</td>`,
        `<td><button class="btn-ghost activity-detail-btn" data-id="${r.id}" type="button">View</button></td>`,
      ].join("");
      tbodyEl.appendChild(tr);
    }

    // Populate provider filter options dynamically
    if (providerFilterEl) {
      providerFilterEl.innerHTML = '<option value="">All providers</option>';
      const providers = [...new Set(records.map(r => r.provider).filter(Boolean))];
      providers.forEach(p => {
        const opt = document.createElement("option");
        opt.value = p; opt.textContent = p;
        providerFilterEl.appendChild(opt);
      });
    }

    // Pagination
    if (paginationEl && pageInfoEl) {
      const currentPage = Math.floor(activityOffset / PAGE_SIZE) + 1;
      const totalPages = Math.max(1, Math.ceil(activityTotal / PAGE_SIZE));
      pageInfoEl.textContent = `Page ${currentPage} of ${totalPages} (${activityTotal} total)`;
      paginationEl.hidden = totalPages <= 1;
      if (prevBtnEl) prevBtnEl.disabled = activityOffset === 0;
      if (nextBtnEl) nextBtnEl.disabled = activityOffset + PAGE_SIZE >= activityTotal;
    }

    // Row click → detail
    tbodyEl.querySelectorAll(".activity-detail-btn").forEach(btn => {
      btn.addEventListener("click", () => void loadActivityDetail(Number(btn.dataset.id)));
    });
  }

  function renderActivityDetail() {
    if (!detailPayloadEl || !detailTitleEl || !detailSectionEl) return;
    const rec = activityDetailRecord || {};
    const responseSummary = rec.response_summary && typeof rec.response_summary === "object" ? rec.response_summary : {};
    const requestPayload = rec.request && typeof rec.request === "object" ? rec.request : {};
    const fullPayload = rec && typeof rec === "object" ? rec : {};

    detailTitleEl.textContent = `Record #${rec.id || "…"} — ${rec.provider || ""} ${rec.api_model || ""} [${rec.operation || rec.call_type || ""}]`;

    if (detailSummaryEl) {
      const cacheParts = [];
      if (rec.prompt_cache_hit_tokens != null) cacheParts.push(`${fmtNum(rec.prompt_cache_hit_tokens)} hit`);
      if (rec.prompt_cache_miss_tokens != null) cacheParts.push(`${fmtNum(rec.prompt_cache_miss_tokens)} miss`);
      if (rec.prompt_cache_write_tokens != null) cacheParts.push(`${fmtNum(rec.prompt_cache_write_tokens)} write`);
      const cacheInfo = cacheParts.length ? cacheParts.join(", ") : "—";
      const cards = [
        ["Conversation", getConversationTitle(rec.conversation_id)],
        ["Conversation ID", rec.conversation_id || "—"],
        ["Source message", rec.source_message_id || "—"],
        ["Status", rec.response_status || "—"],
        ["Tokens", `${fmtNum(rec.prompt_tokens)} / ${fmtNum(rec.completion_tokens)} / ${fmtNum(rec.total_tokens)}`],
        ["Cache", cacheInfo],
        ["Latency", fmtMs(rec.latency_ms)],
        ["Payload size", rec.request_payload_bytes ? `${fmtNum(rec.request_payload_bytes)} bytes` : "—"],
        ["Payload hash", rec.request_payload_hash || "—"],
      ];
      detailSummaryEl.innerHTML = cards.map(([label, value]) => (
        `<div class="activity-detail-summary-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`
      )).join("");
      detailSummaryEl.hidden = false;
    }

    detailViewBtnEls.forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.activityDetailView === activityDetailView);
      btn.setAttribute("aria-selected", String(btn.dataset.activityDetailView === activityDetailView));
    });

    let payloadToShow = fullPayload;
    if (activityDetailView === "request") {
      payloadToShow = requestPayload;
    } else if (activityDetailView === "response") {
      payloadToShow = responseSummary;
    }
    detailPayloadEl.textContent = JSON.stringify(payloadToShow, null, 2);
    detailSectionEl.hidden = false;
  }

  async function loadActivityDetail(id) {
    if (!detailSectionEl || !detailPayloadEl || !detailTitleEl) return;
    detailTitleEl.textContent = `Record #${id}`;
    detailPayloadEl.textContent = "Loading…";
    detailSectionEl.hidden = false;
    detailSectionEl.scrollIntoView({ behavior: "smooth", block: "start" });
    try {
      const resp = await fetch(`/api/activity/${id}`);
      if (!resp.ok) { detailPayloadEl.textContent = "Failed to load detail."; return; }
      const data = await resp.json();
      activityDetailRecord = data.record || {};
      renderActivityDetail();
    } catch (e) {
      detailPayloadEl.textContent = "Network error.";
    }
  }

  if (detailCloseBtnEl) {
    detailCloseBtnEl.addEventListener("click", () => { if (detailSectionEl) detailSectionEl.hidden = true; });
  }
  if (detailCopyBtnEl) {
    detailCopyBtnEl.addEventListener("click", async () => {
      const rec = activityDetailRecord || {};
      try {
        await navigator.clipboard.writeText(JSON.stringify(rec, null, 2));
        detailCopyBtnEl.textContent = "Copied";
        window.setTimeout(() => { detailCopyBtnEl.textContent = "Copy JSON"; }, 1200);
      } catch {
        detailCopyBtnEl.textContent = "Copy failed";
        window.setTimeout(() => { detailCopyBtnEl.textContent = "Copy JSON"; }, 1200);
      }
    });
  }
  detailViewBtnEls.forEach((btn) => {
    btn.addEventListener("click", () => {
      activityDetailView = btn.dataset.activityDetailView || "full";
      renderActivityDetail();
    });
  });
  if (conversationFilterEl) {
    conversationFilterEl.addEventListener("focus", () => { void loadConversationOptions(); }, { once: true });
  }

  if (applyBtnEl) {
    applyBtnEl.addEventListener("click", () => {
      activityFilters.conversation_id = conversationFilterEl ? conversationFilterEl.value : "";
      activityFilters.provider = providerFilterEl ? providerFilterEl.value : "";
      activityFilters.operation = operationFilterEl ? operationFilterEl.value : "";
      activityFilters.response_status = statusFilterEl ? statusFilterEl.value : "";
      activityOffset = 0;
      void loadActivity();
    });
  }
  if (resetBtnEl) {
    resetBtnEl.addEventListener("click", () => {
      activityFilters = { conversation_id: "", provider: "", operation: "", response_status: "" };
      if (conversationFilterEl) conversationFilterEl.value = "";
      if (providerFilterEl) providerFilterEl.value = "";
      if (operationFilterEl) operationFilterEl.value = "";
      if (statusFilterEl) statusFilterEl.value = "";
      activityOffset = 0;
      void loadActivity();
    });
  }
  if (prevBtnEl) {
    prevBtnEl.addEventListener("click", () => {
      if (activityOffset >= PAGE_SIZE) { activityOffset -= PAGE_SIZE; void loadActivity(); }
    });
  }
  if (nextBtnEl) {
    nextBtnEl.addEventListener("click", () => {
      if (activityOffset + PAGE_SIZE < activityTotal) { activityOffset += PAGE_SIZE; void loadActivity(); }
    });
  }
  if (purgeBtnEl) {
    purgeBtnEl.addEventListener("click", async () => {
      if (!confirm("Delete all activity records older than the retention period?")) return;
      try {
        const resp = await fetch("/api/activity/purge-expired", { method: "POST", headers: { "X-CSRF-Token": window.__csrfToken } });
        const data = await resp.json().catch(() => ({}));
        alert(`Purged ${data.deleted ?? "?"} records (retention: ${data.retention_days ?? "?"} days).`);
        activityOffset = 0;
        void loadActivity();
      } catch {
        alert("Purge failed.");
      }
    });
  }

  // Load when Activity tab becomes active
  const activityTabBtn = document.getElementById("activity-tab");
  if (activityTabBtn) {
    activityTabBtn.addEventListener("click", () => {
      void loadConversationOptions();
      if (activityTotal === 0 && activityOffset === 0) void loadActivity();
    });
  }

  // Auto-load if hash points to activity on page load
  if (window.location.hash === "#activity") {
    void loadConversationOptions();
    void loadActivity();
  }
})();
