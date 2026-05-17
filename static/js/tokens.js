// Token/usage processing — breakdown logic, rendering, history normalization.
// Dependencies: utils.js (fmt, escHtml, toFiniteNumber, toNonNegativeIntOrNull),
//               state.js (chatState), render.js (renderMarkdown).

const INPUT_BREAKDOWN_ORDER = [
  "core_instructions",
  "tool_specs",
  "canvas",
  "scratchpad",
  "tool_trace",
  "rag_context",
  "internal_state",
  "user_messages",
  "assistant_history",
  "assistant_tool_calls",
  "tool_results",
  "unknown_provider_overhead",
];

const INPUT_BREAKDOWN_LABELS = {
  core_instructions: "Core instructions",
  tool_specs: "Tool definitions",
  canvas: "Canvas",
  scratchpad: "Scratchpad",
  tool_trace: "Tool trace",
  rag_context: "RAG context",
  internal_state: "Agent working state",
  user_messages: "User messages",
  assistant_history: "Assistant chatState.history",
  assistant_tool_calls: "Assistant tool calls",
  tool_results: "Tool results",
  unknown_provider_overhead: "Unknown/Provider overhead",
};

const INPUT_BREAKDOWN_HELP_TEXT = {
  tool_specs: "Prompt tool list plus API function schema sent with the request.",
  internal_state: "Short internal working-memory instructions added during blocker handling or recovery.",
  unknown_provider_overhead: "The remaining billed prompt tokens left after local content, tool, and request-framing estimates are aligned to the provider total.",
};

const BREAKDOWN_WARNING_RATIO = 0.03;

const BREAKDOWN_REDUCTION_ORDER = [
  "tool_specs",
  "internal_state",
  "canvas",
  "scratchpad",
  "tool_trace",
  "rag_context",
  "assistant_tool_calls",
  "tool_results",
  "assistant_history",
  "user_messages",
  "core_instructions",
];

const BREAKDOWN_FLOOR_KEYS = ["user_messages", "tool_results"];

const MODEL_CALL_TYPE_LABELS = {
  agent_step: "Agent step",
  final_answer: "Final answer",
};

const tokenTurns = [];

function createEmptyBreakdown() {
  return INPUT_BREAKDOWN_ORDER.reduce((acc, key) => {
    acc[key] = 0;
    return acc;
  }, {});
}

function getProtectedBreakdownKeys(breakdown, targetTotal) {
  const parsedTarget = toNonNegativeIntOrNull(targetTotal);
  if (parsedTarget === null || parsedTarget <= 0) {
    return new Set();
  }

  const presentKeys = BREAKDOWN_FLOOR_KEYS.filter((key) => toFiniteNumber(breakdown[key], 0) > 0);
  return new Set(presentKeys.slice(0, Math.min(presentKeys.length, parsedTarget)));
}

function alignBreakdownToTotal(breakdown, targetTotal) {
  const normalized = createEmptyBreakdown();
  INPUT_BREAKDOWN_ORDER.forEach((key) => {
    normalized[key] = Math.max(0, Math.round(toFiniteNumber(breakdown[key], 0)));
  });

  const parsedTarget = toNonNegativeIntOrNull(targetTotal);
  if (parsedTarget === null) {
    return normalized;
  }

  let currentTotal = sumBreakdown(normalized);
  if (currentTotal < parsedTarget) {
    normalized.unknown_provider_overhead += parsedTarget - currentTotal;
    return normalized;
  }

  let overflow = currentTotal - parsedTarget;
  if (overflow <= 0) {
    return normalized;
  }

  const protectedKeys = getProtectedBreakdownKeys(normalized, parsedTarget);

  BREAKDOWN_REDUCTION_ORDER.forEach((key) => {
    if (overflow <= 0) {
      return;
    }
    const floor = protectedKeys.has(key) ? 1 : 0;
    const available = (normalized[key] || 0) - floor;
    if (available <= 0) {
      return;
    }
    const reduction = Math.min(available, overflow);
    normalized[key] = available - reduction + floor;
    overflow -= reduction;
  });

  if (overflow > 0) {
    INPUT_BREAKDOWN_ORDER
      .slice()
      .sort((left, right) => (normalized[right] || 0) - (normalized[left] || 0))
      .forEach((key) => {
        if (overflow <= 0) {
          return;
        }
        const floor = protectedKeys.has(key) ? 1 : 0;
        const available = (normalized[key] || 0) - floor;
        if (available <= 0) {
          return;
        }
        const reduction = Math.min(available, overflow);
        normalized[key] = available - reduction + floor;
        overflow -= reduction;
      });
  }

  return normalized;
}

