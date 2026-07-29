// canvas/streaming.js — Streaming preview rendering & delta queue

function isCanvasStreamingPreviewTool(toolName, eventPayload = null) {
  if (CANVAS_STREAMING_PREVIEW_TOOLS.has(String(toolName || "").trim())) {
    return true;
  }

  if (!eventPayload || typeof eventPayload !== "object") {
    return false;
  }

  return Boolean(
    String(eventPayload.preview_key || "").trim()
    || (eventPayload.snapshot && typeof eventPayload.snapshot === "object")
    || typeof eventPayload.delta === "string"
    || Object.prototype.hasOwnProperty.call(eventPayload, "replace_content")
  );
}

function getCanvasStreamingPreviewLabel(document) {
  return getCanvasDocumentDisplayName(document) || "Canvas";
}

function getStreamingCanvasPreviewLabel(document) {
  const format = getStreamingCanvasPreviewFormat(document);
  if (format === "code") {
    return String(document?.language || "Code draft").trim() || "Code draft";
  }
  return "Markdown draft";
}

function getCanvasStreamingStatusMessage(toolName, document, phase = "loading") {
  const normalizedToolName = String(toolName || "").trim();
  const label = getCanvasStreamingPreviewLabel(document);
  if (phase === "streaming") {
    if (normalizedToolName === "create_canvas_document") {
      return `Drafting ${label} live...`;
    }
    if (CANVAS_EDIT_PREVIEW_TOOLS.has(normalizedToolName)) {
      return `Previewing edits in ${label}...`;
    }
    return `Updating ${label} live...`;
  }
  if (phase === "executing") {
    if (normalizedToolName === "create_canvas_document") return `Creating ${label}...`;
    if (CANVAS_EDIT_PREVIEW_TOOLS.has(normalizedToolName)) return `Applying edits to ${label}...`;
    return `Updating ${label}...`;
  }
  if (normalizedToolName === "create_canvas_document") {
    return `Preparing live draft for ${label}...`;
  }
  if (CANVAS_EDIT_PREVIEW_TOOLS.has(normalizedToolName)) {
    return `Preparing live edit preview for ${label}...`;
  }
  return `Preparing live Canvas preview for ${label}...`;
}

function normalizeStreamingCanvasPreviewDocument(document) {
  const normalized = normalizeCanvasDocument(document);
  if (!normalized) {
    return null;
  }
  if (shouldRenderCanvasAsCode(normalized)) {
    normalized.format = "code";
  }
  if (document?.isStreamingPreview && isGenericStreamingCanvasPreviewTitle(normalized.title)) {
    const inferredTitle = inferStreamingCanvasPreviewTitleFromContent(normalized.content);
    if (inferredTitle) {
      normalized.title = inferredTitle;
    }
  }
  return normalized;
}

function isGenericStreamingCanvasPreviewTitle(title) {
  const normalizedTitle = String(title || "").trim().toLowerCase();
  return normalizedTitle === "canvas draft" || normalizedTitle === "canvas" || normalizedTitle === "untitled";
}

