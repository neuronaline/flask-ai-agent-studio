// canvas/api.js — CRUD operations, upload, GitHub import, document creation

const CANVAS_UPLOAD_MARKDOWN_EXTENSIONS = new Set([".md", ".markdown", ".mdx", ".txt", ".rst", ".adoc", ".org"]);
const CANVAS_UPLOAD_LANGUAGE_MAP = {
  ".py": "python",
  ".pyw": "python",
  ".js": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".ts": "typescript",
  ".mts": "typescript",
  ".tsx": "tsx",
  ".jsx": "jsx",
  ".json": "json",
  ".jsonc": "json",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".html": "html",
  ".htm": "html",
  ".css": "css",
  ".sh": "bash",
  ".bash": "bash",
  ".zsh": "bash",
  ".sql": "sql",
  ".xml": "xml",
  ".toml": "toml",
  ".ini": "ini",
  ".cfg": "ini",
  ".c": "c",
  ".h": "c",
  ".cpp": "cpp",
  ".cc": "cpp",
  ".cxx": "cpp",
  ".hpp": "cpp",
  ".hh": "cpp",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".rb": "ruby",
  ".php": "php",
};

function getCanvasUploadExtension(fileName) {
  const normalizedName = String(fileName || "").trim().toLowerCase();
  const dotIndex = normalizedName.lastIndexOf(".");
  if (dotIndex < 0) {
    return "";
  }
  return normalizedName.slice(dotIndex);
}

function inferCanvasUploadFormat(fileName) {
  return CANVAS_UPLOAD_MARKDOWN_EXTENSIONS.has(getCanvasUploadExtension(fileName)) ? "markdown" : "code";
}

function inferCanvasUploadLanguage(fileName) {
  return CANVAS_UPLOAD_LANGUAGE_MAP[getCanvasUploadExtension(fileName)] || null;
}

function showPendingCanvasUploadPreview(fileName) {
  const nextTitle = String(fileName || "Uploaded file").trim() || "Uploaded file";
  const nextFormat = inferCanvasUploadFormat(nextTitle);
  const nextLanguage = inferCanvasUploadLanguage(nextTitle) || "";
  const preview = buildStreamingCanvasPreviewDocument("create_canvas_document", PENDING_CANVAS_UPLOAD_PREVIEW_KEY, {
    title: nextTitle,
    format: nextFormat,
    language: nextLanguage,
  });
  if (!preview) {
    return;
  }
  preview.content = nextFormat === "code"
    ? "// Upload is being processed..."
    : getCanvasUploadExtension(nextTitle) === ".pdf"
      ? `## Processing ${nextTitle}\n\nPreparing pages for Canvas...`
      : `# ${nextTitle}\n\nUploading file...`;
  preview.line_count = preview.content.split("\n").length;
  preview.page_count = 0;
  preview.isStreamingPreview = true;
  canvasState.streamingPreviews.set(PENDING_CANVAS_UPLOAD_PREVIEW_KEY, preview);
  canvasState.activeCanvasDocumentId = preview.id;
  canvasState.isCanvasEditing = false;
  canvasState.editingCanvasDocumentId = null;
  renderCanvasPanel();
}

function clearPendingCanvasUploadPreview() {
  if (!canvasState.streamingPreviews.has(PENDING_CANVAS_UPLOAD_PREVIEW_KEY)) {
    return;
  }
  canvasState.streamingPreviews.delete(PENDING_CANVAS_UPLOAD_PREVIEW_KEY);
}

function scheduleCanvasAutoRefreshAfterUpload(delay = 350) {
  if (!chatState.currentConvId) {
    return;
  }
  window.setTimeout(() => {
    if (!chatState.currentConvId || chatState.isStreaming || chatState.isFixing) {
      return;
    }
    void refreshConversationFromServer();
  }, delay);
}

function normalizeCanvasPathCandidate(value) {
  return String(value || "").trim().replace(/\\/g, "/").replace(/^\/+/, "");
}

function inferCanvasPathFromLabel(value) {
  const normalized = normalizeCanvasPathCandidate(value);
  if (!normalized) {
    return "";
  }
  if (normalized.includes("/")) {
    return normalized;
  }
  return /\.[a-z0-9]{1,10}$/i.test(normalized) ? normalized : "";
}

