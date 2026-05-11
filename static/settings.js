// CSRF and bootstrap data loaded via /static/shared/csrf-utils.js
const appSettings = window.__appSettings || {};
const featureFlags = window.__featureFlags || appSettings.features || {};
const csrfToken = window.__csrfToken || "";

const generalInstructionsEl = document.getElementById("general-instructions-input");
const generalInstructionsTemplateSelectEl = document.getElementById("general-instructions-template-select");
const generalInstructionsTemplateApplyBtn = document.getElementById("general-instructions-template-apply-btn");
const aiPersonalityEl = document.getElementById("ai-personality-input");
const aiPersonalityTemplateSelectEl = document.getElementById("ai-personality-template-select");
const aiPersonalityTemplateApplyBtn = document.getElementById("ai-personality-template-apply-btn");
const defaultPersonaEl = document.getElementById("default-persona-select");
const openPersonasTabBtn = document.getElementById("open-personas-tab-btn");
const personaListEl = document.getElementById("persona-list");
const personaNameEl = document.getElementById("persona-name-input");
const personaSaveBtn = document.getElementById("persona-save-btn");
const personaDeleteBtn = document.getElementById("persona-delete-btn");
const personaNewBtn = document.getElementById("persona-new-btn");
const personaStatusEl = document.getElementById("persona-status");
const personaEditorTitleEl = document.getElementById("persona-editor-title");
const personaMemoryListEl = document.getElementById("persona-memory-list");
const personaMemoryKeyEl = document.getElementById("persona-memory-key-input");
const personaMemoryValueEl = document.getElementById("persona-memory-value-input");
const personaMemorySaveBtn = document.getElementById("persona-memory-save-btn");
const personaMemoryCancelBtn = document.getElementById("persona-memory-cancel-btn");
const personaMemoryDeleteBtn = document.getElementById("persona-memory-delete-btn");
const personaMemoryStatusEl = document.getElementById("persona-memory-status");
const personaMemoryNoteEl = document.getElementById("persona-memory-note");
const temperatureEl = document.getElementById("temperature-input");
const scratchpadListEl = document.getElementById("scratchpad-list");
const scratchpadAddBtn = document.getElementById("scratchpad-add-btn");
const scratchpadCountEl = document.getElementById("scratchpad-count");
const scratchpadReadonlyNoteEl = document.getElementById("scratchpad-readonly-note");
const maxStepsEl = document.getElementById("max-steps-input");
const maxParallelToolsEl = document.getElementById("max-parallel-tools-input");
const searchToolQueryLimitEl = document.getElementById("search-tool-query-limit-input");
const subAgentMaxStepsEl = document.getElementById("sub-agent-max-steps-input");
const subAgentTimeoutSecondsEl = document.getElementById("sub-agent-timeout-seconds-input");
const subAgentRetryAttemptsEl = document.getElementById("sub-agent-retry-attempts-input");
const subAgentRetryDelaySecondsEl = document.getElementById("sub-agent-retry-delay-seconds-input");
const subAgentMaxParallelToolsEl = document.getElementById("sub-agent-max-parallel-tools-input");
const subAgentCanvasAutoSaveEl = document.getElementById("sub-agent-canvas-auto-save-toggle");
const subAgentCanvasAutoOpenEl = document.getElementById("sub-agent-canvas-auto-open-toggle");
const webCacheTtlHoursEl = document.getElementById("web-cache-ttl-hours-input");
const openrouterPromptCacheEnabledEl = document.getElementById("openrouter-prompt-cache-enabled-toggle");
const openrouterAnthropicCacheTtlEls = document.querySelectorAll("input[name='openrouter-anthropic-cache-ttl']");
const openrouterAnthropicCacheTtlRowEl = document.getElementById("openrouter-anthropic-cache-ttl-row");
const clarificationMaxQuestionsEl = document.getElementById("clarification-max-questions-input");
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
const contextCompactionThresholdEl = document.getElementById("context-compaction-threshold-input");
const contextCompactionKeepRecentRoundsEl = document.getElementById("context-compaction-keep-recent-rounds-input");
const contextSelectionStrategyEl = document.getElementById("context-selection-strategy-select");
const entropyControlsFieldsetEl = document.getElementById("entropy-controls-fieldset");
const entropyRagBudgetClusterEl = document.getElementById("entropy-rag-budget-cluster");
const entropyProfileEl = document.getElementById("entropy-profile-select");
const entropyRagBudgetRatioEl = document.getElementById("entropy-rag-budget-ratio-input");
const entropyProtectCodeBlocksEl = document.getElementById("entropy-protect-code-blocks-toggle");
const entropyProtectToolResultsEl = document.getElementById("entropy-protect-tool-results-toggle");
const entropyReferenceBoostEl = document.getElementById("entropy-reference-boost-toggle");
const reasoningAutoCollapseEl = document.getElementById("reasoning-auto-collapse-toggle");
const pruningEnabledEl = document.getElementById("pruning-enabled-toggle");
const pruningControlsFieldsetEl = document.getElementById("pruning-controls-fieldset");
const pruningTokenThresholdEl = document.getElementById("pruning-token-threshold-input");
const pruningBatchSizeEl = document.getElementById("pruning-batch-size-input");
const pruningTargetReductionRatioEl = document.getElementById("pruning-target-reduction-ratio-input");
const pruningMinTargetTokensEl = document.getElementById("pruning-min-target-tokens-input");
const fetchThresholdEl = document.getElementById("fetch-threshold-input");
const fetchAggressivenessEl = document.getElementById("fetch-aggressiveness-input");
const fetchHtmlConverterModeEl = document.getElementById("fetch-html-converter-mode-select");
const fetchSummarizeMaxInputCharsEl = document.getElementById("fetch-summarize-max-input-chars-input");
const fetchSummarizeMaxOutputTokensEl = document.getElementById("fetch-summarize-max-output-tokens-input");
const canvasPromptLinesEl = document.getElementById("canvas-prompt-lines-input");
const canvasPromptTokensEl = document.getElementById("canvas-prompt-tokens-input");
const canvasPromptCharsEl = document.getElementById("canvas-prompt-chars-input");
const canvasCodeLineCharsEl = document.getElementById("canvas-code-line-chars-input");
const canvasTextLineCharsEl = document.getElementById("canvas-text-line-chars-input");
const canvasExpandLinesEl = document.getElementById("canvas-expand-lines-input");
const canvasScrollLinesEl = document.getElementById("canvas-scroll-lines-input");
const customModelNameEl = document.getElementById("custom-model-name-input");
const customModelApiModelEl = document.getElementById("custom-model-api-model-input");
const customModelRoutingModeEl = document.getElementById("custom-model-routing-mode-select");
const customModelProviderFieldEl = document.getElementById("custom-model-provider-field");
const customModelProviderSlugEl = document.getElementById("custom-model-provider-slug-input");
const customModelReasoningModeEl = document.getElementById("custom-model-reasoning-mode-select");
const customModelReasoningEffortEl = document.getElementById("custom-model-reasoning-effort-select");
const customModelSupportsToolsEl = document.getElementById("custom-model-supports-tools-toggle");
const customModelSupportsVisionEl = document.getElementById("custom-model-supports-vision-toggle");
const customModelSupportsStructuredEl = document.getElementById("custom-model-supports-structured-toggle");
const addCustomModelBtn = document.getElementById("add-custom-model-btn");
const customModelCancelEditBtn = document.getElementById("custom-model-cancel-edit-btn");
const customModelStatusEl = document.getElementById("custom-model-status");
const customModelListEl = document.getElementById("custom-model-list");
const chatModelVisibilityListEl = document.getElementById("chat-model-visibility-list");
const summaryModelPreferenceEl = document.getElementById("summary-model-preference-select");
const fetchSummarizeModelPreferenceEl = document.getElementById("fetch-summarize-model-preference-select");
const fixTextModelPreferenceEl = document.getElementById("fix-text-model-preference-select");
const uploadMetadataModelPreferenceEl = document.getElementById("upload-metadata-model-preference-select");
const subAgentModelPreferenceEl = document.getElementById("sub-agent-model-preference-select");
const chatSummaryModelEl = document.getElementById("chat-summary-model-select");
const imageHelperModelEl = document.getElementById("image-helper-model-select");
const summaryModelFallbackListEl = document.getElementById("summary-model-fallback-list");
const fetchSummarizeModelFallbackListEl = document.getElementById("fetch-summarize-model-fallback-list");
const fixTextModelFallbackListEl = document.getElementById("fix-text-model-fallback-list");
const uploadMetadataModelFallbackListEl = document.getElementById("upload-metadata-model-fallback-list");
const subAgentModelFallbackListEl = document.getElementById("sub-agent-model-fallback-list");
const summaryModelFallbackAddBtn = document.getElementById("summary-model-fallback-add-btn");
const fetchSummarizeModelFallbackAddBtn = document.getElementById("fetch-summarize-model-fallback-add-btn");
const fixTextModelFallbackAddBtn = document.getElementById("fix-text-model-fallback-add-btn");
const uploadMetadataModelFallbackAddBtn = document.getElementById("upload-metadata-model-fallback-add-btn");
const subAgentModelFallbackAddBtn = document.getElementById("sub-agent-model-fallback-add-btn");
const imageProcessingMethodEl = document.getElementById("image-processing-method-select");
const ragInjectOptionsEl = document.getElementById("rag-inject-options");
const ragSensitivityEl = document.getElementById("rag-sensitivity-select");
const ragSensitivityHintEl = document.getElementById("rag-sensitivity-hint");
const ragContextSizeEl = document.getElementById("rag-context-size-select");
const ragAutoInjectEnabledEl = document.getElementById("rag-auto-inject-enabled-toggle");
const ragEnabledEl = document.getElementById("rag-enabled-toggle");
const ragChunkSizeEl = document.getElementById("rag-chunk-size-input");
const ragChunkOverlapEl = document.getElementById("rag-chunk-overlap-input");
const ragMaxChunksPerSourceEl = document.getElementById("rag-max-chunks-per-source-input");
const ragSearchTopKEl = document.getElementById("rag-search-top-k-input");
const ragSearchMinSimilarityEl = document.getElementById("rag-search-min-similarity-input");
const ragQueryExpansionEnabledEl = document.getElementById("rag-query-expansion-enabled-toggle");
const ragQueryExpansionMaxVariantsEl = document.getElementById("rag-query-expansion-max-variants-input");
const openrouterHttpRefererEl = document.getElementById("openrouter-http-referer-input");
const openrouterAppTitleEl = document.getElementById("openrouter-app-title-input");
const conversationMemoryEnabledEl = document.getElementById("conversation-memory-enabled-toggle");
const ocrEnabledEl = document.getElementById("ocr-enabled-toggle");
const loginSessionTimeoutMinutesEl = document.getElementById("login-session-timeout-minutes-input");
const loginMaxFailedAttemptsEl = document.getElementById("login-max-failed-attempts-input");
const loginLockoutSecondsEl = document.getElementById("login-lockout-seconds-input");
const loginRememberSessionDaysEl = document.getElementById("login-remember-session-days-input");
const youtubeTranscriptsEnabledEl = document.getElementById("youtube-transcripts-enabled-toggle");
const fetchRawMaxTextCharsEl = document.getElementById("fetch-raw-max-text-chars-input");
const fetchSummaryMaxCharsEl = document.getElementById("fetch-summary-max-chars-input");
const ragSourceTypeEls = Array.from(document.querySelectorAll("input[name='rag-source-type']"));
const ragAutoInjectSourceTypeEls = Array.from(document.querySelectorAll("input[name='rag-auto-inject-source-type']"));
const proxyOperationEls = Array.from(document.querySelectorAll("input[name='proxy-enabled-operation']"));
const subAgentToolToggleEls = Array.from(document.querySelectorAll("input[name='sub-agent-allowed-tool']"));
const ragSourceSummaryEl = document.getElementById("rag-source-summary");
const ragAutoInjectSourceSummaryEl = document.getElementById("rag-auto-inject-source-summary");
const ragDisabledNoteEl = document.getElementById("rag-disabled-note");
const toolToggleEls = Array.from(document.querySelectorAll("#tool-toggles input[type='checkbox']"));
const kbSyncBtn = document.getElementById("kb-sync-btn");
const kbStatusEl = document.getElementById("kb-status");
const kbDocumentsListEl = document.getElementById("kb-documents-list");
const kbUploadFileEl = document.getElementById("kb-upload-file");
const kbUploadTitleEl = document.getElementById("kb-upload-title");
const kbUploadDescriptionEl = document.getElementById("kb-upload-description");
const kbUploadAutoInjectEl = document.getElementById("kb-upload-auto-inject-toggle");
const kbSuggestBtn = document.getElementById("kb-suggest-btn");
const kbUploadBtn = document.getElementById("kb-upload-btn");
const kbUploadStatusEl = document.getElementById("kb-upload-status");
const settingsStatus = document.getElementById("settings-status");
const settingsRestartBannerEl = document.getElementById("settings-restart-banner");
const settingsRestartBannerTextEl = document.getElementById("settings-restart-banner-text");
const saveButtons = Array.from(document.querySelectorAll(".settings-save-trigger"));
const dirtyPillEl = document.getElementById("settings-dirty-pill");
const statScratchpadEl = document.getElementById("settings-stat-scratchpad");
const statToolsEl = document.getElementById("settings-stat-tools");
const statRagEl = document.getElementById("settings-stat-rag");
const tabButtons = Array.from(document.querySelectorAll("[data-settings-tab]"));
const tabPanels = Array.from(document.querySelectorAll("[data-settings-panel]"));
const SETTINGS_TAB_ALIASES = {
  assistant: "general",
  memory: "context",
};

