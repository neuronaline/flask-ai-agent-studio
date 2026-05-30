// Settings context — context strategy, entropy settings
(function () {
  "use strict";

  // ─── DOM refs ────────────────────────────────────────────────────────────────
  const contextCompactionThresholdEl = document.getElementById("context-compaction-threshold-input");
  const contextCompactionKeepRecentRoundsEl = document.getElementById("context-compaction-keep-recent-rounds-input");
  const contextSelectionStrategyEl = document.getElementById("context-selection-strategy-select");
  const entropyControlsFieldsetEl = document.getElementById("entropy-controls-fieldset");
  const entropyRagBudgetClusterEl = document.getElementById("entropy-rag-budget-cluster");
  const entropyProfileEl = document.getElementById("entropy-profile-select");
  const entropyRagBudgetRatioEl = document.getElementById("entropy-rag-budget-ratio-input");
  const entropyProtectCodeBlocksEl = document.getElementById("entropy-protect-code-blocks-toggle");
  const entropyProtectToolResultsEl = document.getElementById("entropy-protect-tool-results-toggle");
  const entropyReferenceBoostEl = document.getElementById("entropy-reference-boost-toggle");

  // ─── Conditional section helper ─────────────────────────────────────────────
  function applyConditionalSectionState(element, { disabled = false, hidden = null } = {}) {
    if (!element) return;
    if ("disabled" in element) element.disabled = disabled;
    element.classList.toggle("is-disabled", disabled);
    element.setAttribute("aria-disabled", disabled ? "true" : "false");
    if (typeof hidden === "boolean") {
      element.hidden = hidden;
      element.setAttribute("aria-hidden", hidden ? "true" : "false");
    }
  }

  // ─── Context strategy sync ───────────────────────────────────────────────────
  function syncContextStrategyAvailability() {
    const strategy = contextSelectionStrategyEl?.value || "classic";
    const entropyEnabled = strategy === "entropy" || strategy === "entropy_rag_hybrid";
    const hybridEnabled = strategy === "entropy_rag_hybrid";

    applyConditionalSectionState(entropyControlsFieldsetEl, { disabled: !entropyEnabled, hidden: !entropyEnabled });
    if (entropyRagBudgetRatioEl) entropyRagBudgetRatioEl.disabled = !hybridEnabled;
    applyConditionalSectionState(entropyRagBudgetClusterEl, { disabled: !hybridEnabled, hidden: !hybridEnabled });
  }

  // ─── Context settings apply ───────────────────────────────────────────────────
  function syncContextSettingsToForm(appSettings) {
    if (contextCompactionThresholdEl) contextCompactionThresholdEl.value = String(appSettings.context_compaction_threshold ?? 0.85);
    if (contextCompactionKeepRecentRoundsEl) contextCompactionKeepRecentRoundsEl.value = String(appSettings.context_compaction_keep_recent_rounds ?? 2);
    if (contextSelectionStrategyEl) contextSelectionStrategyEl.value = appSettings.context_selection_strategy || "classic";
    if (entropyProfileEl) entropyProfileEl.value = appSettings.entropy_profile || "balanced";
    if (entropyRagBudgetRatioEl) entropyRagBudgetRatioEl.value = String(appSettings.entropy_rag_budget_ratio ?? 35);
    if (entropyProtectCodeBlocksEl) entropyProtectCodeBlocksEl.checked = Boolean(appSettings.entropy_protect_code_blocks ?? true);
    if (entropyProtectToolResultsEl) entropyProtectToolResultsEl.checked = Boolean(appSettings.entropy_protect_tool_results ?? true);
    if (entropyReferenceBoostEl) entropyReferenceBoostEl.checked = Boolean(appSettings.entropy_reference_boost ?? true);
  }

  // ─── Context payload helpers ──────────────────────────────────────────────────
  function readContextSettingsPayload() {
    return {
      context_compaction_threshold: window.__settingsCore.readFloatSetting(contextCompactionThresholdEl, 0.85, { min: 0.5, max: 0.98 }),
      context_compaction_keep_recent_rounds: window.__settingsCore.readNumericSetting(contextCompactionKeepRecentRoundsEl, 2, { min: 0, max: 6 }),
      context_selection_strategy: contextSelectionStrategyEl?.value || "classic",
      entropy_profile: entropyProfileEl?.value || "balanced",
      entropy_rag_budget_ratio: window.__settingsCore.readNumericSetting(entropyRagBudgetRatioEl, 35, { min: 0, max: 80 }),
      entropy_protect_code_blocks: Boolean(entropyProtectCodeBlocksEl?.checked),
      entropy_protect_tool_results: Boolean(entropyProtectToolResultsEl?.checked),
      entropy_reference_boost: Boolean(entropyReferenceBoostEl?.checked),
    };
  }

  // ─── Export ──────────────────────────────────────────────────────────────────
  window.__settingsContext = {
    syncContextStrategyAvailability,
    syncContextSettingsToForm,
    readContextSettingsPayload,
  };
})();