// Settings models — thin facade delegating to __customModelsModule
// Sub-agent fallback rows (sub_agent key) are managed here since __customModelsModule
// only handles the four base operation keys.
(function () {
  "use strict";

  if (!document.getElementById("chat-model-visibility-list")) return;

  // ─── Sub-agent state (only sub_agent key — others delegate to __customModelsModule) ───
  let draftOperationFallbackRows = {};
  let fallbackRowSequence = 0;

  const OPERATION_SUB_AGENT_KEYS = ["sub_agent"];

  // ─── Sub-agent fallback helpers ─────────────────────────────────────────────────
  function createOperationFallbackRow(modelId = "") {
    return { id: `operation-fallback-${fallbackRowSequence += 1}`, modelId: String(modelId || "").trim() };
  }

  function normalizeOperationFallbackRows(rawValue) {
    if (Array.isArray(rawValue)) return rawValue.map((modelId) => createOperationFallbackRow(modelId));
    if (typeof rawValue === "string" && rawValue.trim()) return [createOperationFallbackRow(rawValue)];
    return [];
  }

  function initializeOperationFallbackDraftRows(rawPreferences) {
    // Delegate base keys to __customModelsModule, handle sub_agent locally
    window.__customModelsModule?.initializeOperationFallbackDraftRows?.(rawPreferences);
    const preferences = rawPreferences && typeof rawPreferences === "object" ? rawPreferences : {};
    draftOperationFallbackRows = { sub_agent: normalizeOperationFallbackRows(preferences.sub_agent) };
  }

  function getDraftOperationFallbackRows(operationKey) {
    if (operationKey === "sub_agent") {
      return Array.isArray(draftOperationFallbackRows.sub_agent) ? draftOperationFallbackRows.sub_agent : [];
    }
    return window.__customModelsModule?.getDraftOperationFallbackRows?.(operationKey) ?? [];
  }

  function addOperationFallbackRow(operationKey, modelId = "") {
    if (operationKey === "sub_agent") {
      const rows = [...getDraftOperationFallbackRows("sub_agent"), createOperationFallbackRow(modelId)];
      draftOperationFallbackRows = { ...draftOperationFallbackRows, sub_agent: rows };
      renderSubAgentFallbackList();
      window.__settingsCore?.markDirty();
      return;
    }
    window.__customModelsModule?.addOperationFallbackRow?.(operationKey, modelId);
  }

  function removeOperationFallbackRow(operationKey, rowId) {
    if (operationKey === "sub_agent") {
      const rows = getDraftOperationFallbackRows("sub_agent").filter((row) => row.id !== rowId);
      draftOperationFallbackRows = { ...draftOperationFallbackRows, sub_agent: rows };
      renderSubAgentFallbackList();
      window.__settingsCore?.markDirty();
      return;
    }
    window.__customModelsModule?.removeOperationFallbackRow?.(operationKey, rowId);
  }

  function moveOperationFallbackRow(operationKey, rowIndex, direction) {
    if (operationKey === "sub_agent") {
      const rows = [...getDraftOperationFallbackRows("sub_agent")];
      const nextIndex = rowIndex + direction;
      if (nextIndex < 0 || nextIndex >= rows.length) return;
      const [row] = rows.splice(rowIndex, 1);
      rows.splice(nextIndex, 0, row);
      draftOperationFallbackRows = { ...draftOperationFallbackRows, sub_agent: rows };
      renderSubAgentFallbackList();
      window.__settingsCore?.markDirty();
      return;
    }
    window.__customModelsModule?.moveOperationFallbackRow?.(operationKey, rowIndex, direction);
  }

  function setOperationFallbackRowModel(operationKey, rowId, modelId) {
    if (operationKey === "sub_agent") {
      const rows = getDraftOperationFallbackRows("sub_agent").map((row) => (
        row.id === rowId ? { ...row, modelId: String(modelId || "").trim() } : row
      ));
      draftOperationFallbackRows = { ...draftOperationFallbackRows, sub_agent: rows };
      window.__settingsCore?.markDirty();
      return;
    }
    window.__customModelsModule?.setOperationFallbackRowModel?.(operationKey, rowId, modelId);
  }

  function getSubAgentFallbackControlMap() {
    return {
      sub_agent: {
        listEl: document.getElementById("sub-agent-model-fallback-list"),
        addBtn: document.getElementById("sub-agent-model-fallback-add-btn"),
      },
    };
  }

  function renderSubAgentFallbackList() {
    const controls = getSubAgentFallbackControlMap().sub_agent;
    if (!controls?.listEl) return;
    const listEl = controls.listEl;
    const rows = getDraftOperationFallbackRows("sub_agent");
    listEl.replaceChildren();
    if (!rows.length) {
      const emptyState = document.createElement("p");
      emptyState.className = "settings-copy";
      emptyState.textContent = "No fallback models added yet.";
      listEl.append(emptyState);
      return;
    }
    rows.forEach((rowState, index) => {
      const row = document.createElement("div");
      row.className = "model-management-row";
      const select = document.createElement("select");
      select.className = "settings-select";
      window.__customModelsModule?.populateOperationModelSelect?.(select, rowState.modelId, "Use built-in fallback");
      if (select.value !== rowState.modelId) rowState.modelId = select.value;
      select.addEventListener("change", () => setOperationFallbackRowModel("sub_agent", rowState.id, select.value));
      const actions = document.createElement("div");
      actions.className = "settings-inline-actions";
      const upBtn = document.createElement("button");
      upBtn.type = "button"; upBtn.className = "btn-ghost"; upBtn.textContent = "Up";
      upBtn.disabled = index === 0;
      upBtn.addEventListener("click", () => moveOperationFallbackRow("sub_agent", index, -1));
      const downBtn = document.createElement("button");
      downBtn.type = "button"; downBtn.className = "btn-ghost"; downBtn.textContent = "Down";
      downBtn.disabled = index === rows.length - 1;
      downBtn.addEventListener("click", () => moveOperationFallbackRow("sub_agent", index, 1));
      const removeBtn = document.createElement("button");
      removeBtn.type = "button"; removeBtn.className = "btn-ghost btn-ghost--danger"; removeBtn.textContent = "Remove";
      removeBtn.addEventListener("click", () => removeOperationFallbackRow("sub_agent", rowState.id));
      actions.append(upBtn, downBtn, removeBtn);
      row.append(select, actions);
      listEl.append(row);
    });
  }

  function renderSubAgentFallbackLists() {
    renderSubAgentFallbackList();
  }

  function getOperationModelFallbackPreferencesDraft() {
    const base = window.__customModelsModule?.getOperationModelFallbackPreferencesDraft?.() ?? {};
    const subAgentRows = getDraftOperationFallbackRows("sub_agent")
      .map((row) => String(row.modelId || "").trim())
      .filter((modelId) => Boolean(modelId));
    return { ...base, sub_agent: [...new Set(subAgentRows)] };
  }

  function renderOperationFallbackLists() {
    window.__customModelsModule?.renderOperationFallbackLists?.();
    renderSubAgentFallbackList();
  }

  // ─── Main render — delegates to __customModelsModule, adds sub_agent list ───
  function renderModelManagementPanels({ preferVisibleId = "", operationPreferences = null } = {}) {
    window.__customModelsModule?.renderModelManagementPanels?.({ preferVisibleId, operationPreferences });
    renderSubAgentFallbackList();
  }

  // ─── Status helper ───────────────────────────────────────────────────────────
  function setCustomModelStatus(message, tone = "muted") {
    const customModelStatusEl = document.getElementById("custom-model-status");
    if (!customModelStatusEl) return;
    customModelStatusEl.textContent = message;
    customModelStatusEl.dataset.tone = tone;
  }

  // ─── Visible model order (delegated) ─────────────────────────────────────────
  function getDraftVisibleModelOrder() {
    return window.__customModelsModule?.getDraftVisibleModelOrder?.() ?? [];
  }

  // ─── Export ──────────────────────────────────────────────────────────────────
  window.__settingsModels = {
    initializeOperationFallbackDraftRows,
    getDraftOperationFallbackRows,
    addOperationFallbackRow,
    removeOperationFallbackRow,
    moveOperationFallbackRow,
    setOperationFallbackRowModel,
    renderOperationFallbackList: () => { window.__customModelsModule?.renderOperationFallbackList?.(...arguments); renderSubAgentFallbackList(); },
    renderOperationFallbackLists,
    getOperationModelFallbackPreferencesDraft,
    renderModelManagementPanels,
    syncImageHelperModelVisibility,
    setCustomModelStatus,
    getDraftVisibleModelOrder,
    renderSubAgentFallbackList,
    getSubAgentFallbackControlMap,
  };
})();
