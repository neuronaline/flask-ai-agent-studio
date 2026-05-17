// static/js/preferences.js — Model/persona selectors, sidebar prefs, panels
// Extracted from app.js (Phase 5.10)
// Dependencies: state.js (chatState), constants.js (MODEL_PREFERENCE_STORAGE_KEY, SIDEBAR_STORAGE_KEY),
//   DOM consts: statsPanel, statsOverlay, mobileToolsPanel, mobileToolsOverlay, mobileToolsBtn,
//   modelSel, mobileModelSel, personaSel, mobilePersonaSel, headerEl, sidebarToggleBtn,
//   appSettings, knownModelOptions (app.js)

// -- Panel management --

function openStats() {
  closeMobileTools();
  closeCanvas();
  closeExportPanel();
  closeSummaryPanel();
  
  statsPanel.classList.add("open");
  statsOverlay.classList.add("open");
}

function closeStats() {
  statsPanel.classList.remove("open");
  statsOverlay.classList.remove("open");
}

function openMobileTools() {
  closeStats();
  closeCanvas();
  closeExportPanel();
  closeSummaryPanel();
  
  mobileToolsPanel?.classList.add("open");
  mobileToolsOverlay?.classList.add("open");
  mobileToolsBtn?.setAttribute("aria-expanded", "true");
  mobileToolsPanel?.setAttribute("aria-hidden", "false");
}

function closeMobileTools() {
  mobileToolsPanel?.classList.remove("open");
  mobileToolsOverlay?.classList.remove("open");
  mobileToolsBtn?.setAttribute("aria-expanded", "false");
  mobileToolsPanel?.setAttribute("aria-hidden", "true");
}

// -- Model selection --

function getKnownModelLabel(modelId) {
  const normalizedId = String(modelId || "").trim();
  if (!normalizedId) {
    return "";
  }
  const match = knownModelOptions.find((model) => String(model?.id || "") === normalizedId);
  return String(match?.name || "").trim();
}

function isKnownModelId(modelId) {
  const normalizedId = String(modelId || "").trim();
  if (!normalizedId) {
    return false;
  }
  return knownModelOptions.some((model) => String(model?.id || "").trim() === normalizedId);
}

function readModelPreference() {
  try {
    const stored = String(localStorage.getItem(MODEL_PREFERENCE_STORAGE_KEY) || "").trim();
    return isKnownModelId(stored) ? stored : "";
  } catch (_) {
    return "";
  }
}

function writeModelPreference(modelId) {
  try {
    const normalizedId = String(modelId || "").trim();
    if (normalizedId && isKnownModelId(normalizedId)) {
      localStorage.setItem(MODEL_PREFERENCE_STORAGE_KEY, normalizedId);
    } else {
      localStorage.removeItem(MODEL_PREFERENCE_STORAGE_KEY);
    }
  } catch (_) {
    // Ignore storage errors.
  }
}

function resolvePreferredModelSelection(fallbackModelId = "") {
  const candidateValues = [
    isMobileViewport() ? mobileModelSel?.value : modelSel?.value,
    modelSel?.value,
    mobileModelSel?.value,
    readModelPreference(),
    fallbackModelId,
  ];

  for (const candidateValue of candidateValues) {
    const normalizedId = String(candidateValue || "").trim();
    if (isKnownModelId(normalizedId)) {
      return normalizedId;
    }
  }

  return "";
}

function ensureModelSelectorOption(selectEl, modelId, label = "") {
  if (!selectEl) {
    return;
  }
  const normalizedId = String(modelId || "").trim();
  if (!normalizedId) {
    return;
  }

  let option = Array.from(selectEl.options).find((entry) => entry.value === normalizedId) || null;
  const nextLabel = String(label || getKnownModelLabel(normalizedId) || normalizedId).trim() || normalizedId;
  if (!option) {
    option = document.createElement("option");
    option.value = normalizedId;
    option.textContent = nextLabel;
    selectEl.append(option);
    return;
  }
  if (nextLabel && option.textContent !== nextLabel) {
    option.textContent = nextLabel;
  }
}

function syncModelSelectors(value, label = "") {
  const nextValue = String(value || "");
  if (nextValue) {
    ensureModelSelectorOption(modelSel, nextValue, label);
    ensureModelSelectorOption(mobileModelSel, nextValue, label);
  }
  if (modelSel && modelSel.value !== nextValue) {
    modelSel.value = nextValue;
  }
  if (mobileModelSel && mobileModelSel.value !== nextValue) {
    mobileModelSel.value = nextValue;
  }
  writeModelPreference(nextValue);
}

// -- Persona selection --

function normalizePersonaId(value) {
  if (value === null || value === undefined || value === "") {
    return "";
  }
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? String(parsed) : "";
}

function getKnownPersonas() {
  return Array.isArray(appSettings.personas) ? appSettings.personas : [];
}

function findPersonaById(personaId) {
  const normalizedPersonaId = normalizePersonaId(personaId);
  if (!normalizedPersonaId) {
    return null;
  }
  return getKnownPersonas().find((persona) => normalizePersonaId(persona?.id) === normalizedPersonaId) || null;
}

function resolveConversationPersonaName(personaId, fallbackName = "") {
  const normalizedFallback = String(fallbackName || "").trim();
  if (normalizedFallback) {
    return normalizedFallback;
  }
  const persona = findPersonaById(personaId);
  return String(persona?.name || "").trim();
}

