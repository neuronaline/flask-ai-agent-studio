// CSRF and bootstrap data loaded via /static/shared/csrf-utils.js
const appSettings = window.__appSettings || {};
const csrfToken = window.__csrfToken || "";
const knownModelOptions = Array.isArray(appSettings.available_models) ? appSettings.available_models : [];

const messagesEl = document.getElementById("messages");
const inputEl = document.getElementById("user-input");
const slashCommandMenuEl = document.getElementById("slash-command-menu");
const imageInputEl = document.getElementById("image-input");
const docInputEl = document.getElementById("doc-input");
const attachBtn = document.getElementById("attach-btn");
const youtubeUrlBtn = document.getElementById("youtube-url-btn");
const attachmentPreviewEl = document.getElementById("attachment-preview");
const chatAreaEl = document.getElementById("chat-area");
const chatDropOverlay = document.getElementById("chat-drop-overlay");
const cancelBtn = document.getElementById("cancel-btn");
const fixBtn = document.getElementById("fix-btn");
const sendBtn = document.getElementById("send-btn");
const modelSel = document.getElementById("model-select");
const mobileModelSel = document.getElementById("mobile-model-select");
const personaSel = document.getElementById("persona-select");
const mobilePersonaSel = document.getElementById("mobile-persona-select");
const emptyState = document.getElementById("empty-state");
const errorArea = document.getElementById("error-area");
const editBanner = document.getElementById("edit-banner");
const editBannerText = document.getElementById("edit-banner-text");
const editBannerCancelBtn = document.getElementById("edit-banner-cancel");
const canvasToggleBtn = document.getElementById("canvas-toggle-btn");
const summaryToggleBtn = document.getElementById("summary-toggle-btn");

const canvasPanel = document.getElementById("canvas-panel");
const canvasOverlay = document.getElementById("canvas-overlay");
const canvasClose = document.getElementById("canvas-close");
const canvasSearchInput = document.getElementById("canvas-search-input");
const canvasSearchStatus = document.getElementById("canvas-search-status");
const canvasFormatSelect = document.getElementById("canvas-format-select");
const canvasRoleFilter = document.getElementById("canvas-role-filter");
const canvasPathFilter = document.getElementById("canvas-path-filter");
const canvasTreePanel = document.getElementById("canvas-tree-panel");
const canvasTreeCount = document.getElementById("canvas-tree-count");
const canvasTreeEl = document.getElementById("canvas-tree");
const canvasTreeToggleBtn = document.getElementById("canvas-tree-toggle");
const canvasZoomOutBtn = document.getElementById("canvas-zoom-out-btn");
const canvasZoomInBtn = document.getElementById("canvas-zoom-in-btn");
const canvasFullscreenToggleBtn = document.getElementById("canvas-fullscreen-toggle");
const canvasViewportActionsGroupEl = document.getElementById("canvas-actions-viewport");
const canvasSubtitle = document.getElementById("canvas-subtitle");
const canvasStatus = document.getElementById("canvas-status");
const canvasHint = document.getElementById("canvas-hint");
const canvasEmptyState = document.getElementById("canvas-empty-state");
const canvasEditorEl = document.getElementById("canvas-editor");
const canvasDocumentEl = document.getElementById("canvas-document");
const canvasWorkspaceMain = canvasDocumentEl?.closest(".canvas-workspace-main") || null;
const canvasDocumentTabsEl = document.getElementById("canvas-document-tabs");
const canvasMetaBar = document.getElementById("canvas-meta-bar");
const canvasMetaChips = document.getElementById("canvas-meta-chips");
const canvasCopyRefBtn = document.getElementById("canvas-copy-ref-btn");
const canvasResetFiltersBtn = document.getElementById("canvas-reset-filters-btn");
const canvasEditBtn = document.getElementById("canvas-edit-btn");
const canvasNewBtn = document.getElementById("canvas-new-btn");
const canvasUploadBtn = document.getElementById("canvas-upload-btn");
const canvasImportGithubBtn = document.getElementById("canvas-import-github-btn");
const canvasUploadInput = document.getElementById("canvas-upload-input");
const canvasSaveBtn = document.getElementById("canvas-save-btn");
const canvasCancelBtn = document.getElementById("canvas-cancel-btn");
const canvasCopyBtn = document.getElementById("canvas-copy-btn");
const canvasDeleteBtn = document.getElementById("canvas-delete-btn");
const canvasClearBtn = document.getElementById("canvas-clear-btn");
const canvasRenameBtn = document.getElementById("canvas-rename-btn");
const canvasDownloadHtmlBtn = document.getElementById("canvas-download-html-btn");
const canvasDownloadMdBtn = document.getElementById("canvas-download-md-btn");
const canvasDownloadPdfBtn = document.getElementById("canvas-download-pdf-btn");
const canvasMoreBtn = document.getElementById("canvas-more-btn");
const canvasOverflowMenu = document.getElementById("canvas-overflow-menu");
const canvasResizeHandle = document.getElementById("canvas-resize-handle");
const canvasBtnIndicator = document.getElementById("canvas-btn-indicator");
const canvasConfirmModal = document.getElementById("canvas-confirm-modal");
const canvasConfirmOverlay = document.getElementById("canvas-confirm-overlay");
const canvasConfirmTitle = document.getElementById("canvas-confirm-title");
const canvasConfirmMessage = document.getElementById("canvas-confirm-message");
const canvasConfirmOpenBtn = document.getElementById("canvas-confirm-open");
const canvasConfirmLaterBtn = document.getElementById("canvas-confirm-later");
const canvasConfirmCloseBtn = document.getElementById("canvas-confirm-close");
const tokensBadge = document.getElementById("tokens-badge");
const statsPanel = document.getElementById("stats-panel");
const statsOverlay = document.getElementById("stats-overlay");
const statsClose = document.getElementById("stats-close");
const headerEl = document.querySelector("header");
const sidebarList = document.getElementById("sidebar-list");
const sidebarToggleBtn = document.getElementById("sidebar-toggle-btn");
const sidebarOverlay = document.getElementById("sidebar-overlay");