const RAG_SENSITIVITY_HINTS = {
  flexible: "Flexible: uses a lower threshold around 0.20, so broader and weaker matches may still be included when recall matters more than precision.",
  normal: "Normal: uses a balanced threshold around 0.35, which is usually the best tradeoff between relevant recall and prompt cleanliness.",
  strict: "Strict: uses a higher threshold around 0.55, so only stronger matches are injected and weak or tangential context is filtered out more aggressively.",
};

const RAG_SOURCE_TYPE_LABELS = {
  conversation: "Chats",
  tool_result: "Tool outputs",
  uploaded_document: "Uploaded documents",
};

const MODEL_PROVIDER_LABELS = {
  deepseek: "DeepSeek",
  openrouter: "OpenRouter",
};

const GENERAL_INSTRUCTION_TEMPLATES = [
  {
    id: "concise_default",
    label: "Concise default",
    text: "Be concise and direct. Prefer short paragraphs. Use bullets only when they improve scanning. State assumptions briefly and include the next step when useful.",
  },
  {
    id: "teaching_mode",
    label: "Teaching mode",
    text: "Explain clearly and step by step. Define non-obvious terms, surface the reasoning behind decisions, and include one concrete example when it materially helps understanding.",
  },
  {
    id: "engineering_review",
    label: "Engineering review",
    text: "Prioritize correctness, edge cases, regressions, and verification. Keep summaries brief and focus first on concrete findings, risks, and what changed.",
  },
  {
    id: "execution_first",
    label: "Execution first",
    text: "Take action by default instead of proposing abstract plans. Prefer minimal working changes, explain tradeoffs briefly, and avoid unnecessary theory.",
  },
];

const AI_PERSONALITY_TEMPLATES = [
  {
    id: "pragmatic_engineer",
    label: "Pragmatic engineer",
    text: "Adopt the voice of a pragmatic senior engineer: calm, direct, rigorous, and low-fluff. Challenge weak assumptions politely and stay focused on what will actually work.",
  },
  {
    id: "patient_teacher",
    label: "Patient teacher",
    text: "Sound like a patient technical teacher: structured, clear, encouraging without being overly casual, and attentive to knowledge gaps.",
  },
  {
    id: "analytical_strategist",
    label: "Analytical strategist",
    text: "Sound analytical and deliberate. Compare options clearly, explain tradeoffs, and make recommendations with explicit reasoning and constraints.",
  },
  {
    id: "creative_partner",
    label: "Creative partner",
    text: "Sound like a creative but disciplined collaborator: exploratory, idea-rich, and willing to suggest novel directions while staying grounded in the user's goal.",
  },
];

// Scratchpad constants and state are now managed by the scratchpad module (static/settings/scratchpad.js).
// The module is loaded before this file and provides window.__scratchpadModule.

function getCustomModelContract() {
  const contract = appSettings.custom_model_contract && typeof appSettings.custom_model_contract === "object"
    ? appSettings.custom_model_contract
    : {};

  return {
    provider: String(contract.provider || "openrouter"),
    model_prefix: String(contract.model_prefix || "openrouter:"),
    client_uid_prefix: String(contract.client_uid_prefix || "draft-custom-model:"),
    variant_separator: String(contract.variant_separator || "@@"),
    variant_part_separator: String(contract.variant_part_separator || ";"),
    variant_key_value_separator: String(contract.variant_key_value_separator || "="),
    provider_slug_pattern: String(contract.provider_slug_pattern || "^[a-z0-9][a-z0-9._/-]{0,199}$"),
    reasoning_modes: Array.isArray(contract.reasoning_modes) && contract.reasoning_modes.length
      ? contract.reasoning_modes.map((value) => String(value))
      : ["default", "enabled", "disabled"],
    reasoning_efforts: Array.isArray(contract.reasoning_efforts) && contract.reasoning_efforts.length
      ? contract.reasoning_efforts.map((value) => String(value))
      : ["minimal", "low", "medium", "high", "xhigh"],
  };
}

const builtinModelCatalog = Array.isArray(appSettings.available_models)
  ? appSettings.available_models.filter((model) => !Boolean(model?.is_custom))
  : [];

let hasUnsavedChanges = false;
let hasUnsavedSettingsChanges = false;
let draftCustomModels = Array.isArray(appSettings.custom_models)
  ? appSettings.custom_models.map((model) => normalizeDraftCustomModel(model))
  : [];
let draftChatModelRows = [];
let draftOperationFallbackRows = {};
let fallbackRowSequence = 0;
let customModelClientUidSequence = 0;
let editingCustomModelClientUid = null;

const OPERATION_MODEL_KEYS = ["summarize", "fetch_summarize", "fix_text", "upload_metadata", "sub_agent"];
const OPERATION_FALLBACK_CONTROL_MAP = {
  summarize: {
    listEl: summaryModelFallbackListEl,
    addBtn: summaryModelFallbackAddBtn,
  },
  fetch_summarize: {
    listEl: fetchSummarizeModelFallbackListEl,
    addBtn: fetchSummarizeModelFallbackAddBtn,
  },
  fix_text: {
    listEl: fixTextModelFallbackListEl,
    addBtn: fixTextModelFallbackAddBtn,
  },
  upload_metadata: {
    listEl: uploadMetadataModelFallbackListEl,
    addBtn: uploadMetadataModelFallbackAddBtn,
  },
  sub_agent: {
    listEl: subAgentModelFallbackListEl,
    addBtn: subAgentModelFallbackAddBtn,
  },
};

// Alias to shared dom-utils autoResize
const _autoResizeFn = window.__domUtils?.autoResize;
const autoResize = function (...args) {
  if (typeof _autoResizeFn !== "function") {
    console.warn("[settings] autoResize not available — shared/dom-utils.js may have failed to load");
    return;
  }
  return _autoResizeFn.apply(this, args);
};

function normalizePersonaId(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

async function saveAllSettings() {
  if (window.__personaModule?.hasUnsavedPersonaChanges()) {
    const personaSaved = await window.__personaModule?.saveActivePersona();
    if (!personaSaved) {
      return;
    }
  }
  if (hasUnsavedSettingsChanges) {
    await saveSettings();
  }
}

function setSettingsStatus(message, tone = "muted") {
  if (!settingsStatus) {
    return;
  }
  settingsStatus.textContent = message;
  settingsStatus.dataset.tone = tone;
}

function setDirtyPill(message, tone = "muted") {
  if (!dirtyPillEl) {
    return;
  }
  dirtyPillEl.textContent = message;
  dirtyPillEl.dataset.tone = tone;
}

const RESTART_REQUIRED_SETTING_KEYS = [
  "openrouter_http_referer",
  "openrouter_app_title",
  "login_session_timeout_minutes",
  "login_max_failed_attempts",
  "login_lockout_seconds",
  "login_remember_session_days",
  "rag_enabled",
  "ocr_enabled",
  "conversation_memory_enabled",
  "youtube_transcripts_enabled",
  "chat_summary_model",
  "rag_chunk_size",
  "rag_chunk_overlap",
  "rag_max_chunks_per_source",
  "rag_search_top_k",
  "rag_search_min_similarity",
  "rag_query_expansion_enabled",
  "rag_query_expansion_max_variants",
  "fetch_raw_max_text_chars",
  "fetch_summary_max_chars",
];

function valueAsComparableString(value) {
  if (Array.isArray(value) || (value && typeof value === "object")) {
    return JSON.stringify(value);
  }
  if (value === null || value === undefined) {
    return "";
  }
  return String(value);
}

function hasRestartRequiredChanges(payload, previousSettings) {
  return RESTART_REQUIRED_SETTING_KEYS.some((key) => (
    Object.prototype.hasOwnProperty.call(payload || {}, key)
    && valueAsComparableString(payload[key]) !== valueAsComparableString(previousSettings?.[key])
  ));
}

function buildSettingsDeltaPayload(nextPayload, previousSettings) {
  const delta = {};
  const normalizedNextPayload = nextPayload && typeof nextPayload === "object" ? nextPayload : {};
  const normalizedPreviousSettings = previousSettings && typeof previousSettings === "object" ? previousSettings : {};

  Object.keys(normalizedNextPayload).forEach((key) => {
    const nextValue = normalizedNextPayload[key];
    const previousValue = normalizedPreviousSettings[key];
    if (valueAsComparableString(nextValue) !== valueAsComparableString(previousValue)) {
      delta[key] = nextValue;
    }
  });

  return delta;
}

function showRestartWarning(message) {
  if (!settingsRestartBannerEl) {
    return;
  }
  if (settingsRestartBannerTextEl) {
    settingsRestartBannerTextEl.textContent = message;
  }
  settingsRestartBannerEl.hidden = false;
}

function hideRestartWarning() {
  if (!settingsRestartBannerEl) {
    return;
  }
  settingsRestartBannerEl.hidden = true;
}

function updateDirtyIndicators() {
  hasUnsavedChanges = hasUnsavedSettingsChanges || (window.__personaModule?.hasUnsavedPersonaChanges() ?? false);
  if (hasUnsavedSettingsChanges && (window.__personaModule?.hasUnsavedPersonaChanges() ?? false)) {
    setSettingsStatus("Unsaved settings and persona", "warning");
    setDirtyPill("Unsaved settings and persona", "warning");
    return;
  }
  if (hasUnsavedSettingsChanges) {
    setSettingsStatus("Unsaved changes", "warning");
    setDirtyPill("Unsaved changes", "warning");
    return;
  }
  if (window.__personaModule?.hasUnsavedPersonaChanges()) {
    setSettingsStatus("Unsaved persona draft", "warning");
    setDirtyPill("Unsaved persona draft", "warning");
    return;
  }
  setSettingsStatus("Saved", "success");
  setDirtyPill("All changes saved", "success");
}

function markDirty() {
  hasUnsavedSettingsChanges = true;
  updateDirtyIndicators();
}
window.markDirty = markDirty;

function clearDirtyState() {
  hasUnsavedSettingsChanges = false;
  updateDirtyIndicators();
}
window.clearDirtyState = clearDirtyState;

// Scratchpad constants — needed for the save payload built in saveSettings().
// The scratchpad rendering logic is delegated to __scratchpadModule.
const DEFAULT_SCRATCHPAD_SECTION_ID = "notes";
const DEFAULT_SCRATCHPAD_SECTION_ORDER = [
  "lessons",
  "profile",
  "notes",
  "problems",
  "tasks",
  "preferences",
  "domain",
];
// Delegating scratchpad state management to the module.

function setCustomModelStatus(message, tone = "muted") {
  if (!customModelStatusEl) {
    return;
  }
  customModelStatusEl.textContent = message;
  customModelStatusEl.dataset.tone = tone;
}

// Aliases for normalization functions from custom-models module.
// These were previously duplicated locally; now they delegate to the shared module.

function normalizeOpenRouterApiModel(value) {
  return window.__customModelsModule?.normalizeOpenRouterApiModel(value) ?? "";
}

function splitOpenRouterModelId(value) {
  return window.__customModelsModule?.splitOpenRouterModelId(value) ?? { apiModel: "", variantSuffix: "" };
}

function parseOpenRouterModelVariantSuffix(value) {
  return window.__customModelsModule?.parseOpenRouterModelVariantSuffix(value) ?? {};
}

function normalizeOpenRouterProviderSlug(value) {
  return window.__customModelsModule?.normalizeOpenRouterProviderSlug?.(value) ?? "";
}

function normalizeOpenRouterReasoningMode(value) {
  return window.__customModelsModule?.normalizeOpenRouterReasoningMode?.(value) ?? "default";
}

function normalizeOpenRouterReasoningConfig(modeValue, effortValue) {
  return window.__customModelsModule?.normalizeOpenRouterReasoningConfig?.(modeValue, effortValue) ?? { mode: "default", effort: "" };
}

function normalizeOpenRouterReasoningEffort(value) {
  const { reasoning_efforts: reasoningEfforts } = getCustomModelContract();
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized || normalized === "auto") {
    return "";
  }
  if (reasoningEfforts.includes(normalized)) {
    return normalized;
  }
  return "";
}

function normalizeCustomModelClientUid(value) {
  return window.__customModelsModule?.normalizeCustomModelClientUid?.(value) ?? "";
}

function createCustomModelClientUid() {
  return window.__customModelsModule?.createCustomModelClientUid?.() ?? "";
}

function normalizeDraftCustomModel(model) {
  return window.__customModelsModule?.normalizeDraftCustomModel?.(model) ?? model;
}
// The module's version is used in the save flow instead of the local duplicate.

function getCustomModelReasoningLabel(model) {
  if (model?.reasoning_mode === "disabled") {
    return "reasoning off";
  }
  if (model?.reasoning_mode === "enabled") {
    return model?.reasoning_effort ? `reasoning ${model.reasoning_effort}` : "reasoning on";
  }
  return "reasoning default";
}

function syncCustomModelReasoningControls() {
  if (!customModelReasoningModeEl || !customModelReasoningEffortEl) {
    return;
  }
  customModelReasoningEffortEl.disabled = customModelReasoningModeEl.value !== "enabled";
}

