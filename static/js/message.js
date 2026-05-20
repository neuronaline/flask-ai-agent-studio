/**
 * Message module — conversation history rendering, message actions, inline editing,
 * streaming helpers, history selection, and message group creation.
 * Depends on: state.js, render.js, tokens.js, summary.js, attachments.js, slash.js,
 *             step-ui.js, traces.js, clarification.js, utils.js (escHtml, copyTextToClipboard),
 *             preferences.js (resolveConversationPersonaName), DOM: messagesEl, editBanner, etc.
 */

/* ------------------------------------------------------------------ */
/*  History Sort / Selection Helpers                                   */
/* ------------------------------------------------------------------ */

function getHistoryMessageSortValue(message) {
  const position = Number(message?.position || 0);
  if (Number.isFinite(position) && position > 0) {
    return position;
  }
  const messageId = Number(message?.id || 0);
  return Number.isFinite(messageId) ? messageId : 0;
}

function sortHistoryMessagesByPosition(entries = []) {
  return [...(Array.isArray(entries) ? entries : [])].sort((left, right) => {
    const positionDelta = getHistoryMessageSortValue(left) - getHistoryMessageSortValue(right);
    if (positionDelta !== 0) {
      return positionDelta;
    }
    return Number(left?.id || 0) - Number(right?.id || 0);
  });
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

/* ------------------------------------------------------------------ */
/*  History Message Index / Lookup                                     */
/* ------------------------------------------------------------------ */

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

function isPrunableHistoryMessage(message) {
  if (!message || (message.role !== "user" && message.role !== "assistant")) {
    return false;
  }
  if (message.role === "assistant" && Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
    return false;
  }
  const metadata = message.metadata && typeof message.metadata === "object" ? message.metadata : null;
  if (metadata?.is_summary === true) {
    return false;
  }
  return String(message.content || "").trim().length > 0;
}

function isEditableHistoryMessage(message) {
  if (!message || !isPersistedMessageId(message.id)) {
    return false;
  }

  if (message.role !== "user" && message.role !== "assistant") {
    return false;
  }

  if (message.role === "assistant" && Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
    return false;
  }

  const metadata = message.metadata && typeof message.metadata === "object" ? message.metadata : null;
  return metadata?.is_summary !== true;
}

function isInlineEditingTarget(messageId) {
  return isPersistedMessageId(messageId)
    && isPersistedMessageId(inlineEditingMessageId)
    && Number(messageId) === Number(inlineEditingMessageId);
}

function clearInlineEditingTarget({ preserveDraft = false } = {}) {
  inlineEditingMessageId = null;
  if (!preserveDraft) {
    inlineEditingDraft = "";
  }
  savingEditedMessageId = null;
}

function autoResizeInlineEditor(textarea) {
  if (!(textarea instanceof HTMLTextAreaElement)) {
    return;
  }

  textarea.style.height = "auto";
  textarea.style.height = `${Math.min(textarea.scrollHeight, 360)}px`;
}

function focusInlineEditor(messageId) {
  if (!isPersistedMessageId(messageId)) {
    return;
  }

  window.requestAnimationFrame(() => {
    const editor = messagesEl.querySelector(
      `.msg-group[data-message-id="${String(messageId)}"] .message-inline-editor__input`
    );
    if (!(editor instanceof HTMLTextAreaElement)) {
      return;
    }

    autoResizeInlineEditor(editor);
    editor.focus();
    editor.setSelectionRange(editor.value.length, editor.value.length);
  });
}

function beginInlineEditingMessage(messageId) {
  if (chatState.isStreaming || chatState.isFixing) {
    return;
  }

  const message = getHistoryMessage(messageId);
  if (!isEditableHistoryMessage(message)) {
    return;
  }

  clearEditTarget();
  inlineEditingMessageId = Number(message.id);
  inlineEditingDraft = message.role === "user"
    ? buildComposerSlashCommandEditableText(message.content, message.metadata)
    : String(message.content || "");
  savingEditedMessageId = null;
  renderConversationHistory({ preserveScroll: true });
  focusInlineEditor(message.id);
}

function cancelInlineEditingMessage({ focusAction = false } = {}) {
  const previousMessageId = inlineEditingMessageId;
  clearInlineEditingTarget();
  renderConversationHistory({ preserveScroll: true });

  if (!focusAction || !isPersistedMessageId(previousMessageId)) {
    return;
  }

  window.requestAnimationFrame(() => {
    const editButton = messagesEl.querySelector(
      `.msg-group[data-message-id="${String(previousMessageId)}"] .msg-action-btn[data-action="edit-message"]`
    );
    if (editButton instanceof HTMLButtonElement) {
      editButton.focus();
    }
  });
}

/* ------------------------------------------------------------------ */
/*  Message Actions (Copy / Delete / Regenerate)                        */
/* ------------------------------------------------------------------ */

function createMessageActions(message, options = {}) {
  if (!message) {
    return null;
  }

  const actions = document.createElement("div");
  actions.className = "msg-actions msg-actions--footer";

  const messageId = message.id;
  const isDeletingThisMessage = messageId !== null && deletingMessageId !== null && Number(deletingMessageId) === Number(messageId);
  const isDeleteConfirmationOpen = messageId !== null && pendingDeleteMessageId !== null && Number(pendingDeleteMessageId) === Number(messageId);
  if (message.role === "user" || message.role === "assistant") {
    if (options.editable && isEditableHistoryMessage(message)) {
      const editBtn = createMessageActionButton({
        label: "Edit",
        title: "Edit message",
        icon: MESSAGE_ACTION_ICONS.edit,
        showLabel: true,
        onClick: () => beginInlineEditingMessage(messageId),
        disabled: !isPersistedMessageId(messageId) || Number(savingEditedMessageId) === Number(messageId) || isDeletingThisMessage,
      });
      actions.appendChild(editBtn);
    }

    const copyButton = createMessageActionButton({
      label: "Copy",
      title: message.role === "assistant" ? "Copy as Markdown" : "Copy message",
      icon: MESSAGE_ACTION_ICONS.copy,
      showLabel: true,
      onClick: () => {
        void (message.role === "assistant" ? copyAssistantMessageMarkdown(message) : copyUserMessageContent(message));
      },
      disabled: !String(message.content || "").trim() || isDeletingThisMessage,
    });
    actions.appendChild(copyButton);

    const deleteButton = createMessageActionButton({
      label: isDeleteConfirmationOpen ? "Cancel delete" : "Delete",
      title: isDeleteConfirmationOpen ? "Cancel delete" : "Delete message",
      icon: MESSAGE_ACTION_ICONS.delete,
      showLabel: true,
      onClick: () => {
        if (isDeleteConfirmationOpen) {
          clearPendingDeleteMessage({ preserveScroll: true });
          return;
        }
        openDeleteMessageConfirm(messageId);
      },
      disabled: !isPersistedMessageId(messageId) || isDeletingThisMessage || chatState.isStreaming || chatState.isFixing,
    });
    deleteButton.classList.add("msg-action-btn--danger");
    actions.appendChild(deleteButton);

    if (message.role === "assistant") {
      const regenerateButton = createMessageActionButton({
        label: "Regenerate",
        title: "Regenerate reply",
        icon: MESSAGE_ACTION_ICONS.regenerate,
        onClick: () => {
          void regenerateAssistantMessage(message.id);
        },
        disabled: !getPreviousUserMessage(message.id) || isDeletingThisMessage,
      });
      actions.appendChild(regenerateButton);
    }

    if (isDeleteConfirmationOpen) {
      const confirmBox = document.createElement("div");
      confirmBox.className = "msg-delete-confirm";

      const confirmText = document.createElement("span");
      confirmText.className = "msg-delete-confirm__text";
      confirmText.textContent = "Delete this message?";
      confirmBox.appendChild(confirmText);

      const confirmBtn = document.createElement("button");
      confirmBtn.type = "button";
      confirmBtn.className = "msg-action-btn msg-delete-confirm__btn msg-delete-confirm__btn--confirm";
      confirmBtn.textContent = isDeletingThisMessage ? "Deleting..." : "Delete";
      confirmBtn.disabled = isDeletingThisMessage;
      confirmBtn.addEventListener("click", () => {
        void deleteConversationMessage(messageId);
      });
      confirmBox.appendChild(confirmBtn);

      const cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.className = "msg-action-btn msg-delete-confirm__btn";
      cancelBtn.textContent = "Cancel";
      cancelBtn.addEventListener("click", () => {
        if (isDeletingThisMessage && activeDeleteMessageAbortController) {
          activeDeleteMessageAbortController.abort();
        }
        clearPendingDeleteMessage({ preserveScroll: true });
      });
      confirmBox.appendChild(cancelBtn);

      actions.appendChild(confirmBox);
    }
  }

  if (!actions.childElementCount) {
    return null;
  }
  return actions;
}

function createMessageActionButton({ label, title, icon, onClick, disabled = false, showLabel = false }) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "msg-action-btn msg-action-btn--icon";
  if (showLabel) {
    button.classList.add("msg-action-btn--with-label");
  }
  button.title = title;
  button.setAttribute("aria-label", label);
  button.innerHTML = showLabel
    ? `${icon}<span class="msg-action-btn__label">${escHtml(label)}</span>`
    : `${icon}<span class="sr-only">${escHtml(label)}</span>`;
  button.disabled = disabled;
  if (onClick) {
    button.addEventListener("click", onClick);
  }
  return button;
}

