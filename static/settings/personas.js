// Persona management — loaded on /settings page only
(function () {
  // ─── DOM refs ────────────────────────────────────────────────────────────────
  const generalInstructionsEl = document.getElementById("general-instructions-input");
  const generalInstructionsTemplateSelectEl = document.getElementById("general-instructions-template-select");
  const generalInstructionsTemplateApplyBtn = document.getElementById("general-instructions-template-apply-btn");
  const aiPersonalityEl = document.getElementById("ai-personality-input");
  const aiPersonalityTemplateSelectEl = document.getElementById("ai-personality-template-select");
  const aiPersonalityTemplateApplyBtn = document.getElementById("ai-personality-template-apply-btn");
  const defaultPersonaEl = document.getElementById("default-persona-select");
  const openPersonasTabBtn = document.getElementById("open-personas-tab-btn");
  const personaListEl = document.getElementById("persona-list");
  const personaNameEl = document.getElementById("persona-name-input");
  const personaSaveBtn = document.getElementById("persona-save-btn");
  const personaDeleteBtn = document.getElementById("persona-delete-btn");
  const personaNewBtn = document.getElementById("persona-new-btn");
  const personaStatusEl = document.getElementById("persona-status");
  const personaEditorTitleEl = document.getElementById("persona-editor-title");
  const personaMemoryListEl = document.getElementById("persona-memory-list");
  const personaMemoryKeyEl = document.getElementById("persona-memory-key-input");
  const personaMemoryValueEl = document.getElementById("persona-memory-value-input");
  const personaMemorySaveBtn = document.getElementById("persona-memory-save-btn");
  const personaMemoryCancelBtn = document.getElementById("persona-memory-cancel-btn");
  const personaMemoryDeleteBtn = document.getElementById("persona-memory-delete-btn");
  const personaMemoryStatusEl = document.getElementById("persona-memory-status");
  const personaMemoryNoteEl = document.getElementById("persona-memory-note");

  if (!personaListEl) return; // panel not in DOM

  // ─── State ──────────────────────────────────────────────────────────────────
  const appSettings = window.__appSettings || {};
  let hasUnsavedPersonaChanges = false;
  let activePersonaId = null;
  let activePersonaMemoryEntryId = null;
  let isPersonaMemoryLoading = false;
  let personaMemoryByPersonaId = {};

  function getActivePersonaId() { return activePersonaId; }

  // ─── Helpers ────────────────────────────────────────────────────────────────
  const autoResize = window.__domUtils?.autoResize ?? function(element) {
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  };

  function populateBehaviorTemplateSelect(selectEl, templates) {
    if (!selectEl) return;
    const fragment = document.createDocumentFragment();
    const placeholderOption = document.createElement("option");
    placeholderOption.value = "";
    placeholderOption.textContent = "Choose a template";
    fragment.append(placeholderOption);
    templates.forEach((template) => {
      const option = document.createElement("option");
      option.value = template.id;
      option.textContent = template.label;
      fragment.append(option);
    });
    selectEl.replaceChildren(fragment);
  }

  function getBehaviorTemplateById(templates, templateId) {
    return templates.find((template) => template.id === templateId) || null;
  }

  function applyBehaviorTemplate(selectEl, textareaEl, templates) {
    if (!selectEl || !textareaEl) return;
    const selectedTemplate = getBehaviorTemplateById(templates, selectEl.value);
    if (!selectedTemplate) return;
    textareaEl.value = selectedTemplate.text;
    autoResize(textareaEl);
    markPersonaDirty();
  }

  function initializeAssistantBehaviorTemplates() {
    populateBehaviorTemplateSelect(generalInstructionsTemplateSelectEl, window.__settingsCore?.GENERAL_INSTRUCTION_TEMPLATES || []);
    populateBehaviorTemplateSelect(aiPersonalityTemplateSelectEl, window.__settingsCore?.AI_PERSONALITY_TEMPLATES || []);
  }

  function normalizePersonaId(value) {
    if (value === null || value === undefined || value === "") return null;
    const parsed = Number.parseInt(String(value), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  function getPersonas() {
    return Array.isArray(appSettings.personas) ? appSettings.personas : [];
  }

  function findPersonaById(personaId) {
    const normalizedPersonaId = normalizePersonaId(personaId);
    if (!normalizedPersonaId) return null;
    return getPersonas().find((persona) => normalizePersonaId(persona?.id) === normalizedPersonaId) || null;
  }

  function describePersona(persona) {
    const generalInstructions = String(persona?.general_instructions || "")
      .split("\n").map((value) => value.trim()).find(Boolean) || "";
    const aiPersonality = String(persona?.ai_personality || "")
      .split("\n").map((value) => value.trim()).find(Boolean) || "";
    return generalInstructions || aiPersonality || "No persistent instructions yet.";
  }

  function setPersonaStatus(message, tone = "muted") {
    if (!personaStatusEl) return;
    personaStatusEl.textContent = message;
    personaStatusEl.dataset.tone = tone;
  }

  function setPersonaActionsDisabled(disabled) {
    if (personaSaveBtn) personaSaveBtn.disabled = disabled;
    if (personaDeleteBtn) personaDeleteBtn.disabled = disabled || !activePersonaId;
    if (personaNewBtn) personaNewBtn.disabled = disabled;
  }

  function markPersonaDirty() {
    hasUnsavedPersonaChanges = true;
    if (typeof window.markDirty === "function") markDirty();
  }

  function clearPersonaDirty() {
    hasUnsavedPersonaChanges = false;
  }

  // ─── Memory CRUD ─────────────────────────────────────────────────────────────
  function normalizePersonaMemoryEntryId(value) {
    if (value === null || value === undefined || value === "") return null;
    const parsed = Number.parseInt(String(value), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  function normalizePersonaMemoryEntries(entries) {
    return (Array.isArray(entries) ? entries : [])
      .map((entry) => {
        const entryId = normalizePersonaMemoryEntryId(entry?.id);
        const key = String(entry?.key || "").trim();
        const value = String(entry?.value || "").trim();
        const createdAt = String(entry?.created_at || "").trim();
        if (!entryId || !key || !value) return null;
        return { id: entryId, key, value, created_at: createdAt };
      }).filter(Boolean);
  }

  function getPersonaMemoryEntries(personaId = activePersonaId) {
    const normalizedPersonaId = normalizePersonaId(personaId);
    if (!normalizedPersonaId) return [];
    return Array.isArray(personaMemoryByPersonaId[normalizedPersonaId])
      ? personaMemoryByPersonaId[normalizedPersonaId] : [];
  }

  function setPersonaMemoryEntries(personaId, entries) {
    const normalizedPersonaId = normalizePersonaId(personaId);
    if (!normalizedPersonaId) return [];
    const normalizedEntries = normalizePersonaMemoryEntries(entries);
    personaMemoryByPersonaId[normalizedPersonaId] = normalizedEntries;
    return normalizedEntries;
  }

  function findPersonaMemoryEntryById(entryId, personaId = activePersonaId) {
    const normalizedEntryId = normalizePersonaMemoryEntryId(entryId);
    if (!normalizedEntryId) return null;
    return getPersonaMemoryEntries(personaId).find((entry) => entry.id === normalizedEntryId) || null;
  }

  function setPersonaMemoryStatus(message, tone = "muted") {
    if (!personaMemoryStatusEl) return;
    personaMemoryStatusEl.textContent = message;
    personaMemoryStatusEl.dataset.tone = tone;
  }

  function setPersonaMemoryControlsDisabled(disabled) {
    const noPersonaSelected = !normalizePersonaId(activePersonaId);
    if (personaMemoryKeyEl) personaMemoryKeyEl.disabled = disabled || noPersonaSelected;
    if (personaMemoryValueEl) personaMemoryValueEl.disabled = disabled || noPersonaSelected;
    if (personaMemorySaveBtn) personaMemorySaveBtn.disabled = disabled || noPersonaSelected;
    if (personaMemoryCancelBtn) personaMemoryCancelBtn.disabled = disabled || noPersonaSelected || !activePersonaMemoryEntryId;
    if (personaMemoryDeleteBtn) personaMemoryDeleteBtn.disabled = disabled || noPersonaSelected || !activePersonaMemoryEntryId;
  }

  function fillPersonaMemoryForm(entry) {
    if (personaMemoryKeyEl) personaMemoryKeyEl.value = String(entry?.key || "");
    if (personaMemoryValueEl) {
      personaMemoryValueEl.value = String(entry?.value || "");
      autoResize(personaMemoryValueEl);
    }
  }

  function resetPersonaMemoryEditor({ preserveStatus = false } = {}) {
    activePersonaMemoryEntryId = null;
    fillPersonaMemoryForm(null);
    if (personaMemorySaveBtn) personaMemorySaveBtn.textContent = "Save memory";
    if (personaMemoryCancelBtn) personaMemoryCancelBtn.hidden = true;
    if (personaMemoryDeleteBtn) personaMemoryDeleteBtn.hidden = true;
    if (!preserveStatus) {
      if (normalizePersonaId(activePersonaId)) {
        setPersonaMemoryStatus("Ready to add shared persona memory", "muted");
      } else {
        setPersonaMemoryStatus("Save the persona first to manage shared memory.", "muted");
      }
    }
    setPersonaMemoryControlsDisabled(isPersonaMemoryLoading);
  }

  function selectPersonaMemoryEntry(entryId) {
    const entry = findPersonaMemoryEntryById(entryId);
    if (!entry) {
      resetPersonaMemoryEditor();
      renderPersonaMemoryList();
      return;
    }
    activePersonaMemoryEntryId = entry.id;
    fillPersonaMemoryForm(entry);
    if (personaMemorySaveBtn) personaMemorySaveBtn.textContent = "Update memory";
    if (personaMemoryCancelBtn) personaMemoryCancelBtn.hidden = false;
    if (personaMemoryDeleteBtn) personaMemoryDeleteBtn.hidden = false;
    setPersonaMemoryStatus(`Editing memory: ${entry.key}`, "muted");
    renderPersonaMemoryList();
    setPersonaMemoryControlsDisabled(isPersonaMemoryLoading);
  }

  function renderPersonaMemoryList() {
    if (!personaMemoryListEl) return;
    const normalizedPersonaId = normalizePersonaId(activePersonaId);
    personaMemoryListEl.innerHTML = "";
    if (!normalizedPersonaId) {
      personaMemoryListEl.innerHTML = '<p class="settings-copy">Create or select a saved persona before editing shared persona memory.</p>';
      if (personaMemoryNoteEl) personaMemoryNoteEl.textContent = "Use this for stable persona-scoped facts shared across conversations. Stored entries are not auto-pruned.";
      return;
    }
    const entries = getPersonaMemoryEntries(normalizedPersonaId);
    if (!entries.length) {
      personaMemoryListEl.innerHTML = '<p class="settings-copy">No persona memory yet. Add short key-value entries that should follow this persona across conversations.</p>';
      if (personaMemoryNoteEl) personaMemoryNoteEl.textContent = "Use this for stable persona-scoped facts shared across conversations. Stored entries are not auto-pruned.";
      return;
    }
    if (personaMemoryNoteEl) personaMemoryNoteEl.textContent = `${entries.length} shared persona memory entr${entries.length === 1 ? "y" : "ies"} currently stored. These entries are not auto-pruned.`;
    entries.forEach((entry) => {
      const row = document.createElement("div");
      row.className = "model-management-row";
      if (entry.id === activePersonaMemoryEntryId) row.classList.add("persona-row--active");
      const meta = document.createElement("div");
      meta.className = "model-management-row__meta";
      const title = document.createElement("strong");
      title.textContent = entry.key;
      const subtitle = document.createElement("div");
      subtitle.className = "model-management-row__subtitle";
      subtitle.textContent = entry.value;
      meta.append(title, subtitle);
      const actions = document.createElement("div");
      actions.className = "settings-inline-actions";
      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "btn-ghost";
      editBtn.textContent = "Edit";
      editBtn.addEventListener("click", () => selectPersonaMemoryEntry(entry.id));
      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "btn-ghost btn-ghost--danger";
      deleteBtn.textContent = "Delete";
      deleteBtn.addEventListener("click", () => void deleteActivePersonaMemoryEntry(entry.id));
      actions.append(editBtn, deleteBtn);
      row.append(meta, actions);
      personaMemoryListEl.append(row);
    });
  }

  async function loadPersonaMemory(personaId, { force = false } = {}) {
    const normalizedPersonaId = normalizePersonaId(personaId);
    if (!normalizedPersonaId) {
      resetPersonaMemoryEditor();
      renderPersonaMemoryList();
      return [];
    }
    if (!force && Array.isArray(personaMemoryByPersonaId[normalizedPersonaId])) {
      renderPersonaMemoryList();
      if (normalizePersonaId(activePersonaId) === normalizedPersonaId) {
        const entries = getPersonaMemoryEntries(normalizedPersonaId);
        setPersonaMemoryStatus(entries.length ? "Persona memory ready" : "No persona memory yet", "muted");
      }
      setPersonaMemoryControlsDisabled(false);
      return getPersonaMemoryEntries(normalizedPersonaId);
    }
    isPersonaMemoryLoading = true;
    renderPersonaMemoryList();
    setPersonaMemoryControlsDisabled(true);
    setPersonaMemoryStatus("Loading persona memory...", "warning");
    try {
      const response = await fetch(`/api/personas/${normalizedPersonaId}/memory`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Failed to load persona memory.");
      const entries = setPersonaMemoryEntries(normalizedPersonaId, data.persona_memory);
      if (normalizePersonaId(activePersonaId) === normalizedPersonaId) {
        renderPersonaMemoryList();
        setPersonaMemoryStatus(entries.length ? "Persona memory loaded" : "No persona memory yet", "muted");
      }
      return entries;
    } catch (error) {
      if (normalizePersonaId(activePersonaId) === normalizedPersonaId) {
        setPersonaMemoryStatus(error.message || "Failed to load persona memory.", "error");
      }
      return [];
    } finally {
      isPersonaMemoryLoading = false;
      setPersonaMemoryControlsDisabled(false);
    }
  }

  async function saveActivePersonaMemoryEntry() {
    const normalizedPersonaId = normalizePersonaId(activePersonaId);
    if (!normalizedPersonaId) {
      setPersonaMemoryStatus("Save the persona first to manage shared memory.", "warning");
      return false;
    }
    const payload = {
      key: personaMemoryKeyEl?.value.trim() || "",
      value: personaMemoryValueEl?.value.trim() || "",
    };
    const isUpdate = Boolean(activePersonaMemoryEntryId);
    if (!payload.key || !payload.value) {
      setPersonaMemoryStatus("Both memory key and value are required.", "error");
      return false;
    }
    setPersonaMemoryControlsDisabled(true);
    setPersonaMemoryStatus(isUpdate ? "Updating persona memory..." : "Saving persona memory...", "warning");
    try {
      const response = await fetch(
        isUpdate ? `/api/personas/${normalizedPersonaId}/memory/${activePersonaMemoryEntryId}` : `/api/personas/${normalizedPersonaId}/memory`,
        { method: isUpdate ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Persona memory save failed.");
      setPersonaMemoryEntries(normalizedPersonaId, data.persona_memory);
      if (isUpdate && data.entry?.id) {
        selectPersonaMemoryEntry(data.entry.id);
      } else {
        resetPersonaMemoryEditor({ preserveStatus: true });
        renderPersonaMemoryList();
      }
      setPersonaMemoryStatus(isUpdate ? "Persona memory updated" : "Persona memory saved", "success");
      return true;
    } catch (error) {
      setPersonaMemoryStatus(error.message || "Persona memory save failed.", "error");
      return false;
    } finally {
      setPersonaMemoryControlsDisabled(false);
    }
  }

  async function deleteActivePersonaMemoryEntry(entryId = activePersonaMemoryEntryId) {
    const normalizedPersonaId = normalizePersonaId(activePersonaId);
    const entry = findPersonaMemoryEntryById(entryId, normalizedPersonaId);
    if (!normalizedPersonaId || !entry) {
      setPersonaMemoryStatus("Select a persona memory entry first.", "warning");
      return false;
    }
    if (!window.confirm(`Delete persona memory "${entry.key}"?`)) return false;
    setPersonaMemoryControlsDisabled(true);
    setPersonaMemoryStatus("Deleting persona memory...", "warning");
    try {
      const response = await fetch(`/api/personas/${normalizedPersonaId}/memory/${entry.id}`, { method: "DELETE", headers: { "Content-Type": "application/json" } });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Persona memory delete failed.");
      setPersonaMemoryEntries(normalizedPersonaId, data.persona_memory);
      resetPersonaMemoryEditor({ preserveStatus: true });
      renderPersonaMemoryList();
      setPersonaMemoryStatus(`Deleted persona memory: ${entry.key}`, "success");
      return true;
    } catch (error) {
      setPersonaMemoryStatus(error.message || "Persona memory delete failed.", "error");
      return false;
    } finally {
      setPersonaMemoryControlsDisabled(false);
    }
  }

  // ─── Persona UI ──────────────────────────────────────────────────────────────
  function renderDefaultPersonaSelect() {
    if (!defaultPersonaEl) return;
    const selectedDefaultPersonaId = normalizePersonaId(appSettings.default_persona_id);
    const fragment = document.createDocumentFragment();
    const emptyOption = document.createElement("option");
    emptyOption.value = "";
    emptyOption.textContent = "No default persona";
    fragment.append(emptyOption);
    getPersonas().forEach((persona) => {
      const option = document.createElement("option");
      option.value = String(persona.id);
      option.textContent = String(persona.name || `Persona ${persona.id}`).trim() || `Persona ${persona.id}`;
      fragment.append(option);
    });
    defaultPersonaEl.replaceChildren(fragment);
    defaultPersonaEl.value = selectedDefaultPersonaId ? String(selectedDefaultPersonaId) : "";
  }

  function fillPersonaForm(persona) {
    if (personaNameEl) personaNameEl.value = String(persona?.name || "");
    if (generalInstructionsEl) {
      generalInstructionsEl.value = String(persona?.general_instructions || "");
      autoResize(generalInstructionsEl);
    }
    if (aiPersonalityEl) {
      aiPersonalityEl.value = String(persona?.ai_personality || "");
      autoResize(aiPersonalityEl);
    }
  }

  function selectPersonaForEditing(personaId) {
    activePersonaId = normalizePersonaId(personaId);
    const persona = findPersonaById(activePersonaId);
    if (persona) {
      if (personaEditorTitleEl) personaEditorTitleEl.textContent = `Edit ${persona.name}`;
      if (personaSaveBtn) personaSaveBtn.textContent = "Save persona";
      if (personaDeleteBtn) personaDeleteBtn.hidden = false;
      fillPersonaForm(persona);
      setPersonaStatus(`Editing ${persona.name}`, "muted");
    } else {
      activePersonaId = null;
      if (personaEditorTitleEl) personaEditorTitleEl.textContent = "Create persona";
      if (personaSaveBtn) personaSaveBtn.textContent = "Create persona";
      if (personaDeleteBtn) personaDeleteBtn.hidden = true;
      fillPersonaForm(null);
      setPersonaStatus("Ready to create a persona", "muted");
    }
    clearPersonaDirty();
    renderPersonaList();
    setPersonaActionsDisabled(false);
    resetPersonaMemoryEditor({ preserveStatus: true });
    renderPersonaMemoryList();
    if (activePersonaId) {
      setPersonaMemoryStatus("Loading persona memory...", "warning");
      void loadPersonaMemory(activePersonaId);
    } else {
      setPersonaMemoryStatus("Save the persona first to manage shared memory.", "muted");
      setPersonaMemoryControlsDisabled(true);
    }
  }

  function renderPersonaList() {
    if (!personaListEl) return;
    const personas = getPersonas();
    personaListEl.innerHTML = "";
    if (!personas.length) {
      personaListEl.innerHTML = '<p class="settings-copy">No personas yet. Create one to define persistent tone and behavior.</p>';
      return;
    }
    const defaultPersonaId = normalizePersonaId(appSettings.default_persona_id);
    personas.forEach((persona) => {
      const row = document.createElement("div");
      row.className = "model-management-row";
      if (normalizePersonaId(persona.id) === activePersonaId) row.classList.add("persona-row--active");
      const meta = document.createElement("div");
      meta.className = "model-management-row__meta";
      const title = document.createElement("strong");
      title.textContent = String(persona.name || `Persona ${persona.id}`).trim() || `Persona ${persona.id}`;
      const subtitle = document.createElement("div");
      subtitle.className = "model-management-row__subtitle";
      subtitle.textContent = describePersona(persona);
      meta.append(title, subtitle);
      const badges = document.createElement("div");
      badges.className = "model-management-row__badges";
      if (normalizePersonaId(persona.id) === defaultPersonaId) {
        const badge = document.createElement("span");
        badge.className = "model-management-badge";
        badge.textContent = "Default";
        badges.append(badge);
      }
      if (badges.childElementCount) meta.append(badges);
      const actions = document.createElement("div");
      actions.className = "settings-inline-actions";
      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "btn-ghost";
      editBtn.textContent = "Edit";
      editBtn.addEventListener("click", () => {
        if (hasUnsavedPersonaChanges && normalizePersonaId(persona.id) !== activePersonaId && !window.confirm("Discard unsaved persona changes?")) return;
        selectPersonaForEditing(persona.id);
      });
      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "btn-ghost btn-ghost--danger";
      deleteBtn.textContent = "Delete";
      deleteBtn.addEventListener("click", () => {
        if (hasUnsavedPersonaChanges && normalizePersonaId(persona.id) !== activePersonaId && !window.confirm("Discard unsaved persona changes?")) return;
        selectPersonaForEditing(persona.id);
        void deleteActivePersona();
      });
      actions.append(editBtn, deleteBtn);
      row.append(meta, actions);
      personaListEl.append(row);
    });
  }

  function applyPersonaResponseData(data, { preserveSelection = true } = {}) {
    appSettings.personas = Array.isArray(data?.personas) ? data.personas : [];
    appSettings.default_persona_id = normalizePersonaId(data?.default_persona_id);
    const availablePersonaIds = new Set(
      getPersonas().map((persona) => normalizePersonaId(persona?.id)).filter(Boolean)
    );
    Object.keys(personaMemoryByPersonaId).forEach((personaId) => {
      if (!availablePersonaIds.has(normalizePersonaId(personaId))) delete personaMemoryByPersonaId[personaId];
    });
    renderDefaultPersonaSelect();
    const responsePersonaId = normalizePersonaId(data?.persona?.id);
    const nextPersonaId = responsePersonaId || (preserveSelection ? activePersonaId : null);
    if (nextPersonaId && findPersonaById(nextPersonaId)) {
      selectPersonaForEditing(nextPersonaId);
      return;
    }
    if (getPersonas().length) {
      selectPersonaForEditing(getPersonas()[0].id);
      return;
    }
    selectPersonaForEditing(null);
  }

  function collectPersonaFormPayload() {
    return {
      name: personaNameEl?.value.trim() || "",
      general_instructions: generalInstructionsEl?.value.trim() || "",
      ai_personality: aiPersonalityEl?.value.trim() || "",
    };
  }

  async function saveActivePersona() {
    const payload = collectPersonaFormPayload();
    const isUpdate = Boolean(activePersonaId);
    if (!payload.name) {
      setPersonaStatus("Persona name is required.", "error");
      return false;
    }
    setPersonaActionsDisabled(true);
    setPersonaStatus(isUpdate ? "Saving persona..." : "Creating persona...", "warning");
    try {
      const response = await fetch(activePersonaId ? `/api/personas/${activePersonaId}` : "/api/personas", {
        method: isUpdate ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Persona save failed.");
      applyPersonaResponseData(data, { preserveSelection: false });
      clearPersonaDirty();
      setPersonaStatus(isUpdate ? "Persona saved" : "Persona created", "success");
      return true;
    } catch (error) {
      setPersonaStatus(error.message || "Persona save failed.", "error");
      return false;
    } finally {
      setPersonaActionsDisabled(false);
    }
  }

  async function deleteActivePersona() {
    const persona = findPersonaById(activePersonaId);
    if (!persona) {
      setPersonaStatus("Select a persona first.", "warning");
      return false;
    }
    if (!window.confirm(`Delete persona "${persona.name}"?`)) return false;
    setPersonaActionsDisabled(true);
    setPersonaStatus("Deleting persona...", "warning");
    try {
      const response = await fetch(`/api/personas/${persona.id}`, { method: "DELETE", headers: { "Content-Type": "application/json" } });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Persona delete failed.");
      applyPersonaResponseData(data, { preserveSelection: false });
      clearPersonaDirty();
      setPersonaStatus(`${persona.name} deleted`, "success");
      return true;
    } catch (error) {
      setPersonaStatus(error.message || "Persona delete failed.", "error");
      return false;
    } finally {
      setPersonaActionsDisabled(false);
    }
  }

  // ─── Event listeners ──────────────────────────────────────────────────────────
  personaNameEl?.addEventListener("input", markPersonaDirty);
  generalInstructionsEl?.addEventListener("input", () => { autoResize(generalInstructionsEl); markPersonaDirty(); });
  aiPersonalityEl?.addEventListener("input", () => { autoResize(aiPersonalityEl); markPersonaDirty(); });
  defaultPersonaEl?.addEventListener("change", () => { if (typeof window.markDirty === "function") markDirty(); });
  generalInstructionsTemplateApplyBtn?.addEventListener("click", () => applyBehaviorTemplate(generalInstructionsTemplateSelectEl, generalInstructionsEl, window.__settingsCore?.GENERAL_INSTRUCTION_TEMPLATES || []));
  aiPersonalityTemplateApplyBtn?.addEventListener("click", () => applyBehaviorTemplate(aiPersonalityTemplateSelectEl, aiPersonalityEl, window.__settingsCore?.AI_PERSONALITY_TEMPLATES || []));
  openPersonasTabBtn?.addEventListener("click", () => window.__settingsTabs?.activateTab?.("personas"));
  personaNewBtn?.addEventListener("click", () => {
    if (hasUnsavedPersonaChanges && !window.confirm("Discard unsaved persona changes?")) return;
    selectPersonaForEditing(null);
  });
  personaSaveBtn?.addEventListener("click", () => void saveActivePersona());
  personaDeleteBtn?.addEventListener("click", () => void deleteActivePersona());
  personaMemoryValueEl?.addEventListener("input", () => autoResize(personaMemoryValueEl));
  personaMemorySaveBtn?.addEventListener("click", () => void saveActivePersonaMemoryEntry());
  personaMemoryCancelBtn?.addEventListener("click", () => { resetPersonaMemoryEditor(); renderPersonaMemoryList(); });
  personaMemoryDeleteBtn?.addEventListener("click", () => void deleteActivePersonaMemoryEntry());

  // ─── Initialization ──────────────────────────────────────────────────────────
  initializeAssistantBehaviorTemplates();

  // Export for use by other modules / settings.js core
  window.__personaModule = {
    renderDefaultPersonaSelect,
    renderPersonaList,
    getPersonas,
    findPersonaById,
    getActivePersonaId,
    selectPersonaForEditing,
    applyPersonaResponseData,
    collectPersonaFormPayload,
    saveActivePersona,
    deleteActivePersona,
    hasUnsavedPersonaChanges: () => hasUnsavedPersonaChanges,
    clearPersonaDirty,
  };
})();