function syncCustomModelProviderControls() {
  const routingMode = customModelRoutingModeEl?.value || "auto";
  const specificProviderEnabled = routingMode === "specific";

  if (customModelProviderFieldEl) {
    customModelProviderFieldEl.hidden = !specificProviderEnabled;
  }
  if (customModelProviderSlugEl) {
    customModelProviderSlugEl.disabled = !specificProviderEnabled;
  }
}

function syncImageHelperModelVisibility() {
  const imageHelperModelSection = document.getElementById("image-helper-model-section");
  if (!imageHelperModelSection) {
    return;
  }
  const isHelperMode = imageProcessingMethodEl?.value === "llm_helper";
  imageHelperModelSection.hidden = !isHelperMode;
}

function readCustomModelProviderSlug() {
  const routingMode = customModelRoutingModeEl?.value || "auto";
  if (routingMode !== "specific") {
    return { providerSlug: "", error: "" };
  }

  const rawProviderSlug = String(customModelProviderSlugEl?.value || "").trim();
  if (!rawProviderSlug) {
    return {
      providerSlug: "",
      error: "Choose a provider slug or switch routing back to automatic.",
    };
  }

  const providerSlug = normalizeOpenRouterProviderSlug(rawProviderSlug);
  if (!providerSlug) {
    return {
      providerSlug: "",
      error: "Provider slug is invalid. Use a value like anthropic, azure, or deepinfra/turbo.",
    };
  }

  return { providerSlug, error: "" };
}

function getDraftAvailableModels() {
  const customModelCatalog = draftCustomModels.map((model) => ({
    ...model,
    id: getDraftCustomModelReference(model),
  }));
  return [...builtinModelCatalog, ...customModelCatalog].map((model) => ({ ...model }));
}

function getDraftChatCapableModels() {
  return getDraftAvailableModels().filter((model) => Boolean(model?.supports_tools));
}

function getModelProviderLabel(model) {
  return MODEL_PROVIDER_LABELS[String(model?.provider || "").trim()] || String(model?.provider || "model");
}

function getOperationPreferenceValue(key) {
  const defaults = appSettings.operation_model_preferences || {};
  const elementMap = {
    summarize: summaryModelPreferenceEl,
    fetch_summarize: fetchSummarizeModelPreferenceEl,
    fix_text: fixTextModelPreferenceEl,
    upload_metadata: uploadMetadataModelPreferenceEl,
    sub_agent: subAgentModelPreferenceEl,
  };
  const el = elementMap[key];
  return el ? String(el.value || "") : String(defaults[key] || "");
}

function getOperationModelPreferencesDraft() {
  return {
    summarize: getOperationPreferenceValue("summarize"),
    fetch_summarize: getOperationPreferenceValue("fetch_summarize"),
    fix_text: getOperationPreferenceValue("fix_text"),
    upload_metadata: getOperationPreferenceValue("upload_metadata"),
    sub_agent: getOperationPreferenceValue("sub_agent"),
  };
}

function createOperationFallbackRow(modelId = "") {
  return {
    id: `operation-fallback-${fallbackRowSequence += 1}`,
    modelId: String(modelId || "").trim(),
  };
}

function normalizeOperationFallbackRows(rawValue) {
  if (Array.isArray(rawValue)) {
    return rawValue.map((modelId) => createOperationFallbackRow(modelId));
  }
  if (typeof rawValue === "string" && rawValue.trim()) {
    return [createOperationFallbackRow(rawValue)];
  }
  return [];
}

function initializeOperationFallbackDraftRows(rawPreferences) {
  const preferences = rawPreferences && typeof rawPreferences === "object" ? rawPreferences : {};
  const nextRows = {};
  OPERATION_MODEL_KEYS.forEach((key) => {
    nextRows[key] = normalizeOperationFallbackRows(preferences[key]);
  });
  draftOperationFallbackRows = nextRows;
}

function getDraftOperationFallbackRows(operationKey) {
  return Array.isArray(draftOperationFallbackRows[operationKey]) ? draftOperationFallbackRows[operationKey] : [];
}

function addOperationFallbackRow(operationKey, modelId = "") {
  const rows = [...getDraftOperationFallbackRows(operationKey), createOperationFallbackRow(modelId)];
  draftOperationFallbackRows = {
    ...draftOperationFallbackRows,
    [operationKey]: rows,
  };
  renderModelManagementPanels();
  markDirty();
}

function removeOperationFallbackRow(operationKey, rowId) {
  const rows = getDraftOperationFallbackRows(operationKey).filter((row) => row.id !== rowId);
  draftOperationFallbackRows = {
    ...draftOperationFallbackRows,
    [operationKey]: rows,
  };
  renderModelManagementPanels();
  markDirty();
}

function moveOperationFallbackRow(operationKey, rowIndex, direction) {
  const rows = [...getDraftOperationFallbackRows(operationKey)];
  const nextIndex = rowIndex + direction;
  if (nextIndex < 0 || nextIndex >= rows.length) {
    return;
  }
  const [row] = rows.splice(rowIndex, 1);
  rows.splice(nextIndex, 0, row);
  draftOperationFallbackRows = {
    ...draftOperationFallbackRows,
    [operationKey]: rows,
  };
  renderModelManagementPanels();
  markDirty();
}

function setOperationFallbackRowModel(operationKey, rowId, modelId) {
  const rows = getDraftOperationFallbackRows(operationKey).map((row) => (
    row.id === rowId
      ? { ...row, modelId: String(modelId || "").trim() }
      : row
  ));
  draftOperationFallbackRows = {
    ...draftOperationFallbackRows,
    [operationKey]: rows,
  };
  markDirty();
}

function renderOperationFallbackList(operationKey) {
  const controls = OPERATION_FALLBACK_CONTROL_MAP[operationKey];
  if (!controls?.listEl) {
    return;
  }

  const listEl = controls.listEl;
  const rows = getDraftOperationFallbackRows(operationKey);
  listEl.replaceChildren();

  if (!rows.length) {
    const emptyState = document.createElement("p");
    emptyState.className = "settings-copy";
    emptyState.textContent = "No fallback models added yet.";
    listEl.append(emptyState);
    return;
  }

  rows.forEach((rowState, index) => {
    const row = document.createElement("div");
    row.className = "model-management-row";

    const select = document.createElement("select");
    select.className = "settings-select";
    populateOperationModelSelect(select, rowState.modelId, "Use built-in fallback");
    if (select.value !== rowState.modelId) {
      rowState.modelId = select.value;
    }
    select.addEventListener("change", () => {
      setOperationFallbackRowModel(operationKey, rowState.id, select.value);
    });

    const actions = document.createElement("div");
    actions.className = "settings-inline-actions";

    const upBtn = document.createElement("button");
    upBtn.type = "button";
    upBtn.className = "btn-ghost";
    upBtn.textContent = "Up";
    upBtn.disabled = index === 0;
    upBtn.addEventListener("click", () => moveOperationFallbackRow(operationKey, index, -1));

    const downBtn = document.createElement("button");
    downBtn.type = "button";
    downBtn.className = "btn-ghost";
    downBtn.textContent = "Down";
    downBtn.disabled = index === rows.length - 1;
    downBtn.addEventListener("click", () => moveOperationFallbackRow(operationKey, index, 1));

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "btn-ghost btn-ghost--danger";
    removeBtn.textContent = "Remove";
    removeBtn.addEventListener("click", () => removeOperationFallbackRow(operationKey, rowState.id));

    actions.append(upBtn, downBtn, removeBtn);
    row.append(select, actions);
    listEl.append(row);
  });
}

function renderOperationFallbackLists() {
  OPERATION_MODEL_KEYS.forEach((operationKey) => {
    renderOperationFallbackList(operationKey);
  });
}

function getOperationModelFallbackPreferencesDraft() {
  const preferences = {};
  OPERATION_MODEL_KEYS.forEach((operationKey) => {
    const rows = getDraftOperationFallbackRows(operationKey)
      .map((row) => String(row.modelId || "").trim())
      .filter((modelId) => Boolean(modelId));
    preferences[operationKey] = [...new Set(rows)];
  });
  return preferences;
}

function syncDraftChatModelRows({ preferVisibleId = "" } = {}) {
  const candidates = getDraftChatCapableModels();
  const candidateMap = new Map(candidates.map((model) => [model.id, model]));
  const initialVisible = new Set(Array.isArray(appSettings.visible_model_order) ? appSettings.visible_model_order : []);
  const nextRows = Array.isArray(draftChatModelRows)
    ? draftChatModelRows.filter((row) => candidateMap.has(row.id)).map((row) => ({ ...row }))
    : [];
  const knownIds = new Set(nextRows.map((row) => row.id));

  for (const model of candidates) {
    if (knownIds.has(model.id)) {
      continue;
    }
    nextRows.push({
      id: model.id,
      visible: preferVisibleId ? model.id === preferVisibleId : initialVisible.has(model.id),
    });
    knownIds.add(model.id);
  }

  if (!nextRows.length) {
    draftChatModelRows = [];
    return;
  }

  if (!nextRows.some((row) => row.visible)) {
    nextRows[0].visible = true;
  }

  draftChatModelRows = nextRows;
}

function getDraftVisibleModelOrder() {
  return draftChatModelRows.filter((row) => row.visible).map((row) => row.id);
}

function renderCustomModelList() {
  if (!customModelListEl) {
    return;
  }

  customModelListEl.replaceChildren();
  if (!draftCustomModels.length) {
    const emptyState = document.createElement("p");
    emptyState.className = "settings-copy";
    emptyState.textContent = "No custom models configured yet.";
    customModelListEl.append(emptyState);
    return;
  }

  for (const model of draftCustomModels) {
    const row = document.createElement("div");
    row.className = "model-management-row";
    if (editingCustomModelClientUid && editingCustomModelClientUid === model.client_uid) {
      row.classList.add("custom-model-row--editing");
    }

    const meta = document.createElement("div");
    meta.className = "model-management-row__meta";

    const title = document.createElement("strong");
    title.textContent = model.name || model.api_model || model.id || model.client_uid;

    const subtitle = document.createElement("div");
    subtitle.className = "model-management-row__subtitle";
    subtitle.textContent = [model.api_model || model.id || model.client_uid, model.provider_slug ? `Route: ${model.provider_slug}` : ""]
      .filter(Boolean)
      .join(" · ");

    const badges = document.createElement("div");
    badges.className = "model-management-row__badges";
    [
      getModelProviderLabel(model),
      model.provider_slug ? `route ${model.provider_slug}` : null,
      getCustomModelReasoningLabel(model),
      model.supports_tools ? "tools" : "no tools",
      model.supports_vision ? "vision" : "text-only",
      model.supports_structured_outputs ? "structured" : "freeform",
    ].forEach((label) => {
      if (!label) {
        return;
      }
      const badge = document.createElement("span");
      badge.className = "model-management-badge";
      badge.textContent = label;
      badges.append(badge);
    });

    meta.append(title, subtitle, badges);

    const actions = document.createElement("div");
    actions.className = "settings-inline-actions";

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "btn-ghost";
    editBtn.textContent = "Edit";
    editBtn.addEventListener("click", () => {
      startEditingCustomModel(model.client_uid);
    });

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "btn-ghost btn-ghost--danger";
    removeBtn.textContent = "Remove";
    removeBtn.addEventListener("click", () => {
      const wasEditing = editingCustomModelClientUid === model.client_uid;
      draftCustomModels = draftCustomModels.filter((entry) => entry.client_uid !== model.client_uid);
      if (wasEditing) {
        cancelEditingCustomModel({ silent: true });
      }
      syncDraftChatModelRows();
      renderModelManagementPanels();
      markDirty();
      setCustomModelStatus("Custom model removed. Save to apply.", "warning");
    });

    actions.append(editBtn, removeBtn);
    row.append(meta, actions);
    customModelListEl.append(row);
  }
}

function fillCustomModelForm(model) {
  if (customModelNameEl) {
    customModelNameEl.value = String(model?.name || "");
  }
  if (customModelApiModelEl) {
    customModelApiModelEl.value = String(model?.api_model || model?.id || "");
  }
  if (customModelRoutingModeEl) {
    customModelRoutingModeEl.value = model?.provider_slug ? "specific" : "auto";
  }
  if (customModelProviderSlugEl) {
    customModelProviderSlugEl.value = String(model?.provider_slug || "");
  }
  if (customModelReasoningModeEl) {
    customModelReasoningModeEl.value = String(model?.reasoning_mode || "default");
  }
  if (customModelReasoningEffortEl) {
    customModelReasoningEffortEl.value = String(model?.reasoning_effort || "");
  }
  if (customModelSupportsToolsEl) {
    customModelSupportsToolsEl.checked = Boolean(model?.supports_tools ?? true);
  }
  if (customModelSupportsVisionEl) {
    customModelSupportsVisionEl.checked = Boolean(model?.supports_vision ?? false);
  }
  if (customModelSupportsStructuredEl) {
    customModelSupportsStructuredEl.checked = Boolean(model?.supports_structured_outputs ?? false);
  }
  syncCustomModelReasoningControls();
  syncCustomModelProviderControls();
}

function updateCustomModelEditControls() {
  if (addCustomModelBtn) {
    addCustomModelBtn.textContent = editingCustomModelClientUid ? "Update model" : "Add custom model";
  }
  if (customModelCancelEditBtn) {
    customModelCancelEditBtn.hidden = !editingCustomModelClientUid;
  }
}

function startEditingCustomModel(modelClientUid) {
  const model = draftCustomModels.find((entry) => entry.client_uid === modelClientUid);
  if (!model) {
    return;
  }
  editingCustomModelClientUid = model.client_uid;
  fillCustomModelForm(model);
  updateCustomModelEditControls();
  renderCustomModelList();
  setCustomModelStatus(`Editing ${model.name || model.api_model || model.client_uid}.`, "muted");
}

