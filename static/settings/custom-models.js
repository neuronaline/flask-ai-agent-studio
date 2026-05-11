// Custom models management — loaded on /settings page only
(function () {
  // ─── DOM refs ────────────────────────────────────────────────────────────────
  const customModelNameEl = document.getElementById("custom-model-name-input");
  const customModelApiModelEl = document.getElementById("custom-model-api-model-input");
  const customModelRoutingModeEl = document.getElementById("custom-model-routing-mode-select");
  const customModelProviderFieldEl = document.getElementById("custom-model-provider-field");
  const customModelProviderSlugEl = document.getElementById("custom-model-provider-slug-input");
  const customModelReasoningModeEl = document.getElementById("custom-model-reasoning-mode-select");
  const customModelReasoningEffortEl = document.getElementById("custom-model-reasoning-effort-select");
  const customModelSupportsToolsEl = document.getElementById("custom-model-supports-tools-toggle");
  const customModelSupportsVisionEl = document.getElementById("custom-model-supports-vision-toggle");
  const customModelSupportsStructuredEl = document.getElementById("custom-model-supports-structured-toggle");
  const addCustomModelBtn = document.getElementById("add-custom-model-btn");
  const customModelCancelEditBtn = document.getElementById("custom-model-cancel-edit-btn");
  const customModelStatusEl = document.getElementById("custom-model-status");
  const customModelListEl = document.getElementById("custom-model-list");
  const chatModelVisibilityListEl = document.getElementById("chat-model-visibility-list");
  const summaryModelPreferenceEl = document.getElementById("summary-model-preference-select");
  const fetchSummarizeModelPreferenceEl = document.getElementById("fetch-summarize-model-preference-select");
  const fixTextModelPreferenceEl = document.getElementById("fix-text-model-preference-select");
  const uploadMetadataModelPreferenceEl = document.getElementById("upload-metadata-model-preference-select");
  const subAgentModelPreferenceEl = document.getElementById("sub-agent-model-preference-select");
  const chatSummaryModelEl = document.getElementById("chat-summary-model-select");
  const imageHelperModelEl = document.getElementById("image-helper-model-select");
  const summaryModelFallbackListEl = document.getElementById("summary-model-fallback-list");
  const fetchSummarizeModelFallbackListEl = document.getElementById("fetch-summarize-model-fallback-list");
  const fixTextModelFallbackListEl = document.getElementById("fix-text-model-fallback-list");
  const uploadMetadataModelFallbackListEl = document.getElementById("upload-metadata-model-fallback-list");
  const subAgentModelFallbackListEl = document.getElementById("sub-agent-model-fallback-list");
  const summaryModelFallbackAddBtn = document.getElementById("summary-model-fallback-add-btn");
  const fetchSummarizeModelFallbackAddBtn = document.getElementById("fetch-summarize-model-fallback-add-btn");
  const fixTextModelFallbackAddBtn = document.getElementById("fix-text-model-fallback-add-btn");
  const uploadMetadataModelFallbackAddBtn = document.getElementById("upload-metadata-model-fallback-add-btn");
  const subAgentModelFallbackAddBtn = document.getElementById("sub-agent-model-fallback-add-btn");

  if (!customModelListEl) return; // panel not in DOM

  // ─── Constants ───────────────────────────────────────────────────────────────
  const MODEL_PROVIDER_LABELS = {
    deepseek: "DeepSeek",
    openrouter: "OpenRouter",
  };

  // ─── State ──────────────────────────────────────────────────────────────────
  const appSettings = window.__appSettings || {};
  let draftCustomModels = Array.isArray(appSettings.custom_models)
    ? appSettings.custom_models.map((model) => normalizeDraftCustomModel(model)) : [];
  let draftChatModelRows = [];
  let draftOperationFallbackRows = {};
  let fallbackRowSequence = 0;
  let customModelClientUidSequence = 0;
  let editingCustomModelClientUid = null;

  const OPERATION_MODEL_KEYS = ["summarize", "fetch_summarize", "fix_text", "upload_metadata"];
  const OPERATION_FALLBACK_CONTROL_MAP = {
    summarize: { listEl: summaryModelFallbackListEl, addBtn: summaryModelFallbackAddBtn },
    fetch_summarize: { listEl: fetchSummarizeModelFallbackListEl, addBtn: fetchSummarizeModelFallbackAddBtn },
    fix_text: { listEl: fixTextModelFallbackListEl, addBtn: fixTextModelFallbackAddBtn },
    upload_metadata: { listEl: uploadMetadataModelFallbackListEl, addBtn: uploadMetadataModelFallbackAddBtn },
  };

  // ─── Helpers ────────────────────────────────────────────────────────────────
  function getCustomModelContract() {
    const contract = appSettings.custom_model_contract && typeof appSettings.custom_model_contract === "object"
      ? appSettings.custom_model_contract : {};
    return {
      provider: String(contract.provider || "openrouter"),
      model_prefix: String(contract.model_prefix || "openrouter:"),
      client_uid_prefix: String(contract.client_uid_prefix || "draft-custom-model:"),
      variant_separator: String(contract.variant_separator || "@@"),
      variant_part_separator: String(contract.variant_part_separator || ";"),
      variant_key_value_separator: String(contract.variant_key_value_separator || "="),
      provider_slug_pattern: String(contract.provider_slug_pattern || "^[a-z0-9][a-z0-9._/-]{0,199}$"),
      reasoning_modes: Array.isArray(contract.reasoning_modes) && contract.reasoning_modes.length
        ? contract.reasoning_modes.map((value) => String(value)) : ["default", "enabled", "disabled"],
      reasoning_efforts: Array.isArray(contract.reasoning_efforts) && contract.reasoning_efforts.length
        ? contract.reasoning_efforts.map((value) => String(value)) : ["minimal", "low", "medium", "high", "xhigh"],
    };
  }

  const builtinModelCatalog = Array.isArray(appSettings.available_models)
    ? appSettings.available_models.filter((model) => !Boolean(model?.is_custom)) : [];

  function setCustomModelStatus(message, tone = "muted") {
    if (!customModelStatusEl) return;
    customModelStatusEl.textContent = message;
    customModelStatusEl.dataset.tone = tone;
  }

  function normalizeOpenRouterApiModel(value) {
    const rawValue = String(value || "").trim();
    if (!rawValue) return "";
    const { model_prefix: modelPrefix } = getCustomModelContract();
    if (rawValue.startsWith(modelPrefix)) return rawValue.slice(modelPrefix.length).replace(/^\/+/, "").trim();
    return rawValue.replace(/^\/+/, "").trim();
  }

  function splitOpenRouterModelId(value) {
    const normalizedValue = normalizeOpenRouterApiModel(value);
    if (!normalizedValue) return { apiModel: "", variantSuffix: "" };
    const { variant_separator: variantSeparator } = getCustomModelContract();
    const separatorIndex = normalizedValue.indexOf(variantSeparator);
    if (separatorIndex < 0) return { apiModel: normalizedValue, variantSuffix: "" };
    return {
      apiModel: normalizedValue.slice(0, separatorIndex),
      variantSuffix: normalizedValue.slice(separatorIndex + variantSeparator.length),
    };
  }

  function parseOpenRouterModelVariantSuffix(value) {
    const { variant_part_separator: variantPartSeparator, variant_key_value_separator: variantKeyValueSeparator } = getCustomModelContract();
    const parsed = { reasoning_mode: "default", reasoning_effort: "", provider_slug: "", supports_tools: undefined, supports_vision: undefined, supports_structured_outputs: undefined };
    const rawValue = String(value || "").trim();
    if (!rawValue) return parsed;
    rawValue.split(variantPartSeparator).forEach((part) => {
      const sepIdx = part.indexOf(variantKeyValueSeparator);
      if (sepIdx < 0) return;
      const key = part.slice(0, sepIdx).trim().toLowerCase();
      const partValue = part.slice(sepIdx + 1).trim();
      if (!partValue) return;
      if (key === "r") {
        const [modeValue, effortValue = ""] = partValue.split(":", 2);
        const reasoning = normalizeOpenRouterReasoningConfig(modeValue, effortValue);
        parsed.reasoning_mode = reasoning.mode;
        parsed.reasoning_effort = reasoning.effort;
      } else if (key === "p") {
        parsed.provider_slug = normalizeOpenRouterProviderSlug(partValue);
      } else if (key === "t") {
        parsed.supports_tools = !["0", "false", "no", "off"].includes(partValue.toLowerCase());
      } else if (key === "v") {
        parsed.supports_vision = ["1", "true", "yes", "on"].includes(partValue.toLowerCase());
      } else if (key === "s") {
        parsed.supports_structured_outputs = ["1", "true", "yes", "on"].includes(partValue.toLowerCase());
      }
    });
    return parsed;
  }

  function normalizeOpenRouterProviderSlug(value) {
    const rawValue = String(value || "").trim().replace(/^\/+|\/+$/g, "").toLowerCase();
    if (!rawValue) return "";
    try {
      const pattern = new RegExp(getCustomModelContract().provider_slug_pattern);
      return pattern.test(rawValue) ? rawValue : "";
    } catch {
      return /^[a-z0-9][a-z0-9._/-]{0,199}$/.test(rawValue) ? rawValue : "";
    }
  }

  function normalizeOpenRouterReasoningMode(value) {
    const { reasoning_modes: reasoningModes } = getCustomModelContract();
    const fallbackMode = reasoningModes.includes("default") ? "default" : (reasoningModes[0] || "default");
    if (typeof value === "boolean") {
      const boolMode = value ? "enabled" : "disabled";
      return reasoningModes.includes(boolMode) ? boolMode : fallbackMode;
    }
    const rawValue = String(value || "").trim().toLowerCase();
    if (["enabled", "1", "true", "yes", "on"].includes(rawValue)) return reasoningModes.includes("enabled") ? "enabled" : fallbackMode;
    if (["disabled", "0", "false", "no", "off"].includes(rawValue)) return reasoningModes.includes("disabled") ? "disabled" : fallbackMode;
    return reasoningModes.includes(rawValue) ? rawValue : fallbackMode;
  }

  function normalizeOpenRouterReasoningEffort(value) {
    const rawValue = String(value || "").trim().toLowerCase();
    return getCustomModelContract().reasoning_efforts.includes(rawValue) ? rawValue : "";
  }

  function normalizeOpenRouterReasoningConfig(modeValue, effortValue) {
    const rawEffort = String(effortValue || "").trim().toLowerCase();
    if (rawEffort === "none") return { mode: "disabled", effort: "" };
    let mode = normalizeOpenRouterReasoningMode(modeValue);
    let effort = normalizeOpenRouterReasoningEffort(rawEffort);
    if (mode === "default" && effort) mode = "enabled";
    if (mode !== "enabled") effort = "";
    return { mode, effort };
  }

  function normalizeCustomModelClientUid(value) {
    const rawValue = String(value || "").trim();
    if (!rawValue) return "";
    const { client_uid_prefix: clientUidPrefix } = getCustomModelContract();
    return rawValue.startsWith(clientUidPrefix) ? rawValue : "";
  }

  function createCustomModelClientUid() {
    const { client_uid_prefix: clientUidPrefix } = getCustomModelContract();
    customModelClientUidSequence += 1;
    return `${clientUidPrefix}${customModelClientUidSequence}`;
  }

  function getDraftCustomModelReference(model) {
    return String(model?.client_uid || model?.id || "").trim();
  }

  function getDraftCustomModelSignature(model) {
    const normalizedModel = normalizeDraftCustomModel(model);
    return JSON.stringify({
      api_model: String(normalizedModel?.api_model || ""),
      provider_slug: String(normalizedModel?.provider_slug || ""),
      reasoning_mode: String(normalizedModel?.reasoning_mode || "default"),
      reasoning_effort: String(normalizedModel?.reasoning_effort || ""),
      supports_tools: Boolean(normalizedModel?.supports_tools ?? true),
      supports_vision: Boolean(normalizedModel?.supports_vision ?? false),
      supports_structured_outputs: Boolean(normalizedModel?.supports_structured_outputs ?? false),
    });
  }

  function normalizeDraftCustomModel(model) {
    const persistedModelId = String(model?.id || "").trim();
    const explicitApiModel = normalizeOpenRouterApiModel(model?.api_model || model?.model || "");
    const shouldParseLegacyIdentity = (
      !explicitApiModel || model?.reasoning_mode === undefined || model?.reasoning_enabled === undefined
      || model?.reasoning_effort === undefined || model?.provider_slug === undefined || model?.openrouter_provider === undefined
      || model?.supports_tools === undefined || model?.supports_vision === undefined || model?.supports_structured_outputs === undefined
    );
    const parsedIdentity = shouldParseLegacyIdentity
      ? splitOpenRouterModelId(model?.id || model?.api_model || model?.model || "") : { apiModel: "", variantSuffix: "" };
    const parsedVariant = shouldParseLegacyIdentity ? parseOpenRouterModelVariantSuffix(parsedIdentity.variantSuffix) : {};
    const apiModel = explicitApiModel || normalizeOpenRouterApiModel(parsedIdentity.apiModel || "");
    const reasoning = normalizeOpenRouterReasoningConfig(
      model?.reasoning_mode ?? model?.reasoning_enabled ?? parsedVariant.reasoning_mode,
      model?.reasoning_effort ?? parsedVariant.reasoning_effort
    );
    const providerSlug = normalizeOpenRouterProviderSlug(model?.provider_slug || model?.openrouter_provider || parsedVariant.provider_slug || "");
    const supportsTools = model?.supports_tools !== undefined ? Boolean(model.supports_tools) : (parsedVariant.supports_tools ?? true);
    const supportsVision = model?.supports_vision !== undefined ? Boolean(model.supports_vision) : (parsedVariant.supports_vision ?? false);
    const supportsStructuredOutputs = model?.supports_structured_outputs !== undefined
      ? Boolean(model.supports_structured_outputs) : (parsedVariant.supports_structured_outputs ?? false);
    const clientUid = normalizeCustomModelClientUid(model?.client_uid) || persistedModelId || createCustomModelClientUid();
    return {
      ...model,
      id: persistedModelId,
      client_uid: clientUid,
      name: String(model?.name || apiModel || persistedModelId || clientUid).trim() || apiModel || persistedModelId || clientUid,
      provider: String(model?.provider || getCustomModelContract().provider || "openrouter"),
      api_model: apiModel,
      provider_slug: providerSlug,
      reasoning_mode: reasoning.mode,
      reasoning_effort: reasoning.effort,
      supports_tools: supportsTools,
      supports_vision: supportsVision,
      supports_structured_outputs: supportsStructuredOutputs,
      is_custom: true,
    };
  }

  function serializeDraftCustomModel(model) {
    const normalizedModel = normalizeDraftCustomModel(model);
    return {
      client_uid: getDraftCustomModelReference(normalizedModel),
      name: String(normalizedModel?.name || normalizedModel?.api_model || "").trim(),
      api_model: String(normalizedModel?.api_model || "").trim(),
      provider_slug: String(normalizedModel?.provider_slug || "").trim(),
      reasoning_mode: String(normalizedModel?.reasoning_mode || "default"),
      reasoning_effort: String(normalizedModel?.reasoning_effort || "").trim(),
      supports_tools: Boolean(normalizedModel?.supports_tools ?? true),
      supports_vision: Boolean(normalizedModel?.supports_vision ?? false),
      supports_structured_outputs: Boolean(normalizedModel?.supports_structured_outputs ?? false),
    };
  }

  function getCustomModelReasoningLabel(model) {
    if (model?.reasoning_mode === "disabled") return "reasoning off";
    if (model?.reasoning_mode === "enabled") return model?.reasoning_effort ? `reasoning ${model.reasoning_effort}` : "reasoning on";
    return "reasoning default";
  }

  function syncCustomModelReasoningControls() {
    if (!customModelReasoningModeEl || !customModelReasoningEffortEl) return;
    customModelReasoningEffortEl.disabled = customModelReasoningModeEl.value !== "enabled";
  }

  function syncCustomModelProviderControls() {
    const routingMode = customModelRoutingModeEl?.value || "auto";
    const specificProviderEnabled = routingMode === "specific";
    if (customModelProviderFieldEl) customModelProviderFieldEl.hidden = !specificProviderEnabled;
    if (customModelProviderSlugEl) customModelProviderSlugEl.disabled = !specificProviderEnabled;
  }

  function readCustomModelProviderSlug() {
    const routingMode = customModelRoutingModeEl?.value || "auto";
    if (routingMode !== "specific") return { providerSlug: "", error: "" };
    const rawProviderSlug = String(customModelProviderSlugEl?.value || "").trim();
    if (!rawProviderSlug) return { providerSlug: "", error: "Choose a provider slug or switch routing back to automatic." };
    const providerSlug = normalizeOpenRouterProviderSlug(rawProviderSlug);
    if (!providerSlug) return { providerSlug: "", error: "Provider slug is invalid. Use a value like anthropic, azure, or deepinfra/turbo." };
    return { providerSlug, error: "" };
  }

  function getDraftAvailableModels() {
    const customModelCatalog = draftCustomModels.map((model) => ({ ...model, id: getDraftCustomModelReference(model) }));
    return [...builtinModelCatalog, ...customModelCatalog].map((model) => ({ ...model }));
  }

  function getDraftChatCapableModels() {
    return getDraftAvailableModels().filter((model) => Boolean(model?.supports_tools));
  }

  function getModelProviderLabel(model) {
    return MODEL_PROVIDER_LABELS[String(model?.provider || "").trim()] || String(model?.provider || "model");
  }

  function getOperationPreferenceValue(key) {
    const defaults = appSettings.operation_model_preferences || {};
    const elementMap = {
      summarize: summaryModelPreferenceEl,
      fetch_summarize: fetchSummarizeModelPreferenceEl,
      fix_text: fixTextModelPreferenceEl,
      upload_metadata: uploadMetadataModelPreferenceEl,
    };
    const el = elementMap[key];
    return el ? String(el.value || "") : String(defaults[key] || "");
  }

  function getOperationModelPreferencesDraft() {
    return {
      summarize: getOperationPreferenceValue("summarize"),
      fetch_summarize: getOperationPreferenceValue("fetch_summarize"),
      fix_text: getOperationPreferenceValue("fix_text"),
      upload_metadata: getOperationPreferenceValue("upload_metadata"),
    };
  }

  function createOperationFallbackRow(modelId = "") {
    return { id: `operation-fallback-${fallbackRowSequence += 1}`, modelId: String(modelId || "").trim() };
  }

  function normalizeOperationFallbackRows(rawValue) {
    if (Array.isArray(rawValue)) return rawValue.map((modelId) => createOperationFallbackRow(modelId));
    if (typeof rawValue === "string" && rawValue.trim()) return [createOperationFallbackRow(rawValue)];
    return [];
  }

  function initializeOperationFallbackDraftRows(rawPreferences) {
    const preferences = rawPreferences && typeof rawPreferences === "object" ? rawPreferences : {};
    const nextRows = {};
    OPERATION_MODEL_KEYS.forEach((key) => { nextRows[key] = normalizeOperationFallbackRows(preferences[key]); });
    draftOperationFallbackRows = nextRows;
  }

  function getDraftOperationFallbackRows(operationKey) {
    return Array.isArray(draftOperationFallbackRows[operationKey]) ? draftOperationFallbackRows[operationKey] : [];
  }

  function addOperationFallbackRow(operationKey, modelId = "") {
    const rows = [...getDraftOperationFallbackRows(operationKey), createOperationFallbackRow(modelId)];
    draftOperationFallbackRows = { ...draftOperationFallbackRows, [operationKey]: rows };
    renderModelManagementPanels();
    if (typeof window.markDirty === "function") markDirty();
  }

  function removeOperationFallbackRow(operationKey, rowId) {
    const rows = getDraftOperationFallbackRows(operationKey).filter((row) => row.id !== rowId);
    draftOperationFallbackRows = { ...draftOperationFallbackRows, [operationKey]: rows };
    renderModelManagementPanels();
    if (typeof window.markDirty === "function") markDirty();
  }

  function moveOperationFallbackRow(operationKey, rowIndex, direction) {
    const rows = [...getDraftOperationFallbackRows(operationKey)];
    const nextIndex = rowIndex + direction;
    if (nextIndex < 0 || nextIndex >= rows.length) return;
    const [row] = rows.splice(rowIndex, 1);
    rows.splice(nextIndex, 0, row);
    draftOperationFallbackRows = { ...draftOperationFallbackRows, [operationKey]: rows };
    renderModelManagementPanels();
    if (typeof window.markDirty === "function") markDirty();
  }

  function setOperationFallbackRowModel(operationKey, rowId, modelId) {
    const rows = getDraftOperationFallbackRows(operationKey).map((row) => (
      row.id === rowId ? { ...row, modelId: String(modelId || "").trim() } : row
    ));
    draftOperationFallbackRows = { ...draftOperationFallbackRows, [operationKey]: rows };
    if (typeof window.markDirty === "function") markDirty();
  }

  function renderOperationFallbackList(operationKey) {
    const controls = OPERATION_FALLBACK_CONTROL_MAP[operationKey];
    if (!controls?.listEl) return;
    const listEl = controls.listEl;
    const rows = getDraftOperationFallbackRows(operationKey);
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
      populateOperationModelSelect(select, rowState.modelId, "Use built-in fallback");
      if (select.value !== rowState.modelId) rowState.modelId = select.value;
      select.addEventListener("change", () => setOperationFallbackRowModel(operationKey, rowState.id, select.value));
      const actions = document.createElement("div");
      actions.className = "settings-inline-actions";
      const upBtn = document.createElement("button");
      upBtn.type = "button";
      upBtn.className = "btn-ghost";
      upBtn.textContent = "Up";
      upBtn.disabled = index === 0;
      upBtn.addEventListener("click", () => moveOperationFallbackRow(operationKey, index, -1));
      const downBtn = document.createElement("button");
      downBtn.type = "button";
      downBtn.className = "btn-ghost";
      downBtn.textContent = "Down";
      downBtn.disabled = index === rows.length - 1;
      downBtn.addEventListener("click", () => moveOperationFallbackRow(operationKey, index, 1));
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "btn-ghost btn-ghost--danger";
      removeBtn.textContent = "Remove";
      removeBtn.addEventListener("click", () => removeOperationFallbackRow(operationKey, rowState.id));
      actions.append(upBtn, downBtn, removeBtn);
      row.append(select, actions);
      listEl.append(row);
    });
  }

  function renderOperationFallbackLists() {
    OPERATION_MODEL_KEYS.forEach((operationKey) => renderOperationFallbackList(operationKey));
  }

  function getOperationModelFallbackPreferencesDraft() {
    const preferences = {};
    OPERATION_MODEL_KEYS.forEach((operationKey) => {
      const rows = getDraftOperationFallbackRows(operationKey).map((row) => String(row.modelId || "").trim()).filter((modelId) => Boolean(modelId));
      preferences[operationKey] = [...new Set(rows)];
    });
    return preferences;
  }

  function syncDraftChatModelRows({ preferVisibleId = "" } = {}) {
    const candidates = getDraftChatCapableModels();
    const candidateMap = new Map(candidates.map((model) => [model.id, model]));
    const initialVisible = new Set(Array.isArray(appSettings.visible_model_order) ? appSettings.visible_model_order : []);
    const nextRows = Array.isArray(draftChatModelRows) ? draftChatModelRows.filter((row) => candidateMap.has(row.id)).map((row) => ({ ...row })) : [];
    const knownIds = new Set(nextRows.map((row) => row.id));
    for (const model of candidates) {
      if (knownIds.has(model.id)) continue;
      nextRows.push({ id: model.id, visible: preferVisibleId ? model.id === preferVisibleId : initialVisible.has(model.id) });
      knownIds.add(model.id);
    }
    if (!nextRows.length) {
      // If no candidates but we have saved visible_model_order, use it to rebuild
      if (initialVisible.size > 0 && candidates.length === 0) {
        // Try to rebuild from visible_model_order if candidates is empty
        const fallbackRows = [];
        for (const id of initialVisible) {
          if (candidateMap.has(id)) {
            fallbackRows.push({ id, visible: true });
          }
        }
        if (fallbackRows.length > 0) {
          draftChatModelRows = fallbackRows;
          return;
        }
      }
      draftChatModelRows = [];
      return;
    }
    if (!nextRows.some((row) => row.visible)) nextRows[0].visible = true;
    draftChatModelRows = nextRows;
  }

  function getDraftVisibleModelOrder() {
    const visibleIds = draftChatModelRows && draftChatModelRows.length
      ? draftChatModelRows.filter((row) => row.visible).map((row) => row.id)
      : [];
    if (visibleIds.length) return visibleIds;
    // Fallback to appSettings.visible_model_order if draft is empty or no visible rows
    const savedOrder = Array.isArray(appSettings.visible_model_order) ? appSettings.visible_model_order : [];
    if (savedOrder.length) return savedOrder;
    // If still empty, get all chat-capable model IDs as last resort
    return getDraftChatCapableModels().map((m) => m.id);
  }

  function renderCustomModelList() {
    if (!customModelListEl) return;
    customModelListEl.replaceChildren();
    if (!draftCustomModels.length) {
      const emptyState = document.createElement("p");
      emptyState.className = "settings-copy";
      emptyState.textContent = "No custom models configured yet.";
      customModelListEl.append(emptyState);
      return;
    }
    for (const model of draftCustomModels) {
      const row = document.createElement("div");
      row.className = "model-management-row";
      if (editingCustomModelClientUid && editingCustomModelClientUid === model.client_uid) row.classList.add("custom-model-row--editing");
      const meta = document.createElement("div");
      meta.className = "model-management-row__meta";
      const title = document.createElement("strong");
      title.textContent = model.name || model.api_model || model.id || model.client_uid;
      const subtitle = document.createElement("div");
      subtitle.className = "model-management-row__subtitle";
      subtitle.textContent = [model.api_model || model.id || model.client_uid, model.provider_slug ? `Route: ${model.provider_slug}` : ""].filter(Boolean).join(" · ");
      const badges = document.createElement("div");
      badges.className = "model-management-row__badges";
      [getModelProviderLabel(model), model.provider_slug ? `route ${model.provider_slug}` : null, getCustomModelReasoningLabel(model),
        model.supports_tools ? "tools" : "no tools", model.supports_vision ? "vision" : "text-only",
        model.supports_structured_outputs ? "structured" : "freeform"
      ].forEach((label) => {
        if (!label) return;
        const badge = document.createElement("span");
        badge.className = "model-management-badge";
        badge.textContent = label;
        badges.append(badge);
      });
      meta.append(title, subtitle, badges);
      const actions = document.createElement("div");
      actions.className = "settings-inline-actions";
      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "btn-ghost";
      editBtn.textContent = "Edit";
      editBtn.addEventListener("click", () => startEditingCustomModel(model.client_uid));
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "btn-ghost btn-ghost--danger";
      removeBtn.textContent = "Remove";
      removeBtn.addEventListener("click", () => {
        const wasEditing = editingCustomModelClientUid === model.client_uid;
        draftCustomModels = draftCustomModels.filter((entry) => entry.client_uid !== model.client_uid);
        if (wasEditing) cancelEditingCustomModel({ silent: true });
        syncDraftChatModelRows();
        renderModelManagementPanels();
        if (typeof window.markDirty === "function") markDirty();
        setCustomModelStatus("Custom model removed. Save to apply.", "warning");
      });
      actions.append(editBtn, removeBtn);
      row.append(meta, actions);
      customModelListEl.append(row);
    }
  }

  function fillCustomModelForm(model) {
    if (customModelNameEl) customModelNameEl.value = String(model?.name || "");
    if (customModelApiModelEl) customModelApiModelEl.value = String(model?.api_model || model?.id || "");
    if (customModelRoutingModeEl) customModelRoutingModeEl.value = model?.provider_slug ? "specific" : "auto";
    if (customModelProviderSlugEl) customModelProviderSlugEl.value = String(model?.provider_slug || "");
    if (customModelReasoningModeEl) customModelReasoningModeEl.value = String(model?.reasoning_mode || "default");
    if (customModelReasoningEffortEl) customModelReasoningEffortEl.value = String(model?.reasoning_effort || "");
    if (customModelSupportsToolsEl) customModelSupportsToolsEl.checked = Boolean(model?.supports_tools ?? true);
    if (customModelSupportsVisionEl) customModelSupportsVisionEl.checked = Boolean(model?.supports_vision ?? false);
    if (customModelSupportsStructuredEl) customModelSupportsStructuredEl.checked = Boolean(model?.supports_structured_outputs ?? false);
    syncCustomModelReasoningControls();
    syncCustomModelProviderControls();
  }

  function updateCustomModelEditControls() {
    if (addCustomModelBtn) addCustomModelBtn.textContent = editingCustomModelClientUid ? "Update model" : "Add custom model";
    if (customModelCancelEditBtn) customModelCancelEditBtn.hidden = !editingCustomModelClientUid;
  }

  function startEditingCustomModel(modelClientUid) {
    const model = draftCustomModels.find((entry) => entry.client_uid === modelClientUid);
    if (!model) return;
    editingCustomModelClientUid = model.client_uid;
    fillCustomModelForm(model);
    updateCustomModelEditControls();
    renderCustomModelList();
    setCustomModelStatus(`Editing ${model.name || model.api_model || model.client_uid}.`, "muted");
  }

  function cancelEditingCustomModel({ silent = false } = {}) {
    editingCustomModelClientUid = null;
    resetCustomModelForm();
    updateCustomModelEditControls();
    renderCustomModelList();
    if (!silent) setCustomModelStatus("No pending model changes", "muted");
  }

  function moveDraftChatModelRow(index, direction) {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= draftChatModelRows.length) return;
    const rows = [...draftChatModelRows];
    const [row] = rows.splice(index, 1);
    rows.splice(nextIndex, 0, row);
    draftChatModelRows = rows;
    renderModelManagementPanels();
    if (typeof window.markDirty === "function") markDirty();
  }

  function renderChatModelVisibilityList() {
    if (!chatModelVisibilityListEl) return;
    chatModelVisibilityListEl.replaceChildren();
    const candidateMap = new Map(getDraftChatCapableModels().map((model) => [model.id, model]));
    if (!draftChatModelRows.length) {
      const emptyState = document.createElement("p");
      emptyState.className = "settings-copy";
      emptyState.textContent = "No tool-capable models are available for the chat selector.";
      chatModelVisibilityListEl.append(emptyState);
      return;
    }
    draftChatModelRows.forEach((rowState, index) => {
      const model = candidateMap.get(rowState.id);
      if (!model) return;
      const row = document.createElement("div");
      row.className = "model-management-row";
      const toggleLabel = document.createElement("label");
      toggleLabel.className = "tool-toggle";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = Boolean(rowState.visible);
      checkbox.addEventListener("change", () => {
        rowState.visible = checkbox.checked;
        if (!draftChatModelRows.some((entry) => entry.visible)) {
          rowState.visible = true;
          checkbox.checked = true;
          setCustomModelStatus("At least one chat model must stay visible.", "warning");
          return;
        }
        if (typeof window.markDirty === "function") markDirty();
      });
      const body = document.createElement("span");
      body.className = "model-management-row__toggle-body";
      const title = document.createElement("strong");
      title.textContent = model.name || model.id;
      const subtitle = document.createElement("small");
      subtitle.textContent = `${getModelProviderLabel(model)} · ${model.api_model || model.id}`;
      body.append(title, subtitle);
      toggleLabel.append(checkbox, body);
      const actions = document.createElement("div");
      actions.className = "settings-inline-actions";
      const upBtn = document.createElement("button");
      upBtn.type = "button";
      upBtn.className = "btn-ghost";
      upBtn.textContent = "Up";
      upBtn.disabled = index === 0;
      upBtn.addEventListener("click", () => moveDraftChatModelRow(index, -1));
      const downBtn = document.createElement("button");
      downBtn.type = "button";
      downBtn.className = "btn-ghost";
      downBtn.textContent = "Down";
      downBtn.disabled = index === draftChatModelRows.length - 1;
      downBtn.addEventListener("click", () => moveDraftChatModelRow(index, 1));
      actions.append(upBtn, downBtn);
      row.append(toggleLabel, actions);
      chatModelVisibilityListEl.append(row);
    });
  }

  function populateOperationModelSelect(selectEl, selectedValue, emptyLabel = "Use default chat model") {
    if (!selectEl) return;
    const options = getDraftAvailableModels();
    const fragment = document.createDocumentFragment();
    const defaultOption = document.createElement("option");
    defaultOption.value = "";
    defaultOption.textContent = emptyLabel;
    fragment.append(defaultOption);
    options.forEach((model) => {
      const option = document.createElement("option");
      option.value = model.id;
      option.textContent = `${model.name || model.id} (${getModelProviderLabel(model)})`;
      fragment.append(option);
    });
    selectEl.replaceChildren(fragment);
    selectEl.value = selectedValue || "";
    if (selectEl.value !== (selectedValue || "")) selectEl.value = "";
  }

  function populateVisionModelSelect(selectEl, selectedValue, emptyLabel = "Use default chat model when needed") {
    if (!selectEl) return;
    const options = getDraftAvailableModels().filter((model) => Boolean(model?.supports_vision));
    const fragment = document.createDocumentFragment();
    const defaultOption = document.createElement("option");
    defaultOption.value = "";
    defaultOption.textContent = emptyLabel;
    fragment.append(defaultOption);
    options.forEach((model) => {
      const option = document.createElement("option");
      option.value = model.id;
      option.textContent = `${model.name || model.id} (${getModelProviderLabel(model)})`;
      fragment.append(option);
    });
    selectEl.replaceChildren(fragment);
    selectEl.value = selectedValue || "";
    if (selectEl.value !== (selectedValue || "")) selectEl.value = "";
  }

  function renderOperationModelSelects(preferences = null) {
    const currentChatSummaryModel = chatSummaryModelEl ? String(chatSummaryModelEl.value || appSettings.chat_summary_model || "") : String(appSettings.chat_summary_model || "");
    const currentImageHelperModel = imageHelperModelEl ? String(imageHelperModelEl.value || appSettings.image_helper_model || "") : String(appSettings.image_helper_model || "");
    const currentSelections = preferences && typeof preferences === "object" ? {
      summarize: String(preferences.summarize || ""),
      fetch_summarize: String(preferences.fetch_summarize || ""),
      fix_text: String(preferences.fix_text || ""),
      upload_metadata: String(preferences.upload_metadata || ""),
    } : getOperationModelPreferencesDraft();
    populateOperationModelSelect(summaryModelPreferenceEl, currentSelections.summarize);
    populateOperationModelSelect(fetchSummarizeModelPreferenceEl, currentSelections.fetch_summarize);
    populateOperationModelSelect(fixTextModelPreferenceEl, currentSelections.fix_text);
    populateOperationModelSelect(uploadMetadataModelPreferenceEl, currentSelections.upload_metadata);
    populateOperationModelSelect(chatSummaryModelEl, currentChatSummaryModel, "Use default chat model");
    populateVisionModelSelect(imageHelperModelEl, currentImageHelperModel, "Use default chat model when needed");
  }

  function renderModelManagementPanels({ preferVisibleId = "", operationPreferences = null } = {}) {
    syncDraftChatModelRows({ preferVisibleId });
    renderCustomModelList();
    renderChatModelVisibilityList();
    renderOperationModelSelects(operationPreferences);
    renderOperationFallbackLists();
    updateCustomModelEditControls();
  }

  function resetCustomModelForm() {
    if (customModelNameEl) customModelNameEl.value = "";
    if (customModelApiModelEl) customModelApiModelEl.value = "";
    if (customModelRoutingModeEl) customModelRoutingModeEl.value = "auto";
    if (customModelProviderSlugEl) customModelProviderSlugEl.value = "";
    if (customModelReasoningModeEl) customModelReasoningModeEl.value = "default";
    if (customModelReasoningEffortEl) customModelReasoningEffortEl.value = "";
    if (customModelSupportsToolsEl) customModelSupportsToolsEl.checked = true;
    if (customModelSupportsVisionEl) customModelSupportsVisionEl.checked = false;
    if (customModelSupportsStructuredEl) customModelSupportsStructuredEl.checked = false;
    syncCustomModelReasoningControls();
    syncCustomModelProviderControls();
  }

  function addCustomModelFromInputs() {
    const apiModel = normalizeOpenRouterApiModel(customModelApiModelEl?.value || "");
    const providerSelection = readCustomModelProviderSlug();
    const reasoning = normalizeOpenRouterReasoningConfig(
      customModelReasoningModeEl?.value || "default",
      customModelReasoningEffortEl?.value || ""
    );
    if (!apiModel) { setCustomModelStatus("Custom model API id is required.", "error"); return; }
    if (providerSelection.error) { setCustomModelStatus(providerSelection.error, "error"); return; }
    const providerSlug = providerSelection.providerSlug;
    const existingIndex = editingCustomModelClientUid
      ? draftCustomModels.findIndex((model) => model.client_uid === editingCustomModelClientUid) : -1;
    const existingModel = existingIndex >= 0 ? draftCustomModels[existingIndex] : null;
    const normalizedModel = normalizeDraftCustomModel({
      id: existingModel?.id || "",
      client_uid: existingModel?.client_uid || createCustomModelClientUid(),
      name: String(customModelNameEl?.value || "").trim() || apiModel,
      provider: "openrouter",
      api_model: apiModel,
      provider_slug: providerSlug,
      reasoning_mode: reasoning.mode,
      reasoning_effort: reasoning.effort,
      supports_tools: Boolean(customModelSupportsToolsEl?.checked),
      supports_vision: Boolean(customModelSupportsVisionEl?.checked),
      supports_structured_outputs: Boolean(customModelSupportsStructuredEl?.checked),
      is_custom: true,
    });
    const normalizedSignature = getDraftCustomModelSignature(normalizedModel);
    const duplicateIndex = draftCustomModels.findIndex((model, index) => (
      getDraftCustomModelSignature(model) === normalizedSignature && index !== existingIndex
    ));
    if (duplicateIndex >= 0) { setCustomModelStatus("That custom model configuration is already configured.", "warning"); return; }
    const preferredModelReference = getDraftCustomModelReference(normalizedModel);
    if (existingIndex >= 0) {
      const nextModels = [...draftCustomModels];
      nextModels.splice(existingIndex, 1, normalizedModel);
      draftCustomModels = nextModels;
    } else {
      draftCustomModels = [...draftCustomModels, normalizedModel];
    }
    cancelEditingCustomModel({ silent: true });
    renderModelManagementPanels({ preferVisibleId: preferredModelReference });
    if (typeof window.markDirty === "function") markDirty();
    setCustomModelStatus(existingIndex >= 0 ? "Custom model updated. Save to apply." : "Custom model added. Save to apply.", "success");
  }

  // ─── Event listeners ──────────────────────────────────────────────────────────
  addCustomModelBtn?.addEventListener("click", addCustomModelFromInputs);
  customModelCancelEditBtn?.addEventListener("click", () => cancelEditingCustomModel());
  customModelReasoningModeEl?.addEventListener("change", syncCustomModelReasoningControls);
  customModelRoutingModeEl?.addEventListener("change", syncCustomModelProviderControls);
  summaryModelFallbackAddBtn?.addEventListener("click", () => addOperationFallbackRow("summarize"));
  fetchSummarizeModelFallbackAddBtn?.addEventListener("click", () => addOperationFallbackRow("fetch_summarize"));
  fixTextModelFallbackAddBtn?.addEventListener("click", () => addOperationFallbackRow("fix_text"));
  uploadMetadataModelFallbackAddBtn?.addEventListener("click", () => addOperationFallbackRow("upload_metadata"));

  // ─── Export for use by settings.js core ──────────────────────────────────────
  window.__customModelsModule = {
    renderModelManagementPanels,
    getDraftCustomModels: () => draftCustomModels,
    serializeDraftCustomModel,
    getOperationModelPreferencesDraft,
    getOperationModelFallbackPreferencesDraft,
    getDraftVisibleModelOrder,
    initializeOperationFallbackDraftRows,
    normalizeOpenRouterApiModel,
    splitOpenRouterModelId,
    parseOpenRouterModelVariantSuffix,
    normalizeDraftCustomModel,
    normalizeOpenRouterProviderSlug,
    normalizeOpenRouterReasoningMode,
    normalizeOpenRouterReasoningConfig,
    normalizeCustomModelClientUid,
    createCustomModelClientUid,
  };
})();