const newChatBtn = document.getElementById("new-chat-btn");
const mobileToolsBtn = document.getElementById("mobile-tools-btn");
const mobileToolsPanel = document.getElementById("mobile-tools-panel");
const mobileToolsOverlay = document.getElementById("mobile-tools-overlay");
const mobileToolsClose = document.getElementById("mobile-tools-close");
const mobileCanvasBtn = document.getElementById("mobile-canvas-btn");
const mobileExportBtn = document.getElementById("mobile-export-btn");
const mobileSettingsBtn = document.getElementById("mobile-settings-btn");
const mobileLogoutBtn = document.getElementById("mobile-logout-btn");
const mobileTokensBtn = document.getElementById("mobile-tokens-btn");
const exportPanel = document.getElementById("export-panel");
const exportOverlay = document.getElementById("export-overlay");
const exportClose = document.getElementById("export-close");
const exportSubtitle = document.getElementById("export-subtitle");
const exportStatus = document.getElementById("export-status");
const summaryPanel = document.getElementById("summary-panel");
const summaryOverlay = document.getElementById("summary-overlay");
const summaryClose = document.getElementById("summary-close");

const summaryFocusPresetGrid = document.getElementById("summary-focus-presets");
const summaryFocusInput = document.getElementById("summary-focus-input");
const summaryDetailSelect = document.getElementById("summary-detail-select");
const summaryDetailOptionGrid = document.getElementById("summary-detail-options");
const summarySubmitBtn = document.getElementById("summary-submit-btn");
const summaryProgress = document.getElementById("summary-progress");
const summaryProgressLabel = document.getElementById("summary-progress-label");
const summaryProgressValue = document.getElementById("summary-progress-value");
const summaryProgressBar = document.getElementById("summary-progress-bar");
const summaryProgressTrack = summaryProgress?.querySelector(".summary-progress__track") || null;

const mobileSummaryBtn = document.getElementById("mobile-summary-btn");
const conversationExportMdBtn = document.getElementById("conversation-export-md-btn");
const conversationExportJsonBtn = document.getElementById("conversation-export-json-btn");
const conversationExportDocxBtn = document.getElementById("conversation-export-docx-btn");
const conversationExportPdfBtn = document.getElementById("conversation-export-pdf-btn");
const historySelectionBar = document.getElementById("history-selection-bar");
const historySelectionLabel = document.getElementById("history-selection-label");
const historySelectionDetail = document.getElementById("history-selection-detail");
const historySelectionClear = document.getElementById("history-selection-clear");