function cancelEditingCustomModel({ silent = false } = {}) {
  editingCustomModelClientUid = null;
  resetCustomModelForm();
  updateCustomModelEditControls();
  renderCustomModelList();
  if (!silent) {
    setCustomModelStatus("No pending model changes", "muted");
  }
}

function moveDraftChatModelRow(index, direction) {
  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= draftChatModelRows.length) {
    return;
  }
  const rows = [...draftChatModelRows];
  const [row] = rows.splice(index, 1);
  rows.splice(nextIndex, 0, row);
  draftChatModelRows = rows;
  renderModelManagementPanels();
  markDirty();
}

function renderChatModelVisibilityList() {
  if (!chatModelVisibilityListEl) {
    return;
  }

  chatModelVisibilityListEl.replaceChildren();
  const candidateMap = new Map(getDraftChatCapableModels().map((model) => [model.id, model]));
  if (!draftChatModelRows.length) {
    const emptyState = document.createElement("p");
    emptyState.className = "settings-copy";
    emptyState.textContent = "No tool-capable models are available for the chat selector.";
    chatModelVisibilityListEl.append(emptyState);
    return;
  }

  draftChatModelRows.forEach((rowState, index) => {
    const model = candidateMap.get(rowState.id);
    if (!model) {
      return;
    }

    const row = document.createElement("div");
    row.className = "model-management-row";

    const toggleLabel = document.createElement("label");
    toggleLabel.className = "tool-toggle";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = Boolean(rowState.visible);
    checkbox.addEventListener("change", () => {
      rowState.visible = checkbox.checked;
      if (!draftChatModelRows.some((entry) => entry.visible)) {
        rowState.visible = true;
        checkbox.checked = true;
        setCustomModelStatus("At least one chat model must stay visible.", "warning");
        return;
      }
      markDirty();
    });

    const body = document.createElement("span");
    body.className = "model-management-row__toggle-body";
    const title = document.createElement("strong");
    title.textContent = model.name || model.id;
    const subtitle = document.createElement("small");
    subtitle.textContent = `${getModelProviderLabel(model)} · ${model.api_model || model.id}`;
    body.append(title, subtitle);
    toggleLabel.append(checkbox, body);

    const actions = document.createElement("div");
    actions.className = "settings-inline-actions";

    const upBtn = document.createElement("button");
    upBtn.type = "button";
    upBtn.className = "btn-ghost";
    upBtn.textContent = "Up";
    upBtn.disabled = index === 0;
    upBtn.addEventListener("click", () => moveDraftChatModelRow(index, -1));

    const downBtn = document.createElement("button");
    downBtn.type = "button";
    downBtn.className = "btn-ghost";
    downBtn.textContent = "Down";
    downBtn.disabled = index === draftChatModelRows.length - 1;
    downBtn.addEventListener("click", () => moveDraftChatModelRow(index, 1));

    actions.append(upBtn, downBtn);
    row.append(toggleLabel, actions);
    chatModelVisibilityListEl.append(row);
  });
}

function populateOperationModelSelect(selectEl, selectedValue, emptyLabel = "Use default chat model") {
  if (!selectEl) {
    return;
  }
  const options = getDraftAvailableModels();
  const fragment = document.createDocumentFragment();

  const defaultOption = document.createElement("option");
  defaultOption.value = "";
  defaultOption.textContent = emptyLabel;
  fragment.append(defaultOption);

  options.forEach((model) => {
    const option = document.createElement("option");
    option.value = model.id;
    option.textContent = `${model.name || model.id} (${getModelProviderLabel(model)})`;
    fragment.append(option);
  });

  selectEl.replaceChildren(fragment);
  selectEl.value = selectedValue || "";
  if (selectEl.value !== (selectedValue || "")) {
    selectEl.value = "";
  }
}

function populateVisionModelSelect(selectEl, selectedValue, emptyLabel = "Use default chat model when needed") {
  if (!selectEl) {
    return;
  }
  const options = getDraftAvailableModels().filter((model) => Boolean(model?.supports_vision));
  const fragment = document.createDocumentFragment();

  const defaultOption = document.createElement("option");
  defaultOption.value = "";
  defaultOption.textContent = emptyLabel;
  fragment.append(defaultOption);

  options.forEach((model) => {
    const option = document.createElement("option");
    option.value = model.id;
    option.textContent = `${model.name || model.id} (${getModelProviderLabel(model)})`;
    fragment.append(option);
  });

  selectEl.replaceChildren(fragment);
  selectEl.value = selectedValue || "";
  if (selectEl.value !== (selectedValue || "")) {
    selectEl.value = "";
  }
}

function renderOperationModelSelects(preferences = null) {
  const currentChatSummaryModel = chatSummaryModelEl
    ? String(chatSummaryModelEl.value || appSettings.chat_summary_model || "")
    : String(appSettings.chat_summary_model || "");
  const currentImageHelperModel = imageHelperModelEl
    ? String(imageHelperModelEl.value || appSettings.image_helper_model || "")
    : String(appSettings.image_helper_model || "");
  const currentSelections = preferences && typeof preferences === "object"
    ? {
        summarize: String(preferences.summarize || ""),
        fetch_summarize: String(preferences.fetch_summarize || ""),
        fix_text: String(preferences.fix_text || ""),
        upload_metadata: String(preferences.upload_metadata || ""),
        sub_agent: String(preferences.sub_agent || ""),
      }
    : getOperationModelPreferencesDraft();
  populateOperationModelSelect(summaryModelPreferenceEl, currentSelections.summarize);
  populateOperationModelSelect(fetchSummarizeModelPreferenceEl, currentSelections.fetch_summarize);
  populateOperationModelSelect(fixTextModelPreferenceEl, currentSelections.fix_text);
  populateOperationModelSelect(uploadMetadataModelPreferenceEl, currentSelections.upload_metadata);
  populateOperationModelSelect(subAgentModelPreferenceEl, currentSelections.sub_agent);
  populateOperationModelSelect(chatSummaryModelEl, currentChatSummaryModel, "Use default chat model");
  populateVisionModelSelect(imageHelperModelEl, currentImageHelperModel, "Use default chat model when needed");
}

function renderModelManagementPanels({ preferVisibleId = "", operationPreferences = null } = {}) {
  syncDraftChatModelRows({ preferVisibleId });
  renderCustomModelList();
  renderChatModelVisibilityList();
  renderOperationModelSelects(operationPreferences);
  renderOperationFallbackLists();
  updateCustomModelEditControls();
}

function resetCustomModelForm() {
  if (customModelNameEl) customModelNameEl.value = "";
  if (customModelApiModelEl) customModelApiModelEl.value = "";
  if (customModelRoutingModeEl) customModelRoutingModeEl.value = "auto";
  if (customModelProviderSlugEl) customModelProviderSlugEl.value = "";
  if (customModelReasoningModeEl) customModelReasoningModeEl.value = "default";
  if (customModelReasoningEffortEl) customModelReasoningEffortEl.value = "";
  if (customModelSupportsToolsEl) customModelSupportsToolsEl.checked = true;
  if (customModelSupportsVisionEl) customModelSupportsVisionEl.checked = false;
  if (customModelSupportsStructuredEl) customModelSupportsStructuredEl.checked = false;
  syncCustomModelReasoningControls();
  syncCustomModelProviderControls();
}

function addCustomModelFromInputs() {
  const apiModel = normalizeOpenRouterApiModel(customModelApiModelEl?.value || "");
  const providerSelection = readCustomModelProviderSlug();
  const reasoning = normalizeOpenRouterReasoningConfig(
    customModelReasoningModeEl?.value || "default",
    customModelReasoningEffortEl?.value || ""
  );
  if (!apiModel) {
    setCustomModelStatus("Custom model API id is required.", "error");
    return;
  }
  if (providerSelection.error) {
    setCustomModelStatus(providerSelection.error, "error");
    return;
  }

  const providerSlug = providerSelection.providerSlug;
  const existingIndex = editingCustomModelClientUid
    ? draftCustomModels.findIndex((model) => model.client_uid === editingCustomModelClientUid)
    : -1;
  const existingModel = existingIndex >= 0 ? draftCustomModels[existingIndex] : null;

  const normalizedModel = normalizeDraftCustomModel({
    id: existingModel?.id || "",
    client_uid: existingModel?.client_uid || createCustomModelClientUid(),
    name: String(customModelNameEl?.value || "").trim() || apiModel,
    provider: "openrouter",
    api_model: apiModel,
    provider_slug: providerSlug,
    reasoning_mode: reasoning.mode,
    reasoning_effort: reasoning.effort,
    supports_tools: Boolean(customModelSupportsToolsEl?.checked),
    supports_vision: Boolean(customModelSupportsVisionEl?.checked),
    supports_structured_outputs: Boolean(customModelSupportsStructuredEl?.checked),
    is_custom: true,
  });
  const normalizedSignature = getDraftCustomModelSignature(normalizedModel);
  const duplicateIndex = draftCustomModels.findIndex((model, index) => (
    getDraftCustomModelSignature(model) === normalizedSignature && index !== existingIndex
  ));
  if (duplicateIndex >= 0) {
    setCustomModelStatus("That custom model configuration is already configured.", "warning");
    return;
  }
  const preferredModelReference = getDraftCustomModelReference(normalizedModel);

  if (existingIndex >= 0) {
    const nextModels = [...draftCustomModels];
    nextModels.splice(existingIndex, 1, normalizedModel);
    draftCustomModels = nextModels;
  } else {
    draftCustomModels = [...draftCustomModels, normalizedModel];
  }

  cancelEditingCustomModel({ silent: true });
  renderModelManagementPanels({ preferVisibleId: preferredModelReference });
  markDirty();
  setCustomModelStatus(existingIndex >= 0 ? "Custom model updated. Save to apply." : "Custom model added. Save to apply.", "success");
}

// Scratchpad rendering functions are now provided by __scratchpadModule.
// These were removed to eliminate duplication with scratchpad.js.
// The module handles all scratchpad state management and DOM rendering.

function updateRagSensitivityHint() {
  if (!ragSensitivityHintEl || !ragSensitivityEl) {
    return;
  }
  const sensitivity = ragSensitivityEl.value || "normal";
  ragSensitivityHintEl.textContent = RAG_SENSITIVITY_HINTS[sensitivity] || RAG_SENSITIVITY_HINTS.normal;
}

function getSelectedTools() {
  return toolToggleEls.filter((element) => element.checked).map((element) => element.value);
}

function getSelectedRagSourceTypes() {
  return ragSourceTypeEls.filter((element) => element.checked).map((element) => element.value);
}

function getSelectedRagAutoInjectSourceTypes() {
  return ragAutoInjectSourceTypeEls.filter((element) => element.checked).map((element) => element.value);
}

function getSelectedProxyOperations() {
  return proxyOperationEls.filter((element) => element.checked).map((element) => element.value);
}

function getSelectedSubAgentTools() {
  return subAgentToolToggleEls.filter((element) => element.checked).map((element) => element.value);
}

function getRagSourceControlContainer(element) {
  return element?.closest(".rag-source-mode-toggle") || null;
}

function applySelectedTools(selected) {
  const active = new Set(Array.isArray(selected) ? selected : []);
  toolToggleEls.forEach((element) => {
    element.checked = active.has(element.value);
  });
}

function applySelectedRagSourceTypes(selected) {
  const active = new Set(Array.isArray(selected) ? selected : []);
  ragSourceTypeEls.forEach((element) => {
    element.checked = active.has(element.value);
  });
  syncRagAutoInjectSourceAvailability();
  updateRagSourceSummary();
}

function applySelectedRagAutoInjectSourceTypes(selected) {
  const active = new Set(Array.isArray(selected) ? selected : []);
  ragAutoInjectSourceTypeEls.forEach((element) => {
    element.checked = active.has(element.value);
  });
  syncRagAutoInjectSourceAvailability();
}

function applySelectedProxyOperations(selected) {
  const active = new Set(Array.isArray(selected) ? selected : []);
  proxyOperationEls.forEach((element) => {
    element.checked = active.has(element.value);
  });
}

function applySelectedSubAgentTools(selected) {
  const active = new Set(Array.isArray(selected) ? selected : []);
  subAgentToolToggleEls.forEach((element) => {
    element.checked = active.has(element.value);
  });
}

function updateRagSourceSummary() {
  if (!ragSourceSummaryEl) {
    return;
  }

  if (!Boolean(featureFlags.rag_enabled)) {
    ragSourceSummaryEl.textContent = "RAG is disabled in .env, so source pool selection is inactive.";
    return;
  }

  const selected = getSelectedRagSourceTypes();
  if (!selected.length) {
    ragSourceSummaryEl.textContent = "No source pool is enabled for Search. The assistant will skip generic RAG retrieval from chats, tool outputs, and uploaded documents.";
    return;
  }

  ragSourceSummaryEl.textContent = `Search is enabled for: ${formatRagSourceLabels(selected)}. Only these pools can supply generic retrieved context.`;
}

