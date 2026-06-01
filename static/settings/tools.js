// Settings tools — tool toggles, sub-agent tools, and sub-agent canvas automation
(function () {
  "use strict";

  // ─── DOM refs ────────────────────────────────────────────────────────────────
  const subAgentToolToggleEls = Array.from(document.querySelectorAll("input[name='sub-agent-allowed-tool']"));
  const subAgentCanvasAutoSaveEl = document.getElementById("sub-agent-canvas-auto-save-toggle");
  const subAgentCanvasAutoOpenEl = document.getElementById("sub-agent-canvas-auto-open-toggle");

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

  // ─── Tool toggles ref (parent/main-agent checkboxes) ─────────────────────────
  function getToolToggleEls() {
    return Array.from(document.querySelectorAll("input[name='parent-tool']"));
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

  // ─── Sub-agent canvas automation ────────────────────────────────────────────
  function syncSubAgentCanvasSettings(appSettings) {
    if (subAgentCanvasAutoSaveEl) subAgentCanvasAutoSaveEl.checked = Boolean(appSettings.sub_agent_canvas_auto_save ?? true);
    if (subAgentCanvasAutoOpenEl) subAgentCanvasAutoOpenEl.checked = Boolean(appSettings.sub_agent_canvas_auto_open ?? false);
  }

  function readSubAgentCanvasPayload() {
    return {
      sub_agent_canvas_auto_save: subAgentCanvasAutoSaveEl ? subAgentCanvasAutoSaveEl.checked : true,
      sub_agent_canvas_auto_open: subAgentCanvasAutoOpenEl ? subAgentCanvasAutoOpenEl.checked : false,
    };
  }

  // ─── Overview stats ──────────────────────────────────────────────────────────
  function syncOverviewStats() {
    const statToolsEl = document.getElementById("settings-stat-tools");
    if (statToolsEl) {
      const toolCount = getSelectedTools().length;
      statToolsEl.textContent = toolCount === 1 ? "1 enabled" : `${toolCount} enabled`;
    }
  }

  // ─── Mark dirty on sub-agent canvas toggle change ────────────────────────────
  function initDirtyListeners() {
    [subAgentCanvasAutoSaveEl, subAgentCanvasAutoOpenEl].forEach((el) => {
      if (el) el.addEventListener("change", () => window.__settingsCore?.markDirty?.());
    });
  }

  initDirtyListeners();

  // ─── Export ──────────────────────────────────────────────────────────────────
  window.__settingsTools = {
    getSelectedSubAgentTools,
    applySelectedSubAgentTools,
    getSelectedTools,
    applySelectedTools,
    syncSubAgentCanvasSettings,
    readSubAgentCanvasPayload,
    syncOverviewStats,
  };
})();