function getCanvasTitleFromPathOrLabel(value) {
  const normalized = normalizeCanvasPathCandidate(value);
  if (!normalized) {
    return "Untitled";
  }
  const parts = normalized.split("/").filter(Boolean);
  return String(parts[parts.length - 1] || normalized || "Untitled").trim() || "Untitled";
}

function openCanvasUploadPicker() {
  if (guardCanvasMutation("upload a file")) {
    return;
  }
  if (!canvasUploadInput) {
    setCanvasStatus("File upload is not available.", "warning");
    return;
  }
  canvasUploadInput.value = "";
  canvasUploadInput.click();
}

function setCanvasEditing(enabled) {
  if (enabled && guardCanvasMutation("edit the active file")) {
    return;
  }
  const activeDocument = getActiveCanvasDocument();
  if (enabled && activeDocument && !isCanvasDocumentEditable(activeDocument)) {
    setCanvasStatus("Visual canvas previews are read-only.", "muted");
    renderCanvasPanel();
    return;
  }
  if (enabled) {
    closeCanvasOverflowMenu();
    setCanvasMobileTreeOpen(false);
  }
  canvasState.isCanvasEditing = Boolean(enabled && activeDocument);
  canvasState.editingCanvasDocumentId = canvasState.isCanvasEditing ? activeDocument.id : null;
  if (canvasState.isCanvasEditing && canvasEditorEl) {
    canvasEditorEl.value = activeDocument.content || "";
  }
  renderCanvasPanel();
}

function cancelCanvasEditing({ statusMessage = "", tone = "muted" } = {}) {
  if (guardCanvasMutation("leave edit mode")) {
    return;
  }
  if (!canvasState.isCanvasEditing && !canvasState.editingCanvasDocumentId) {
    return;
  }
  clearCanvasEditingPreviewRender();
  canvasState.isCanvasEditing = false;
  canvasState.editingCanvasDocumentId = null;
  renderCanvasPanel();
  if (statusMessage) {
    setCanvasStatus(statusMessage, tone);
  }
}

function clearCanvasSearchInput({ statusMessage = "", tone = "muted" } = {}) {
  if (!canvasSearchInput?.value) {
    return false;
  }
  canvasSearchInput.value = "";
  renderCanvasPanel();
  if (statusMessage) {
    setCanvasSearchStatus(statusMessage, tone);
  }
  return true;
}

async function createCanvasDocumentFromData({ title, content, format, language = null, path = null, statusMessage = "Creating canvas file..." }) {
  if (!chatState.currentConvId) {
    setCanvasStatus("Conversation is not available yet.", "warning");
    return;
  }
  if (guardCanvasMutation("create another file")) {
    return;
  }

  cancelPendingConversationRefreshes();

  return withCanvasMutation("create", async () => {
    const response = await fetch(`/api/conversations/${chatState.currentConvId}/canvas`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title,
        content,
        format,
        language,
        path,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || "Canvas create failed.");
    }
    return payload;
  }, {
    statusMessage,
    successMessage: "Canvas file created.",
    buttonsToDisable: [canvasNewBtn, canvasUploadBtn],
    onSuccess: () => {
      clearPendingCanvasUploadPreview();
      scheduleCanvasAutoRefreshAfterUpload();
      globalThis.requestAnimationFrame(() => {
        if (!canvasEditorEl) {
          return;
        }
        canvasEditorEl.focus();
        const cursorPosition = canvasEditorEl.value.length;
        canvasEditorEl.setSelectionRange(cursorPosition, cursorPosition);
      });
    },
  });
}

async function createCanvasDocumentFromPrompt() {
  if (guardCanvasMutation("create another file")) {
    return;
  }
  const requestedPathOrName = String(globalThis.prompt("New canvas file path or name", "Untitled") || "").trim();
  if (!requestedPathOrName) {
    setCanvasStatus("Canvas file creation cancelled.", "muted");
    return;
  }

  const nextFormat = getCanvasFormatControlValue();
  const nextPath = inferCanvasPathFromLabel(requestedPathOrName) || null;
  await createCanvasDocumentFromData({
    title: getCanvasTitleFromPathOrLabel(requestedPathOrName),
    content: "",
    format: nextFormat,
    path: nextPath,
  });
}

