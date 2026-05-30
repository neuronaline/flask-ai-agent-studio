// Summary panel helpers — detail options, progress tracking, API requests.
// Dependencies: utils.js (toFiniteNumber, toNonNegativeIntOrNull),
//               state.js (summaryState, chatState, uiState),
//               constants.js (SUMMARY_* constants).

function setSummaryDetailLevel(value) {
  if (!summaryDetailSelect) {
    return;
  }
  summaryDetailSelect.value = value;
  updateSummaryDetailOptionsState();
}

function updateSummaryDetailOptionsState() {
  const selectedValue = String(summaryDetailSelect?.value || "balanced").trim() || "balanced";
  summaryDetailOptionGrid?.querySelectorAll("[data-summary-detail-value]").forEach((element) => {
    const isSelected = element.getAttribute("data-summary-detail-value") === selectedValue;
    element.classList.toggle("is-active", isSelected);
    element.setAttribute("aria-pressed", String(isSelected));
  });
}

function renderSummaryDetailOptions() {
  if (!summaryDetailOptionGrid) {
    return;
  }

  const fragment = document.createDocumentFragment();
  const selectFragment = document.createDocumentFragment();
  SUMMARY_DETAIL_OPTIONS.forEach((option) => {
    if (summaryDetailSelect) {
      const selectOption = document.createElement("option");
      selectOption.value = option.value;
      selectOption.textContent = option.label;
      selectFragment.append(selectOption);
    }

    const button = document.createElement("button");
    button.type = "button";
    button.className = "summary-option";
    button.dataset.summaryDetailValue = option.value;
    button.setAttribute("aria-pressed", "false");

    const label = document.createElement("span");
    label.className = "summary-option__label";
    label.textContent = option.label;

    const description = document.createElement("span");
    description.className = "summary-option__description";
    description.textContent = option.description;

    button.append(label, description);
    button.addEventListener("click", () => setSummaryDetailLevel(option.value));
    fragment.append(button);
  });

  summaryDetailSelect?.replaceChildren(selectFragment);
  if (summaryDetailSelect) {
    const preferredValue = String(appSettings.chat_summary_detail_level || "balanced").trim() || "balanced";
    summaryDetailSelect.value = preferredValue;
  }
  summaryDetailOptionGrid.replaceChildren(fragment);
  updateSummaryDetailOptionsState();
}

function syncSummaryToggleButton() {
  summaryToggleBtn?.setAttribute("aria-expanded", String(isSummaryPanelOpen()));
}

function clearSummaryProgressTimer() {
  if (!summaryState.summaryProgressTimer) {
    return;
  }
  window.clearInterval(summaryState.summaryProgressTimer);
  summaryState.summaryProgressTimer = 0;
}

function setSummaryProgressState(value, label, { visible = true } = {}) {
  const normalizedValue = Math.max(0, Math.min(100, Number(value) || 0));
  summaryState.summaryProgressCurrentValue = normalizedValue;
  if (summaryProgress) {
    summaryProgress.hidden = !visible;
  }
  if (summaryProgressLabel) {
    summaryProgressLabel.textContent = String(label || "Preparing summary…").trim() || "Preparing summary…";
  }
  if (summaryProgressValue) {
    summaryProgressValue.textContent = `${Math.round(normalizedValue)}%`;
  }
  if (summaryProgressBar) {
    summaryProgressBar.style.width = `${normalizedValue}%`;
  }
  if (summaryProgressTrack) {
    summaryProgressTrack.setAttribute("aria-valuenow", String(Math.round(normalizedValue)));
  }
}

function resetSummaryProgress({ hide = true } = {}) {
  clearSummaryProgressTimer();
  setSummaryProgressState(0, "Preparing summary…", { visible: !hide });
  if (hide && summaryProgress) {
    summaryProgress.hidden = true;
  }
}

function startSummaryProgress(label = "Selecting messages…") {
  clearSummaryProgressTimer();
  setSummaryProgressState(8, label, { visible: true });
  summaryState.summaryProgressTimer = window.setInterval(() => {
    const nextValue = summaryState.summaryProgressCurrentValue < 42
      ? summaryState.summaryProgressCurrentValue + 7
      : summaryState.summaryProgressCurrentValue < 72
        ? summaryState.summaryProgressCurrentValue + 4
        : summaryState.summaryProgressCurrentValue + 2;
    const clampedValue = Math.min(nextValue, 86);
    const nextLabel = clampedValue < 28
      ? "Selecting messages…"
      : clampedValue < 70
        ? "Generating summary…"
        : "Applying summary…";
    setSummaryProgressState(clampedValue, nextLabel, { visible: true });
    if (clampedValue >= 86) {
      clearSummaryProgressTimer();
    }
  }, 220);
}

function finishSummaryProgress(label = "Summary completed.") {
  clearSummaryProgressTimer();
  setSummaryProgressState(100, label, { visible: true });
  window.setTimeout(() => {
    if (!summaryState.isSummaryOperationInFlight) {
      resetSummaryProgress({ hide: true });
    }
  }, 900);
}

