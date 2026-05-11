// Settings RAG — RAG source types, sensitivity, auto-inject
(function () {
  "use strict";

  // ─── DOM refs ────────────────────────────────────────────────────────────────
  const ragSensitivityEl = document.getElementById("rag-sensitivity-select");
  const ragSensitivityHintEl = document.getElementById("rag-sensitivity-hint");
  const ragContextSizeEl = document.getElementById("rag-context-size-select");
  const ragAutoInjectEnabledEl = document.getElementById("rag-auto-inject-enabled-toggle");
  const ragEnabledEl = document.getElementById("rag-enabled-toggle");
  const ragSourceSummaryEl = document.getElementById("rag-source-summary");
  const ragAutoInjectSourceSummaryEl = document.getElementById("rag-auto-inject-source-summary");
  const ragDisabledNoteEl = document.getElementById("rag-disabled-note");
  const ragAutoInjectSourceTypeEls = Array.from(document.querySelectorAll("input[name='rag-auto-inject-source-type']"));

  const ragSourceTypeEls = Array.from(document.querySelectorAll("input[name='rag-source-type']"));

  const featureFlags = window.__featureFlags || {};

  // ─── Constants ────────────────────────────────────────────────────────────────
  const RAG_SOURCE_TYPE_LABELS = window.__settingsCore?.RAG_SOURCE_TYPE_LABELS || {
    conversation: "Chats",
    tool_result: "Tool outputs",
    uploaded_document: "Uploaded documents",
  };

  // ─── RAG selection helpers ───────────────────────────────────────────────────
  function getSelectedRagSourceTypes() {
    return ragSourceTypeEls.filter((element) => element.checked).map((element) => element.value);
  }

  function getSelectedRagAutoInjectSourceTypes() {
    return ragAutoInjectSourceTypeEls.filter((element) => element.checked).map((element) => element.value);
  }

  // ─── RAG apply helpers ───────────────────────────────────────────────────────
  function applySelectedRagSourceTypes(selected) {
    const active = new Set(Array.isArray(selected) ? selected : []);
    ragSourceTypeEls.forEach((element) => {
      element.checked = active.has(element.value);
    });
    syncRagAutoInjectSourceAvailability();
    updateRagSourceSummary();
  }

  function applySelectedRagAutoInjectSourceTypes(selected) {
    const active = new Set(Array.isArray(selected) ? selected : []);
    ragAutoInjectSourceTypeEls.forEach((element) => {
      element.checked = active.has(element.value);
    });
    syncRagAutoInjectSourceAvailability();
  }

  function getRagSourceControlContainer(element) {
    return element?.closest(".rag-source-mode-toggle") || null;
  }

  // ─── RAG sync / update ───────────────────────────────────────────────────────
  function updateRagSensitivityHint() {
    if (!ragSensitivityHintEl || !ragSensitivityEl) return;
    const sensitivity = ragSensitivityEl.value || "normal";
    const hints = window.__settingsCore?.RAG_SENSITIVITY_HINTS || {};
    ragSensitivityHintEl.textContent = hints[sensitivity] || hints.normal || "";
  }

  function formatRagSourceLabels(selectedValues) {
    const values = Array.isArray(selectedValues) ? selectedValues : [];
    const labels = values.map((value) => RAG_SOURCE_TYPE_LABELS[value] || value);
    return labels.join(", ");
  }

  function updateRagSourceSummary() {
    if (!ragSourceSummaryEl) return;

    if (!Boolean(featureFlags.rag_enabled)) {
      ragSourceSummaryEl.textContent = "RAG is disabled in .env, so source pool selection is inactive.";
      return;
    }

    const selected = getSelectedRagSourceTypes();
    if (!selected.length) {
      ragSourceSummaryEl.textContent = "No source pool is enabled for Search. The assistant will skip generic RAG retrieval from chats, tool outputs, and uploaded documents.";
      return;
    }

    ragSourceSummaryEl.textContent = `Search is enabled for: ${formatRagSourceLabels(selected)}. Only these pools can supply generic retrieved context.`;
  }

  function updateRagAutoInjectSourceSummary() {
    if (!ragAutoInjectSourceSummaryEl) return;

    if (!Boolean(featureFlags.rag_enabled)) {
      ragAutoInjectSourceSummaryEl.textContent = "RAG is disabled in .env, so per-source auto-injection is inactive.";
      return;
    }

    const autoInjectEnabled = ragAutoInjectEnabledEl ? ragAutoInjectEnabledEl.checked : false;
    if (!autoInjectEnabled) {
      ragAutoInjectSourceSummaryEl.textContent = "Auto-inject is disabled. Enable the master toggle above to allow automatic RAG injection, even if source pools are configured.";
      return;
    }

    const selected = getSelectedRagAutoInjectSourceTypes();
    if (!selected.length) {
      ragAutoInjectSourceSummaryEl.textContent = "No source pool is marked for Auto inject. Retrieved context can still be searched manually, but nothing will be inserted automatically.";
      return;
    }

    ragAutoInjectSourceSummaryEl.textContent = `Auto inject is configured for: ${formatRagSourceLabels(selected)}. These pools are eligible for automatic prompt insertion.`;
  }

  function syncRagAutoInjectSourceAvailability() {
    const ragEnabled = Boolean(featureFlags.rag_enabled);
    const autoInjectEnabled = ragAutoInjectEnabledEl ? ragAutoInjectEnabledEl.checked : false;

    if (ragAutoInjectEnabledEl) ragAutoInjectEnabledEl.disabled = !ragEnabled;

    ragAutoInjectSourceTypeEls.forEach((element) => {
      element.disabled = !ragEnabled || !autoInjectEnabled;
      getRagSourceControlContainer(element)?.classList.toggle("is-muted", !ragEnabled || !autoInjectEnabled);
    });

    updateRagAutoInjectSourceSummary();
    syncOverviewStats();
  }

  // ─── Overview stats (cross-module) ────────────────────────────────────────────
  function syncOverviewStats() {
    const statRagEl = document.getElementById("settings-stat-rag");
    if (!statRagEl) return;

    if (!featureFlags.rag_enabled) {
      statRagEl.textContent = "Disabled";
    } else {
      const sourceCount = getSelectedRagSourceTypes().length;
      const autoInjectCount = getSelectedRagAutoInjectSourceTypes().length;
      statRagEl.textContent = `${sourceCount} search / ${autoInjectCount} inject`;
    }
  }

  // ─── Export ──────────────────────────────────────────────────────────────────
  window.__settingsRag = {
    getSelectedRagSourceTypes,
    getSelectedRagAutoInjectSourceTypes,
    applySelectedRagSourceTypes,
    applySelectedRagAutoInjectSourceTypes,
    updateRagSensitivityHint,
    updateRagSourceSummary,
    updateRagAutoInjectSourceSummary,
    formatRagSourceLabels,
    syncRagAutoInjectSourceAvailability,
    syncOverviewStats,
  };
})();