function normalizeBreakdown(rawBreakdown, targetTotal = null) {
  const normalized = createEmptyBreakdown();
  const source = rawBreakdown && typeof rawBreakdown === "object" ? rawBreakdown : {};
  const legacyCoreInstructions =
    toFiniteNumber(source.core_instructions, 0) +
    toFiniteNumber(source.system_prompt, 0) +
    toFiniteNumber(source.final_instruction, 0);
  INPUT_BREAKDOWN_ORDER.forEach((key) => {
    if (key === "core_instructions") {
      normalized[key] = Math.max(0, Math.round(toFiniteNumber(legacyCoreInstructions, 0)));
      return;
    }
    normalized[key] = Math.max(0, Math.round(toFiniteNumber(source[key], 0)));
  });
  return alignBreakdownToTotal(normalized, targetTotal);
}

function shouldAlignUsageBreakdownToPromptTotal(entry) {
  return !(entry && typeof entry === "object" && entry.provider_usage_partial === true);
}

function sumBreakdown(breakdown) {
  return INPUT_BREAKDOWN_ORDER.reduce((sum, key) => sum + toFiniteNumber(breakdown[key], 0), 0);
}

function getModelCallInputTokens(call) {
  if (!call || typeof call !== "object") {
    return 0;
  }

  const promptTokens = toNonNegativeIntOrNull(call.prompt_tokens);
  if (promptTokens !== null) {
    return promptTokens;
  }

  return toNonNegativeIntOrNull(call.estimated_input_tokens) ?? 0;
}

function getMaxInputTokensPerCall(modelCalls, fallbackPromptTokens = 0) {
  const peak = (Array.isArray(modelCalls) ? modelCalls : []).reduce(
    (maxValue, call) => Math.max(maxValue, getModelCallInputTokens(call)),
    0,
  );
  if (peak > 0) {
    return peak;
  }
  return Math.max(0, Math.round(toFiniteNumber(fallbackPromptTokens, 0)));
}

function hasCacheUsageMetrics(entry) {
  return Boolean(
    entry && typeof entry === "object" && (
      entry.prompt_cache_hit_tokens !== null ||
      entry.prompt_cache_miss_tokens !== null ||
      entry.prompt_cache_write_tokens !== null
    )
  );
}

function normalizeModelCallPayload(callEntry) {
  const source = callEntry && typeof callEntry === "object" ? callEntry : {};
  const promptTokens = toNonNegativeIntOrNull(source.prompt_tokens);
  const promptCacheHitTokens = toNonNegativeIntOrNull(source.prompt_cache_hit_tokens);
  const promptCacheMissTokens = toNonNegativeIntOrNull(source.prompt_cache_miss_tokens);
  const promptCacheWriteTokens = toNonNegativeIntOrNull(source.prompt_cache_write_tokens);
  const completionTokens = toNonNegativeIntOrNull(source.completion_tokens);
  const totalTokens = toNonNegativeIntOrNull(source.total_tokens);
  const providerUsagePartial = source.missing_provider_usage === true;
  const estimatedTarget = shouldAlignUsageBreakdownToPromptTotal({ provider_usage_partial: providerUsagePartial })
    ? (promptTokens ?? toNonNegativeIntOrNull(source.estimated_input_tokens))
    : toNonNegativeIntOrNull(source.estimated_input_tokens);
  const inputBreakdown = normalizeBreakdown(source.input_breakdown, estimatedTarget);

  return {
    index: toNonNegativeIntOrNull(source.index),
    step: toNonNegativeIntOrNull(source.step),
    call_type: String(source.call_type || "agent_step") || "agent_step",
    is_retry: source.is_retry === true,
    retry_reason: String(source.retry_reason || "").trim(),
    message_count: toNonNegativeIntOrNull(source.message_count),
    tool_schema_tokens: toNonNegativeIntOrNull(source.tool_schema_tokens),
    prompt_tokens: promptTokens,
    prompt_cache_hit_tokens: promptCacheHitTokens,
    prompt_cache_miss_tokens: promptCacheMissTokens,
    prompt_cache_write_tokens: promptCacheWriteTokens,
    completion_tokens: completionTokens,
    total_tokens: totalTokens,
    estimated_input_tokens: estimatedTarget ?? sumBreakdown(inputBreakdown),
    input_breakdown: inputBreakdown,
    missing_provider_usage: source.missing_provider_usage === true,
    cache_metrics_estimated: source.cache_metrics_estimated === true,
  };
}