function getConversationDisplayTitle(conversation) {
  const source = conversation && typeof conversation === "object" ? conversation : {};
  const rawTitle = String(source.title || "").trim() || "New Chat";
  const titleSource = String(source.title_source || "system").trim().toLowerCase() || "system";
  const titleOverridden = source.title_overridden === true || Number(source.title_overridden || 0) === 1;
  const personaName = resolveConversationPersonaName(source.persona_id, source.persona_name || source.persona?.name || "");

  if (titleOverridden || titleSource === "manual") {
    return rawTitle;
  }
  if (titleSource === "persona" && personaName) {
    return personaName;
  }
  if (rawTitle === "New Chat" && personaName) {
    return personaName;
  }
  return rawTitle;
}

function getCurrentConversationDisplayTitle() {
  return getConversationDisplayTitle({
    title: chatState.currentConvTitle,
    title_source: chatState.currentConversationTitleSource,
    title_overridden: chatState.currentConversationTitleOverridden,
    persona_id: chatState.currentConversationPersonaId,
    persona_name: chatState.currentConversationPersonaName,
  });
}

function getDefaultPersonaId() {
  return normalizePersonaId(appSettings.default_persona_id);
}

function buildDefaultPersonaLabel() {
  const defaultPersona = findPersonaById(getDefaultPersonaId());
  const defaultPersonaName = String(defaultPersona?.name || "").trim();
  return defaultPersonaName ? `Use app default (${defaultPersonaName})` : "Use app default";
}

function populatePersonaSelectors() {
  const selectors = [personaSel, mobilePersonaSel].filter(Boolean);
  if (!selectors.length) {
    return;
  }

  const options = [
    { value: "", label: buildDefaultPersonaLabel() },
    ...getKnownPersonas().map((persona) => ({
      value: normalizePersonaId(persona?.id),
      label: String(persona?.name || `Persona ${persona?.id || ""}`).trim() || `Persona ${persona?.id || ""}`,
    })),
  ];

  selectors.forEach((selectEl) => {
    const fragment = document.createDocumentFragment();
    options.forEach((optionData) => {
      const option = document.createElement("option");
      option.value = optionData.value;
      option.textContent = optionData.label;
      fragment.append(option);
    });
    selectEl.replaceChildren(fragment);
  });
}

function syncPersonaSelectors(value = "") {
  const nextValue = normalizePersonaId(value);
  populatePersonaSelectors();
  if (personaSel) {
    personaSel.value = nextValue;
  }
  if (mobilePersonaSel) {
    mobilePersonaSel.value = nextValue;
  }
}

function applyConversationPersonaSelection(personaId) {
  chatState.currentConversationPersonaId = normalizePersonaId(personaId);
  chatState.currentConversationPersonaName = resolveConversationPersonaName(chatState.currentConversationPersonaId, chatState.currentConversationPersonaName);
  syncPersonaSelectors(chatState.currentConversationPersonaId);
}

async function persistConversationPersona(personaId) {
  if (!chatState.currentConvId) {
    return;
  }
  const response = await fetch(`/api/conversations/${chatState.currentConvId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ persona_id: normalizePersonaId(personaId) || null }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "Unable to update conversation persona.");
  }
  chatState.currentConvTitle = String(data.title || chatState.currentConvTitle || "New Chat").trim() || "New Chat";
  chatState.currentConversationTitleSource = String(data.title_source || chatState.currentConversationTitleSource || "system").trim().toLowerCase() || "system";
  chatState.currentConversationTitleOverridden = data.title_overridden === true || Number(data.title_overridden || 0) === 1;
  applyConversationPersonaSelection(data.persona_id);
  chatState.currentConversationPersonaName = resolveConversationPersonaName(data.persona_id, "");
  updateExportPanel();
  await loadSidebar();
}

// -- Viewport / Sidebar --

function isMobileViewport() {
  return window.matchMedia("(max-width: 980px)").matches;
}

function updateHeaderOffset() {
  if (!headerEl) {
    return;
  }
  document.documentElement.style.setProperty("--header-offset", `${headerEl.offsetHeight}px`);
}

function readSidebarPreference() {
  try {
    const stored = localStorage.getItem(SIDEBAR_STORAGE_KEY);
    if (stored === null) {
      return null;
    }
    return stored === "true";
  } catch (_) {
    return null;
  }
}

function writeSidebarPreference(isOpen) {
  try {
    localStorage.setItem(SIDEBAR_STORAGE_KEY, String(Boolean(isOpen)));
  } catch (_) {
    // Ignore storage errors.
  }
}

function updateSidebarToggleLabel(isOpen) {
  if (!sidebarToggleBtn) {
    return;
  }
  sidebarToggleBtn.setAttribute("aria-expanded", String(Boolean(isOpen)));
  sidebarToggleBtn.title = isOpen ? "Hide conversations" : "Show conversations";
}

function setSidebarOpen(isOpen, persist = true) {
  document.body.classList.toggle("sidebar-collapsed", !isOpen);
  updateSidebarToggleLabel(isOpen);
  if (persist) {
    writeSidebarPreference(isOpen);
  }
}

function toggleSidebar() {
  const isOpen = !document.body.classList.contains("sidebar-collapsed");
  setSidebarOpen(!isOpen);
}

function closeSidebarOnMobile() {
  if (isMobileViewport()) {
    setSidebarOpen(false);
  }
}
