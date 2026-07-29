// message/editing.js — Inline editing lifecycle

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
