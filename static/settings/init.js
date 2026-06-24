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
  const fetchHtmlConverterEl = document.getElementById("fetch-html-converter-select");
  const temperatureEl = document.getElementById("temperature-input");
  const maxStepsEl = document.getElementById("max-steps-input");
  const maxParallelToolsEl = document.getElementById("max-parallel-tools-input");
  const searchToolQueryLimitEl = document.getElementById("search-tool-query-limit-input");
  const clarificationMaxQuestionsEl = document.getElementById("clarification-max-questions-input");
  const openrouterPromptCacheEnabledEl = document.getElementById("openrouter-prompt-cache-enabled-toggle");
  const openrouterAnthropicCacheTtlEls = document.querySelectorAll("input[name='openrouter-anthropic-cache-ttl']");
  const subAgentMaxStepsEl = document.getElementById("sub-agent-max-steps-input");
  const subAgentTimeoutSecondsEl = document.getElementById("sub-agent-timeout-seconds-input");
  const subAgentRetryAttemptsEl = document.getElementById("sub-agent-retry-attempts-input");
  const subAgentRetryDelaySecondsEl = document.getElementById("sub-agent-retry-delay-seconds-input");
  const subAgentMaxParallelToolsEl = document.getElementById("sub-agent-max-parallel-tools-input");
  const webCacheTtlHoursEl = document.getElementById("web-cache-ttl-hours-input");
  const summaryModeEl = document.getElementById("summary-mode-select");
  const summaryDetailLevelEl = document.getElementById("summary-detail-level-select");
  const summaryTriggerEl = document.getElementById("summary-trigger-input");
  const summarySkipFirstEl = document.getElementById("summary-skip-first-input");
  const summarySkipLastEl = document.getElementById("summary-skip-last-input");
  const promptPreflightSummaryTokenCountEl = document.getElementById("prompt-preflight-summary-token-count-input");
  const summarySourceTargetTokensEl = document.getElementById("summary-source-target-tokens-input");
  const summaryRetryMinSourceTokensEl = document.getElementById("summary-retry-min-source-tokens-input");
  const promptMaxInputTokensEl = document.getElementById("prompt-max-input-tokens-input");
  const promptResponseTokenReserveEl = document.getElementById("prompt-response-token-reserve-input");
  const promptRecentHistoryMaxTokensEl = document.getElementById("prompt-recent-history-max-tokens-input");
  const promptSummaryMaxTokensEl = document.getElementById("prompt-summary-max-tokens-input");
  const promptRagMaxTokensEl = document.getElementById("prompt-rag-max-tokens-input");
  const promptToolTraceMaxTokensEl = document.getElementById("prompt-tool-trace-max-tokens-input");
  const ragSensitivityEl = document.getElementById("rag-sensitivity-select");
  const ragContextSizeEl = document.getElementById("rag-context-size-select");
  const ragAutoInjectEnabledEl = document.getElementById("rag-auto-inject-enabled-toggle");
  const contextCompactionThresholdEl = document.getElementById("context-compaction-threshold-input");
  const contextCompactionKeepRecentRoundsEl = document.getElementById("context-compaction-keep-recent-rounds-input");
  const canvasPromptMaxLinesEl = document.getElementById("canvas-prompt-max-lines-input");
  const canvasPromptMaxTokensEl = document.getElementById("canvas-prompt-max-tokens-input");
  const canvasPromptMaxCharsEl = document.getElementById("canvas-prompt-max-chars-input");
  const reasoningAutoCollapseEl = document.getElementById("reasoning-auto-collapse-toggle");
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
    fetchHtmlConverterEl?.addEventListener("change", getMarkDirty());
    temperatureEl?.addEventListener("input", getMarkDirty());
    maxStepsEl?.addEventListener("input", getMarkDirty());
    maxParallelToolsEl?.addEventListener("input", getMarkDirty());
    searchToolQueryLimitEl?.addEventListener("input", getMarkDirty());
    clarificationMaxQuestionsEl?.addEventListener("input", getMarkDirty());
    openrouterPromptCacheEnabledEl?.addEventListener("change", getMarkDirty());
    openrouterAnthropicCacheTtlEls.forEach((el) => el.addEventListener("change", getMarkDirty()));
    subAgentMaxStepsEl?.addEventListener("input", getMarkDirty());
    subAgentTimeoutSecondsEl?.addEventListener("input", getMarkDirty());
    subAgentRetryAttemptsEl?.addEventListener("input", getMarkDirty());
    subAgentRetryDelaySecondsEl?.addEventListener("input", getMarkDirty());
    subAgentMaxParallelToolsEl?.addEventListener("input", getMarkDirty());
    webCacheTtlHoursEl?.addEventListener("input", getMarkDirty());
    summaryModeEl?.addEventListener("change", getMarkDirty());
    summaryDetailLevelEl?.addEventListener("change", getMarkDirty());
    summaryTriggerEl?.addEventListener("input", getMarkDirty());
    summarySkipFirstEl?.addEventListener("input", getMarkDirty());
    summarySkipLastEl?.addEventListener("input", getMarkDirty());
    promptPreflightSummaryTokenCountEl?.addEventListener("input", getMarkDirty());
    summarySourceTargetTokensEl?.addEventListener("input", getMarkDirty());
    summaryRetryMinSourceTokensEl?.addEventListener("input", getMarkDirty());
    promptMaxInputTokensEl?.addEventListener("input", getMarkDirty());
    promptResponseTokenReserveEl?.addEventListener("input", getMarkDirty());
    promptRecentHistoryMaxTokensEl?.addEventListener("input", getMarkDirty());
    promptSummaryMaxTokensEl?.addEventListener("input", getMarkDirty());
    promptRagMaxTokensEl?.addEventListener("input", getMarkDirty());
    promptToolTraceMaxTokensEl?.addEventListener("input", getMarkDirty());
    ragSensitivityEl?.addEventListener("change", getMarkDirty());
    ragContextSizeEl?.addEventListener("change", getMarkDirty());
    ragAutoInjectEnabledEl?.addEventListener("change", getMarkDirty());
    contextCompactionThresholdEl?.addEventListener("input", getMarkDirty());
    contextCompactionKeepRecentRoundsEl?.addEventListener("input", getMarkDirty());
    canvasPromptMaxLinesEl?.addEventListener("input", getMarkDirty());
    canvasPromptMaxTokensEl?.addEventListener("input", getMarkDirty());
    canvasPromptMaxCharsEl?.addEventListener("input", getMarkDirty());
    reasoningAutoCollapseEl?.addEventListener("change", getMarkDirty());

    // Pruning controls
    document.getElementById("pruning-enabled-toggle")?.addEventListener("change", getMarkDirty());
    document.getElementById("pruning-aggressive-keep-count-input")?.addEventListener("input", getMarkDirty());
    document.getElementById("pruning-failed-attempts-threshold-input")?.addEventListener("input", getMarkDirty());

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
