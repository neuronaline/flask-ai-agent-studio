// Settings fetch — fetch thresholds, HTML converter, summarize settings
(function () {
  "use strict";

  // ─── DOM refs ────────────────────────────────────────────────────────────────
  const fetchThresholdEl = document.getElementById("fetch-threshold-input");
  const fetchAggressivenessEl = document.getElementById("fetch-aggressiveness-input");
  const fetchSummarizeMaxInputCharsEl = document.getElementById("fetch-summarize-max-input-chars-input");
  const fetchSummarizeMaxOutputTokensEl = document.getElementById("fetch-summarize-max-output-tokens-input");
  const fetchRawMaxTextCharsEl = document.getElementById("fetch-raw-max-text-chars-input");
  const fetchSummaryMaxCharsEl = document.getElementById("fetch-summary-max-chars-input");

  // ─── Fetch settings apply ─────────────────────────────────────────────────────
  function syncFetchSettingsToForm(appSettings) {
    if (fetchThresholdEl) fetchThresholdEl.value = String(appSettings.fetch_url_token_threshold || 3500);
    if (fetchAggressivenessEl) fetchAggressivenessEl.value = String(appSettings.fetch_url_clip_aggressiveness || 50);
    if (fetchSummarizeMaxInputCharsEl) fetchSummarizeMaxInputCharsEl.value = String(appSettings.fetch_url_summarized_max_input_chars || 80000);
    if (fetchSummarizeMaxOutputTokensEl) fetchSummarizeMaxOutputTokensEl.value = String(appSettings.fetch_url_summarized_max_output_tokens || 2400);
    if (fetchRawMaxTextCharsEl) fetchRawMaxTextCharsEl.value = String(appSettings.fetch_raw_max_text_chars || 24000);
    if (fetchSummaryMaxCharsEl) fetchSummaryMaxCharsEl.value = String(appSettings.fetch_summary_max_chars || 8000);
  }

  // ─── Fetch payload helpers ───────────────────────────────────────────────────
  function readFetchSettingsPayload() {
    return {
      fetch_url_token_threshold: window.__settingsCore.readNumericSetting(fetchThresholdEl, 3500, { allowZero: false }),
      fetch_url_clip_aggressiveness: window.__settingsCore.readNumericSetting(fetchAggressivenessEl, 50),
      fetch_url_summarized_max_input_chars: window.__settingsCore.readNumericSetting(fetchSummarizeMaxInputCharsEl, 80000, { allowZero: false, min: 4000, max: 100000 }),
      fetch_url_summarized_max_output_tokens: window.__settingsCore.readNumericSetting(fetchSummarizeMaxOutputTokensEl, 2400, { allowZero: false, min: 200, max: 4000 }),
      fetch_raw_max_text_chars: window.__settingsCore.readNumericSetting(fetchRawMaxTextCharsEl, 24000, { allowZero: false, min: 1000 }),
      fetch_summary_max_chars: window.__settingsCore.readNumericSetting(fetchSummaryMaxCharsEl, 8000, { allowZero: false, min: 500 }),
    };
  }

  // ─── Export ──────────────────────────────────────────────────────────────────
  window.__settingsFetch = {
    syncFetchSettingsToForm,
    readFetchSettingsPayload,
  };
})();
