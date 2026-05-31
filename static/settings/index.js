// Settings entry point — wires all modules together and provides top-level coordination
(function () {
  "use strict";

  // ═══════════════════════════════════════════════════════════════════════════════
  // DOM element references (previously at top of settings.js)
  // ═══════════════════════════════════════════════════════════════════════════════
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
  const imageProcessingMethodEl = document.getElementById("image-processing-method-select");
  const ragInjectOptionsEl = document.getElementById("rag-inject-options");
  const ragSensitivityEl = document.getElementById("rag-sensitivity-select");
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
  const conversationTruncationEnabledEl = document.getElementById("conversation-truncation-enabled-toggle");
  const conversationMaxMessagesEl = document.getElementById("conversation-max-messages-input");
  const conversationMaxMessageCharsEl = document.getElementById("conversation-max-message-chars-input");
  const ocrEnabledEl = document.getElementById("ocr-enabled-toggle");
  const loginSessionTimeoutMinutesEl = document.getElementById("login-session-timeout-minutes-input");
  const loginMaxFailedAttemptsEl = document.getElementById("login-max-failed-attempts-input");
  const loginLockoutSecondsEl = document.getElementById("login-lockout-seconds-input");
  const loginRememberSessionDaysEl = document.getElementById("login-remember-session-days-input");
  const youtubeTranscriptsEnabledEl = document.getElementById("youtube-transcripts-enabled-toggle");
  const fetchRawMaxTextCharsEl = document.getElementById("fetch-raw-max-text-chars-input");
  const fetchSummaryMaxCharsEl = document.getElementById("fetch-summary-max-chars-input");
  const settingsRestartBannerEl = document.getElementById("settings-restart-banner");
  const settingsRestartBannerTextEl = document.getElementById("settings-restart-banner-text");
  const saveButtons = Array.from(document.querySelectorAll(".settings-save-trigger"));

  // ═══════════════════════════════════════════════════════════════════════════════
  // Shared state
  // ═══════════════════════════════════════════════════════════════════════════════
  const appSettings = window.__appSettings || {};
  const featureFlags = window.__featureFlags || appSettings.features || {};
  const csrfToken = window.__csrfToken || "";

  const DEFAULT_SCRATCHPAD_SECTION_ORDER = window.__settingsCore?.DEFAULT_SCRATCHPAD_SECTION_ORDER || ["lessons", "profile", "notes", "problems", "tasks", "preferences", "domain"];

  // ═══════════════════════════════════════════════════════════════════════════════
  // Numeric readers (used by saveSettings) — delegate to core
  // ═══════════════════════════════════════════════════════════════════════════════
  const readNumericSetting = (el, defaultVal, opts = {}) =>
    window.__settingsCore.readNumericSetting(el, defaultVal, opts);
  const readFloatSetting = (el, defaultVal, opts = {}) =>
    window.__settingsCore.readFloatSetting(el, defaultVal, opts);

  // ═══════════════════════════════════════════════════════════════════════════════
  // applySettingsToForm
  // ═══════════════════════════════════════════════════════════════════════════════
  function applySettingsToForm() {
    // Persona
    window.__personaModule?.renderDefaultPersonaSelect?.();
    const personas = window.__personaModule?.getPersonas?.() || [];
    if (personas.length) {
      const currentId = window.__personaModule?.getActivePersonaId?.();
      const nextPersonaId = window.__personaModule?.findPersonaById?.(currentId) ? currentId : personas[0].id;
      window.__personaModule?.selectPersonaForEditing?.(nextPersonaId);
    } else {
      window.__personaModule?.selectPersonaForEditing?.(null);
    }

    // General
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
    if (promptPreflightSummaryTokenCountEl) promptPreflightSummaryTokenCountEl.value = String(appSettings.prompt_preflight_summary_token_count ?? 90000);
    if (summarySourceTargetTokensEl) summarySourceTargetTokensEl.value = String(appSettings.summary_source_target_tokens ?? 6000);
    if (summaryRetryMinSourceTokensEl) summaryRetryMinSourceTokensEl.value = String(appSettings.summary_retry_min_source_tokens ?? 1500);
    if (promptMaxInputTokensEl) promptMaxInputTokensEl.value = String(appSettings.prompt_max_input_tokens ?? 80000);
    if (promptResponseTokenReserveEl) promptResponseTokenReserveEl.value = String(appSettings.prompt_response_token_reserve ?? 8000);
    if (promptRecentHistoryMaxTokensEl) promptRecentHistoryMaxTokensEl.value = String(appSettings.prompt_recent_history_max_tokens ?? 32000);
    if (promptSummaryMaxTokensEl) promptSummaryMaxTokensEl.value = String(appSettings.prompt_summary_max_tokens ?? 12000);
    if (promptRagMaxTokensEl) promptRagMaxTokensEl.value = String(appSettings.prompt_rag_max_tokens ?? 18000);
    if (promptToolTraceMaxTokensEl) promptToolTraceMaxTokensEl.value = String(appSettings.prompt_tool_trace_max_tokens ?? 9000);

    // Context / canvas / fetch settings are synced below by dedicated module functions.
    // Module read functions (read*Payload) are still used at save time for correct user-modified values.
    window.__settingsContext?.syncContextSettingsToForm?.(appSettings);
    window.__settingsCanvas?.syncCanvasSettingsToForm?.(appSettings);
    window.__settingsFetch?.syncFetchSettingsToForm?.(appSettings);

    if (conversationMemoryEnabledEl) conversationMemoryEnabledEl.checked = Boolean(appSettings.conversation_memory_enabled);
    if (conversationTruncationEnabledEl) conversationTruncationEnabledEl.checked = Boolean(appSettings.conversation_truncation_enabled ?? true);
    if (conversationMaxMessagesEl) conversationMaxMessagesEl.value = String(appSettings.conversation_max_messages ?? 20);
    if (conversationMaxMessageCharsEl) conversationMaxMessageCharsEl.value = String(appSettings.conversation_max_message_chars ?? 500);
    if (ocrEnabledEl) ocrEnabledEl.checked = Boolean(appSettings.ocr_enabled);
    if (ragEnabledEl) ragEnabledEl.checked = Boolean(appSettings.rag_enabled);
    if (youtubeTranscriptsEnabledEl) youtubeTranscriptsEnabledEl.checked = Boolean(appSettings.youtube_transcripts_enabled);

    const reasoningAutoCollapseEl = document.getElementById("reasoning-auto-collapse-toggle");
    if (reasoningAutoCollapseEl) reasoningAutoCollapseEl.checked = Boolean(appSettings.reasoning_auto_collapse);

    const chatSummaryModelEl = document.getElementById("chat-summary-model-select");
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

    // Tool / RAG — delegate to modules
    window.__settingsTools?.applySelectedTools?.(appSettings.active_tools || []);
    window.__settingsTools?.applySelectedSubAgentTools?.(appSettings.sub_agent_allowed_tool_names || []);

    if (ragSensitivityEl) ragSensitivityEl.value = appSettings.rag_sensitivity || "normal";
    if (ragContextSizeEl) ragContextSizeEl.value = appSettings.rag_context_size || "medium";
    if (ragAutoInjectEnabledEl) ragAutoInjectEnabledEl.checked = Boolean(appSettings.rag_auto_inject);
    window.__settingsRag?.applySelectedRagSourceTypes?.(appSettings.rag_source_types || []);
    window.__settingsRag?.applySelectedRagAutoInjectSourceTypes?.(appSettings.rag_auto_inject_source_types || appSettings.rag_source_types || []);

    if (imageProcessingMethodEl) imageProcessingMethodEl.value = appSettings.image_processing_method || "multimodal";

    // Models panel — delegates to __customModelsModule + __settingsModels (sub_agent)
    window.__settingsModels?.initializeOperationFallbackDraftRows?.(appSettings.operation_model_fallback_preferences || {});
    window.__settingsModels?.renderModelManagementPanels?.({
      operationPreferences: appSettings.operation_model_preferences || {},
    });
    window.__settingsModels?.setCustomModelStatus?.("No pending model changes", "muted");

    window.__settingsRag?.updateRagSensitivityHint?.();

    if (scratchpadListEl || scratchpadAddBtn || scratchpadCountEl) {
      window.__scratchpadModule?.renderScratchpad(true);
    }

    syncOverviewStats();
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
    const scratchpadAddBtn = document.getElementById("scratchpad-add-btn");
    const scratchpadReadonlyNoteEl = document.getElementById("scratchpad-readonly-note");

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
      ragInjectOptionsEl.setAttribute("aria-disabled", !ragEnabled ? "true" : "false");
    }
    if (ragDisabledNoteEl) ragDisabledNoteEl.hidden = ragEnabled;

    if (!ragEnabled) {
      window.__knowledgeBaseModule?.setKbStatus?.("RAG disabled in .env", "warning");
      window.__knowledgeBaseModule?.setKbUploadStatus?.("Upload disabled because RAG is off", "warning");
    } else {
      window.__knowledgeBaseModule?.setKbUploadStatus?.("Ready to upload", "muted");
    }

    window.__settingsRag?.syncRagAutoInjectSourceAvailability?.();
    window.__settingsContext?.syncContextStrategyAvailability?.();
    window.__settingsRag?.updateRagSourceSummary?.();
    syncOverviewStats();
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // applyServerSettingsData
  // ═══════════════════════════════════════════════════════════════════════════════
  function applyServerSettingsData(data) {
    appSettings.activity_enabled = Boolean(data.activity_enabled);
    appSettings.activity_retention_days = data.activity_retention_days ?? 30;
    appSettings.general_instructions = data.general_instructions || "";
    appSettings.ai_personality = data.ai_personality || "";
    appSettings.effective_user_preferences = data.effective_user_preferences || "";
    appSettings.default_persona_id = window.__personaModule?.normalizePersonaId?.(data.default_persona_id) ?? null;
    appSettings.personas = Array.isArray(data.personas) ? data.personas : [];
    appSettings.scratchpad = data.scratchpad || "";
    appSettings.scratchpad_sections = data.scratchpad_sections && typeof data.scratchpad_sections === "object" ? data.scratchpad_sections : {};
    appSettings.max_steps = data.max_steps || 5;
    appSettings.max_parallel_tools = data.max_parallel_tools ?? 4;
    appSettings.search_tool_query_limit = data.search_tool_query_limit ?? 5;
    appSettings.sub_agent_max_steps = data.sub_agent_max_steps ?? 6;
    appSettings.sub_agent_timeout_seconds = data.sub_agent_timeout_seconds ?? 240;
    appSettings.sub_agent_retry_attempts = data.sub_agent_retry_attempts ?? 2;
    appSettings.sub_agent_retry_delay_seconds = data.sub_agent_retry_delay_seconds ?? 5;
    appSettings.sub_agent_max_parallel_tools = data.sub_agent_max_parallel_tools ?? data.max_parallel_tools ?? 2;
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
    appSettings.custom_model_contract = data.custom_model_contract && typeof data.custom_model_contract === "object" ? data.custom_model_contract : {};
    appSettings.custom_models = Array.isArray(data.custom_models) ? data.custom_models : [];
    appSettings.visible_model_order = Array.isArray(data.visible_model_order) ? data.visible_model_order : [];
    appSettings.default_chat_model = data.default_chat_model || "";
    appSettings.operation_model_preferences = data.operation_model_preferences && typeof data.operation_model_preferences === "object" ? data.operation_model_preferences : {};
    appSettings.operation_model_fallback_preferences = data.operation_model_fallback_preferences && typeof data.operation_model_fallback_preferences === "object" ? data.operation_model_fallback_preferences : {};
    appSettings.image_processing_method = data.image_processing_method || "multimodal";
    appSettings.conversation_memory_enabled = Boolean(data.conversation_memory_enabled);
    appSettings.conversation_truncation_enabled = Boolean(data.conversation_truncation_enabled ?? true);
    appSettings.conversation_max_messages = data.conversation_max_messages ?? 20;
    appSettings.conversation_max_message_chars = data.conversation_max_message_chars ?? 500;
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
    appSettings.reasoning_auto_collapse = Boolean(data.reasoning_auto_collapse);
    appSettings.fetch_url_token_threshold = data.fetch_url_token_threshold || 3500;
    appSettings.fetch_url_clip_aggressiveness = data.fetch_url_clip_aggressiveness ?? 50;
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
      window.__settingsCore?.setHasUnsavedSettingsChanges?.(false);
      window.__personaModule?.clearPersonaDirty?.();
      window.__settingsCore?.updateDirtyIndicators?.();
      window.__settingsCore?.setSettingsStatus?.("Ready");
      window.__settingsCore?.setDirtyPill?.("All changes saved", "muted");
    } catch (error) {
      window.__settingsCore?.setSettingsStatus?.(error.message || "Failed to load settings.", "error");
      window.__settingsCore?.setDirtyPill?.("Load failed", "error");
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // saveSettings
  // ═══════════════════════════════════════════════════════════════════════════════
  async function saveSettings() {
    const scratchpadSections = window.__scratchpadModule?.readScratchpadSectionsFromList?.() ?? {};
    const previousSettingsSnapshot = { ...appSettings };
    const isRagEnabledDraft = Boolean(ragEnabledEl?.checked);

    const chatSummaryModelEl = document.getElementById("chat-summary-model-select");
    const reasoningAutoCollapseEl = document.getElementById("reasoning-auto-collapse-toggle");

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
      // Context / canvas / fetch
      ...(window.__settingsContext?.readContextSettingsPayload?.() ?? {}),
      ...(window.__settingsCanvas?.readCanvasSettingsPayload?.() ?? {}),
      ...(window.__settingsFetch?.readFetchSettingsPayload?.() ?? {}),
      conversation_memory_enabled: Boolean(conversationMemoryEnabledEl?.checked),
      conversation_truncation_enabled: Boolean(conversationTruncationEnabledEl?.checked ?? true),
      conversation_max_messages: readNumericSetting(conversationMaxMessagesEl, 20, { allowZero: false, min: 3, max: 200 }),
      conversation_max_message_chars: readNumericSetting(conversationMaxMessageCharsEl, 500, { allowZero: false, min: 100, max: 50000 }),
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
      // Custom models (delegated to __customModelsModule)
      custom_models: (window.__customModelsModule?.getDraftCustomModels?.() ?? []).map((model) => window.__customModelsModule?.serializeDraftCustomModel?.(model) ?? model),
      visible_model_order: window.__customModelsModule?.getDraftVisibleModelOrder?.() ?? [],
      operation_model_preferences: window.__customModelsModule?.getOperationModelPreferencesDraft?.() ?? {},
      operation_model_fallback_preferences: window.__settingsModels?.getOperationModelFallbackPreferencesDraft?.() ?? {},
      image_processing_method: imageProcessingMethodEl?.value || "multimodal",
      // Tools / RAG
      active_tools: window.__settingsTools?.getSelectedTools?.() ?? [],
      sub_agent_allowed_tool_names: window.__settingsTools?.getSelectedSubAgentTools?.() ?? [],
      rag_auto_inject: isRagEnabledDraft && ragAutoInjectEnabledEl ? ragAutoInjectEnabledEl.checked : false,
      rag_sensitivity: ragSensitivityEl?.value || "normal",
      rag_context_size: ragContextSizeEl?.value || "medium",
      rag_source_types: isRagEnabledDraft ? (window.__settingsRag?.getSelectedRagSourceTypes?.() ?? []) : [],
      rag_auto_inject_source_types: isRagEnabledDraft ? (window.__settingsRag?.getSelectedRagAutoInjectSourceTypes?.() ?? []) : [],
      // Scratchpad
      scratchpad_sections: DEFAULT_SCRATCHPAD_SECTION_ORDER.reduce((acc, sectionId) => {
        const sectionContent = scratchpadSections[sectionId];
        acc[sectionId] = Array.isArray(sectionContent) ? sectionContent.join("\n") : "";
        return acc;
      }, {}),
    };

    if (reasoningAutoCollapseEl) fullPayload.reasoning_auto_collapse = Boolean(reasoningAutoCollapseEl.checked);

    const deltaPayload = window.__settingsCore?.buildSettingsDeltaPayload?.(fullPayload, appSettings) ?? fullPayload;
    if (!Object.keys(deltaPayload).length) {
      window.__settingsCore?.clearDirtyState?.();
      window.__settingsCore?.hideRestartWarning?.();
      window.__settingsCore?.setSettingsStatus?.("No changes to save", "muted");
      window.__settingsCore?.setDirtyPill?.("All changes saved", "success");
      return;
    }

    saveButtons.forEach((button) => { button.disabled = true; });
    window.__settingsCore?.setSettingsStatus?.("Saving...");
    window.__settingsCore?.setDirtyPill?.("Saving...", "warning");

    try {
      const response = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(deltaPayload),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to save settings.");

      const restartNeeded = window.__settingsCore?.hasRestartRequiredChanges?.(deltaPayload, previousSettingsSnapshot) ?? false;
      applyServerSettingsData(data);
      applySettingsToForm();
      applyFeatureAvailability();
      window.__settingsCore?.clearDirtyState?.();
      if (restartNeeded) {
        window.__settingsCore?.showRestartWarning?.("Some changes are saved but will take effect after restarting the server.");
        window.__settingsCore?.setSettingsStatus?.("Saved — restart required for some changes.", "warning");
      } else {
        window.__settingsCore?.hideRestartWarning?.();
      }
    } catch (error) {
      window.__settingsCore?.setSettingsStatus?.(error.message || "Failed to save settings.", "error");
      window.__settingsCore?.setDirtyPill?.("Save failed", "error");
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
    if (window.__settingsCore?.hasUnsavedSettingsChanges === true) {
      await saveSettings();
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // syncOverviewStats
  // ═══════════════════════════════════════════════════════════════════════════════
  function syncOverviewStats() {
    const statScratchpadEl = document.getElementById("settings-stat-scratchpad");
    if (statScratchpadEl) {
      const noteCount = window.__scratchpadModule?.getVisibleScratchpadNotes?.().length ?? 0;
      statScratchpadEl.textContent = noteCount === 1 ? "1 note" : `${noteCount} notes`;
    }
    window.__settingsTools?.syncOverviewStats?.();
    window.__settingsRag?.syncOverviewStats?.();
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Context filter toggles (parent model / sub-agent visibility)
  // ═══════════════════════════════════════════════════════════════════════════════
  function initContextFilters() {
    const parentFilter = document.getElementById("context-filter-parent");
    const subAgentFilter = document.getElementById("context-filter-sub-agent");
    if (!parentFilter || !subAgentFilter) return;

    function applyContextFilters() {
      const showParent = parentFilter.checked;
      const showSubAgent = subAgentFilter.checked;

      document.querySelectorAll(".settings-budget-item").forEach((item) => {
        const context = item.getAttribute("data-context");
        if (context === "parent") {
          item.style.display = showParent ? "" : "none";
        } else if (context === "sub-agent") {
          item.style.display = showSubAgent ? "" : "none";
        }
      });
    }

    parentFilter.addEventListener("change", applyContextFilters);
    subAgentFilter.addEventListener("change", applyContextFilters);
    applyContextFilters();
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Public API (for backward compatibility and init.js)
  // ═══════════════════════════════════════════════════════════════════════════════
  window.saveAllSettings = saveAllSettings;
  window.refreshSettings = refreshSettings;
  window.saveSettings = saveSettings;
  window.markDirty = window.__settingsCore?.markDirty ?? (() => {});
  window.clearDirtyState = window.__settingsCore?.clearDirtyState ?? (() => {});

  // ═══════════════════════════════════════════════════════════════════════════════
  // Bootstrap — runs after all modules are defined
  // ═══════════════════════════════════════════════════════════════════════════════
  function bootstrap() {
    // Initialize tab navigation
    window.__settingsTabs?.initializeTabs?.();

    // Apply current form state from appSettings
    applySettingsToForm();

    // Apply feature availability constraints
    applyFeatureAvailability();

    // Init context filter toggles
    initContextFilters();

    // Initial status
    window.__settingsCore?.setSettingsStatus?.("Ready");
    window.__settingsCore?.setDirtyPill?.("All changes saved", "muted");

    // Load fresh settings from server
    void refreshSettings();

    // Load KB documents
    void window.__knowledgeBaseModule?.loadKnowledgeBaseDocuments?.();
  }

  bootstrap();
})();
