// message/selection.js — History sort, selection mode UI helpers

function getHistoryMessageSortValue(message) {
  const position = Number(message?.position || 0);
  if (Number.isFinite(position) && position > 0) {
    return position;
  }
  const messageId = Number(message?.id || 0);
  return Number.isFinite(messageId) ? messageId : 0;
}

function getSelectionSetForMode(mode = uiState.messageSelectionMode) {
  if (mode === "summary") {
    return uiState.selectedSummaryMessageIds;
  }
  return null;
}

function getSelectableMessagesForMode(mode, entries = chatState.history) {
  if (mode === "summary") {
    return getSummaryEligibleMessages(entries);
  }
  return [];
}

function getSelectableMessageIdSet(mode, entries = chatState.history) {
  return new Set(
    getSelectableMessagesForMode(mode, entries)
      .map((message) => Number(message?.id || 0))
      .filter((messageId) => Number.isInteger(messageId) && messageId > 0)
  );
}

function replaceSelectionSet(mode, messageIds) {
  const eligibleIds = getSelectableMessageIdSet(mode);
  const nextSet = new Set(
    Array.from(messageIds || [])
      .map((messageId) => Number(messageId))
      .filter((messageId) => Number.isInteger(messageId) && messageId > 0 && eligibleIds.has(messageId))
  );

  if (mode === "summary") {
    uiState.selectedSummaryMessageIds = nextSet;
  }
}

function isMessageSelectableForMode(message, mode = uiState.messageSelectionMode) {
  const messageId = Number(message?.id || 0);
  if (!Number.isInteger(messageId) || messageId <= 0) {
    return false;
  }
  return getSelectableMessageIdSet(mode).has(messageId);
}

function isMessageSelectedForMode(messageId, mode = uiState.messageSelectionMode) {
  const normalizedMessageId = Number(messageId);
  if (!Number.isInteger(normalizedMessageId) || normalizedMessageId <= 0) {
    return false;
  }
  return Boolean(getSelectionSetForMode(mode)?.has(normalizedMessageId));
}

function syncChatSelectionClasses() {
  const hasSelectionMode = Boolean(uiState.messageSelectionMode);
  chatAreaEl?.classList.toggle("chat-area--selection-mode", hasSelectionMode);
  messagesEl?.classList.toggle("messages--selection-mode", hasSelectionMode);
  if (chatAreaEl) {
    if (hasSelectionMode) {
      chatAreaEl.dataset.selectionMode = uiState.messageSelectionMode;
    } else {
      delete chatAreaEl.dataset.selectionMode;
    }
  }
}

function getHistoryMessageIndex(messageId) {
  const normalizedId = Number(messageId);
  if (!Number.isInteger(normalizedId) || normalizedId <= 0) {
    return -1;
  }
  return chatState.history.findIndex((item) => Number(item.id) === normalizedId);
}

function isPersistedMessageId(messageId) {
  const normalizedId = Number(messageId);
  return Number.isInteger(normalizedId) && normalizedId > 0;
}

function getHistoryMessage(messageId) {
  const index = getHistoryMessageIndex(messageId);
  return index >= 0 ? chatState.history[index] : null;
}

function getPreviousUserMessage(messageId) {
  const index = getHistoryMessageIndex(messageId);
  if (index < 0) {
    return null;
  }

  for (let candidateIndex = index - 1; candidateIndex >= 0; candidateIndex -= 1) {
    const candidate = chatState.history[candidateIndex];
    if (candidate && candidate.role === "user") {
      return candidate;
    }
  }

  return null;
}

function hasLiveHistoryTextSelection() {
  if (typeof window === "undefined" || typeof window.getSelection !== "function") {
    return false;
  }
  const selection = window.getSelection();
  return Boolean(selection && !selection.isCollapsed && String(selection.toString() || "").trim());
}

function isHistorySelectionInteractionTarget(target) {
  if (!(target instanceof Element)) {
    return false;
  }
  return Boolean(
    target.closest(
      "a, button, input, textarea, select, summary, details, label, .msg-actions, .message-inline-editor, .clarification-card, .tool-trace-panel, .sub-agent-trace-panel, .reasoning-panel"
    )
  );
}

function bindHistorySelectionClickTarget(targetEl, messageId, mode) {
  const normalizedMessageId = Number(messageId);
  if (!(targetEl instanceof HTMLElement) || !mode || !Number.isInteger(normalizedMessageId) || normalizedMessageId <= 0) {
    return;
  }

  targetEl.dataset.selectionMode = mode;
  targetEl.addEventListener("click", (event) => {
    if (event.defaultPrevented) {
      return;
    }
    if (typeof event.button === "number" && event.button !== 0) {
      return;
    }
    if (isHistorySelectionInteractionTarget(event.target) || hasLiveHistoryTextSelection()) {
      return;
    }
    toggleHistoryMessageSelection(normalizedMessageId, mode);
  });
}

function createHistorySelectionToggle(message, mode) {
  const messageId = Number(message?.id || 0);
  if (!Number.isInteger(messageId) || messageId <= 0 || !mode) {
    return null;
  }

  const isSelected = isMessageSelectedForMode(messageId, mode);
  const selectionAction = isSelected ? "Remove message from summary selection" : "Add message to summary selection";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "msg-selection-toggle";
  button.dataset.selectionMode = mode;
  button.setAttribute("role", "checkbox");
  button.setAttribute("aria-checked", String(isSelected));
  button.setAttribute("aria-label", selectionAction);
  button.title = selectionAction;
  button.classList.toggle("is-selected", isSelected);

  const box = document.createElement("span");
  box.className = "msg-selection-toggle__box";
  box.setAttribute("aria-hidden", "true");

  const label = document.createElement("span");
  label.className = "msg-selection-toggle__label sr-only";
  label.textContent = selectionAction;

  button.append(box, label);
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    toggleHistoryMessageSelection(messageId, mode);
  });
  return button;
}
