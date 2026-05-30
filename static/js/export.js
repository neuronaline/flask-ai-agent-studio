function setExportStatus(message, tone = "muted") {
  if (!exportStatus) {
    return;
  }
  exportStatus.textContent = String(message || "").trim() || "Export idle";
  exportStatus.dataset.tone = tone;
}

function updateExportPanel() {
  if (!exportSubtitle) {
    return;
  }
  exportSubtitle.textContent = chatState.currentConvId
    ? `Current conversation: ${getCurrentConversationDisplayTitle() || `Chat #${chatState.currentConvId}`}`
    : "Open or create a conversation before exporting.";
}

function openExportPanel(triggerEl = null) {
  closeMobileTools();
  closeStats();
  closeCanvas();
  closeSummaryPanel();

  updateExportPanel();
  exportPanel?.classList.add("open");
  exportOverlay?.classList.add("open");
  exportPanel?.setAttribute("aria-hidden", "false");
  lastExportTriggerEl = triggerEl instanceof HTMLElement
    ? triggerEl
    : (document.activeElement instanceof HTMLElement ? document.activeElement : mobileToolsBtn);
  exportClose?.focus();
}

function closeExportPanel() {
  exportPanel?.classList.remove("open");
  exportOverlay?.classList.remove("open");
  exportPanel?.setAttribute("aria-hidden", "true");
  if (lastExportTriggerEl && typeof lastExportTriggerEl.focus === "function") {
    lastExportTriggerEl.focus();
  }
}

function renderHistorySelectionBar() {
  syncChatSelectionClasses();
  if (!historySelectionBar || !historySelectionLabel || !historySelectionDetail) {
    return;
  }

  if (!uiState.messageSelectionMode || !chatState.currentConvId) {
    historySelectionBar.hidden = true;
    return;
  }

  const selectedCount = getSelectedMessageIds(uiState.messageSelectionMode).length;
  const modeLabel = "Summary selection";
  historySelectionLabel.textContent = selectedCount ? `${modeLabel} · ${fmt(selectedCount)}` : modeLabel;
  historySelectionDetail.textContent = selectedCount
    ? `${fmt(selectedCount)} message${selectedCount === 1 ? " is" : "s are"} selected for summary. Use the tick next to each message or click the message bubble to adjust the selection. Clear it to return to automatic rules.`
    : "Tick eligible messages in the conversation or click a message bubble to build a custom summary selection. Leaving it empty falls back to automatic rules.";

  if (historySelectionClear) {
    historySelectionClear.disabled = selectedCount === 0;
  }
  historySelectionBar.hidden = false;
}

function syncMessageSelectionMode({ render = false } = {}) {
  const nextMode = isSummaryPanelOpen() ? "summary" : null;
  const changed = nextMode !== uiState.messageSelectionMode;
  uiState.messageSelectionMode = nextMode;
  renderHistorySelectionBar();
  if (render && changed) {
    renderConversationHistory({ preserveScroll: true });
  }
}

function clearMessageSelection(mode = uiState.messageSelectionMode, { render = true } = {}) {
  if (!mode) {
    uiState.selectedSummaryMessageIds = new Set();
  } else {
    replaceSelectionSet(mode, []);
  }
  renderHistorySelectionBar();
  if (render) {
    renderConversationHistory({ preserveScroll: true });
  }
}

function toggleHistoryMessageSelection(messageId, mode = uiState.messageSelectionMode) {
  const normalizedMessageId = Number(messageId);
  if (!Number.isInteger(normalizedMessageId) || normalizedMessageId <= 0 || !mode) {
    return;
  }
  const targetMessage = getHistoryMessage(normalizedMessageId);
  if (!isMessageSelectableForMode(targetMessage, mode)) {
    return;
  }
  const nextSelection = new Set(getSelectionSetForMode(mode) || []);
  if (nextSelection.has(normalizedMessageId)) {
    nextSelection.delete(normalizedMessageId);
  } else {
    nextSelection.add(normalizedMessageId);
  }
  replaceSelectionSet(mode, nextSelection);
  renderHistorySelectionBar();
  renderConversationHistory({ preserveScroll: true });
}

function getSelectedMessageIds(mode = uiState.messageSelectionMode) {
  const selectedIds = Array.from(getSelectionSetForMode(mode) || []);
  return selectedIds
    .filter((messageId) => Number.isInteger(Number(messageId)) && Number(messageId) > 0)
    .sort((left, right) => {
      const leftMessage = getHistoryMessage(left);
      const rightMessage = getHistoryMessage(right);
      const positionDelta = getHistoryMessageSortValue(leftMessage) - getHistoryMessageSortValue(rightMessage);
      if (positionDelta !== 0) {
        return positionDelta;
      }
      return Number(left) - Number(right);
    });
}

function isSummaryPanelOpen() {
  return Boolean(summaryPanel?.classList.contains("open"));
}

function openSummaryPanel(triggerEl = null) {
  closeMobileTools();
  closeStats();
  closeCanvas();
  closeExportPanel();

  summaryPanel?.classList.add("open");
  summaryOverlay?.classList.add("open");
  summaryPanel?.setAttribute("aria-hidden", "false");
  syncSummaryToggleButton();
  lastSummaryTriggerEl = triggerEl instanceof HTMLElement
    ? triggerEl
    : (document.activeElement instanceof HTMLElement ? document.activeElement : mobileSummaryBtn);
  if (!summaryState.isSummaryOperationInFlight) {
    resetSummaryProgress({ hide: true });
  }
  if (summaryState.summaryPreviewConversationId !== chatState.currentConvId) {
    resetSummaryPreview();
  }
  setSummaryBusyState(summaryState.isSummaryOperationInFlight);
  syncMessageSelectionMode({ render: true });
  void refreshSummarySettingsFromServer();
  if (summaryFocusInput) {
    window.setTimeout(() => summaryFocusInput.focus({ preventScroll: true }), 0);
  }
}