const MESSAGE_ACTION_ICONS = {
  copy: `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <rect x="9" y="9" width="10" height="10" rx="2" stroke="currentColor" stroke-width="1.8" />
      <path d="M7 15H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  `,
  edit: `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0 0-3l-1-1a2.1 2.1 0 0 0-3 0L4 16v4Z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
      <path d="m13 7 4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  `,
  regenerate: `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <path d="M3 12a9 9 0 0 1 15.3-6.4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
      <path d="M17 4h4v4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
      <path d="M21 12a9 9 0 0 1-15.3 6.4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
      <path d="M7 20H3v-4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  `,
  delete: `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <path d="M4 7h16" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
      <path d="M10 11v6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
      <path d="M14 11v6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
      <path d="M6 7l1 12a2 2 0 0 0 2 1.8h6a2 2 0 0 0 2-1.8L18 7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
      <path d="M9 7V5.8A1.8 1.8 0 0 1 10.8 4h2.4A1.8 1.8 0 0 1 15 5.8V7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  `,
};

function clearPendingDeleteMessage(options = {}) {
  const preserveScroll = options.preserveScroll !== false;
  if (activeDeleteMessageAbortController) {
    activeDeleteMessageAbortController.abort();
    activeDeleteMessageAbortController = null;
  }
  pendingDeleteMessageId = null;
  deletingMessageId = null;
  if (options.render !== false) {
    renderConversationHistory({ preserveScroll });
  }
}

function openDeleteMessageConfirm(messageId) {
  if (chatState.isStreaming || chatState.isFixing) {
    return;
  }
  pendingDeleteMessageId = Number(messageId);
  renderConversationHistory({ preserveScroll: true });
}