// Initialize summary UI after DOM elements are available (functions defined in summary.js)
renderSummaryFocusPresets();
renderSummaryDetailOptions();

let activeSidebarRename = null;
let collapsedCanvasFolders = new Set();
let lastCanvasTreeTypeAheadValue = "";
let lastCanvasTreeTypeAheadAt = 0;
let chatDragDepth = 0;
let editingMessageId = null;
let inlineEditingMessageId = null;
let inlineEditingDraft = "";
let savingEditedMessageId = null;
let pendingDeleteMessageId = null;
let deletingMessageId = null;
let activeDeleteMessageAbortController = null;
let lastExportTriggerEl = null;
let lastSummaryTriggerEl = null;
const featureFlags = window.__featureFlags || appSettings.features || {};
chatState.conversationMemoryEnabled = featureFlags.conversation_memory_enabled !== false;
if (youtubeUrlBtn && !Boolean(featureFlags.youtube_transcripts_enabled)) {
  youtubeUrlBtn.hidden = true;
}
const CANVAS_CODE_FILE_EXTENSIONS = new Set([
  ".bat",
  ".c",
  ".cc",
  ".cfg",
  ".conf",
  ".cpp",
  ".cs",
  ".css",
  ".env",
  ".go",
  ".h",
  ".hpp",
  ".html",
  ".ini",
  ".java",
  ".js",
  ".json",
  ".jsx",
  ".kt",
  ".kts",
  ".less",
  ".lua",
  ".mjs",
  ".php",
  ".ps1",
  ".py",
  ".rb",
  ".rs",
  ".sass",
  ".scss",
  ".sh",
  ".sql",
  ".swift",
  ".toml",
  ".ts",
  ".tsx",
  ".vue",
  ".xml",
  ".yaml",
  ".yml",
  ".zsh",
]);



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