function closeSummaryPanel({ restoreFocus = true } = {}) {
  summaryPanel?.classList.remove("open");
  summaryOverlay?.classList.remove("open");
  summaryPanel?.setAttribute("aria-hidden", "true");
  syncSummaryToggleButton();
  syncMessageSelectionMode({ render: true });
  if (restoreFocus && lastSummaryTriggerEl && typeof lastSummaryTriggerEl.focus === "function") {
    lastSummaryTriggerEl.focus();
  }
}

async function runConversationSummary({ triggerButton = null, closePanel = false } = {}) {
  if (!chatState.currentConvId) {
    showToast("No active conversation to summarize.", "warning");
    return;
  }

  const originalButtonText = triggerButton ? triggerButton.textContent : "";
  const requestBody = buildSummaryRequestBody();

  setSummaryBusyState(true);
  startSummaryProgress("Selecting messages…");
  if (triggerButton) {
    triggerButton.disabled = true;
    triggerButton.textContent = "Summarizing…";
  }

  try {
    const response = await fetch(`/api/conversations/${chatState.currentConvId}/summarize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Failed to summarize.");
    }
    if (data.applied) {
      if (Array.isArray(data.messages)) {
        chatState.history = data.messages.map(normalizeHistoryEntry);
        rebuildTokenStatsFromHistory();
        renderConversationHistory();
      }
      resetSummaryPreview();
      const coveredCount = Number(data.covered_message_count || 0);
      finishSummaryProgress(
        coveredCount > 0
          ? `${coveredCount} message${coveredCount === 1 ? " was" : "s were"} summarized.`
          : "Summary completed."
      );
      showToast(
        coveredCount > 0
          ? `${coveredCount} message${coveredCount === 1 ? " was" : "s were"} summarized.`
          : "Summary completed.",
        "success"
      );
      summaryState.latestSummaryStatus = { applied: true, reason: "applied", failure_stage: null, failure_detail: "Manual summary completed." };
    } else {
      failSummaryProgress(data.failure_detail || data.reason || "Summary was not applied.");
      showToast(data.failure_detail || data.reason || "Summary was not applied.", "warning");
      summaryState.latestSummaryStatus = { applied: false, reason: data.reason, failure_detail: data.failure_detail };
    }
  } catch (error) {
    failSummaryProgress(error.message || "Failed to summarize.");
    showToast(error.message, "error");
  } finally {
    setSummaryBusyState(false);
    if (triggerButton) {
      triggerButton.disabled = false;
      triggerButton.textContent = originalButtonText || (closePanel ? "Summarize Conversation" : "Summarize now");
      if (closePanel && typeof triggerButton.focus === "function") {
        triggerButton.focus();
      }
    }
  }
}

async function downloadConversation(format) {
  if (!chatState.currentConvId) {
    setExportStatus("Conversation is not available yet.", "warning");
    return;
  }

  setExportStatus(`Preparing ${format.toUpperCase()} export…`, "muted");
  try {
    const reasoningByMessageId = collectConversationReasoningExportMap();
    const response = await fetch(`/api/conversations/${chatState.currentConvId}/export?format=${encodeURIComponent(format)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reasoning_by_message_id: reasoningByMessageId }),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || "Conversation export failed.");
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = getSuggestedDownloadFilename(response, `${chatState.currentConvTitle || "conversation"}.${format}`);
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    setExportStatus(`${format.toUpperCase()} download is ready.`, "success");
  } catch (error) {
    setExportStatus(error.message || "Conversation export failed.", "danger");
  }
}

function getSuggestedDownloadFilename(response, fallbackFilename) {
  const contentDisposition = response.headers.get("content-disposition") || "";
  const utf8Match = contentDisposition.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
  const plainMatch = contentDisposition.match(/filename\s*=\s*"([^"]+)"/i) || contentDisposition.match(/filename\s*=\s*([^;]+)/i);
  const rawFilename = (utf8Match && utf8Match[1]) || (plainMatch && plainMatch[1]) || "";
  if (!rawFilename) {
    return fallbackFilename;
  }

  try {
    return decodeURIComponent(rawFilename);
  } catch (_) {
    return rawFilename;
  }
}

function collectConversationReasoningExportMap(entries = chatState.history, conversationId = chatState.currentConvId) {
  const reasoningByMessageId = {};
  getVisibleHistoryEntries(entries).forEach((message) => {
    if (!message || message.role !== "assistant" || !isPersistedMessageId(message.id)) {
      return;
    }

    const reasoningText = getReasoningText(message.metadata, message.id, conversationId);
    if (!reasoningText) {
      return;
    }

    reasoningByMessageId[String(message.id)] = reasoningText;
  });
  return reasoningByMessageId;
}

async function downloadCanvasDocument(format) {
  const canvasDocument = getActiveCanvasDocument();
  if (!canvasDocument || !chatState.currentConvId) {
    setCanvasStatus("Canvas document is not available yet.", "warning");
    return;
  }

  setCanvasStatus(`Preparing ${format.toUpperCase()} download…`, "muted");
  try {
    const response = await fetch(`/api/conversations/${chatState.currentConvId}/canvas/export?format=${encodeURIComponent(format)}&document_id=${encodeURIComponent(canvasDocument.id)}`, {
      cache: "no-store",
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || "Canvas export failed.");
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = getSuggestedDownloadFilename(response, `${canvasDocument.title}.${format}`);
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    setCanvasStatus(`${format.toUpperCase()} download is ready.`, "success");
  } catch (error) {
    setCanvasStatus(error.message || "Canvas export failed.", "danger");
  }
}