function inferStreamingCanvasPreviewTitleFromContent(content) {
  const normalizedContent = String(content || "").replace(/\r\n?/g, "\n");
  if (!normalizedContent) {
    return "";
  }

  const headingMatch = normalizedContent.match(/^#\s+(.+?)\s*$/m);
  if (!headingMatch) {
    return "";
  }

  return String(headingMatch[1] || "").trim().slice(0, 160);
}

function getStreamingCanvasPreviewFormat(document) {
  return document?.format === "code" ? "code" : "markdown";
}

function getStreamingCanvasPreviewLanguage(document) {
  return String(document?.language || "").trim().toLowerCase();
}

function getStreamingCanvasCodePreviewClassName(document) {
  const language = getStreamingCanvasPreviewLanguage(document);
  return `canvas-stream-code${language ? ` language-${language}` : ""}`;
}

function getStreamingCanvasPreviewText(document) {
  return String(document?.content || "").replace(/\r\n?/g, "\n");
}

function getStreamingCanvasPreviewPlaceholder(document) {
  return getStreamingCanvasPreviewFormat(document) === "code"
    ? "// Streaming code draft will appear here..."
    : "Streaming draft will appear here...";
}

function getStreamingCanvasPreviewDisplayText(document) {
  return getStreamingCanvasPreviewText(document) || getStreamingCanvasPreviewPlaceholder(document);
}

function getStreamingCanvasPreviewRenderMode(document) {
  const format = getStreamingCanvasPreviewFormat(document);
  if (format === "code") {
    return "code";
  }

  const previewText = getStreamingCanvasPreviewDisplayText(document);
  const storedLineCount = Number(document?.line_count);
  const lineCount = Number.isFinite(storedLineCount) && storedLineCount > 0
    ? storedLineCount
    : countCanvasLines(previewText);

  if (
    previewText.length > STREAMING_CANVAS_MARKDOWN_PLAIN_TEXT_CHAR_LIMIT
    || lineCount > STREAMING_CANVAS_MARKDOWN_PLAIN_TEXT_LINE_LIMIT
  ) {
    return "markdown-plain";
  }

  return "markdown";
}

function renderStreamingCanvasPreviewBody(document) {
  const previewText = getStreamingCanvasPreviewDisplayText(document);
  const renderMode = getStreamingCanvasPreviewRenderMode(document);
  if (renderMode === "code") {
    const codeClassName = getStreamingCanvasCodePreviewClassName(document);
    return `<pre class="canvas-stream-code-block"><code class="${escHtml(codeClassName)}">${escHtml(previewText)}</code></pre>`;
  }
  if (renderMode === "markdown-plain") {
    return `<pre class="canvas-stream-markdown-block"><code class="canvas-stream-markdown-text">${escHtml(previewText)}</code></pre>`;
  }
  return renderStreamingMarkdown(previewText);
}

function renderStreamingCanvasPreviewContent(document) {
  const format = getStreamingCanvasPreviewFormat(document);
  const renderMode = getStreamingCanvasPreviewRenderMode(document);
  return `<div class="canvas-stream-preview canvas-stream-preview--${format} canvas-stream-preview--${renderMode}" data-canvas-streaming-preview-body="true" data-canvas-streaming-preview-mode="${renderMode}">${renderStreamingCanvasPreviewBody(document)}</div>`;
}

function updateStreamingCanvasPreviewElement(containerEl, document) {
  if (!containerEl) {
    return;
  }

  const previewBody = containerEl.querySelector('[data-canvas-streaming-preview-body="true"]');
  if (!previewBody) {
    containerEl.innerHTML = renderStreamingCanvasPreviewContent(document);
    return;
  }

  const format = getStreamingCanvasPreviewFormat(document);
  const renderMode = getStreamingCanvasPreviewRenderMode(document);
  const previewText = getStreamingCanvasPreviewDisplayText(document);
  const previousRenderMode = String(previewBody.getAttribute("data-canvas-streaming-preview-mode") || "").trim();

  previewBody.className = `canvas-stream-preview canvas-stream-preview--${format} canvas-stream-preview--${renderMode}`;
  previewBody.setAttribute("data-canvas-streaming-preview-mode", renderMode);

  if (renderMode === "code" && previousRenderMode === renderMode) {
    const codeEl = previewBody.querySelector(".canvas-stream-code");
    if (codeEl) {
      codeEl.className = getStreamingCanvasCodePreviewClassName(document);
      codeEl.textContent = previewText;
      return;
    }
  }

  if (renderMode === "markdown-plain" && previousRenderMode === renderMode) {
    const previewTextEl = previewBody.querySelector(".canvas-stream-markdown-text");
    if (previewTextEl) {
      previewTextEl.textContent = previewText;
      return;
    }
  }

  previewBody.innerHTML = renderStreamingCanvasPreviewBody(document);
}

function renderStreamingCanvasDocumentBody(document) {
  const documentId = escHtml(String(document?.id || "").trim());
  const format = escHtml(String(document?.format || "markdown").trim().toLowerCase() || "markdown");
  return renderCanvasMarkdownSheet(renderStreamingCanvasPreviewContent(document), {
    extraClasses: ["canvas-page-sheet--streaming"],
    attributes: {
      "data-canvas-streaming-preview-container": "true",
      "data-canvas-streaming-preview-id": documentId,
      "data-canvas-streaming-preview-format": format,
    },
  });
}

function renderCanvasDocumentBody(document) {
  if (!document) {
    return "";
  }
  if (document.isStreamingPreview) {
    return renderStreamingCanvasDocumentBody(document);
  }
  if (document.format === "code") {
    return sanitizeHtml(`<div class="canvas-code-document">${renderHighlightedCodeBlock(document.content, document.language || null)}</div>`);
  }
  if (!isCanvasPageAwareDocument(document)) {
    return renderCanvasMarkdownSheet(renderMarkdown(document.content));
  }
  const currentPage = getCanvasCurrentPage(document) || setCanvasCurrentPage(document, 1);
  const currentSection = getCanvasPageSection(document, currentPage);
  const markdownHtml = renderMarkdown(currentSection?.content || document.content);
  return (
    `<div class="canvas-document-shell">` +
      `<div class="canvas-page-nav" data-canvas-page-nav>` +
        `<button type="button" class="canvas-page-nav__button" data-canvas-page-action="prev" aria-label="Previous page">←</button>` +
        `<div class="canvas-page-nav__status" data-canvas-page-label>Page ${currentPage} / ${document.page_count}</div>` +
        `<button type="button" class="canvas-page-nav__button" data-canvas-page-action="next" aria-label="Next page">→</button>` +
      `</div>` +
      `<div class="canvas-page-content"><article class="canvas-page-sheet" data-canvas-page-sheet data-canvas-page-number="${currentPage}">${markdownHtml}</article></div>` +
    `</div>`
  );
}

function queueStreamingCanvasPreviewDelta(previewDocument, delta, replaceContent = false) {
  if (!previewDocument) {
    return false;
  }

  const nextDelta = String(delta || "");
  if (!replaceContent && !nextDelta) {
    return false;
  }

  if (replaceContent) {
    previewDocument.pendingContentReplacement = nextDelta;
    previewDocument.pendingContentAppends = [];
    return true;
  }

  if (!Array.isArray(previewDocument.pendingContentAppends)) {
    previewDocument.pendingContentAppends = [];
  }
  previewDocument.pendingContentAppends.push(nextDelta);
  return true;
}

function flushStreamingCanvasPreviewDelta(previewDocument) {
  if (!previewDocument || typeof previewDocument !== "object") {
    return false;
  }

  const hasReplacement = Object.prototype.hasOwnProperty.call(previewDocument, "pendingContentReplacement");
  const replacementContent = hasReplacement ? String(previewDocument.pendingContentReplacement || "") : "";
  const appendedContent = Array.isArray(previewDocument.pendingContentAppends)
    ? previewDocument.pendingContentAppends.join("")
    : "";
  if (!hasReplacement && !appendedContent) {
    return false;
  }

  const previousContent = String(previewDocument.content || "");
  let nextContent = hasReplacement ? replacementContent : previousContent;
  if (appendedContent) {
    nextContent += appendedContent;
  }
  previewDocument.content = nextContent;

  if (!nextContent) {
    previewDocument.line_count = 0;
  } else if (hasReplacement || !previousContent) {
    previewDocument.line_count = countCanvasLines(nextContent);
  } else {
    const currentLineCount = Number.isFinite(Number(previewDocument.line_count)) && Number(previewDocument.line_count) > 0
      ? Number(previewDocument.line_count)
      : countCanvasLines(previousContent);
    previewDocument.line_count = currentLineCount + countCanvasNewlines(appendedContent);
  }

  delete previewDocument.pendingContentReplacement;
  previewDocument.pendingContentAppends = [];
  return true;
}

function flushStreamingCanvasPreviewDeltas() {
  let changed = false;
  canvasState.streamingPreviews.forEach((previewDocument) => {
    if (flushStreamingCanvasPreviewDelta(previewDocument)) {
      changed = true;
    }
  });
  return changed;
}

function buildStreamingCanvasPreviewDocument(toolName, previewKey = "", snapshot = {}) {
  const normalizedToolName = String(toolName || "").trim();
  const normalizedPreviewKey = String(previewKey || "").trim() || "canvas-call-0";
  const snapshotData = snapshot && typeof snapshot === "object" ? snapshot : {};
  const allDocuments = getCanvasDocumentCollection(chatState.history);
  const activeDocument = getActiveCanvasDocument(chatState.history);

  // For edit operations, prefer the document explicitly identified in the
  // snapshot over the generic active doc.
  const needsTargetDoc = CANVAS_EDIT_PREVIEW_TOOLS.has(normalizedToolName);
  let targetDocument = activeDocument;
  if (needsTargetDoc) {
    const snapshotDocId = String(snapshotData.document_id || "").trim();
    const snapshotDocPath = String(snapshotData.document_path || "").trim();
    if (snapshotDocId) {
      targetDocument = getCanvasDocumentById(allDocuments, snapshotDocId) || activeDocument;
    } else if (snapshotDocPath) {
      targetDocument = allDocuments.find((d) => d.path === snapshotDocPath) || activeDocument;
    }
  }

  const isEditPreview = CANVAS_EDIT_PREVIEW_TOOLS.has(normalizedToolName) && targetDocument;
  const baseDocument = isEditPreview ? targetDocument : null;
  const normalized = normalizeStreamingCanvasPreviewDocument({
    id: baseDocument ? baseDocument.id : `streaming-canvas-preview-${normalizedPreviewKey}`,
    title: String(snapshotData.title || (baseDocument ? baseDocument.title : "Canvas draft")).trim() || "Canvas draft",
    path: String(snapshotData.path || (baseDocument ? baseDocument.path : "")).trim(),
    role: String(snapshotData.role || (baseDocument ? baseDocument.role : "note")).trim(),
    summary: baseDocument ? String(baseDocument.summary || "") : "",
    format: String(snapshotData.format || (baseDocument ? baseDocument.format : "markdown")).trim() || "markdown",
    language: String(snapshotData.language || (baseDocument ? baseDocument.language : "")).trim(),
    content: isEditPreview ? String(targetDocument.content || "") : "",
    source_message_id: baseDocument ? baseDocument.source_message_id : null,
  });
  return normalized ? { ...normalized, isStreamingPreview: true, tool: normalizedToolName, previewKey: normalizedPreviewKey } : null;
}

function applyStreamingCanvasPreviewSnapshot(previewDoc, snapshot = {}) {
  if (!previewDoc || !snapshot || typeof snapshot !== "object") {
    return false;
  }
  let changed = false;
  if (typeof snapshot.title === "string" && snapshot.title.trim()) {
    const nextTitle = snapshot.title.trim();
    if (nextTitle !== previewDoc.title) {
      previewDoc.title = nextTitle;
      changed = true;
    }
  }
  if (typeof snapshot.path === "string") {
    const nextPath = snapshot.path.trim().replace(/\\/g, "/");
    if (nextPath && nextPath !== previewDoc.path) {
      previewDoc.path = nextPath;
      changed = true;
    }
  }
  if (typeof snapshot.role === "string") {
    const nextRole = snapshot.role.trim().toLowerCase();
    if (nextRole && nextRole !== previewDoc.role) {
      previewDoc.role = nextRole;
      changed = true;
    }
  }
  if (typeof snapshot.format === "string") {
    const normalizedFormat = snapshot.format.trim().toLowerCase();
    const nextFormat = normalizedFormat === "code" ? "code" : "markdown";
    if (nextFormat !== previewDoc.format) {
      previewDoc.format = nextFormat;
      changed = true;
    }
  }
  if (typeof snapshot.language === "string") {
    const nextLanguage = snapshot.language.trim().toLowerCase();
    if (nextLanguage && nextLanguage !== previewDoc.language) {
      previewDoc.language = nextLanguage;
      changed = true;
    }
  }

  const normalizedPreview = normalizeStreamingCanvasPreviewDocument(previewDoc);
  if (normalizedPreview) {
    ["title", "path", "role", "format", "language", "summary"].forEach((key) => {
      if (normalizedPreview[key] !== previewDoc[key]) {
        previewDoc[key] = normalizedPreview[key];
        changed = true;
      }
    });
  }

  return changed;
}

function ensureStreamingCanvasPreview(toolName, previewKey = "", snapshot = {}) {
  const normalizedToolName = String(toolName || "").trim();
  const normalizedPreviewKey = String(previewKey || "").trim() || "canvas-call-0";
  if (!normalizedToolName) {
    return null;
  }
  const existing = canvasState.streamingPreviews.get(normalizedPreviewKey);

  // buildStreamingCanvasPreviewDocument does a full conversation-chatState.history scan to
  // locate the target canvas document. Calling it on every content-delta event is
  // the primary cause of main-thread blocking during canvas streaming, because a
  // fast model can emit hundreds of deltas per second. Skip the expensive rebuild
  // for all subsequent deltas once the preview is established and the tool name
  // still matches. Rebuild is only needed when the preview is first created or
  // when the active tool changes (extremely rare mid-stream).
  const needsRebuild = !existing || existing.tool !== normalizedToolName;
  let shouldRebuild = needsRebuild;
  let preview = existing;
  if (needsRebuild) {
    const rebuiltPreview = buildStreamingCanvasPreviewDocument(normalizedToolName, normalizedPreviewKey, snapshot);
    shouldRebuild = !existing
      || existing.tool !== normalizedToolName
      || (rebuiltPreview && rebuiltPreview.id && rebuiltPreview.id !== existing.id);
    if (shouldRebuild) {
      preview = rebuiltPreview;
      if (preview) {
        canvasState.streamingPreviews.set(normalizedPreviewKey, preview);
      }
    }
  }

  const isNewPreview = !existing || shouldRebuild;
  if (!preview) {
    return null;
  }
  applyStreamingCanvasPreviewSnapshot(preview, snapshot);
  // Only switch the active view to the streaming preview when a new streaming
  // operation starts. If the user has manually selected a different document
  // during an ongoing stream, do not force the view back to the preview.
  if (isNewPreview || canvasState.activeCanvasDocumentId === preview.id) {
    canvasState.activeCanvasDocumentId = preview.id;
  }
  return preview;
}

function resetStreamingCanvasPreview() {
  canvasState.streamingPreviews.clear();
  clearCanvasRenderJob("preview");
}
