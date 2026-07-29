// canvas/render.js — Panel render orchestration

let lastCanvasStructureSignature = "";
let lastCanvasDocListSignature = "";
let activeAnswerRenderPending = false;
const visionDisabledNoteEl = document.getElementById("vision-disabled-note");

function getCanvasDocuments(metadata) {
  if (!metadata || typeof metadata !== "object" || !Array.isArray(metadata.canvas_documents)) {
    return [];
  }

  return metadata.canvas_documents
    .map((document) => normalizeCanvasDocument(document))
    .filter((document) => document.id);
}

function getCanvasDocumentCollection(entries = chatState.history) {
  if (canvasState.streamingCanvasDocuments.length) {
    return canvasState.streamingCanvasDocuments;
  }

  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const message = entries[index];
    if (message?.metadata && message.metadata.canvas_cleared === true) {
      return [];
    }
    const documents = getCanvasDocuments(message?.metadata);
    if (!documents.length) {
      continue;
    }
    return documents;
  }

  return [];
}

function getCanvasRenderableDocuments(entries = chatState.history) {
  const documents = getCanvasDocumentCollection(entries);
  if (!canvasState.streamingPreviews.size) {
    return documents;
  }
  let result = [...documents];
  for (const preview of canvasState.streamingPreviews.values()) {
    if (!preview?.id) {
      continue;
    }
    const previewIndex = result.findIndex((document) => document.id === preview.id);
    if (previewIndex >= 0) {
      result = [...result.slice(0, previewIndex), preview, ...result.slice(previewIndex + 1)];
    } else {
      result = [...result, preview];
    }
  }
  return result;
}

function buildCanvasStructureSignature(documents, visibleDocuments = documents) {
  const documentSignature = (documents || []).map((document) => [
    String(document.id || "").trim(),
    String(document.title || "").trim(),
    String(document.path || "").trim(),
    String(document.role || "").trim(),
    String(document.format || "").trim(),
    String(document.language || "").trim(),
    document.isStreamingPreview ? "preview" : "stored",
  ].join("\u241f")).join("\u241e");
  const visibleSignature = (visibleDocuments || []).map((document) => String(document.id || "").trim()).join("\u241e");
  const filterSignature = [
    String(canvasSearchInput?.value || "").trim(),
    String(canvasRoleFilter?.value || "").trim(),
    getCanvasPathFilterValue(),
    canvasState.isCanvasEditing ? "editing" : "view",
  ].join("\u241f");
  return [documentSignature, visibleSignature, filterSignature].join("\u241d");
}

function buildCanvasRenderState(documents = getCanvasRenderableDocuments()) {
  const visibleDocuments = getCanvasVisibleDocuments(documents);
  const preferredActiveId = [
    String(canvasState.activeCanvasDocumentId || "").trim(),
    String(getCanvasPreferredActiveDocumentId() || "").trim(),
  ].find(Boolean) || "";
  const activeDocument = visibleDocuments.length
    ? getCanvasDocumentById(visibleDocuments, preferredActiveId) || visibleDocuments[visibleDocuments.length - 1]
    : null;

  return {
    isCanvasPanelOpen: isCanvasOpen(),
    documents,
    visibleDocuments,
    activeDocument,
    isStreamingPreviewActive: Boolean(activeDocument?.isStreamingPreview),
    searchTerm: String(canvasSearchInput?.value || "").trim(),
    structureSignature: buildCanvasStructureSignature(documents, visibleDocuments),
  };
}

function clearDeferredCanvasRenderFlushTimer() {
  if (!canvasState.pendingFlushTimer) {
    return;
  }

  globalThis.clearTimeout(canvasState.pendingFlushTimer);
  canvasState.pendingFlushTimer = 0;
}

function shouldDeferCanvasRenderForStreaming() {
  // If the Canvas panel is already open, prioritize keeping the live draft
  // visually up to date. We still throttle preview paints separately, so this
  // only disables the hard defer that can otherwise starve the Canvas preview
  // while answer frames keep arriving back-to-back.
  return Boolean(chatState.isStreaming && activeAnswerRenderPending && !isCanvasOpen());
}

function scheduleDeferredCanvasRenderFlush(delay = CANVAS_STREAMING_RENDER_DEFER_INTERVAL_MS) {
  if (canvasState.pendingFlushTimer) {
    return;
  }

  const nextDelay = Math.max(CANVAS_STREAMING_RENDER_DEFER_INTERVAL_MS, Number(delay) || 0);
  canvasState.pendingFlushTimer = globalThis.setTimeout(() => {
    canvasState.pendingFlushTimer = 0;
    flushDeferredCanvasRenderWork();
  }, nextDelay);
}

