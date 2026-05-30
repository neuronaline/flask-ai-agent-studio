// Settings tools — tool toggles and sub-agent tools
(function () {
  "use strict";

  // ─── DOM refs ────────────────────────────────────────────────────────────────
  const subAgentToolToggleEls = Array.from(document.querySelectorAll("input[name='sub-agent-allowed-tool']"));

  // ─── Tool selection ─────────────────────────────────────────────────────────
  function getSelectedSubAgentTools() {
    return subAgentToolToggleEls.filter((element) => element.checked).map((element) => element.value);
  }

  // ─── Apply helpers ───────────────────────────────────────────────────────────
  function applySelectedSubAgentTools(selected) {
    const active = new Set(Array.isArray(selected) ? selected : []);
    subAgentToolToggleEls.forEach((element) => {
      element.checked = active.has(element.value);
    });
  }

  // ─── Tool toggles ref (shared with rag.js) ───────────────────────────────────
  function getToolToggleEls() {
    return Array.from(document.querySelectorAll("#tool-toggles input[type='checkbox']"));
  }

  function getSelectedTools() {
    return getToolToggleEls().filter((element) => element.checked).map((element) => element.value);
  }

  function applySelectedTools(selected) {
    const active = new Set(Array.isArray(selected) ? selected : []);
    getToolToggleEls().forEach((element) => {
      element.checked = active.has(element.value);
    });
  }

  // ─── Overview stats ──────────────────────────────────────────────────────────
  function syncOverviewStats() {
    const statToolsEl = document.getElementById("settings-stat-tools");
    if (statToolsEl) {
      const toolCount = getSelectedTools().length;
      statToolsEl.textContent = toolCount === 1 ? "1 enabled" : `${toolCount} enabled`;
    }
  }

  // ─── Export ──────────────────────────────────────────────────────────────────
  window.__settingsTools = {
    getSelectedSubAgentTools,
    applySelectedSubAgentTools,
    getSelectedTools,
    applySelectedTools,
    syncOverviewStats,
  };
})();
