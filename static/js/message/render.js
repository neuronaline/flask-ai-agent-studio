// message/render.js — Message groups, bubbles, cursor rendering

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
