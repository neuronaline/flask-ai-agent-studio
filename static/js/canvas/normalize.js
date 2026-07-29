// canvas/normalize.js — Document normalization & validation

function sanitizeEditedUserMetadata(metadata) {
  const attachments = getMessageAttachments(metadata);
  const sanitizedMetadata = {};
  if (attachments.length) {
    sanitizedMetadata.attachments = attachments;
    Object.assign(sanitizedMetadata, buildLegacyAttachmentMetadata(attachments));
  }
  const slashCommandState = extractComposerSlashCommandMetadata(metadata);
  if (slashCommandState?.metadata) {
    Object.assign(sanitizedMetadata, slashCommandState.metadata);
  }
  return Object.keys(sanitizedMetadata).length ? sanitizedMetadata : null;
}

function normalizeCanvasDocument(document) {
  if (!document || typeof document !== "object") {
    return null;
  }
  const format = String(document.format || "markdown").trim().toLowerCase();
  const normalizedFormat = format === "code" ? "code" : "markdown";
  const content = String(document.content || "").replace(/\r\n?/g, "\n");
  const rawPageCount = Number.parseInt(String(document.page_count ?? "0"), 10);
  const contentMode = String(document.content_mode || "text").trim().toLowerCase();
  const canvasMode = String(document.canvas_mode || (contentMode === "visual" ? "preview_only" : "editable")).trim().toLowerCase();
  const visualPageImageIds = Array.isArray(document.visual_page_image_ids)
    ? document.visual_page_image_ids.map((value) => String(value || "").trim()).filter(Boolean)
    : [];
  return {
    id: String(document.id || "").trim(),
    title: String(document.title || "Canvas").trim() || "Canvas",
    path: String(document.path || "").trim().replace(/\\/g, "/"),
    role: String(document.role || "").trim().toLowerCase(),
    summary: String(document.summary || "").trim(),
    format: normalizedFormat,
    language: String(document.language || "").trim().toLowerCase(),
    content,
    line_count: Number.isInteger(Number(document.line_count)) ? Number(document.line_count) : content.split("\n").length,
    page_count: Number.isFinite(rawPageCount) && rawPageCount > 0 ? rawPageCount : 0,
    source_message_id: Number.isInteger(Number(document.source_message_id)) ? Number(document.source_message_id) : null,
    content_mode: contentMode === "visual" || contentMode === "hybrid" ? contentMode : "text",
    canvas_mode: canvasMode === "preview_only" ? "preview_only" : "editable",
    source_file_id: String(document.source_file_id || "").trim(),
    source_mime_type: String(document.source_mime_type || "").trim().toLowerCase(),
    visual_page_image_ids: visualPageImageIds,
    ...(document.always_expanded !== undefined
      ? { always_expanded: Boolean(document.always_expanded) }
      : {}),
  };
}

function isCanvasDocumentEditable(document) {
  return String(document?.canvas_mode || "editable").trim().toLowerCase() !== "preview_only";
}

function isCanvasPageAwareDocument(document) {
  return Boolean(document && !shouldRenderCanvasAsCode(document) && Number(document.page_count) > 1);
}

function getCanvasDocumentById(documents, documentId) {
  const targetId = String(documentId || "").trim();
  if (!targetId) {
    return null;
  }
  return documents.find((document) => document.id === targetId) || null;
}

function getCanvasDocumentDisplayName(document) {
  return getCanvasDocumentLabel(document) || String(document?.title || "Canvas").trim() || "Canvas";
}

function getCanvasFileName(document) {
  const label = getCanvasDocumentLabel(document);
  const parts = label.split("/");
  return parts[parts.length - 1] || label;
}

function shouldRenderCanvasAsCode(document) {
  if (!document || typeof document !== "object") {
    return false;
  }

  const explicitFormat = String(document.format || "").trim().toLowerCase();
  if (explicitFormat === "code") {
    return true;
  }

  const language = String(document.language || "").trim().toLowerCase();
  if (language && !["markdown", "md", "plain", "text", "txt"].includes(language)) {
    return true;
  }

  const candidateLabel = String(document.path || document.title || "").trim().toLowerCase();
  const extensionMatch = candidateLabel.match(/\.[^.\/]+$/);
  return Boolean(extensionMatch && CANVAS_CODE_FILE_EXTENSIONS.has(extensionMatch[0]));
}

function getCanvasDocumentLabel(document) {
  if (!document) {
    return "";
  }
  return String(document.path || document.title || "").trim();
}

function countCanvasLines(text) {
  const normalizedText = String(text || "");
  return normalizedText ? normalizedText.split("\n").length : 0;
}

function countCanvasNewlines(text) {
  const matches = String(text || "").match(/\n/g);
  return matches ? matches.length : 0;
}

function getCanvasMode(documents) {
  return Array.isArray(documents) && documents.some((document) => document.path || document.role) ? "project" : "document";
}

function getCanvasPreferredActiveDocumentId(entries = chatState.history) {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const metadata = entries[index]?.metadata;
    const candidate = typeof metadata?.active_document_id === "string"
      ? metadata.active_document_id.trim()
      : "";
    if (candidate) {
      return candidate;
    }
  }
  return "";
}
