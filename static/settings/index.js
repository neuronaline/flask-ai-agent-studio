// Settings entry point — wires all modules together and provides top-level coordination.
// Kept as a single file: the former context/fetch/tools/tabs/init modules were merged here,
// organized as clear sections sharing one DOM-ref block.
(function () {
  "use strict";

  // ═══════════════════════════════════════════════════════════════════════════════
  // Shared DOM references (single source of truth)
  // ═══════════════════════════════════════════════════════════════════════════════
  // Assistant / general
  const temperatureEl = document.getElementById("temperature-input");
  const clarificationMaxQuestionsEl = document.getElementById("clarification-max-questions-input");
  const imageProcessingMethodEl = document.getElementById("image-processing-method-select");
  const imageHelperModelEl = document.getElementById("image-helper-model-select");
  const imageHelperMaxImagesEl = document.getElementById("image-helper-max-images-input");
  const defaultPersonaEl = document.getElementById("default-persona-select");

  // Runtime budgets
  const maxStepsEl = document.getElementById("max-steps-input");
  const maxParallelToolsEl = document.getElementById("max-parallel-tools-input");
  const searchToolQueryLimitEl = document.getElementById("search-tool-query-limit-input");

  // Sub-agent
  const subAgentMaxStepsEl = document.getElementById("sub-agent-max-steps-input");
  const subAgentTimeoutSecondsEl = document.getElementById("sub-agent-timeout-seconds-input");
  const subAgentRetryAttemptsEl = document.getElementById("sub-agent-retry-attempts-input");
  const subAgentRetryDelaySecondsEl = document.getElementById("sub-agent-retry-delay-seconds-input");
  const subAgentMaxParallelToolsEl = document.getElementById("sub-agent-max-parallel-tools-input");
  const subAgentToolToggleEls = Array.from(document.querySelectorAll("input[name='sub-agent-allowed-tool']"));
  const subAgentCanvasAutoSaveEl = document.getElementById("sub-agent-canvas-auto-save-toggle");
  const subAgentCanvasAutoOpenEl = document.getElementById("sub-agent-canvas-auto-open-toggle");

  // Web / cache
  const webCacheTtlHoursEl = document.getElementById("web-cache-ttl-hours-input");
  const brightDataSerpLanguageEl = document.getElementById("bright-data-serp-language-select");
  const brightDataSerpCountryEl = document.getElementById("bright-data-serp-country-input");
  const brightDataSerpTimeoutSecondsEl = document.getElementById("bright-data-serp-timeout-seconds-input");
  const scholarProxyEnabledEl = document.getElementById("scholar-proxy-enabled-toggle");
  const openrouterPromptCacheEnabledEl = document.getElementById("openrouter-prompt-cache-enabled-toggle");
  const openrouterAnthropicCacheTtlEls = document.querySelectorAll("input[name='openrouter-anthropic-cache-ttl']");
  const openrouterAnthropicCacheTtlRowEl = document.getElementById("openrouter-anthropic-cache-ttl-row");

  // Summary policy
  const summaryModeEl = document.getElementById("summary-mode-select");
  const summaryDetailLevelEl = document.getElementById("summary-detail-level-select");
  const summaryTriggerEl = document.getElementById("summary-trigger-input");
  const summarySkipFirstEl = document.getElementById("summary-skip-first-input");
  const summarySkipLastEl = document.getElementById("summary-skip-last-input");
  const promptPreflightSummaryTokenCountEl = document.getElementById("prompt-preflight-summary-token-count-input");
  const summarySourceTargetTokensEl = document.getElementById("summary-source-target-tokens-input");
  const summaryRetryMinSourceTokensEl = document.getElementById("summary-retry-min-source-tokens-input");

  // Conversation / feature gates
  const conversationMemoryEnabledEl = document.getElementById("conversation-memory-enabled-toggle");
  const conversationTruncationEnabledEl = document.getElementById("conversation-truncation-enabled-toggle");
  const conversationMaxMessagesEl = document.getElementById("conversation-max-messages-input");
  const conversationMaxMessageCharsEl = document.getElementById("conversation-max-message-chars-input");
  const ocrEnabledEl = document.getElementById("ocr-enabled-toggle");
  const ragEnabledEl = document.getElementById("rag-enabled-toggle");
  const youtubeTranscriptsEnabledEl = document.getElementById("youtube-transcripts-enabled-toggle");
  const reasoningAutoCollapseEl = document.getElementById("reasoning-auto-collapse-toggle");

  // RAG
  const ragSensitivityEl = document.getElementById("rag-sensitivity-select");
  const ragContextSizeEl = document.getElementById("rag-context-size-select");
  const ragAutoInjectEnabledEl = document.getElementById("rag-auto-inject-enabled-toggle");
  const ragChunkSizeEl = document.getElementById("rag-chunk-size-input");
  const ragChunkOverlapEl = document.getElementById("rag-chunk-overlap-input");
  const ragMaxChunksPerSourceEl = document.getElementById("rag-max-chunks-per-source-input");
  const ragSearchTopKEl = document.getElementById("rag-search-top-k-input");
  const ragSearchMinSimilarityEl = document.getElementById("rag-search-min-similarity-input");
  const ragQueryExpansionEnabledEl = document.getElementById("rag-query-expansion-enabled-toggle");
  const ragQueryExpansionMaxVariantsEl = document.getElementById("rag-query-expansion-max-variants-input");

  // Fetch
  const fetchThresholdEl = document.getElementById("fetch-threshold-input");
  const fetchAggressivenessEl = document.getElementById("fetch-aggressiveness-input");
  const fetchSummarizeMaxInputCharsEl = document.getElementById("fetch-summarize-max-input-chars-input");
  const fetchSummarizeMaxOutputTokensEl = document.getElementById("fetch-summarize-max-output-tokens-input");
  const fetchRawMaxTextCharsEl = document.getElementById("fetch-raw-max-text-chars-input");
  const fetchSummaryMaxCharsEl = document.getElementById("fetch-summary-max-chars-input");

  // Context compaction
  const contextCompactionThresholdEl = document.getElementById("context-compaction-threshold-input");
  const contextCompactionKeepRecentRoundsEl = document.getElementById("context-compaction-keep-recent-rounds-input");

  // Models
  const chatSummaryModelEl = document.getElementById("chat-summary-model-select");

  // Header
  const saveButtons = Array.from(document.querySelectorAll(".settings-save-trigger"));

  // ═══════════════════════════════════════════════════════════════════════════════
  // Shared state
  // ═══════════════════════════════════════════════════════════════════════════════
  const appSettings = window.__appSettings || {};
  const featureFlags = window.__featureFlags || appSettings.features || {};
  const core = window.__settingsCore || {};

  const DEFAULT_SCRATCHPAD_SECTION_ORDER = core.DEFAULT_SCRATCHPAD_SECTION_ORDER || ["lessons", "profile", "notes", "problems", "tasks", "preferences", "domain"];

  // Numeric readers — delegate to core
  const readNumericSetting = (el, defaultVal, opts = {}) => core.readNumericSetting(el, defaultVal, opts);
  const readFloatSetting = (el, defaultVal, opts = {}) => core.readFloatSetting(el, defaultVal, opts);

  const markDirty = () => core.markDirty?.();
  const getSelectedRadioValue = (radioEls, fallback) => {
    const selected = [...radioEls].find((el) => el.checked);
    return selected ? selected.value : fallback;
  };

  // ═══════════════════════════════════════════════════════════════════════════════
  // Context settings
  // ═══════════════════════════════════════════════════════════════════════════════
  function syncContextSettingsToForm() {
    if (contextCompactionThresholdEl) contextCompactionThresholdEl.value = String(appSettings.context_compaction_threshold ?? 0.85);
    if (contextCompactionKeepRecentRoundsEl) contextCompactionKeepRecentRoundsEl.value = String(appSettings.context_compaction_keep_recent_rounds ?? 2);
  }

  function readContextSettingsPayload() {
    return {
      context_compaction_threshold: readFloatSetting(contextCompactionThresholdEl, 0.85, { min: 0.5, max: 0.98 }),
      context_compaction_keep_recent_rounds: readNumericSetting(contextCompactionKeepRecentRoundsEl, 2, { min: 0, max: 6 }),
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Fetch settings
  // ═══════════════════════════════════════════════════════════════════════════════
  function syncFetchSettingsToForm() {
    if (fetchThresholdEl) fetchThresholdEl.value = String(appSettings.fetch_url_token_threshold || 3500);
    if (fetchAggressivenessEl) fetchAggressivenessEl.value = String(appSettings.fetch_url_clip_aggressiveness || 50);
    if (fetchSummarizeMaxInputCharsEl) fetchSummarizeMaxInputCharsEl.value = String(appSettings.fetch_url_summary_max_input_chars || 80000);
    if (fetchSummarizeMaxOutputTokensEl) fetchSummarizeMaxOutputTokensEl.value = String(appSettings.fetch_url_summary_max_output_tokens || 2400);
    if (fetchRawMaxTextCharsEl) fetchRawMaxTextCharsEl.value = String(appSettings.fetch_raw_max_text_chars || 24000);
    if (fetchSummaryMaxCharsEl) fetchSummaryMaxCharsEl.value = String(appSettings.fetch_summary_max_chars || 8000);
  }

  function readFetchSettingsPayload() {
    return {
      fetch_url_token_threshold: readNumericSetting(fetchThresholdEl, 3500, { allowZero: false }),
      fetch_url_clip_aggressiveness: readNumericSetting(fetchAggressivenessEl, 50),
      fetch_url_summary_max_input_chars: readNumericSetting(fetchSummarizeMaxInputCharsEl, 80000, { allowZero: false, min: 4000, max: 100000 }),
      fetch_url_summary_max_output_tokens: readNumericSetting(fetchSummarizeMaxOutputTokensEl, 2400, { allowZero: false, min: 200, max: 4000 }),
      fetch_raw_max_text_chars: readNumericSetting(fetchRawMaxTextCharsEl, 24000, { allowZero: false, min: 1000 }),
      fetch_summary_max_chars: readNumericSetting(fetchSummaryMaxCharsEl, 8000, { allowZero: false, min: 500 }),
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Tool selection
  // ═══════════════════════════════════════════════════════════════════════════════
  function getSelectedSubAgentTools() {
    return subAgentToolToggleEls.filter((element) => element.checked).map((element) => element.value);
  }

  function applySelectedSubAgentTools(selected) {
    const active = new Set(Array.isArray(selected) ? selected : []);
    subAgentToolToggleEls.forEach((element) => {
      element.checked = active.has(element.value);
    });
  }

  function getToolToggleEls() {
    return Array.from(document.querySelectorAll("input[name='parent-tool']"));
  }

  function getSelectedTools() {
    return getToolToggleEls().filter((element) => element.checked).map((element) => element.value);
  }

  function applySelectedTools(selected) {
    const active = new Set(Array.isArray(selected) ? selected : []);
    getToolToggleEls().forEach((element) => {
      element.checked = active.has(element.value);
    });
  }

  // ─── Sub-agent canvas automation ────────────────────────────────────────────
  function syncSubAgentCanvasSettings() {
    if (subAgentCanvasAutoSaveEl) subAgentCanvasAutoSaveEl.checked = Boolean(appSettings.sub_agent_canvas_auto_save ?? true);
    if (subAgentCanvasAutoOpenEl) subAgentCanvasAutoOpenEl.checked = Boolean(appSettings.sub_agent_canvas_auto_open ?? false);
  }

  function readSubAgentCanvasPayload() {
    return {
      sub_agent_canvas_auto_save: subAgentCanvasAutoSaveEl ? subAgentCanvasAutoSaveEl.checked : true,
      sub_agent_canvas_auto_open: subAgentCanvasAutoOpenEl ? subAgentCanvasAutoOpenEl.checked : false,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Tab navigation
  // ═══════════════════════════════════════════════════════════════════════════════
  const tabButtons = Array.from(document.querySelectorAll("[data-settings-tab]"));
  const tabPanels = Array.from(document.querySelectorAll("[data-settings-panel]"));
  const tabAliases = core.SETTINGS_TAB_ALIASES || {};

  function activateTab(tabId, updateHash = true) {
    const nextId = tabAliases[String(tabId || "general")] || String(tabId || "general");

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
    const resolvedHash = tabAliases[hash] || hash;
    const initialTab = tabButtons.some((button) => button.dataset.settingsTab === resolvedHash) ? resolvedHash : "general";
    activateTab(initialTab, false);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Payload builders (mirror the sectioned _apply_* pipeline in routes/pages.py)
  // ═══════════════════════════════════════════════════════════════════════════════
  function buildAssistantPayload() {
    return {
      default_persona_id: defaultPersonaEl?.value || "",
      temperature: readFloatSetting(temperatureEl, 0.7, { min: 0, max: 2 }),
      clarification_max_questions: readNumericSetting(clarificationMaxQuestionsEl, 5, { allowZero: false }),
      image_processing_method: imageProcessingMethodEl?.value || "multimodal",
      image_helper_model: imageHelperModelEl?.value || "",
      image_helper_max_images: readNumericSetting(imageHelperMaxImagesEl, 4, { allowZero: false, min: 1, max: 8 }),
    };
  }

  function buildRuntimePayload() {
    return {
      max_steps: readNumericSetting(maxStepsEl, 5, { allowZero: false }),
      max_parallel_tools: readNumericSetting(maxParallelToolsEl, 4, { allowZero: false }),
      search_tool_query_limit: readNumericSetting(searchToolQueryLimitEl, 5, { allowZero: false, min: 1, max: 20 }),
      sub_agent_max_steps: readNumericSetting(subAgentMaxStepsEl, 6, { allowZero: false }),
      sub_agent_timeout_seconds: readNumericSetting(subAgentTimeoutSecondsEl, 240, { allowZero: false }),
      sub_agent_retry_attempts: readNumericSetting(subAgentRetryAttemptsEl, 2),
      sub_agent_retry_delay_seconds: readNumericSetting(subAgentRetryDelaySecondsEl, 5),
      sub_agent_max_parallel_tools: readNumericSetting(subAgentMaxParallelToolsEl, 2, { allowZero: false }),
      web_cache_ttl_hours: readNumericSetting(webCacheTtlHoursEl, 24),
    };
  }

  function buildWebPayload() {
    return {
      bright_data_serp_language: brightDataSerpLanguageEl?.value || "en",
      bright_data_serp_country: String(brightDataSerpCountryEl?.value || "US").trim().toUpperCase(),
      bright_data_serp_timeout_seconds: readNumericSetting(brightDataSerpTimeoutSecondsEl, 30, { allowZero: false, min: 1, max: 120 }),
      scholar_proxy_enabled: Boolean(scholarProxyEnabledEl?.checked),
      openrouter_prompt_cache_enabled: Boolean(openrouterPromptCacheEnabledEl?.checked),
      openrouter_anthropic_cache_ttl: getSelectedRadioValue(openrouterAnthropicCacheTtlEls, "5m"),
    };
  }

  function buildSummaryPayload() {
    return {
      chat_summary_mode: summaryModeEl?.value || "auto",
      chat_summary_detail_level: summaryDetailLevelEl?.value || "balanced",
      chat_summary_trigger_token_count: readNumericSetting(summaryTriggerEl, 80000, { allowZero: false }),
      summary_skip_first: readNumericSetting(summarySkipFirstEl, 0),
      summary_skip_last: readNumericSetting(summarySkipLastEl, 1),
      prompt_preflight_summary_token_count: readNumericSetting(promptPreflightSummaryTokenCountEl, 90000, { allowZero: false, min: 2000, max: 200000 }),
      summary_source_target_tokens: readNumericSetting(summarySourceTargetTokensEl, 6000, { allowZero: false, min: 1000, max: 40000 }),
      summary_retry_min_source_tokens: readNumericSetting(summaryRetryMinSourceTokensEl, 1500, { allowZero: false, min: 500, max: 40000 }),
    };
  }

  function buildConversationPayload() {
    return {
      conversation_memory_enabled: Boolean(conversationMemoryEnabledEl?.checked),
      conversation_truncation_enabled: Boolean(conversationTruncationEnabledEl?.checked ?? true),
      conversation_max_messages: readNumericSetting(conversationMaxMessagesEl, 20, { allowZero: false, min: 3, max: 200 }),
      conversation_max_message_chars: readNumericSetting(conversationMaxMessageCharsEl, 500, { allowZero: false, min: 100, max: 50000 }),
      ocr_enabled: Boolean(ocrEnabledEl?.checked),
      rag_enabled: Boolean(ragEnabledEl?.checked),
      youtube_transcripts_enabled: Boolean(youtubeTranscriptsEnabledEl?.checked),
      reasoning_auto_collapse: Boolean(reasoningAutoCollapseEl?.checked),
    };
  }

  function buildRagPayload(isRagEnabledDraft) {
    return {
      rag_chunk_size: readNumericSetting(ragChunkSizeEl, 1800, { allowZero: false, min: 300, max: 100000 }),
      rag_chunk_overlap: readNumericSetting(ragChunkOverlapEl, 250, { min: 0, max: 4000 }),
      rag_max_chunks_per_source: readNumericSetting(ragMaxChunksPerSourceEl, 2, { allowZero: false, min: 1, max: 20 }),
      rag_search_top_k: readNumericSetting(ragSearchTopKEl, 5, { allowZero: false, min: 1, max: 50 }),
      rag_search_min_similarity: readFloatSetting(ragSearchMinSimilarityEl, 0.35, { min: 0, max: 1 }),
      rag_query_expansion_enabled: Boolean(ragQueryExpansionEnabledEl?.checked),
      rag_query_expansion_max_variants: readNumericSetting(ragQueryExpansionMaxVariantsEl, 2, { allowZero: false, min: 1, max: 10 }),
      rag_auto_inject: isRagEnabledDraft && ragAutoInjectEnabledEl ? ragAutoInjectEnabledEl.checked : false,
      rag_sensitivity: ragSensitivityEl?.value || "normal",
      rag_context_size: ragContextSizeEl?.value || "medium",
      rag_source_types: isRagEnabledDraft ? (window.__settingsRag?.getSelectedRagSourceTypes?.() ?? []) : [],
      rag_auto_inject_source_types: isRagEnabledDraft ? (window.__settingsRag?.getSelectedRagAutoInjectSourceTypes?.() ?? []) : [],
    };
  }

  function buildModelPayload() {
    return {
      chat_summary_model: String(chatSummaryModelEl?.value || ""),
      custom_models: (window.__customModelsModule?.getDraftCustomModels?.() ?? []).map((model) => window.__customModelsModule?.serializeDraftCustomModel?.(model) ?? model),
      visible_model_order: window.__customModelsModule?.getDraftVisibleModelOrder?.() ?? [],
      operation_model_preferences: window.__customModelsModule?.getOperationModelPreferencesDraft?.() ?? {},
      operation_model_fallback_preferences: window.__settingsModels?.getOperationModelFallbackPreferencesDraft?.() ?? {},
    };
  }

  function buildToolPayload() {
    return {
      active_tools: window.__settingsTools?.getSelectedTools?.() ?? [],
      sub_agent_allowed_tool_names: window.__settingsTools?.getSelectedSubAgentTools?.() ?? [],
      ...(window.__settingsTools?.readSubAgentCanvasPayload?.() ?? {}),
    };
  }

  function buildScratchpadPayload(scratchpadSections) {
    return {
      scratchpad_sections: DEFAULT_SCRATCHPAD_SECTION_ORDER.reduce((acc, sectionId) => {
        const sectionContent = scratchpadSections[sectionId];
        acc[sectionId] = Array.isArray(sectionContent) ? sectionContent.join("\n") : "";
        return acc;
      }, {}),
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // applySettingsToForm
  // ═══════════════════════════════════════════════════════════════════════════════
  function applyPersonaForm() {
    window.__personaModule?.renderDefaultPersonaSelect?.();
    const personas = window.__personaModule?.getPersonas?.() || [];
    if (personas.length) {
      const currentId = window.__personaModule?.getActivePersonaId?.();
      const nextPersonaId = window.__personaModule?.findPersonaById?.(currentId) ? currentId : personas[0].id;
      window.__personaModule?.selectPersonaForEditing?.(nextPersonaId);
    } else {
      window.__personaModule?.selectPersonaForEditing?.(null);
    }
  }

  function applyGeneralForm() {
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
    if (brightDataSerpLanguageEl) brightDataSerpLanguageEl.value = appSettings.bright_data_serp_language || "en";
    if (brightDataSerpCountryEl) brightDataSerpCountryEl.value = String(appSettings.bright_data_serp_country || "US");
    if (brightDataSerpTimeoutSecondsEl) brightDataSerpTimeoutSecondsEl.value = String(appSettings.bright_data_serp_timeout_seconds ?? 30);
    if (scholarProxyEnabledEl) scholarProxyEnabledEl.checked = Boolean(appSettings.scholar_proxy_enabled);
    if (openrouterPromptCacheEnabledEl) openrouterPromptCacheEnabledEl.checked = Boolean(appSettings.openrouter_prompt_cache_enabled ?? true);
    const cacheEnabled = Boolean(appSettings.openrouter_prompt_cache_enabled ?? true);
    if (openrouterAnthropicCacheTtlRowEl) openrouterAnthropicCacheTtlRowEl.hidden = !cacheEnabled;
    const activeTtl = appSettings.openrouter_anthropic_cache_ttl || "5m";
    openrouterAnthropicCacheTtlEls.forEach((el) => { el.checked = el.value === activeTtl; });
    if (clarificationMaxQuestionsEl) clarificationMaxQuestionsEl.value = String(appSettings.clarification_max_questions || 5);
  }

  function applySummaryForm() {
    if (summaryModeEl) summaryModeEl.value = appSettings.chat_summary_mode || "auto";
    if (summaryDetailLevelEl) summaryDetailLevelEl.value = appSettings.chat_summary_detail_level || "balanced";
    if (summaryTriggerEl) summaryTriggerEl.value = String(appSettings.chat_summary_trigger_token_count || 80000);
    if (summarySkipFirstEl) summarySkipFirstEl.value = String(appSettings.summary_skip_first ?? 2);
    if (summarySkipLastEl) summarySkipLastEl.value = String(appSettings.summary_skip_last ?? 1);
    if (promptPreflightSummaryTokenCountEl) promptPreflightSummaryTokenCountEl.value = String(appSettings.prompt_preflight_summary_token_count ?? 90000);
    if (summarySourceTargetTokensEl) summarySourceTargetTokensEl.value = String(appSettings.summary_source_target_tokens ?? 6000);
    if (summaryRetryMinSourceTokensEl) summaryRetryMinSourceTokensEl.value = String(appSettings.summary_retry_min_source_tokens ?? 1500);
    if (chatSummaryModelEl) chatSummaryModelEl.value = String(appSettings.chat_summary_model || "");
    syncContextSettingsToForm();
    syncFetchSettingsToForm();
  }

  function applyConversationForm() {
    if (conversationMemoryEnabledEl) conversationMemoryEnabledEl.checked = Boolean(appSettings.conversation_memory_enabled);
    if (conversationTruncationEnabledEl) conversationTruncationEnabledEl.checked = Boolean(appSettings.conversation_truncation_enabled ?? true);
    if (conversationMaxMessagesEl) conversationMaxMessagesEl.value = String(appSettings.conversation_max_messages ?? 20);
    if (conversationMaxMessageCharsEl) conversationMaxMessageCharsEl.value = String(appSettings.conversation_max_message_chars ?? 500);
    if (ocrEnabledEl) ocrEnabledEl.checked = Boolean(appSettings.ocr_enabled);
    if (ragEnabledEl) ragEnabledEl.checked = Boolean(appSettings.rag_enabled);
    if (youtubeTranscriptsEnabledEl) youtubeTranscriptsEnabledEl.checked = Boolean(appSettings.youtube_transcripts_enabled);
    if (reasoningAutoCollapseEl) reasoningAutoCollapseEl.checked = Boolean(appSettings.reasoning_auto_collapse);
  }

  function applyRagForm() {
    if (ragChunkSizeEl) ragChunkSizeEl.value = String(appSettings.rag_chunk_size ?? 1800);
    if (ragChunkOverlapEl) ragChunkOverlapEl.value = String(appSettings.rag_chunk_overlap ?? 250);
    if (ragMaxChunksPerSourceEl) ragMaxChunksPerSourceEl.value = String(appSettings.rag_max_chunks_per_source ?? 2);
    if (ragSearchTopKEl) ragSearchTopKEl.value = String(appSettings.rag_search_top_k ?? 5);
    if (ragSearchMinSimilarityEl) ragSearchMinSimilarityEl.value = String(appSettings.rag_search_min_similarity ?? 0.35);
    if (ragQueryExpansionEnabledEl) ragQueryExpansionEnabledEl.checked = Boolean(appSettings.rag_query_expansion_enabled ?? true);
    if (ragQueryExpansionMaxVariantsEl) ragQueryExpansionMaxVariantsEl.value = String(appSettings.rag_query_expansion_max_variants ?? 2);
    if (ragSensitivityEl) ragSensitivityEl.value = appSettings.rag_sensitivity || "normal";
    if (ragContextSizeEl) ragContextSizeEl.value = appSettings.rag_context_size || "medium";
    if (ragAutoInjectEnabledEl) ragAutoInjectEnabledEl.checked = Boolean(appSettings.rag_auto_inject);
    window.__settingsRag?.applySelectedRagSourceTypes?.(appSettings.rag_source_types || []);
    window.__settingsRag?.applySelectedRagAutoInjectSourceTypes?.(appSettings.rag_auto_inject_source_types || appSettings.rag_source_types || []);
    window.__settingsRag?.updateRagSensitivityHint?.();
  }

  function applyImageForm() {
    if (imageProcessingMethodEl) imageProcessingMethodEl.value = appSettings.image_processing_method || "multimodal";

    if (imageHelperModelEl) {
      const visionModels = appSettings.available_vision_models || [];
      imageHelperModelEl.innerHTML = '<option value="">None (disabled)</option>';
      visionModels.forEach((model) => {
        const option = document.createElement("option");
        option.value = model.id || "";
        option.textContent = (model.display_name || model.id || "") + (model.provider ? ` (${model.provider})` : "");
        if (model.id === appSettings.image_helper_model) option.selected = true;
        imageHelperModelEl.appendChild(option);
      });
    }
    if (imageHelperMaxImagesEl) imageHelperMaxImagesEl.value = appSettings.image_helper_max_images || 4;
  }

  function applyModelForm() {
    window.__settingsModels?.initializeOperationFallbackDraftRows?.(appSettings.operation_model_fallback_preferences || {});
    window.__settingsModels?.renderModelManagementPanels?.({
      operationPreferences: appSettings.operation_model_preferences || {},
    });
    window.__settingsModels?.setCustomModelStatus?.("No pending model changes", "muted");
  }

  function applyToolForm() {
    window.__settingsTools?.applySelectedTools?.(appSettings.active_tools || []);
    window.__settingsTools?.applySelectedSubAgentTools?.(appSettings.sub_agent_allowed_tool_names || []);
    window.__settingsTools?.syncSubAgentCanvasSettings?.(appSettings);
  }

  function applyScratchpadForm() {
    window.__scratchpadModule?.renderScratchpad?.();
  }

  function applySettingsToForm() {
    applyPersonaForm();
    applyGeneralForm();
    applySummaryForm();
    applyConversationForm();
    applyRagForm();
    applyImageForm();
    applyModelForm();
    applyToolForm();
    applyScratchpadForm();
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // applyFeatureAvailability
  // ═══════════════════════════════════════════════════════════════════════════════
  function applyFeatureAvailability() {
    const ragEnabled = Boolean(featureFlags.rag_enabled);

    const ragSourceTypeEls = Array.from(document.querySelectorAll("input[name='rag-source-type']"));
    const ragAutoInjectSourceTypeEls = Array.from(document.querySelectorAll("input[name='rag-auto-inject-source-type']"));
    const kbSyncBtn = document.getElementById("kb-sync-btn");
    const kbUploadFileEl = document.getElementById("kb-upload-file");
    const kbUploadTitleEl = document.getElementById("kb-upload-title");
    const kbUploadDescriptionEl = document.getElementById("kb-upload-description");
    const kbUploadAutoInjectEl = document.getElementById("kb-upload-auto-inject-toggle");
    const kbUploadBtn = document.getElementById("kb-upload-btn");
    const ragInjectOptionsEl = document.getElementById("rag-inject-options");
    const ragDisabledNoteEl = document.getElementById("rag-disabled-note");

    if (ragSensitivityEl) ragSensitivityEl.disabled = !ragEnabled;
    if (ragContextSizeEl) ragContextSizeEl.disabled = !ragEnabled;
    ragSourceTypeEls.forEach((element) => { element.disabled = !ragEnabled; });
    ragAutoInjectSourceTypeEls.forEach((element) => { element.disabled = !ragEnabled; });
    if (kbSyncBtn) kbSyncBtn.disabled = !ragEnabled;
    if (kbUploadFileEl) kbUploadFileEl.disabled = !ragEnabled;
    if (kbUploadTitleEl) kbUploadTitleEl.disabled = !ragEnabled;
    if (kbUploadDescriptionEl) kbUploadDescriptionEl.disabled = !ragEnabled;
    if (kbUploadAutoInjectEl) kbUploadAutoInjectEl.disabled = !ragEnabled;
    if (kbUploadBtn) kbUploadBtn.disabled = !ragEnabled;
    if (ragInjectOptionsEl) {
      ragInjectOptionsEl.classList.toggle("is-disabled", !ragEnabled);
      ragInjectOptionsEl.setAttribute("aria-disabled", ragEnabled ? "false" : "true");
    }
    if (ragDisabledNoteEl) ragDisabledNoteEl.hidden = ragEnabled;

    if (!ragEnabled) {
      window.__knowledgeBaseModule?.setKbStatus?.("RAG disabled in .env", "warning");
      window.__knowledgeBaseModule?.setKbUploadStatus?.("Upload disabled because RAG is off", "warning");
    } else {
      window.__knowledgeBaseModule?.setKbUploadStatus?.("Ready to upload", "muted");
    }

    window.__settingsRag?.syncRagAutoInjectSourceAvailability?.();
    window.__settingsRag?.updateRagSourceSummary?.();
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // applyServerSettingsData
  // ═══════════════════════════════════════════════════════════════════════════════
  function applyServerPersonaData(data) {
    appSettings.general_instructions = data.general_instructions || "";
    appSettings.ai_personality = data.ai_personality || "";
    appSettings.default_persona_id = window.__personaModule?.normalizePersonaId?.(data.default_persona_id) ?? null;
    appSettings.personas = Array.isArray(data.personas) ? data.personas : [];
  }

  function applyServerGeneralData(data) {
    appSettings.temperature = data.temperature ?? 0.7;
    appSettings.clarification_max_questions = data.clarification_max_questions || 5;
    appSettings.max_steps = data.max_steps || 5;
    appSettings.max_parallel_tools = data.max_parallel_tools ?? 4;
    appSettings.search_tool_query_limit = data.search_tool_query_limit ?? 5;
    appSettings.sub_agent_max_steps = data.sub_agent_max_steps ?? 6;
    appSettings.sub_agent_timeout_seconds = data.sub_agent_timeout_seconds ?? 240;
    appSettings.sub_agent_retry_attempts = data.sub_agent_retry_attempts ?? 2;
    appSettings.sub_agent_retry_delay_seconds = data.sub_agent_retry_delay_seconds ?? 5;
    appSettings.sub_agent_max_parallel_tools = data.sub_agent_max_parallel_tools ?? data.max_parallel_tools ?? 2;
    appSettings.web_cache_ttl_hours = data.web_cache_ttl_hours ?? 24;
  }

  function applyServerWebData(data) {
    appSettings.bright_data_serp_language = data.bright_data_serp_language || "en";
    appSettings.bright_data_serp_country = data.bright_data_serp_country || "US";
    appSettings.bright_data_serp_timeout_seconds = data.bright_data_serp_timeout_seconds ?? 30;
    appSettings.scholar_proxy_enabled = Boolean(data.scholar_proxy_enabled);
    appSettings.openrouter_prompt_cache_enabled = Boolean(data.openrouter_prompt_cache_enabled ?? true);
    appSettings.openrouter_anthropic_cache_ttl = data.openrouter_anthropic_cache_ttl || "5m";
  }

  function applyServerSummaryData(data) {
    appSettings.chat_summary_model = data.chat_summary_model || "";
    appSettings.chat_summary_mode = data.chat_summary_mode || "auto";
    appSettings.chat_summary_detail_level = data.chat_summary_detail_level || "balanced";
    appSettings.chat_summary_trigger_token_count = data.chat_summary_trigger_token_count || 80000;
    appSettings.summary_skip_first = data.summary_skip_first ?? 2;
    appSettings.summary_skip_last = data.summary_skip_last ?? 1;
    appSettings.prompt_preflight_summary_token_count = data.prompt_preflight_summary_token_count ?? 90000;
    appSettings.summary_source_target_tokens = data.summary_source_target_tokens ?? 6000;
    appSettings.summary_retry_min_source_tokens = data.summary_retry_min_source_tokens ?? 1500;
  }

  function applyServerConversationData(data) {
    appSettings.conversation_memory_enabled = Boolean(data.conversation_memory_enabled);
    appSettings.conversation_truncation_enabled = Boolean(data.conversation_truncation_enabled ?? true);
    appSettings.conversation_max_messages = data.conversation_max_messages ?? 20;
    appSettings.conversation_max_message_chars = data.conversation_max_message_chars ?? 500;
    appSettings.ocr_enabled = Boolean(data.ocr_enabled);
    appSettings.rag_enabled = Boolean(data.rag_enabled);
    appSettings.youtube_transcripts_enabled = Boolean(data.youtube_transcripts_enabled);
    appSettings.reasoning_auto_collapse = Boolean(data.reasoning_auto_collapse);
  }

  function applyServerRagData(data) {
    appSettings.rag_chunk_size = data.rag_chunk_size ?? 1800;
    appSettings.rag_chunk_overlap = data.rag_chunk_overlap ?? 250;
    appSettings.rag_max_chunks_per_source = data.rag_max_chunks_per_source ?? 2;
    appSettings.rag_search_top_k = data.rag_search_top_k ?? 5;
    appSettings.rag_search_min_similarity = data.rag_search_min_similarity ?? 0.35;
    appSettings.rag_query_expansion_enabled = Boolean(data.rag_query_expansion_enabled ?? true);
    appSettings.rag_query_expansion_max_variants = data.rag_query_expansion_max_variants ?? 2;
    appSettings.rag_auto_inject = Boolean(data.rag_auto_inject);
    appSettings.rag_sensitivity = data.rag_sensitivity || "normal";
    appSettings.rag_context_size = data.rag_context_size || "medium";
    appSettings.rag_source_types = Array.isArray(data.rag_source_types) ? data.rag_source_types : [];
    appSettings.rag_auto_inject_source_types = Array.isArray(data.rag_auto_inject_source_types)
      ? data.rag_auto_inject_source_types
      : appSettings.rag_source_types;
  }

  function applyServerFetchData(data) {
    appSettings.context_compaction_threshold = data.context_compaction_threshold ?? 0.85;
    appSettings.context_compaction_keep_recent_rounds = data.context_compaction_keep_recent_rounds ?? 2;
    appSettings.fetch_url_token_threshold = data.fetch_url_token_threshold || 3500;
    appSettings.fetch_url_clip_aggressiveness = data.fetch_url_clip_aggressiveness ?? 50;
    appSettings.fetch_url_summary_max_input_chars = data.fetch_url_summary_max_input_chars || data.fetch_url_summarized_max_input_chars || 80000;
    appSettings.fetch_url_summary_max_output_tokens = data.fetch_url_summary_max_output_tokens || data.fetch_url_summarized_max_output_tokens || 2400;
    appSettings.fetch_raw_max_text_chars = data.fetch_raw_max_text_chars ?? 24000;
    appSettings.fetch_summary_max_chars = data.fetch_summary_max_chars ?? 8000;
  }

  function applyServerModelData(data) {
    appSettings.available_models = Array.isArray(data.available_models) ? data.available_models : [];
    appSettings.custom_model_contract = data.custom_model_contract && typeof data.custom_model_contract === "object" ? data.custom_model_contract : {};
    appSettings.custom_models = Array.isArray(data.custom_models) ? data.custom_models : [];
    appSettings.visible_model_order = Array.isArray(data.visible_model_order) ? data.visible_model_order : [];
    appSettings.default_chat_model = data.default_chat_model || "";
    appSettings.operation_model_preferences = data.operation_model_preferences && typeof data.operation_model_preferences === "object" ? data.operation_model_preferences : {};
    appSettings.operation_model_fallback_preferences = data.operation_model_fallback_preferences && typeof data.operation_model_fallback_preferences === "object" ? data.operation_model_fallback_preferences : {};
    appSettings.available_vision_models = Array.isArray(data.available_vision_models) ? data.available_vision_models : [];
  }

  function applyServerImageData(data) {
    appSettings.image_processing_method = data.image_processing_method || "multimodal";
    appSettings.image_helper_model = data.image_helper_model || "";
    appSettings.image_helper_max_images = data.image_helper_max_images || 4;
  }

  function applyServerToolData(data) {
    appSettings.active_tools = Array.isArray(data.active_tools) ? data.active_tools : [];
    appSettings.sub_agent_allowed_tool_names = Array.isArray(data.sub_agent_allowed_tool_names) ? data.sub_agent_allowed_tool_names : [];
    appSettings.sub_agent_canvas_auto_save = Boolean(data.sub_agent_canvas_auto_save ?? true);
    appSettings.sub_agent_canvas_auto_open = Boolean(data.sub_agent_canvas_auto_open ?? false);
  }

  function applyServerScratchpadData(data) {
    appSettings.scratchpad = data.scratchpad || "";
    appSettings.scratchpad_sections = data.scratchpad_sections && typeof data.scratchpad_sections === "object" ? data.scratchpad_sections : {};
  }

  function applyServerSettingsData(data) {
    applyServerPersonaData(data);
    applyServerGeneralData(data);
    applyServerWebData(data);
    applyServerSummaryData(data);
    applyServerConversationData(data);
    applyServerRagData(data);
    applyServerFetchData(data);
    applyServerModelData(data);
    applyServerImageData(data);
    applyServerToolData(data);
    applyServerScratchpadData(data);
    if (data.features && typeof data.features === "object") {
      Object.assign(featureFlags, data.features);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // refreshSettings
  // ═══════════════════════════════════════════════════════════════════════════════
  async function refreshSettings() {
    try {
      const response = await fetch("/api/settings");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to load settings.");

      applyServerSettingsData(data);
      applySettingsToForm();
      applyFeatureAvailability();
      core.setHasUnsavedSettingsChanges?.(false);
      window.__personaModule?.clearPersonaDirty?.();
      core.updateDirtyIndicators?.();
      core.setSettingsStatus?.("Ready");
      core.setDirtyPill?.("All changes saved", "muted");
    } catch (error) {
      core.setSettingsStatus?.(error.message || "Failed to load settings.", "error");
      core.setDirtyPill?.("Load failed", "error");
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // saveSettings
  // ═══════════════════════════════════════════════════════════════════════════════
  async function saveSettings() {
    const scratchpadSections = window.__scratchpadModule?.readScratchpadSectionsFromList?.() ?? {};
    const previousSettingsSnapshot = { ...appSettings };
    const isRagEnabledDraft = Boolean(ragEnabledEl?.checked);

    const fullPayload = {
      ...buildAssistantPayload(),
      ...buildRuntimePayload(),
      ...buildWebPayload(),
      ...buildSummaryPayload(),
      ...buildConversationPayload(),
      ...buildRagPayload(isRagEnabledDraft),
      // Context and fetch
      ...readContextSettingsPayload(),
      ...readFetchSettingsPayload(),
      // Custom models (delegated to __customModelsModule)
      ...buildModelPayload(),
      // Tools / RAG
      ...buildToolPayload(),
      // Scratchpad
      ...buildScratchpadPayload(scratchpadSections),
    };

    const deltaPayload = core.buildSettingsDeltaPayload?.(fullPayload, appSettings) ?? fullPayload;
    if (!Object.keys(deltaPayload).length) {
      core.clearDirtyState?.();
      core.hideRestartWarning?.();
      core.setSettingsStatus?.("No changes to save", "muted");
      core.setDirtyPill?.("All changes saved", "success");
      return;
    }

    saveButtons.forEach((button) => { button.disabled = true; });
    core.setSettingsStatus?.("Saving...");
    core.setDirtyPill?.("Saving...", "warning");

    try {
      const response = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(deltaPayload),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to save settings.");

      const restartNeeded = core.hasRestartRequiredChanges?.(deltaPayload, previousSettingsSnapshot) ?? false;
      applyServerSettingsData(data);
      applySettingsToForm();
      applyFeatureAvailability();
      core.clearDirtyState?.();
      if (restartNeeded) {
        core.showRestartWarning?.("Some changes are saved but will take effect after restarting the server.");
        core.setSettingsStatus?.("Saved — restart required for some changes.", "warning");
      } else {
        core.hideRestartWarning?.();
      }
    } catch (error) {
      core.setSettingsStatus?.(error.message || "Failed to save settings.", "error");
      core.setDirtyPill?.("Save failed", "error");
    } finally {
      saveButtons.forEach((button) => { button.disabled = false; });
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // saveAllSettings
  // ═══════════════════════════════════════════════════════════════════════════════
  async function saveAllSettings() {
    if (window.__personaModule?.hasUnsavedPersonaChanges?.()) {
      const personaSaved = await window.__personaModule?.saveActivePersona?.();
      if (!personaSaved) return;
    }
    if (core.hasUnsavedSettingsChanges === true) {
      await saveSettings();
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Event listeners
  // ═══════════════════════════════════════════════════════════════════════════════
  const dirtyChangeEls = [
    imageProcessingMethodEl,
    conversationMemoryEnabledEl,
    conversationTruncationEnabledEl,
    ocrEnabledEl,
    ragEnabledEl,
    youtubeTranscriptsEnabledEl,
    chatSummaryModelEl,
    ragQueryExpansionEnabledEl,
    openrouterPromptCacheEnabledEl,
    scholarProxyEnabledEl,
    summaryModeEl,
    summaryDetailLevelEl,
    ragSensitivityEl,
    ragContextSizeEl,
    ragAutoInjectEnabledEl,
    reasoningAutoCollapseEl,
    brightDataSerpLanguageEl,
  ];

  const dirtyInputEls = [
    conversationMaxMessagesEl,
    conversationMaxMessageCharsEl,
    ragChunkSizeEl,
    ragChunkOverlapEl,
    ragMaxChunksPerSourceEl,
    ragSearchTopKEl,
    ragSearchMinSimilarityEl,
    ragQueryExpansionMaxVariantsEl,
    fetchRawMaxTextCharsEl,
    fetchSummaryMaxCharsEl,
    fetchThresholdEl,
    fetchAggressivenessEl,
    fetchSummarizeMaxInputCharsEl,
    fetchSummarizeMaxOutputTokensEl,
    imageHelperMaxImagesEl,
    temperatureEl,
    maxStepsEl,
    maxParallelToolsEl,
    searchToolQueryLimitEl,
    clarificationMaxQuestionsEl,
    subAgentMaxStepsEl,
    subAgentTimeoutSecondsEl,
    subAgentRetryAttemptsEl,
    subAgentRetryDelaySecondsEl,
    subAgentMaxParallelToolsEl,
    webCacheTtlHoursEl,
    brightDataSerpCountryEl,
    brightDataSerpTimeoutSecondsEl,
    summaryTriggerEl,
    summarySkipFirstEl,
    summarySkipLastEl,
    promptPreflightSummaryTokenCountEl,
    summarySourceTargetTokensEl,
    summaryRetryMinSourceTokensEl,
    contextCompactionThresholdEl,
    contextCompactionKeepRecentRoundsEl,
  ];

  function attachDirtyListeners() {
    dirtyChangeEls.forEach((el) => el?.addEventListener("change", markDirty));
    dirtyInputEls.forEach((el) => el?.addEventListener("input", markDirty));
    openrouterAnthropicCacheTtlEls.forEach((el) => el.addEventListener("change", markDirty));
    [subAgentCanvasAutoSaveEl, subAgentCanvasAutoOpenEl].forEach((el) => el?.addEventListener("change", markDirty));
    saveButtons.forEach((button) => {
      button.addEventListener("click", () => void saveAllSettings());
    });
  }

  function attachBeforeUnloadHandler() {
    window.addEventListener("beforeunload", (event) => {
      const hasUnsavedSettingsChanges = core.hasUnsavedSettingsChanges ?? false;
      const hasPersonaChanges = window.__personaModule?.hasUnsavedPersonaChanges?.() ?? false;
      if (!hasUnsavedSettingsChanges && !hasPersonaChanges) return;
      event.preventDefault();
      event.returnValue = "";
    });
  }

  function attachKeyboardShortcutHandler() {
    window.addEventListener("keydown", (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void saveAllSettings();
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Bootstrap
  // ═══════════════════════════════════════════════════════════════════════════════
  function bootstrap() {
    // Retrieval governs the knowledge base, not conversation memory. Keep the
    // card beside source management while preserving the existing field IDs.
    const ragInjectionCard = document.getElementById("rag-injection-card");
    const knowledgeRetrievalSettings = document.getElementById("knowledge-retrieval-settings");
    if (ragInjectionCard && knowledgeRetrievalSettings) {
      knowledgeRetrievalSettings.append(ragInjectionCard);
    }

    attachDirtyListeners();
    attachBeforeUnloadHandler();
    attachKeyboardShortcutHandler();

    // Initialize tab navigation
    initializeTabs();

    // Apply current form state from appSettings
    applySettingsToForm();

    // Apply feature availability constraints
    applyFeatureAvailability();

    // Initial status
    core.setSettingsStatus?.("Ready");
    core.setDirtyPill?.("All changes saved", "muted");

    // Load fresh settings from server
    void refreshSettings();

    // Load KB documents
    void window.__knowledgeBaseModule?.loadKnowledgeBaseDocuments?.();
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Public API (used by sibling settings modules)
  // ═══════════════════════════════════════════════════════════════════════════════
  window.__settingsTools = {
    getSelectedSubAgentTools,
    applySelectedSubAgentTools,
    getSelectedTools,
    applySelectedTools,
    syncSubAgentCanvasSettings,
    readSubAgentCanvasPayload,
  };

  window.__settingsTabs = {
    activateTab,
    initializeTabs,
  };

  // Preserve the settings page's public API for integrations and legacy callers.
  window.saveAllSettings = saveAllSettings;
  window.refreshSettings = refreshSettings;
  window.saveSettings = saveSettings;
  window.markDirty = core.markDirty ?? (() => {});
  window.clearDirtyState = core.clearDirtyState ?? (() => {});

  bootstrap();
})();
