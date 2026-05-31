/**
 * Traces module — reasoning, tool traces, sub-agent traces, and fetch indicators.
 * Depends on: state.js, render.js, summary.js, utils.js (escHtml), step-ui.js, DOM: document
 */

/* ------------------------------------------------------------------ */
/*  Reasoning Helpers                                                  */
/* ------------------------------------------------------------------ */

/**
 * Retrieves reasoning text from metadata or falls back to stored assistant reasoning.
 * @param {object|null} metadata
 * @param {number|null} messageId
 * @param {string} [conversationId=chatState.currentConvId]
 * @returns {string}
 */
function getReasoningText(metadata, messageId = null, conversationId = chatState.currentConvId) {
  if (!metadata || typeof metadata !== "object") {
    return getAssistantReasoning(conversationId, messageId);
  }

  const reasoningText = String(metadata.reasoning_content || "").trim();
  if (reasoningText) {
    return reasoningText;
  }

  return getAssistantReasoning(conversationId, messageId);
}

/* ------------------------------------------------------------------ */
/*  Tool Trace Helpers                                                 */
/* ------------------------------------------------------------------ */

/**
 * Extracts normalized tool trace entries from metadata.
 * @param {object|null} metadata
 * @returns {Array<{step: number, tool_name: string, preview: string, summary: string, state: string, cached: boolean}>}
 */
function getToolTraceEntries(metadata) {
  if (!metadata || typeof metadata !== "object" || !Array.isArray(metadata.tool_trace)) {
    return [];
  }

  return metadata.tool_trace
    .filter((entry) => entry && typeof entry === "object" && String(entry.tool_name || "").trim())
    .map((entry) => ({
      step: Number.isFinite(Number(entry.step)) ? Math.max(1, Number(entry.step)) : 1,
      tool_name: String(entry.tool_name || "").trim(),
      preview: String(entry.preview || "").trim(),
      summary: String(entry.summary || "").trim(),
      state: ["running", "done", "error"].includes(String(entry.state || "").trim())
        ? String(entry.state || "").trim()
        : "done",
      cached: entry.cached === true,
    }));
}

/**
 * Sets the innerHTML of an element to rendered markdown.
 * Hides the element if the text is empty.
 * @param {HTMLElement} element
 * @param {string} text
 * @returns {boolean} Whether content was set.
 */
function setMarkdownBlockContent(element, text) {
  if (!element) {
    return false;
  }

  const normalizedText = String(text || "").trim();
  if (!normalizedText) {
    element.innerHTML = "";
    element.style.display = "none";
    return false;
  }

  element.innerHTML = renderMarkdown(normalizedText);
  element.style.display = "";
  return true;
}

/* ------------------------------------------------------------------ */
/*  Sub-Agent Task Heading Helpers                                     */
/* ------------------------------------------------------------------ */

/**
 * Strips markdown formatting from text and creates a short heading.
 * @param {string} text
 * @param {number} [limit=160]
 * @returns {string}
 */
function getSubAgentTaskHeading(text, limit = 160) {
  const normalized = String(text || "")
    .replace(/```[\s\S]*?```/g, " code block ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/[>*_~|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) {
    return "Sub-agent";
  }
  if (normalized.length <= limit) {
    return normalized;
  }
  return `${normalized.slice(0, limit).trim()}...`;
}

/**
 * Determines if sub-agent instructions should be shown (i.e. when they are different from the heading).
 * @param {string} taskInstructions
 * @param {string} taskHeading
 * @returns {boolean}
 */