async function deleteConversationMessage(messageId) {
  const normalizedMessageId = Number(messageId);
  if (!isPersistedMessageId(normalizedMessageId) || !chatState.currentConvId) {
    showToast("Message could not be deleted.", "error");
    return;
  }

  deletingMessageId = normalizedMessageId;
  activeDeleteMessageAbortController = new AbortController();
  renderConversationHistory({ preserveScroll: true });

  try {
    const response = await fetch(`/api/messages/${normalizedMessageId}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      signal: activeDeleteMessageAbortController.signal,
      body: JSON.stringify({ conversation_id: chatState.currentConvId }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || "Message could not be deleted.");
    }

    if (Number(editingMessageId) === normalizedMessageId) {
      clearEditTarget();
    }
    if (Number(inlineEditingMessageId) === normalizedMessageId) {
      cancelInlineEditingMessage({ focusAction: false });
    }

    chatState.history = Array.isArray(payload.messages)
      ? payload.messages.map(normalizeHistoryEntry)
      : chatState.history.filter((item) => Number(item.id) !== normalizedMessageId);
    pendingDeleteMessageId = null;
    deletingMessageId = null;
    activeDeleteMessageAbortController = null;
    rebuildTokenStatsFromHistory();
    renderConversationHistory({ preserveScroll: true });
    renderCanvasPanel();
    refreshEditBanner();
    showToast("Message deleted.", "success");
  } catch (error) {
    deletingMessageId = null;
    pendingDeleteMessageId = null;
    activeDeleteMessageAbortController = null;
    renderConversationHistory({ preserveScroll: true });
    if (error.name !== "AbortError") {
      showError(error.message || "Message could not be deleted.");
    }
  }
}

async function copyMessageContent(content, messages) {
  const text = String(content || "");
  if (!text.trim()) {
    showToast(messages.empty, "warning");
    return false;
  }

  try {
    const copied = await copyTextToClipboard(text);
    if (!copied) {
      showToast(messages.unavailable, "warning");
      return false;
    }
    showToast(messages.success, "success");
    return true;
  } catch (_) {
    showToast(messages.error, "error");
    return false;
  }
}

function getCodeBlockCopyText(button) {
  const shell = button.closest(".code-block-shell");
  if (!(shell instanceof HTMLElement)) {
    return "";
  }

  const lineNodes = shell.querySelectorAll(".canvas-code-line__content");
  if (lineNodes.length) {
    return Array.from(lineNodes).map((node) => node.textContent || "").join("\n");
  }

  return shell.querySelector("code")?.textContent || "";
}

function setCodeCopyButtonLabel(button, label) {
  if (!(button instanceof HTMLButtonElement)) {
    return;
  }
  button.textContent = label;
}

async function copyCodeBlock(button) {
  if (!(button instanceof HTMLButtonElement)) {
    return;
  }

  const codeText = getCodeBlockCopyText(button);
  if (!codeText.trim()) {
    showToast("No code to copy.", "warning");
    return;
  }

  const originalLabel = button.textContent || "Copy code";
  const copied = await copyTextToClipboard(codeText);
  if (!copied) {
    setCodeCopyButtonLabel(button, "Copy failed");
    showToast("Clipboard is not available.", "warning");
    window.setTimeout(() => setCodeCopyButtonLabel(button, originalLabel), 1800);
    return;
  }

  setCodeCopyButtonLabel(button, "Copied");
  showToast("Code copied to clipboard.", "success");
  window.setTimeout(() => setCodeCopyButtonLabel(button, originalLabel), 1800);
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

async function copyAssistantMessageMarkdown(message) {
  await copyMessageContent(message?.content, {
    empty: "No Markdown content to copy.",
    unavailable: "Clipboard is not available.",
    success: "Markdown copied to clipboard.",
    error: "Copy failed.",
  });
}

async function copyUserMessageContent(message) {
  await copyMessageContent(message?.content, {
    empty: "No message text to copy.",
    unavailable: "Clipboard is not available.",
    success: "Message copied to clipboard.",
    error: "Copy failed.",
  });
}

async function regenerateAssistantMessage(messageId) {
  if (chatState.isStreaming || chatState.isFixing) {
    return;
  }

  const assistantMessage = getHistoryMessage(messageId);
  if (!assistantMessage || assistantMessage.role !== "assistant") {
    return;
  }

  const previousUserMessage = getPreviousUserMessage(messageId);
  if (!previousUserMessage) {
    showToast("No earlier user message is available to regenerate.", "warning");
    return;
  }

  editingMessageId = Number(previousUserMessage.id);
  clearInlineEditingTarget();
  await sendMessage({ forcedText: String(previousUserMessage.content || "") });
}

function createAssistantMessageActions(message) {
  if (!message || message.role !== "assistant") {
    return null;
  }

  return createMessageActions(message, { editable: true });
}

/* ------------------------------------------------------------------ */
/*  History Selection Click / Toggle Helpers                            */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/*  Inline Message Editor                                              */
/* ------------------------------------------------------------------ */

function createInlineMessageEditor(message) {
  const form = document.createElement("form");
  form.className = "message-inline-editor";
  form.dataset.messageId = String(message.id || "");

  const textarea = document.createElement("textarea");
  textarea.className = "message-inline-editor__input";
  textarea.value = isInlineEditingTarget(message.id)
    ? inlineEditingDraft
    : message.role === "user"
      ? buildComposerSlashCommandEditableText(message.content, message.metadata)
      : String(message.content || "");
  textarea.placeholder = message.role === "assistant"
    ? "Edit the assistant reply"
    : "Edit the message";
  textarea.rows = Math.max(3, Math.min(16, textarea.value.split(/\n/).length + 1));
  textarea.disabled = Number(savingEditedMessageId) === Number(message.id);
  textarea.addEventListener("input", () => {
    inlineEditingDraft = textarea.value;
    autoResizeInlineEditor(textarea);
  });
  textarea.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      form.requestSubmit();
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      cancelInlineEditingMessage({ focusAction: true });
    }
  });
  form.appendChild(textarea);

  const hint = document.createElement("div");
  hint.className = "message-inline-editor__hint";
  hint.textContent = message.role === "assistant"
    ? "Markdown is supported. Use Ctrl/Cmd+Enter to save."
    : "Use Ctrl/Cmd+Enter to save.";
  form.appendChild(hint);

  const actions = document.createElement("div");
  actions.className = "message-inline-editor__actions";

  const saveBtn = document.createElement("button");
  saveBtn.type = "submit";
  saveBtn.className = "msg-action-btn";
  saveBtn.textContent = Number(savingEditedMessageId) === Number(message.id) ? "Saving..." : "Save";
  saveBtn.disabled = Number(savingEditedMessageId) === Number(message.id);
  actions.appendChild(saveBtn);

  if (message.role === "user") {
    const saveAndSendBtn = document.createElement("button");
    saveAndSendBtn.type = "button";
    saveAndSendBtn.className = "msg-action-btn";
    saveAndSendBtn.textContent = "Save and Send";
    saveAndSendBtn.disabled = Number(savingEditedMessageId) === Number(message.id);
    saveAndSendBtn.addEventListener("click", () => {
      void saveEditedHistoryMessage(message.id, textarea.value, { sendAfterSave: true });
    });
    actions.appendChild(saveAndSendBtn);
  }

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "msg-action-btn";
  cancelBtn.textContent = "Cancel";
  cancelBtn.disabled = Number(savingEditedMessageId) === Number(message.id);
  cancelBtn.addEventListener("click", () => cancelInlineEditingMessage({ focusAction: true }));
  actions.appendChild(cancelBtn);

  form.appendChild(actions);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    await saveEditedHistoryMessage(message.id, textarea.value);
  });

  return form;
}

/* ------------------------------------------------------------------ */
/*  renderConversationHistory                                           */
/* ------------------------------------------------------------------ */

let lastRenderedConversationSignature = "";
let lastRenderedUiState = { editingMessageId: null, inlineEditingMessageId: null, messageSelectionMode: null };

function renderConversationHistory(options = {}) {
  const activeInlineMessage = getHistoryMessage(inlineEditingMessageId);
  if (inlineEditingMessageId !== null && !isEditableHistoryMessage(activeInlineMessage)) {
    clearInlineEditingTarget();
  }

  const preserveScroll = options && options.preserveScroll === true;
  const previousDistanceFromBottom = preserveScroll
    ? messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight
    : 0;

  const currentSignature = getConversationSignature(chatState.history);

  const currentUiState = { editingMessageId, inlineEditingMessageId, messageSelectionMode: uiState.messageSelectionMode };
  const uiStateChanged =
    lastRenderedUiState.editingMessageId !== currentUiState.editingMessageId ||
    lastRenderedUiState.inlineEditingMessageId !== currentUiState.inlineEditingMessageId ||
    lastRenderedUiState.messageSelectionMode !== currentUiState.messageSelectionMode;

  if (!uiStateChanged && currentSignature === lastRenderedConversationSignature && messagesEl.children.length > 0) {
    if (preserveScroll) {
      if (previousDistanceFromBottom <= 100) {
        scrollToBottom();
      } else {
        messagesEl.scrollTop = Math.max(0, messagesEl.scrollHeight - messagesEl.clientHeight - previousDistanceFromBottom);
      }
    }
    return;
  }

  lastRenderedUiState = currentUiState;

  const fragment = document.createDocumentFragment();
  fragment.appendChild(emptyState);

  if (!chatState.history.length) {
    emptyState.style.display = "";
    messagesEl.replaceChildren(fragment);
    scrollToBottom();
    renderHistorySelectionBar();
    lastRenderedConversationSignature = currentSignature;
    return;
  }

  emptyState.style.display = "none";
  const visibleEntries = getVisibleHistoryEntries();
  const selectionModeForRender = uiState.messageSelectionMode;
  const selectableMessageIdSetForRender = selectionModeForRender ? getSelectableMessageIdSet(selectionModeForRender) : null;

  const existingMessages = new Map();
  messagesEl.querySelectorAll(".msg-group[data-message-id]").forEach((el) => {
    const id = el.dataset.messageId;
    if (id) existingMessages.set(id, el);
  });

  visibleEntries.forEach((message, index) => {
    if (!isRenderableHistoryEntry(message)) {
      return;
    }

    const messageOptions = {
      messageId: message.id,
      position: message.position,
      selectionMode: selectionModeForRender,
      selectableMessageIdSet: selectableMessageIdSetForRender,
      editable: message.role === "user" || message.role === "assistant",
      isEditingTarget: isPersistedMessageId(message.id)
        && isPersistedMessageId(editingMessageId)
        && Number(message.id) === Number(editingMessageId),
      isInlineEditingTarget: isInlineEditingTarget(message.id),
      isLatestVisible: index === visibleEntries.length - 1,
      toolCalls: message.tool_calls,
    };

    const existingEl = existingMessages.get(String(message.id || ""));
    let messageEl;

    if (existingEl && !uiStateChanged) {
      existingEl.classList.toggle("editing-target", Boolean(messageOptions.isEditingTarget));
      existingEl.classList.toggle("inline-editing-target", Boolean(messageOptions.isInlineEditingTarget));
      existingEl.classList.toggle("is-selected",
        messageOptions.selectionMode && messageOptions.selectableMessageIdSetForRender?.has(Number(messageOptions.messageId))
      );
      messageEl = existingEl;
    } else {
      messageEl = createMessageGroup(message.role, message.content, message.metadata || null, messageOptions);
    }

    fragment.appendChild(messageEl);
  });

  messagesEl.replaceChildren(fragment);
  lastRenderedConversationSignature = currentSignature;

  if (preserveScroll) {
    if (previousDistanceFromBottom <= 100) {
      scrollToBottom();
    } else {
      messagesEl.scrollTop = Math.max(0, messagesEl.scrollHeight - messagesEl.clientHeight - previousDistanceFromBottom);
    }
  } else {
    scrollToBottom();
  }
  renderHistorySelectionBar();
}

/* ------------------------------------------------------------------ */
/*  Server Refresh / Polling                                           */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/*  Streaming Helpers                                                  */
/* ------------------------------------------------------------------ */

function renderAssistantLoadingBubble(bubbleEl, label = "Preparing response…", detail = "") {
  if (!bubbleEl) {
    return;
  }

  const normalizedLabel = String(label || "").trim() || "Preparing response…";
  const normalizedDetail = String(detail || "").trim();
  bubbleEl.hidden = false;
  bubbleEl.classList.add("bubble--loading");
  bubbleEl.classList.remove("streaming-text");
  bubbleEl.classList.remove("streaming-live");
  bubbleEl.innerHTML =
    `<div class="assistant-loading" aria-live="polite">` +
      `<span class="assistant-loading__dots" aria-hidden="true">` +
        `<span></span><span></span><span></span>` +
      `</span>` +
      `<span class="assistant-loading__copy">` +
        `<strong>${escHtml(normalizedLabel)}</strong>` +
        (normalizedDetail ? `<small>${escHtml(normalizedDetail)}</small>` : "") +
      `</span>` +
    `</div>`;
}

function clearAssistantLoadingBubble(bubbleEl) {
  if (!bubbleEl) {
    return;
  }
  bubbleEl.classList.remove("bubble--loading");
}

function createAssistantStreamingGroup() {
  const asstGroup = document.createElement("div");
  asstGroup.className = "msg-group assistant";

  const metaRow = document.createElement("div");
  metaRow.className = "msg-meta-row";

  const asstLabel = document.createElement("div");
  asstLabel.className = "msg-label";
  asstLabel.textContent = "Assistant";

  metaRow.appendChild(asstLabel);

  const stepLog = document.createElement("div");
  stepLog.className = "step-log";
  stepLog.style.display = "none";

  const asstBubble = document.createElement("div");
  asstBubble.className = "bubble";
  asstBubble.hidden = true;
  renderAssistantLoadingBubble(asstBubble);

  chatState.activeAssistantStreamingBubble = asstBubble;
  chatState.activeAssistantStreamingHasVisibleAnswer = false;

  asstGroup.appendChild(metaRow);
  asstGroup.appendChild(stepLog);
  asstGroup.appendChild(asstBubble);
  messagesEl.appendChild(asstGroup);
  scrollToBottom();

  return { asstGroup, stepLog, asstBubble };
}

function clearEmptyAssistantStreamingBubble() {
  if (!chatState.activeAssistantStreamingBubble || chatState.activeAssistantStreamingHasVisibleAnswer) {
    return false;
  }

  chatState.activeAssistantStreamingBubble.remove();
  chatState.activeAssistantStreamingBubble = null;
  return true;
}

function resetAssistantStreamingBubbleState() {
  chatState.activeAssistantStreamingBubble = null;
  chatState.activeAssistantStreamingHasVisibleAnswer = false;
}

function shouldAutoCollapseReasoning() {
  return Boolean(appSettings.reasoning_auto_collapse);
}

function finalizeAssistantStreamingGroup(asstGroup, stepLog, metadata) {
  if (!asstGroup) {
    return;
  }

  if (stepLog) {
    stepLog.style.display = "none";
  }

  updateAssistantFetchBadge(asstGroup, metadata);
  updateAssistantToolTrace(asstGroup, metadata);
  updateAssistantSubAgentTrace(asstGroup, metadata);
  updateReasoningPanel(asstGroup, getReasoningText(metadata), { forceOpen: true });
  appendClarificationPanel(asstGroup, metadata, {});
}

function applyPersistedMessageIds(persistedIds, assistantEntry) {
  if (!persistedIds || typeof persistedIds !== "object") {
    return;
  }

  const userId = Number(persistedIds.user_message_id);
  if (isPersistedMessageId(userId)) {
    for (let index = chatState.history.length - 1; index >= 0; index -= 1) {
      if (chatState.history[index].role === "user") {
        chatState.history[index].id = userId;
        break;
      }
    }
  }

  const assistantId = Number(persistedIds.assistant_message_id);
  if (assistantEntry && isPersistedMessageId(assistantId)) {
    assistantEntry.id = assistantId;
    saveAssistantReasoning(chatState.currentConvId, assistantId, assistantEntry?.metadata?.reasoning_content || "");
  }
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

function getSummarySkipFirstValue() {
  const rawValue = Number.parseInt(String(appSettings.summary_skip_first || "0"), 10);
  return Number.isFinite(rawValue) ? Math.max(0, rawValue) : 0;
}

/* ------------------------------------------------------------------ */
/*  Message Group Creation                                             */
/* ------------------------------------------------------------------ */

function createMessageGroup(role, text, metadata = null, options = {}) {
  emptyState.style.display = "none";

  const group = document.createElement("div");
  group.className = `msg-group ${role}`;
  if (Number.isInteger(Number(options.messageId))) {
    group.dataset.messageId = String(options.messageId);
  }
  if (options.isEditingTarget) {
    group.classList.add("editing-target");
  }
  if (options.isInlineEditingTarget) {
    group.classList.add("inline-editing-target");
  }

  const metaRow = document.createElement("div");
  metaRow.className = "msg-meta-row";

  const normalizedMetadata = metadata && typeof metadata === "object" ? metadata : null;
  const slashCommandState = role === "user" ? extractComposerSlashCommandMetadata(normalizedMetadata) : null;
  const historyMessage = {
    id: options.messageId,
    role,
    content: text,
    metadata: normalizedMetadata,
    position: options.position ?? null,
    tool_calls: Array.isArray(options.toolCalls) ? options.toolCalls : [],
  };
  const selectionMode = options.selectionMode || uiState.messageSelectionMode;
  const selectableMessageIdSet = options.selectableMessageIdSet || (selectionMode ? getSelectableMessageIdSet(selectionMode) : null);
  const activeSelectionMode = selectionMode && selectableMessageIdSet?.has(Number(historyMessage.id || 0))
    ? selectionMode
    : null;
  const labelGroup = document.createElement("div");
  labelGroup.className = "msg-meta-label-group";

  const selectionToggle = activeSelectionMode ? createHistorySelectionToggle(historyMessage, activeSelectionMode) : null;
  if (selectionToggle) {
    group.classList.add("msg-group--selectable", `msg-group--selectable-${activeSelectionMode}`);
    if (isMessageSelectedForMode(options.messageId, activeSelectionMode)) {
      group.classList.add("is-selected");
    }
  }

  const label = document.createElement("div");
  label.className = "msg-label";
  label.textContent = role === "user" ? "You" : role === "summary" ? "Summary" : "Assistant";

  labelGroup.appendChild(label);
  if (role === "summary" && normalizedMetadata?.is_summary) {
    const coveredCount = Number(normalizedMetadata.covered_message_count || 0);
    const generatedAt = formatSummaryTimestamp(normalizedMetadata.generated_at);
    const sourceLabel = SUMMARY_SOURCE_LABELS[String(normalizedMetadata.summary_source || "").trim()] || "Conversation chatState.history";
    const formatLabel = String(normalizedMetadata.summary_format || "").trim() === "structured_json"
      ? "Structured"
      : "Plain text";
    const summaryMetaParts = [];
    if (coveredCount > 0) {
      summaryMetaParts.push(`${coveredCount} msgs`);
    }
    summaryMetaParts.push(sourceLabel);
    summaryMetaParts.push(formatLabel);
    if (generatedAt && generatedAt !== "—") {
      summaryMetaParts.push(generatedAt);
    }
    if (normalizedMetadata.covered_ids_truncated === true) {
      summaryMetaParts.push("ID list truncated");
    }
    const summaryMeta = document.createElement("span");
    summaryMeta.className = "summary-inline-meta";
    summaryMeta.textContent = summaryMetaParts.join(" • ");
    labelGroup.appendChild(summaryMeta);
  }
  if (role === "user" && slashCommandState?.command?.badgeLabel) {
    const doubleCheckBadge = document.createElement("span");
    doubleCheckBadge.className = "double-check-badge";
    doubleCheckBadge.textContent = slashCommandState.command.badgeLabel;
    labelGroup.appendChild(doubleCheckBadge);
  }

  metaRow.appendChild(labelGroup);

  let summaryToggleButton = null;
  let summaryUndoButton = null;
  if (role === "summary" && normalizedMetadata?.is_summary) {
    const summaryActions = document.createElement("div");
    summaryActions.className = "msg-actions";

    summaryToggleButton = document.createElement("button");
    summaryToggleButton.type = "button";
    summaryToggleButton.className = "msg-action-btn msg-action-btn--with-label";
    summaryToggleButton.textContent = "Show summary";

    summaryUndoButton = document.createElement("button");
    summaryUndoButton.type = "button";
    summaryUndoButton.className = "msg-action-btn msg-action-btn--with-label";
    summaryUndoButton.textContent = "Undo";
    const canUndoSummary = Number.isInteger(Number(options.messageId)) && Number(options.messageId) > 0 && Boolean(chatState.currentConvId);
    summaryUndoButton.disabled = summaryState.isSummaryOperationInFlight || !canUndoSummary;
    summaryUndoButton.addEventListener("click", () => {
      void undoConversationSummary(Number(options.messageId || 0), { triggerButton: summaryUndoButton });
    });

    summaryActions.append(summaryToggleButton, summaryUndoButton);
    metaRow.appendChild(summaryActions);
  }

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  const attachments = getMessageAttachments(metadata);
  const hasImage = attachments.some((attachment) => attachment.kind === "image");
  const hasDocument = attachments.some((attachment) => attachment.kind === "document");
  const slashCommandDisplayText = slashCommandState
    ? String(slashCommandState.text || "").trim()
    : "";
  const displayText = text || slashCommandDisplayText || (slashCommandState?.fallbackText
    ? slashCommandState.fallbackText
    : attachments.length
      ? "Attachments uploaded."
      : hasImage
        ? "Image uploaded."
        : hasDocument
          ? "Document uploaded."
          : "");
  const pendingClarification = role === "assistant" ? getPendingClarification(normalizedMetadata) : null;
  const footerActions = createMessageActions(historyMessage, options);

  group.appendChild(metaRow);
  if (role === "assistant") {
    updateAssistantFetchBadge(group, metadata);
    updateAssistantToolTrace(group, metadata);
    updateAssistantSubAgentTrace(group, metadata);
    updateReasoningPanel(group, getReasoningText(metadata, options.messageId));
  }

  if (options.isInlineEditingTarget) {
    group.appendChild(createInlineMessageEditor({
      id: options.messageId,
      role,
      content: text,
      metadata: normalizedMetadata,
      tool_calls: Array.isArray(options.toolCalls) ? options.toolCalls : [],
    }));
  } else {
    if ((role === "assistant" || role === "summary") && text !== "Working…") {
      bubble.innerHTML = renderMarkdown(text);
    } else {
      bubble.textContent = displayText;
    }
    if (role === "summary") {
      bubble.classList.add("summary-inline-body");
      bubble.hidden = true;
    }

    const shouldRenderContentRow = Boolean(displayText) || Boolean(selectionToggle);
    if (shouldRenderContentRow) {
      const contentRow = document.createElement("div");
      contentRow.className = "msg-content-row";
      if (selectionToggle && activeSelectionMode) {
        contentRow.classList.add("msg-content-row--selectable", `msg-content-row--selectable-${activeSelectionMode}`);
        bindHistorySelectionClickTarget(contentRow, options.messageId, activeSelectionMode);
      }

      if (displayText) {
        if (selectionToggle) {
          if (role === "user") {
            contentRow.append(bubble, selectionToggle);
          } else {
            contentRow.append(selectionToggle, bubble);
          }
        } else {
          contentRow.appendChild(bubble);
        }
      } else if (selectionToggle) {
        contentRow.appendChild(selectionToggle);
      }

      group.appendChild(contentRow);
    }
  }

  if (summaryToggleButton) {
    const canToggleSummary = Boolean(displayText);
    summaryToggleButton.disabled = !canToggleSummary;
    const syncSummaryToggleLabel = () => {
      summaryToggleButton.textContent = bubble.hidden ? "Show summary" : "Hide summary";
    };
    syncSummaryToggleLabel();
    if (canToggleSummary) {
      summaryToggleButton.addEventListener("click", () => {
        bubble.hidden = !bubble.hidden;
        syncSummaryToggleLabel();
        if (!bubble.hidden) {
          scrollToBottom();
        }
      });
    }
  }

  if (role === "assistant" && !options.isInlineEditingTarget) {
    appendClarificationPanel(group, metadata, options);
  }
  if (role === "user" && attachments.length) {
    appendAttachmentBadge(group, metadata);
    if (hasImage) {
      appendVisionDetails(group, metadata);
    }
  }
  if (!options.isInlineEditingTarget && footerActions) {
    group.appendChild(footerActions);
  }
  return group;
}

function appendGroup(role, text, metadata = null, options = {}) {
  const group = createMessageGroup(role, text, metadata, options);
  messagesEl.appendChild(group);
  scrollToBottom();
  return group;
}

/* ------------------------------------------------------------------ */
/*  Bubble rendering helpers (extracted from app.js)                    */
/* ------------------------------------------------------------------ */

function renderBubbleWithCursor(bubbleEl, text) {
  if (!bubbleEl) {
    return;
  }

  clearAssistantLoadingBubble(bubbleEl);
  bubbleEl.hidden = false;
  bubbleEl.classList.add("streaming-text");
  bubbleEl.classList.add("streaming-live");
  bubbleEl.innerHTML = renderStreamingMarkdown(text);

  const findStreamingCursorContainer = (rootEl) => {
    let cursorHost = rootEl;
    while (cursorHost instanceof Element && cursorHost.lastChild) {
      const lastChild = cursorHost.lastChild;
      if (lastChild.nodeType === Node.TEXT_NODE) {
        if (String(lastChild.textContent || "").trim()) {
          return cursorHost;
        }
        lastChild.remove();
        continue;
      }
      if (!(lastChild instanceof Element)) {
        return cursorHost;
      }
      if (["BR", "HR", "IMG", "INPUT"].includes(lastChild.tagName)) {
        return cursorHost;
      }
      cursorHost = lastChild;
    }
    return rootEl;
  };

  const cursorEl = document.createElement("span");
  cursorEl.className = "stream-cursor";
  cursorEl.textContent = "\u258B";
  findStreamingCursorContainer(bubbleEl).appendChild(cursorEl);
}

function renderBubbleMarkdown(bubbleEl, text) {
  if (!bubbleEl) {
    return;
  }

  clearAssistantLoadingBubble(bubbleEl);
  bubbleEl.hidden = false;
  bubbleEl.classList.remove("streaming-text");
  bubbleEl.classList.remove("streaming-live");
  bubbleEl.innerHTML = renderMarkdown(text);
}

function finalizeAssistantBubble(asstBubble, text) {
  if (!asstBubble) {
    return;
  }

  const normalizedText = String(text || "").trim();
  if (!normalizedText) {
    asstBubble.remove();
    return;
  }

  clearAssistantLoadingBubble(asstBubble);
  asstBubble.classList.remove("thinking");
  asstBubble.classList.remove("cursor");
  asstBubble.classList.remove("streaming-live");
  renderBubbleMarkdown(asstBubble, normalizedText);
}

/* ------------------------------------------------------------------ */
/*  streamNdjsonResponse — extracted from app.js                       */
/* ------------------------------------------------------------------ */

async function streamNdjsonResponse(response, onEvent) {
  if (!response.body) {
    throw new Error("The server returned an empty response stream.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  const processLine = (line) => {
    if (!line.trim()) {
      return;
    }
    try {
      onEvent(JSON.parse(line));
    } catch (_) {
      // Ignore malformed partial chunks.
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    lines.forEach(processLine);
  }

  buffer += decoder.decode();
  processLine(buffer);
}

/* ------------------------------------------------------------------ */
/*  saveEditedHistoryMessage — extracted from app.js                   */
/* ------------------------------------------------------------------ */

async function saveEditedHistoryMessage(messageId, nextContent, options = {}) {
  if (chatState.isStreaming || chatState.isFixing) {
    return;
  }

  const message = getHistoryMessage(messageId);
  if (!isEditableHistoryMessage(message)) {
    showError("This message can no longer be edited.");
    clearInlineEditingTarget();
    renderConversationHistory({ preserveScroll: true });
    return;
  }

  const normalizedContent = String(nextContent ?? "").replace(/\r\n/g, "\n");
  const parsedSlashCommand = message.role === "user" ? parseComposerSlashCommand(normalizedContent) : null;
  const storedContent = message.role === "user" && parsedSlashCommand?.command
    ? parsedSlashCommand.text
    : normalizedContent;
  const updatedUserMetadata = message.role === "user"
    ? buildComposerSlashCommandMetadata(message.metadata, parsedSlashCommand)
    : null;
  if (!storedContent.trim() && (message.role !== "user" || !updatedUserMetadata)) {
    showToast(
      message.role === "assistant" ? "Assistant message cannot be empty." : "Message cannot be empty.",
      "warning",
    );
    focusInlineEditor(messageId);
    return;
  }

  const shouldSendAfterSave = Boolean(options.sendAfterSave && message.role === "user");
  const previousEditableContent = message.role === "user"
    ? buildComposerSlashCommandEditableText(message.content, message.metadata)
    : String(message.content || "");
  const contentChanged = normalizedContent !== previousEditableContent;

  if (!contentChanged && !shouldSendAfterSave) {
    cancelInlineEditingMessage();
    return;
  }

  savingEditedMessageId = Number(messageId);
  renderConversationHistory({ preserveScroll: true });

  try {
    if (contentChanged) {
      const response = await fetch(`/api/messages/${messageId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversation_id: chatState.currentConvId,
          content: storedContent,
          ...(message.role === "user" ? { metadata: updatedUserMetadata } : {}),
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.error || "Message could not be updated.");
      }

      const updatedMessage = data?.message ? normalizeHistoryEntry(data.message) : null;
      const index = getHistoryMessageIndex(messageId);
      if (updatedMessage && index >= 0) {
        chatState.history[index] = updatedMessage;
      }
    }

    if (shouldSendAfterSave) {
      editingMessageId = Number(messageId);
      clearInlineEditingTarget();
      renderConversationHistory({ preserveScroll: true });
      refreshEditBanner();
      await sendMessage({ forcedText: normalizedContent });
      return;
    }

    clearInlineEditingTarget();
    renderConversationHistory({ preserveScroll: true });
    showToast("Message updated.", "success");
  } catch (error) {
    savingEditedMessageId = null;
    renderConversationHistory({ preserveScroll: true });
    showError(error.message || "Message could not be updated.");
    focusInlineEditor(messageId);
  }
}

