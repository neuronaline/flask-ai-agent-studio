/**
 * Shared form utility functions for reading and normalizing form input values.
 */

(function () {
  "use strict";

  /**
   * Reads a numeric value from a form element with validation and bounds checking.
   * @param {HTMLInputElement|null} element - The input element to read from.
   * @param {number} defaultValue - Default value if element is empty or invalid.
   * @param {Object} options - Configuration options.
   * @param {boolean} options.allowZero - Whether to allow zero as a valid value.
   * @param {number|null} options.min - Minimum bound (takes precedence over element's min attribute).
   * @param {number|null} options.max - Maximum bound (takes precedence over element's max attribute).
   * @returns {number} The parsed and validated numeric value.
   */
  function readNumericSetting(element, defaultValue, { allowZero = true, min = null, max = null } = {}) {
    if (!element) {
      return defaultValue;
    }
    const rawValue = String(element.value || "").trim();
    if (!rawValue) {
      return defaultValue;
    }
    const parsed = Number.parseInt(rawValue, 10);
    if (Number.isNaN(parsed)) {
      return defaultValue;
    }
    if (!allowZero && parsed === 0) {
      return defaultValue;
    }
    const resolvedMin = Number.isFinite(min)
      ? min
      : (String(element.min || "").trim() ? Number.parseInt(element.min, 10) : null);
    const resolvedMax = Number.isFinite(max)
      ? max
      : (String(element.max || "").trim() ? Number.parseInt(element.max, 10) : null);
    let value = parsed;
    if (Number.isFinite(resolvedMin)) {
      value = Math.max(Number(resolvedMin), value);
    }
    if (Number.isFinite(resolvedMax)) {
      value = Math.min(Number(resolvedMax), value);
    }
    return value;
  }

  /**
   * Reads a floating-point value from a form element with validation and bounds checking.
   * @param {HTMLInputElement|null} element - The input element to read from.
   * @param {number} defaultValue - Default value if element is empty or invalid.
   * @param {Object} options - Configuration options.
   * @param {number} options.min - Minimum bound.
   * @param {number} options.max - Maximum bound.
   * @returns {number} The parsed and validated float value.
   */
  function readFloatSetting(element, defaultValue, { min = -Infinity, max = Infinity } = {}) {
    if (!element) {
      return defaultValue;
    }
    const rawValue = String(element.value || "").trim();
    if (!rawValue) {
      return defaultValue;
    }
    const parsed = Number.parseFloat(rawValue);
    if (Number.isNaN(parsed)) {
      return defaultValue;
    }
    return Math.min(max, Math.max(min, parsed));
  }

  // Export to window for use by other modules
  window.__formUtils = {
    readNumericSetting,
    readFloatSetting,
  };

  // Also expose globally for legacy modules that expect direct access
  window.readNumericSetting = readNumericSetting;
  window.readFloatSetting = readFloatSetting;
})();