function normalizePromptBudgetPayload(promptBudget) {
  const source = promptBudget && typeof promptBudget === "object" ? promptBudget : null;
  if (!source) {
    return null;
  }

  return {
    archived_conversation_match_count: Math.max(0, Math.round(toFiniteNumber(source.archived_conversation_match_count, 0))),
    archived_conversation_source_count: Math.max(0, Math.round(toFiniteNumber(source.archived_conversation_source_count, 0))),
    archived_conversation_message_count: Math.max(0, Math.round(toFiniteNumber(source.archived_conversation_message_count, 0))),
    archived_conversation_tokens: Math.max(0, Math.round(toFiniteNumber(source.archived_conversation_tokens, 0))),
  };
}

function normalizeUsagePayload(usage) {
  const source = usage && typeof usage === "object" ? usage : {};
  const promptTokens = Math.max(0, Math.round(toFiniteNumber(source.prompt_tokens, 0)));
  const promptCacheHitTokens = toNonNegativeIntOrNull(source.prompt_cache_hit_tokens);
  const promptCacheMissTokens = toNonNegativeIntOrNull(source.prompt_cache_miss_tokens);
  const promptCacheWriteTokens = toNonNegativeIntOrNull(source.prompt_cache_write_tokens);
  const estimatedSourceTokens = Math.max(0, Math.round(toFiniteNumber(source.estimated_input_tokens, 0)));
  const modelCalls = Array.isArray(source.model_calls)
    ? source.model_calls.map(normalizeModelCallPayload)
    : [];
  const providerUsagePartial = source.provider_usage_partial === true
    || modelCalls.some((call) => call && typeof call === "object" && call.missing_provider_usage === true);
  const breakdownTargetTotal = shouldAlignUsageBreakdownToPromptTotal({ provider_usage_partial: providerUsagePartial })
    ? (promptTokens || estimatedSourceTokens || null)
    : (estimatedSourceTokens || null);
  const inputBreakdown = normalizeBreakdown(source.input_breakdown, breakdownTargetTotal);
  const modelCallCount = Math.max(
    modelCalls.length,
    Math.round(toFiniteNumber(source.model_call_count, 0)),
  );
  const estimatedInputTokens = shouldAlignUsageBreakdownToPromptTotal({ provider_usage_partial: providerUsagePartial })
    ? (promptTokens || sumBreakdown(inputBreakdown) || estimatedSourceTokens)
    : (estimatedSourceTokens || sumBreakdown(inputBreakdown) || promptTokens);
  const configuredPromptMaxInputTokens = toNonNegativeIntOrNull(source.configured_prompt_max_input_tokens);
  const maxInputTokensPerCall =
    toNonNegativeIntOrNull(source.max_input_tokens_per_call) ??
    getMaxInputTokensPerCall(modelCalls, promptTokens || estimatedInputTokens);
  const preflightPromptBudget = normalizePromptBudgetPayload(source.preflight_prompt_budget);
  const cost = typeof source.cost === "number" && Number.isFinite(source.cost) && source.cost >= 0
    ? Number(source.cost)
    : null;
  const costAvailable = source.cost_available === true;
  const currency = String(source.currency || "").trim() || null;

  return {
    prompt_tokens: promptTokens,
    prompt_cache_hit_tokens: promptCacheHitTokens,
    prompt_cache_miss_tokens: promptCacheMissTokens,
    prompt_cache_write_tokens: promptCacheWriteTokens,
    completion_tokens: Math.max(0, Math.round(toFiniteNumber(source.completion_tokens, 0))),
    total_tokens: Math.max(0, Math.round(toFiniteNumber(source.total_tokens, 0))),
    estimated_input_tokens: estimatedInputTokens,
    input_breakdown: inputBreakdown,
    model_call_count: modelCallCount,
    model_calls: modelCalls,
    max_input_tokens_per_call: maxInputTokensPerCall,
    configured_prompt_max_input_tokens: configuredPromptMaxInputTokens,
    preflight_prompt_budget: preflightPromptBudget,
    provider: String(source.provider || "").trim() || null,
    model: String(source.model || "—") || "—",
    cache_metrics_estimated: source.cache_metrics_estimated === true,
    provider_usage_partial: providerUsagePartial,
    cost,
    cost_available: costAvailable,
    currency,
  };
}

