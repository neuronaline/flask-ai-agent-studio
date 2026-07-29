// message/actions.js — Copy, regenerate, delete, action buttons

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