statsClose.addEventListener("click", closeStats);
statsOverlay.addEventListener("click", closeStats);
if (canvasClose) {
  canvasClose.addEventListener("click", closeCanvas);
}
if (canvasOverlay) {
  canvasOverlay.addEventListener("click", closeCanvas);
}
if (canvasZoomOutBtn) {
  canvasZoomOutBtn.addEventListener("click", () => {
    setCanvasZoomLevelIndex(uiState.canvasZoomLevelIndex - 1);
  });
}
if (canvasZoomInBtn) {
  canvasZoomInBtn.addEventListener("click", () => {
    setCanvasZoomLevelIndex(uiState.canvasZoomLevelIndex + 1);
  });
}
if (canvasFullscreenToggleBtn) {
  canvasFullscreenToggleBtn.addEventListener("click", () => {
    toggleCanvasFullscreen();
  });
}
if (canvasEditBtn) {
  canvasEditBtn.addEventListener("click", () => setCanvasEditing(true));
}
if (canvasNewBtn) {
  canvasNewBtn.addEventListener("click", () => {
    void createCanvasDocumentFromPrompt();
  });
}
if (canvasUploadBtn) {
  canvasUploadBtn.addEventListener("click", () => {
    openCanvasUploadPicker();
  });
}
if (canvasImportGithubBtn) {
  canvasImportGithubBtn.addEventListener("click", () => {
    void importGithubRepositoryToCanvas();
  });
}
if (canvasUploadInput) {
  canvasUploadInput.addEventListener("change", () => {
    const selectedFile = canvasUploadInput.files?.[0] || null;
    if (!selectedFile) {
      return;
    }
    canvasUploadInput.value = "";
    void createCanvasDocumentFromFile(selectedFile);
  });
}
if (canvasSaveBtn) {
  canvasSaveBtn.addEventListener("click", () => {
    void saveCanvasEdits();
  });
}
if (canvasCancelBtn) {
  canvasCancelBtn.addEventListener("click", () => {
    cancelCanvasEditing({ statusMessage: "Canvas edit cancelled.", tone: "muted" });
  });
}
if (mobileCanvasBtn) {
  mobileCanvasBtn.addEventListener("click", () => openCanvas(mobileToolsBtn || mobileCanvasBtn, { deferPanelRender: false }));
}
if (canvasToggleBtn) {
  canvasToggleBtn.addEventListener("click", () => {
    if (isCanvasOpen()) {
      closeCanvas();
    } else {
      openCanvas(canvasToggleBtn, { deferPanelRender: false });
    }
  });
}
if (summaryToggleBtn) {
  summaryToggleBtn.addEventListener("click", () => {
    if (isSummaryPanelOpen()) {
      closeSummaryPanel();
    } else {
      openSummaryPanel(summaryToggleBtn);
    }
  });
}
if (mobileExportBtn) {
  mobileExportBtn.addEventListener("click", () => openExportPanel(mobileToolsBtn || mobileExportBtn));
}
if (exportClose) {
  exportClose.addEventListener("click", closeExportPanel);
}
if (exportOverlay) {
  exportOverlay.addEventListener("click", closeExportPanel);
}
if (conversationExportMdBtn) {
  conversationExportMdBtn.addEventListener("click", () => downloadConversation("md"));
}
if (conversationExportJsonBtn) {
  conversationExportJsonBtn.addEventListener("click", () => downloadConversation("json"));
}
if (conversationExportDocxBtn) {
  conversationExportDocxBtn.addEventListener("click", () => downloadConversation("docx"));
}
if (conversationExportPdfBtn) {
  conversationExportPdfBtn.addEventListener("click", () => downloadConversation("pdf"));
}
if (canvasCopyBtn) {
  canvasCopyBtn.addEventListener("click", async () => {
    closeCanvasOverflowMenu();
    const document = getCanvasDocumentById(getCanvasRenderableDocuments(), canvasState.activeCanvasDocumentId) || getActiveCanvasDocument();
    if (!document) {
      setCanvasStatus("Clipboard is not available.", "warning");
      return;
    }
    try {
      const copied = await copyTextToClipboard(document.content || "");
      if (!copied) {
        setCanvasStatus("Clipboard is not available.", "warning");
        return;
      }
      setCanvasStatus("Canvas copied to clipboard.", "success");
    } catch (_) {
      setCanvasStatus("Copy failed.", "danger");
    }
  });
}
if (canvasCopyRefBtn) {
  canvasCopyRefBtn.addEventListener("click", async () => {
    const document = getCanvasDocumentById(getCanvasRenderableDocuments(), canvasState.activeCanvasDocumentId) || getActiveCanvasDocument();
    const reference = getCanvasDocumentLabel(document);
    if (!reference) {
      setCanvasStatus("Reference copy is not available.", "warning");
      return;
    }
    try {
      const copied = await copyTextToClipboard(reference);
      if (!copied) {
        setCanvasStatus("Reference copy is not available.", "warning");
        return;
      }
      setCanvasStatus(document?.path ? "Canvas path copied." : "Canvas title copied.", "success");
    } catch (_) {
      setCanvasStatus("Reference copy failed.", "danger");
    }
  });
}
if (canvasResetFiltersBtn) {
  canvasResetFiltersBtn.addEventListener("click", () => resetCanvasFilters());
}
if (canvasDeleteBtn) {
  canvasDeleteBtn.addEventListener("click", () => {
    closeCanvasOverflowMenu();
    void deleteCanvasDocuments();
  });
}
if (canvasRenameBtn) {
  canvasRenameBtn.addEventListener("click", () => {
    closeCanvasOverflowMenu();
    void renameCanvasDocument();
  });
}
if (canvasClearBtn) {
  canvasClearBtn.addEventListener("click", () => {
    closeCanvasOverflowMenu();
    void deleteCanvasDocuments({ clearAll: true });
  });
}
if (canvasDownloadHtmlBtn) {
  canvasDownloadHtmlBtn.addEventListener("click", () => {
    closeCanvasOverflowMenu();
    downloadCanvasDocument("html");
  });
}
if (canvasDownloadMdBtn) {
  canvasDownloadMdBtn.addEventListener("click", () => {
    closeCanvasOverflowMenu();
    downloadCanvasDocument("md");
  });
}
if (canvasDownloadPdfBtn) {
  canvasDownloadPdfBtn.addEventListener("click", () => {
    closeCanvasOverflowMenu();
    downloadCanvasDocument("pdf");
  });
}
if (canvasMoreBtn) {
  canvasMoreBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleCanvasOverflowMenu();
  });
  canvasMoreBtn.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      openCanvasOverflowMenu({ focusTarget: "first" });
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      openCanvasOverflowMenu({ focusTarget: "last" });
      return;
    }
    if (event.key === "Escape" && isCanvasOverflowMenuOpen()) {
      event.preventDefault();
      closeCanvasOverflowMenu({ restoreFocus: true });
    }
  });
}
if (canvasOverflowMenu) {
  canvasOverflowMenu.addEventListener("keydown", handleCanvasOverflowMenuKeydown);
}
if (canvasTreeToggleBtn) {
  canvasTreeToggleBtn.addEventListener("click", () => {
    closeCanvasOverflowMenu();
    setCanvasMobileTreeOpen(!uiState.isCanvasMobileTreeOpen);
  });
}
if (canvasSearchInput) {
  canvasSearchInput.addEventListener("input", () => renderCanvasPanel());
}
if (canvasRoleFilter) {
  canvasRoleFilter.addEventListener("change", () => renderCanvasPanel());
}
if (canvasPathFilter) {
  canvasPathFilter.addEventListener("change", () => renderCanvasPanel());
}
if (canvasFormatSelect) {
  canvasFormatSelect.addEventListener("change", () => {
    if (canvasState.isCanvasEditing) {
      scheduleCanvasEditingPreviewRender();
    }
  });
}
if (canvasEditorEl) {
  canvasEditorEl.addEventListener("input", () => {
    scheduleCanvasEditingPreviewRender();
  });
  canvasEditorEl.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      void saveCanvasEdits();
    }
  });
}
if (sidebarToggleBtn) {
  sidebarToggleBtn.addEventListener("click", toggleSidebar);
}
if (sidebarOverlay) {
  sidebarOverlay.addEventListener("click", () => setSidebarOpen(false));
}
if (mobileToolsBtn) {
  mobileToolsBtn.addEventListener("click", () => {
    if (mobileToolsPanel?.classList.contains("open")) {
      closeMobileTools();
    } else {
      openMobileTools();
    }
  });
}
if (mobileToolsClose) {
  mobileToolsClose.addEventListener("click", closeMobileTools);
}
if (mobileToolsOverlay) {
  mobileToolsOverlay.addEventListener("click", closeMobileTools);
}
if (canvasConfirmOverlay) {
  canvasConfirmOverlay.addEventListener("click", () => closeCanvasConfirmModal("dismiss"));
}
if (canvasConfirmCloseBtn) {
  canvasConfirmCloseBtn.addEventListener("click", () => closeCanvasConfirmModal("dismiss"));
}
if (canvasConfirmLaterBtn) {
  canvasConfirmLaterBtn.addEventListener("click", () => closeCanvasConfirmModal("cancel"));
}
if (canvasConfirmOpenBtn) {
  canvasConfirmOpenBtn.addEventListener("click", () => closeCanvasConfirmModal("confirm"));
}
if (mobileTokensBtn) {
  mobileTokensBtn.addEventListener("click", () => {
    openStats();
    closeMobileTools();
  });
}
if (mobileSettingsBtn) {
  mobileSettingsBtn.addEventListener("click", closeMobileTools);
}
if (mobileLogoutBtn) {
  mobileLogoutBtn.addEventListener("click", closeMobileTools);
}
if (mobileSummaryBtn) {
  mobileSummaryBtn.addEventListener("click", () => openSummaryPanel(mobileSummaryBtn));
}

