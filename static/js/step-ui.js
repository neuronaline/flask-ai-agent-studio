/**
 * Tool Step UI module — renders and manages tool execution step items in the chat.
 * Depends on: state.js (indirect), utils.js (escHtml), DOM: document
 */

/* ------------------------------------------------------------------ */
/*  Tool UI Configuration                                              */
/* ------------------------------------------------------------------ */

const TOOL_UI_CONFIG = {
  search_knowledge_base: {
    icon: "🧠",
    label: "Knowledge Base",
    runningTitle: "Searching knowledge base",
    doneTitle: "Knowledge results ready",
    errorTitle: "Knowledge search failed",
    fallbackDetail: "Looking through indexed context and synced chat memory.",
  },
  search_web: {
    icon: "🔎",
    label: "Web Search",
    runningTitle: "Searching the web",
    doneTitle: "Web results ready",
    errorTitle: "Web search failed",
    fallbackDetail: "Collecting live sources from the open web.",
  },
  fetch_url: {
    icon: "🌐",
    label: "Web Fetch",
    runningTitle: "Reading page",
    doneTitle: "Page content extracted",
    errorTitle: "Page read failed",
    fallbackDetail: "Opening the source and extracting readable content.",
  },
  search_news_ddgs: {
    icon: "📰",
    label: "News Search",
    runningTitle: "Scanning news sources",
    doneTitle: "News results ready",
    errorTitle: "News search failed",
    fallbackDetail: "Checking recent headlines and source coverage.",
  },
  search_news_google: {
    icon: "🗞️",
    label: "Google News",
    runningTitle: "Scanning Google News",
    doneTitle: "Google News results ready",
    errorTitle: "Google News search failed",
    fallbackDetail: "Checking recent headlines and publisher coverage.",
  },
};

/* ------------------------------------------------------------------ */
/*  Tool UI Helpers                                                    */
/* ------------------------------------------------------------------ */

/**
 * Returns the UI config object for a given tool name.
 * Falls back to a generic config if the tool is unknown.
 * @param {string} toolName
 * @returns {{icon: string, label: string, runningTitle: string, doneTitle: string, errorTitle: string, fallbackDetail: string}}
 */
function getToolUiConfig(toolName) {
  return TOOL_UI_CONFIG[toolName] || {
    icon: "⚙️",
    label: "Tool",
    runningTitle: "Running tool",
    doneTitle: "Tool completed",
    errorTitle: "Tool failed",
    fallbackDetail: "Processing tool call.",
  };
}

/**
 * Formats a duration in milliseconds into a human-readable string.
 * @param {number} durationMs
 * @returns {string}
 */
function formatToolDuration(durationMs) {
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    return "";
  }
  if (durationMs < 1000) {
    return `${Math.max(1, Math.round(durationMs))} ms`;
  }
  if (durationMs < 10_000) {
    return `${(durationMs / 1000).toFixed(1)} s`;
  }
  return `${Math.round(durationMs / 1000)} s`;
}

/**
 * Extracts the hostname from a URL string.
 * @param {string} value
 * @returns {string}
 */
function extractHost(value) {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }
  try {
    return new URL(text).hostname.replace(/^www\./i, "");
  } catch (_) {
    return "";
  }
}

/**
 * Normalizes a tool summary string into a structured object.
 * @param {string} summary
 * @returns {{text: string, cached: boolean, isError: boolean}}
 */
function normalizeToolSummary(summary) {
  const raw = String(summary || "").trim();
  if (!raw) {
    return { text: "", cached: false, isError: false };
  }

  const cached = /\(cached\)$/i.test(raw);
  const withoutCached = raw.replace(/\s*\(cached\)$/i, "").trim();
  const isError = /^error:/i.test(withoutCached) || /^failed:/i.test(withoutCached) || /^[^:]{0,120}\bfailed:\s*/i.test(withoutCached);
  const text = isError ? withoutCached.replace(/^error:\s*/i, "").trim() : withoutCached;
  return { text, cached, isError };
}

/**
 * Builds an array of meta label strings for a tool execution.
 * @param {string} toolName
 * @param {string} preview
 * @param {{cached?: boolean, durationMs?: number|null}} options
 * @returns {string[]}
 */
function buildToolMeta(toolName, preview, options = {}) {
  const meta = [];
  const detail = String(preview || "").trim();
  const { cached = false, durationMs = null } = options;

  if (toolName === "fetch_url") {
    const host = extractHost(detail);
    if (host) {
      meta.push(host);
    }
    if (detail) {
      meta.push("URL");
    }
  } else if (["search_web", "search_news_ddgs", "search_news_google"].includes(toolName) && detail) {
    const queryCount = detail
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean).length;
    if (queryCount > 0) {
      meta.push(`${queryCount} quer${queryCount === 1 ? "y" : "ies"}`);
    }
  } else if (toolName === "search_knowledge_base") {
    meta.push("semantic retrieval");
  }

  if (cached) {
    meta.push("cached");
  }

  const durationText = formatToolDuration(durationMs);
  if (durationText) {
    meta.push(durationText);
  }

  return meta;
}