/* ------------------------------------------------------------------ */
/*  Edit target helpers — extracted from app.js                        */
/* ------------------------------------------------------------------ */

function clearEditTarget() {
  editingMessageId = null;
  editBanner.hidden = true;
  editBannerText.textContent = "";
}

function refreshEditBanner() {
  const message = getHistoryMessage(editingMessageId);
  if (!message || message.role !== "user") {
    clearEditTarget();
    return;
  }

  editBanner.hidden = false;
  editBannerText.textContent = "Editing an earlier message. Sending now will replace that turn and continue from there.";
}

function beginEditingMessage(messageId) {
  if (chatState.isStreaming || chatState.isFixing) {
    return;
  }

  const message = getHistoryMessage(messageId);
  if (!message || message.role !== "user") {
    return;
  }

  clearInlineEditingTarget();
  editingMessageId = Number(message.id);
  inputEl.value = buildComposerSlashCommandEditableText(message.content, message.metadata);
  autoResize(inputEl);
  syncSlashCommandMenuWithInput({ preserveSelection: false });
  clearSelectedImage();
  refreshEditBanner();
  renderConversationHistory();
  inputEl.focus();
  inputEl.setSelectionRange(inputEl.value.length, inputEl.value.length);
}

/* ------------------------------------------------------------------ */
/*  startNewChat — extracted from app.js                               */
/* ------------------------------------------------------------------ */