function updateRagAutoInjectSourceSummary() {
  if (!ragAutoInjectSourceSummaryEl) {
    return;
  }

  if (!Boolean(featureFlags.rag_enabled)) {
    ragAutoInjectSourceSummaryEl.textContent = "RAG is disabled in .env, so per-source auto-injection is inactive.";
    return;
  }

  const autoInjectEnabled = ragAutoInjectEnabledEl ? ragAutoInjectEnabledEl.checked : false;
  if (!autoInjectEnabled) {
    ragAutoInjectSourceSummaryEl.textContent = "Auto-inject is disabled. Enable the master toggle above to allow automatic RAG injection, even if source pools are configured.";
    return;
  }

  const selected = getSelectedRagAutoInjectSourceTypes();
  if (!selected.length) {
    ragAutoInjectSourceSummaryEl.textContent = "No source pool is marked for Auto inject. Retrieved context can still be searched manually, but nothing will be inserted automatically.";
    return;
  }

  ragAutoInjectSourceSummaryEl.textContent = `Auto inject is configured for: ${formatRagSourceLabels(selected)}. These pools are eligible for automatic prompt insertion.`;
}

function formatRagSourceLabels(selectedValues) {
  const values = Array.isArray(selectedValues) ? selectedValues : [];
  const labels = values.map((value) => RAG_SOURCE_TYPE_LABELS[value] || value);
  return labels.join(", ");
}

function syncRagAutoInjectSourceAvailability() {
  const ragEnabled = Boolean(featureFlags.rag_enabled);
  const autoInjectEnabled = ragAutoInjectEnabledEl ? ragAutoInjectEnabledEl.checked : false;

  if (ragAutoInjectEnabledEl) {
    ragAutoInjectEnabledEl.disabled = !ragEnabled;
  }

  ragAutoInjectSourceTypeEls.forEach((element) => {
    element.disabled = !ragEnabled || !autoInjectEnabled;
    getRagSourceControlContainer(element)?.classList.toggle("is-muted", !ragEnabled || !autoInjectEnabled);
  });

  updateRagAutoInjectSourceSummary();
  syncOverviewStats();
}

function applyConditionalSectionState(element, { disabled = false, hidden = null } = {}) {
  if (!element) {
    return;
  }

  if ("disabled" in element) {
    element.disabled = disabled;
  }
  element.classList.toggle("is-disabled", disabled);
  element.setAttribute("aria-disabled", disabled ? "true" : "false");

  if (typeof hidden === "boolean") {
    element.hidden = hidden;
    element.setAttribute("aria-hidden", hidden ? "true" : "false");
  }
}

function syncContextStrategyAvailability() {
  const strategy = contextSelectionStrategyEl?.value || "classic";
  const entropyEnabled = strategy === "entropy" || strategy === "entropy_rag_hybrid";
  const hybridEnabled = strategy === "entropy_rag_hybrid";

  applyConditionalSectionState(entropyControlsFieldsetEl, { disabled: !entropyEnabled, hidden: !entropyEnabled });
  if (entropyRagBudgetRatioEl) {
    entropyRagBudgetRatioEl.disabled = !hybridEnabled;
  }
  applyConditionalSectionState(entropyRagBudgetClusterEl, { disabled: !hybridEnabled, hidden: !hybridEnabled });
}

function syncPruningSettingsAvailability() {
  applyConditionalSectionState(pruningControlsFieldsetEl, { disabled: !Boolean(pruningEnabledEl?.checked) });
}

function syncOverviewStats() {
  if (statScratchpadEl) {
    const noteCount = window.__scratchpadModule?.getVisibleScratchpadNotes().length ?? 0;
    statScratchpadEl.textContent = noteCount === 1 ? "1 note" : `${noteCount} notes`;
  }

  if (statToolsEl) {
    const toolCount = getSelectedTools().length;
    statToolsEl.textContent = toolCount === 1 ? "1 enabled" : `${toolCount} enabled`;
  }

  if (statRagEl) {
    if (!featureFlags.rag_enabled) {
      statRagEl.textContent = "Disabled";
    } else {
      const sourceCount = getSelectedRagSourceTypes().length;
      const autoInjectCount = getSelectedRagAutoInjectSourceTypes().length;
      statRagEl.textContent = `${sourceCount} search / ${autoInjectCount} inject`;
    }
  }
}

function applySettingsToForm() {
  window.__personaModule?.renderDefaultPersonaSelect();
  const personas = window.__personaModule?.getPersonas() || [];
  if (personas.length) {
    const currentId = window.__personaModule?.getActivePersonaId();
    const nextPersonaId = window.__personaModule?.findPersonaById(currentId) ? currentId : personas[0].id;
    window.__personaModule?.selectPersonaForEditing(nextPersonaId);
  } else {
    window.__personaModule?.selectPersonaForEditing(null);
  }
  if (temperatureEl) temperatureEl.value = String(appSettings.temperature ?? 0.7);
  if (maxStepsEl) maxStepsEl.value = String(appSettings.max_steps || 5);
  if (maxParallelToolsEl) maxParallelToolsEl.value = String(appSettings.max_parallel_tools ?? 4);
  if (searchToolQueryLimitEl) searchToolQueryLimitEl.value = String(appSettings.search_tool_query_limit ?? 5);
  if (subAgentMaxStepsEl) subAgentMaxStepsEl.value = String(appSettings.sub_agent_max_steps ?? 6);
  if (subAgentTimeoutSecondsEl) subAgentTimeoutSecondsEl.value = String(appSettings.sub_agent_timeout_seconds ?? 240);
  if (subAgentRetryAttemptsEl) subAgentRetryAttemptsEl.value = String(appSettings.sub_agent_retry_attempts ?? 2);
  if (subAgentRetryDelaySecondsEl) subAgentRetryDelaySecondsEl.value = String(appSettings.sub_agent_retry_delay_seconds ?? 5);
  if (subAgentMaxParallelToolsEl) subAgentMaxParallelToolsEl.value = String(appSettings.sub_agent_max_parallel_tools ?? appSettings.max_parallel_tools ?? 2);
  if (webCacheTtlHoursEl) webCacheTtlHoursEl.value = String(appSettings.web_cache_ttl_hours ?? 24);
  if (openrouterPromptCacheEnabledEl) openrouterPromptCacheEnabledEl.checked = Boolean(appSettings.openrouter_prompt_cache_enabled ?? true);
  const _cacheEnabled = Boolean(appSettings.openrouter_prompt_cache_enabled ?? true);
  if (openrouterAnthropicCacheTtlRowEl) openrouterAnthropicCacheTtlRowEl.hidden = !_cacheEnabled;
  const _activeTtl = appSettings.openrouter_anthropic_cache_ttl || "5m";
  openrouterAnthropicCacheTtlEls.forEach(el => { el.checked = el.value === _activeTtl; });
  if (openrouterHttpRefererEl) openrouterHttpRefererEl.value = String(appSettings.openrouter_http_referer || "");
  if (openrouterAppTitleEl) openrouterAppTitleEl.value = String(appSettings.openrouter_app_title || "");
  if (loginSessionTimeoutMinutesEl) loginSessionTimeoutMinutesEl.value = String(appSettings.login_session_timeout_minutes ?? 30);
  if (loginMaxFailedAttemptsEl) loginMaxFailedAttemptsEl.value = String(appSettings.login_max_failed_attempts ?? 3);
  if (loginLockoutSecondsEl) loginLockoutSecondsEl.value = String(appSettings.login_lockout_seconds ?? 300);
  if (loginRememberSessionDaysEl) loginRememberSessionDaysEl.value = String(appSettings.login_remember_session_days ?? 3650);
  if (clarificationMaxQuestionsEl) clarificationMaxQuestionsEl.value = String(appSettings.clarification_max_questions || 5);
  if (summaryModeEl) summaryModeEl.value = appSettings.chat_summary_mode || "auto";
  if (summaryDetailLevelEl) summaryDetailLevelEl.value = appSettings.chat_summary_detail_level || "balanced";
  if (summaryTriggerEl) summaryTriggerEl.value = String(appSettings.chat_summary_trigger_token_count || 80000);
  if (summarySkipFirstEl) summarySkipFirstEl.value = String(appSettings.summary_skip_first ?? 2);
  if (summarySkipLastEl) summarySkipLastEl.value = String(appSettings.summary_skip_last ?? 1);
  if (promptPreflightSummaryTokenCountEl) {
    promptPreflightSummaryTokenCountEl.value = String(appSettings.prompt_preflight_summary_token_count ?? 90000);
  }
  if (summarySourceTargetTokensEl) {
    summarySourceTargetTokensEl.value = String(appSettings.summary_source_target_tokens ?? 6000);
  }
  if (summaryRetryMinSourceTokensEl) {
    summaryRetryMinSourceTokensEl.value = String(appSettings.summary_retry_min_source_tokens ?? 1500);
  }
  if (promptMaxInputTokensEl) promptMaxInputTokensEl.value = String(appSettings.prompt_max_input_tokens ?? 80000);
  if (promptResponseTokenReserveEl) promptResponseTokenReserveEl.value = String(appSettings.prompt_response_token_reserve ?? 8000);
  if (promptRecentHistoryMaxTokensEl) promptRecentHistoryMaxTokensEl.value = String(appSettings.prompt_recent_history_max_tokens ?? 32000);
  if (promptSummaryMaxTokensEl) promptSummaryMaxTokensEl.value = String(appSettings.prompt_summary_max_tokens ?? 12000);
  if (promptRagMaxTokensEl) promptRagMaxTokensEl.value = String(appSettings.prompt_rag_max_tokens ?? 18000);
  if (promptToolTraceMaxTokensEl) promptToolTraceMaxTokensEl.value = String(appSettings.prompt_tool_trace_max_tokens ?? 9000);
  if (contextCompactionThresholdEl) contextCompactionThresholdEl.value = String(appSettings.context_compaction_threshold ?? 0.85);
  if (contextCompactionKeepRecentRoundsEl) contextCompactionKeepRecentRoundsEl.value = String(appSettings.context_compaction_keep_recent_rounds ?? 2);
  if (contextSelectionStrategyEl) contextSelectionStrategyEl.value = appSettings.context_selection_strategy || "classic";
  if (entropyProfileEl) entropyProfileEl.value = appSettings.entropy_profile || "balanced";
  if (entropyRagBudgetRatioEl) entropyRagBudgetRatioEl.value = String(appSettings.entropy_rag_budget_ratio ?? 35);
  if (entropyProtectCodeBlocksEl) entropyProtectCodeBlocksEl.checked = Boolean(appSettings.entropy_protect_code_blocks ?? true);
  if (entropyProtectToolResultsEl) entropyProtectToolResultsEl.checked = Boolean(appSettings.entropy_protect_tool_results ?? true);
  if (entropyReferenceBoostEl) entropyReferenceBoostEl.checked = Boolean(appSettings.entropy_reference_boost ?? true);
  if (reasoningAutoCollapseEl) reasoningAutoCollapseEl.checked = Boolean(appSettings.reasoning_auto_collapse);
  if (pruningEnabledEl) pruningEnabledEl.checked = Boolean(appSettings.pruning_enabled);
  if (pruningTokenThresholdEl) pruningTokenThresholdEl.value = String(appSettings.pruning_token_threshold || 80000);
  if (pruningBatchSizeEl) pruningBatchSizeEl.value = String(appSettings.pruning_batch_size || 10);
  if (pruningTargetReductionRatioEl) pruningTargetReductionRatioEl.value = String(appSettings.pruning_target_reduction_ratio ?? 0.65);
  if (pruningMinTargetTokensEl) pruningMinTargetTokensEl.value = String(appSettings.pruning_min_target_tokens ?? 160);
  if (fetchThresholdEl) fetchThresholdEl.value = String(appSettings.fetch_url_token_threshold || 3500);
  if (fetchAggressivenessEl) fetchAggressivenessEl.value = String(appSettings.fetch_url_clip_aggressiveness || 50);
  if (fetchHtmlConverterModeEl) fetchHtmlConverterModeEl.value = String(appSettings.fetch_html_converter_mode || "hybrid");
  if (fetchSummarizeMaxInputCharsEl) fetchSummarizeMaxInputCharsEl.value = String(appSettings.fetch_url_summarized_max_input_chars || 80000);
  if (fetchSummarizeMaxOutputTokensEl) fetchSummarizeMaxOutputTokensEl.value = String(appSettings.fetch_url_summarized_max_output_tokens || 2400);
  if (canvasPromptLinesEl) canvasPromptLinesEl.value = String(appSettings.canvas_prompt_max_lines || 250);
  if (canvasPromptTokensEl) canvasPromptTokensEl.value = String(appSettings.canvas_prompt_max_tokens || 4000);
  if (canvasPromptCharsEl) canvasPromptCharsEl.value = String(appSettings.canvas_prompt_max_chars || 20000);
  if (canvasCodeLineCharsEl) canvasCodeLineCharsEl.value = String(appSettings.canvas_prompt_code_line_max_chars || 180);
  if (canvasTextLineCharsEl) canvasTextLineCharsEl.value = String(appSettings.canvas_prompt_text_line_max_chars || 100);
  if (canvasExpandLinesEl) canvasExpandLinesEl.value = String(appSettings.canvas_expand_max_lines || 1600);
  if (canvasScrollLinesEl) canvasScrollLinesEl.value = String(appSettings.canvas_scroll_window_lines || 200);
  if (subAgentCanvasAutoSaveEl) subAgentCanvasAutoSaveEl.checked = Boolean(appSettings.sub_agent_canvas_auto_save ?? true);
  if (subAgentCanvasAutoOpenEl) subAgentCanvasAutoOpenEl.checked = Boolean(appSettings.sub_agent_canvas_auto_open);
  if (conversationMemoryEnabledEl) conversationMemoryEnabledEl.checked = Boolean(appSettings.conversation_memory_enabled);
  if (ocrEnabledEl) ocrEnabledEl.checked = Boolean(appSettings.ocr_enabled);
  if (ragEnabledEl) ragEnabledEl.checked = Boolean(appSettings.rag_enabled);
  if (youtubeTranscriptsEnabledEl) youtubeTranscriptsEnabledEl.checked = Boolean(appSettings.youtube_transcripts_enabled);
  if (chatSummaryModelEl) chatSummaryModelEl.value = String(appSettings.chat_summary_model || "");
  if (ragChunkSizeEl) ragChunkSizeEl.value = String(appSettings.rag_chunk_size ?? 1800);
  if (ragChunkOverlapEl) ragChunkOverlapEl.value = String(appSettings.rag_chunk_overlap ?? 250);
  if (ragMaxChunksPerSourceEl) ragMaxChunksPerSourceEl.value = String(appSettings.rag_max_chunks_per_source ?? 2);
  if (ragSearchTopKEl) ragSearchTopKEl.value = String(appSettings.rag_search_top_k ?? 5);
  if (ragSearchMinSimilarityEl) ragSearchMinSimilarityEl.value = String(appSettings.rag_search_min_similarity ?? 0.35);
  if (ragQueryExpansionEnabledEl) ragQueryExpansionEnabledEl.checked = Boolean(appSettings.rag_query_expansion_enabled ?? true);
  if (ragQueryExpansionMaxVariantsEl) ragQueryExpansionMaxVariantsEl.value = String(appSettings.rag_query_expansion_max_variants ?? 2);
  if (fetchRawMaxTextCharsEl) fetchRawMaxTextCharsEl.value = String(appSettings.fetch_raw_max_text_chars ?? 24000);
  if (fetchSummaryMaxCharsEl) fetchSummaryMaxCharsEl.value = String(appSettings.fetch_summary_max_chars ?? 8000);
  applySelectedTools(appSettings.active_tools || []);
  applySelectedSubAgentTools(appSettings.sub_agent_allowed_tool_names || []);
  applySelectedProxyOperations(appSettings.proxy_enabled_operations || []);
  if (ragSensitivityEl) {
    ragSensitivityEl.value = appSettings.rag_sensitivity || "normal";
  }
  if (ragContextSizeEl) {
    ragContextSizeEl.value = appSettings.rag_context_size || "medium";
  }
  if (ragAutoInjectEnabledEl) {
    ragAutoInjectEnabledEl.checked = Boolean(appSettings.rag_auto_inject);
  }
  applySelectedRagSourceTypes(appSettings.rag_source_types || []);
  applySelectedRagAutoInjectSourceTypes(appSettings.rag_auto_inject_source_types || appSettings.rag_source_types || []);
  if (imageProcessingMethodEl) {
    imageProcessingMethodEl.value = appSettings.image_processing_method || "auto";
  }
  if (imageHelperModelEl) {
    imageHelperModelEl.value = appSettings.image_helper_model || "";
  }
  syncImageHelperModelVisibility();
  draftCustomModels = Array.isArray(appSettings.custom_models)
    ? appSettings.custom_models.map((model) => normalizeDraftCustomModel(model))
    : [];
  editingCustomModelClientUid = null;
  draftChatModelRows = [];
  initializeOperationFallbackDraftRows(appSettings.operation_model_fallback_preferences || {});
  renderModelManagementPanels({
    operationPreferences: appSettings.operation_model_preferences || {},
  });
  setCustomModelStatus("No pending model changes", "muted");
  updateCustomModelEditControls();
  syncCustomModelReasoningControls();
  syncCustomModelProviderControls();
  updateRagSensitivityHint();
  syncContextStrategyAvailability();
  syncPruningSettingsAvailability();
  if (scratchpadListEl || scratchpadAddBtn || scratchpadCountEl) {
    window.__scratchpadModule?.renderScratchpad(true);
  }
  syncOverviewStats();
}