function flushDeferredCanvasRenderWork() {
  if (shouldDeferCanvasRenderForStreaming()) {
    scheduleDeferredCanvasRenderFlush();
    return;
  }

  if (canvasState.deferredPanelRender) {
    canvasState.resetDeferred();
    renderCanvasPanel();
    if (canvasState.streamingPreviews.size) {
      scheduleCanvasPreviewRender({ allowWhileAnswerPending: true });
    }
    return;
  }

  if (canvasState.deferredPreviewRender) {
    canvasState.deferredPreviewRender = false;
    scheduleCanvasPreviewRender({ allowWhileAnswerPending: true });
  }
}

function requestCanvasPanelRender({ deferForStreaming = false } = {}) {
  const shouldDelayPanelRender = deferForStreaming && chatState.isStreaming && (activeAnswerRenderPending || chatState.activeAssistantStreamingHasVisibleAnswer);
  if (shouldDelayPanelRender) {
    canvasState.deferredPanelRender = true;
    scheduleDeferredCanvasRenderFlush();
    return false;
  }

  canvasState.resetDeferred();
  renderCanvasPanel();
  return true;
}

function scheduleCanvasPreviewRender(options = {}) {
  const allowWhileAnswerPending = options.allowWhileAnswerPending === true;
  if (!allowWhileAnswerPending && shouldDeferCanvasRenderForStreaming()) {
    canvasState.deferredPreviewRender = true;
    scheduleDeferredCanvasRenderFlush();
    return;
  }

  if (chatState.isStreaming && chatState.activeAssistantStreamingHasVisibleAnswer && canvasState.lastPreviewRenderAt > 0) {
    const elapsedMs = Date.now() - canvasState.lastPreviewRenderAt;
    if (elapsedMs < CANVAS_STREAMING_PREVIEW_THROTTLE_MS) {
      canvasState.deferredPreviewRender = true;
      scheduleDeferredCanvasRenderFlush(CANVAS_STREAMING_PREVIEW_THROTTLE_MS - elapsedMs);
      return;
    }
  }

  canvasState.deferredPreviewRender = false;
  scheduleCanvasRenderJob("preview", () => {
    canvasState.lastPreviewRenderAt = Date.now();
    renderCanvasPreviewFrame();
    if (canvasState.deferredPanelRender || canvasState.deferredPreviewRender) {
      scheduleDeferredCanvasRenderFlush();
    }
  });
}

function getActiveCanvasDocument(entries = chatState.history) {
  const documents = getCanvasDocumentCollection(entries);
  if (!documents.length) {
    return null;
  }

  const preferredId = String(canvasState.activeCanvasDocumentId || getCanvasPreferredActiveDocumentId(entries) || "").trim();
  if (preferredId) {
    const matched = documents.find((document) => document.id === preferredId);
    if (matched) {
      return matched;
    }
  }

  return documents[documents.length - 1];
}

function setCanvasStatus(message, tone = "muted") {
  if (!canvasStatus) {
    return;
  }
  canvasStatus.textContent = String(message || "").trim() || "Canvas idle";
  canvasStatus.dataset.tone = tone;
}

function setCanvasSearchStatus(message, tone = "muted") {
  if (!canvasSearchStatus) {
    return;
  }

  const text = String(message || "").trim();
  canvasSearchStatus.dataset.tone = tone;
  canvasSearchStatus.hidden = !text;
  canvasSearchStatus.textContent = text;
}

function describeCanvasActiveDocumentChange(previousDocument, nextDocument, requestedDocumentId = "") {
  if (!nextDocument) {
    return "";
  }

  const previousId = String(previousDocument?.id || "").trim();
  const nextId = String(nextDocument.id || "").trim();
  const requestedId = String(requestedDocumentId || "").trim();
  const nextLabel = getCanvasDocumentDisplayName(nextDocument);
  if (requestedId && requestedId === nextId && requestedId !== previousId) {
    return `Active canvas switched to ${nextLabel}.`;
  }
  if (previousId && previousId !== nextId) {
    return `Previous active canvas is unavailable. Focus moved to ${nextLabel}.`;
  }
  return "";
}

function setCanvasHint(message, tone = "muted") {
  if (!canvasHint) {
    return;
  }

  const text = String(message || "").trim();
  if (!text) {
    canvasHint.hidden = true;
    canvasHint.textContent = "";
    canvasHint.dataset.tone = tone;
    return;
  }

  canvasHint.hidden = false;
  canvasHint.textContent = text;
  canvasHint.dataset.tone = tone;
}