async function createCanvasDocumentFromFile(file) {
  const nextPath = normalizeCanvasPathCandidate(file?.webkitRelativePath || file?.name || "") || null;
  const nextTitle = getCanvasTitleFromPathOrLabel(nextPath || file?.name || "Uploaded file");

  if (!chatState.currentConvId) {
    setCanvasStatus("Conversation is not available yet.", "warning");
    return;
  }
  if (guardCanvasMutation("upload another file")) {
    return;
  }

  cancelPendingConversationRefreshes();
  showPendingCanvasUploadPreview(nextTitle);

  return withCanvasMutation("upload", async () => {
    const formData = new FormData();
    formData.append("file", file, nextTitle);
    formData.append("title", nextTitle);
    if (nextPath) {
      formData.append("path", nextPath);
    }

    const response = await fetch(`/api/conversations/${chatState.currentConvId}/canvas`, {
      method: "POST",
      body: formData,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || "Canvas upload failed.");
    }
    return payload;
  }, {
    statusMessage: `Uploading ${nextTitle}...`,
    successMessage: "Canvas file created.",
    buttonsToDisable: [canvasNewBtn, canvasUploadBtn],
    onSuccess: () => {
      clearPendingCanvasUploadPreview();
      globalThis.requestAnimationFrame(() => {
        if (!canvasEditorEl) {
          return;
        }
        canvasEditorEl.focus();
        const cursorPosition = canvasEditorEl.value.length;
        canvasEditorEl.setSelectionRange(cursorPosition, cursorPosition);
      });
    },
    onError: () => {
      clearPendingCanvasUploadPreview();
    },
  });
}

async function importGithubRepositoryToCanvas() {
  if (!chatState.currentConvId) {
    setCanvasStatus("Conversation is not available yet.", "warning");
    return;
  }
  if (guardCanvasMutation("import a repository")) {
    return;
  }

  const repoUrl = String(globalThis.prompt("GitHub repository URL", "https://github.com/") || "").trim();
  if (!repoUrl) {
    setCanvasStatus("GitHub import cancelled.", "muted");
    return;
  }

  cancelPendingConversationRefreshes();

  return withCanvasMutation("import-github", async () => {
    const response = await fetch(`/api/conversations/${chatState.currentConvId}/canvas/import-github`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url: repoUrl }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || "GitHub import failed.");
    }
    return payload;
  }, {
    statusMessage: "Importing GitHub repository into Canvas...",
    buttonsToDisable: [canvasNewBtn, canvasUploadBtn, canvasImportGithubBtn],
    stateOverrides: {
      isCanvasEditing: false,
    },
    onSuccess: (payload) => {
      // Custom success message based on import result
      const importedCount = Number(payload.imported_count || 0);
      const primaryDocumentPath = String(payload.primary_document_path || "").trim();
      const statusParts = [`Imported ${importedCount} file${importedCount === 1 ? "" : "s"}`];
      if (primaryDocumentPath) {
        statusParts.push(`active: ${primaryDocumentPath}`);
      }
      setCanvasStatus(statusParts.join(" · "), "success");
      scheduleCanvasAutoRefreshAfterUpload();
    },
  });
}

/**
 * Canvas CRUD operasyonları için ortak wrapper.
 * 6 operasyon (create, upload, import-github, delete, rename, save) aynı
 * try/catch/setCanvasMutationState/re-render desenini tekrar ediyordu.
 *
 * @param {string} mutationType - Mutation state'i (örn. "create", "upload", "save")
 * @param {Function} operation - Async fonksiyon, API çağrısı yapmalı ve payload dövmeli
 * @param {Object} options
 * @param {string} options.statusMessage - Başlangıç status mesajı
 * @param {string} options.successMessage - Başarı status mesajı (opsiyonel, aksi halde varsayılan mesaj)
 * @param {Array} options.buttonsToDisable - İşlem sırasında devre dışı bırakılacak butonlar
 * @param {Function} options.onSuccess - Ek başarı işlemleri (payload, state güncellemelerinden sonra)
 * @param {Function} options.onError - Ek hata işlemleri (hata yakalandıktan sonra)
 * @param {boolean} options.skipHistoryUpdate - chatState.history'yi payload.messages'tan güncellemeyi atla
 * @param {boolean} options.skipCanvasUpdate - renderCanvasPanel çağrısını atla
 * @param {Object} options.stateOverrides - Başarı durumunda uygulanacak state override'ları (örn. { isCanvasEditing: false })
 */