function shouldShowSubAgentInstructions(taskInstructions, taskHeading) {
  const normalizedInstructions = String(taskInstructions || "").trim();
  const normalizedHeading = String(taskHeading || "").trim();
  if (!normalizedInstructions) {
    return false;
  }
  if (normalizedInstructions !== normalizedHeading) {
    return true;
  }
  return /(^|\n)\s*(#{1,6}\s|[-*+]\s|\d+\.\s|>|\|)|```|`/.test(normalizedInstructions);
}

/* ------------------------------------------------------------------ */
/*  Sub-Agent Trace Entry Normalization                                */
/* ------------------------------------------------------------------ */

/**
 * Extracts and normalizes sub-agent trace entries from metadata.
 * @param {object|null} metadata
 * @returns {Array}
 */
function getSubAgentTraceEntries(metadata) {
  if (!metadata || typeof metadata !== "object" || !Array.isArray(metadata.sub_agent_traces)) {
    return [];
  }

  return metadata.sub_agent_traces
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => ({
      task: String(entry.task || "").trim(),
      task_full: String(entry.task_full || "").trim(),
      status: ["running", "ok", "partial", "error"].includes(String(entry.status || "").trim())
        ? String(entry.status || "").trim()
        : "ok",
      summary: String(entry.summary || "").trim(),
      model: String(entry.model || "").trim(),
      error: String(entry.error || "").trim(),
      timed_out: entry.timed_out === true,
      fallback_note: String(entry.fallback_note || "").trim(),
      canvas_saved: entry.canvas_saved === true,
      canvas_document_id: String(entry.canvas_document_id || "").trim(),
      canvas_document_title: String(entry.canvas_document_title || "").trim(),
      artifacts: Array.isArray(entry.artifacts) ? entry.artifacts.filter((artifact) => artifact && typeof artifact === "object") : [],
      tool_trace: getToolTraceEntries({ tool_trace: Array.isArray(entry.tool_trace) ? entry.tool_trace : [] }),
    }))
    .filter((entry) => entry.task || entry.summary || entry.error || entry.fallback_note || entry.tool_trace.length || entry.canvas_saved);
}

/**
 * Merges a new sub-agent trace entry into an existing array, updating by task key.
 * @param {Array|null} entries
 * @param {object} entry
 * @returns {Array}
 */
function mergeAssistantSubAgentTraceEntry(entries, entry) {
  const normalizedEntries = getSubAgentTraceEntries({ sub_agent_traces: [entry] });
  if (!normalizedEntries.length) {
    return Array.isArray(entries) ? entries : [];
  }

  const nextEntry = normalizedEntries[0];

  // Build a Map for O(1) lookups when updating existing entries
  const entryMap = new Map();
  let existingOrder = [];
  if (Array.isArray(entries)) {
    entries.forEach((e) => {
      const key = e.task || `__anonymous_${entryMap.size}`;
      entryMap.set(key, e);
      existingOrder.push(key);
    });
  }

  // Use task as unique key for sub-agent identification.
  // Falls back to Map size for consistent unique key generation.
  const taskKey = nextEntry.task || `__anonymous_${entryMap.size}`;

  // Check if an entry with the same task already exists and is still running
  const existingEntry = entryMap.get(taskKey);
  if (existingEntry && existingEntry.status === "running") {
    // Update the existing entry instead of appending
    entryMap.set(taskKey, nextEntry);
  } else {
    // Add as new entry
    entryMap.set(taskKey, nextEntry);
    existingOrder.push(taskKey);
  }

  // Convert back to array maintaining order
  return existingOrder.map((key) => entryMap.get(key));
}

/* ------------------------------------------------------------------ */
/*  Fetch Indicator Helpers                                            */
/* ------------------------------------------------------------------ */

/**
 * Checks metadata for fetch results and returns an indicator object.
 * @param {object|null} metadata
 * @returns {{label: string, title: string, tone: string}|null}
 */
function getAssistantFetchIndicator(metadata) {
  if (!metadata || typeof metadata !== "object" || !Array.isArray(metadata.tool_results)) {
    return null;
  }

  const fetchResults = metadata.tool_results.filter(
    (entry) => entry && typeof entry === "object" && entry.tool_name === "fetch_url",
  );
  if (!fetchResults.length) {
    return null;
  }

  const clippedEntry = fetchResults.find((entry) => String(entry.content_mode || "").trim() === "clipped_text");
  if (clippedEntry) {
    return {
      label: fetchResults.length > 1 ? `${fetchResults.length} web sources clipped` : "Web source clipped",
      title: String(clippedEntry.summary_notice || "").trim()
        || "Long fetched content was cleaned and clipped before the model used it.",
      tone: "summary",
    };
  }

  const summarizedEntry = fetchResults.find((entry) => String(entry.content_mode || "").trim() === "rag_summary");
  if (summarizedEntry) {
    return {
      label: fetchResults.length > 1 ? `${fetchResults.length} web sources summarized` : "Web source summarized",
      title: String(summarizedEntry.summary_notice || "").trim()
        || "Long fetched content was cleaned and summarized before the model used it.",
      tone: "summary",
    };
  }

  return null;
}

