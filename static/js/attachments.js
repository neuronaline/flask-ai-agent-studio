// Attachment/document helpers — validation, deduplication, metadata normalization.
// Dependencies: utils.js (formatFileSize),
//               state.js (attachmentState),
//               constants.js (ALLOWED_*, MAX_*, DOCUMENT_EXTENSIONS, VISUAL_PDF_PAGE_LIMIT).

let nextAttachmentFileKeyId = 1;
let selectedDocumentSubmissionModes = new Map();

function isDocumentFile(file) {
  if (ALLOWED_DOCUMENT_TYPES.has(file.type)) return true;
  const ext = (file.name || "").toLowerCase().match(/\.[^.]+$/);
  return ext ? DOCUMENT_EXTENSIONS.has(ext[0]) : false;
}

function isPdfDocumentFile(file) {
  if (!file) {
    return false;
  }
  if (String(file.type || "").trim().toLowerCase() === "application/pdf") {
    return true;
  }
  return /\.pdf$/i.test(String(file.name || "").trim());
}

function getDocumentSubmissionMode(file) {
  if (!isPdfDocumentFile(file)) {
    return "text";
  }
  const fileKey = getAttachmentFileKey(file);
  return selectedDocumentSubmissionModes.get(fileKey) === "visual" ? "visual" : "text";
}

function setDocumentSubmissionMode(file, mode) {
  if (!file) {
    return;
  }
  const fileKey = getAttachmentFileKey(file);
  if (!fileKey) {
    return;
  }
  selectedDocumentSubmissionModes.set(fileKey, mode === "visual" ? "visual" : "text");
}

function syncSelectedDocumentSubmissionModes() {
  const nextModes = new Map();
  attachmentState.selectedDocumentFiles.forEach((file) => {
    const fileKey = getAttachmentFileKey(file);
    if (!fileKey) {
      return;
    }
    if (!isPdfDocumentFile(file)) {
      nextModes.set(fileKey, "text");
      return;
    }
    nextModes.set(fileKey, selectedDocumentSubmissionModes.get(fileKey) === "visual" ? "visual" : "text");
  });
  selectedDocumentSubmissionModes = nextModes;
}

function getAttachmentDeduplicationKey(file) {
  return [file?.name || "", file?.size || 0, file?.type || "", file?.lastModified || 0].join("::");
}

function getAttachmentFileKey(file) {
  if (!file || (typeof file !== "object" && typeof file !== "function")) {
    return "";
  }

  const existingKey = attachmentState.attachmentFileKeyByObject.get(file);
  if (existingKey) {
    return existingKey;
  }

  const nextKey = [
    "attachment",
    nextAttachmentFileKeyId,
    file?.name || "",
    file?.size || 0,
    file?.type || "",
    file?.lastModified || 0,
  ].join("::");
  nextAttachmentFileKeyId += 1;
  attachmentState.attachmentFileKeyByObject.set(file, nextKey);
  return nextKey;
}

function dedupeFiles(files) {
  const deduped = [];
  const seen = new Set();
  (files || []).forEach((file) => {
    if (!file) {
      return;
    }
    const key = getAttachmentDeduplicationKey(file);
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    deduped.push(file);
  });
  return deduped;
}

function normalizeMessageAttachment(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const kind = String(entry.kind || "").trim().toLowerCase();
  if (kind !== "image" && kind !== "document" && kind !== "video") {
    return null;
  }

  if (kind === "image") {
    const imageId = String(entry.image_id || "").trim();
    const imageName = String(entry.image_name || "").trim();
    if (!imageId && !imageName) {
      return null;
    }
    return {
      kind,
      image_id: imageId,
      image_name: imageName,
      image_mime_type: String(entry.image_mime_type || "").trim(),
      analysis_method: String(entry.analysis_method || "").trim(),
      ocr_text: String(entry.ocr_text || "").trim(),
      vision_summary: String(entry.vision_summary || "").trim(),
      assistant_guidance: String(entry.assistant_guidance || "").trim(),
      key_points: Array.isArray(entry.key_points) ? entry.key_points.filter(Boolean).map((value) => String(value)) : [],
    };
  }

  const fileId = String(entry.file_id || "").trim();
  const fileName = String(entry.file_name || "").trim();
  if (!fileId && !fileName) {
    if (kind !== "video") {
      return null;
    }
  }

  if (kind === "video") {
    const videoId = String(entry.video_id || "").trim();
    const videoTitle = String(entry.video_title || "").trim();
    const videoUrl = String(entry.video_url || "").trim();
    if (!videoId && !videoUrl) {
      return null;
    }
    return {
      kind,
      video_id: videoId,
      video_title: videoTitle,
      video_url: videoUrl,
      video_platform: String(entry.video_platform || "").trim(),
      transcript_context_block: String(entry.transcript_context_block || "").trim(),
      transcript_language: String(entry.transcript_language || "").trim(),
      transcript_text_truncated: entry.transcript_text_truncated === true,
    };
  }

  return {
    kind,
    file_id: fileId,
    file_name: fileName,
    file_mime_type: String(entry.file_mime_type || "").trim(),
    file_text_truncated: entry.file_text_truncated === true,
    file_context_block: String(entry.file_context_block || "").trim(),
  };
}

function getAttachmentIdentityKeys(attachment) {
  if (!attachment || typeof attachment !== "object") {
    return [];
  }

  if (attachment.kind === "image") {
    return [attachment.image_id, attachment.image_name].map((value) => String(value || "").trim()).filter(Boolean);
  }

  if (attachment.kind === "document") {
    return [attachment.file_id, attachment.file_name].map((value) => String(value || "").trim()).filter(Boolean);
  }

  if (attachment.kind === "video") {
    return [attachment.video_id, attachment.video_url].map((value) => String(value || "").trim()).filter(Boolean);
  }

  return [];
}

