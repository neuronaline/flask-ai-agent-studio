// Settings core — constants, state, and shared utilities
(function () {
  "use strict";

  // ─── Constants ────────────────────────────────────────────────────────────────
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
    { id: "concise_default", label: "Concise default", text: "Be concise and direct. Prefer short paragraphs. Use bullets only when they improve scanning. State assumptions briefly and include the next step when useful." },
    { id: "teaching_mode", label: "Teaching mode", text: "Explain clearly and step by step. Define non-obvious terms, surface the reasoning behind decisions, and include one concrete example when it materially helps understanding." },
    { id: "engineering_review", label: "Engineering review", text: "Prioritize correctness, edge cases, regressions, and verification. Keep summaries brief and focus first on concrete findings, risks, and what changed." },
    { id: "execution_first", label: "Execution first", text: "Take action by default instead of proposing abstract plans. Prefer minimal working changes, explain tradeoffs briefly, and avoid unnecessary theory." },
  ];

  const AI_PERSONALITY_TEMPLATES = [
    { id: "pragmatic_engineer", label: "Pragmatic engineer", text: "Adopt the voice of a pragmatic senior engineer: calm, direct, rigorous, and low-fluff. Challenge weak assumptions politely and stay focused on what will actually work." },
    { id: "patient_teacher", label: "Patient teacher", text: "Sound like a patient technical teacher: structured, clear, encouraging without being overly casual, and attentive to knowledge gaps." },
    { id: "analytical_strategist", label: "Analytical strategist", text: "Sound analytical and deliberate. Compare options clearly, explain tradeoffs, and make recommendations with explicit reasoning and constraints." },
    { id: "creative_partner", label: "Creative partner", text: "Sound like a creative but disciplined collaborator: exploratory, idea-rich, and willing to suggest novel directions while staying grounded in the user's goal." },
  ];

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

  const DEFAULT_SCRATCHPAD_SECTION_ORDER = ["lessons", "profile", "notes", "problems", "tasks", "preferences", "domain"];

  // ─── State ───────────────────────────────────────────────────────────────────
  let hasUnsavedChanges = false;
  let hasUnsavedSettingsChanges = false;

  // ─── DOM refs ─────────────────────────────────────────────────────────────────
  const settingsStatus = document.getElementById("settings-status");
  const settingsRestartBannerEl = document.getElementById("settings-restart-banner");
  const settingsRestartBannerTextEl = document.getElementById("settings-restart-banner-text");
  const dirtyPillEl = document.getElementById("settings-dirty-pill");

  // ─── Status helpers ──────────────────────────────────────────────────────────
  function setSettingsStatus(message, tone = "muted") {
    if (!settingsStatus) return;
    settingsStatus.textContent = message;
    settingsStatus.dataset.tone = tone;
  }

  function setDirtyPill(message, tone = "muted") {
    if (!dirtyPillEl) return;
    dirtyPillEl.textContent = message;
    dirtyPillEl.dataset.tone = tone;
  }

  // ─── Dirty state ─────────────────────────────────────────────────────────────
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

  function clearDirtyState() {
    hasUnsavedSettingsChanges = false;
    updateDirtyIndicators();
  }

  // ─── Restart warning ─────────────────────────────────────────────────────────
  function showRestartWarning(message) {
    if (!settingsRestartBannerEl) return;
    if (settingsRestartBannerTextEl) settingsRestartBannerTextEl.textContent = message;
    settingsRestartBannerEl.hidden = false;
  }

  function hideRestartWarning() {
    if (!settingsRestartBannerEl) return;
    settingsRestartBannerEl.hidden = true;
  }

  // ─── Shared numeric helpers ──────────────────────────────────────────────────
  function readNumericSetting(el, defaultVal, opts = {}) {
    if (!el) return defaultVal;
    const raw = Number.parseFloat(String(el.value || "").trim());
    if (!Number.isFinite(raw)) return defaultVal;
    const { min, max, allowZero = true } = opts;
    if (!allowZero && raw === 0) return defaultVal;
    if (min !== undefined && raw < min) return defaultVal;
    if (max !== undefined && raw > max) return defaultVal;
    return raw;
  }

  function readFloatSetting(el, defaultVal, opts = {}) {
    return readNumericSetting(el, defaultVal, opts);
  }

  // ─── Payload utilities ───────────────────────────────────────────────────────
  function valueAsComparableString(value) {
    if (Array.isArray(value) || (value && typeof value === "object")) {
      return JSON.stringify(value);
    }
    if (value === null || value === undefined) return "";
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

  // ─── Export ──────────────────────────────────────────────────────────────────
  window.__settingsCore = {
    // Constants
    SETTINGS_TAB_ALIASES,
    RAG_SENSITIVITY_HINTS,
    RAG_SOURCE_TYPE_LABELS,
    MODEL_PROVIDER_LABELS,
    GENERAL_INSTRUCTION_TEMPLATES,
    AI_PERSONALITY_TEMPLATES,
    RESTART_REQUIRED_SETTING_KEYS,
    DEFAULT_SCRATCHPAD_SECTION_ORDER,
    // State
    get hasUnsavedChanges() { return hasUnsavedChanges; },
    get hasUnsavedSettingsChanges() { return hasUnsavedSettingsChanges; },
    setHasUnsavedSettingsChanges(v) { hasUnsavedSettingsChanges = v; },
    // Helpers
    setSettingsStatus,
    setDirtyPill,
    markDirty,
    clearDirtyState,
    updateDirtyIndicators,
    showRestartWarning,
    hideRestartWarning,
    valueAsComparableString,
    hasRestartRequiredChanges,
    buildSettingsDeltaPayload,
    readNumericSetting,
    readFloatSetting,
  };
})();
