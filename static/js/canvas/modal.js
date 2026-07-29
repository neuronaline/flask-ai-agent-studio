// canvas/modal.js — Confirm dialog

function isCanvasConfirmOpen() {
  return Boolean(canvasConfirmModal?.classList.contains("open"));
}

function closeCanvasConfirmModal(action = "cancel", executeHandler = true) {
  if (!canvasConfirmModal) {
    return;
  }

  const pendingAction = uiState.pendingCanvasConfirmAction;
  uiState.pendingCanvasConfirmAction = null;
  canvasConfirmModal.classList.remove("open");
  canvasConfirmOverlay?.classList.remove("open");
  canvasConfirmModal.setAttribute("aria-hidden", "true");
  if (canvasConfirmOpenBtn) {
    canvasConfirmOpenBtn.textContent = DEFAULT_CANVAS_CONFIRM_LABEL;
  }
  if (canvasConfirmLaterBtn) {
    canvasConfirmLaterBtn.textContent = DEFAULT_CANVAS_CONFIRM_CANCEL_LABEL;
  }

  if (canvasState.lastCanvasConfirmTriggerEl && typeof canvasState.lastCanvasConfirmTriggerEl.focus === "function") {
    canvasState.lastCanvasConfirmTriggerEl.focus();
  }

  if (!executeHandler || !pendingAction) {
    return;
  }

  if (action === "confirm") {
    pendingAction.onConfirm?.();
    return;
  }

  if (action === "cancel") {
    pendingAction.onCancel?.();
    return;
  }

  pendingAction.onDismiss?.();
}

function openCanvasConfirmModal(options = {}) {
  if (!canvasConfirmModal || !canvasConfirmTitle || !canvasConfirmMessage) {
    options.onConfirm?.();
    return;
  }

  if (isCanvasConfirmOpen()) {
    closeCanvasConfirmModal("cancel", false);
  }

  closeMobileTools();
  closeExportPanel();
  closeStats();
  canvasState.lastCanvasConfirmTriggerEl = document.activeElement instanceof HTMLElement ? document.activeElement : attachBtn;
  uiState.pendingCanvasConfirmAction = {
    onConfirm: typeof options.onConfirm === "function" ? options.onConfirm : null,
    onCancel: typeof options.onCancel === "function" ? options.onCancel : null,
    onDismiss: typeof options.onCancel === "function"
      ? options.onCancel
      : null,
  };
  canvasConfirmTitle.textContent = String(options.title || "Open document in Canvas?").trim() || "Open document in Canvas?";
  canvasConfirmMessage.textContent = String(options.message || "Your uploaded document is ready in Canvas.").trim() || "Your uploaded document is ready in Canvas.";
  if (canvasConfirmOpenBtn) {
    canvasConfirmOpenBtn.textContent = String(options.confirmLabel || DEFAULT_CANVAS_CONFIRM_LABEL).trim() || DEFAULT_CANVAS_CONFIRM_LABEL;
  }
  if (canvasConfirmLaterBtn) {
    canvasConfirmLaterBtn.textContent = String(options.cancelLabel || DEFAULT_CANVAS_CONFIRM_CANCEL_LABEL).trim() || DEFAULT_CANVAS_CONFIRM_CANCEL_LABEL;
  }
  canvasConfirmModal.classList.add("open");
  canvasConfirmOverlay?.classList.add("open");
  canvasConfirmModal.setAttribute("aria-hidden", "false");
  canvasConfirmOpenBtn?.focus();
}