async function withCanvasMutation(mutationType, operation, options = {}) {
  const {
    statusMessage = `${mutationType}...`,
    successMessage = null,
    buttonsToDisable = [],
    onSuccess = null,
    onError = null,
    skipHistoryUpdate = false,
    skipCanvasUpdate = false,
    stateOverrides = {},
  } = options;

  // Devre dışı bırakılacak butonları işaretle
  for (const btn of buttonsToDisable) {
    if (btn) btn.disabled = true;
  }

  setCanvasMutationState(mutationType);
  setCanvasStatus(statusMessage, "muted");

  try {
    const payload = await operation();

    setCanvasMutationState("", { rerender: false });

    if (!skipHistoryUpdate && Array.isArray(payload?.messages)) {
      chatState.history = payload.messages.map(normalizeHistoryEntry);
    }

    // Canvas state güncellemeleri (operasyonlarda ortak)
    // stateOverrides ile özelleştirilebilir (fonksiyon değerleri payload ile çağrılır)
    const computedState = {
      streamingCanvasDocuments: [],
      activeCanvasDocumentId: String(
        payload?.active_document_id || payload?.document?.id || ""
      ).trim() || null,
      isCanvasEditing: true,
      editingCanvasDocumentId: null,
    };
    // Apply stateOverrides (functions are called with payload)
    for (const [key, value] of Object.entries(stateOverrides)) {
      computedState[key] = typeof value === "function" ? value(payload) : value;
    }
    canvasState.streamingCanvasDocuments = computedState.streamingCanvasDocuments;
    canvasState.activeCanvasDocumentId = computedState.activeCanvasDocumentId;
    canvasState.isCanvasEditing = computedState.isCanvasEditing;
    canvasState.editingCanvasDocumentId = computedState.editingCanvasDocumentId;

    renderConversationHistory();
    if (!skipCanvasUpdate) {
      renderCanvasPanel();
    }

    // Call onSuccess first - if it returns false, skip default success handling
    let defaultSuccessMessage = successMessage || (payload?.message || `${mutationType} completed.`);
    if (onSuccess) {
      const onSuccessResult = await onSuccess(payload);
      if (onSuccessResult === false) {
        // onSuccess handled everything (status, renders) - don't overwrite
        return payload;
      }
      // If onSuccess returns a string, use it as the success message
      if (typeof onSuccessResult === "string") {
        defaultSuccessMessage = onSuccessResult;
      }
    }
    setCanvasStatus(defaultSuccessMessage, "success");

    return payload;
  } catch (error) {
    setCanvasMutationState("", { rerender: false });
    if (!skipCanvasUpdate) {
      renderCanvasPanel();
    }
    setCanvasStatus(error.message || `${mutationType} failed.`, "danger");

    if (onError) {
      await onError(error);
    }
  } finally {
    // Butonları yeniden etkinleştir
    for (const btn of buttonsToDisable) {
      if (btn) btn.disabled = false;
    }
  }
}

function setPendingDocumentCanvasOpen(files) {
  const documentItems = getDocumentCanvasPromptItems(files);
  if (!documentItems.length) {
    attachmentState.pendingDocumentCanvasOpen = null;
    return;
  }

  attachmentState.pendingDocumentCanvasOpen = {
    fileCount: documentItems.length,
    fileName: String(documentItems[0]?.name || "Document").trim() || "Document",
  };
}

async function toggleCanvasAlwaysExpanded(activeDocument) {
  if (!chatState.currentConvId || !activeDocument) return;
  const current = Boolean(activeDocument.always_expanded);
  const next = !current;
  try {
    const response = await fetch(`/api/conversations/${chatState.currentConvId}/canvas`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ document_id: activeDocument.id, always_expanded: next }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Update failed.");
    chatState.history = Array.isArray(payload.messages) ? payload.messages.map(normalizeHistoryEntry) : chatState.history;
    canvasState.activeCanvasDocumentId = String(payload.active_document_id || activeDocument.id || "").trim() || canvasState.activeCanvasDocumentId;
    renderConversationHistory({ preserveScroll: true });
    renderCanvasPanel();
    setCanvasStatus(next ? "Always expanded enabled — AI will receive the full document." : "Always expanded disabled.", "success");
  } catch (err) {
    setCanvasStatus(err.message || "Could not update always_expanded.", "danger");
  }
}

