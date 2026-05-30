/**
 * Utility functions extracted from app.js
 * Phase 5.1 - Modularization effort
 */

/**
 * Formats a number with locale-aware thousand separators.
 * @param {unknown} value - The value to format.
 * @returns {string} Formatted number or em-dash if not finite.
 */
function fmt(value) {
  return Number.isFinite(value) ? value.toLocaleString() : "—";
}

/**
 * Escapes special regex characters in a string.
 * @param {string} text - The text to escape.
 * @returns {string} Escaped string safe for use in RegExp.
 */
function escapeRegExp(text) {
  return String(text || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Formats a byte size into human-readable format (KB or MB).
 * @param {number} size - Size in bytes.
 * @returns {string} Formatted string (e.g., "12 KB" or "3.5 MB").
 */
function formatFileSize(size) {
  if (!Number.isFinite(size) || size <= 0) {
    return "0 KB";
  }
  if (size < 1024 * 1024) {
    return `${Math.max(1, Math.round(size / 1024))} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Checks if a DataTransfer object contains files.
 * @param {DataTransfer | null} dataTransfer - The DataTransfer to check.
 * @returns {boolean} True if files are present.
 */
function hasDraggedFiles(dataTransfer) {
  return Array.from(dataTransfer?.types || []).includes("Files");
}

/**
 * Converts a value to a finite number, with fallback.
 * @param {unknown} value - The value to convert.
 * @param {number} [fallback=0] - Fallback value if conversion fails.
 * @returns {number} Converted number or fallback.
 */
function toFiniteNumber(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

/**
 * Converts a value to a non-negative integer or null.
 * @param {unknown} value - The value to convert.
 * @returns {number | null} Non-negative integer or null.
 */
function toNonNegativeIntOrNull(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const normalized = Number(value);
  if (!Number.isFinite(normalized)) {
    return null;
  }
  return Math.max(0, Math.round(normalized));
}

/**
 * Escapes HTML special characters to prevent XSS.
 * @param {string} str - The string to escape.
 * @returns {string} HTML-escaped string.
 */
function escHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Auto-resizes an element's height to fit its content.
 * @param {HTMLElement} element - The element to resize.
 */
function autoResize(element) {
  element.style.height = "auto";
  element.style.height = element.scrollHeight + "px";
}

/**
 * Fallback copy function using textarea element.
 * @param {string} text - The text to copy.
 * @returns {boolean} True if copy succeeded.
 */
function fallbackCopyText(text) {
  const normalizedText = String(text || "");
  if (!normalizedText) {
    return false;
  }

  const textarea = document.createElement("textarea");
  textarea.value = normalizedText;
  textarea.setAttribute("readonly", "readonly");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "-9999px";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);

  try {
    textarea.select();
    const result = document.execCommand("copy");
    return result;
  } catch (_) {
    return false;
  } finally {
    textarea.remove();
  }
}

/**
 * Copies text to clipboard using modern API with fallback.
 * @param {string} text - The text to copy.
 * @returns {Promise<boolean>} True if copy succeeded.
 */
async function copyTextToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_) {
      // Fall through to the legacy copy fallback.
    }
  }

  return fallbackCopyText(text);
}