async function handlePersonaSelectionChange(nextPersonaId) {
  const previousPersonaId = chatState.currentConversationPersonaId;
  applyConversationPersonaSelection(nextPersonaId);
  if (!chatState.currentConvId) {
    return;
  }
  try {
    await persistConversationPersona(chatState.currentConversationPersonaId);
  } catch (error) {
    applyConversationPersonaSelection(previousPersonaId);
    showError(error.message || "Unable to update conversation persona.");
  }
}

if (modelSel) {
  modelSel.addEventListener("change", () => {
    syncModelSelectors(modelSel.value);
  });
}
if (mobileModelSel) {
  mobileModelSel.addEventListener("change", () => {
    syncModelSelectors(mobileModelSel.value);
  });
}
if (personaSel) {
  personaSel.addEventListener("change", () => {
    void handlePersonaSelectionChange(personaSel.value);
  });
}
if (mobilePersonaSel) {
  mobilePersonaSel.addEventListener("change", () => {
    void handlePersonaSelectionChange(mobilePersonaSel.value);
  });
}
summaryClose?.addEventListener("click", closeSummaryPanel);
summaryOverlay?.addEventListener("click", closeSummaryPanel);
summarySubmitBtn?.addEventListener("click", () => {
  void runConversationSummary({ triggerButton: summarySubmitBtn, closePanel: false });
});