function formatUsageCost(value, currency = "USD") {
  if (!Number.isFinite(value)) {
    return "—";
  }

  const normalizedCurrency = String(currency || "USD").trim().toUpperCase() || "USD";
  if (normalizedCurrency === "USD") {
    return `$${Number(value).toFixed(6)}`;
  }
  return `${Number(value).toFixed(6)} ${normalizedCurrency}`;
}

function summarizeValueList(values, fallback = "—") {
  const normalizedValues = Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  );
  if (!normalizedValues.length) {
    return fallback;
  }
  if (normalizedValues.length <= 2) {
    return normalizedValues.join(", ");
  }
  return `${normalizedValues.slice(0, 2).join(", ")} +${normalizedValues.length - 2}`;
}


function formatCacheMetricValue(value, estimated = false) {
  const formattedValue = fmt(toFiniteNumber(value, 0));
  return estimated ? `${formattedValue} est.` : formattedValue;
}

function hasPartialProviderUsage(entry) {
  if (!entry || typeof entry !== "object") {
    return false;
  }
  if (entry.provider_usage_partial === true) {
    return true;
  }
  const modelCalls = Array.isArray(entry.model_calls) ? entry.model_calls : [];
  return modelCalls.some((call) => call && typeof call === "object" && call.missing_provider_usage === true);
}

function formatPartialSummaryValue(value, partial = false) {
  const numericValue = Math.max(0, Math.round(toFiniteNumber(value, 0)));
  if (!partial) {
    return fmt(numericValue);
  }
  if (!numericValue) {
    return "Partial / unavailable";
  }
  return `${fmt(numericValue)} partial`;
}

function formatPartialSummaryText(text, partial = false) {
  const normalizedText = String(text || "").trim() || "—";
  if (!partial) {
    return normalizedText;
  }
  if (normalizedText === "—") {
    return "Partial / unavailable";
  }
  return `${normalizedText} partial`;
}

function aggregateBreakdown(turns) {
  const aggregate = createEmptyBreakdown();
  turns.forEach((turn) => {
    INPUT_BREAKDOWN_ORDER.forEach((key) => {
      aggregate[key] += toFiniteNumber(turn.input_breakdown[key], 0);
    });
  });
  return aggregate;
}

function getBreakdownWarningRatio(breakdown, totalTokens) {
  const total = Math.max(0, Math.round(toFiniteNumber(totalTokens, 0)));
  if (!total) {
    return 0;
  }
  return toFiniteNumber(breakdown.unknown_provider_overhead, 0) / total;
}

function renderBreakdownWarning(breakdown, totalTokens) {
  const ratio = getBreakdownWarningRatio(breakdown, totalTokens);
  if (ratio < BREAKDOWN_WARNING_RATIO) {
    return "";
  }

  return (
    `<div class="breakdown-warning">` +
      `Unknown/Provider overhead is ${Math.round(ratio * 1000) / 10}% of the billed prompt total.` +
    `</div>`
  );
}

function renderBreakdownList(containerId, breakdown, options = {}) {
  const container = document.getElementById(containerId);
  if (!container) {
    return;
  }

  const entries = INPUT_BREAKDOWN_ORDER.filter((key) => toFiniteNumber(breakdown[key], 0) > 0);
  if (!entries.length) {
    container.innerHTML = '<div class="breakdown-empty">No input-source estimate available yet.</div>';
    return;
  }

  container.innerHTML = entries
    .map(
      (key) => {
        const helpText = INPUT_BREAKDOWN_HELP_TEXT[key];
        const labelAttrs = helpText ? ` title="${escHtml(helpText)}"` : "";
        return (
        `<div class="breakdown-row">` +
          `<span class="breakdown-label"${labelAttrs}>${escHtml(INPUT_BREAKDOWN_LABELS[key] || key)}</span>` +
          `<span class="breakdown-value">${fmt(breakdown[key])}</span>` +
        `</div>`
        );
      },
    )
    .join("") + renderBreakdownWarning(breakdown, options.totalTokens);
}