function startNewChat() {
  clearPendingDeleteMessage({ render: false });
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
  resetTokenStats();
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

/* ------------------------------------------------------------------ */
/*  Token / streaming state helpers — extracted from app.js            */
/* ------------------------------------------------------------------ */

function resetTokenStats() {
  tokenTurns.length = 0;
  renderTokenStats();
}

function setStreaming(active) {
  chatState.isStreaming = active;
  if (!active) {
    uiState.userScrolledUp = false;
    activeAnswerRenderPending = false;
    canvasState.lastPreviewRenderAt = 0;
    canvasState.resetDeferred();
    clearDeferredCanvasRenderFlushTimer();
    flushDeferredCanvasRenderWork();
  }
  if (messagesEl) {
    messagesEl.style.scrollBehavior = active ? "auto" : "";
  }
  sendBtn.style.display = active ? "none" : "";
  cancelBtn.hidden = !active;
  fixBtn.disabled = active;
  inputEl.disabled = active;
  attachBtn.disabled = active;
  if (youtubeUrlBtn) {
    youtubeUrlBtn.disabled = active;
  }
}

function setFixing(active) {
  chatState.isFixing = active;
  sendBtn.disabled = active;
  fixBtn.disabled = active;
  inputEl.disabled = active;
  attachBtn.disabled = active;
  if (youtubeUrlBtn) {
    youtubeUrlBtn.disabled = active;
  }
}
