// message/history.js — Server refresh, token stats, persistence

async function refreshConversationFromServer() {
  if (!chatState.currentConvId) {
    return false;
  }

  const response = await fetch(`/api/conversations/${chatState.currentConvId}`);
  if (!response.ok) {
    return false;
  }

  const data = await response.json().catch(() => null);
  if (!data || Number(data.conversation?.id) !== Number(chatState.currentConvId)) {
    return false;
  }

  const serverHistory = Array.isArray(data.messages) ? data.messages.map(normalizeHistoryEntry) : [];
  const serverSignature = getConversationSignature(serverHistory);
  const serverMemorySignature = getConversationMemorySignature(data.memory || []);
  const messagesChanged = serverSignature !== uiState.lastConversationSignature;
  const memoryChanged = serverMemorySignature !== uiState.lastConversationMemorySignature;

  if (!messagesChanged && !memoryChanged) {
    return false;
  }

  if (messagesChanged) {
    chatState.history = serverHistory;
    chatState.currentConvTitle = String(data.conversation?.title || chatState.currentConvTitle || "New Chat").trim() || "New Chat";
    chatState.currentConversationTitleSource = String(data.conversation?.title_source || chatState.currentConversationTitleSource || "system").trim().toLowerCase() || "system";
    chatState.currentConversationTitleOverridden = data.conversation?.title_overridden === true || Number(data.conversation?.title_overridden || 0) === 1;
    chatState.currentConversationPersonaName = resolveConversationPersonaName(data.conversation?.persona_id, data.conversation?.persona?.name || "");
    summaryState.latestSummaryStatus = null;
    clearPendingDeleteMessage({ render: false });
    canvasState.streamingCanvasDocuments = [];
    resetStreamingCanvasPreview();
    canvasState.activeCanvasDocumentId = getActiveCanvasDocument(chatState.history)?.id || null;
    uiState.lastConversationSignature = serverSignature;
    renderConversationHistory({ preserveScroll: true });
    renderCanvasPanel();
    updateExportPanel();
    rebuildTokenStatsFromHistory();
  }

  if (memoryChanged) {
    applyConversationMemoryState(data);
  }

  applyConversationToolOverridesState(data);

  loadSidebar();
  return true;
}

function scheduleConversationRefreshAfterStream() {
  if (!chatState.currentConvId) {
    return;
  }

  const refreshGeneration = ++uiState.conversationRefreshGeneration;
  uiState.pendingConversationRefreshTimers.forEach((timerId) => window.clearTimeout(timerId));
  uiState.pendingConversationRefreshTimers.clear();

  [800, 2000, 5000, 10000].forEach((delay) => {
    const timerId = window.setTimeout(async () => {
      uiState.pendingConversationRefreshTimers.delete(timerId);
      if (refreshGeneration !== uiState.conversationRefreshGeneration || !chatState.currentConvId || chatState.isStreaming || chatState.isFixing) {
        return;
      }

      try {
        const refreshed = await refreshConversationFromServer();
        if (refreshed) {
          uiState.pendingConversationRefreshTimers.forEach((pendingTimerId) => window.clearTimeout(pendingTimerId));
          uiState.pendingConversationRefreshTimers.clear();
        }
      } catch (_) {
      }
    }, delay);
    uiState.pendingConversationRefreshTimers.add(timerId);
  });
}

function cancelPendingConversationRefreshes() {
  uiState.conversationRefreshGeneration += 1;
  uiState.pendingConversationRefreshTimers.forEach((timerId) => window.clearTimeout(timerId));
  uiState.pendingConversationRefreshTimers.clear();
}

function rebuildTokenStatsFromHistory() {
  resetTokenStats();
  chatState.history.forEach((message) => {
    if (message.role === "assistant" && message.usage) {
      updateStats(message.usage);
    }
  });
}

function updateStats(usage, { replaceLast = false } = {}) {
  const normalizedUsage = normalizeUsagePayload(usage);
  if (replaceLast && tokenTurns.length) {
    tokenTurns[tokenTurns.length - 1] = normalizedUsage;
  } else {
    tokenTurns.push(normalizedUsage);
  }
  renderTokenStats();
}

function estimateLocalTokens(text) {
  const normalized = String(text || "").trim();
  if (!normalized) {
    return 0;
  }

  const words = normalized.split(/\s+/).filter(Boolean).length;
  const charEstimate = normalized.length / 4;
  const wordEstimate = words * 1.35;
  return Math.max(1, Math.round(Math.max(charEstimate, wordEstimate)));
}

function getSummaryModeValue() {
  return String(appSettings.chat_summary_mode || "auto").trim() || "auto";
}

function resetTokenStats() {
  tokenTurns.length = 0;
  renderTokenStats();
}

function startNewChat() {
  clearPendingDeleteMessage({ render: false });
  resetTokenStats();
  uiState.conversationRefreshGeneration += 1;
  uiState.pendingConversationRefreshTimers.forEach((timerId) => window.clearTimeout(timerId));
  uiState.pendingConversationRefreshTimers.clear();
  uiState.userScrolledUp = false;
  chatState.currentConvId = null;
  chatState.currentConvTitle = "New Chat";
  chatState.currentConversationPersonaId = "";
  chatState.currentConversationPersonaName = "";
  chatState.currentConversationTitleSource = "system";
  chatState.currentConversationTitleOverridden = false;
  chatState.history = [];
  chatState.conversationMemoryEntries = [];
  chatState.conversationMemoryEnabled = featureFlags.conversation_memory_enabled !== false;
  chatState.currentConversationToolOverrides = null;
  chatState.currentConversationParameterOverrides = null;
  summaryState.latestSummaryStatus = null;
  uiState.selectedSummaryMessageIds = new Set();
  canvasState.streamingCanvasDocuments = [];
  resetStreamingCanvasPreview();
  canvasState.activeCanvasDocumentId = null;
  uiState.lastConversationSignature = "";
  uiState.lastConversationMemorySignature = "";
  clearEditTarget();
  clearInlineEditingTarget();
  resetCanvasWorkspaceState();
  clearSelectedImage();
  renderConversationHistory();
  renderCanvasPanel();
  updateExportPanel();
  const preferredModelId = resolvePreferredModelSelection(modelSel ? modelSel.value : "");
  if (preferredModelId) {
    syncModelSelectors(preferredModelId, getKnownModelLabel(preferredModelId));
  }
  syncPersonaSelectors(chatState.currentConversationPersonaId);
  clearToastRegion();
  loadSidebar();
  inputEl.focus();
  closeSidebarOnMobile();
}