function getCanvasFormatControlValue() {
  return canvasFormatSelect?.value === "code" ? "code" : "markdown";
}

function setCanvasEmptyState(stateKey = "no_documents") {
  if (!canvasEmptyState) {
    return;
  }

  const state = CANVAS_EMPTY_STATES[stateKey] || CANVAS_EMPTY_STATES.no_documents;
  canvasEmptyState.hidden = false;
  canvasEmptyState.replaceChildren();
  const titleEl = document.createElement("h3");
  titleEl.textContent = String(state.title || "").trim();
  const messageEl = document.createElement("p");
  messageEl.textContent = String(state.message || "").trim();
  canvasEmptyState.append(titleEl, messageEl);
}

function syncCanvasFormControls({
  formatDisabled = false,
  formatValue = null,
  searchDisabled = false,
  roleDisabled = false,
  pathDisabled = false,
} = {}) {
  const isBusy = isCanvasMutationPending();
  if (canvasFormatSelect) {
    canvasFormatSelect.disabled = formatDisabled || isBusy;
    if (formatValue !== null) {
      canvasFormatSelect.value = formatValue === "code" ? "code" : "markdown";
    }
  }
  if (canvasSearchInput) {
    canvasSearchInput.disabled = searchDisabled || isBusy;
  }
  if (canvasRoleFilter) {
    canvasRoleFilter.disabled = roleDisabled || isBusy;
  }
  if (canvasPathFilter) {
    canvasPathFilter.disabled = pathDisabled || isBusy;
  }
}

function syncCanvasActionButtons({
  hasDocuments = false,
  hasActiveDocument = false,
  isEditing = false,
  isStreamingPreviewActive = false,
  isPanelOpen = false,
  canEditDocument = false,
  canCopyDocument = false,
} = {}) {
  const isBusy = isCanvasMutationPending();
  setCanvasButtonState(canvasEditBtn, {
    hidden: isEditing,
    disabled: !hasActiveDocument || isStreamingPreviewActive || !canEditDocument || isBusy,
  });
  setCanvasButtonState(canvasNewBtn, {
    hidden: false,
    disabled: isStreamingPreviewActive || isBusy,
  });
  setCanvasButtonState(canvasUploadBtn, {
    hidden: false,
    disabled: isStreamingPreviewActive || isBusy,
  });
  setCanvasButtonState(canvasImportGithubBtn, {
    hidden: false,
    disabled: isStreamingPreviewActive || isBusy,
  });
  setCanvasButtonState(canvasSaveBtn, {
    hidden: !isEditing,
    disabled: !isEditing || isStreamingPreviewActive || !hasActiveDocument || isBusy,
  });
  setCanvasButtonState(canvasCancelBtn, {
    hidden: !isEditing,
    disabled: !isEditing || isStreamingPreviewActive || isBusy,
  });
  setCanvasButtonState(canvasCopyBtn, {
    hidden: !isPanelOpen || !hasActiveDocument,
    disabled: !hasActiveDocument || isEditing || !canCopyDocument || isBusy,
  });
  setCanvasButtonState(canvasDeleteBtn, {
    disabled: !hasActiveDocument || isStreamingPreviewActive || isBusy,
  });
  setCanvasButtonState(canvasRenameBtn, {
    disabled: !hasActiveDocument || isEditing || isStreamingPreviewActive || isBusy,
  });
  setCanvasButtonState(canvasClearBtn, {
    disabled: !hasDocuments || isStreamingPreviewActive || isBusy,
  });
  setCanvasButtonState(canvasDownloadHtmlBtn, {
    disabled: !hasActiveDocument || isStreamingPreviewActive || isBusy,
  });
  setCanvasButtonState(canvasDownloadMdBtn, {
    disabled: !hasActiveDocument || isStreamingPreviewActive || isBusy,
  });
  setCanvasButtonState(canvasDownloadPdfBtn, {
    disabled: !hasActiveDocument || isStreamingPreviewActive || isBusy,
  });
}

