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