function failSummaryProgress(label = "Summary failed.") {
  clearSummaryProgressTimer();
  const fallbackValue = summaryState.summaryProgressCurrentValue > 0 ? summaryState.summaryProgressCurrentValue : 18;
  setSummaryProgressState(fallbackValue, label, { visible: true });
}

function setSummaryBusyState(isBusy) {
  summaryState.isSummaryOperationInFlight = Boolean(isBusy);
  if (summarySubmitBtn) {
    summarySubmitBtn.disabled = summaryState.isSummaryOperationInFlight;
  }
  if (summaryFocusInput) {
    summaryFocusInput.disabled = summaryState.isSummaryOperationInFlight;
  }
  if (summaryDetailSelect) {
    summaryDetailSelect.disabled = summaryState.isSummaryOperationInFlight;
  }
  summaryDetailOptionGrid?.querySelectorAll("[data-summary-detail-value]").forEach((button) => {
    button.disabled = summaryState.isSummaryOperationInFlight;
  });
}

function buildSummaryRequestBody() {
  return {
    force: true,
    summary_focus: String(summaryFocusInput?.value || "").trim(),
    summary_detail_level: String(summaryDetailSelect?.value || "balanced").trim(),
  };
}

function resetSummaryPreview() {
  summaryState.summaryPreviewConversationId = null;
}

async function refreshSummarySettingsFromServer() {
  try {
    const response = await fetch("/api/settings");
    if (!response.ok) {
      return;
    }
    const data = await response.json().catch(() => null);
    if (!data || typeof data !== "object") {
      return;
    }
    Object.assign(appSettings, {
      chat_summary_mode: data.chat_summary_mode,
      chat_summary_detail_level: data.chat_summary_detail_level,
      chat_summary_trigger_token_count: data.chat_summary_trigger_token_count,
      summary_skip_first: data.summary_skip_first,
      summary_skip_last: data.summary_skip_last,
      prompt_preflight_summary_token_count: data.prompt_preflight_summary_token_count,
      summary_source_target_tokens: data.summary_source_target_tokens,
      summary_retry_min_source_tokens: data.summary_retry_min_source_tokens,
    });
    setSummaryDetailLevel(String(appSettings.chat_summary_detail_level || "balanced").trim() || "balanced");
  } catch (_) {
    // Ignore settings refresh failures and keep the bootstrapped values.
  }
}

function applySummaryFocusPreset(preset) {
  if (!summaryFocusInput || !preset) {
    return;
  }
  summaryFocusInput.value = preset.text;
  autoResize(summaryFocusInput);
  summaryFocusInput.focus({ preventScroll: true });
}

function renderSummaryFocusPresets() {
  if (!summaryFocusPresetGrid) {
    return;
  }

  const fragment = document.createDocumentFragment();
  SUMMARY_FOCUS_PRESETS.forEach((preset) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "summary-preset";
    button.textContent = preset.label;
    button.title = preset.text;
    button.addEventListener("click", () => applySummaryFocusPreset(preset));
    fragment.append(button);
  });

  summaryFocusPresetGrid.replaceChildren(fragment);
}

function applyConversationToolOverridesState(data) {
  chatState.currentConversationToolOverrides = Array.isArray(data?.conversation?.tool_overrides) ? data.conversation.tool_overrides : null;
}

function getConversationMemorySignature(entries = []) {
  return (Array.isArray(entries) ? entries : [])
    .map((entry) => `${entry.id}:${entry.entry_type}:${entry.key}:${entry.value}`)
    .join("\u0001");
}

function applyConversationMemoryState(data) {
  chatState.conversationMemoryEntries = Array.isArray(data?.memory) ? data.memory : [];
  uiState.lastConversationMemorySignature = getConversationMemorySignature(chatState.conversationMemoryEntries);
}

function applyConversationParameterOverridesState(data) {
  chatState.currentConversationParameterOverrides = data?.conversation?.parameter_overrides || null;
}

/* ------------------------------------------------------------------ */
/*  Summary helpers (extracted from app.js)                             */
/* ------------------------------------------------------------------ */

function shouldGenerateConversationTitle() {
  const visibleEntries = getVisibleHistoryEntries();
  return Boolean(
    chatState.currentConvId &&
    visibleEntries.length === 2 &&
    visibleEntries[0]?.role === "user" &&
    visibleEntries[1]?.role === "assistant" &&
    !getPendingClarification(visibleEntries[1]?.metadata),
  );
}

function getSummarySkipLastValue() {
  const rawValue = Number.parseInt(String(appSettings.summary_skip_last || "0"), 10);
  return Number.isFinite(rawValue) ? Math.max(0, rawValue) : 0;
}

function getSummaryTriggerValue() {
  const rawValue = parseInt(appSettings.chat_summary_trigger_token_count || 80000, 10);
  return Number.isFinite(rawValue) ? rawValue : 80000;
}