function applyFeatureAvailability() {
  const ragEnabled = Boolean(featureFlags.rag_enabled);

  if (ragSensitivityEl) ragSensitivityEl.disabled = !ragEnabled;
  if (ragContextSizeEl) ragContextSizeEl.disabled = !ragEnabled;
  ragSourceTypeEls.forEach((element) => {
    element.disabled = !ragEnabled;
  });
  ragAutoInjectSourceTypeEls.forEach((element) => {
    element.disabled = !ragEnabled;
  });
  if (kbSyncBtn) kbSyncBtn.disabled = !ragEnabled;
  if (kbUploadFileEl) kbUploadFileEl.disabled = !ragEnabled;
  if (kbUploadTitleEl) kbUploadTitleEl.disabled = !ragEnabled;
  if (kbUploadDescriptionEl) kbUploadDescriptionEl.disabled = !ragEnabled;
  if (kbUploadAutoInjectEl) kbUploadAutoInjectEl.disabled = !ragEnabled;
  if (kbUploadBtn) kbUploadBtn.disabled = !ragEnabled;
  if (ragInjectOptionsEl) {
    ragInjectOptionsEl.classList.toggle("is-disabled", !ragEnabled);
    ragInjectOptionsEl.setAttribute("aria-disabled", !ragEnabled ? "true" : "false");
  }
  if (ragDisabledNoteEl) {
    ragDisabledNoteEl.hidden = ragEnabled;
  }
  if (scratchpadAddBtn) {
    scratchpadAddBtn.hidden = false;
  }
  if (scratchpadReadonlyNoteEl) {
    scratchpadReadonlyNoteEl.hidden = false;
  }
  if (!ragEnabled) {
    setKbStatus("RAG disabled in .env", "warning");
    setKbUploadStatus("Upload disabled because RAG is off", "warning");
  } else {
    setKbUploadStatus("Ready to upload", "muted");
  }
  syncRagAutoInjectSourceAvailability();
  syncContextStrategyAvailability();
  syncPruningSettingsAvailability();
  updateRagSourceSummary();
  syncOverviewStats();
}

function applyServerSettingsData(data) {
  appSettings.activity_enabled = Boolean(data.activity_enabled);
  appSettings.activity_retention_days = data.activity_retention_days ?? 30;
  appSettings.general_instructions = data.general_instructions || "";
  appSettings.ai_personality = data.ai_personality || "";
  appSettings.effective_user_preferences = data.effective_user_preferences || "";
  appSettings.default_persona_id = normalizePersonaId(data.default_persona_id);
  appSettings.personas = Array.isArray(data.personas) ? data.personas : [];
  appSettings.scratchpad = data.scratchpad || "";
  appSettings.scratchpad_sections = data.scratchpad_sections && typeof data.scratchpad_sections === "object"
    ? data.scratchpad_sections
    : {};
  appSettings.max_steps = data.max_steps || 5;
  appSettings.max_parallel_tools = data.max_parallel_tools ?? 4;
  appSettings.search_tool_query_limit = data.search_tool_query_limit ?? 5;
  appSettings.sub_agent_max_steps = data.sub_agent_max_steps ?? 6;
  appSettings.sub_agent_timeout_seconds = data.sub_agent_timeout_seconds ?? 240;
  appSettings.sub_agent_retry_attempts = data.sub_agent_retry_attempts ?? 2;
  appSettings.sub_agent_retry_delay_seconds = data.sub_agent_retry_delay_seconds ?? 5;
  appSettings.sub_agent_max_parallel_tools = data.sub_agent_max_parallel_tools ?? data.max_parallel_tools ?? 2;
  appSettings.sub_agent_canvas_auto_save = Boolean(data.sub_agent_canvas_auto_save ?? true);
  appSettings.sub_agent_canvas_auto_open = Boolean(data.sub_agent_canvas_auto_open);
  appSettings.web_cache_ttl_hours = data.web_cache_ttl_hours ?? 24;
  appSettings.openrouter_prompt_cache_enabled = Boolean(data.openrouter_prompt_cache_enabled ?? true);
  appSettings.openrouter_anthropic_cache_ttl = data.openrouter_anthropic_cache_ttl || "5m";
  appSettings.openrouter_http_referer = data.openrouter_http_referer || "";
  appSettings.openrouter_app_title = data.openrouter_app_title || "";
  appSettings.login_session_timeout_minutes = data.login_session_timeout_minutes ?? 30;
  appSettings.login_max_failed_attempts = data.login_max_failed_attempts ?? 3;
  appSettings.login_lockout_seconds = data.login_lockout_seconds ?? 300;
  appSettings.login_remember_session_days = data.login_remember_session_days ?? 3650;
  appSettings.temperature = data.temperature ?? 0.7;
  appSettings.clarification_max_questions = data.clarification_max_questions || 5;
  appSettings.available_models = Array.isArray(data.available_models) ? data.available_models : [];
  appSettings.custom_model_contract = data.custom_model_contract && typeof data.custom_model_contract === "object"
    ? data.custom_model_contract
    : {};
  appSettings.custom_models = Array.isArray(data.custom_models) ? data.custom_models : [];
  appSettings.visible_model_order = Array.isArray(data.visible_model_order) ? data.visible_model_order : [];
  appSettings.default_chat_model = data.default_chat_model || "";
  appSettings.operation_model_preferences = data.operation_model_preferences && typeof data.operation_model_preferences === "object"
    ? data.operation_model_preferences
    : {};
  appSettings.operation_model_fallback_preferences = data.operation_model_fallback_preferences && typeof data.operation_model_fallback_preferences === "object"
    ? data.operation_model_fallback_preferences
    : {};
  appSettings.image_processing_method = data.image_processing_method || "auto";
  appSettings.image_helper_model = data.image_helper_model || "";
  appSettings.conversation_memory_enabled = Boolean(data.conversation_memory_enabled);
  appSettings.ocr_enabled = Boolean(data.ocr_enabled);
  appSettings.rag_enabled = Boolean(data.rag_enabled);
  appSettings.youtube_transcripts_enabled = Boolean(data.youtube_transcripts_enabled);
  appSettings.chat_summary_model = data.chat_summary_model || "";
  appSettings.chat_summary_mode = data.chat_summary_mode || "auto";
  appSettings.chat_summary_detail_level = data.chat_summary_detail_level || "balanced";
  appSettings.chat_summary_trigger_token_count = data.chat_summary_trigger_token_count || 80000;
  appSettings.summary_skip_first = data.summary_skip_first ?? 2;
  appSettings.summary_skip_last = data.summary_skip_last ?? 1;
  appSettings.prompt_preflight_summary_token_count = data.prompt_preflight_summary_token_count ?? 90000;
  appSettings.summary_source_target_tokens = data.summary_source_target_tokens ?? 6000;
  appSettings.summary_retry_min_source_tokens = data.summary_retry_min_source_tokens ?? 1500;
  appSettings.prompt_max_input_tokens = data.prompt_max_input_tokens ?? 80000;
  appSettings.prompt_response_token_reserve = data.prompt_response_token_reserve ?? 8000;
  appSettings.prompt_recent_history_max_tokens = data.prompt_recent_history_max_tokens ?? 32000;
  appSettings.prompt_summary_max_tokens = data.prompt_summary_max_tokens ?? 12000;
  appSettings.prompt_rag_max_tokens = data.prompt_rag_max_tokens ?? 18000;
  appSettings.prompt_tool_trace_max_tokens = data.prompt_tool_trace_max_tokens ?? 9000;
  appSettings.context_compaction_threshold = data.context_compaction_threshold ?? 0.85;
  appSettings.context_compaction_keep_recent_rounds = data.context_compaction_keep_recent_rounds ?? 2;
  appSettings.context_selection_strategy = data.context_selection_strategy || "classic";
  appSettings.entropy_profile = data.entropy_profile || "balanced";
  appSettings.entropy_rag_budget_ratio = data.entropy_rag_budget_ratio ?? 35;
  appSettings.entropy_protect_code_blocks = Boolean(data.entropy_protect_code_blocks ?? true);
  appSettings.entropy_protect_tool_results = Boolean(data.entropy_protect_tool_results ?? true);
  appSettings.entropy_reference_boost = Boolean(data.entropy_reference_boost ?? true);
  appSettings.reasoning_auto_collapse = Boolean(data.reasoning_auto_collapse);
  appSettings.pruning_enabled = Boolean(data.pruning_enabled);
  appSettings.pruning_token_threshold = data.pruning_token_threshold || 80000;
  appSettings.pruning_batch_size = data.pruning_batch_size || 10;
  appSettings.pruning_target_reduction_ratio = data.pruning_target_reduction_ratio ?? 0.65;
  appSettings.pruning_min_target_tokens = data.pruning_min_target_tokens ?? 160;
  appSettings.fetch_url_token_threshold = data.fetch_url_token_threshold || 3500;
  appSettings.fetch_url_clip_aggressiveness = data.fetch_url_clip_aggressiveness ?? 50;
  appSettings.fetch_html_converter_mode = data.fetch_html_converter_mode || "hybrid";
  appSettings.fetch_url_summarized_max_input_chars = data.fetch_url_summarized_max_input_chars || 80000;
  appSettings.fetch_url_summarized_max_output_tokens = data.fetch_url_summarized_max_output_tokens || 2400;
  appSettings.canvas_prompt_max_lines = data.canvas_prompt_max_lines || 250;
  appSettings.canvas_prompt_max_tokens = data.canvas_prompt_max_tokens || 4000;
  appSettings.canvas_prompt_max_chars = data.canvas_prompt_max_chars || 20000;
  appSettings.canvas_prompt_code_line_max_chars = data.canvas_prompt_code_line_max_chars || 180;
  appSettings.canvas_prompt_text_line_max_chars = data.canvas_prompt_text_line_max_chars || 100;
  appSettings.canvas_expand_max_lines = data.canvas_expand_max_lines || 1600;
  appSettings.canvas_scroll_window_lines = data.canvas_scroll_window_lines || 200;
  appSettings.rag_chunk_size = data.rag_chunk_size ?? 1800;
  appSettings.rag_chunk_overlap = data.rag_chunk_overlap ?? 250;
  appSettings.rag_max_chunks_per_source = data.rag_max_chunks_per_source ?? 2;
  appSettings.rag_search_top_k = data.rag_search_top_k ?? 5;
  appSettings.rag_search_min_similarity = data.rag_search_min_similarity ?? 0.35;
  appSettings.rag_query_expansion_enabled = Boolean(data.rag_query_expansion_enabled ?? true);
  appSettings.rag_query_expansion_max_variants = data.rag_query_expansion_max_variants ?? 2;
  appSettings.fetch_raw_max_text_chars = data.fetch_raw_max_text_chars ?? 24000;
  appSettings.fetch_summary_max_chars = data.fetch_summary_max_chars ?? 8000;
  appSettings.sub_agent_allowed_tool_names = Array.isArray(data.sub_agent_allowed_tool_names) ? data.sub_agent_allowed_tool_names : [];
  appSettings.active_tools = Array.isArray(data.active_tools) ? data.active_tools : [];
  appSettings.proxy_enabled_operations = Array.isArray(data.proxy_enabled_operations) ? data.proxy_enabled_operations : [];
  appSettings.rag_auto_inject = Boolean(data.rag_auto_inject);
  appSettings.rag_sensitivity = data.rag_sensitivity || "normal";
  appSettings.rag_context_size = data.rag_context_size || "medium";
  appSettings.rag_source_types = Array.isArray(data.rag_source_types) ? data.rag_source_types : [];
  appSettings.rag_auto_inject_source_types = Array.isArray(data.rag_auto_inject_source_types)
    ? data.rag_auto_inject_source_types
    : appSettings.rag_source_types;
  if (data.features && typeof data.features === "object") {
    Object.assign(featureFlags, data.features);
  }
}