function resetCanvasContentDisplay({ clearEditorValue = true, clearTabs = true } = {}) {
  clearCanvasEditingPreviewRender();
  canvasState.isCanvasEditing = false;
  canvasState.editingCanvasDocumentId = null;
  canvasWorkspaceMain?.classList.remove("canvas-workspace-main--editing");

  if (canvasEditorEl) {
    canvasEditorEl.classList.remove("canvas-editor--editing");
    canvasEditorEl.hidden = true;
    if (clearEditorValue) {
      canvasEditorEl.value = "";
    }
  }

  if (canvasDocumentEl) {
    canvasDocumentEl.hidden = true;
    canvasDocumentEl.classList.remove("canvas-document--editing-preview");
    canvasDocumentEl.innerHTML = "";
  }

  if (clearTabs && canvasDocumentTabsEl) {
    canvasDocumentTabsEl.hidden = true;
    canvasDocumentTabsEl.innerHTML = "";
  }
}

function renderCanvasUnavailableState({
  subtitle,
  emptyStateKey,
  documents = [],
  isStreamingPreviewActive = false,
  enableFilters = false,
  clearSearchStatus = false,
} = {}) {
  resetCanvasMetaBar();
  if (canvasSubtitle) {
    canvasSubtitle.textContent = subtitle;
  }
  setCanvasHint("");
  if (clearSearchStatus) {
    setCanvasSearchStatus("");
  }
  setCanvasEmptyState(emptyStateKey);
  resetCanvasContentDisplay();
  syncCanvasFormControls({
    formatDisabled: isStreamingPreviewActive,
    formatValue: getCanvasFormatControlValue(),
    searchDisabled: !enableFilters,
    roleDisabled: !enableFilters,
    pathDisabled: !enableFilters,
  });
  syncCanvasActionButtons({
    hasDocuments: documents.length > 0,
    hasActiveDocument: false,
    isEditing: false,
    isStreamingPreviewActive,
    isPanelOpen: isCanvasOpen(),
    canEditDocument: false,
    canCopyDocument: false,
  });
  closeCanvasOverflowMenu();
}

function clearCanvasRenderJob(jobType) {
  const timer = jobType === "editing-preview" ? canvasState.pendingEditorPreviewTimer : canvasState.pendingPreviewTimer;
  if (!timer) {
    return;
  }
  if (typeof globalThis.cancelAnimationFrame === "function") {
    globalThis.cancelAnimationFrame(timer);
  } else {
    globalThis.clearTimeout(timer);
  }
  if (jobType === "editing-preview") {
    canvasState.pendingEditorPreviewTimer = 0;
    return;
  }
  canvasState.pendingPreviewTimer = 0;
}

function scheduleCanvasRenderJob(jobType, callback) {
  const isEditingPreviewJob = jobType === "editing-preview";
  if (isEditingPreviewJob ? canvasState.pendingEditorPreviewTimer : canvasState.pendingPreviewTimer) {
    return;
  }

  const flushRenderJob = () => {
    if (isEditingPreviewJob) {
      canvasState.pendingEditorPreviewTimer = 0;
    } else {
      canvasState.pendingPreviewTimer = 0;
    }
    callback();
  };

  const timer = typeof globalThis.requestAnimationFrame === "function"
    ? globalThis.requestAnimationFrame(flushRenderJob)
    : globalThis.setTimeout(flushRenderJob, CANVAS_PREVIEW_RENDER_INTERVAL_MS);

  if (isEditingPreviewJob) {
    canvasState.pendingEditorPreviewTimer = timer;
    return;
  }
  canvasState.pendingPreviewTimer = timer;
}

function clearCanvasEditingPreviewRender() {
  clearCanvasRenderJob("editing-preview");
}

function getCanvasEditingPreviewDocument(activeDocument = getActiveCanvasDocument()) {
  if (!activeDocument || !canvasState.isCanvasEditing || !canvasEditorEl) {
    return activeDocument;
  }

  const previewFormat = getCanvasFormatControlValue();
  return normalizeCanvasDocument({
    ...activeDocument,
    format: previewFormat,
    content: canvasEditorEl.value,
  }) || activeDocument;
}

function scheduleCanvasEditingPreviewRender() {
  if (!canvasState.isCanvasEditing) {
    return;
  }

  scheduleCanvasRenderJob("editing-preview", () => {
    if (!canvasState.isCanvasEditing) {
      return;
    }
    const renderState = buildCanvasRenderState();
    if (!renderState.activeDocument) {
      renderCanvasPanel();
      return;
    }
    updateCanvasActiveDocumentDisplay(renderState);
  });
}