/**
 * Updates or removes the assistant fetch-context badge in the message group.
 * @param {HTMLElement} group
 * @param {object|null} metadata
 */
function updateAssistantFetchBadge(group, metadata) {
  const indicator = getAssistantFetchIndicator(metadata);
  const existing = group.querySelector(".assistant-context-badge");

  if (!indicator) {
    if (existing) {
      existing.remove();
    }
    return;
  }

  const badge = existing || document.createElement("div");
  badge.className = `assistant-context-badge assistant-context-badge--${indicator.tone}`;
  badge.title = indicator.title;
  badge.innerHTML =
    `<span class="assistant-context-badge__icon">✦</span>` +
    `<span class="assistant-context-badge__label">${escHtml(indicator.label)}</span>`;

  if (!existing) {
    const anchor = group.querySelector(".tool-trace-panel") || group.querySelector(".reasoning-panel") || group.querySelector(".bubble");
    if (anchor) {
      group.insertBefore(badge, anchor);
    } else {
      group.appendChild(badge);
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Tool Trace Panel Rendering                                         */
/* ------------------------------------------------------------------ */

/**
 * Updates or creates a tool trace panel within a message group.
 * @param {HTMLElement} group
 * @param {object|null} metadata
 */
function updateAssistantToolTrace(group, metadata) {
  const entries = getToolTraceEntries(metadata);
  const existing = group.querySelector(".tool-trace-panel");

  if (!entries.length) {
    if (existing) {
      existing.remove();
    }
    return;
  }

  const panel = existing || document.createElement("section");
  panel.className = "tool-trace-panel";

  const title = document.createElement("div");
  title.className = "tool-trace-panel__title";
  title.textContent = entries.length === 1 ? "Tool used" : `Tools used (${entries.length})`;

  const body = document.createElement("div");
  body.className = "tool-trace-panel__body";

  const sections = {};
  entries.forEach((entry) => {
    const sectionItems = ensureToolStepSection(body, sections, entry.step, null);
    const item = createToolStepItem(entry.tool_name);
    const normalizedSummary = normalizeToolSummary(entry.summary);
    setToolStepState(item, {
      toolName: entry.tool_name,
      preview: entry.preview,
      summary: normalizedSummary.text,
      state: normalizedSummary.isError ? "error" : entry.state || "done",
      cached: entry.cached || normalizedSummary.cached,
    });
    sectionItems.appendChild(item);
  });

  panel.innerHTML = "";
  panel.appendChild(title);
  panel.appendChild(body);

  if (!existing) {
    const anchor = group.querySelector(".reasoning-panel") || group.querySelector(".bubble");
    if (anchor) {
      group.insertBefore(panel, anchor);
    } else {
      group.appendChild(panel);
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Sub-Agent Status Helpers                                           */
/* ------------------------------------------------------------------ */

/**
 * Returns a human-readable status label for a sub-agent entry.
 * @param {{fallback_note?: string, timed_out?: boolean, status?: string}} entry
 * @returns {string}
 */
function getSubAgentStatusLabel(entry) {
  if (entry.fallback_note) {
    return "Fallback";
  }
  if (entry.timed_out) {
    return "Timed out";
  }
  if (entry.status === "running") {
    return "Live";
  }
  if (entry.status === "partial") {
    return "Partial";
  }
  if (entry.status === "error") {
    return "Error";
  }
  return "Done";
}

/**
 * Finds the latest unsaved completed sub-agent trace from metadata.
 * @param {object|null} metadata
 * @returns {{index: number, entry: object}|null}
 */
function getLatestUnsavedCompletedSubAgentTrace(metadata) {
  const entries = getSubAgentTraceEntries(metadata);
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (!entry || entry.status === "running" || entry.canvas_saved) {
      continue;
    }
    if (entry.status === "error" && !String(entry.summary || "").trim() && !entry.tool_trace.length) {
      continue;
    }
    return { index, entry };
  }
  return null;
}

/* ------------------------------------------------------------------ */
/*  Canvas Prompt Storage Helpers                                      */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/*  Sub-Agent Research Context Injection                                */
/* ------------------------------------------------------------------ */

/**
 * Finds a persisted assistant entry that has an unsaved completed sub-agent trace.
 * @param {number|null} preferredAssistantId
 * @returns {object|null}
 */
function findPersistedAssistantEntryForSubAgentPrompt(preferredAssistantId = null) {
  const normalizedPreferredId = Number(preferredAssistantId || 0);
  if (!isPersistedMessageId(normalizedPreferredId)) {
    return null;
  }

  for (let index = chatState.history.length - 1; index >= 0; index -= 1) {
    const entry = chatState.history[index];
    if (!entry || entry.role !== "assistant") {
      continue;
    }
    if (Number(entry.id || 0) !== normalizedPreferredId) {
      continue;
    }
    return getLatestUnsavedCompletedSubAgentTrace(entry.metadata) ? entry : null;
  }

  return null;
}

/**
 * Builds a heading for sub-agent research context.
 * @param {{task_full?: string, task?: string, summary?: string}} entry
 * @returns {string}
 */
function getSubAgentResearchContextHeading(entry) {
  const taskInstructions = String(entry?.task_full || entry?.task || "").trim();
  const taskHeading = getSubAgentTaskHeading(taskInstructions || entry?.summary || "Research");
  return String(taskHeading || "Research").trim();
}

/**
 * Builds the research context text to inject into the assistant message.
 * @param {{task_full?: string, task?: string, summary?: string, fallback_note?: string, error?: string}} entry
 * @returns {string}
 */
function buildSubAgentResearchContextContent(entry) {
  const parts = [];

  const summaryText = String(entry?.summary || "").trim();
  if (summaryText) {
    parts.push(summaryText);
  }

  if (!summaryText) {
    const fallbackNote = String(entry?.fallback_note || "").trim();
    if (fallbackNote) {
      parts.push(fallbackNote);
    }

    const errorText = String(entry?.error || "").trim();
    if (!fallbackNote && errorText) {
      parts.push(errorText);
    }
  }

  return parts.join("\n\n").trim();
}

/**
 * Injects completed sub-agent research directly into the assistant message context
 * so it is available to the AI in subsequent turns.
 * @param {object|null} assistantEntry
 */
function maybePromptToSaveSubAgentResearch(assistantEntry) {
  const resolvedEntry = isPersistedMessageId(assistantEntry?.id)
    ? assistantEntry
    : findPersistedAssistantEntryForSubAgentPrompt(assistantEntry?.id);

  if (!resolvedEntry || !isPersistedMessageId(resolvedEntry.id) || !chatState.currentConvId) {
    return;
  }

  const pendingTrace = getLatestUnsavedCompletedSubAgentTrace(resolvedEntry.metadata);
  if (!pendingTrace) {
    return;
  }

  const { entry } = pendingTrace;
  const contextText = buildSubAgentResearchContextContent(entry);
  if (!contextText) {
    return;
  }

  // Merge the research output into the assistant message's metadata
  // so it is included in the conversation context sent to the AI on subsequent turns.
  const existingMetadata = resolvedEntry.metadata && typeof resolvedEntry.metadata === "object"
    ? { ...resolvedEntry.metadata }
    : {};
  existingMetadata.sub_agent_context_injected = true;
  existingMetadata.sub_agent_research_context = existingMetadata.sub_agent_research_context
    ? `${existingMetadata.sub_agent_research_context}\n\n${contextText}`
    : contextText;
  resolvedEntry.metadata = existingMetadata;

  showToast("Research findings added to conversation context.", "success");
}

/* ------------------------------------------------------------------ */
/*  Sub-Agent Trace Panel Rendering                                    */
/* ------------------------------------------------------------------ */

/**
 * Creates a sub-agent step item (used within the sub-agent trace panel).
 * @param {{state?: string, tool_name?: string, preview?: string, summary?: string, cached?: boolean}} traceEntry
 * @returns {HTMLElement}
 */
function createSubAgentStep(traceEntry) {
  const item = document.createElement("div");
  item.className = `sub-agent-step sub-agent-step--${traceEntry.state || "done"}`;

  const top = document.createElement("div");
  top.className = "sub-agent-step__top";

  const label = document.createElement("div");
  label.className = "sub-agent-step__label";
  label.textContent = getToolUiConfig(traceEntry.tool_name).label;

  const state = document.createElement("span");
  state.className = `sub-agent-step__state sub-agent-step__state--${traceEntry.state || "done"}`;
  state.textContent = traceEntry.state === "running"
    ? "Running"
    : traceEntry.state === "error"
      ? "Failed"
      : traceEntry.cached
        ? "Cached"
        : "Done";

  top.append(label, state);
  item.appendChild(top);

  const detailText = String(traceEntry.preview || "").trim();
  if (detailText) {
    const detail = document.createElement("div");
    detail.className = "sub-agent-step__detail sub-agent-markdown";
    setMarkdownBlockContent(detail, detailText);
    item.appendChild(detail);
  }

  const summaryText = String(traceEntry.summary || "").trim();
  if (summaryText && summaryText !== detailText) {
    const summary = document.createElement("div");
    summary.className = "sub-agent-step__summary sub-agent-markdown";
    setMarkdownBlockContent(summary, summaryText);
    item.appendChild(summary);
  }

  return item;
}

/**
 * Updates or creates the sub-agent trace panel within a message group.
 * @param {HTMLElement} group
 * @param {object|null} metadata
 */
function updateAssistantSubAgentTrace(group, metadata) {
  const entries = getSubAgentTraceEntries(metadata);
  const existing = group.querySelector(".sub-agent-trace-panel");

  if (!entries.length) {
    if (existing) {
      existing.remove();
    }
    return;
  }

  const panel = existing || document.createElement("section");
  panel.className = "sub-agent-trace-panel";

  const title = document.createElement("div");
  title.className = "sub-agent-trace-panel__title";
  title.textContent = entries.length === 1 ? "Sub-agent activity" : `Sub-agent activity (${entries.length})`;

  const body = document.createElement("div");
  body.className = "sub-agent-trace-panel__body";

  entries.forEach((entry) => {
    const run = document.createElement("section");
    run.className = `sub-agent-run sub-agent-run--${entry.status}`;

    const header = document.createElement("div");
    header.className = "sub-agent-run__header";

    const task = document.createElement("div");
    task.className = "sub-agent-run__task";
    const taskInstructions = String(entry.task_full || entry.task || "").trim();
    const taskHeading = getSubAgentTaskHeading(taskInstructions || entry.summary || "Sub-agent");
    task.textContent = taskHeading;

    const status = document.createElement("span");
    status.className = `sub-agent-run__status sub-agent-run__status--${entry.status}`;
    status.textContent = getSubAgentStatusLabel(entry);

    header.append(task, status);
    run.appendChild(header);

    if (shouldShowSubAgentInstructions(taskInstructions, taskHeading)) {
      const instructions = document.createElement("details");
      instructions.className = "sub-agent-run__instructions";
      instructions.open = entry.status === "running";

      const instructionsSummary = document.createElement("summary");
      instructionsSummary.className = "sub-agent-run__instructions-summary";
      instructionsSummary.textContent = "Parent instructions";

      const instructionsBody = document.createElement("div");
      instructionsBody.className = "sub-agent-run__instructions-body sub-agent-markdown";
      setMarkdownBlockContent(instructionsBody, taskInstructions);

      instructions.append(instructionsSummary, instructionsBody);
      run.appendChild(instructions);
    }

    const fallbackNote = String(entry.fallback_note || "").trim();
    if (fallbackNote) {
      const note = document.createElement("div");
      note.className = "sub-agent-run__note sub-agent-markdown";
      setMarkdownBlockContent(note, fallbackNote);
      run.appendChild(note);
    }

    if (entry.tool_trace.length) {
      const toolTrace = document.createElement("div");
      toolTrace.className = "sub-agent-run__steps";
      entry.tool_trace.forEach((traceEntry) => {
        const normalizedSummary = normalizeToolSummary(traceEntry.summary);
        toolTrace.appendChild(createSubAgentStep({
          ...traceEntry,
          summary: normalizedSummary.text,
          state: normalizedSummary.isError ? "error" : traceEntry.state || "done",
          cached: traceEntry.cached || normalizedSummary.cached,
        }));
      });
      run.appendChild(toolTrace);
    }

    const summaryText = String(entry.summary || "").trim();
    const supportingText = entry.error || ((entry.status !== "ok" || !entry.tool_trace.length) && summaryText && summaryText !== fallbackNote ? entry.summary : "");
    if (supportingText) {
      const message = document.createElement("div");
      message.className = `${entry.error ? "sub-agent-run__error" : "sub-agent-run__result"} sub-agent-markdown`;
      setMarkdownBlockContent(message, supportingText);
      run.appendChild(message);
    }

    if (entry.canvas_saved) {
      const savedNote = document.createElement("div");
      savedNote.className = "sub-agent-run__canvas-note";
      savedNote.textContent = entry.canvas_document_title
        ? `Saved to Canvas as ${entry.canvas_document_title}.`
        : "Saved to Canvas.";
      run.appendChild(savedNote);
    }

    body.appendChild(run);
  });

  panel.innerHTML = "";
  panel.appendChild(title);
  panel.appendChild(body);

  if (!existing) {
    const anchor = group.querySelector(".reasoning-panel") || group.querySelector(".bubble");
    if (anchor) {
      group.insertBefore(panel, anchor);
    } else {
      group.appendChild(panel);
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Reasoning Panel Rendering                                          */
/* ------------------------------------------------------------------ */

/**
 * Builds a reasoning panel element.
 * @param {string} reasoningText
 * @param {{streaming?: boolean, forceOpen?: boolean}} [options={}]
 * @returns {HTMLElement|null}
 */
function buildReasoningPanel(reasoningText, options = {}) {
  const text = String(reasoningText || "").trim();
  if (!text) {
    return null;
  }

  const renderReasoning = options.streaming === true ? renderStreamingMarkdown : renderMarkdown;

  const details = document.createElement("details");
  details.className = "reasoning-panel";
  details.open = Boolean(options.forceOpen) || !shouldAutoCollapseReasoning();

  const summary = document.createElement("summary");
  summary.textContent = "Reasoning";

  const body = document.createElement("div");
  body.className = "reasoning-body";
  body.innerHTML = renderReasoning(text);

  details.appendChild(summary);
  details.appendChild(body);
  return details;
}

/**
 * Updates or creates a reasoning panel within a message group.
 * @param {HTMLElement} group
 * @param {string} reasoningText
 * @param {{streaming?: boolean, forceOpen?: boolean, autoCollapse?: boolean}} [options={}]
 */
function updateReasoningPanel(group, reasoningText, options = {}) {
  const text = String(reasoningText || "").trim();
  const existing = group.querySelector(".reasoning-panel");
  const renderReasoning = options.streaming === true ? renderStreamingMarkdown : renderMarkdown;

  if (!text) {
    if (existing) {
      existing.remove();
    }
    return;
  }

  if (existing) {
    const body = existing.querySelector(".reasoning-body");
    if (body) {
      body.innerHTML = renderReasoning(text);
    }
    if (options.forceOpen) {
      existing.open = true;
    } else if (options.autoCollapse && shouldAutoCollapseReasoning()) {
      existing.open = false;
    }
    return;
  }

  const panel = buildReasoningPanel(text, options);
  if (!panel) {
    return;
  }

  const bubble = group.querySelector(".bubble");
  if (bubble) {
    group.insertBefore(panel, bubble);
  } else {
    group.appendChild(panel);
  }
}

/* ------------------------------------------------------------------ */
/*  Reasoning Storage Helpers (extracted from app.js)                   */
/* ------------------------------------------------------------------ */

function getAssistantReasoningStorageKey(conversationId, messageId) {
  const normalizedConversationId = String(conversationId || "").trim();
  const normalizedMessageId = Number(messageId);
  if (!normalizedConversationId || !Number.isInteger(normalizedMessageId) || normalizedMessageId <= 0) {
    return null;
  }
  return `assistant-reasoning:${normalizedConversationId}:${normalizedMessageId}`;
}

function saveAssistantReasoning(conversationId, messageId, reasoningText) {
  const storageKey = getAssistantReasoningStorageKey(conversationId, messageId);
  if (!storageKey) {
    return;
  }

  const text = String(reasoningText || "").trim();
  try {
    if (text) {
      sessionStorage.setItem(storageKey, text);
    } else {
      sessionStorage.removeItem(storageKey);
    }
  } catch (_) {
    // Ignore storage errors.
  }
}

function getAssistantReasoning(conversationId, messageId) {
  const storageKey = getAssistantReasoningStorageKey(conversationId, messageId);
  if (!storageKey) {
    return "";
  }

  try {
    return String(sessionStorage.getItem(storageKey) || "").trim();
  } catch (_) {
    return "";
  }
}
