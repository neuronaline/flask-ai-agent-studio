// Settings context — context compaction settings
(function () {
  "use strict";

  // ─── DOM refs ────────────────────────────────────────────────────────────────
  const contextCompactionThresholdEl = document.getElementById("context-compaction-threshold-input");
  const contextCompactionKeepRecentRoundsEl = document.getElementById("context-compaction-keep-recent-rounds-input");

  // ─── Context settings apply ───────────────────────────────────────────────────
  function syncContextSettingsToForm(appSettings) {
    if (contextCompactionThresholdEl) contextCompactionThresholdEl.value = String(appSettings.context_compaction_threshold ?? 0.85);
    if (contextCompactionKeepRecentRoundsEl) contextCompactionKeepRecentRoundsEl.value = String(appSettings.context_compaction_keep_recent_rounds ?? 2);
  }

  // ─── Context payload helpers ──────────────────────────────────────────────────
  function readContextSettingsPayload() {
    return {
      context_compaction_threshold: window.__settingsCore.readFloatSetting(contextCompactionThresholdEl, 0.85, { min: 0.5, max: 0.98 }),
      context_compaction_keep_recent_rounds: window.__settingsCore.readNumericSetting(contextCompactionKeepRecentRoundsEl, 2, { min: 0, max: 6 }),
    };
  }

  // ─── Export ──────────────────────────────────────────────────────────────────
  window.__settingsContext = {
    syncContextSettingsToForm,
    readContextSettingsPayload,
  };
})();
