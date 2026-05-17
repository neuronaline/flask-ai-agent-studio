/**
 * Application constants extracted from app.js
 * Phase 5.2 - Modularization effort
 */

// ============================================================================
// Summary Related
// ============================================================================

const SUMMARY_FOCUS_PRESETS = [
  {
    id: "action_items",
    label: "Action items",
    text: "action items, owners, and next steps",
  },
  {
    id: "decisions",
    label: "Decisions",
    text: "decisions made and why they were chosen",
  },
  {
    id: "unresolved_questions",
    label: "Unresolved questions",
    text: "open questions, blockers, and what still needs confirmation",
  },
  {
    id: "risks",
    label: "Risks",
    text: "risks, tradeoffs, and anything that could go wrong",
  },
  {
    id: "key_facts",
    label: "Key facts",
    text: "the most important facts, constraints, and context to retain",
  },
  {
    id: "next_steps",
    label: "Next steps",
    text: "the next concrete steps and the order they should happen in",
  },
];

const SUMMARY_DETAIL_OPTIONS = [
  {
    value: "very_concise",
    label: "Very concise",
    description: "Shortest useful form. Keeps only essentials.",
  },
  {
    value: "concise",
    label: "Concise",
    description: "Keeps high-value facts, decisions, and open questions.",
  },
  {
    value: "balanced",
    label: "Balanced",
    description: "Default choice. Preserves context without adding noise.",
  },
  {
    value: "detailed",
    label: "Detailed",
    description: "Preserves more nuance while staying compact.",
  },
  {
    value: "comprehensive",
    label: "Comprehensive",
    description: "Largest context retention for the least ambiguity.",
  },
];

const SUMMARY_MODE_LABELS = {
  auto: "Auto",
  conservative: "Conservative",
  aggressive: "Aggressive",
  never: "Never",
};

const SUMMARY_SOURCE_LABELS = {
  conversation_history: "Conversation chatState.history",
  summary_history: "Summary chatState.history",
};

// ============================================================================
// File / Image / Document Related
// ============================================================================

const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10MB
const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024; // 20MB
const ALLOWED_DOCUMENT_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/pdf",
  "text/plain",
  "text/csv",
  "text/markdown",
]);
const DOCUMENT_EXTENSIONS = new Set([".docx", ".pdf", ".txt", ".csv", ".md"]);
const VISUAL_PDF_PAGE_LIMIT = 3;

// ============================================================================
// Canvas Related (Standalone Config)
// ============================================================================

const CANVAS_EMPTY_STATES = Object.freeze({
  no_documents: Object.freeze({
    title: "No canvas document yet",
    message: "Create a blank file with New file, upload an existing text file, or ask the assistant to draft something substantial and keep refining it with line-based edits.",
  }),
  no_matches: Object.freeze({
    title: "No files match the current filters",
    message: "Adjust the search term, role, or path filter to bring files back into view.",
  }),
});

const CANVAS_MUTATION_LABELS = Object.freeze({
  create: "file creation",
  upload: "file upload",
  delete: "file deletion",
  clear: "canvas clearing",
  rename: "rename",
  save: "save",
});

const DEFAULT_CANVAS_CONFIRM_LABEL = "Open Canvas";
const DEFAULT_CANVAS_CONFIRM_CANCEL_LABEL = "Later";

const CANVAS_ZOOM_LEVELS = Object.freeze([1, 1.12, 1.25, 1.4, 1.55]);

const CANVAS_PANEL_WIDTH_STORAGE_KEY = "chatbot.canvasPanelWidth";
const MODEL_PREFERENCE_STORAGE_KEY = "chatbot.selectedModel";
const CANVAS_PANEL_DEFAULT_WIDTH = 620;
const CANVAS_PANEL_MIN_WIDTH = 420;
const CANVAS_PANEL_MAX_WIDTH = 1100;
const CANVAS_ROOT_PATH_FILTER = "__root__";
const CANVAS_PREVIEW_RENDER_INTERVAL_MS = 32;
const CANVAS_STREAMING_RENDER_DEFER_INTERVAL_MS = 48;
const CANVAS_STREAMING_PREVIEW_THROTTLE_MS = 96;

// ============================================================================
// Streaming / Render Timing
// ============================================================================

const STREAM_RENDER_FALLBACK_INTERVAL_MS = 16;
const STREAM_ANSWER_RENDER_INTERVAL_MS = 42;

// ============================================================================
// UI / Sidebar Related
// ============================================================================

const SIDEBAR_STORAGE_KEY = "chatbot.sidebarOpen";
const CLARIFICATION_DRAFT_STORAGE_PREFIX = "chatbot.clarificationDraft";
const SLASH_COMMAND_MENU_MAX_VISIBLE_ITEMS = 6;
const PENDING_CANVAS_UPLOAD_PREVIEW_KEY = "pending-canvas-upload";

// ============================================================================
// Canvas Tools Sets
// ============================================================================

const CANVAS_STREAMING_PREVIEW_TOOLS = new Set(["create_canvas_document", "batch_canvas_edits"]);
const CANVAS_EDIT_PREVIEW_TOOLS = new Set(["batch_canvas_edits"]);
const CANVAS_PAGE_HEADING_TEXT_RE = /^Page\s+(\d+)$/i;

// ============================================================================
// Streaming Canvas Limits
// ============================================================================

const STREAMING_CANVAS_MARKDOWN_PLAIN_TEXT_CHAR_LIMIT = 30000;
const STREAMING_CANVAS_MARKDOWN_PLAIN_TEXT_LINE_LIMIT = 800;