window.addEventListener("resize", () => {
  updateHeaderOffset();
  if (!isMobileViewport()) {
    closeMobileTools();
    uiState.isCanvasFullscreen = false;
    uiState.canvasZoomLevelIndex = 0;
  }
  setCanvasMobileTreeOpen(false);
  closeCanvasOverflowMenu();
  applyCanvasPanelWidth(readCanvasWidthPreference(), false);
  syncCanvasToggleButton();
  syncCanvasViewportControls();
}, { passive: true });

if (canvasResizeHandle) {
  canvasResizeHandle.addEventListener("mousedown", (event) => {
    if (isMobileViewport()) {
      return;
    }
    event.preventDefault();
    const onMouseMove = (moveEvent) => {
      const nextWidth = window.innerWidth - moveEvent.clientX;
      applyCanvasPanelWidth(nextWidth);
    };
    const onMouseUp = () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  });
}

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && isSummaryPanelOpen()) {
    closeSummaryPanel();
    return;
  }
  if (event.key === "Escape" && isCanvasOverflowMenuOpen()) {
    closeCanvasOverflowMenu({ restoreFocus: true });
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "c") {
    event.preventDefault();
    if (isCanvasOpen()) {
      closeCanvas();
    } else {
      openCanvas(null, { deferPanelRender: false });
    }
    return;
  }
  if (event.key === "Escape") {
    if (isCanvasConfirmOpen()) {
      closeCanvasConfirmModal("dismiss");
      return;
    }
    if (isCanvasOpen()) {
      if (uiState.isCanvasMobileTreeOpen) {
        setCanvasMobileTreeOpen(false);
        return;
      }
      if (canvasState.isCanvasEditing) {
        cancelCanvasEditing({ statusMessage: "Canvas edit cancelled.", tone: "muted" });
      } else if (clearCanvasSearchInput({ statusMessage: "Canvas search cleared.", tone: "muted" })) {
        return;
      } else {
        closeCanvas();
      }
      return;
    }
    if (mobileToolsPanel?.classList.contains("open")) {
      closeMobileTools();
      return;
    }
  }
  if (event.key === "Tab" && isCanvasOpen()) {
    const focusable = getCanvasFocusableElements();
    if (!focusable.length) {
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const activeElement = document.activeElement;
    if (event.shiftKey && activeElement === first) {
      event.preventDefault();
      last.focus();
      return;
    }
    if (!event.shiftKey && activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
  if (event.key === "Escape" && !document.body.classList.contains("sidebar-collapsed") && isMobileViewport()) {
    setSidebarOpen(false);
  }
});

document.addEventListener("click", (event) => {
  const target = event.target;
  if (isCanvasOverflowMenuOpen()) {
    const clickedInsideMenu = target instanceof Node && (canvasOverflowMenu?.contains(target) || canvasMoreBtn?.contains(target));
    if (!clickedInsideMenu) {
      closeCanvasOverflowMenu();
    }
  }

  if (uiState.isCanvasMobileTreeOpen && isMobileViewport()) {
    const clickedInsideTree = target instanceof Node && (canvasTreePanel?.contains(target) || canvasTreeToggleBtn?.contains(target));
    if (!clickedInsideTree) {
      setCanvasMobileTreeOpen(false);
    }
  }
});



async function openConversation(id) {
  const response = await fetch(`/api/conversations/${id}`);
  const data = await response.json();
  if (!response.ok) {
    return;
  }

  clearPendingDeleteMessage({ render: false });
  resetTokenStats();
  chatState.history = [];
  summaryState.latestSummaryStatus = null;
  uiState.userScrolledUp = false;
  chatState.currentConvId = id;
  chatState.currentConvTitle = String(data.conversation?.title || "New Chat").trim() || "New Chat";
  chatState.currentConversationTitleSource = String(data.conversation?.title_source || "system").trim().toLowerCase() || "system";
  chatState.currentConversationTitleOverridden = data.conversation?.title_overridden === true || Number(data.conversation?.title_overridden || 0) === 1;
  chatState.currentConversationPersonaId = normalizePersonaId(data.conversation?.persona_id);
  chatState.currentConversationPersonaName = resolveConversationPersonaName(chatState.currentConversationPersonaId, data.conversation?.persona?.name || "");
  syncPersonaSelectors(chatState.currentConversationPersonaId);
  const conversationModelId = String(data.conversation?.model || "").trim();
  const nextModelId = resolvePreferredModelSelection(conversationModelId);
  if (nextModelId) {
    const nextModelLabel = nextModelId === conversationModelId
      ? (data.conversation.model_label || "")
      : getKnownModelLabel(nextModelId);
    syncModelSelectors(nextModelId, nextModelLabel);
  }
  clearEditTarget();
  clearInlineEditingTarget();
  uiState.selectedSummaryMessageIds = new Set();
  resetCanvasWorkspaceState();

  chatState.history = Array.isArray(data.messages) ? data.messages.map(normalizeHistoryEntry) : [];
  applyConversationMemoryState(data);
  applyConversationToolOverridesState(data);
  applyConversationParameterOverridesState(data);
  canvasState.streamingCanvasDocuments = [];
  resetStreamingCanvasPreview();
  canvasState.activeCanvasDocumentId = getActiveCanvasDocument(chatState.history)?.id || null;
  uiState.lastConversationSignature = getConversationSignature(chatState.history);
  renderConversationHistory();
  renderCanvasPanel();
  updateExportPanel();
  rebuildTokenStatsFromHistory();

  loadSidebar();
  scrollToBottom();
  inputEl.focus();
}

async function deleteConversation(id) {
  try {
    await fetch(`/api/conversations/${id}`, { method: "DELETE" });
    if (id === chatState.currentConvId) {
      startNewChat();
    } else {
      loadSidebar();
    }
  } catch (error) {
    showError("Could not delete conversation.");
  }
}



newChatBtn.addEventListener("click", startNewChat);

inputEl.addEventListener("input", () => {
  if (pendingDeleteMessageId !== null) {
    clearPendingDeleteMessage({ preserveScroll: true });
  }
  autoResize(inputEl);
  syncSlashCommandMenuWithInput();
});

inputEl.addEventListener("focus", () => {
  syncSlashCommandMenuWithInput();
});

inputEl.addEventListener("blur", () => {
  window.setTimeout(() => {
    if (document.activeElement !== inputEl) {
      closeSlashCommandMenu();
    }
  }, 0);
});

messagesEl.addEventListener("scroll", () => {
  if (!chatState.isStreaming) {
    return;
  }
  const distanceFromBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight;
  uiState.userScrolledUp = distanceFromBottom > 100;
});

inputEl.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && isSlashCommandMenuOpen()) {
    event.preventDefault();
    closeSlashCommandMenu();
    return;
  }

  if ((event.key === "ArrowDown" || event.key === "ArrowUp") && isSlashCommandMenuOpen() && uiState.slashCommandSuggestions.length) {
    event.preventDefault();
    moveSlashCommandSelection(event.key === "ArrowDown" ? 1 : -1);
    return;
  }

  if ((event.key === "Enter" && !event.shiftKey) || event.key === "Tab") {
    const activeSuggestion = isSlashCommandMenuOpen() ? getActiveSlashCommandSuggestion() : null;
    if (activeSuggestion) {
      event.preventDefault();
      applySlashCommandSuggestion(activeSuggestion);
      return;
    }
  }

  if (event.key === "Enter" && !event.shiftKey) {
    if ("ontouchstart" in window || navigator.maxTouchPoints > 0) return;
    event.preventDefault();
    if (!chatState.isStreaming && !chatState.isFixing) {
      sendMessage();
    }
  }
});