function renderCanvasMetaBar(renderState) {
  if (!canvasMetaBar || !canvasMetaChips) {
    return;
  }

  const { activeDocument: baseActiveDocument, documents, isStreamingPreviewActive, visibleDocuments } = renderState;
  if (!baseActiveDocument || !(documents || []).length) {
    resetCanvasMetaBar();
    return;
  }

  const activeDocument = getCanvasEditingPreviewDocument(baseActiveDocument);

  const modeLabel = getCanvasMode(documents) === "project" ? "Project mode" : "Document mode";
  const countLabel = visibleDocuments.length === documents.length
    ? `${documents.length} file${documents.length === 1 ? "" : "s"}`
    : `${visibleDocuments.length}/${documents.length} shown`;
  const chips = [
    { label: modeLabel, className: "canvas-meta-chip canvas-meta-chip--primary" },
    { label: countLabel, className: "canvas-meta-chip" },
  ];

  if (isStreamingPreviewActive) {
    chips.push({ label: "Live preview", className: "canvas-meta-chip canvas-meta-chip--live" });
  }
  if (Number(activeDocument.page_count) > 1) {
    chips.push({ label: `${activeDocument.page_count} pages`, className: "canvas-meta-chip" });
  }
  if (activeDocument.role) {
    chips.push({ label: activeDocument.role, className: "canvas-meta-chip" });
  }
  chips.push({ label: activeDocument.format === "code" ? "Code" : "Markdown", className: "canvas-meta-chip" });
  if (activeDocument.language) {
    chips.push({ label: activeDocument.language, className: "canvas-meta-chip" });
  }

  const reference = getCanvasDocumentLabel(activeDocument);
  if (reference) {
    chips.push({
      label: reference,
      className: "canvas-meta-chip canvas-meta-chip--path",
      title: reference,
    });
  }

  canvasMetaChips.innerHTML = chips.map((chip) => {
    const titleAttr = chip.title ? ` title="${escHtml(chip.title)}"` : "";
    return `<span class="${chip.className}"${titleAttr}>${escHtml(chip.label)}</span>`;
  }).join("");

  // Always-expanded toggle
  const isAlwaysExpanded = Boolean(activeDocument.always_expanded);
  let expandToggleEl = canvasMetaBar.querySelector(".canvas-meta-expand-toggle");
  if (!expandToggleEl) {
    expandToggleEl = globalThis.document.createElement("button");
    expandToggleEl.className = "canvas-meta-expand-toggle";
    expandToggleEl.type = "button";
    expandToggleEl.addEventListener("click", () => {
      const currentActiveDocument = getCanvasEditingPreviewDocument(getActiveCanvasDocument());
      toggleCanvasAlwaysExpanded(currentActiveDocument);
    });
    canvasMetaBar.appendChild(expandToggleEl);
  }
  expandToggleEl.textContent = isAlwaysExpanded ? "⊛ Always expanded" : "⊙ Always expanded";
  expandToggleEl.title = isAlwaysExpanded
    ? "AI always receives the full document. Click to disable."
    : "Enable so the AI always receives the full document content without truncation.";
  expandToggleEl.classList.toggle("canvas-meta-expand-toggle--on", isAlwaysExpanded);

  canvasMetaBar.hidden = false;

  if (canvasCopyRefBtn) {
    canvasCopyRefBtn.disabled = !reference;
    canvasCopyRefBtn.textContent = activeDocument.path ? "Copy path" : "Copy title";
  }
  if (canvasResetFiltersBtn) {
    canvasResetFiltersBtn.disabled = !hasActiveCanvasFilters();
  }
}

function renderCanvasDocumentTabs(visibleDocuments, allDocuments) {
  if (!canvasDocumentTabsEl) {
    return;
  }

  // In project mode the tree panel already handles navigation.
  // Show tabs only when there are a small number of files without paths.
  const isProjectMode = getCanvasMode(allDocuments || visibleDocuments) === "project";
  const MAX_FLAT_TABS = 8;
  if (isProjectMode || visibleDocuments.length <= 1 || visibleDocuments.length > MAX_FLAT_TABS) {
    canvasDocumentTabsEl.hidden = true;
    canvasDocumentTabsEl.innerHTML = "";
    return;
  }

  canvasDocumentTabsEl.hidden = false;
  canvasDocumentTabsEl.innerHTML = "";
  visibleDocuments.forEach((entry) => {
    const button = globalThis.document.createElement("button");
    button.type = "button";
    button.className = `canvas-document-tab${entry.id === canvasState.activeCanvasDocumentId ? " active" : ""}`;
    button.textContent = getCanvasFileName(entry);
    button.title = `${getCanvasDocumentLabel(entry)} · ${entry.line_count} lines`;
    button.disabled = canvasState.isCanvasEditing && entry.id !== canvasState.activeCanvasDocumentId;
    button.addEventListener("click", () => {
      canvasState.activeCanvasDocumentId = entry.id;
      renderCanvasPanel();
    });
    canvasDocumentTabsEl.appendChild(button);
  });
}