async function refreshSettings() {
  try {
    const response = await fetch("/api/settings");
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Failed to load settings.");
    }

    applyServerSettingsData(data);

    applySettingsToForm();
    applyFeatureAvailability();
    hasUnsavedSettingsChanges = false;
    window.__personaModule?.clearPersonaDirty();
    updateDirtyIndicators();
    setSettingsStatus("Ready");
    setDirtyPill("All changes saved", "muted");
  } catch (error) {
    setSettingsStatus(error.message || "Failed to load settings.", "error");
    setDirtyPill("Load failed", "error");
  }
}

async function saveSettings() {
  const scratchpadSections = window.__scratchpadModule?.readScratchpadSectionsFromList() ?? {};
  const previousSettingsSnapshot = { ...appSettings };
  const isRagEnabledDraft = Boolean(ragEnabledEl?.checked);
  const fullPayload = {
    default_persona_id: defaultPersonaEl?.value || "",
    temperature: readFloatSetting(temperatureEl, 0.7, { min: 0, max: 2 }),
    max_steps: readNumericSetting(maxStepsEl, 5, { allowZero: false }),
    max_parallel_tools: readNumericSetting(maxParallelToolsEl, 4, { allowZero: false }),
    search_tool_query_limit: readNumericSetting(searchToolQueryLimitEl, 5, { allowZero: false, min: 1, max: 20 }),
    sub_agent_max_steps: readNumericSetting(subAgentMaxStepsEl, 6, { allowZero: false }),
    sub_agent_timeout_seconds: readNumericSetting(subAgentTimeoutSecondsEl, 240, { allowZero: false }),
    sub_agent_retry_attempts: readNumericSetting(subAgentRetryAttemptsEl, 2),
    sub_agent_retry_delay_seconds: readNumericSetting(subAgentRetryDelaySecondsEl, 5),
    sub_agent_max_parallel_tools: readNumericSetting(subAgentMaxParallelToolsEl, 2, { allowZero: false }),
    sub_agent_canvas_auto_save: Boolean(subAgentCanvasAutoSaveEl?.checked ?? true),
    sub_agent_canvas_auto_open: Boolean(subAgentCanvasAutoOpenEl?.checked),
    web_cache_ttl_hours: readNumericSetting(webCacheTtlHoursEl, 24),
    openrouter_prompt_cache_enabled: Boolean(openrouterPromptCacheEnabledEl?.checked),
    openrouter_anthropic_cache_ttl: (() => { const r = [...openrouterAnthropicCacheTtlEls].find(el => el.checked); return r ? r.value : "5m"; })(),
    openrouter_http_referer: String(openrouterHttpRefererEl?.value || "").trim(),
    openrouter_app_title: String(openrouterAppTitleEl?.value || "").trim(),
    login_session_timeout_minutes: readNumericSetting(loginSessionTimeoutMinutesEl, 30, { allowZero: false }),
    login_max_failed_attempts: readNumericSetting(loginMaxFailedAttemptsEl, 3, { allowZero: false }),
    login_lockout_seconds: readNumericSetting(loginLockoutSecondsEl, 300, { allowZero: false }),
    login_remember_session_days: readNumericSetting(loginRememberSessionDaysEl, 3650, { allowZero: false }),
    clarification_max_questions: readNumericSetting(clarificationMaxQuestionsEl, 5, { allowZero: false }),
    chat_summary_mode: summaryModeEl?.value || "auto",
    chat_summary_detail_level: summaryDetailLevelEl?.value || "balanced",
    chat_summary_trigger_token_count: readNumericSetting(summaryTriggerEl, 80000, { allowZero: false }),
    summary_skip_first: readNumericSetting(summarySkipFirstEl, 0),
    summary_skip_last: readNumericSetting(summarySkipLastEl, 1),
    prompt_preflight_summary_token_count: readNumericSetting(promptPreflightSummaryTokenCountEl, 90000, { allowZero: false, min: 2000, max: 200000 }),
    summary_source_target_tokens: readNumericSetting(summarySourceTargetTokensEl, 6000, { allowZero: false, min: 1000, max: 40000 }),
    summary_retry_min_source_tokens: readNumericSetting(summaryRetryMinSourceTokensEl, 1500, { allowZero: false, min: 500, max: 40000 }),
    prompt_max_input_tokens: readNumericSetting(promptMaxInputTokensEl, 80000, { allowZero: false, min: 8000, max: 120000 }),
    prompt_response_token_reserve: readNumericSetting(promptResponseTokenReserveEl, 8000, { allowZero: false, min: 1000, max: 32000 }),
    prompt_recent_history_max_tokens: readNumericSetting(promptRecentHistoryMaxTokensEl, 32000, { allowZero: false, min: 1000, max: 120000 }),
    prompt_summary_max_tokens: readNumericSetting(promptSummaryMaxTokensEl, 12000, { allowZero: false, min: 500, max: 120000 }),
    prompt_rag_max_tokens: readNumericSetting(promptRagMaxTokensEl, 18000, { min: 0, max: 120000 }),
    prompt_tool_trace_max_tokens: readNumericSetting(promptToolTraceMaxTokensEl, 9000, { min: 0, max: 120000 }),
    context_compaction_threshold: readFloatSetting(contextCompactionThresholdEl, 0.85, { min: 0.5, max: 0.98 }),
    context_compaction_keep_recent_rounds: readNumericSetting(contextCompactionKeepRecentRoundsEl, 2, { min: 0, max: 6 }),
    context_selection_strategy: contextSelectionStrategyEl?.value || "classic",
    entropy_profile: entropyProfileEl?.value || "balanced",
    entropy_rag_budget_ratio: readNumericSetting(entropyRagBudgetRatioEl, 35, { min: 0, max: 80 }),
    entropy_protect_code_blocks: Boolean(entropyProtectCodeBlocksEl?.checked),
    entropy_protect_tool_results: Boolean(entropyProtectToolResultsEl?.checked),
    entropy_reference_boost: Boolean(entropyReferenceBoostEl?.checked),
    pruning_enabled: Boolean(pruningEnabledEl?.checked),
    pruning_token_threshold: readNumericSetting(pruningTokenThresholdEl, 80000, { allowZero: false }),
    pruning_batch_size: readNumericSetting(pruningBatchSizeEl, 10, { allowZero: false }),
    pruning_target_reduction_ratio: readFloatSetting(pruningTargetReductionRatioEl, 0.65, { min: 0.1, max: 0.9 }),
    pruning_min_target_tokens: readNumericSetting(pruningMinTargetTokensEl, 160, { allowZero: false, min: 50, max: 5000 }),
    fetch_url_token_threshold: readNumericSetting(fetchThresholdEl, 3500, { allowZero: false }),
    fetch_url_clip_aggressiveness: readNumericSetting(fetchAggressivenessEl, 50),
    fetch_html_converter_mode: String(fetchHtmlConverterModeEl?.value || "hybrid"),
    fetch_url_summarized_max_input_chars: readNumericSetting(fetchSummarizeMaxInputCharsEl, 80000, { allowZero: false, min: 4000, max: 100000 }),
    fetch_url_summarized_max_output_tokens: readNumericSetting(fetchSummarizeMaxOutputTokensEl, 2400, { allowZero: false, min: 200, max: 4000 }),
    canvas_prompt_max_lines: readNumericSetting(canvasPromptLinesEl, 250, { allowZero: false }),
    canvas_prompt_max_tokens: readNumericSetting(canvasPromptTokensEl, 4000, { allowZero: false }),
    canvas_prompt_max_chars: readNumericSetting(canvasPromptCharsEl, 20000, { allowZero: false }),
    canvas_prompt_code_line_max_chars: readNumericSetting(canvasCodeLineCharsEl, 180, { allowZero: false }),
    canvas_prompt_text_line_max_chars: readNumericSetting(canvasTextLineCharsEl, 100, { allowZero: false }),
    canvas_expand_max_lines: readNumericSetting(canvasExpandLinesEl, 1600, { allowZero: false }),
    canvas_scroll_window_lines: readNumericSetting(canvasScrollLinesEl, 200, { allowZero: false }),
    conversation_memory_enabled: Boolean(conversationMemoryEnabledEl?.checked),
    ocr_enabled: Boolean(ocrEnabledEl?.checked),
    rag_enabled: Boolean(ragEnabledEl?.checked),
    youtube_transcripts_enabled: Boolean(youtubeTranscriptsEnabledEl?.checked),
    chat_summary_model: String(chatSummaryModelEl?.value || ""),
    rag_chunk_size: readNumericSetting(ragChunkSizeEl, 1800, { allowZero: false, min: 100, max: 8000 }),
    rag_chunk_overlap: readNumericSetting(ragChunkOverlapEl, 250, { min: 0, max: 4000 }),
    rag_max_chunks_per_source: readNumericSetting(ragMaxChunksPerSourceEl, 2, { allowZero: false, min: 1, max: 20 }),
    rag_search_top_k: readNumericSetting(ragSearchTopKEl, 5, { allowZero: false, min: 1, max: 50 }),
    rag_search_min_similarity: readFloatSetting(ragSearchMinSimilarityEl, 0.35, { min: 0, max: 1 }),
    rag_query_expansion_enabled: Boolean(ragQueryExpansionEnabledEl?.checked),
    rag_query_expansion_max_variants: readNumericSetting(ragQueryExpansionMaxVariantsEl, 2, { allowZero: false, min: 1, max: 10 }),
    fetch_raw_max_text_chars: readNumericSetting(fetchRawMaxTextCharsEl, 24000, { allowZero: false, min: 1000 }),
    fetch_summary_max_chars: readNumericSetting(fetchSummaryMaxCharsEl, 8000, { allowZero: false, min: 500 }),
    custom_models: window.__customModelsModule?.getDraftCustomModels().map((model) => window.__customModelsModule?.serializeDraftCustomModel(model)) ?? [],
    visible_model_order: getDraftVisibleModelOrder(),
    operation_model_preferences: window.__customModelsModule?.getOperationModelPreferencesDraft() ?? {},
    operation_model_fallback_preferences: window.__customModelsModule?.getOperationModelFallbackPreferencesDraft() ?? {},
    image_processing_method: imageProcessingMethodEl?.value || "auto",
    image_helper_model: imageHelperModelEl?.value || "",
    active_tools: getSelectedTools(),
    sub_agent_allowed_tool_names: getSelectedSubAgentTools(),
    proxy_enabled_operations: getSelectedProxyOperations(),
    rag_auto_inject: isRagEnabledDraft && ragAutoInjectEnabledEl ? ragAutoInjectEnabledEl.checked : false,
    rag_sensitivity: ragSensitivityEl?.value || "normal",
    rag_context_size: ragContextSizeEl?.value || "medium",
    rag_source_types: isRagEnabledDraft ? getSelectedRagSourceTypes() : [],
    rag_auto_inject_source_types: isRagEnabledDraft ? getSelectedRagAutoInjectSourceTypes() : [],
    scratchpad_sections: DEFAULT_SCRATCHPAD_SECTION_ORDER.reduce((acc, sectionId) => {
      const sectionContent = scratchpadSections[sectionId];
      acc[sectionId] = Array.isArray(sectionContent) ? sectionContent.join("\n") : "";
      return acc;
    }, {}),
  };

  if (reasoningAutoCollapseEl) {
    fullPayload.reasoning_auto_collapse = Boolean(reasoningAutoCollapseEl.checked);
  }

  const payload = buildSettingsDeltaPayload(fullPayload, appSettings);
  if (!Object.keys(payload).length) {
    clearDirtyState();
    hideRestartWarning();
    setSettingsStatus("No changes to save", "muted");
    setDirtyPill("All changes saved", "success");
    return;
  }

  saveButtons.forEach((button) => {
    button.disabled = true;
  });
  setSettingsStatus("Saving...");
  setDirtyPill("Saving...", "warning");

  try {
    const response = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Failed to save settings.");
    }

    const restartNeeded = hasRestartRequiredChanges(payload, previousSettingsSnapshot);
    applyServerSettingsData(data);

    applySettingsToForm();
    applyFeatureAvailability();
    clearDirtyState();
    if (restartNeeded) {
      showRestartWarning("Some changes are saved but will take effect after restarting the server.");
      setSettingsStatus("Saved — restart required for some changes.", "warning");
    } else {
      hideRestartWarning();
    }
  } catch (error) {
    setSettingsStatus(error.message || "Failed to save settings.", "error");
    setDirtyPill("Save failed", "error");
  } finally {
    saveButtons.forEach((button) => {
      button.disabled = false;
    });
  }
}