function renderBreakdownChips(breakdown, className = "turn-breakdown-chip") {
  const entries = INPUT_BREAKDOWN_ORDER.filter((key) => toFiniteNumber(breakdown[key], 0) > 0);
  return entries
    .map(
      (key) =>
        `<span class="${className}">${escHtml(INPUT_BREAKDOWN_LABELS[key] || key)}: ${fmt(breakdown[key])}</span>`,
    )
    .join("");
}

function renderTurnBreakdownInline(breakdown) {
  const entries = INPUT_BREAKDOWN_ORDER.filter((key) => toFiniteNumber(breakdown[key], 0) > 0);
  if (!entries.length) {
    return "";
  }

  return (
    `<div class="turn-breakdown">` +
      renderBreakdownChips(breakdown) +
    `</div>`
  );
}

function renderUnknownWarningBadge(breakdown, totalTokens) {
  const ratio = getBreakdownWarningRatio(breakdown, totalTokens);
  if (ratio < BREAKDOWN_WARNING_RATIO) {
    return "";
  }
  return `<span class="turn-warning-badge">Unknown ${Math.round(ratio * 1000) / 10}%</span>`;
}

function renderModelCallItem(call) {
  const callTypeLabel = MODEL_CALL_TYPE_LABELS[call.call_type] || "Model call";
  const stepLabel = call.step ? ` · step ${call.step}` : "";
  const retryReason = call.retry_reason ? ` · ${call.retry_reason.replaceAll("_", " ")}` : "";
  const promptStat = call.prompt_tokens !== null
    ? `<span class="turn-call-stat">${fmt(call.prompt_tokens)} prompt</span>`
    : `<span class="turn-call-stat">${fmt(call.estimated_input_tokens)} estimated prompt</span>`;
  const cacheHitLabel = call.cache_metrics_estimated ? "estimated cache hit" : "cache hit";
  const cacheWriteLabel = call.cache_metrics_estimated ? "estimated cache write" : "cache write";
  const cacheHitStat = call.prompt_cache_hit_tokens !== null
    ? `<span class="turn-call-stat">${formatCacheMetricValue(call.prompt_cache_hit_tokens, call.cache_metrics_estimated)} ${cacheHitLabel}</span>`
    : "";
  const cacheWriteStat = call.prompt_cache_write_tokens !== null
    ? `<span class="turn-call-stat">${formatCacheMetricValue(call.prompt_cache_write_tokens, call.cache_metrics_estimated)} ${cacheWriteLabel}</span>`
    : "";
  const completionStat = call.completion_tokens !== null
    ? `<span class="turn-call-stat">${fmt(call.completion_tokens)} completion</span>`
    : "";
  const messageCountStat = call.message_count !== null
    ? `<span class="turn-call-stat">${fmt(call.message_count)} messages</span>`
    : "";
  const schemaStat = call.tool_schema_tokens !== null && call.tool_schema_tokens > 0
    ? `<span class="turn-call-stat">${fmt(call.tool_schema_tokens)} tool schema</span>`
    : "";
  const missingBadge = call.missing_provider_usage
    ? `<span class="turn-call-badge">Missing provider usage</span>`
    : "";

  return (
    `<div class="turn-call-item">` +
      `<div class="turn-call-title-row">` +
        `<span class="turn-call-title">Call ${fmt(call.index || 0)} · ${escHtml(callTypeLabel)}${escHtml(stepLabel)}${escHtml(retryReason)}</span>` +
        missingBadge +
      `</div>` +
      `<div class="turn-call-meta">` +
        promptStat + cacheHitStat + cacheWriteStat + completionStat + messageCountStat + schemaStat +
      `</div>` +
      `<div class="turn-call-breakdown">${renderBreakdownChips(call.input_breakdown, "turn-call-breakdown-chip")}</div>` +
    `</div>`
  );
}

function renderModelCallSection(title, calls) {
  if (!calls.length) {
    return "";
  }
  return (
    `<div class="turn-call-section">` +
      `<div class="turn-call-section-title">${escHtml(title)}</div>` +
      `<div class="turn-call-list">${calls.map(renderModelCallItem).join("")}</div>` +
    `</div>`
  );
}