function updateCanvasActiveDocumentDisplay(renderState) {
  const {
    activeDocument,
    documents,
    isCanvasPanelOpen,
    isStreamingPreviewActive,
    searchTerm,
    visibleDocuments,
  } = renderState;

  const displayDocument = getCanvasEditingPreviewDocument(activeDocument);
  canvasState.activeCanvasDocumentId = activeDocument.id;
  canvasWorkspaceMain?.classList.toggle("canvas-workspace-main--editing", Boolean(canvasState.isCanvasEditing));
  const modeLabel = getCanvasMode(documents) === "project" ? "Project mode" : "Document mode";
  const detailLabel = displayDocument.path || displayDocument.title;
  const pageLabel = Number(displayDocument.page_count) > 1 ? ` · ${displayDocument.page_count} pages` : "";
  const roleLabel = displayDocument.role ? ` · ${displayDocument.role}` : "";
  const languageLabel = displayDocument.language ? ` · ${displayDocument.language}` : "";
  canvasSubtitle.textContent = `${modeLabel} · ${visibleDocuments.length}/${documents.length} files · ${detailLabel} · ${displayDocument.line_count} lines${pageLabel}${roleLabel}${languageLabel}`;
  renderCanvasMetaBar(renderState);
  const promptLineLimit = Number(appSettings.canvas_prompt_max_lines || 250);
  if (isStreamingPreviewActive) {
    const previewTool = String(displayDocument.tool || "").trim();
    setCanvasHint(
      CANVAS_EDIT_PREVIEW_TOOLS.has(previewTool)
        ? "Live Canvas edit preview. The preview updates as tool arguments stream in and is replaced by the committed document when the tool finishes."
        : "Live Canvas preview. The preview updates as the assistant streams content and is replaced by the committed document when the tool finishes.",
      "muted"
    );
  } else if (canvasState.isCanvasEditing) {
    setCanvasHint("Edit mode. Make changes and save to commit.", "muted");
  } else if (Number.isFinite(displayDocument.line_count) && displayDocument.line_count > promptLineLimit) {
    setCanvasHint(
      `Large canvas detected. The default view is truncated to the first ${promptLineLimit} lines. Use batch_read_canvas_documents with start_line and end_line for targeted ranges, or create_or_edit_canvas_document with action: "replace_all" to rewrite the entire document.`,
      "warning"
    );
  } else {
    setCanvasHint("");
  }
  canvasEmptyState.hidden = true;
  syncCanvasFormControls({
    formatDisabled: !canvasState.isCanvasEditing || isStreamingPreviewActive,
    formatValue: displayDocument.format || "markdown",
    searchDisabled: canvasState.isCanvasEditing || isStreamingPreviewActive,
    roleDisabled: canvasState.isCanvasEditing || isStreamingPreviewActive,
    pathDisabled: canvasState.isCanvasEditing || isStreamingPreviewActive,
  });

  if (canvasState.isCanvasEditing && canvasEditorEl) {
    if (canvasState.editingCanvasDocumentId !== activeDocument.id) {
      canvasState.editingCanvasDocumentId = activeDocument.id;
      canvasEditorEl.value = activeDocument.content || "";
    }
    canvasEditorEl.classList.add("canvas-editor--editing");
    canvasEditorEl.hidden = false;
    canvasDocumentEl.hidden = true;
  } else {
    canvasDocumentEl.classList.remove("canvas-document--editing-preview");
    canvasDocumentEl.hidden = false;
    if (activeDocument.isStreamingPreview) {
      const existingPreviewEl = canvasDocumentEl.querySelector('[data-canvas-streaming-preview-container="true"]');
      const existingPreviewId = String(existingPreviewEl?.getAttribute("data-canvas-streaming-preview-id") || "").trim();
      const existingPreviewFormat = String(existingPreviewEl?.getAttribute("data-canvas-streaming-preview-format") || "").trim();
      const nextPreviewId = String(activeDocument.id || "").trim();
      const nextPreviewFormat = String(activeDocument.format || "markdown").trim().toLowerCase() || "markdown";
      if (existingPreviewEl && existingPreviewId === nextPreviewId && existingPreviewFormat === nextPreviewFormat) {
        updateStreamingCanvasPreviewElement(existingPreviewEl, activeDocument);
      } else {
        canvasDocumentEl.innerHTML = renderStreamingCanvasDocumentBody(activeDocument);
      }
    } else {
      canvasDocumentEl.innerHTML = renderCanvasDocumentBody(activeDocument);
      bindCanvasPageNavigation(activeDocument);
    }
    if (canvasEditorEl) {
      canvasEditorEl.classList.remove("canvas-editor--editing");
      canvasEditorEl.hidden = true;
    }
  }

  const matchCount = !canvasState.isCanvasEditing && !isStreamingPreviewActive ? applyCanvasSearchHighlight(searchTerm) : 0;
  updateCanvasSearchFeedback(renderState, matchCount);
  const copySourceText = canvasState.isCanvasEditing && canvasEditorEl ? canvasEditorEl.value : displayDocument.content;
  syncCanvasActionButtons({
    hasDocuments: documents.length > 0,
    hasActiveDocument: Boolean(activeDocument),
    isEditing: canvasState.isCanvasEditing,
    isStreamingPreviewActive,
    isPanelOpen: isCanvasPanelOpen,
    canEditDocument: isCanvasDocumentEditable(displayDocument),
    canCopyDocument: Boolean(String(copySourceText || "").length),
  });
  closeCanvasOverflowMenu();
}

