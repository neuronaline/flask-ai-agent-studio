// canvas/mutations.js — Mutation state machine

function isCanvasMutationPending() {
  return Boolean(canvasState.pendingCanvasMutation);
}

function getCanvasPendingMutationLabel() {
  return CANVAS_MUTATION_LABELS[canvasState.pendingCanvasMutation] || "canvas update";
}

function guardCanvasMutation(actionLabel = "continue") {
  if (!isCanvasMutationPending()) {
    return false;
  }
  const normalizedActionLabel = String(actionLabel || "").trim();
  const actionSuffix = normalizedActionLabel ? ` before you ${normalizedActionLabel}` : "";
  setCanvasStatus(`Please wait for the current ${getCanvasPendingMutationLabel()} to finish${actionSuffix}.`, "muted");
  return true;
}

function setCanvasMutationState(nextMutation = "", { rerender = true } = {}) {
  const normalizedMutation = String(nextMutation || "").trim();
  if (canvasState.pendingCanvasMutation === normalizedMutation) {
    return;
  }
  canvasState.pendingCanvasMutation = normalizedMutation;
  if (canvasPanel) {
    canvasPanel.setAttribute("aria-busy", normalizedMutation ? "true" : "false");
    if (normalizedMutation) {
      canvasPanel.dataset.canvasMutation = normalizedMutation;
    } else {
      delete canvasPanel.dataset.canvasMutation;
    }
  }
  if (rerender && isCanvasOpen()) {
    renderCanvasPanel();
  }
}

function setCanvasButtonState(button, { disabled, hidden } = {}) {
  if (!button) {
    return;
  }
  if (typeof disabled === "boolean") {
    button.disabled = disabled;
  }
  if (typeof hidden === "boolean") {
    button.hidden = hidden;
  }
}
