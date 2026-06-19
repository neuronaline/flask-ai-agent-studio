// Scratchpad management — loaded on /settings page only
(function () {
  // ─── DOM refs ────────────────────────────────────────────────────────────────
  const scratchpadListEl = document.getElementById("scratchpad-list");
  const scratchpadAddBtn = document.getElementById("scratchpad-add-btn");
  const scratchpadCountEl = document.getElementById("scratchpad-count");
  const scratchpadReadonlyNoteEl = document.getElementById("scratchpad-readonly-note");

  if (!scratchpadListEl) return; // panel not in DOM

  // ─── Constants ───────────────────────────────────────────────────────────────
  const DEFAULT_SCRATCHPAD_SECTION_ID = "notes";
  const DEFAULT_SCRATCHPAD_SECTION_ORDER = window.__settingsCore?.DEFAULT_SCRATCHPAD_SECTION_ORDER || ["lessons", "profile", "notes", "problems", "tasks", "preferences", "domain"];
  const DEFAULT_SCRATCHPAD_SECTION_META = {
    lessons: { title: "Lessons Learned", description: "Reliable takeaways, postmortems, and patterns that should change future decisions." },
    profile: { title: "User Profile & Mindset", description: "Durable clues about how the user thinks, decides, and frames problems." },
    notes: { title: "General Notes", description: "Durable general uncategorized context that does not fit the other sections." },
    problems: { title: "Open Problems", description: "Recurring or durable unresolved issues worth revisiting across conversations." },
    tasks: { title: "In-Progress Tasks", description: "Longer-running cross-conversation workstreams the assistant should preserve continuity on." },
    preferences: { title: "User Preferences", description: "Stable language, formatting, and collaboration preferences." },
    domain: { title: "Domain Facts", description: "Durable facts about the user's stack, systems, or technical domain." },
  };

  // ─── State ──────────────────────────────────────────────────────────────────
  const appSettings = window.__appSettings || {};

  // ─── Helpers ────────────────────────────────────────────────────────────────
  function normalizeScratchpadNote(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function normalizeScratchpadNotesList(values) {
    const notes = [];
    const seen = new Set();
    for (const value of Array.isArray(values) ? values : []) {
      const note = normalizeScratchpadNote(value);
      if (!note || seen.has(note)) continue;
      seen.add(note);
      notes.push(note);
    }
    return notes;
  }

  function splitScratchpadContent(value) {
    return normalizeScratchpadNotesList(
      String(value || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n")
    );
  }

  function getScratchpadSectionPayloads() {
    const serverSections = appSettings.scratchpad_sections && typeof appSettings.scratchpad_sections === "object"
      ? appSettings.scratchpad_sections : {};
    return DEFAULT_SCRATCHPAD_SECTION_ORDER.map((sectionId) => {
      const fallback = DEFAULT_SCRATCHPAD_SECTION_META[sectionId] || { title: sectionId, description: "" };
      const rawSection = serverSections[sectionId];
      const isObjectSection = rawSection && typeof rawSection === "object";
      return {
        id: sectionId,
        title: String(isObjectSection ? (rawSection.title || fallback.title || sectionId) : (fallback.title || sectionId)),
        description: String(isObjectSection ? (rawSection.description || fallback.description || "") : (fallback.description || "")),
        content: String(isObjectSection ? rawSection.content : (typeof rawSection === "string" ? rawSection : "")),
        note_count: isObjectSection && Number.isFinite(rawSection.note_count) ? rawSection.note_count : 0,
      };
    });
  }

  function getScratchpadSectionsFromSettings() {
    const sections = {};
    getScratchpadSectionPayloads().forEach((section) => {
      sections[section.id] = splitScratchpadContent(section.content);
    });
    if (!Object.values(sections).some((notes) => notes.length)) {
      sections[DEFAULT_SCRATCHPAD_SECTION_ID] = splitScratchpadContent(appSettings.scratchpad || "");
    }
    return sections;
  }

  function flattenScratchpadSections(sectionMap) {
    const flattened = [];
    DEFAULT_SCRATCHPAD_SECTION_ORDER.forEach((sectionId) => {
      const notes = Array.isArray(sectionMap?.[sectionId]) ? sectionMap[sectionId] : [];
      flattened.push(...notes);
    });
    return flattened;
  }

  function readScratchpadNotesFromSection(sectionId) {
    if (!scratchpadListEl) return getScratchpadSectionsFromSettings()[sectionId] || [];
    const sectionEl = scratchpadListEl.querySelector(`.scratchpad-section[data-section="${sectionId}"]`);
    if (!sectionEl) return [];
    return normalizeScratchpadNotesList(
      Array.from(sectionEl.querySelectorAll(".scratchpad-note-input"), (input) => input.value)
    );
  }

  function readScratchpadSectionsFromList() {
    const sections = {};
    if (!scratchpadListEl) return getScratchpadSectionsFromSettings();
    DEFAULT_SCRATCHPAD_SECTION_ORDER.forEach((sectionId) => {
      sections[sectionId] = readScratchpadNotesFromSection(sectionId);
    });
    return sections;
  }

  function readScratchpadNotesFromList() {
    return flattenScratchpadSections(readScratchpadSectionsFromList());
  }

  function getScratchpadNotesFromSettings() {
    return flattenScratchpadSections(getScratchpadSectionsFromSettings());
  }

  function getVisibleScratchpadSections() {
    return scratchpadListEl ? readScratchpadSectionsFromList() : getScratchpadSectionsFromSettings();
  }

  function getVisibleScratchpadNotes() {
    return flattenScratchpadSections(getVisibleScratchpadSections());
  }

  function updateScratchpadCount() {
    if (!scratchpadCountEl) return;
    const count = getVisibleScratchpadNotes().length;
    scratchpadCountEl.textContent = count === 1 ? "1 note" : `${count} notes`;
  }

  function updateScratchpadSectionCount(sectionId) {
    if (!scratchpadListEl) return;
    const countEl = scratchpadListEl.querySelector(`[data-scratchpad-section-count="${sectionId}"]`);
    if (!countEl) return;
    const count = readScratchpadNotesFromSection(sectionId).length;
    countEl.textContent = count === 1 ? "1 note" : `${count} notes`;
  }

  function createScratchpadEmptyState(message = "No notes in this section yet.") {
    const emptyState = document.createElement("div");
    emptyState.className = "scratchpad-empty-state";
    emptyState.textContent = message;
    return emptyState;
  }

  function setScratchpadEmptyState(sectionListEl, message = "No notes in this section yet.") {
    if (!sectionListEl) return;
    sectionListEl.replaceChildren(createScratchpadEmptyState(message));
  }

  function createScratchpadNoteRow(sectionId, note = "") {
    const row = document.createElement("div");
    row.className = "scratchpad-note-row";
    const input = document.createElement("input");
    input.type = "text";
    input.className = "settings-text scratchpad-note-input";
    input.dataset.section = sectionId;
    input.placeholder = "One durable note";
    input.value = note;
    input.addEventListener("input", () => {
      if (typeof window.markDirty === "function") markDirty();
      updateScratchpadSectionCount(sectionId);
      updateScratchpadCount();
    });
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "btn-ghost btn-ghost--danger scratchpad-note-remove";
    removeBtn.textContent = "Remove";
    removeBtn.addEventListener("click", () => {
      const sectionListEl = row.closest("[data-scratchpad-section-list]");
      row.remove();
      if (sectionListEl && !sectionListEl.querySelector(".scratchpad-note-row")) {
        setScratchpadEmptyState(sectionListEl);
      }
      updateScratchpadSectionCount(sectionId);
      updateScratchpadCount();
      if (typeof window.markDirty === "function") markDirty();
    });
    row.append(input, removeBtn);
    return row;
  }

  function createScratchpadReadonlyRow(note = "") {
    const row = document.createElement("div");
    row.className = "scratchpad-note-static";
    row.textContent = note;
    return row;
  }

  function renderScratchpadSectionList(sectionListEl, sectionId, notes, { editable = true } = {}) {
    if (!sectionListEl) return;
    sectionListEl.replaceChildren();
    if (!Array.isArray(notes) || !notes.length) {
      setScratchpadEmptyState(sectionListEl, editable ? "No notes in this section yet. Add one when it becomes useful." : "No notes stored in this section.");
      return;
    }
    notes.forEach((note) => {
      sectionListEl.append(editable ? createScratchpadNoteRow(sectionId, note) : createScratchpadReadonlyRow(note));
    });
  }

  function createScratchpadSectionCard(section, notes, { editable = true } = {}) {
    const card = document.createElement("section");
    card.className = "scratchpad-section";
    card.dataset.section = section.id;
    const header = document.createElement("div");
    header.className = "scratchpad-section__header";
    const titleGroup = document.createElement("div");
    titleGroup.className = "scratchpad-section__title-group";
    const title = document.createElement("h4");
    title.className = "scratchpad-section__title";
    title.textContent = section.title;
    const description = document.createElement("p");
    description.className = "scratchpad-section__description";
    description.textContent = section.description;
    const count = document.createElement("span");
    count.className = "scratchpad-section__count";
    count.dataset.scratchpadSectionCount = section.id;
    count.textContent = notes.length === 1 ? "1 note" : `${notes.length} notes`;
    titleGroup.append(title, description);
    header.append(titleGroup, count);
    const sectionListEl = document.createElement("div");
    sectionListEl.className = "scratchpad-list scratchpad-list--section";
    sectionListEl.dataset.scratchpadSectionList = section.id;
    renderScratchpadSectionList(sectionListEl, section.id, notes, { editable });
    const toolbar = document.createElement("div");
    toolbar.className = "scratchpad-toolbar scratchpad-toolbar--section";
    if (editable) {
      const addBtn = document.createElement("button");
      addBtn.type = "button";
      addBtn.className = "btn-ghost scratchpad-section-add-btn";
      addBtn.dataset.section = section.id;
      addBtn.textContent = `Add to ${section.title}`;
      addBtn.addEventListener("click", () => addScratchpadNote(section.id));
      toolbar.append(addBtn);
    }
    card.append(header, sectionListEl, toolbar);
    return card;
  }

  function renderScratchpad(editable = true) {
    if (!scratchpadListEl) return;
    const sectionNotes = getScratchpadSectionsFromSettings();
    scratchpadListEl.replaceChildren();
    getScratchpadSectionPayloads().forEach((section) => {
      const notes = Array.isArray(sectionNotes[section.id]) ? sectionNotes[section.id] : [];
      scratchpadListEl.append(createScratchpadSectionCard(section, notes, { editable }));
    });
    updateScratchpadCount();
  }

  function addScratchpadNote(sectionId = DEFAULT_SCRATCHPAD_SECTION_ID, note = "") {
    if (!scratchpadListEl) return;
    const sectionEl = scratchpadListEl.querySelector(`.scratchpad-section[data-section="${sectionId}"]`);
    const sectionListEl = sectionEl?.querySelector("[data-scratchpad-section-list]");
    if (!sectionListEl) return;
    const emptyState = sectionListEl.querySelector(".scratchpad-empty-state");
    if (emptyState) emptyState.remove();
    const row = createScratchpadNoteRow(sectionId, note);
    sectionListEl.append(row);
    row.querySelector(".scratchpad-note-input")?.focus();
    updateScratchpadSectionCount(sectionId);
    updateScratchpadCount();
    if (typeof window.markDirty === "function") markDirty();
  }

  // ─── Event listeners
  scratchpadAddBtn?.addEventListener("click", () => addScratchpadNote());

  // ─── Export for use by settings.js core ──────────────────────────────────────
  window.__scratchpadModule = {
    renderScratchpad,
    addScratchpadNote,
    readScratchpadSectionsFromList,
    getVisibleScratchpadNotes,
    updateScratchpadCount,
  };
})();
