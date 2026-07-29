// canvas/zoom.js — Zoom level & fullscreen

function getCanvasZoomLevel() {
  const boundedIndex = Math.max(0, Math.min(CANVAS_ZOOM_LEVELS.length - 1, uiState.canvasZoomLevelIndex));
  return CANVAS_ZOOM_LEVELS[boundedIndex] || 1;
}

function applyCanvasViewportPreferences() {
  if (!canvasPanel) {
    return;
  }
  canvasPanel.style.setProperty("--canvas-doc-zoom", String(getCanvasZoomLevel()));
  canvasPanel.classList.toggle("canvas-panel--fullscreen", Boolean(uiState.isCanvasFullscreen));
}

function syncCanvasViewportControls() {
  applyCanvasViewportPreferences();
  const hasActiveDocument = Boolean(getActiveCanvasDocument());
  const showViewportControls = Boolean(isMobileViewport() && isCanvasOpen() && hasActiveDocument);
  const zoomPercent = Math.round(getCanvasZoomLevel() * 100);

  if (canvasViewportActionsGroupEl) {
    canvasViewportActionsGroupEl.hidden = !showViewportControls;
  }

  [canvasZoomOutBtn, canvasZoomInBtn, canvasFullscreenToggleBtn].forEach((button) => {
    if (!button) {
      return;
    }
    button.hidden = !showViewportControls;
    button.disabled = !showViewportControls;
  });

  if (canvasZoomOutBtn) {
    canvasZoomOutBtn.disabled = !showViewportControls || uiState.canvasZoomLevelIndex <= 0;
    canvasZoomOutBtn.title = `Zoom out (${zoomPercent}%)`;
  }
  if (canvasZoomInBtn) {
    canvasZoomInBtn.disabled = !showViewportControls || uiState.canvasZoomLevelIndex >= CANVAS_ZOOM_LEVELS.length - 1;
    canvasZoomInBtn.title = `Zoom in (${zoomPercent}%)`;
  }
  if (canvasFullscreenToggleBtn) {
    canvasFullscreenToggleBtn.setAttribute("aria-pressed", uiState.isCanvasFullscreen ? "true" : "false");
    canvasFullscreenToggleBtn.setAttribute("data-icon", uiState.isCanvasFullscreen ? "⤡" : "⤢");
    canvasFullscreenToggleBtn.textContent = uiState.isCanvasFullscreen ? "Exit full screen" : "Full screen";
    canvasFullscreenToggleBtn.title = uiState.isCanvasFullscreen ? "Exit full screen" : "Full screen";
  }
}

function setCanvasZoomLevelIndex(nextIndex) {
  const boundedIndex = Math.max(0, Math.min(CANVAS_ZOOM_LEVELS.length - 1, Number(nextIndex) || 0));
  if (boundedIndex === uiState.canvasZoomLevelIndex) {
    syncCanvasViewportControls();
    return;
  }
  uiState.canvasZoomLevelIndex = boundedIndex;
  syncCanvasViewportControls();
}

function toggleCanvasFullscreen(force = null) {
  const nextValue = force === null ? !uiState.isCanvasFullscreen : Boolean(force);
  if (nextValue === uiState.isCanvasFullscreen) {
    syncCanvasViewportControls();
    return;
  }
  uiState.isCanvasFullscreen = nextValue;
  syncCanvasViewportControls();
  requestCanvasPanelRender({ deferForStreaming: false });
}

function readCanvasWidthPreference() {
  try {
    const value = Number.parseInt(localStorage.getItem(CANVAS_PANEL_WIDTH_STORAGE_KEY) || "", 10);
    return Number.isFinite(value) ? value : CANVAS_PANEL_DEFAULT_WIDTH;
  } catch (_) {
    return CANVAS_PANEL_DEFAULT_WIDTH;
  }
}

function clampCanvasWidth(width) {
  const viewportLimit = Math.max(CANVAS_PANEL_MIN_WIDTH, globalThis.innerWidth - 24);
  return Math.min(Math.max(width, CANVAS_PANEL_MIN_WIDTH), Math.min(CANVAS_PANEL_MAX_WIDTH, viewportLimit));
}

function applyCanvasPanelWidth(width, persist = true) {
  if (!canvasPanel || globalThis.innerWidth <= 900) {
    if (canvasPanel) {
      canvasPanel.style.width = "";
    }
    return;
  }
  const nextWidth = clampCanvasWidth(width);
  canvasPanel.style.width = `${nextWidth}px`;
  if (persist) {
    try {
      localStorage.setItem(CANVAS_PANEL_WIDTH_STORAGE_KEY, String(nextWidth));
    } catch (_) {
      // Ignore storage errors.
    }
  }
}