/* ------------------------------------------------------------------ */
/*  DOM Helpers                                                        */
/* ------------------------------------------------------------------ */

/**
 * Ensures a step section container exists within a step log element.
 * @param {HTMLElement} stepLog
 * @param {Object<string, HTMLElement>} stepSections
 * @param {number} step
 * @param {number|null} maxSteps
 * @returns {HTMLElement} the section items container
 */
function ensureToolStepSection(stepLog, stepSections, step, maxSteps) {
  const stepKey = String(step || 1);
  if (stepSections[stepKey]) {
    return stepSections[stepKey];
  }

  const section = document.createElement("section");
  section.className = "step-section";

  const header = document.createElement("div");
  header.className = "step-section-header";

  const title = document.createElement("div");
  title.className = "step-section-title";
  title.textContent = `Step ${stepKey}`;

  const caption = document.createElement("div");
  caption.className = "step-section-caption";
  caption.textContent = maxSteps ? `Tool round ${stepKey}/${maxSteps}` : "Tool round";

  header.appendChild(title);
  header.appendChild(caption);

  const items = document.createElement("div");
  items.className = "step-section-items";

  section.appendChild(header);
  section.appendChild(items);
  stepLog.appendChild(section);

  stepSections[stepKey] = items;
  return items;
}

/**
 * Creates a new tool step item DOM element.
 * @param {string} toolName
 * @returns {HTMLDetailsElement}
 */
function createToolStepItem(toolName) {
  const config = getToolUiConfig(toolName);
  const item = document.createElement("details");
  item.className = "step-item step-running";
  item.open = true;
  item.innerHTML = [
    '<summary class="step-item-summary">',
    '  <div class="step-item-icon"></div>',
    '  <div class="step-item-body">',
    '    <div class="step-item-top">',
    '      <span class="step-status-badge"></span>',
    '      <span class="step-item-label"></span>',
    '      <span class="step-time"></span>',
    "    </div>",
    '    <div class="step-title"></div>',
    "  </div>",
    "</summary>",
    '<div class="step-item-content">',
    '  <div class="step-detail"></div>',
    '  <div class="step-meta"></div>',
    '  <div class="step-summary"></div>',
    "</div>",
  ].join("");
  item.querySelector(".step-item-icon").textContent = config.icon;
  return item;
}

/**
 * Updates a tool step item's visual state based on the given payload.
 * @param {HTMLDetailsElement} item
 * @param {{toolName: string, state?: string, preview?: string, durationMs?: number|null, cached?: boolean, summary?: string}} payload
 */
function setToolStepState(item, payload) {
  const config = getToolUiConfig(payload.toolName);
  const state = payload.state || "running";
  const preview = String(payload.preview || "").trim();
  const durationMs = Number.isFinite(payload.durationMs) ? payload.durationMs : null;
  const metaItems = buildToolMeta(payload.toolName, preview, {
    cached: Boolean(payload.cached),
    durationMs,
  });

  item.classList.remove("step-running", "step-done", "step-error");
  item.classList.add(`step-${state}`);
  item.open = state !== "done";

  const badge = item.querySelector(".step-status-badge");
  const label = item.querySelector(".step-item-label");
  const time = item.querySelector(".step-time");
  const title = item.querySelector(".step-title");
  const detail = item.querySelector(".step-detail");
  const meta = item.querySelector(".step-meta");
  const summary = item.querySelector(".step-summary");
  const icon = item.querySelector(".step-item-icon");

  badge.textContent = state === "running" ? "Running" : state === "error" ? "Failed" : payload.cached ? "Cached" : "Done";
  label.textContent = config.label;
  time.textContent = state === "running" ? "" : formatToolDuration(durationMs);
  title.textContent = state === "running" ? config.runningTitle : state === "error" ? config.errorTitle : config.doneTitle;

  const detailText = preview || config.fallbackDetail;
  detail.textContent = detailText;
  detail.style.display = detailText ? "" : "none";

  meta.innerHTML = metaItems.map((value) => `<span class="step-chip">${escHtml(value)}</span>`).join("");
  meta.style.display = metaItems.length ? "" : "none";

  summary.textContent = String(payload.summary || "").trim();
  summary.style.display = summary.textContent ? "" : "none";

  icon.textContent = config.icon;
  item.dataset.state = state;
}