function getMessageAttachments(metadata) {
  if (!metadata || typeof metadata !== "object") {
    return [];
  }

  const attachments = [];
  const seen = new Set();

  const appendAttachment = (entry) => {
    const normalized = normalizeMessageAttachment(entry);
    if (!normalized) {
      return;
    }
    const identityKeys = getAttachmentIdentityKeys(normalized);
    if (identityKeys.some((key) => seen.has(key))) {
      return;
    }
    identityKeys.forEach((key) => seen.add(key));
    attachments.push(normalized);
  };

  if (Array.isArray(metadata.attachments)) {
    metadata.attachments.forEach((entry) => appendAttachment(entry));
  }
  appendAttachment({
    kind: "image",
    image_id: metadata.image_id,
    image_name: metadata.image_name,
    image_mime_type: metadata.image_mime_type,
    analysis_method: metadata.analysis_method,
    ocr_text: metadata.ocr_text,
    vision_summary: metadata.vision_summary,
    assistant_guidance: metadata.assistant_guidance,
    key_points: metadata.key_points,
  });
  appendAttachment({
    kind: "document",
    file_id: metadata.file_id,
    file_name: metadata.file_name,
    file_mime_type: metadata.file_mime_type,
    file_text_truncated: metadata.file_text_truncated === true,
    file_context_block: metadata.file_context_block,
  });
  appendAttachment({
    kind: "video",
    video_id: metadata.video_id,
    video_title: metadata.video_title,
    video_url: metadata.video_url,
    video_platform: metadata.video_platform,
    transcript_context_block: metadata.transcript_context_block,
    transcript_language: metadata.transcript_language,
    transcript_text_truncated: metadata.transcript_text_truncated === true,
  });

  return attachments;
}

function buildLegacyAttachmentMetadata(attachments) {
  const legacy = {};
  const primaryImage = (attachments || []).find((entry) => entry.kind === "image") || null;
  const primaryDocument = (attachments || []).find((entry) => entry.kind === "document") || null;

  if (primaryImage) {
    if (primaryImage.image_id) legacy.image_id = primaryImage.image_id;
    if (primaryImage.image_name) legacy.image_name = primaryImage.image_name;
    if (primaryImage.image_mime_type) legacy.image_mime_type = primaryImage.image_mime_type;
    if (primaryImage.analysis_method) legacy.analysis_method = primaryImage.analysis_method;
    if (primaryImage.ocr_text) legacy.ocr_text = primaryImage.ocr_text;
    if (primaryImage.vision_summary) legacy.vision_summary = primaryImage.vision_summary;
    if (primaryImage.assistant_guidance) legacy.assistant_guidance = primaryImage.assistant_guidance;
    if (primaryImage.key_points?.length) legacy.key_points = [...primaryImage.key_points];
  }

  if (primaryDocument) {
    if (primaryDocument.file_id) legacy.file_id = primaryDocument.file_id;
    if (primaryDocument.file_name) legacy.file_name = primaryDocument.file_name;
    if (primaryDocument.file_mime_type) legacy.file_mime_type = primaryDocument.file_mime_type;
    if (primaryDocument.file_text_truncated) legacy.file_text_truncated = true;
  }

  const contextBlocks = (attachments || [])
    .filter((entry) => entry.kind === "document" && entry.file_context_block)
    .map((entry) => entry.file_context_block);
  if (contextBlocks.length) {
    legacy.file_context_block = contextBlocks.join("\n\n");
  }

  return legacy;
}

function mergeAttachmentMetadata(metadata, attachment) {
  const base = metadata && typeof metadata === "object" ? { ...metadata } : {};
  const blockedKeys = [
    "attachments",
    "image_id",
    "image_name",
    "image_mime_type",
    "analysis_method",
    "ocr_text",
    "vision_summary",
    "assistant_guidance",
    "key_points",
    "file_id",
    "file_name",
    "file_mime_type",
    "file_text_truncated",
    "file_context_block",
    "video_id",
    "video_title",
    "video_url",
    "video_platform",
    "transcript_context_block",
    "transcript_language",
    "transcript_text_truncated",
  ];
  blockedKeys.forEach((key) => delete base[key]);

  const attachments = getMessageAttachments(metadata);
  const normalized = normalizeMessageAttachment(attachment);
  const nextAttachments = normalized
    ? [...attachments.filter((entry) => {
        if (entry.kind !== normalized.kind) {
          return true;
        }
        const entryKeys = getAttachmentIdentityKeys(entry);
        const normalizedKeys = getAttachmentIdentityKeys(normalized);
        return !entryKeys.some((key) => normalizedKeys.includes(key));
      }), normalized]
    : attachments;

  return {
    ...base,
    ...(nextAttachments.length ? { attachments: nextAttachments } : {}),
    ...buildLegacyAttachmentMetadata(nextAttachments),
  };
}

function buildPendingAttachmentMetadata(imageFiles, documentFiles, youtubeUrl = "") {
  const attachments = [
    ...(imageFiles || []).map((file) => ({ kind: "image", image_name: file.name })),
    ...(documentFiles || []).map((file) => ({
      kind: "document",
      file_name: file.name,
      submission_mode: getDocumentSubmissionMode(file),
      canvas_mode: getDocumentSubmissionMode(file) === "visual" ? "preview_only" : "editable",
    })),
    ...(youtubeUrl ? [{ kind: "video", video_url: youtubeUrl, video_title: "YouTube video" }] : []),
  ];
  return attachments.length
    ? {
        attachments,
        ...buildLegacyAttachmentMetadata(getMessageAttachments({ attachments })),
      }
    : null;
}
