/**
 * Chat module — sendMessage, the core streaming chat request orchestrator.
 * Depends on: state.js, render.js, message.js, summary.js, attachments.js, canvas.js, traces.js,
 *             utils.js, constants.js, step-ui.js, slash.js
 * Globals from app.js: inputEl, modelSel, sendBtn, cancelBtn, fixBtn, attachBtn, youtubeUrlBtn,
 *                      editBanner, messagesEl, featureFlags, editingMessageId, etc.
 */

/* ------------------------------------------------------------------ */
/*  sendMessage — the core chat request/stream handler                  */
/* ------------------------------------------------------------------ */

async function sendMessage(options = {}) {
  const forcedText = typeof options.forcedText === "string" ? options.forcedText.trim() : "";
  const forcedMetadata = options.forcedMetadata && typeof options.forcedMetadata === "object"
    ? options.forcedMetadata
    : null;
  const rawInputText = forcedText || inputEl.value.trim();
  const slashCommand = parseComposerSlashCommand(rawInputText);
  const text = slashCommand.requested ? slashCommand.text : rawInputText;
  const pendingImages = [...attachmentState.selectedImageFiles];
  const pendingDocuments = [...attachmentState.selectedDocumentFiles];
  const pendingYouTubeUrl = attachmentState.selectedYouTubeUrl;
  if (!text && !slashCommand.requested && !pendingImages.length && !pendingDocuments.length && !pendingYouTubeUrl) {
    return { ok: false, errorCode: "" };
  }

  const editingEntry = getHistoryMessage(editingMessageId);
  const isEditing = Boolean(editingEntry && editingEntry.role === "user");
  const editedMessageId = isEditing ? Number(editingEntry.id) : null;

  if (pendingDeleteMessageId !== null) {
    clearPendingDeleteMessage({ preserveScroll: true });
  }

  if (inlineEditingMessageId !== null) {
    clearInlineEditingTarget();
    renderConversationHistory({ preserveScroll: true });
  }

  if (pendingDocuments.length) {
    const modeSelectionAccepted = await promptPdfSubmissionMode(pendingDocuments);
    if (!modeSelectionAccepted) {
      return { ok: false, errorCode: "" };
    }
  }

  const existingDocumentAttachments = !pendingDocuments.length && isEditing
    ? getExistingDocumentAttachmentsForCanvasPrompt(editingEntry)
    : [];
  const documentCanvasPromptItems = pendingDocuments.length ? pendingDocuments : existingDocumentAttachments;

  let documentCanvasAction = "prompt";
  if (documentCanvasPromptItems.length) {
    documentCanvasAction = await promptDocumentCanvasAction(documentCanvasPromptItems);
  }

  setPendingDocumentCanvasOpen(documentCanvasAction === "open" ? documentCanvasPromptItems : null);

  if (pendingImages.length && !Boolean(featureFlags.image_uploads_enabled)) {
    clearSelectedImage();
    showError("Image uploads are disabled in .env.");
    return { ok: false, errorCode: "" };
  }
  if (!isEditing) {
    clearEditTarget();
  }

  let sendSucceeded = false;
  let sendErrorCode = "";

  clearToastRegion();
  closeSlashCommandMenu();
  inputEl.value = "";
  inputEl.style.height = "auto";
  clearAllAttachments();

  if (!chatState.currentConvId) {
    const response = await fetch("/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "New Chat",
        model: modelSel.value,
        persona_id: chatState.currentConversationPersonaId || null,
      }),
    });
    const conversation = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(String(conversation?.error || "Unable to create a conversation."));
    }
    if (!Number.isInteger(Number(conversation?.id))) {
      throw new Error("Unable to create a conversation.");
    }
    chatState.currentConvId = conversation.id;
    chatState.currentConvTitle = String(conversation.title || "New Chat").trim() || "New Chat";
    chatState.currentConversationPersonaId = normalizePersonaId(conversation.persona_id);
    syncPersonaSelectors(chatState.currentConversationPersonaId);
    loadSidebar();
    updateExportPanel();
  }

  let userMetadata = buildPendingAttachmentMetadata(pendingImages, pendingDocuments, pendingYouTubeUrl);
  userMetadata = buildComposerSlashCommandMetadata(userMetadata, slashCommand);
  if (forcedMetadata) {
    userMetadata = {
      ...(userMetadata || {}),
      ...forcedMetadata,
    };
  }
  if (userMetadata && !Object.keys(userMetadata).length) {
    userMetadata = null;
  }
  let userGroup;

  if (isEditing) {
    const editIndex = getHistoryMessageIndex(editedMessageId);
    if (editIndex < 0) {
      clearEditTarget();
      showError("The selected message could not be edited.");
      return { ok: false, errorCode: "" };
    }

    if (!pendingImages.length && !pendingDocuments.length && !pendingYouTubeUrl) {
      userMetadata = sanitizeEditedUserMetadata(editingEntry.metadata);
    }

    chatState.history = chatState.history.slice(0, editIndex + 1).map((item) => ({
      ...normalizeHistoryEntry(item),
      metadata: item.metadata && typeof item.metadata === "object" ? { ...item.metadata } : null,
    }));
    chatState.history[editIndex] = {
      ...chatState.history[editIndex],
      content: text,
      metadata: userMetadata,
    };
    canvasState.streamingCanvasDocuments = [];
    resetStreamingCanvasPreview();
    canvasState.isCanvasEditing = false;
    canvasState.editingCanvasDocumentId = null;
    canvasState.activeCanvasDocumentId = getActiveCanvasDocument(chatState.history)?.id || null;
    rebuildTokenStatsFromHistory();
    renderConversationHistory({ preserveScroll: true });
    renderCanvasPanel();
    clearEditTarget();
  } else {
    const userEntry = { id: null, role: "user", content: text, metadata: userMetadata };
    chatState.history.push(userEntry);
  }

  const controller = new AbortController();
  const streamRequestId = createStreamRequestId();
  chatState.activeAbortController = controller;
  chatState.activeChatRunId = streamRequestId;
  chatState.activeUserCancelRequested = false;
  uiState.conversationRefreshGeneration += 1;
  uiState.pendingConversationRefreshTimers.forEach((timerId) => window.clearTimeout(timerId));
  uiState.pendingConversationRefreshTimers.clear();
  setStreaming(true);
  renderConversationHistory({ preserveScroll: true });
  userGroup = messagesEl.querySelector(".msg-group.user:last-of-type");

  const { asstGroup, stepLog, asstBubble } = createAssistantStreamingGroup();

  let rawAnswer = "";
  let rawReasoning = "";
  let fullAnswer = "";
  let latestUsage = null;
  let hasLiveUsageTurn = false;
  let assistantToolResults = [];
  let assistantToolTrace = [];
  let assistantSubAgentTraces = [];
  let assistantToolHistory = [];
  let pendingClarification = null;
  let assistantCanvasActiveDocumentId = null;
  let assistantCanvasCleared = false;
  let persistedMessageIds = null;
  let receivedHistorySync = false;
  const stepItems = {};
  const stepSections = {};
  const assistantTraceByKey = {};
  let latestStepInfo = { step: 1, maxSteps: null };
  let pendingAnswerRenderTimer = null;
  let pendingAnswerRenderTimerKind = "";
  let pendingReasoningRenderTimer = null;
  let visibleAnswer = "";
  let lastAnswerRenderAt = 0;

  const clearPendingAnswerRender = () => {
    if (pendingAnswerRenderTimer === null) {
      return;
    }
    if (pendingAnswerRenderTimerKind === "frame" && typeof window.cancelAnimationFrame === "function") {
      window.cancelAnimationFrame(pendingAnswerRenderTimer);
    } else {
      window.clearTimeout(pendingAnswerRenderTimer);
    }
    pendingAnswerRenderTimer = null;
    pendingAnswerRenderTimerKind = "";
  };

  const queueAnswerAnimationFrame = (flushStreamingAnswerFrame) => {
    if (typeof window.requestAnimationFrame === "function") {
      pendingAnswerRenderTimerKind = "frame";
      pendingAnswerRenderTimer = window.requestAnimationFrame(flushStreamingAnswerFrame);
      return;
    }

    pendingAnswerRenderTimerKind = "timeout";
    pendingAnswerRenderTimer = window.setTimeout(flushStreamingAnswerFrame, STREAM_RENDER_FALLBACK_INTERVAL_MS);
  };

  const scheduleAnswerRender = () => {
    if (pendingAnswerRenderTimer !== null) {
      return;
    }

    activeAnswerRenderPending = true;

    const flushStreamingAnswerFrame = () => {
      pendingAnswerRenderTimer = null;
      pendingAnswerRenderTimerKind = "";
      activeAnswerRenderPending = false;
      lastAnswerRenderAt = typeof performance !== "undefined" && typeof performance.now === "function"
        ? performance.now()
        : Date.now();
      if (visibleAnswer === fullAnswer) {
        flushDeferredCanvasRenderWork();
        return;
      }
      if (!String(fullAnswer || "").trim()) {
        visibleAnswer = fullAnswer;
        flushDeferredCanvasRenderWork();
        return;
      }

      visibleAnswer = fullAnswer;
      renderBubbleWithCursor(asstBubble, visibleAnswer);
      if (String(visibleAnswer || "").trim()) {
        chatState.activeAssistantStreamingHasVisibleAnswer = true;
      }
      scrollToBottom();
      flushDeferredCanvasRenderWork();
    };

    const now = typeof performance !== "undefined" && typeof performance.now === "function"
      ? performance.now()
      : Date.now();
    const elapsed = Math.max(0, now - lastAnswerRenderAt);
    if (elapsed < STREAM_ANSWER_RENDER_INTERVAL_MS) {
      pendingAnswerRenderTimerKind = "timeout";
      pendingAnswerRenderTimer = window.setTimeout(() => {
        pendingAnswerRenderTimer = null;
        pendingAnswerRenderTimerKind = "";
        queueAnswerAnimationFrame(flushStreamingAnswerFrame);
      }, STREAM_ANSWER_RENDER_INTERVAL_MS - elapsed);
      return;
    }

    queueAnswerAnimationFrame(flushStreamingAnswerFrame);
  };

  const flushAnswerRender = () => {
    clearPendingAnswerRender();
    activeAnswerRenderPending = false;
    lastAnswerRenderAt = typeof performance !== "undefined" && typeof performance.now === "function"
      ? performance.now()
      : Date.now();
    if (!String(fullAnswer || "").trim()) {
      visibleAnswer = fullAnswer;
      flushDeferredCanvasRenderWork();
      return;
    }

    visibleAnswer = fullAnswer;
    renderBubbleWithCursor(asstBubble, visibleAnswer);
    if (String(visibleAnswer || "").trim()) {
      chatState.activeAssistantStreamingHasVisibleAnswer = true;
    }
    flushDeferredCanvasRenderWork();
  };

  const scheduleReasoningRender = () => {
    if (pendingReasoningRenderTimer !== null) {
      return;
    }

    const flushStreamingReasoningFrame = () => {
      pendingReasoningRenderTimer = null;
      updateReasoningPanel(asstGroup, rawReasoning, { forceOpen: true, streaming: true });
      scrollToBottom();
    };

    if (typeof window.requestAnimationFrame === "function") {
      pendingReasoningRenderTimer = window.requestAnimationFrame(flushStreamingReasoningFrame);
      return;
    }

    pendingReasoningRenderTimer = window.setTimeout(flushStreamingReasoningFrame, STREAM_RENDER_FALLBACK_INTERVAL_MS);
  };

  const flushReasoningRender = () => {
    if (pendingReasoningRenderTimer !== null) {
      if (typeof window.cancelAnimationFrame === "function") {
        window.cancelAnimationFrame(pendingReasoningRenderTimer);
      } else {
        window.clearTimeout(pendingReasoningRenderTimer);
      }
      pendingReasoningRenderTimer = null;
    }
    updateReasoningPanel(asstGroup, rawReasoning, { forceOpen: true, streaming: true });
  };

  try {
    const requestMessages = buildRequestMessagesFromHistory();

    let response;
    if (pendingImages.length || pendingDocuments.length) {
      const formData = new FormData();
      formData.append("messages", JSON.stringify(requestMessages));
      formData.append("model", modelSel.value);
      formData.append("conversation_id", String(chatState.currentConvId));
      formData.append("user_content", text);
      formData.append("stream_request_id", streamRequestId);
      appendSlashCommandFormData(formData, slashCommand);
      if (editedMessageId !== null) {
        formData.append("edited_message_id", String(editedMessageId));
      }
      pendingImages.forEach((file) => formData.append("image", file));
      pendingDocuments.forEach((file) => formData.append("document", file));
      formData.append("document_modes", JSON.stringify(
        pendingDocuments.map((file) => ({
          file_name: file.name,
          submission_mode: getDocumentSubmissionMode(file),
        }))
      ));
      formData.append("document_canvas_action", documentCanvasAction);
      if (pendingYouTubeUrl) {
        formData.append("youtube_url", pendingYouTubeUrl);
      }

      response = await fetch("/chat", {
        method: "POST",
        signal: controller.signal,
        body: formData,
      });
    } else {
      response = await fetch("/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          messages: requestMessages,
          model: modelSel.value,
          conversation_id: chatState.currentConvId,
          stream_request_id: streamRequestId,
          edited_message_id: editedMessageId,
          user_content: text,
          document_canvas_action: documentCanvasAction,
          youtube_url: pendingYouTubeUrl,
          ...getSlashCommandRequestPayload(slashCommand),
        }),
      });
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: "An unexpected error occurred.", code: "" }));
      const requestError = new Error(error.error || "An unexpected error occurred.");
      requestError.code = typeof error.code === "string" ? error.code : "";
      throw requestError;
    }

    await streamNdjsonResponse(response, (event) => {
      if (event.type === "status" && event.status === "compacting") {
        const compactingMessage = String(event.message || "Compacting conversation...").trim() || "Compacting conversation...";
        if (!chatState.activeAssistantStreamingHasVisibleAnswer) {
          renderAssistantLoadingBubble(asstBubble, compactingMessage);
        } else {
          asstBubble.hidden = false;
          asstBubble.classList.add("thinking");
          asstBubble.classList.add("cursor");
          asstBubble.textContent = compactingMessage;
          scrollToBottom();
        }
      } else if (event.type === "step_started") {
        latestStepInfo = {
          step: event.step || latestStepInfo.step,
          maxSteps: event.max_steps || latestStepInfo.maxSteps,
        };
      } else if (event.type === "vision_complete" || event.type === "ocr_complete") {
        const lastMessage = chatState.history[chatState.history.length - 1];
        if (lastMessage && lastMessage.role === "user") {
          const attachment = event.attachment || {
            kind: "image",
            image_id: event.image_id,
            image_name: event.image_name,
            analysis_method: event.analysis_method,
            ocr_text: event.ocr_text,
            vision_summary: event.vision_summary,
            assistant_guidance: event.assistant_guidance,
            key_points: Array.isArray(event.key_points) ? event.key_points : [],
          };
          lastMessage.metadata = mergeAttachmentMetadata(lastMessage.metadata, attachment);
          updateAttachmentBadge(userGroup, lastMessage.metadata);
          updateVisionDetails(userGroup, lastMessage.metadata);
        }
        scrollToBottom();
      } else if (event.type === "video_transcript_ready") {
        const lastMessage = chatState.history[chatState.history.length - 1];
        if (lastMessage && lastMessage.role === "user") {
          const attachment = event.attachment || {
            kind: "video",
            video_id: event.video_id,
            video_title: event.video_title,
            video_url: event.video_url,
            transcript_language: event.transcript_language,
          };
          lastMessage.metadata = mergeAttachmentMetadata(lastMessage.metadata, attachment);
          updateAttachmentBadge(userGroup, lastMessage.metadata);
        }
        scrollToBottom();
      } else if (event.type === "document_processed") {
        const lastMessage = chatState.history[chatState.history.length - 1];
        if (lastMessage && lastMessage.role === "user") {
          const attachment = event.attachment || {
            kind: "document",
            file_id: event.file_id,
            file_name: event.file_name,
            file_mime_type: event.file_mime_type,
          };
          lastMessage.metadata = mergeAttachmentMetadata(lastMessage.metadata, attachment);
          appendAttachmentBadge(userGroup, lastMessage.metadata);
        }

        if (event.visual_only) {
          setCanvasStatus(`${String(event.file_name || "PDF").trim() || "PDF"} attached in visual mode. Up to the first ${VISUAL_PDF_PAGE_LIMIT} pages will be used for image analysis, and Canvas editing is unavailable for this upload.`, "muted");
        }

        if (event.canvas_document && !isCanvasOpen()) {
          setCanvasAttention(true);
        }
        scrollToBottom();
      } else if (event.type === "step_update") {
        if (!chatState.activeAssistantStreamingHasVisibleAnswer) {
          const detailParts = [String(event.tool || "").replaceAll("_", " ").trim(), String(event.preview || "").trim()].filter(Boolean);
          renderAssistantLoadingBubble(asstBubble, "Preparing response…", detailParts.join(" • "));
        }
        stepLog.style.display = "";
        const toolKey = event.call_id || event.tool || "__generic__";
        const sectionItems = ensureToolStepSection(
          stepLog,
          stepSections,
          event.step || latestStepInfo.step,
          event.max_steps || latestStepInfo.maxSteps,
        );
        if (!stepItems[toolKey]) {
          const item = createToolStepItem(event.tool);
          sectionItems.appendChild(item);
          stepItems[toolKey] = {
            el: item,
            toolName: event.tool,
            preview: event.preview || "",
            startedAt: performance.now(),
          };
        }
        const itemRef = stepItems[toolKey];
        itemRef.toolName = event.tool || itemRef.toolName;
        itemRef.preview = event.preview || itemRef.preview;
        setToolStepState(itemRef.el, {
          toolName: itemRef.toolName,
          preview: itemRef.preview,
          state: "running",
        });
        if (event.tool) {
          const traceEntry = assistantTraceByKey[toolKey] || {
            tool_name: event.tool,
            step: event.step || latestStepInfo.step || 1,
            preview: event.preview || "",
            summary: "",
            state: "running",
            cached: false,
          };
          traceEntry.tool_name = event.tool || traceEntry.tool_name;
          traceEntry.step = event.step || traceEntry.step || 1;
          traceEntry.preview = event.preview || traceEntry.preview || "";
          traceEntry.state = "running";
          assistantTraceByKey[toolKey] = traceEntry;
          if (!assistantToolTrace.includes(traceEntry)) {
            assistantToolTrace.push(traceEntry);
          }
        }
        scrollToBottom();
      } else if (event.type === "tool_result") {
        const toolKey = event.call_id || event.tool || "__generic__";
        const itemRef = stepItems[toolKey];
        if (itemRef) {
          const normalizedSummary = normalizeToolSummary(event.summary);
          const durationMs = performance.now() - itemRef.startedAt;
          setToolStepState(itemRef.el, {
            toolName: event.tool || itemRef.toolName,
            preview: itemRef.preview,
            summary: normalizedSummary.text,
            state: normalizedSummary.isError ? "error" : "done",
            cached: normalizedSummary.cached,
            durationMs,
          });
          const traceEntry = assistantTraceByKey[toolKey] || {
            tool_name: event.tool || itemRef.toolName,
            step: event.step || latestStepInfo.step || 1,
            preview: itemRef.preview || "",
            summary: "",
            state: "done",
            cached: false,
          };
          traceEntry.tool_name = event.tool || traceEntry.tool_name;
          traceEntry.step = event.step || traceEntry.step || 1;
          traceEntry.preview = itemRef.preview || traceEntry.preview || "";
          traceEntry.summary = normalizedSummary.text;
          traceEntry.state = normalizedSummary.isError ? "error" : "done";
          traceEntry.cached = normalizedSummary.cached;
          assistantTraceByKey[toolKey] = traceEntry;
          if (!assistantToolTrace.includes(traceEntry)) {
            assistantToolTrace.push(traceEntry);
          }
          scrollToBottom();
        }
      } else if (event.type === "tool_error") {
        const toolKey = event.call_id || event.tool || "__generic__";
        let itemRef = stepItems[toolKey];
        if (!itemRef) {
          const sectionItems = ensureToolStepSection(
            stepLog,
            stepSections,
            event.step || latestStepInfo.step,
            latestStepInfo.maxSteps,
          );
          const item = createToolStepItem(event.tool);
          sectionItems.appendChild(item);
          itemRef = {
            el: item,
            toolName: event.tool,
            preview: "",
            startedAt: performance.now(),
          };
          stepItems[toolKey] = itemRef;
        }

        if (itemRef) {
          const durationMs = performance.now() - itemRef.startedAt;
          stepLog.style.display = "";
          setToolStepState(itemRef.el, {
            toolName: event.tool || itemRef.toolName,
            preview: itemRef.preview,
            summary: event.error || "Error",
            state: "error",
            durationMs,
          });
          if (event.tool) {
            const traceEntry = assistantTraceByKey[toolKey] || {
              tool_name: event.tool || itemRef.toolName,
              step: event.step || latestStepInfo.step || 1,
              preview: itemRef.preview || "",
              summary: "",
              state: "error",
              cached: false,
            };
            traceEntry.tool_name = event.tool || traceEntry.tool_name;
            traceEntry.step = event.step || traceEntry.step || 1;
            traceEntry.preview = itemRef.preview || traceEntry.preview || "";
            traceEntry.summary = event.error || "Error";
            traceEntry.state = "error";
            assistantTraceByKey[toolKey] = traceEntry;
            if (!assistantToolTrace.includes(traceEntry)) {
              assistantToolTrace.push(traceEntry);
            }
          }
        } else {
          const errItem = document.createElement("div");
          errItem.className = "step-item step-error";
          errItem.textContent = event.error || "Error";
          stepLog.style.display = "";
          stepLog.appendChild(errItem);
        }
        scrollToBottom();
      } else if (event.type === "answer_start") {
        clearAssistantLoadingBubble(asstBubble);
        asstBubble.classList.remove("thinking");
        asstBubble.classList.remove("cursor");
      } else if (event.type === "reasoning_start") {
        updateReasoningPanel(asstGroup, rawReasoning, { forceOpen: true, streaming: true });
        scrollToBottom();
      } else if (event.type === "reasoning_delta") {
        rawReasoning += event.text || "";
        scheduleReasoningRender();
      } else if (event.type === "answer_sync") {
        const syncedAnswer = String(event.text || "").trim();
        if (!syncedAnswer) {
          return;
        }
        rawAnswer = syncedAnswer;
        fullAnswer = rawAnswer;
        chatState.activeAssistantStreamingHasVisibleAnswer = true;
        flushAnswerRender();
        asstBubble.classList.remove("thinking");
        asstBubble.classList.remove("cursor");
        renderBubbleMarkdown(asstBubble, fullAnswer);
        scrollToBottom();
      } else if (event.type === "answer_delta") {
        rawAnswer += event.text || "";
        fullAnswer = rawAnswer;
        if (String(fullAnswer || "").trim()) {
          chatState.activeAssistantStreamingHasVisibleAnswer = true;
        }
        scheduleAnswerRender();
      } else if (event.type === "clarification_request") {
        pendingClarification = event.clarification && typeof event.clarification === "object" ? event.clarification : null;
        rawAnswer = String(event.text || "").trim();
        fullAnswer = rawAnswer;
        if (String(fullAnswer || "").trim()) {
          chatState.activeAssistantStreamingHasVisibleAnswer = true;
        }
        asstBubble.classList.remove("thinking");
        asstBubble.classList.remove("cursor");
        if (fullAnswer) {
          flushAnswerRender();
          renderBubbleMarkdown(asstBubble, fullAnswer);
        } else {
          asstBubble.remove();
        }
        scrollToBottom();
      } else if (event.type === "usage") {
        latestUsage = normalizeUsagePayload(event);
        updateStats(latestUsage, { replaceLast: hasLiveUsageTurn });
        hasLiveUsageTurn = true;
      } else if (event.type === "assistant_tool_results") {
        assistantToolResults = Array.isArray(event.tool_results) ? event.tool_results : [];
        updateAssistantFetchBadge(asstGroup, { tool_results: assistantToolResults });
        scrollToBottom();
      } else if (event.type === "assistant_sub_agent_traces") {
        assistantSubAgentTraces = Array.isArray(event.sub_agent_traces) ? event.sub_agent_traces : [];
        updateAssistantSubAgentTrace(asstGroup, { sub_agent_traces: assistantSubAgentTraces });
        scrollToBottom();
      } else if (event.type === "assistant_sub_agent_trace_update") {
        assistantSubAgentTraces = mergeAssistantSubAgentTraceEntry(assistantSubAgentTraces, event.entry);
        if (!chatState.activeAssistantStreamingHasVisibleAnswer && event.entry?.status === "running") {
          renderAssistantLoadingBubble(
            asstBubble,
            "Research agent is running…",
            String(event.entry?.task || event.entry?.summary || "").trim(),
          );
        }
        updateAssistantSubAgentTrace(asstGroup, { sub_agent_traces: assistantSubAgentTraces });
        scrollToBottom();
      } else if (event.type === "assistant_tool_history") {
        const nextToolHistory = Array.isArray(event.messages)
          ? event.messages.map(normalizeHistoryEntry).filter((item) => item.role === "assistant" || item.role === "tool")
          : [];
        assistantToolHistory.push(...nextToolHistory);
      } else if (event.type === "canvas_loading") {
        if (!isCanvasStreamingPreviewTool(event.tool, event)) {
          return;
        }
        const previewDocument = ensureStreamingCanvasPreview(event.tool, event.preview_key, event.snapshot);
        if (!isCanvasOpen()) {
          openCanvas(null, { focusPanel: false });
        } else {
          requestCanvasPanelRender({ deferForStreaming: false });
        }
        setCanvasStatus(getCanvasStreamingStatusMessage(event.tool, previewDocument, "loading"), "muted");
      } else if (event.type === "canvas_executing") {
        if (isCanvasStreamingPreviewTool(event.tool, event)) {
          const executingPreview = [...canvasState.streamingPreviews.values()][0] || null;
          setCanvasStatus(getCanvasStreamingStatusMessage(event.tool, executingPreview, "executing"), "muted");
        }
      } else if (event.type === "canvas_content_delta") {
        if (!isCanvasStreamingPreviewTool(event.tool, event)) {
          return;
        }
        const previewDocument = ensureStreamingCanvasPreview(event.tool, event.preview_key, event.snapshot);
        if (previewDocument) {
          queueStreamingCanvasPreviewDelta(previewDocument, event.delta, event.replace_content);
          if (!isCanvasOpen()) {
            openCanvas(null, { focusPanel: false });
          }
          setCanvasStatus(getCanvasStreamingStatusMessage(event.tool, previewDocument, "streaming"), "muted");
          scheduleCanvasPreviewRender();
        }
      } else if (event.type === "canvas_sync") {
        const previousDocuments = getCanvasDocumentCollection();
        const nextDocuments = Array.isArray(event.documents)
          ? event.documents.map((document) => normalizeCanvasDocument(document)).filter((document) => document.id)
          : [];
        const previousActiveId = String(canvasState.activeCanvasDocumentId || "").trim();
        const requestedActiveId = String(event.active_document_id || "").trim();
        const nextActiveCandidate = getCanvasDocumentById(nextDocuments, requestedActiveId)
          || getCanvasDocumentById(nextDocuments, previousActiveId)
          || nextDocuments[nextDocuments.length - 1]
          || null;
        const previousSelectedDocument = getCanvasDocumentById(previousDocuments, previousActiveId);
        const previousVersionOfNextDocument = getCanvasDocumentById(previousDocuments, nextActiveCandidate?.id || previousActiveId);
        const hadStreamingPreviewForDoc =
          nextActiveCandidate &&
          [...canvasState.streamingPreviews.values()].some((p) => p.id === nextActiveCandidate.id);
        resetStreamingCanvasPreview();
        canvasState.streamingCanvasDocuments = nextDocuments;
        if (canvasState.streamingCanvasDocuments.length) {
          canvasState.activeCanvasDocumentId = String(nextActiveCandidate?.id || "").trim() || canvasState.streamingCanvasDocuments[canvasState.streamingCanvasDocuments.length - 1].id;
          assistantCanvasActiveDocumentId = canvasState.activeCanvasDocumentId;
          assistantCanvasCleared = false;
          const shouldPrioritizeCommittedCanvasRender = hadStreamingPreviewForDoc || isCanvasOpen();
          requestCanvasPanelRender({ deferForStreaming: !shouldPrioritizeCommittedCanvasRender });
          const pendingCanvasRequest = attachmentState.pendingDocumentCanvasOpen;
          const canvasWasOpen = isCanvasOpen();
          const activeDocumentChangeMessage = describeCanvasActiveDocumentChange(previousSelectedDocument, nextActiveCandidate, requestedActiveId);
          if (pendingCanvasRequest) {
            consumePendingDocumentCanvasOpen();
          }

          if (pendingCanvasRequest && event.auto_open && !canvasWasOpen) {
            const requestLabel = Number(pendingCanvasRequest.fileCount || 1) > 1
              ? `${pendingCanvasRequest.fileCount} documents`
              : pendingCanvasRequest.fileName;
            openCanvas(null, { focusPanel: false });
            setCanvasStatus(`${requestLabel} opened in Canvas.`, "success");
          } else if (event.auto_open && !canvasWasOpen) {
            openCanvas(null, { focusPanel: false });
            setCanvasStatus(activeDocumentChangeMessage || "Canvas updated.", "success");
          } else if (activeDocumentChangeMessage) {
            if (canvasWasOpen) {
              setCanvasAttention(false);
              setCanvasStatus(activeDocumentChangeMessage || "Canvas updated.", "success");
            } else {
              setCanvasAttention(true);
              setCanvasStatus(activeDocumentChangeMessage, "muted");
            }
          } else if (isCanvasOpen()) {
            setCanvasAttention(false);
            setCanvasStatus("Canvas updated.", "success");
          } else {
            setCanvasAttention(true);
            setCanvasStatus("Canvas updated. Open the panel to review.", "success");
          }
        } else if (event.cleared) {
          canvasState.isCanvasEditing = false;
          canvasState.editingCanvasDocumentId = null;
          canvasState.activeCanvasDocumentId = null;
          assistantCanvasActiveDocumentId = null;
          assistantCanvasCleared = true;
          requestCanvasPanelRender({ deferForStreaming: true });
          if (isCanvasOpen()) {
            closeCanvas();
          }
          setCanvasAttention(false);
          setCanvasStatus("Canvas cleared.", "success");
        }
      } else if (event.type === "history_sync") {
        receivedHistorySync = true;
        chatState.history = Array.isArray(event.messages) ? event.messages.map(normalizeHistoryEntry) : [];
        canvasState.streamingCanvasDocuments = [];
        resetStreamingCanvasPreview();
        canvasState.activeCanvasDocumentId = getActiveCanvasDocument(chatState.history)?.id || null;
        rebuildTokenStatsFromHistory();
        renderConversationHistory();
        renderCanvasPanel();
      } else if (event.type === "conversation_summary_status") {
        summaryState.latestSummaryStatus = event && typeof event === "object" ? { ...event } : null;
      } else if (event.type === "conversation_summary_applied") {
        summaryState.latestSummaryStatus = event && typeof event === "object"
          ? { ...event, applied: true, reason: "applied", failure_stage: null, failure_detail: "Summary completed successfully." }
          : { applied: true, reason: "applied", failure_stage: null, failure_detail: "Summary completed successfully." };
        const coveredCount = Number(event.covered_message_count || 0);
        const mode = String(event.mode || "auto").trim() || "auto";
        const tokenCount = Number(event.visible_token_count || 0);
        const parts = [
          coveredCount > 0
            ? `${coveredCount} older message${coveredCount === 1 ? " was" : "s were"} summarized`
            : "Conversation summary updated",
        ];
        parts.push(`mode: ${mode}`);
        if (tokenCount > 0) {
          parts.push(`visible tokens: ${tokenCount}`);
        }
        showToast(parts.join(" • "), "success");
      } else if (event.type === "message_ids") {
        persistedMessageIds = event;
      } else if (event.type === "done") {
        // no-op
      }
    });

    if (pendingAnswerRenderTimer !== null) {
      flushAnswerRender();
    }
    if (pendingReasoningRenderTimer !== null) {
      flushReasoningRender();
    }
    attachmentState.pendingDocumentCanvasOpen = null;
    finalizeAssistantBubble(asstBubble, fullAnswer);
    const assistantEntry = buildAssistantEntry({
      content: fullAnswer,
      reasoning: rawReasoning,
      toolTrace: assistantToolTrace,
      toolResults: assistantToolResults,
      subAgentTraces: assistantSubAgentTraces,
      canvasDocuments: canvasState.streamingCanvasDocuments,
      activeDocumentId: assistantCanvasActiveDocumentId || canvasState.activeCanvasDocumentId,
      canvasCleared: assistantCanvasCleared,
      usage: latestUsage,
      pendingClarification: pendingClarification,
    });
    if (!receivedHistorySync) {
      chatState.history.push(...assistantToolHistory, assistantEntry);
      applyPersistedMessageIds(persistedMessageIds, assistantEntry);
    }
    saveAssistantReasoning(chatState.currentConvId, persistedMessageIds?.assistant_message_id || assistantEntry.id, rawReasoning);
    finalizeAssistantStreamingGroup(asstGroup, stepLog, assistantEntry.metadata);
    maybePromptToSaveSubAgentResearch(
      receivedHistorySync
        ? findPersistedAssistantEntryForSubAgentPrompt(persistedMessageIds?.assistant_message_id)
        : assistantEntry
    );
    clearEditTarget();

    if (shouldGenerateConversationTitle()) {
      generateTitle(chatState.currentConvId);
    } else {
      loadSidebar();
    }
    uiState.lastConversationSignature = getConversationSignature(chatState.history);
    scheduleConversationRefreshAfterStream();
    sendSucceeded = true;
  } catch (error) {
    sendErrorCode = String(error?.code || "").trim();
    const wasCancelledByUser = error?.name === "AbortError" && chatState.activeUserCancelRequested;
    if (pendingAnswerRenderTimer !== null) {
      flushAnswerRender();
    }
    if (pendingReasoningRenderTimer !== null) {
      flushReasoningRender();
    }
    attachmentState.pendingDocumentCanvasOpen = null;
    clearEmptyAssistantStreamingBubble();
    if (fullAnswer.trim() || rawReasoning.trim()) {
      finalizeAssistantBubble(asstBubble, fullAnswer);

      const assistantEntry = buildAssistantEntry({
        content: fullAnswer,
        reasoning: rawReasoning,
        toolTrace: assistantToolTrace,
        toolResults: assistantToolResults,
        subAgentTraces: assistantSubAgentTraces,
        canvasDocuments: canvasState.streamingCanvasDocuments,
        activeDocumentId: assistantCanvasActiveDocumentId || canvasState.activeCanvasDocumentId,
        canvasCleared: assistantCanvasCleared,
        usage: latestUsage,
        pendingClarification: pendingClarification,
      });
      if (!receivedHistorySync) {
        chatState.history.push(...assistantToolHistory, assistantEntry);
        applyPersistedMessageIds(persistedMessageIds, assistantEntry);
      }
      saveAssistantReasoning(chatState.currentConvId, persistedMessageIds?.assistant_message_id || assistantEntry.id, rawReasoning);
      finalizeAssistantStreamingGroup(asstGroup, stepLog, assistantEntry.metadata);
      maybePromptToSaveSubAgentResearch(
        receivedHistorySync
          ? findPersistedAssistantEntryForSubAgentPrompt(persistedMessageIds?.assistant_message_id)
          : assistantEntry
      );
      clearEditTarget();
      loadSidebar();

      if (wasCancelledByUser) {
        showToast("Response stopped. The saved portion was preserved…", "warning");
      } else if (error.name !== "AbortError") {
        showError("Connection was interrupted. The partial answer was preserved.");
      }
      uiState.lastConversationSignature = getConversationSignature(chatState.history);
      scheduleConversationRefreshAfterStream();
    } else {
      if (wasCancelledByUser) {
          showToast("Stopping response. Final state is being saved in the background…", "warning");
        scheduleConversationRefreshAfterStream();
      } else if (chatState.currentConvId) {
        await openConversation(chatState.currentConvId);
      } else {
        startNewChat();
      }
      if (!wasCancelledByUser && error.name !== "AbortError") {
        showError(error.message);
      }
    }
  } finally {
    if (chatState.activeChatCancellationFallbackTimer !== null) {
      window.clearTimeout(chatState.activeChatCancellationFallbackTimer);
      chatState.activeChatCancellationFallbackTimer = null;
    }
    if (chatState.activeChatRunId === streamRequestId) {
      chatState.activeChatRunId = null;
    }
    chatState.activeUserCancelRequested = false;
    chatState.activeAbortController = null;
    setStreaming(false);
    renderConversationHistory({ preserveScroll: true });
    resetAssistantStreamingBubbleState();
    refreshEditBanner();
    inputEl.focus();
  }

  return { ok: sendSucceeded, errorCode: sendErrorCode };
}