function promptPdfSubmissionMode(files) {
  const pdfFiles = (files || []).filter((file) => isPdfDocumentFile(file));
  if (!pdfFiles.length) {
    return Promise.resolve(true);
  }

  const requestLabel = pdfFiles.length === 1
    ? `How should ${String(pdfFiles[0]?.name || "this PDF").trim() || "this PDF"} be sent?`
    : `How should these ${pdfFiles.length} PDFs be sent?`;
  const message = pdfFiles.length === 1
    ? `Choose visual mode for page-image analysis with vision-capable models. Visual mode sends up to the first ${VISUAL_PDF_PAGE_LIMIT} pages as images, while text mode extracts text and keeps Canvas editing available.`
    : `Choose one mode for this PDF batch. Visual mode sends up to the first ${VISUAL_PDF_PAGE_LIMIT} pages of each PDF as images. Text mode extracts text and keeps Canvas editing available.`;

  return new Promise((resolve) => {
    openCanvasConfirmModal({
      title: requestLabel,
      message,
      confirmLabel: "Send visually",
      cancelLabel: "Send as text",
      onConfirm: () => {
        pdfFiles.forEach((file) => setDocumentSubmissionMode(file, "visual"));
        renderAttachmentPreview();
        resolve(true);
      },
      onCancel: () => {
        pdfFiles.forEach((file) => setDocumentSubmissionMode(file, "text"));
        renderAttachmentPreview();
        resolve(true);
      },
      onDismiss: () => resolve(false),
    });
  });
}

function normalizeDocumentCanvasPromptItem(item) {
  if (!item || typeof item !== "object") {
    return null;
  }

  if (typeof File !== "undefined" && item instanceof File) {
    if (!isDocumentFile(item)) {
      return null;
    }
    const fileName = String(item.name || "document").trim() || "document";
    return { name: fileName };
  }

  const kind = String(item.kind || "").trim().toLowerCase();
  if (kind && kind !== "document") {
    return null;
  }

  const fileName = String(item.file_name || item.name || "document").trim() || "document";
  return { name: fileName };
}

function getDocumentCanvasPromptItems(items) {
  return (items || [])
    .map((item) => normalizeDocumentCanvasPromptItem(item))
    .filter(Boolean);
}

function getExistingDocumentAttachmentsForCanvasPrompt(message) {
  return getMessageAttachments(message?.metadata).filter((attachment) => String(attachment.kind || "").trim().toLowerCase() === "document");
}

function promptDocumentCanvasAction(files) {
  const documentItems = getDocumentCanvasPromptItems(files);
  if (!documentItems.length) {
    return Promise.resolve("prompt");
  }

  if (!canvasConfirmModal || !canvasConfirmTitle || !canvasConfirmMessage) {
    return Promise.resolve("prompt");
  }

  const fileCount = documentItems.length;
  const fileName = String(documentItems[0]?.name || "document").trim() || "document";
  const requestLabel = fileCount > 1 ? `${fileCount} documents` : fileName;
  const pronoun = fileCount > 1 ? "them" : "it";

  return new Promise((resolve) => {
    openCanvasConfirmModal({
      title: "Open document in Canvas?",
      message: `${requestLabel} can be added to AI Canvas for editing and later reuse. Choose Later to keep ${pronoun} attached to this message only.`,
      onConfirm: () => resolve("open"),
      onCancel: () => resolve("skip"),
      onDismiss: () => resolve("skip"),
    });
  });
}

function consumePendingDocumentCanvasOpen() {
  const pendingRequest = attachmentState.pendingDocumentCanvasOpen;
  attachmentState.pendingDocumentCanvasOpen = null;
  return pendingRequest;
}

