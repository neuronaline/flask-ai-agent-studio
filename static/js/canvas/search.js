// canvas/search.js — Search/filter & highlight

function getCanvasPathFilterValue() {
  return String(canvasPathFilter?.value || "").trim();
}

function resetCanvasWorkspaceState() {
  canvasState.isCanvasEditing = false;
  canvasState.editingCanvasDocumentId = null;
  if (canvasState.pendingCanvasPageSyncFrame) {
    globalThis.cancelAnimationFrame(canvasState.pendingCanvasPageSyncFrame);
    canvasState.pendingCanvasPageSyncFrame = 0;
  }
  canvasState.canvasPageByDocumentId = new Map();
  resetStreamingCanvasPreview();
  lastCanvasStructureSignature = "";
  collapsedCanvasFolders = new Set();
  lastCanvasTreeTypeAheadValue = "";
  lastCanvasTreeTypeAheadAt = 0;
  setCanvasAttention(false);
  setCanvasSearchStatus("");
  setCanvasStatus("Canvas idle", "muted");
  if (canvasSearchInput) {
    canvasSearchInput.value = "";
  }
  if (canvasRoleFilter) {
    canvasRoleFilter.value = "";
  }
  if (canvasPathFilter) {
    canvasPathFilter.value = "";
  }
}

function hasActiveCanvasFilters() {
  return Boolean(
    String(canvasSearchInput?.value || "").trim()
    || String(canvasRoleFilter?.value || "").trim()
    || getCanvasPathFilterValue()
  );
}

function resetCanvasMetaBar() {
  if (canvasMetaBar) {
    canvasMetaBar.hidden = true;
  }
  if (canvasMetaChips) {
    canvasMetaChips.innerHTML = "";
  }
  if (canvasCopyRefBtn) {
    canvasCopyRefBtn.disabled = true;
    canvasCopyRefBtn.textContent = "Copy reference";
  }
  if (canvasResetFiltersBtn) {
    canvasResetFiltersBtn.disabled = true;
  }
}

function resetCanvasFilters({ silent = false } = {}) {
  if (canvasSearchInput) {
    canvasSearchInput.value = "";
  }
  if (canvasRoleFilter) {
    canvasRoleFilter.value = "";
  }
  if (canvasPathFilter) {
    canvasPathFilter.value = "";
  }
  renderCanvasPanel();
  if (!silent) {
    setCanvasSearchStatus("Canvas filters cleared.", "muted");
  }
}

function documentMatchesCanvasFilters(document, searchTerm, roleValue, pathValue) {
  if (!document) {
    return false;
  }

  if (document.isStreamingPreview) {
    return true;
  }

  const normalizedRole = String(roleValue || "").trim().toLowerCase();
  const normalizedPath = String(pathValue || "").trim();
  const normalizedSearch = String(searchTerm || "").trim().toLowerCase();

  if (normalizedRole && document.role !== normalizedRole) {
    return false;
  }

  if (normalizedPath === CANVAS_ROOT_PATH_FILTER) {
    if ((document.path || "").includes("/")) {
      return false;
    }
  } else if (normalizedPath) {
    const candidatePath = getCanvasDocumentLabel(document);
    if (!(candidatePath === normalizedPath || candidatePath.startsWith(`${normalizedPath}/`))) {
      return false;
    }
  }

  if (!normalizedSearch) {
    return true;
  }

  const haystack = [document.title, document.path, document.role, document.summary, document.content]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
  return haystack.includes(normalizedSearch);
}

function getCanvasVisibleDocuments(documents) {
  const searchTerm = String(canvasSearchInput?.value || "").trim();
  const roleValue = String(canvasRoleFilter?.value || "").trim();
  const pathValue = getCanvasPathFilterValue();
  return (documents || []).filter((document) => documentMatchesCanvasFilters(document, searchTerm, roleValue, pathValue));
}

function buildCanvasPathFilterOptions(documents) {
  const options = [{ value: "", label: "All paths" }];
  const seen = new Set([""]);
  let hasRootFile = false;

  (documents || []).forEach((document) => {
    const path = String(document.path || "").trim();
    if (!path || !path.includes("/")) {
      hasRootFile = true;
      return;
    }

    const parts = path.split("/");
    let prefix = "";
    parts.slice(0, -1).forEach((part) => {
      prefix = prefix ? `${prefix}/${part}` : part;
      if (!seen.has(prefix)) {
        seen.add(prefix);
        options.push({ value: prefix, label: prefix });
      }
    });
  });

  if (hasRootFile) {
    options.push({ value: CANVAS_ROOT_PATH_FILTER, label: "Root files" });
  }

  return options;
}