function getEffectiveSummaryTriggerValue() {
  const baseTrigger = getSummaryTriggerValue();
  const mode = getSummaryModeValue();
  if (mode === "aggressive") {
    return Math.max(1000, Math.floor(baseTrigger / 2));
  }
  if (mode === "conservative") {
    return Math.min(200000, Math.max(1000, Math.ceil(baseTrigger * 1.5)));
  }
  return baseTrigger;
}

function estimateSummaryTriggerTokens(entries = chatState.history) {
  return (entries || []).reduce((total, entry) => {
    const role = String(entry?.role || "").trim();
    if (!role) {
      return total;
    }
    const metadata = entry?.metadata && typeof entry.metadata === "object" ? entry.metadata : null;
    if (role === "assistant" && Array.isArray(entry?.tool_calls) && entry.tool_calls.length > 0) {
      return total;
    }
    if (!["user", "assistant", "tool", "summary"].includes(role)) {
      return total;
    }
    return total + estimateLocalTokens(entry.content);
  }, 0);
}

function formatSummaryTimestamp(value) {
  const timestamp = String(value || "").trim();
  if (!timestamp) {
    return "—";
  }
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return timestamp;
  }
  return date.toLocaleString();
}

function describeSummaryFailure(status) {
  const reason = String(status?.reason || "").trim();
  const stage = String(status?.failure_stage || "").trim();
  const detail = String(status?.failure_detail || "").trim();

  if (reason === "mode_never") {
    return "Auto summary is disabled by settings.";
  }
  if (reason === "below_threshold") {
    const tokenGap = Number(status?.token_gap || 0);
    return tokenGap > 0
      ? `Below threshold by ${fmt(tokenGap)} counted tokens.`
      : "Still below the summary trigger threshold.";
  }
  if (reason === "no_source_messages") {
    return "There are no older unsummarized user or assistant messages left to compress.";
  }
  if (reason === "no_prompt_messages") {
    return "Candidate messages existed, but all of them were empty or invalid after prompt sanitization.";
  }
  if (reason === "locked") {
    return "Another summary pass was already running, so this turn skipped a duplicate summary attempt.";
  }
  if (reason !== "summary_generation_failed") {
    return detail || "Waiting for the next completed assistant turn to evaluate summary conditions.";
  }

  if (stage === "context_too_large") {
    return "The provider rejected the summary request because the summary prompt itself exceeded the model context limit.";
  }
  if (stage === "invalid_message_sequence") {
    return "The provider rejected the summary prompt because the message sequence was invalid.";
  }
  if (stage === "tool_call_unexpected") {
    return "The model attempted a tool-style response during summary generation, so the result was rejected for safety.";
  }
  if (stage === "empty_output") {
    return "The provider returned no assistant summary content.";
  }
  if (stage === "too_short") {
    return "The provider returned a summary that was too short to keep as reliable compressed context.";
  }
  if (stage === "provider_error") {
    return "The provider returned an error while generating the summary.";
  }
  return detail || "The summary attempt failed validation, so no messages were compressed.";
}

/* ------------------------------------------------------------------ */
/*  undoConversationSummary — extracted from app.js                    */
/* ------------------------------------------------------------------ */

async function undoConversationSummary(summaryId, { triggerButton = null } = {}) {
  const normalizedSummaryId = Number(summaryId || 0);
  if (!chatState.currentConvId || !normalizedSummaryId) {
    showToast("No summary is available to undo.", "warning");
    return;
  }

  const originalButtonText = triggerButton ? triggerButton.textContent : "";
  setSummaryBusyState(true);
  startSummaryProgress("Restoring summary…");
  if (triggerButton) {
    triggerButton.disabled = true;
    triggerButton.textContent = "Restoring…";
  }

  try {
    const response = await fetch(`/api/conversations/${chatState.currentConvId}/summaries/${normalizedSummaryId}/undo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Failed to undo summary.");
    }

    if (Array.isArray(data.messages)) {
      chatState.history = data.messages.map(normalizeHistoryEntry);
      rebuildTokenStatsFromHistory();
      renderConversationHistory();
    }
    resetSummaryPreview();

    summaryState.latestSummaryStatus = {
      applied: false,
      reason: "summary_undone",
      failure_stage: null,
      failure_detail: "The selected summary was reverted and the covered messages were restored.",
    };
    const restoredCount = Number(data.restored_message_count || 0);
    finishSummaryProgress(
      restoredCount > 0
        ? `${restoredCount} message${restoredCount === 1 ? " was" : "s were"} restored.`
        : "Summary was undone."
    );
    showToast(
      restoredCount > 0
        ? `${restoredCount} message${restoredCount === 1 ? " was" : "s were"} restored.`
        : "Summary was undone.",
      "success"
    );
  } catch (error) {
    failSummaryProgress(error.message || "Failed to undo summary.");
    showToast(error.message || "Failed to undo summary.", "error");
  } finally {
    setSummaryBusyState(false);
    if (triggerButton) {
      triggerButton.textContent = originalButtonText || "Undo";
    }
  }
}