async function deleteCanvasDocuments({ documentId = null, clearAll = false, confirmed = false } = {}) {
  if (!chatState.currentConvId) {
    setCanvasStatus("Canvas is not available yet.", "warning");
    return;
  }

  const activeDocument = getActiveCanvasDocument();
  const targetDocumentId = documentId || activeDocument?.id || null;
  if (!clearAll && !targetDocumentId) {
    setCanvasStatus("No canvas document is available to delete.", "warning");
    return;
  }
  if (guardCanvasMutation(clearAll ? "clear Canvas" : "delete the active file")) {
    return;
  }

  if (!confirmed) {
    openCanvasConfirmModal({
      title: "Are you sure?",
      message: clearAll
        ? "This will permanently remove every file from Canvas."
        : `This will permanently remove ${activeDocument?.title || "this canvas document"} from Canvas.`,
      confirmLabel: clearAll ? "Clear all" : "Delete",
      cancelLabel: "Cancel",
      onConfirm: () => {
        void deleteCanvasDocuments({ documentId: targetDocumentId, clearAll, confirmed: true });
      },
    });
    return;
  }

  cancelPendingConversationRefreshes();

  return withCanvasMutation(clearAll ? "clear" : "delete", async () => {
    const params = new URLSearchParams();
    if (targetDocumentId) {
      params.set("document_id", targetDocumentId);
    }
    if (clearAll) {
      params.set("clear_all", "true");
    }

    const query = params.toString();
    const response = await fetch(`/api/conversations/${chatState.currentConvId}/canvas${query ? `?${query}` : ""}`, {
      method: "DELETE",
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || "Canvas delete failed.");
    }
    return payload;
  }, {
    statusMessage: clearAll ? "Clearing Canvas..." : "Deleting document...",
    stateOverrides: {
      isCanvasEditing: false,
      activeCanvasDocumentId: payload => (
        payload.cleared
          ? null
          : String(payload?.active_document_id || getActiveCanvasDocument(chatState.history)?.id || "").trim() || null
      ),
    },
    onSuccess: (payload) => {
      if (payload.cleared) {
        // Return false to skip wrapper's default success handling (original had early return)
        setCanvasAttention(false);
        setCanvasStatus("Canvas cleared.", "success");
        return false;
      }
      setCanvasStatus("Canvas document deleted.", "success");
    },
  });
}

async function renameCanvasDocument() {
  const activeDocument = getActiveCanvasDocument();
  if (!chatState.currentConvId || !activeDocument) {
    setCanvasStatus("No canvas document to rename.", "warning");
    return;
  }
  if (guardCanvasMutation("rename the active file")) {
    return;
  }
  const currentTitle = String(activeDocument.path || activeDocument.title || "").trim() || "Untitled";
  const nextTitle = String(globalThis.prompt("Rename document", currentTitle) || "").trim();
  if (!nextTitle || nextTitle === currentTitle) {
    return;
  }

  return withCanvasMutation("rename", async () => {
    const response = await fetch(`/api/conversations/${chatState.currentConvId}/canvas`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ document_id: activeDocument.id, title: nextTitle }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || "Rename failed.");
    }
    return payload;
  }, {
    statusMessage: "Renaming...",
    stateOverrides: {
      // Use activeDocument.id as fallback (different from other operations)
      activeCanvasDocumentId: payload => String(payload?.active_document_id || activeDocument.id || "").trim() || canvasState.activeCanvasDocumentId,
    },
    onSuccess: () => {
      renderConversationHistory({ preserveScroll: true });
      setCanvasStatus(`Renamed to "${nextTitle}".`, "success");
    },
  });
}

async function saveCanvasEdits() {
  const activeDocument = getActiveCanvasDocument();
  if (!chatState.currentConvId || !activeDocument || !canvasEditorEl) {
    setCanvasStatus("Canvas document is not available yet.", "warning");
    return;
  }
  if (guardCanvasMutation("save the active file again")) {
    return;
  }

  const nextContent = canvasEditorEl.value.replace(/\r\n?/g, "\n");
  const nextFormat = getCanvasFormatControlValue();
  cancelPendingConversationRefreshes();

  return withCanvasMutation("save", async () => {
    const response = await fetch(`/api/conversations/${chatState.currentConvId}/canvas`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        document_id: activeDocument.id,
        content: nextContent,
        format: nextFormat,
        language: activeDocument.language || null,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || "Canvas save failed.");
    }
    return payload;
  }, {
    statusMessage: "Saving canvas edits...",
    stateOverrides: {
      isCanvasEditing: false,
      editingCanvasDocumentId: null,
      activeCanvasDocumentId: payload => String(payload?.active_document_id || activeDocument.id).trim() || activeDocument.id,
    },
    onSuccess: () => {
      setCanvasStatus("Canvas saved.", "success");
    },
  });
}