function buildCanvasDocListSignature(documents) {
  // A lightweight signature that only tracks document-list structure (IDs and
  // stored-vs-preview status). Used by renderCanvasPreviewFrame to distinguish
  // real structural changes (add/remove document) from streaming-preview metadata
  // changes (title, format, language updating as the model streams JSON fields).
  return (documents || [])
    .map((d) => `${String(d.id || "").trim()}\u241f${d.isStreamingPreview ? "preview" : "stored"}`)
    .join("\u241e");
}

function renderCanvasPreviewFrame() {
  if (!canvasDocumentEl || !canvasEmptyState || !canvasSubtitle) {
    return;
  }

  flushStreamingCanvasPreviewDeltas();
  const renderState = buildCanvasRenderState();
  if (!renderState.documents.length || !renderState.activeDocument || canvasState.isCanvasEditing || !renderState.isStreamingPreviewActive) {
    renderCanvasPanel();
    return;
  }

  if (renderState.structureSignature !== lastCanvasStructureSignature) {
    // Determine whether the signature change reflects a real structural change
    // (document added or removed) or merely metadata updates on the streaming
    // preview (title / format / language arriving as the model streams the JSON
    // argument fields). Real structural changes require a full panel rebuild for
    // the tree, tabs, and filter controls. Metadata-only changes can go through
    // the fast-path DOM update used for every other preview frame — the content
    // renderer already handles format/language transitions correctly.
    const currentDocListSig = buildCanvasDocListSignature(renderState.documents);
    if (currentDocListSig !== lastCanvasDocListSignature) {
      // Document list changed — full panel rebuild required.
      lastCanvasDocListSignature = currentDocListSig;
      renderCanvasPanel();
      return;
    }
    // Only metadata changed. Keep the full signature in sync so the next frame
    // still detects real structural changes, then fall through to the fast path.
    lastCanvasStructureSignature = renderState.structureSignature;
  }

  updateCanvasActiveDocumentDisplay(renderState);
}

function renderCanvasPanel() {
  if (!canvasDocumentEl || !canvasEmptyState || !canvasSubtitle) {
    return;
  }

  syncCanvasViewportControls();

  flushStreamingCanvasPreviewDeltas();
  const documents = getCanvasRenderableDocuments();
  syncCanvasFilterControls(documents);
  const renderState = buildCanvasRenderState(documents);
  const {
    activeDocument,
    documents: renderDocuments,
    isStreamingPreviewActive,
    visibleDocuments,
  } = renderState;
  lastCanvasStructureSignature = renderState.structureSignature;
  lastCanvasDocListSignature = buildCanvasDocListSignature(renderDocuments);

  renderCanvasTree(renderDocuments, activeDocument);
  if (!renderDocuments.length) {
    renderCanvasUnavailableState({
      subtitle: "No canvas document yet.",
      emptyStateKey: "no_documents",
      documents: renderDocuments,
      isStreamingPreviewActive,
      enableFilters: false,
      clearSearchStatus: true,
    });
    syncCanvasViewportControls();
    return;
  }

  if (!activeDocument) {
    const modeLabel = getCanvasMode(renderDocuments) === "project" ? "Project mode" : "Document mode";
    renderCanvasUnavailableState({
      subtitle: `${modeLabel} · ${renderDocuments.length} file${renderDocuments.length === 1 ? "" : "s"} · no matches`,
      emptyStateKey: "no_matches",
      documents: renderDocuments,
      isStreamingPreviewActive,
      enableFilters: true,
    });
    updateCanvasSearchFeedback(renderState, 0);
    syncCanvasViewportControls();
    return;
  }

  updateCanvasActiveDocumentDisplay(renderState);
  renderCanvasDocumentTabs(visibleDocuments, renderDocuments);
  syncCanvasViewportControls();
}