async function requestActiveChatCancellation() {
  chatState.activeUserCancelRequested = true;

  if (chatState.activeChatCancellationFallbackTimer !== null) {
    window.clearTimeout(chatState.activeChatCancellationFallbackTimer);
    chatState.activeChatCancellationFallbackTimer = null;
  }

  // Abort the SSE stream immediately so the UI stops streaming at once.
  if (chatState.activeAbortController) {
    chatState.activeAbortController.abort();
  }

  clearEmptyAssistantStreamingBubble();
  scrollToBottom();

  // Notify the server in the background so it can save partial output gracefully.
  const runId = String(chatState.activeChatRunId || "").trim();
  if (runId) {
    try {
      await fetch(`/api/chat-runs/${encodeURIComponent(runId)}/cancel`, {
        method: "POST",
        keepalive: true,
      });
    } catch (_error) {
      // ignore — the stream is already aborted client-side
    }
  }
}

cancelBtn.addEventListener("click", () => {
  void requestActiveChatCancellation();
});

editBannerCancelBtn.addEventListener("click", () => {
  clearEditTarget();
  inputEl.focus();
});

sendBtn.addEventListener("click", () => {
  if (!chatState.isStreaming && !chatState.isFixing) {
    sendMessage();
  }
});
messagesEl.addEventListener("click", (event) => {
  const button = event.target.closest(".code-copy-btn");
  if (!(button instanceof HTMLButtonElement)) {
    return;
  }
  event.preventDefault();
  void copyCodeBlock(button);
});
canvasDocumentEl?.addEventListener("click", (event) => {
  const button = event.target.closest(".code-copy-btn");
  if (!(button instanceof HTMLButtonElement)) {
    return;
  }
  event.preventDefault();
  void copyCodeBlock(button);
});
fixBtn.addEventListener("click", () => {
  if (!chatState.isStreaming && !chatState.isFixing) {
    fixMessage();
  }
});
attachBtn.addEventListener("click", () => {
  if (chatState.isStreaming || chatState.isFixing) return;
  imageInputEl.click();
});

