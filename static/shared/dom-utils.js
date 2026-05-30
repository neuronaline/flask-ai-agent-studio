/**
 * Shared DOM utility functions.
 */

(function () {
  "use strict";

  /**
   * Auto-resizes a textarea element to fit its content.
   * Sets height to auto, then to scrollHeight to fit content.
   * @param {HTMLElement|null} element - The element to auto-resize.
   */
  function autoResize(element) {
    if (!element) {
      return;
    }
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  }

  /**
   * Auto-resizes an inline editor textarea with a max height limit.
   * Used for message inline editors.
   * @param {HTMLTextAreaElement|null} textarea - The textarea to auto-resize.
   * @param {number} maxHeight - Maximum height in pixels (default: 360).
   */
  function autoResizeInlineEditor(textarea, maxHeight = 360) {
    if (!(textarea instanceof HTMLTextAreaElement)) {
      return;
    }
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
  }

  // Export to window for use by other modules
  window.__domUtils = {
    autoResize,
    autoResizeInlineEditor,
  };
})();
