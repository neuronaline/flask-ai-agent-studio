// message/streaming.js — NDJSON stream parsing, bubble creation

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
