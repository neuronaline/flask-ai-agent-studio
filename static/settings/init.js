// Settings init — event listeners, beforeunload, keyboard shortcut
(function () {
  "use strict";

  // ─── DOM refs ────────────────────────────────────────────────────────────────
  const imageProcessingMethodEl = document.getElementById("image-processing-method-select");
  const openrouterHttpRefererEl = document.getElementById("openrouter-http-referer-input");
  const openrouterAppTitleEl = document.getElementById("openrouter-app-title-input");
  const loginSessionTimeoutMinutesEl = document.getElementById("login-session-timeout-minutes-input");
  const loginMaxFailedAttemptsEl = document.getElementById("login-max-failed-attempts-input");
  const loginLockoutSecondsEl = document.getElementById("login-lockout-seconds-input");
  const loginRememberSessionDaysEl = document.getElementById("login-remember-session-days-input");
  const conversationMemoryEnabledEl = document.getElementById("conversation-memory-enabled-toggle");
  const conversationTruncationEnabledEl = document.getElementById("conversation-truncation-enabled-toggle");
  const conversationMaxMessagesEl = document.getElementById("conversation-max-messages-input");
  const conversationMaxMessageCharsEl = document.getElementById("conversation-max-message-chars-input");
  const ocrEnabledEl = document.getElementById("ocr-enabled-toggle");
  const ragEnabledEl = document.getElementById("rag-enabled-toggle");
  const youtubeTranscriptsEnabledEl = document.getElementById("youtube-transcripts-enabled-toggle");
  const chatSummaryModelEl = document.getElementById("chat-summary-model-select");
  const ragChunkSizeEl = document.getElementById("rag-chunk-size-input");
  const ragChunkOverlapEl = document.getElementById("rag-chunk-overlap-input");
  const ragMaxChunksPerSourceEl = document.getElementById("rag-max-chunks-per-source-input");
  const ragSearchTopKEl = document.getElementById("rag-search-top-k-input");
  const ragSearchMinSimilarityEl = document.getElementById("rag-search-min-similarity-input");
  const ragQueryExpansionEnabledEl = document.getElementById("rag-query-expansion-enabled-toggle");
  const ragQueryExpansionMaxVariantsEl = document.getElementById("rag-query-expansion-max-variants-input");
  const fetchRawMaxTextCharsEl = document.getElementById("fetch-raw-max-text-chars-input");
  const fetchSummaryMaxCharsEl = document.getElementById("fetch-summary-max-chars-input");
  const saveButtons = Array.from(document.querySelectorAll(".settings-save-trigger"));

  // ─── Delegated helpers ───────────────────────────────────────────────────────
  function getMarkDirty() {
    return window.__settingsCore?.markDirty ?? (() => {});
  }

  function getSaveAllSettings() {
    return window.saveAllSettings ?? (() => {});
  }

  // ─── Event listeners ─────────────────────────────────────────────────────────
  function attachEventListeners() {
    imageProcessingMethodEl?.addEventListener("change", getMarkDirty());
    openrouterHttpRefererEl?.addEventListener("input", getMarkDirty());
    openrouterAppTitleEl?.addEventListener("input", getMarkDirty());
    loginSessionTimeoutMinutesEl?.addEventListener("input", getMarkDirty());
    loginMaxFailedAttemptsEl?.addEventListener("input", getMarkDirty());
    loginLockoutSecondsEl?.addEventListener("input", getMarkDirty());
    loginRememberSessionDaysEl?.addEventListener("input", getMarkDirty());
    conversationMemoryEnabledEl?.addEventListener("change", getMarkDirty());
    conversationTruncationEnabledEl?.addEventListener("change", getMarkDirty());
    conversationMaxMessagesEl?.addEventListener("input", getMarkDirty());
    conversationMaxMessageCharsEl?.addEventListener("input", getMarkDirty());
    ocrEnabledEl?.addEventListener("change", getMarkDirty());
    ragEnabledEl?.addEventListener("change", getMarkDirty());
    youtubeTranscriptsEnabledEl?.addEventListener("change", getMarkDirty());
    chatSummaryModelEl?.addEventListener("change", getMarkDirty());
    ragChunkSizeEl?.addEventListener("input", getMarkDirty());
    ragChunkOverlapEl?.addEventListener("input", getMarkDirty());
    ragMaxChunksPerSourceEl?.addEventListener("input", getMarkDirty());
    ragSearchTopKEl?.addEventListener("input", getMarkDirty());
    ragSearchMinSimilarityEl?.addEventListener("input", getMarkDirty());
    ragQueryExpansionEnabledEl?.addEventListener("change", getMarkDirty());
    ragQueryExpansionMaxVariantsEl?.addEventListener("input", getMarkDirty());
    fetchRawMaxTextCharsEl?.addEventListener("input", getMarkDirty());
    fetchSummaryMaxCharsEl?.addEventListener("input", getMarkDirty());

    saveButtons.forEach((button) => {
      button.addEventListener("click", () => void getSaveAllSettings()());
    });
  }

  // ─── beforeunload handler ────────────────────────────────────────────────────
  function attachBeforeUnloadHandler() {
    window.addEventListener("beforeunload", (event) => {
      const hasUnsavedSettingsChanges = window.__settingsCore?.hasUnsavedSettingsChanges ?? false;
      const hasPersonaChanges = window.__personaModule?.hasUnsavedPersonaChanges?.() ?? false;
      if (!hasUnsavedSettingsChanges && !hasPersonaChanges) return;
      event.preventDefault();
      event.returnValue = "";
    });
  }

  // ─── Keyboard shortcut (Ctrl+S / Cmd+S) ─────────────────────────────────────
  function attachKeyboardShortcutHandler() {
    window.addEventListener("keydown", (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void getSaveAllSettings()();
      }
    });
  }

  // ─── Initialize ─────────────────────────────────────────────────────────────
  function initialize() {
    attachEventListeners();
    attachBeforeUnloadHandler();
    attachKeyboardShortcutHandler();
  }

  // ─── Export ──────────────────────────────────────────────────────────────────
  window.__settingsInit = {
    initialize,
    attachEventListeners,
    attachBeforeUnloadHandler,
    attachKeyboardShortcutHandler,
  };

  // Self-initialize — DOM is ready when this IIFE runs (loaded at end of body)
  initialize();
})();