function renderModelCallDrawer(turn) {
  const calls = Array.isArray(turn.model_calls) ? turn.model_calls : [];
  if (!calls.length) {
    return "";
  }

  const primaryCalls = calls.filter((call) => !call.is_retry);
  const retryCalls = calls.filter((call) => call.is_retry);
  return (
    `<details class="turn-call-drawer">` +
      `<summary class="turn-call-summary">View ${fmt(calls.length)} model calls</summary>` +
      `<div class="turn-call-sections">` +
        renderModelCallSection("Primary calls", primaryCalls) +
        renderModelCallSection("Retry and recovery calls", retryCalls) +
      `</div>` +
    `</details>`
  );
}

function setTextContentById(id, value) {
  const element = document.getElementById(id);
  if (element) {
    element.textContent = value;
  }
  return element;
}

function renderTokenStats() {
  const totalUser = tokenTurns.reduce((sum, turn) => sum + turn.prompt_tokens, 0);
  const totalAsst = tokenTurns.reduce((sum, turn) => sum + turn.completion_tokens, 0);
  const grandTotal = tokenTurns.reduce((sum, turn) => sum + turn.total_tokens, 0);

  setTextContentById("stat-user", fmt(totalUser));
  setTextContentById("stat-asst", fmt(totalAsst));
  setTextContentById("stat-total", fmt(grandTotal));

  if (tokensBadge) {
    tokensBadge.textContent = fmt(grandTotal);
  }

  const list = document.getElementById("turns-list");
  if (!list) {
    return;
  }
  if (!tokenTurns.length) {
    list.innerHTML = '<div class="breakdown-empty">No turns yet.</div>';
    return;
  }

  list.innerHTML = tokenTurns
    .slice(-5)
    .reverse()
    .map(
      (turn, index) => {
        return (
          `<div class="turn-item">` +
            `<div class="turn-header">` +
              `<span class="turn-label">Turn ${tokenTurns.length - index}</span>` +
            `</div>` +
            `<div class="turn-details">` +
              `<span class="turn-stat"><span class="stats-dot dot-user"></span>${fmt(turn.prompt_tokens)} in</span>` +
              `<span class="turn-stat"><span class="stats-dot dot-asst"></span>${fmt(turn.completion_tokens)} out</span>` +
              `<span class="turn-stat">${fmt(turn.total_tokens)} total</span>` +
            `</div>` +
          `</div>`
        );
      },
    )
    .join("");
}

function normalizeHistoryEntry(entry) {
  const source = entry && typeof entry === "object" ? entry : {};
  const normalizedId = Number(source.id);
  const normalizedPosition = Number(source.position);
  const usage = source.usage && typeof source.usage === "object" ? normalizeUsagePayload(source.usage) : null;
  const role = ["assistant", "user", "tool", "system", "summary"].includes(source.role) ? source.role : "user";
  const toolCalls = Array.isArray(source.tool_calls) ? source.tool_calls : [];
  const toolCallId = typeof source.tool_call_id === "string" && source.tool_call_id.trim()
    ? source.tool_call_id.trim()
    : null;
  return {
    id: Number.isInteger(normalizedId) ? normalizedId : null,
    role,
    content: String(source.content || ""),
    metadata: source.metadata && typeof source.metadata === "object" ? source.metadata : null,
    position: Number.isInteger(normalizedPosition) ? normalizedPosition : null,
    tool_calls: toolCalls,
    tool_call_id: toolCallId,
    usage,
    created_at: String(source.created_at || "").trim(),
    deleted_at: String(source.deleted_at || "").trim(),
  };
}

function buildRequestMessagesFromHistory(entries = chatState.history) {
  return getVisibleHistoryEntries(entries).map((item) => ({
    role: item.role,
    content: item.content,
    metadata: item.metadata || null,
    tool_calls: Array.isArray(item.tool_calls) ? item.tool_calls : [],
    tool_call_id: item.tool_call_id || null,
  }));
}

function isRenderableHistoryEntry(message) {
  if (!message) {
    return false;
  }

  if (message.role === "assistant" && Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
    return false;
  }

  const metadata = message.metadata && typeof message.metadata === "object" ? message.metadata : null;

  return message.role === "user" || message.role === "assistant" || message.role === "summary";
}

function getVisibleHistoryEntries(entries = chatState.history) {
  return entries.filter(isRenderableHistoryEntry);
}