function setKbStatus(message, tone = "muted") {
  if (!kbStatusEl) {
    return;
  }
  kbStatusEl.textContent = message;
  kbStatusEl.dataset.tone = tone;
}

function setKbUploadStatus(message, tone = "muted") {
  if (!kbUploadStatusEl) {
    return;
  }
  kbUploadStatusEl.textContent = message;
  kbUploadStatusEl.dataset.tone = tone;
}

function syncKbUploadActionState() {
  const ragEnabled = Boolean(featureFlags.rag_enabled);
  const hasFile = Boolean(kbUploadFileEl?.files?.length);

  if (kbSuggestBtn) {
    kbSuggestBtn.disabled = !ragEnabled || !hasFile;
  }
  if (kbUploadBtn) {
    kbUploadBtn.disabled = !ragEnabled || !hasFile;
  }
}

function summarizeKbDocument(doc) {
  const metadata = doc && typeof doc.metadata === "object" ? doc.metadata : {};
  const parts = [RAG_SOURCE_TYPE_LABELS[doc.source_type] || doc.source_type || "Document"];
  if (doc.category) {
    parts.push(doc.category);
  }
  parts.push(`${doc.chunk_count || 0} chunks`);
  if (metadata.file_name) {
    parts.unshift(metadata.file_name);
  }
  return parts.join(" · ");
}

function renderKnowledgeBaseDocuments(docs) {
  if (!kbDocumentsListEl) {
    return;
  }

  kbDocumentsListEl.innerHTML = "";
  if (!docs.length) {
    kbDocumentsListEl.innerHTML = '<p class="kb-empty">No indexed sources yet.</p>';
    return;
  }

  docs.forEach((doc) => {
    const item = document.createElement("div");
    item.className = "kb-doc-item";

    const meta = document.createElement("div");
    meta.className = "kb-doc-meta";

    const title = document.createElement("div");
    title.className = "kb-doc-title";
    title.textContent = doc.source_name || "Untitled source";

    const sub = document.createElement("div");
    sub.className = "kb-doc-subtitle";
    sub.textContent = summarizeKbDocument(doc);

    meta.append(title, sub);

    const metadata = doc && typeof doc.metadata === "object" ? doc.metadata : {};
    const description = String(metadata.description || "").trim();
    if (description) {
      const descriptionEl = document.createElement("div");
      descriptionEl.className = "kb-doc-description";
      descriptionEl.textContent = description;
      meta.append(descriptionEl);
    }

    const badges = document.createElement("div");
    badges.className = "kb-doc-badges";
    if (doc.source_type === "uploaded_document") {
      const uploadBadge = document.createElement("span");
      uploadBadge.className = "kb-doc-badge";
      uploadBadge.textContent = "manual upload";
      badges.append(uploadBadge);
    }
    const autoInjectBadge = document.createElement("span");
    autoInjectBadge.className = "kb-doc-badge";
    const globalAutoInjectEnabled = Boolean(appSettings.rag_auto_inject);
    const perDocAutoInjectEnabled = metadata.auto_inject_enabled !== false;
    const isAutoInjectOn = globalAutoInjectEnabled && perDocAutoInjectEnabled;
    autoInjectBadge.dataset.tone = isAutoInjectOn ? "success" : "muted";
    autoInjectBadge.textContent = isAutoInjectOn ? "auto inject on" : "manual only";
    badges.append(autoInjectBadge);
    meta.append(badges);

    const del = document.createElement("button");
    del.type = "button";
    del.className = "kb-doc-delete";
    del.textContent = "Delete";
    del.addEventListener("click", () => {
      void deleteKnowledgeBaseDocument(doc.source_key);
    });

    item.append(meta, del);
    kbDocumentsListEl.append(item);
  });
}

async function loadKnowledgeBaseDocuments() {
  if (!Boolean(featureFlags.rag_enabled)) {
    renderKnowledgeBaseDocuments([]);
    setKbStatus("RAG disabled in .env", "warning");
    return;
  }

  try {
    const response = await fetch("/api/rag/documents");
    if (response.status === 410) {
      renderKnowledgeBaseDocuments([]);
      setKbStatus("RAG disabled in .env", "warning");
      return;
    }
    const docs = await response.json();
    renderKnowledgeBaseDocuments(Array.isArray(docs) ? docs : []);
  } catch (_) {
    renderKnowledgeBaseDocuments([]);
    setKbStatus("Failed to load indexed sources.", "error");
  }
}

async function deleteKnowledgeBaseDocument(sourceKey) {
  if (!sourceKey) {
    return;
  }
  setKbStatus("Deleting source...");
  try {
    const response = await fetch(`/api/rag/documents/${encodeURIComponent(sourceKey)}`, { method: "DELETE" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || "Delete failed.");
    }
    setKbStatus("Source deleted", "success");
    await loadKnowledgeBaseDocuments();
  } catch (error) {
    setKbStatus(error.message || "Delete failed.", "error");
  }
}

async function uploadKnowledgeBaseDocument() {
  if (!Boolean(featureFlags.rag_enabled)) {
    setKbUploadStatus("RAG disabled in .env", "warning");
    return;
  }

  const file = kbUploadFileEl?.files?.[0];
  if (!file) {
    setKbUploadStatus("Choose a document to upload.", "warning");
    return;
  }

  const formData = new FormData();
  formData.append("document", file);
  formData.append("source_name", kbUploadTitleEl?.value.trim() || "");
  formData.append("description", kbUploadDescriptionEl?.value.trim() || "");
  formData.append("auto_inject_enabled", kbUploadAutoInjectEl?.checked ? "true" : "false");

  if (kbUploadBtn) {
    kbUploadBtn.disabled = true;
  }
  if (kbSuggestBtn) {
    kbSuggestBtn.disabled = true;
  }
  setKbUploadStatus("Uploading document...");

  try {
    const response = await fetch("/api/rag/ingest", {
      method: "POST",
      body: formData,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || "Upload failed.");
    }

    if (kbUploadFileEl) {
      kbUploadFileEl.value = "";
    }
    if (kbUploadTitleEl) {
      kbUploadTitleEl.value = "";
    }
    if (kbUploadDescriptionEl) {
      kbUploadDescriptionEl.value = "";
      autoResize(kbUploadDescriptionEl);
    }
    if (kbUploadAutoInjectEl) {
      kbUploadAutoInjectEl.checked = true;
    }

    const sourceName = data.document?.source_name || data.file_name || "Document";
    setKbUploadStatus(`${sourceName} indexed`, "success");
    await loadKnowledgeBaseDocuments();
  } catch (error) {
    setKbUploadStatus(error.message || "Upload failed.", "error");
  } finally {
    syncKbUploadActionState();
  }
}

async function generateKnowledgeBaseMetadata() {
  if (!Boolean(featureFlags.rag_enabled)) {
    setKbUploadStatus("RAG disabled in .env", "warning");
    return;
  }

  const file = kbUploadFileEl?.files?.[0];
  if (!file) {
    setKbUploadStatus("Choose a document first.", "warning");
    return;
  }

  const formData = new FormData();
  formData.append("document", file);
  formData.append("source_name", kbUploadTitleEl?.value.trim() || "");
  formData.append("description", kbUploadDescriptionEl?.value.trim() || "");

  if (kbSuggestBtn) {
    kbSuggestBtn.disabled = true;
  }
  if (kbUploadBtn) {
    kbUploadBtn.disabled = true;
  }
  setKbUploadStatus("Generating title and description...", "muted");

  try {
    const response = await fetch("/api/rag/upload-metadata", {
      method: "POST",
      body: formData,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || "Metadata generation failed.");
    }

    if (kbUploadTitleEl && typeof data.title === "string") {
      kbUploadTitleEl.value = data.title;
    }
    if (kbUploadDescriptionEl && typeof data.description === "string") {
      kbUploadDescriptionEl.value = data.description;
      autoResize(kbUploadDescriptionEl);
    }

    setKbUploadStatus("Title and description generated.", "success");
  } catch (error) {
    setKbUploadStatus(error.message || "Metadata generation failed.", "error");
  } finally {
    syncKbUploadActionState();
  }
}

async function syncKnowledgeBaseConversations() {
  if (!Boolean(featureFlags.rag_enabled)) {
    setKbStatus("RAG disabled in .env", "warning");
    return;
  }

  if (kbSyncBtn) {
    kbSyncBtn.disabled = true;
  }
  setKbStatus("Syncing conversations into RAG...");

  try {
    const response = await fetch("/api/rag/sync-conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || "Conversation sync failed.");
    }
    setKbStatus(`${data.count || 0} RAG sources synced`, "success");
    await loadKnowledgeBaseDocuments();
  } catch (error) {
    setKbStatus(error.message || "Conversation sync failed.", "error");
  } finally {
    if (kbSyncBtn) {
      kbSyncBtn.disabled = false;
    }
  }
}

function activateTab(tabId, updateHash = true) {
  const normalizedTabId = String(tabId || "general");
  const nextId = SETTINGS_TAB_ALIASES[normalizedTabId] || normalizedTabId;

  tabButtons.forEach((button) => {
    const isActive = button.dataset.settingsTab === nextId;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-selected", String(isActive));
  });

  tabPanels.forEach((panel) => {
    const isActive = panel.dataset.settingsPanel === nextId;
    panel.classList.toggle("active", isActive);
    panel.toggleAttribute("hidden", !isActive);
  });

  if (updateHash) {
    history.replaceState(null, "", `#${nextId}`);
  }
}

function initializeTabs() {
  tabButtons.forEach((button) => {
    button.addEventListener("click", () => activateTab(button.dataset.settingsTab));
  });

  const hash = String(window.location.hash || "").replace(/^#/, "");
  const resolvedHash = SETTINGS_TAB_ALIASES[hash] || hash;
  const initialTab = tabButtons.some((button) => button.dataset.settingsTab === resolvedHash) ? resolvedHash : "general";
  activateTab(initialTab, false);
}

// General settings event listeners
imageProcessingMethodEl?.addEventListener("change", () => {
  syncImageHelperModelVisibility();
  markDirty();
});
openrouterHttpRefererEl?.addEventListener("input", markDirty);
openrouterAppTitleEl?.addEventListener("input", markDirty);
loginSessionTimeoutMinutesEl?.addEventListener("input", markDirty);
loginMaxFailedAttemptsEl?.addEventListener("input", markDirty);
loginLockoutSecondsEl?.addEventListener("input", markDirty);
loginRememberSessionDaysEl?.addEventListener("input", markDirty);
conversationMemoryEnabledEl?.addEventListener("change", markDirty);
ocrEnabledEl?.addEventListener("change", markDirty);
ragEnabledEl?.addEventListener("change", markDirty);
youtubeTranscriptsEnabledEl?.addEventListener("change", markDirty);
chatSummaryModelEl?.addEventListener("change", markDirty);
ragChunkSizeEl?.addEventListener("input", markDirty);
ragChunkOverlapEl?.addEventListener("input", markDirty);
ragMaxChunksPerSourceEl?.addEventListener("input", markDirty);
ragSearchTopKEl?.addEventListener("input", markDirty);
ragSearchMinSimilarityEl?.addEventListener("input", markDirty);
ragQueryExpansionEnabledEl?.addEventListener("change", markDirty);
ragQueryExpansionMaxVariantsEl?.addEventListener("input", markDirty);
fetchRawMaxTextCharsEl?.addEventListener("input", markDirty);
fetchSummaryMaxCharsEl?.addEventListener("input", markDirty);
saveButtons.forEach((button) => {
  button.addEventListener("click", () => {
    void saveAllSettings();
  });
});

window.addEventListener("beforeunload", (event) => {
  if (!hasUnsavedSettingsChanges && !(window.__personaModule?.hasUnsavedPersonaChanges() ?? false)) {
    return;
  }
  event.preventDefault();
  event.returnValue = "";
});

window.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    void saveAllSettings();
  }
});

initializeTabs();
applySettingsToForm();
applyFeatureAvailability();
setSettingsStatus("Ready");
setDirtyPill("All changes saved", "muted");
void refreshSettings();
window.__knowledgeBaseModule?.syncKbUploadActionState();
void window.__knowledgeBaseModule?.loadKnowledgeBaseDocuments();
