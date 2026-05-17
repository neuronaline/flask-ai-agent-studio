// Settings tabs — tab activation and navigation
(function () {
  "use strict";

  // ─── DOM refs ────────────────────────────────────────────────────────────────
  const tabButtons = Array.from(document.querySelectorAll("[data-settings-tab]"));
  const tabPanels = Array.from(document.querySelectorAll("[data-settings-panel]"));

  // ─── activateTab ─────────────────────────────────────────────────────────────
  function activateTab(tabId, updateHash = true) {
    const normalizedTabId = String(tabId || "general");
    const nextId = (window.__settingsCore?.SETTINGS_TAB_ALIASES || {})[normalizedTabId] || normalizedTabId;

    tabButtons.forEach((button) => {
      const isActive = button.dataset.settingsTab === nextId;
      button.classList.toggle("active", isActive);
      button.setAttribute("aria-selected", String(isActive));
    });

    tabPanels.forEach((panel) => {
      const isActive = panel.dataset.settingsPanel === nextId;
      panel.classList.toggle("active", isActive);
      panel.toggleAttribute("hidden", !isActive);
    });

    if (updateHash) {
      history.replaceState(null, "", `#${nextId}`);
    }
  }

  // ─── initializeTabs ─────────────────────────────────────────────────────────
  function initializeTabs() {
    tabButtons.forEach((button) => {
      button.addEventListener("click", () => activateTab(button.dataset.settingsTab));
    });

    const hash = String(window.location.hash || "").replace(/^#/, "");
    const resolvedHash = (window.__settingsCore?.SETTINGS_TAB_ALIASES || {})[hash] || hash;
    const initialTab = tabButtons.some((button) => button.dataset.settingsTab === resolvedHash) ? resolvedHash : "general";
    activateTab(initialTab, false);
  }

  // ─── Export ──────────────────────────────────────────────────────────────────
  window.__settingsTabs = {
    activateTab,
    initializeTabs,
  };
})();