function getConversationSignature(entries = chatState.history) {
  return getVisibleHistoryEntries(entries)
    .map((message) => {
      const metadata = message.metadata ? JSON.stringify(message.metadata) : "";
      return `${message.role}:${message.content}:${metadata}`;
    })
    .join("\u0001");
}

function buildAssistantMetadata({
  reasoning = "",
  toolTrace = [],
  tool_trace = null,
  toolResults = [],
  tool_results = null,
  subAgentTraces = [],
  sub_agent_traces = null,
  canvasDocuments = [],
  canvas_documents = null,
  activeDocumentId = null,
  active_document_id = null,
  canvasCleared = false,
  canvas_cleared = null,
  usage = null,
  pendingClarification = null,
  pending_clarification = null,
} = {}) {
  const normalizedToolTrace = Array.isArray(tool_trace) ? tool_trace : toolTrace;
  const normalizedToolResults = Array.isArray(tool_results) ? tool_results : toolResults;
  const normalizedSubAgentTraces = Array.isArray(sub_agent_traces) ? sub_agent_traces : subAgentTraces;
  const normalizedCanvasDocuments = Array.isArray(canvas_documents) ? canvas_documents : canvasDocuments;
  const normalizedActiveDocumentId = String(active_document_id || activeDocumentId || "").trim() || null;
  const normalizedCanvasCleared = canvas_cleared === true || canvasCleared === true;
  const normalizedPendingClarification = pending_clarification && typeof pending_clarification === "object"
    ? pending_clarification
    : pendingClarification && typeof pendingClarification === "object"
      ? pendingClarification
      : null;

  return reasoning || usage || normalizedToolResults.length || normalizedToolTrace.length || normalizedSubAgentTraces.length || normalizedCanvasDocuments.length || normalizedActiveDocumentId || normalizedCanvasCleared || normalizedPendingClarification
    ? {
        ...(reasoning ? { reasoning_content: reasoning } : {}),
        ...(normalizedToolTrace.length ? { tool_trace: normalizedToolTrace } : {}),
        ...(normalizedToolResults.length ? { tool_results: normalizedToolResults } : {}),
        ...(normalizedSubAgentTraces.length ? { sub_agent_traces: normalizedSubAgentTraces } : {}),
        ...(normalizedCanvasDocuments.length ? { canvas_documents: normalizedCanvasDocuments } : {}),
        ...(normalizedActiveDocumentId ? { active_document_id: normalizedActiveDocumentId } : {}),
        ...(normalizedCanvasCleared ? { canvas_cleared: true } : {}),
        ...(normalizedPendingClarification ? { pending_clarification: normalizedPendingClarification } : {}),
        ...(usage ? { usage } : {}),
      }
    : null;
}

/**
 * Builds a complete assistant message entry object.
 * Centralizes the construction of assistant entries to avoid duplication
 * between success and error paths in sendMessage.
 *
 * @param {Object} options
 * @param {string} options.content - The assistant's response content
 * @param {string} [options.reasoning=""] - Reasoning text
 * @param {Array} [options.toolTrace=[]] - Tool trace entries
 * @param {Array} [options.toolResults=[]] - Tool results
 * @param {Array} [options.subAgentTraces=[]] - Sub-agent trace entries
 * @param {Array} [options.canvasDocuments=[]] - Canvas documents
 * @param {string|null} [options.activeDocumentId=null] - Active document ID
 * @param {boolean} [options.canvasCleared=false] - Whether canvas was cleared
 * @param {Object|null} [options.usage=null] - Usage statistics
 * @param {Object|null} [options.pendingClarification=null] - Pending clarification
 * @returns {Object} Assistant entry object with role: "assistant"
 */
function buildAssistantEntry({
  content = "",
  reasoning = "",
  toolTrace = [],
  toolResults = [],
  subAgentTraces = [],
  canvasDocuments = [],
  activeDocumentId = null,
  canvasCleared = false,
  usage = null,
  pendingClarification = null,
} = {}) {
  return {
    id: null,
    role: "assistant",
    content: String(content || ""),
    usage: usage || null,
    metadata: buildAssistantMetadata({
      reasoning,
      toolTrace,
      toolResults,
      subAgentTraces,
      canvasDocuments,
      activeDocumentId,
      canvasCleared,
      usage,
      pendingClarification,
    }),
  };
}

