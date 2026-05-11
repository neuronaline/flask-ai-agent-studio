// Settings canvas — canvas prompt/expand/scroll settings
(function () {
  "use strict";

  // ─── DOM refs ────────────────────────────────────────────────────────────────
  const canvasPromptLinesEl = document.getElementById("canvas-prompt-lines-input");
  const canvasPromptTokensEl = document.getElementById("canvas-prompt-tokens-input");
  const canvasPromptCharsEl = document.getElementById("canvas-prompt-chars-input");
  const canvasCodeLineCharsEl = document.getElementById("canvas-code-line-chars-input");
  const canvasTextLineCharsEl = document.getElementById("canvas-text-line-chars-input");
  const canvasExpandLinesEl = document.getElementById("canvas-expand-lines-input");
  const canvasScrollLinesEl = document.getElementById("canvas-scroll-lines-input");

  // ─── Canvas sync (read from form, used by applySettingsToForm) ─────────────────
  function syncCanvasSettingsToForm(appSettings) {
    if (canvasPromptLinesEl) canvasPromptLinesEl.value = String(appSettings.canvas_prompt_max_lines || 250);
    if (canvasPromptTokensEl) canvasPromptTokensEl.value = String(appSettings.canvas_prompt_max_tokens || 4000);
    if (canvasPromptCharsEl) canvasPromptCharsEl.value = String(appSettings.canvas_prompt_max_chars || 20000);
    if (canvasCodeLineCharsEl) canvasCodeLineCharsEl.value = String(appSettings.canvas_prompt_code_line_max_chars || 180);
    if (canvasTextLineCharsEl) canvasTextLineCharsEl.value = String(appSettings.canvas_prompt_text_line_max_chars || 100);
    if (canvasExpandLinesEl) canvasExpandLinesEl.value = String(appSettings.canvas_expand_max_lines || 1600);
    if (canvasScrollLinesEl) canvasScrollLinesEl.value = String(appSettings.canvas_scroll_window_lines || 200);
  }

  // ─── Canvas payload helpers (used by saveSettings) ────────────────────────────
  function readCanvasSettingsPayload() {
    return {
      canvas_prompt_max_lines: window.__settingsCore.readNumericSetting(canvasPromptLinesEl, 250, { allowZero: false }),
      canvas_prompt_max_tokens: window.__settingsCore.readNumericSetting(canvasPromptTokensEl, 4000, { allowZero: false }),
      canvas_prompt_max_chars: window.__settingsCore.readNumericSetting(canvasPromptCharsEl, 20000, { allowZero: false }),
      canvas_prompt_code_line_max_chars: window.__settingsCore.readNumericSetting(canvasCodeLineCharsEl, 180, { allowZero: false }),
      canvas_prompt_text_line_max_chars: window.__settingsCore.readNumericSetting(canvasTextLineCharsEl, 100, { allowZero: false }),
      canvas_expand_max_lines: window.__settingsCore.readNumericSetting(canvasExpandLinesEl, 1600, { allowZero: false }),
      canvas_scroll_window_lines: window.__settingsCore.readNumericSetting(canvasScrollLinesEl, 200, { allowZero: false }),
    };
  }

  // ─── Export ──────────────────────────────────────────────────────────────────
  window.__settingsCanvas = {
    syncCanvasSettingsToForm,
    readCanvasSettingsPayload,
  };
})();