function syncCanvasFilterControls(documents) {
  if (canvasRoleFilter) {
    const currentValue = String(canvasRoleFilter.value || "").trim();
    const roles = Array.from(new Set((documents || []).map((document) => document.role).filter(Boolean))).sort();
    canvasRoleFilter.innerHTML = '<option value="">All roles</option>' + roles.map((role) => `<option value="${escHtml(role)}">${escHtml(role)}</option>`).join("");
    canvasRoleFilter.value = roles.includes(currentValue) ? currentValue : "";
  }

  if (canvasPathFilter) {
    const currentValue = getCanvasPathFilterValue();
    const options = buildCanvasPathFilterOptions(documents);
    canvasPathFilter.innerHTML = options.map((option) => `<option value="${escHtml(option.value)}">${escHtml(option.label)}</option>`).join("");
    canvasPathFilter.value = options.some((option) => option.value === currentValue) ? currentValue : "";
  }
}

function applyCanvasSearchHighlight(query) {
  if (!canvasDocumentEl) {
    return 0;
  }

  const normalizedQuery = String(query || "").trim();
  if (!normalizedQuery) {
    return 0;
  }

  const pattern = escapeRegExp(normalizedQuery);
  const selectorMatcher = new RegExp(pattern, "i");
  const walker = document.createTreeWalker(canvasDocumentEl, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parentName = node.parentNode?.nodeName;
      if (!node.textContent?.trim()) {
        return NodeFilter.FILTER_REJECT;
      }
      if (parentName === "SCRIPT" || parentName === "STYLE" || parentName === "MARK") {
        return NodeFilter.FILTER_REJECT;
      }
      return selectorMatcher.test(node.textContent) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });

  const textNodes = [];
  let currentNode;
  while ((currentNode = walker.nextNode())) {
    textNodes.push(currentNode);
  }

  let matchCount = 0;
  textNodes.forEach((textNode) => {
    const source = textNode.textContent || "";
    const fragment = document.createDocumentFragment();
    const highlightMatcher = new RegExp(pattern, "gi");
    let lastIndex = 0;

    source.replace(highlightMatcher, (matched, offset) => {
      if (offset > lastIndex) {
        fragment.appendChild(document.createTextNode(source.slice(lastIndex, offset)));
      }
      const mark = document.createElement("mark");
      mark.textContent = matched;
      fragment.appendChild(mark);
      lastIndex = offset + matched.length;
      matchCount += 1;
      return matched;
    });

    if (lastIndex < source.length) {
      fragment.appendChild(document.createTextNode(source.slice(lastIndex)));
    }

    textNode.parentNode.replaceChild(fragment, textNode);
  });

  return matchCount;
}

function updateCanvasSearchFeedback(renderState, matchCount = 0) {
  const {
    documents,
    visibleDocuments,
    isStreamingPreviewActive,
    searchTerm,
  } = renderState;

  if (!documents.length || canvasState.isCanvasEditing || isStreamingPreviewActive) {
    setCanvasSearchStatus("");
    return;
  }

  const roleValue = String(canvasRoleFilter?.value || "").trim();
  const pathValue = getCanvasPathFilterValue();
  if (!searchTerm && !roleValue && !pathValue) {
    setCanvasSearchStatus("");
    return;
  }

  if (!visibleDocuments.length) {
    const filterParts = [];
    if (searchTerm) {
      filterParts.push(`search \\"${searchTerm}\\"`);
    }
    if (roleValue) {
      filterParts.push(`role ${roleValue}`);
    }
    if (pathValue) {
      filterParts.push(pathValue === CANVAS_ROOT_PATH_FILTER ? "root files" : `path ${pathValue}`);
    }
    setCanvasSearchStatus(`No canvas files match ${filterParts.join(" · ")}.`, "warning");
    return;
  }

  if (searchTerm) {
    setCanvasSearchStatus(
      matchCount
        ? `${matchCount} search match${matchCount === 1 ? "" : "es"} across ${visibleDocuments.length} file${visibleDocuments.length === 1 ? "" : "s"}.`
        : `No text matches in ${visibleDocuments.length} filtered file${visibleDocuments.length === 1 ? "" : "s"}.`,
      matchCount ? "muted" : "warning"
    );
    return;
  }

  const filterCount = visibleDocuments.length;
  setCanvasSearchStatus(
    `${filterCount} file${filterCount === 1 ? "" : "s"} shown after filtering.`,
    "muted"
  );
}