attachBtn.addEventListener("contextmenu", (e) => {
  if (chatState.isStreaming || chatState.isFixing) return;
  e.preventDefault();
  docInputEl.click();
});

imageInputEl.addEventListener("change", () => {
  const files = Array.from(imageInputEl.files || []);
  imageInputEl.value = "";
  if (!files.length) {
    return;
  }
  handleSelectedFiles(files);
});

docInputEl.addEventListener("change", () => {
  const files = Array.from(docInputEl.files || []);
  docInputEl.value = "";
  if (!files.length) return;
  handleSelectedFiles(files, { documentsOnly: true });
});



youtubeUrlBtn?.addEventListener("click", () => {
  if (chatState.isStreaming || chatState.isFixing) return;
  if (!Boolean(featureFlags.youtube_transcripts_enabled)) {
    showError("YouTube transcript feature is disabled in .env.");
    return;
  }
  promptForYouTubeUrl();
});




async function fixMessage() {
  const text = inputEl.value.trim();
  if (!text) {
    return;
  }

  clearToastRegion();
  setFixing(true);

  try {
    const response = await fetch("/api/fix-text", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });

    const data = await response.json().catch(() => ({ error: "An unexpected error occurred." }));
    if (!response.ok) {
      throw new Error(data.error || "An unexpected error occurred.");
    }

    inputEl.value = data.text || text;
    autoResize(inputEl);
    inputEl.focus();
    inputEl.setSelectionRange(inputEl.value.length, inputEl.value.length);
  } catch (error) {
    showError(error.message);
  } finally {
    setFixing(false);
  }
}



async function generateTitle(convId) {
  try {
    const response = await fetch(`/api/conversations/${convId}/generate-title`, { method: "POST" });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      console.warn(data.error || "Conversation title generation failed.");
    }
  } catch (error) {
    console.warn("Failed to generate title:", error);
  } finally {
    loadSidebar();
  }
}

clearEditTarget();
updateHeaderOffset();
applyCanvasPanelWidth(readCanvasWidthPreference(), false);
syncCanvasToggleButton();
syncCanvasViewportControls();
syncSummaryToggleButton();
renderHistorySelectionBar();
const initialSidebarPref = readSidebarPreference();
setSidebarOpen(initialSidebarPref === null ? !isMobileViewport() : initialSidebarPref, false);
const initialModelId = resolvePreferredModelSelection(modelSel ? modelSel.value : "");
syncModelSelectors(initialModelId, getKnownModelLabel(initialModelId));
applyConversationPersonaSelection("");
loadSidebar();
updateExportPanel();