function openCanvas(triggerEl = null, options = {}) {
  const shouldFocusPanel = options.focusPanel !== false;
  closeSummaryPanel();
  
  closeMobileTools();
  closeCanvasConfirmModal("cancel", false);
  closeStats();
  closeExportPanel();
  closeSidebarOnMobile();
  canvasPanel?.classList.add("open");
  canvasOverlay?.classList.add("open");
  canvasPanel?.setAttribute("aria-hidden", "false");
  syncCanvasToggleButton();
  canvasState.lastCanvasTriggerEl = triggerEl instanceof HTMLElement
    ? triggerEl
    : (document.activeElement instanceof HTMLElement ? document.activeElement : mobileToolsBtn);
  setCanvasAttention(false);
  setCanvasMobileTreeOpen(false);
  applyCanvasPanelWidth(readCanvasWidthPreference(), false);
  closeCanvasOverflowMenu();
  requestCanvasPanelRender({ deferForStreaming: options.deferPanelRender !== false });
  syncCanvasViewportControls();
  if (shouldFocusPanel) {
    canvasClose?.focus();
  }
}

function closeCanvas() {
  clearCanvasEditingPreviewRender();
  canvasState.isCanvasEditing = false;
  canvasState.editingCanvasDocumentId = null;
  canvasWorkspaceMain?.classList.remove("canvas-workspace-main--editing");
  canvasEditorEl?.classList.remove("canvas-editor--editing");
  canvasDocumentEl?.classList.remove("canvas-document--editing-preview");
  setCanvasMobileTreeOpen(false);
  uiState.isCanvasFullscreen = false;
  canvasPanel?.classList.remove("open");
  canvasOverlay?.classList.remove("open");
  canvasPanel?.setAttribute("aria-hidden", "true");
  closeCanvasOverflowMenu();
  syncCanvasToggleButton();
  syncCanvasViewportControls();
  if (canvasCopyBtn) {
    canvasCopyBtn.hidden = true;
  }
  if (canvasState.lastCanvasTriggerEl && typeof canvasState.lastCanvasTriggerEl.focus === "function") {
    canvasState.lastCanvasTriggerEl.focus();
  }
}

function setCanvasMobileTreeOpen(isOpen) {
  const shouldOpen = Boolean(canToggleCanvasTreeOnMobile() && isOpen);
  uiState.isCanvasMobileTreeOpen = shouldOpen;
  canvasPanel?.classList.toggle("canvas-panel--tree-open", shouldOpen);
  syncCanvasTreeToggleButton();
}

function getCanvasFocusableElements() {
  if (!canvasPanel) {
    return [];
  }
  return Array.from(
    canvasPanel.querySelectorAll(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  ).filter((element) => !element.hasAttribute("hidden") && element.getAttribute("aria-hidden") !== "true");
}

function setCanvasAttention(enabled) {
  canvasState.canvasHasUnreadUpdates = Boolean(enabled);
  if (canvasBtnIndicator) {
    canvasBtnIndicator.hidden = !canvasState.canvasHasUnreadUpdates;
  }
}

function isCanvasOpen() {
  return Boolean(canvasPanel?.classList.contains("open"));
}

function syncCanvasToggleButton() {
  if (!canvasToggleBtn) {
    return;
  }
  canvasToggleBtn.setAttribute("aria-expanded", String(isCanvasOpen()));
}

function canToggleCanvasTreeOnMobile() {
  return Boolean(isMobileViewport() && canvasTreePanel && !canvasTreePanel.hidden);
}

function syncCanvasTreeToggleButton() {
  if (!canvasTreeToggleBtn) {
    return;
  }
  const isAvailable = canToggleCanvasTreeOnMobile();
  if (!isAvailable) {
    uiState.isCanvasMobileTreeOpen = false;
    canvasPanel?.classList.remove("canvas-panel--tree-open");
  }
  canvasTreeToggleBtn.hidden = !isAvailable;
  canvasTreeToggleBtn.setAttribute("aria-expanded", isAvailable && uiState.isCanvasMobileTreeOpen ? "true" : "false");
  canvasTreeToggleBtn.textContent = isAvailable && uiState.isCanvasMobileTreeOpen ? "Hide files" : "Files";
}
