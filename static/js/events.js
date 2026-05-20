/**
 * Events module — drag-and-drop file handling for the chat area.
 * Depends on: state.js, attachments.js, utils.js
 * Globals from app.js: chatAreaEl, chatDropOverlay, chatDragDepth, chatState, attachmentState,
 *                      imageInputEl, docInputEl, featureFlags, ALLOWED_IMAGE_TYPES,
 *                      MAX_IMAGE_BYTES, MAX_DOCUMENT_BYTES
 */

/* ------------------------------------------------------------------ */
/*  Chat Drag-and-Drop Helpers                                         */
/* ------------------------------------------------------------------ */

function setChatDropOverlayVisible(visible) {
  if (!chatAreaEl || !chatDropOverlay) {
    return;
  }
  chatAreaEl.classList.toggle("chat-area--dragover", visible);
  chatDropOverlay.hidden = !visible;
}

function resetChatDragState() {
  chatDragDepth = 0;
  setChatDropOverlayVisible(false);
}

function handleChatDragEnter(event) {
  if (chatState.isStreaming || chatState.isFixing || !hasDraggedFiles(event.dataTransfer)) {
    return;
  }
  event.preventDefault();
  chatDragDepth += 1;
  setChatDropOverlayVisible(true);
}

function handleChatDragOver(event) {
  if (chatState.isStreaming || chatState.isFixing || !hasDraggedFiles(event.dataTransfer)) {
    return;
  }
  event.preventDefault();
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = "copy";
  }
  setChatDropOverlayVisible(true);
}

function handleChatDragLeave(event) {
  if (!hasDraggedFiles(event.dataTransfer)) {
    return;
  }
  event.preventDefault();
  chatDragDepth = Math.max(0, chatDragDepth - 1);
  if (chatDragDepth === 0) {
    setChatDropOverlayVisible(false);
  }
}

function handleChatDrop(event) {
  if (chatState.isStreaming || chatState.isFixing || !hasDraggedFiles(event.dataTransfer)) {
    return;
  }
  event.preventDefault();
  const files = Array.from(event.dataTransfer?.files || []);
  resetChatDragState();
  if (!files.length) {
    return;
  }
  handleSelectedFiles(files);
}

/* ------------------------------------------------------------------ */
/*  File Selection Handler                                             */
/* ------------------------------------------------------------------ */

function handleSelectedFiles(files, options = {}) {
  const documentsOnly = options.documentsOnly === true;
  const nextImages = [...attachmentState.selectedImageFiles];
  const nextDocuments = [...attachmentState.selectedDocumentFiles];

  for (const file of files || []) {
    if (!file) {
      continue;
    }
    if (isDocumentFile(file)) {
      if (file.size > MAX_DOCUMENT_BYTES) {
        showError(`Document ${file.name} is too large. Upload a maximum of 20 MB.`);
        continue;
      }
      nextDocuments.push(file);
      continue;
    }
    if (documentsOnly) {
      showError(`Unsupported document type: ${file.name}`);
      continue;
    }
    if (!featureFlags.image_uploads_enabled) {
      showError("Image uploads are disabled. Only documents can be attached.");
      continue;
    }
    if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
      showError(`Unsupported file type: ${file.name}`);
      continue;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      showError(`Image ${file.name} is too large. Upload a maximum of 10 MB.`);
      continue;
    }
    nextImages.push(file);
  }

  attachmentState.selectedImageFiles = dedupeFiles(nextImages);
  attachmentState.selectedDocumentFiles = dedupeFiles(nextDocuments);
  syncSelectedDocumentSubmissionModes();
  renderAttachmentPreview();
}

/* ------------------------------------------------------------------ */
/*  Drag/Drop Event Listener Setup                                     */
/* ------------------------------------------------------------------ */

chatAreaEl?.addEventListener("dragenter", handleChatDragEnter);
chatAreaEl?.addEventListener("dragover", handleChatDragOver);
chatAreaEl?.addEventListener("dragleave", handleChatDragLeave);
chatAreaEl?.addEventListener("drop", handleChatDrop);
window.addEventListener("drop", resetChatDragState);
window.addEventListener("dragend", resetChatDragState);
