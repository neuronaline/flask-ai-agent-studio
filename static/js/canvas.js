function sanitizeEditedUserMetadata(metadata) {
  const attachments = getMessageAttachments(metadata);
  const sanitizedMetadata = {};
  if (attachments.length) {
    sanitizedMetadata.attachments = attachments;
    Object.assign(sanitizedMetadata, buildLegacyAttachmentMetadata(attachments));
  }
  const slashCommandState = extractComposerSlashCommandMetadata(metadata);
  if (slashCommandState?.metadata) {
    Object.assign(sanitizedMetadata, slashCommandState.metadata);
  }
  return Object.keys(sanitizedMetadata).length ? sanitizedMetadata : null;
}
let lastCanvasStructureSignature = "";
let lastCanvasDocListSignature = "";
let activeAnswerRenderPending = false;
const visionDisabledNoteEl = document.getElementById("vision-disabled-note");

function isCanvasStreamingPreviewTool(toolName, eventPayload = null) {
  if (CANVAS_STREAMING_PREVIEW_TOOLS.has(String(toolName || "").trim())) {
    return true;
  }

  if (!eventPayload || typeof eventPayload !== "object") {
    return false;
  }

  return Boolean(
    String(eventPayload.preview_key || "").trim()
    || (eventPayload.snapshot && typeof eventPayload.snapshot === "object")
    || typeof eventPayload.delta === "string"
    || Object.prototype.hasOwnProperty.call(eventPayload, "replace_content")
  );
}

function getCanvasStreamingPreviewLabel(document) {
  return getCanvasDocumentDisplayName(document) || "Canvas";
}

function getCanvasStreamingStatusMessage(toolName, document, phase = "loading") {
  const normalizedToolName = String(toolName || "").trim();
  const label = getCanvasStreamingPreviewLabel(document);
  if (phase === "streaming") {
    if (normalizedToolName === "create_canvas_document") {
      return `Drafting ${label} live...`;
    }
    if (CANVAS_EDIT_PREVIEW_TOOLS.has(normalizedToolName)) {
      return `Previewing edits in ${label}...`;
    }
    return `Updating ${label} live...`;
  }
  if (phase === "executing") {
    if (normalizedToolName === "create_canvas_document") return `Creating ${label}...`;
    if (CANVAS_EDIT_PREVIEW_TOOLS.has(normalizedToolName)) return `Applying edits to ${label}...`;
    return `Updating ${label}...`;
  }
  if (normalizedToolName === "create_canvas_document") {
    return `Preparing live draft for ${label}...`;
  }
  if (CANVAS_EDIT_PREVIEW_TOOLS.has(normalizedToolName)) {
    return `Preparing live edit preview for ${label}...`;
  }
  return `Preparing live Canvas preview for ${label}...`;
}

function normalizeCanvasDocument(document) {
  if (!document || typeof document !== "object") {
    return null;
  }
  const format = String(document.format || "markdown").trim().toLowerCase();
  const normalizedFormat = format === "code" ? "code" : "markdown";
  const content = String(document.content || "").replace(/\r\n?/g, "\n");
  const rawPageCount = Number.parseInt(String(document.page_count ?? "0"), 10);
  const contentMode = String(document.content_mode || "text").trim().toLowerCase();
  const canvasMode = String(document.canvas_mode || (contentMode === "visual" ? "preview_only" : "editable")).trim().toLowerCase();
  const visualPageImageIds = Array.isArray(document.visual_page_image_ids)
    ? document.visual_page_image_ids.map((value) => String(value || "").trim()).filter(Boolean)
    : [];
  return {
    id: String(document.id || "").trim(),
    title: String(document.title || "Canvas").trim() || "Canvas",
    path: String(document.path || "").trim().replace(/\\/g, "/"),
    role: String(document.role || "").trim().toLowerCase(),
    summary: String(document.summary || "").trim(),
    format: normalizedFormat,
    language: String(document.language || "").trim().toLowerCase(),
    content,
    line_count: Number.isInteger(Number(document.line_count)) ? Number(document.line_count) : content.split("\n").length,
    page_count: Number.isFinite(rawPageCount) && rawPageCount > 0 ? rawPageCount : 0,
    source_message_id: Number.isInteger(Number(document.source_message_id)) ? Number(document.source_message_id) : null,
    content_mode: contentMode === "visual" || contentMode === "hybrid" ? contentMode : "text",
    canvas_mode: canvasMode === "preview_only" ? "preview_only" : "editable",
    source_file_id: String(document.source_file_id || "").trim(),
    source_mime_type: String(document.source_mime_type || "").trim().toLowerCase(),
    visual_page_image_ids: visualPageImageIds,
    ...(document.always_expanded !== undefined
      ? { always_expanded: Boolean(document.always_expanded) }
      : {}),
  };
}

function isCanvasDocumentEditable(document) {
  return String(document?.canvas_mode || "editable").trim().toLowerCase() !== "preview_only";
}

function isCanvasPageAwareDocument(document) {
  return Boolean(document && !shouldRenderCanvasAsCode(document) && Number(document.page_count) > 1);
}

function getCanvasPageAnchorId(documentId, pageNumber) {
  const normalizedDocumentId = String(documentId || "canvas")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-") || "canvas";
  return `canvas-page-${normalizedDocumentId}-${pageNumber}`;
}

function clampCanvasPageNumber(document, pageNumber) {
  const totalPages = Number(document?.page_count || 0);
  if (!totalPages) {
    return 0;
  }
  const normalizedPage = Number.parseInt(String(pageNumber || 1), 10);
  if (!Number.isFinite(normalizedPage)) {
    return 1;
  }
  return Math.min(Math.max(normalizedPage, 1), totalPages);
}

function getCanvasCurrentPage(document) {
  if (!isCanvasPageAwareDocument(document)) {
    return 0;
  }
  return clampCanvasPageNumber(document, canvasState.canvasPageByDocumentId.get(document.id) || 1);
}

function setCanvasCurrentPage(document, pageNumber) {
  if (!document?.id || !isCanvasPageAwareDocument(document)) {
    return 0;
  }
  const nextPage = clampCanvasPageNumber(document, pageNumber);
  canvasState.canvasPageByDocumentId.set(document.id, nextPage);
  return nextPage;
}

function getCanvasPageHeadingNodes() {
  if (!canvasDocumentEl) {
    return [];
  }
  return Array.from(canvasDocumentEl.querySelectorAll("[data-canvas-page-number]"));
}

function extractCanvasPageSectionsFromContent(content) {
  const normalizedContent = String(content || "").replace(/\r\n?/g, "\n");
  const matches = Array.from(normalizedContent.matchAll(/^##\s+Page\s+(\d+)\s*$/gm));
  if (!matches.length) {
    return [];
  }
  return matches.map((match, index) => {
    const pageNumber = Number.parseInt(match[1], 10);
    const start = match.index ?? 0;
    const end = index + 1 < matches.length ? (matches[index + 1].index ?? normalizedContent.length) : normalizedContent.length;
    return {
      pageNumber,
      content: normalizedContent.slice(start, end).trim(),
    };
  }).filter((section) => Number.isFinite(section.pageNumber) && section.pageNumber > 0 && section.content);
}

function getCanvasPageSection(document, pageNumber) {
  const sections = extractCanvasPageSectionsFromContent(document?.content || "");
  if (!sections.length) {
    return null;
  }
  return sections.find((section) => section.pageNumber === clampCanvasPageNumber(document, pageNumber)) || sections[0];
}

function updateCanvasPageNavigationUi(document) {
  if (!canvasDocumentEl || !isCanvasPageAwareDocument(document)) {
    return;
  }
  const currentPage = getCanvasCurrentPage(document);
  const totalPages = clampCanvasPageNumber(document, document.page_count);
  const labelEl = canvasDocumentEl.querySelector("[data-canvas-page-label]");
  const prevBtn = canvasDocumentEl.querySelector('[data-canvas-page-action="prev"]');
  const nextBtn = canvasDocumentEl.querySelector('[data-canvas-page-action="next"]');
  if (labelEl) {
    labelEl.textContent = `Page ${currentPage} / ${totalPages}`;
  }
  if (prevBtn) {
    prevBtn.disabled = currentPage <= 1;
  }
  if (nextBtn) {
    nextBtn.disabled = currentPage >= totalPages;
  }
}

function syncCanvasCurrentPageFromScroll(document) {
  if (!canvasDocumentEl || !isCanvasPageAwareDocument(document)) {
    return;
  }
  const headings = getCanvasPageHeadingNodes();
  if (!headings.length) {
    return;
  }
  const containerRect = canvasDocumentEl.getBoundingClientRect();
  let currentPage = 1;
  headings.forEach((heading) => {
    const topOffset = heading.getBoundingClientRect().top - containerRect.top;
    if (topOffset <= 88) {
      currentPage = Number.parseInt(String(heading.dataset.canvasPageNumber || "1"), 10) || currentPage;
    }
  });
  setCanvasCurrentPage(document, currentPage);
  updateCanvasPageNavigationUi(document);
}

function scheduleCanvasPageSync(document) {
  if (!isCanvasPageAwareDocument(document) || canvasState.pendingCanvasPageSyncFrame) {
    return;
  }
  canvasState.pendingCanvasPageSyncFrame = globalThis.requestAnimationFrame(() => {
    canvasState.pendingCanvasPageSyncFrame = 0;
    syncCanvasCurrentPageFromScroll(document);
  });
}

function scrollCanvasToPage(document, pageNumber, behavior = "smooth") {
  if (!canvasDocumentEl || !isCanvasPageAwareDocument(document)) {
    return;
  }
  const normalizedPage = setCanvasCurrentPage(document, pageNumber);
  const pageSection = getCanvasPageSection(document, normalizedPage);
  if (pageSection) {
    canvasDocumentEl.innerHTML = renderCanvasDocumentBody(document);
    bindCanvasPageNavigation(document);
    canvasDocumentEl.scrollTo({ top: 0, behavior: behavior === "auto" ? "auto" : "smooth" });
    return;
  }
  const target = canvasDocumentEl.querySelector(`#${getCanvasPageAnchorId(document.id, normalizedPage)}`);
  if (target) {
    target.scrollIntoView({ behavior, block: "start" });
  }
  updateCanvasPageNavigationUi(document);
}

function bindCanvasPageNavigation(document) {
  if (!canvasDocumentEl) {
    return;
  }
  canvasDocumentEl.onscroll = null;
  if (!isCanvasPageAwareDocument(document)) {
    return;
  }

  const pageSection = getCanvasPageSection(document, getCanvasCurrentPage(document) || 1);
  if (pageSection) {
    canvasDocumentEl.querySelector('[data-canvas-page-action="prev"]')?.addEventListener("click", () => {
      scrollCanvasToPage(document, getCanvasCurrentPage(document) - 1, "auto");
    });
    canvasDocumentEl.querySelector('[data-canvas-page-action="next"]')?.addEventListener("click", () => {
      scrollCanvasToPage(document, getCanvasCurrentPage(document) + 1, "auto");
    });
    updateCanvasPageNavigationUi(document);
    return;
  }

  const headings = Array.from(canvasDocumentEl.querySelectorAll("h1, h2, h3, h4, h5, h6"));
  headings.forEach((heading) => {
    const match = CANVAS_PAGE_HEADING_TEXT_RE.exec(String(heading.textContent || "").trim());
    if (!match) {
      return;
    }
    const pageNumber = Number.parseInt(match[1], 10);
    heading.id = getCanvasPageAnchorId(document.id, pageNumber);
    heading.dataset.canvasPageNumber = String(pageNumber);
    heading.classList.add("canvas-page-heading");
  });

  canvasDocumentEl.querySelector('[data-canvas-page-action="prev"]')?.addEventListener("click", () => {
    scrollCanvasToPage(document, getCanvasCurrentPage(document) - 1);
  });
  canvasDocumentEl.querySelector('[data-canvas-page-action="next"]')?.addEventListener("click", () => {
    scrollCanvasToPage(document, getCanvasCurrentPage(document) + 1);
  });

  updateCanvasPageNavigationUi(document);
  canvasDocumentEl.onscroll = () => scheduleCanvasPageSync(document);
  if (getCanvasCurrentPage(document) > 1) {
    scrollCanvasToPage(document, getCanvasCurrentPage(document), "auto");
  } else {
    syncCanvasCurrentPageFromScroll(document);
  }
}

function getCanvasMode(documents) {
  return Array.isArray(documents) && documents.some((document) => document.path || document.role) ? "project" : "document";
}

function getCanvasPreferredActiveDocumentId(entries = chatState.history) {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const metadata = entries[index]?.metadata;
    const candidate = typeof metadata?.active_document_id === "string"
      ? metadata.active_document_id.trim()
      : "";
    if (candidate) {
      return candidate;
    }
  }
  return "";
}

function getCanvasDocumentLabel(document) {
  if (!document) {
    return "";
  }
  return String(document.path || document.title || "").trim();
}

function getCanvasDocumentDisplayName(document) {
  return getCanvasDocumentLabel(document) || String(document?.title || "Canvas").trim() || "Canvas";
}

function getCanvasFileName(document) {
  const label = getCanvasDocumentLabel(document);
  const parts = label.split("/");
  return parts[parts.length - 1] || label;
}

function shouldRenderCanvasAsCode(document) {
  if (!document || typeof document !== "object") {
    return false;
  }

  const explicitFormat = String(document.format || "").trim().toLowerCase();
  if (explicitFormat === "code") {
    return true;
  }

  const language = String(document.language || "").trim().toLowerCase();
  if (language && !["markdown", "md", "plain", "text", "txt"].includes(language)) {
    return true;
  }

  const candidateLabel = String(document.path || document.title || "").trim().toLowerCase();
  const extensionMatch = candidateLabel.match(/\.[^.\/]+$/);
  return Boolean(extensionMatch && CANVAS_CODE_FILE_EXTENSIONS.has(extensionMatch[0]));
}

function normalizeStreamingCanvasPreviewDocument(document) {
  const normalized = normalizeCanvasDocument(document);
  if (!normalized) {
    return null;
  }
  if (shouldRenderCanvasAsCode(normalized)) {
    normalized.format = "code";
  }
  if (document?.isStreamingPreview && isGenericStreamingCanvasPreviewTitle(normalized.title)) {
    const inferredTitle = inferStreamingCanvasPreviewTitleFromContent(normalized.content);
    if (inferredTitle) {
      normalized.title = inferredTitle;
    }
  }
  return normalized;
}

function isGenericStreamingCanvasPreviewTitle(title) {
  const normalizedTitle = String(title || "").trim().toLowerCase();
  return normalizedTitle === "canvas draft" || normalizedTitle === "canvas" || normalizedTitle === "untitled";
}

function inferStreamingCanvasPreviewTitleFromContent(content) {
  const normalizedContent = String(content || "").replace(/\r\n?/g, "\n");
  if (!normalizedContent) {
    return "";
  }

  const headingMatch = normalizedContent.match(/^#\s+(.+?)\s*$/m);
  if (!headingMatch) {
    return "";
  }

  return String(headingMatch[1] || "").trim().slice(0, 160);
}

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

function buildCanvasTreeNodes(documents) {
  const root = { folders: new Map(), files: [] };

  (documents || []).forEach((document) => {
    const path = String(document.path || "").trim();
    if (!path || !path.includes("/")) {
      root.files.push({ name: getCanvasFileName(document), document });
      return;
    }

    const parts = path.split("/");
    let cursor = root;
    let prefix = "";
    parts.slice(0, -1).forEach((part) => {
      prefix = prefix ? `${prefix}/${part}` : part;
      if (!cursor.folders.has(part)) {
        cursor.folders.set(part, { name: part, path: prefix, folders: new Map(), files: [] });
      }
      cursor = cursor.folders.get(part);
    });

    cursor.files.push({ name: parts[parts.length - 1], document });
  });

  return root;
}

function getCanvasTreeItems() {
  if (!canvasTreeEl) {
    return [];
  }
  return Array.from(canvasTreeEl.querySelectorAll('[data-canvas-tree-item="true"]')).filter((item) => item instanceof HTMLElement && !item.hidden);
}

function syncCanvasTreeTabStops(preferredItem = null) {
  const items = getCanvasTreeItems().filter((item) => !item.disabled);
  if (!items.length) {
    return null;
  }

  const preferredActiveId = String(canvasState.activeCanvasDocumentId || getCanvasPreferredActiveDocumentId() || "").trim();
  const nextItem = preferredItem instanceof HTMLElement
    ? preferredItem
    : items.find((item) => item.dataset.canvasDocumentId === preferredActiveId)
      || items[0];

  items.forEach((item) => {
    item.tabIndex = item === nextItem ? 0 : -1;
  });
  return nextItem;
}

function focusCanvasTreeItem(targetItem) {
  const nextItem = syncCanvasTreeTabStops(targetItem);
  if (nextItem && typeof nextItem.focus === "function") {
    nextItem.focus();
  }
  return nextItem;
}

function getCanvasTreeDocumentItem(documentId) {
  const targetId = String(documentId || "").trim();
  if (!targetId) {
    return null;
  }
  return getCanvasTreeItems().find((item) => item.dataset.canvasDocumentId === targetId) || null;
}

function getCanvasTreeFolderItem(folderPath) {
  const targetPath = String(folderPath || "").trim();
  if (!targetPath) {
    return null;
  }
  return getCanvasTreeItems().find((item) => item.dataset.canvasTreeFolder === "true" && item.dataset.folderPath === targetPath) || null;
}

function getCanvasTreeParentItem(treeItem) {
  if (!(treeItem instanceof HTMLElement)) {
    return null;
  }
  const parentGroup = treeItem.closest('[role="group"]');
  if (!(parentGroup instanceof HTMLElement)) {
    return null;
  }
  const parentSection = parentGroup.parentElement;
  if (!(parentSection instanceof HTMLElement)) {
    return null;
  }
  return parentSection.querySelector(':scope > [data-canvas-tree-folder="true"]');
}

function getCanvasTreeFirstChildItem(treeItem) {
  if (!(treeItem instanceof HTMLElement)) {
    return null;
  }
  const section = treeItem.closest('.canvas-tree-node');
  if (!(section instanceof HTMLElement)) {
    return null;
  }
  return section.querySelector(':scope > [role="group"] [data-canvas-tree-item="true"]');
}

function restoreCanvasTreeFocus({ documentId = "", folderPath = "", firstChild = false } = {}) {
  globalThis.requestAnimationFrame(() => {
    let targetItem = null;
    if (documentId) {
      targetItem = getCanvasTreeDocumentItem(documentId);
    } else if (folderPath) {
      targetItem = getCanvasTreeFolderItem(folderPath);
      if (firstChild) {
        targetItem = getCanvasTreeFirstChildItem(targetItem) || targetItem;
      }
    }
    focusCanvasTreeItem(targetItem);
  });
}

function setCanvasTreeFolderExpanded(folderPath, expanded = null, { focusTarget = "self" } = {}) {
  const normalizedPath = String(folderPath || "").trim();
  if (!normalizedPath) {
    return;
  }
  const isExpanded = !collapsedCanvasFolders.has(normalizedPath);
  const nextExpanded = typeof expanded === "boolean" ? expanded : !isExpanded;
  if (nextExpanded) {
    collapsedCanvasFolders.delete(normalizedPath);
  } else {
    collapsedCanvasFolders.add(normalizedPath);
  }
  renderCanvasPanel();
  restoreCanvasTreeFocus({ folderPath: normalizedPath, firstChild: focusTarget === "child" });
}

function handleCanvasTreeItemKeydown(event) {
  const currentItem = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
  if (!currentItem) {
    return;
  }

  const items = getCanvasTreeItems().filter((item) => !item.disabled);
  if (!items.length) {
    return;
  }

  const currentIndex = items.indexOf(currentItem);
  const folderPath = String(currentItem.dataset.folderPath || "").trim();
  const isFolder = currentItem.dataset.canvasTreeFolder === "true";
  const isExpanded = currentItem.getAttribute("aria-expanded") === "true";

  if (event.key === "ArrowDown") {
    event.preventDefault();
    focusCanvasTreeItem(items[Math.min(currentIndex + 1, items.length - 1)]);
    return;
  }
  if (event.key === "ArrowUp") {
    event.preventDefault();
    focusCanvasTreeItem(items[Math.max(currentIndex - 1, 0)]);
    return;
  }
  if (event.key === "Home") {
    event.preventDefault();
    focusCanvasTreeItem(items[0]);
    return;
  }
  if (event.key === "End") {
    event.preventDefault();
    focusCanvasTreeItem(items[items.length - 1]);
    return;
  }
  if (event.key === "ArrowRight") {
    if (isFolder && !isExpanded) {
      event.preventDefault();
      setCanvasTreeFolderExpanded(folderPath, true);
      return;
    }
    if (isFolder && isExpanded) {
      const firstChild = getCanvasTreeFirstChildItem(currentItem);
      if (firstChild) {
        event.preventDefault();
        focusCanvasTreeItem(firstChild);
      }
    }
    return;
  }
  if (event.key === "ArrowLeft") {
    if (isFolder && isExpanded) {
      event.preventDefault();
      setCanvasTreeFolderExpanded(folderPath, false);
      return;
    }
    const parentItem = getCanvasTreeParentItem(currentItem);
    if (parentItem) {
      event.preventDefault();
      focusCanvasTreeItem(parentItem);
    }
    return;
  }
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    currentItem.click();
    return;
  }

  const isTypeAheadKey = event.key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey && /\S/.test(event.key);
  if (!isTypeAheadKey) {
    return;
  }

  const now = Date.now();
  const resetWindowMs = 700;
  lastCanvasTreeTypeAheadValue = now - lastCanvasTreeTypeAheadAt > resetWindowMs
    ? event.key.toLowerCase()
    : `${lastCanvasTreeTypeAheadValue}${event.key.toLowerCase()}`;
  lastCanvasTreeTypeAheadAt = now;

  const normalizedQuery = lastCanvasTreeTypeAheadValue;
  const searchPool = [...items.slice(currentIndex + 1), ...items.slice(0, currentIndex + 1)];
  const matchedItem = searchPool.find((item) => {
    const label = String(item.dataset.treeLabel || item.textContent || "").trim().toLowerCase();
    return label.startsWith(normalizedQuery);
  });
  if (matchedItem) {
    event.preventDefault();
    focusCanvasTreeItem(matchedItem);
  }
}

function renderCanvasTreeFile(document, depth, activeDocument) {
  const button = globalThis.document.createElement("button");
  const isActive = Boolean(activeDocument && activeDocument.id === document.id);
  const roleBadge = document.role ? `<span class="canvas-tree-file__role">${escHtml(document.role)}</span>` : "";
  const pathLabel = document.path ? `<span class="canvas-tree-file__path">${escHtml(document.path)}</span>` : "";

  button.type = "button";
  button.className = `canvas-tree-file${isActive ? " active" : ""}`;
  button.style.setProperty("--canvas-tree-depth", String(depth));
  button.disabled = canvasState.isCanvasEditing && !isActive;
  button.dataset.canvasTreeItem = "true";
  button.dataset.canvasDocumentId = document.id;
  button.dataset.treeLabel = getCanvasFileName(document).toLowerCase();
  button.setAttribute("role", "treeitem");
  button.setAttribute("aria-level", String(depth + 1));
  button.setAttribute("aria-selected", isActive ? "true" : "false");
  button.tabIndex = -1;
  button.innerHTML = `<span class="canvas-tree-file__name">${escHtml(getCanvasFileName(document))}</span>${roleBadge}${pathLabel}`;
  button.title = getCanvasDocumentLabel(document);
  button.addEventListener("click", () => {
    canvasState.activeCanvasDocumentId = document.id;
    if (isMobileViewport()) {
      setCanvasMobileTreeOpen(false);
    }
    renderCanvasPanel();
    if (isMobileViewport()) {
      canvasSearchInput?.focus();
    } else {
      restoreCanvasTreeFocus({ documentId: document.id });
    }
  });
  button.addEventListener("keydown", handleCanvasTreeItemKeydown);
  return button;
}

function renderCanvasTree(documents, activeDocument) {
  if (!canvasTreePanel || !canvasTreeEl) {
    return;
  }

  const shouldShowTree = getCanvasMode(documents) === "project" || (documents || []).length > 1;
  canvasTreePanel.hidden = !shouldShowTree;
  if (!shouldShowTree) {
    setCanvasMobileTreeOpen(false);
    canvasTreeEl.innerHTML = "";
    if (canvasTreeCount) {
      canvasTreeCount.textContent = "";
    }
    return;
  }

  if (!isMobileViewport()) {
    uiState.isCanvasMobileTreeOpen = false;
    canvasPanel?.classList.remove("canvas-panel--tree-open");
  }
  syncCanvasTreeToggleButton();

  const visibleDocuments = getCanvasVisibleDocuments(documents);
  if (canvasTreeCount) {
    canvasTreeCount.textContent = `${visibleDocuments.length} shown`;
  }
  if (!visibleDocuments.length) {
    canvasTreeEl.innerHTML = '<div class="canvas-tree-empty">No files match the current filters.</div>';
    return;
  }

  const tree = buildCanvasTreeNodes(visibleDocuments);
  const fragment = document.createDocumentFragment();

  const renderFolder = (folder, depth = 0) => {
    const section = document.createElement("section");
    const isCollapsed = collapsedCanvasFolders.has(folder.path);
    section.className = "canvas-tree-node";

    const header = document.createElement("button");
    const bodyId = `canvas-tree-group-${encodeURIComponent(String(folder.path || "root"))}`;
    header.type = "button";
    header.className = `canvas-tree-folder${isCollapsed ? " collapsed" : ""}`;
    header.style.setProperty("--canvas-tree-depth", String(depth));
    header.dataset.canvasTreeItem = "true";
    header.dataset.canvasTreeFolder = "true";
    header.dataset.folderPath = folder.path;
    header.dataset.treeLabel = folder.name.toLowerCase();
    header.setAttribute("role", "treeitem");
    header.setAttribute("aria-expanded", isCollapsed ? "false" : "true");
    header.setAttribute("aria-level", String(depth + 1));
    header.setAttribute("aria-controls", bodyId);
    header.tabIndex = -1;
    header.innerHTML = `<span class="canvas-tree-folder__caret">▾</span><span class="canvas-tree-folder__label">${escHtml(folder.name)}</span>`;
    header.addEventListener("click", () => {
      setCanvasTreeFolderExpanded(folder.path);
    });
    header.addEventListener("keydown", handleCanvasTreeItemKeydown);
    section.appendChild(header);

    if (!isCollapsed) {
      const body = document.createElement("div");
      body.id = bodyId;
      body.className = "canvas-tree-children";
      body.setAttribute("role", "group");
      Array.from(folder.folders.values())
        .sort((left, right) => left.name.localeCompare(right.name))
        .forEach((childFolder) => body.appendChild(renderFolder(childFolder, depth + 1)));
      folder.files
        .sort((left, right) => left.name.localeCompare(right.name))
        .forEach((entry) => body.appendChild(renderCanvasTreeFile(entry.document, depth + 1, activeDocument)));
      section.appendChild(body);
    }

    return section;
  };

  Array.from(tree.folders.values())
    .sort((left, right) => left.name.localeCompare(right.name))
    .forEach((folder) => fragment.appendChild(renderFolder(folder, 0)));
  tree.files
    .sort((left, right) => left.name.localeCompare(right.name))
    .forEach((entry) => fragment.appendChild(renderCanvasTreeFile(entry.document, 0, activeDocument)));

  canvasTreeEl.innerHTML = "";
  canvasTreeEl.appendChild(fragment);
  syncCanvasTreeTabStops();
}

function getStreamingCanvasPreviewFormat(document) {
  return document?.format === "code" ? "code" : "markdown";
}

function getStreamingCanvasPreviewLanguage(document) {
  return String(document?.language || "").trim().toLowerCase();
}

function getStreamingCanvasCodePreviewClassName(document) {
  const language = getStreamingCanvasPreviewLanguage(document);
  return `canvas-stream-code${language ? ` language-${language}` : ""}`;
}

function getStreamingCanvasPreviewLabel(document) {
  const format = getStreamingCanvasPreviewFormat(document);
  if (format === "code") {
    return String(document?.language || "Code draft").trim() || "Code draft";
  }
  return "Markdown draft";
}

function getStreamingCanvasPreviewText(document) {
  return String(document?.content || "").replace(/\r\n?/g, "\n");
}

function getStreamingCanvasPreviewPlaceholder(document) {
  return getStreamingCanvasPreviewFormat(document) === "code"
    ? "// Streaming code draft will appear here..."
    : "Streaming draft will appear here...";
}

function getStreamingCanvasPreviewDisplayText(document) {
  return getStreamingCanvasPreviewText(document) || getStreamingCanvasPreviewPlaceholder(document);
}

function countCanvasLines(text) {
  const normalizedText = String(text || "");
  return normalizedText ? normalizedText.split("\n").length : 0;
}

function countCanvasNewlines(text) {
  const matches = String(text || "").match(/\n/g);
  return matches ? matches.length : 0;
}

function getStreamingCanvasPreviewRenderMode(document) {
  const format = getStreamingCanvasPreviewFormat(document);
  if (format === "code") {
    return "code";
  }

  const previewText = getStreamingCanvasPreviewDisplayText(document);
  const storedLineCount = Number(document?.line_count);
  const lineCount = Number.isFinite(storedLineCount) && storedLineCount > 0
    ? storedLineCount
    : countCanvasLines(previewText);

  if (
    previewText.length > STREAMING_CANVAS_MARKDOWN_PLAIN_TEXT_CHAR_LIMIT
    || lineCount > STREAMING_CANVAS_MARKDOWN_PLAIN_TEXT_LINE_LIMIT
  ) {
    return "markdown-plain";
  }

  return "markdown";
}

function renderStreamingCanvasPreviewBody(document) {
  const previewText = getStreamingCanvasPreviewDisplayText(document);
  const renderMode = getStreamingCanvasPreviewRenderMode(document);
  if (renderMode === "code") {
    const codeClassName = getStreamingCanvasCodePreviewClassName(document);
    return `<pre class="canvas-stream-code-block"><code class="${escHtml(codeClassName)}">${escHtml(previewText)}</code></pre>`;
  }
  if (renderMode === "markdown-plain") {
    return `<pre class="canvas-stream-markdown-block"><code class="canvas-stream-markdown-text">${escHtml(previewText)}</code></pre>`;
  }
  return renderStreamingMarkdown(previewText);
}

function renderStreamingCanvasPreviewContent(document) {
  const format = getStreamingCanvasPreviewFormat(document);
  const renderMode = getStreamingCanvasPreviewRenderMode(document);
  return `<div class="canvas-stream-preview canvas-stream-preview--${format} canvas-stream-preview--${renderMode}" data-canvas-streaming-preview-body="true" data-canvas-streaming-preview-mode="${renderMode}">${renderStreamingCanvasPreviewBody(document)}</div>`;
}

function updateStreamingCanvasPreviewElement(containerEl, document) {
  if (!containerEl) {
    return;
  }

  const previewBody = containerEl.querySelector('[data-canvas-streaming-preview-body="true"]');
  if (!previewBody) {
    containerEl.innerHTML = renderStreamingCanvasPreviewContent(document);
    return;
  }

  const format = getStreamingCanvasPreviewFormat(document);
  const renderMode = getStreamingCanvasPreviewRenderMode(document);
  const previewText = getStreamingCanvasPreviewDisplayText(document);
  const previousRenderMode = String(previewBody.getAttribute("data-canvas-streaming-preview-mode") || "").trim();

  previewBody.className = `canvas-stream-preview canvas-stream-preview--${format} canvas-stream-preview--${renderMode}`;
  previewBody.setAttribute("data-canvas-streaming-preview-mode", renderMode);

  if (renderMode === "code" && previousRenderMode === renderMode) {
    const codeEl = previewBody.querySelector(".canvas-stream-code");
    if (codeEl) {
      codeEl.className = getStreamingCanvasCodePreviewClassName(document);
      codeEl.textContent = previewText;
      return;
    }
  }

  if (renderMode === "markdown-plain" && previousRenderMode === renderMode) {
    const previewTextEl = previewBody.querySelector(".canvas-stream-markdown-text");
    if (previewTextEl) {
      previewTextEl.textContent = previewText;
      return;
    }
  }

  previewBody.innerHTML = renderStreamingCanvasPreviewBody(document);
}

function renderStreamingCanvasDocumentBody(document) {
  const documentId = escHtml(String(document?.id || "").trim());
  const format = escHtml(String(document?.format || "markdown").trim().toLowerCase() || "markdown");
  return renderCanvasMarkdownSheet(renderStreamingCanvasPreviewContent(document), {
    extraClasses: ["canvas-page-sheet--streaming"],
    attributes: {
      "data-canvas-streaming-preview-container": "true",
      "data-canvas-streaming-preview-id": documentId,
      "data-canvas-streaming-preview-format": format,
    },
  });
}

function renderCanvasDocumentBody(document) {
  if (!document) {
    return "";
  }
  if (document.isStreamingPreview) {
    return renderStreamingCanvasDocumentBody(document);
  }
  if (document.format === "code") {
    return sanitizeHtml(`<div class="canvas-code-document">${renderHighlightedCodeBlock(document.content, document.language || null)}</div>`);
  }
  if (!isCanvasPageAwareDocument(document)) {
    return renderCanvasMarkdownSheet(renderMarkdown(document.content));
  }
  const currentPage = getCanvasCurrentPage(document) || setCanvasCurrentPage(document, 1);
  const currentSection = getCanvasPageSection(document, currentPage);
  const markdownHtml = renderMarkdown(currentSection?.content || document.content);
  return (
    `<div class="canvas-document-shell">` +
      `<div class="canvas-page-nav" data-canvas-page-nav>` +
        `<button type="button" class="canvas-page-nav__button" data-canvas-page-action="prev" aria-label="Previous page">&larr;</button>` +
        `<div class="canvas-page-nav__status" data-canvas-page-label>Page ${currentPage} / ${document.page_count}</div>` +
        `<button type="button" class="canvas-page-nav__button" data-canvas-page-action="next" aria-label="Next page">&rarr;</button>` +
      `</div>` +
      `<div class="canvas-page-content"><article class="canvas-page-sheet" data-canvas-page-sheet data-canvas-page-number="${currentPage}">${markdownHtml}</article></div>` +
    `</div>`
  );
}

function getCanvasDocumentById(documents, documentId) {
  const targetId = String(documentId || "").trim();
  if (!targetId) {
    return null;
  }
  return documents.find((document) => document.id === targetId) || null;
}

function setCanvasEditing(enabled) {
  if (enabled && guardCanvasMutation("edit the active file")) {
    return;
  }
  const activeDocument = getActiveCanvasDocument();
  if (enabled && activeDocument && !isCanvasDocumentEditable(activeDocument)) {
    setCanvasStatus("Visual canvas previews are read-only.", "muted");
    renderCanvasPanel();
    return;
  }
  if (enabled) {
    closeCanvasOverflowMenu();
    setCanvasMobileTreeOpen(false);
  }
  canvasState.isCanvasEditing = Boolean(enabled && activeDocument);
  canvasState.editingCanvasDocumentId = canvasState.isCanvasEditing ? activeDocument.id : null;
  if (canvasState.isCanvasEditing && canvasEditorEl) {
    canvasEditorEl.value = activeDocument.content || "";
  }
  renderCanvasPanel();
}

function cancelCanvasEditing({ statusMessage = "", tone = "muted" } = {}) {
  if (guardCanvasMutation("leave edit mode")) {
    return;
  }
  if (!canvasState.isCanvasEditing && !canvasState.editingCanvasDocumentId) {
    return;
  }
  clearCanvasEditingPreviewRender();
  canvasState.isCanvasEditing = false;
  canvasState.editingCanvasDocumentId = null;
  renderCanvasPanel();
  if (statusMessage) {
    setCanvasStatus(statusMessage, tone);
  }
}

function clearCanvasSearchInput({ statusMessage = "", tone = "muted" } = {}) {
  if (!canvasSearchInput?.value) {
    return false;
  }
  canvasSearchInput.value = "";
  renderCanvasPanel();
  if (statusMessage) {
    setCanvasSearchStatus(statusMessage, tone);
  }
  return true;
}

const CANVAS_UPLOAD_MARKDOWN_EXTENSIONS = new Set([".md", ".markdown", ".mdx", ".txt", ".rst", ".adoc", ".org"]);
const CANVAS_UPLOAD_LANGUAGE_MAP = {
  ".py": "python",
  ".pyw": "python",
  ".js": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".ts": "typescript",
  ".mts": "typescript",
  ".tsx": "tsx",
  ".jsx": "jsx",
  ".json": "json",
  ".jsonc": "json",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".html": "html",
  ".htm": "html",
  ".css": "css",
  ".sh": "bash",
  ".bash": "bash",
  ".zsh": "bash",
  ".sql": "sql",
  ".xml": "xml",
  ".toml": "toml",
  ".ini": "ini",
  ".cfg": "ini",
  ".c": "c",
  ".h": "c",
  ".cpp": "cpp",
  ".cc": "cpp",
  ".cxx": "cpp",
  ".hpp": "cpp",
  ".hh": "cpp",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".rb": "ruby",
  ".php": "php",
};

function getCanvasUploadExtension(fileName) {
  const normalizedName = String(fileName || "").trim().toLowerCase();
  const dotIndex = normalizedName.lastIndexOf(".");
  if (dotIndex < 0) {
    return "";
  }
  return normalizedName.slice(dotIndex);
}

function inferCanvasUploadFormat(fileName) {
  return CANVAS_UPLOAD_MARKDOWN_EXTENSIONS.has(getCanvasUploadExtension(fileName)) ? "markdown" : "code";
}

function inferCanvasUploadLanguage(fileName) {
  return CANVAS_UPLOAD_LANGUAGE_MAP[getCanvasUploadExtension(fileName)] || null;
}

function showPendingCanvasUploadPreview(fileName) {
  const nextTitle = String(fileName || "Uploaded file").trim() || "Uploaded file";
  const nextFormat = inferCanvasUploadFormat(nextTitle);
  const nextLanguage = inferCanvasUploadLanguage(nextTitle) || "";
  const preview = buildStreamingCanvasPreviewDocument("create_canvas_document", PENDING_CANVAS_UPLOAD_PREVIEW_KEY, {
    title: nextTitle,
    format: nextFormat,
    language: nextLanguage,
  });
  if (!preview) {
    return;
  }
  preview.content = nextFormat === "code"
    ? "// Upload is being processed..."
    : getCanvasUploadExtension(nextTitle) === ".pdf"
      ? `## Processing ${nextTitle}\n\nPreparing pages for Canvas...`
      : `# ${nextTitle}\n\nUploading file...`;
  preview.line_count = preview.content.split("\n").length;
  preview.page_count = 0;
  preview.isStreamingPreview = true;
  canvasState.streamingPreviews.set(PENDING_CANVAS_UPLOAD_PREVIEW_KEY, preview);
  canvasState.activeCanvasDocumentId = preview.id;
  canvasState.isCanvasEditing = false;
  canvasState.editingCanvasDocumentId = null;
  renderCanvasPanel();
}

function clearPendingCanvasUploadPreview() {
  if (!canvasState.streamingPreviews.has(PENDING_CANVAS_UPLOAD_PREVIEW_KEY)) {
    return;
  }
  canvasState.streamingPreviews.delete(PENDING_CANVAS_UPLOAD_PREVIEW_KEY);
}

function scheduleCanvasAutoRefreshAfterUpload(delay = 350) {
  if (!chatState.currentConvId) {
    return;
  }
  window.setTimeout(() => {
    if (!chatState.currentConvId || chatState.isStreaming || chatState.isFixing) {
      return;
    }
    void refreshConversationFromServer();
  }, delay);
}

function normalizeCanvasPathCandidate(value) {
  return String(value || "").trim().replace(/\\/g, "/").replace(/^\/+/, "");
}

function inferCanvasPathFromLabel(value) {
  const normalized = normalizeCanvasPathCandidate(value);
  if (!normalized) {
    return "";
  }
  if (normalized.includes("/")) {
    return normalized;
  }
  return /\.[a-z0-9]{1,10}$/i.test(normalized) ? normalized : "";
}

function getCanvasTitleFromPathOrLabel(value) {
  const normalized = normalizeCanvasPathCandidate(value);
  if (!normalized) {
    return "Untitled";
  }
  const parts = normalized.split("/").filter(Boolean);
  return String(parts[parts.length - 1] || normalized || "Untitled").trim() || "Untitled";
}

async function createCanvasDocumentFromData({ title, content, format, language = null, path = null, statusMessage = "Creating canvas file..." }) {
  if (!chatState.currentConvId) {
    setCanvasStatus("Conversation is not available yet.", "warning");
    return;
  }
  if (guardCanvasMutation("create another file")) {
    return;
  }

  cancelPendingConversationRefreshes();

  return withCanvasMutation("create", async () => {
    const response = await fetch(`/api/conversations/${chatState.currentConvId}/canvas`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title,
        content,
        format,
        language,
        path,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || "Canvas create failed.");
    }
    return payload;
  }, {
    statusMessage,
    successMessage: "Canvas file created.",
    buttonsToDisable: [canvasNewBtn, canvasUploadBtn],
    onSuccess: () => {
      clearPendingCanvasUploadPreview();
      scheduleCanvasAutoRefreshAfterUpload();
      globalThis.requestAnimationFrame(() => {
        if (!canvasEditorEl) {
          return;
        }
        canvasEditorEl.focus();
        const cursorPosition = canvasEditorEl.value.length;
        canvasEditorEl.setSelectionRange(cursorPosition, cursorPosition);
      });
    },
  });
}

async function createCanvasDocumentFromPrompt() {
  if (guardCanvasMutation("create another file")) {
    return;
  }
  const requestedPathOrName = String(globalThis.prompt("New canvas file path or name", "Untitled") || "").trim();
  if (!requestedPathOrName) {
    setCanvasStatus("Canvas file creation cancelled.", "muted");
    return;
  }

  const nextFormat = getCanvasFormatControlValue();
  const nextPath = inferCanvasPathFromLabel(requestedPathOrName) || null;
  await createCanvasDocumentFromData({
    title: getCanvasTitleFromPathOrLabel(requestedPathOrName),
    content: "",
    format: nextFormat,
    path: nextPath,
  });
}

async function createCanvasDocumentFromFile(file) {
  const nextPath = normalizeCanvasPathCandidate(file?.webkitRelativePath || file?.name || "") || null;
  const nextTitle = getCanvasTitleFromPathOrLabel(nextPath || file?.name || "Uploaded file");

  if (!chatState.currentConvId) {
    setCanvasStatus("Conversation is not available yet.", "warning");
    return;
  }
  if (guardCanvasMutation("upload another file")) {
    return;
  }

  cancelPendingConversationRefreshes();
  showPendingCanvasUploadPreview(nextTitle);

  return withCanvasMutation("upload", async () => {
    const formData = new FormData();
    formData.append("file", file, nextTitle);
    formData.append("title", nextTitle);
    if (nextPath) {
      formData.append("path", nextPath);
    }

    const response = await fetch(`/api/conversations/${chatState.currentConvId}/canvas`, {
      method: "POST",
      body: formData,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || "Canvas upload failed.");
    }
    return payload;
  }, {
    statusMessage: `Uploading ${nextTitle}...`,
    successMessage: "Canvas file created.",
    buttonsToDisable: [canvasNewBtn, canvasUploadBtn],
    onSuccess: () => {
      clearPendingCanvasUploadPreview();
      globalThis.requestAnimationFrame(() => {
        if (!canvasEditorEl) {
          return;
        }
        canvasEditorEl.focus();
        const cursorPosition = canvasEditorEl.value.length;
        canvasEditorEl.setSelectionRange(cursorPosition, cursorPosition);
      });
    },
    onError: () => {
      clearPendingCanvasUploadPreview();
    },
  });
}

async function importGithubRepositoryToCanvas() {
  if (!chatState.currentConvId) {
    setCanvasStatus("Conversation is not available yet.", "warning");
    return;
  }
  if (guardCanvasMutation("import a repository")) {
    return;
  }

  const repoUrl = String(globalThis.prompt("GitHub repository URL", "https://github.com/") || "").trim();
  if (!repoUrl) {
    setCanvasStatus("GitHub import cancelled.", "muted");
    return;
  }

  cancelPendingConversationRefreshes();

  return withCanvasMutation("import-github", async () => {
    const response = await fetch(`/api/conversations/${chatState.currentConvId}/canvas/import-github`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url: repoUrl }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || "GitHub import failed.");
    }
    return payload;
  }, {
    statusMessage: "Importing GitHub repository into Canvas...",
    buttonsToDisable: [canvasNewBtn, canvasUploadBtn, canvasImportGithubBtn],
    stateOverrides: {
      isCanvasEditing: false,
    },
    onSuccess: (payload) => {
      // Custom success message based on import result
      const importedCount = Number(payload.imported_count || 0);
      const primaryDocumentPath = String(payload.primary_document_path || "").trim();
      const statusParts = [`Imported ${importedCount} file${importedCount === 1 ? "" : "s"}`];
      if (primaryDocumentPath) {
        statusParts.push(`active: ${primaryDocumentPath}`);
      }
      setCanvasStatus(statusParts.join(" · "), "success");
      scheduleCanvasAutoRefreshAfterUpload();
    },
  });
}

function openCanvasUploadPicker() {
  if (guardCanvasMutation("upload a file")) {
    return;
  }
  if (!canvasUploadInput) {
    setCanvasStatus("File upload is not available.", "warning");
    return;
  }
  canvasUploadInput.value = "";
  canvasUploadInput.click();
}

function readCanvasWidthPreference() {
  try {
    const value = Number.parseInt(localStorage.getItem(CANVAS_PANEL_WIDTH_STORAGE_KEY) || "", 10);
    return Number.isFinite(value) ? value : CANVAS_PANEL_DEFAULT_WIDTH;
  } catch (_) {
    return CANVAS_PANEL_DEFAULT_WIDTH;
  }
}

function clampCanvasWidth(width) {
  const viewportLimit = Math.max(CANVAS_PANEL_MIN_WIDTH, globalThis.innerWidth - 24);
  return Math.min(Math.max(width, CANVAS_PANEL_MIN_WIDTH), Math.min(CANVAS_PANEL_MAX_WIDTH, viewportLimit));
}

function applyCanvasPanelWidth(width, persist = true) {
  if (!canvasPanel || globalThis.innerWidth <= 900) {
    if (canvasPanel) {
      canvasPanel.style.width = "";
    }
    return;
  }
  const nextWidth = clampCanvasWidth(width);
  canvasPanel.style.width = `${nextWidth}px`;
  if (persist) {
    try {
      localStorage.setItem(CANVAS_PANEL_WIDTH_STORAGE_KEY, String(nextWidth));
    } catch (_) {
      // Ignore storage errors.
    }
  }
}

function getCanvasDocuments(metadata) {
  if (!metadata || typeof metadata !== "object" || !Array.isArray(metadata.canvas_documents)) {
    return [];
  }

  return metadata.canvas_documents
    .map((document) => normalizeCanvasDocument(document))
    .filter((document) => document.id);
}

function getCanvasDocumentCollection(entries = chatState.history) {
  if (canvasState.streamingCanvasDocuments.length) {
    return canvasState.streamingCanvasDocuments;
  }

  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const message = entries[index];
    if (message?.metadata && message.metadata.canvas_cleared === true) {
      return [];
    }
    const documents = getCanvasDocuments(message?.metadata);
    if (!documents.length) {
      continue;
    }
    return documents;
  }

  return [];
}

function resetStreamingCanvasPreview() {
  canvasState.streamingPreviews.clear();
  clearCanvasRenderJob("preview");
}

function queueStreamingCanvasPreviewDelta(previewDocument, delta, replaceContent = false) {
  if (!previewDocument) {
    return false;
  }

  const nextDelta = String(delta || "");
  if (!replaceContent && !nextDelta) {
    return false;
  }

  if (replaceContent) {
    previewDocument.pendingContentReplacement = nextDelta;
    previewDocument.pendingContentAppends = [];
    return true;
  }

  if (!Array.isArray(previewDocument.pendingContentAppends)) {
    previewDocument.pendingContentAppends = [];
  }
  previewDocument.pendingContentAppends.push(nextDelta);
  return true;
}

function flushStreamingCanvasPreviewDelta(previewDocument) {
  if (!previewDocument || typeof previewDocument !== "object") {
    return false;
  }

  const hasReplacement = Object.prototype.hasOwnProperty.call(previewDocument, "pendingContentReplacement");
  const replacementContent = hasReplacement ? String(previewDocument.pendingContentReplacement || "") : "";
  const appendedContent = Array.isArray(previewDocument.pendingContentAppends)
    ? previewDocument.pendingContentAppends.join("")
    : "";
  if (!hasReplacement && !appendedContent) {
    return false;
  }

  const previousContent = String(previewDocument.content || "");
  let nextContent = hasReplacement ? replacementContent : previousContent;
  if (appendedContent) {
    nextContent += appendedContent;
  }
  previewDocument.content = nextContent;

  if (!nextContent) {
    previewDocument.line_count = 0;
  } else if (hasReplacement || !previousContent) {
    previewDocument.line_count = countCanvasLines(nextContent);
  } else {
    const currentLineCount = Number.isFinite(Number(previewDocument.line_count)) && Number(previewDocument.line_count) > 0
      ? Number(previewDocument.line_count)
      : countCanvasLines(previousContent);
    previewDocument.line_count = currentLineCount + countCanvasNewlines(appendedContent);
  }

  delete previewDocument.pendingContentReplacement;
  previewDocument.pendingContentAppends = [];
  return true;
}

function flushStreamingCanvasPreviewDeltas() {
  let changed = false;
  canvasState.streamingPreviews.forEach((previewDocument) => {
    if (flushStreamingCanvasPreviewDelta(previewDocument)) {
      changed = true;
    }
  });
  return changed;
}

function buildStreamingCanvasPreviewDocument(toolName, previewKey = "", snapshot = {}) {
  const normalizedToolName = String(toolName || "").trim();
  const normalizedPreviewKey = String(previewKey || "").trim() || "canvas-call-0";
  const snapshotData = snapshot && typeof snapshot === "object" ? snapshot : {};
  const allDocuments = getCanvasDocumentCollection(chatState.history);
  const activeDocument = getActiveCanvasDocument(chatState.history);

  // For edit operations, prefer the document explicitly identified in the
  // snapshot over the generic active doc.
  const needsTargetDoc = CANVAS_EDIT_PREVIEW_TOOLS.has(normalizedToolName);
  let targetDocument = activeDocument;
  if (needsTargetDoc) {
    const snapshotDocId = String(snapshotData.document_id || "").trim();
    const snapshotDocPath = String(snapshotData.document_path || "").trim();
    if (snapshotDocId) {
      targetDocument = getCanvasDocumentById(allDocuments, snapshotDocId) || activeDocument;
    } else if (snapshotDocPath) {
      targetDocument = allDocuments.find((d) => d.path === snapshotDocPath) || activeDocument;
    }
  }

  const isEditPreview = CANVAS_EDIT_PREVIEW_TOOLS.has(normalizedToolName) && targetDocument;
  const baseDocument = isEditPreview ? targetDocument : null;
  const normalized = normalizeStreamingCanvasPreviewDocument({
    id: baseDocument ? baseDocument.id : `streaming-canvas-preview-${normalizedPreviewKey}`,
    title: String(snapshotData.title || (baseDocument ? baseDocument.title : "Canvas draft")).trim() || "Canvas draft",
    path: String(snapshotData.path || (baseDocument ? baseDocument.path : "")).trim(),
    role: String(snapshotData.role || (baseDocument ? baseDocument.role : "note")).trim(),
    summary: baseDocument ? String(baseDocument.summary || "") : "",
    format: String(snapshotData.format || (baseDocument ? baseDocument.format : "markdown")).trim() || "markdown",
    language: String(snapshotData.language || (baseDocument ? baseDocument.language : "")).trim(),
    content: isEditPreview ? String(targetDocument.content || "") : "",
    source_message_id: baseDocument ? baseDocument.source_message_id : null,
  });
  return normalized ? { ...normalized, isStreamingPreview: true, tool: normalizedToolName, previewKey: normalizedPreviewKey } : null;
}

function applyStreamingCanvasPreviewSnapshot(previewDoc, snapshot = {}) {
  if (!previewDoc || !snapshot || typeof snapshot !== "object") {
    return false;
  }
  let changed = false;
  if (typeof snapshot.title === "string" && snapshot.title.trim()) {
    const nextTitle = snapshot.title.trim();
    if (nextTitle !== previewDoc.title) {
      previewDoc.title = nextTitle;
      changed = true;
    }
  }
  if (typeof snapshot.path === "string") {
    const nextPath = snapshot.path.trim().replace(/\\/g, "/");
    if (nextPath && nextPath !== previewDoc.path) {
      previewDoc.path = nextPath;
      changed = true;
    }
  }
  if (typeof snapshot.role === "string") {
    const nextRole = snapshot.role.trim().toLowerCase();
    if (nextRole && nextRole !== previewDoc.role) {
      previewDoc.role = nextRole;
      changed = true;
    }
  }
  if (typeof snapshot.format === "string") {
    const normalizedFormat = snapshot.format.trim().toLowerCase();
    const nextFormat = normalizedFormat === "code" ? "code" : "markdown";
    if (nextFormat !== previewDoc.format) {
      previewDoc.format = nextFormat;
      changed = true;
    }
  }
  if (typeof snapshot.language === "string") {
    const nextLanguage = snapshot.language.trim().toLowerCase();
    if (nextLanguage && nextLanguage !== previewDoc.language) {
      previewDoc.language = nextLanguage;
      changed = true;
    }
  }

  const normalizedPreview = normalizeStreamingCanvasPreviewDocument(previewDoc);
  if (normalizedPreview) {
    ["title", "path", "role", "format", "language", "summary"].forEach((key) => {
      if (normalizedPreview[key] !== previewDoc[key]) {
        previewDoc[key] = normalizedPreview[key];
        changed = true;
      }
    });
  }

  return changed;
}

function ensureStreamingCanvasPreview(toolName, previewKey = "", snapshot = {}) {
  const normalizedToolName = String(toolName || "").trim();
  const normalizedPreviewKey = String(previewKey || "").trim() || "canvas-call-0";
  if (!normalizedToolName) {
    return null;
  }
  const existing = canvasState.streamingPreviews.get(normalizedPreviewKey);

  // buildStreamingCanvasPreviewDocument does a full conversation-chatState.history scan to
  // locate the target canvas document. Calling it on every content-delta event is
  // the primary cause of main-thread blocking during canvas streaming, because a
  // fast model can emit hundreds of deltas per second. Skip the expensive rebuild
  // for all subsequent deltas once the preview is established and the tool name
  // still matches. Rebuild is only needed when the preview is first created or
  // when the active tool changes (extremely rare mid-stream).
  const needsRebuild = !existing || existing.tool !== normalizedToolName;
  let shouldRebuild = needsRebuild;
  let preview = existing;
  if (needsRebuild) {
    const rebuiltPreview = buildStreamingCanvasPreviewDocument(normalizedToolName, normalizedPreviewKey, snapshot);
    shouldRebuild = !existing
      || existing.tool !== normalizedToolName
      || (rebuiltPreview && rebuiltPreview.id && rebuiltPreview.id !== existing.id);
    if (shouldRebuild) {
      preview = rebuiltPreview;
      if (preview) {
        canvasState.streamingPreviews.set(normalizedPreviewKey, preview);
      }
    }
  }

  const isNewPreview = !existing || shouldRebuild;
  if (!preview) {
    return null;
  }
  applyStreamingCanvasPreviewSnapshot(preview, snapshot);
  // Only switch the active view to the streaming preview when a new streaming
  // operation starts. If the user has manually selected a different document
  // during an ongoing stream, do not force the view back to the preview.
  if (isNewPreview || canvasState.activeCanvasDocumentId === preview.id) {
    canvasState.activeCanvasDocumentId = preview.id;
  }
  return preview;
}

function getCanvasRenderableDocuments(entries = chatState.history) {
  const documents = getCanvasDocumentCollection(entries);
  if (!canvasState.streamingPreviews.size) {
    return documents;
  }
  let result = [...documents];
  for (const preview of canvasState.streamingPreviews.values()) {
    if (!preview?.id) {
      continue;
    }
    const previewIndex = result.findIndex((document) => document.id === preview.id);
    if (previewIndex >= 0) {
      result = [...result.slice(0, previewIndex), preview, ...result.slice(previewIndex + 1)];
    } else {
      result = [...result, preview];
    }
  }
  return result;
}

function buildCanvasStructureSignature(documents, visibleDocuments = documents) {
  const documentSignature = (documents || []).map((document) => [
    String(document.id || "").trim(),
    String(document.title || "").trim(),
    String(document.path || "").trim(),
    String(document.role || "").trim(),
    String(document.format || "").trim(),
    String(document.language || "").trim(),
    document.isStreamingPreview ? "preview" : "stored",
  ].join("\u241f")).join("\u241e");
  const visibleSignature = (visibleDocuments || []).map((document) => String(document.id || "").trim()).join("\u241e");
  const filterSignature = [
    String(canvasSearchInput?.value || "").trim(),
    String(canvasRoleFilter?.value || "").trim(),
    getCanvasPathFilterValue(),
    canvasState.isCanvasEditing ? "editing" : "view",
  ].join("\u241f");
  return [documentSignature, visibleSignature, filterSignature].join("\u241d");
}

function buildCanvasRenderState(documents = getCanvasRenderableDocuments()) {
  const visibleDocuments = getCanvasVisibleDocuments(documents);
  const preferredActiveId = [
    String(canvasState.activeCanvasDocumentId || "").trim(),
    String(getCanvasPreferredActiveDocumentId() || "").trim(),
  ].find(Boolean) || "";
  const activeDocument = visibleDocuments.length
    ? getCanvasDocumentById(visibleDocuments, preferredActiveId) || visibleDocuments[visibleDocuments.length - 1]
    : null;

  return {
    isCanvasPanelOpen: isCanvasOpen(),
    documents,
    visibleDocuments,
    activeDocument,
    isStreamingPreviewActive: Boolean(activeDocument?.isStreamingPreview),
    searchTerm: String(canvasSearchInput?.value || "").trim(),
    structureSignature: buildCanvasStructureSignature(documents, visibleDocuments),
  };
}

function clearDeferredCanvasRenderFlushTimer() {
  if (!canvasState.pendingFlushTimer) {
    return;
  }

  globalThis.clearTimeout(canvasState.pendingFlushTimer);
  canvasState.pendingFlushTimer = 0;
}

function shouldDeferCanvasRenderForStreaming() {
  // If the Canvas panel is already open, prioritize keeping the live draft
  // visually up to date. We still throttle preview paints separately, so this
  // only disables the hard defer that can otherwise starve the Canvas preview
  // while answer frames keep arriving back-to-back.
  return Boolean(chatState.isStreaming && activeAnswerRenderPending && !isCanvasOpen());
}

function scheduleDeferredCanvasRenderFlush(delay = CANVAS_STREAMING_RENDER_DEFER_INTERVAL_MS) {
  if (canvasState.pendingFlushTimer) {
    return;
  }

  const nextDelay = Math.max(CANVAS_STREAMING_RENDER_DEFER_INTERVAL_MS, Number(delay) || 0);
  canvasState.pendingFlushTimer = globalThis.setTimeout(() => {
    canvasState.pendingFlushTimer = 0;
    flushDeferredCanvasRenderWork();
  }, nextDelay);
}

function flushDeferredCanvasRenderWork() {
  if (shouldDeferCanvasRenderForStreaming()) {
    scheduleDeferredCanvasRenderFlush();
    return;
  }

  if (canvasState.deferredPanelRender) {
    canvasState.resetDeferred();
    renderCanvasPanel();
    if (canvasState.streamingPreviews.size) {
      scheduleCanvasPreviewRender({ allowWhileAnswerPending: true });
    }
    return;
  }

  if (canvasState.deferredPreviewRender) {
    canvasState.deferredPreviewRender = false;
    scheduleCanvasPreviewRender({ allowWhileAnswerPending: true });
  }
}

function requestCanvasPanelRender({ deferForStreaming = false } = {}) {
  const shouldDelayPanelRender = deferForStreaming && chatState.isStreaming && (activeAnswerRenderPending || chatState.activeAssistantStreamingHasVisibleAnswer);
  if (shouldDelayPanelRender) {
    canvasState.deferredPanelRender = true;
    scheduleDeferredCanvasRenderFlush();
    return false;
  }

  canvasState.resetDeferred();
  renderCanvasPanel();
  return true;
}

function scheduleCanvasPreviewRender(options = {}) {
  const allowWhileAnswerPending = options.allowWhileAnswerPending === true;
  if (!allowWhileAnswerPending && shouldDeferCanvasRenderForStreaming()) {
    canvasState.deferredPreviewRender = true;
    scheduleDeferredCanvasRenderFlush();
    return;
  }

  if (chatState.isStreaming && chatState.activeAssistantStreamingHasVisibleAnswer && canvasState.lastPreviewRenderAt > 0) {
    const elapsedMs = Date.now() - canvasState.lastPreviewRenderAt;
    if (elapsedMs < CANVAS_STREAMING_PREVIEW_THROTTLE_MS) {
      canvasState.deferredPreviewRender = true;
      scheduleDeferredCanvasRenderFlush(CANVAS_STREAMING_PREVIEW_THROTTLE_MS - elapsedMs);
      return;
    }
  }

  canvasState.deferredPreviewRender = false;
  scheduleCanvasRenderJob("preview", () => {
    canvasState.lastPreviewRenderAt = Date.now();
    renderCanvasPreviewFrame();
    if (canvasState.deferredPanelRender || canvasState.deferredPreviewRender) {
      scheduleDeferredCanvasRenderFlush();
    }
  });
}

function getActiveCanvasDocument(entries = chatState.history) {
  const documents = getCanvasDocumentCollection(entries);
  if (!documents.length) {
    return null;
  }

  const preferredId = String(canvasState.activeCanvasDocumentId || getCanvasPreferredActiveDocumentId(entries) || "").trim();
  if (preferredId) {
    const matched = documents.find((document) => document.id === preferredId);
    if (matched) {
      return matched;
    }
  }

  return documents[documents.length - 1];
}

function setCanvasStatus(message, tone = "muted") {
  if (!canvasStatus) {
    return;
  }
  canvasStatus.textContent = String(message || "").trim() || "Canvas idle";
  canvasStatus.dataset.tone = tone;
}

function setCanvasSearchStatus(message, tone = "muted") {
  if (!canvasSearchStatus) {
    return;
  }

  const text = String(message || "").trim();
  canvasSearchStatus.dataset.tone = tone;
  canvasSearchStatus.hidden = !text;
  canvasSearchStatus.textContent = text;
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
      filterParts.push(`search \"${searchTerm}\"`);
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

function describeCanvasActiveDocumentChange(previousDocument, nextDocument, requestedDocumentId = "") {
  if (!nextDocument) {
    return "";
  }

  const previousId = String(previousDocument?.id || "").trim();
  const nextId = String(nextDocument.id || "").trim();
  const requestedId = String(requestedDocumentId || "").trim();
  const nextLabel = getCanvasDocumentDisplayName(nextDocument);
  if (requestedId && requestedId === nextId && requestedId !== previousId) {
    return `Active canvas switched to ${nextLabel}.`;
  }
  if (previousId && previousId !== nextId) {
    return `Previous active canvas is unavailable. Focus moved to ${nextLabel}.`;
  }
  return "";
}

function setCanvasHint(message, tone = "muted") {
  if (!canvasHint) {
    return;
  }

  const text = String(message || "").trim();
  if (!text) {
    canvasHint.hidden = true;
    canvasHint.textContent = "";
    canvasHint.dataset.tone = tone;
    return;
  }

  canvasHint.hidden = false;
  canvasHint.textContent = text;
  canvasHint.dataset.tone = tone;
}

function getCanvasFormatControlValue() {
  return canvasFormatSelect?.value === "code" ? "code" : "markdown";
}

function isCanvasMutationPending() {
  return Boolean(canvasState.pendingCanvasMutation);
}

function getCanvasPendingMutationLabel() {
  return CANVAS_MUTATION_LABELS[canvasState.pendingCanvasMutation] || "canvas update";
}

function guardCanvasMutation(actionLabel = "continue") {
  if (!isCanvasMutationPending()) {
    return false;
  }
  const normalizedActionLabel = String(actionLabel || "").trim();
  const actionSuffix = normalizedActionLabel ? ` before you ${normalizedActionLabel}` : "";
  setCanvasStatus(`Please wait for the current ${getCanvasPendingMutationLabel()} to finish${actionSuffix}.`, "muted");
  return true;
}

function setCanvasMutationState(nextMutation = "", { rerender = true } = {}) {
  const normalizedMutation = String(nextMutation || "").trim();
  if (canvasState.pendingCanvasMutation === normalizedMutation) {
    return;
  }
  canvasState.pendingCanvasMutation = normalizedMutation;
  if (canvasPanel) {
    canvasPanel.setAttribute("aria-busy", normalizedMutation ? "true" : "false");
    if (normalizedMutation) {
      canvasPanel.dataset.canvasMutation = normalizedMutation;
    } else {
      delete canvasPanel.dataset.canvasMutation;
    }
  }
  if (rerender && isCanvasOpen()) {
    renderCanvasPanel();
  }
}

function setCanvasButtonState(button, { disabled, hidden } = {}) {
  if (!button) {
    return;
  }
  if (typeof disabled === "boolean") {
    button.disabled = disabled;
  }
  if (typeof hidden === "boolean") {
    button.hidden = hidden;
  }
}

/**
 * Canvas CRUD operasyonları için ortak wrapper.
 * 6 operasyon (create, upload, import-github, delete, rename, save) aynı
 * try/catch/setCanvasMutationState/re-render desenini tekrar ediyordu.
 *
 * @param {string} mutationType - Mutation state'i (örn. "create", "upload", "save")
 * @param {Function} operation - Async fonksiyon, API çağrısı yapmalı ve payload dövmeli
 * @param {Object} options
 * @param {string} options.statusMessage - Başlangıç status mesajı
 * @param {string} options.successMessage - Başarı status mesajı (opsiyonel, aksi halde varsayılan mesaj)
 * @param {Array} options.buttonsToDisable - İşlem sırasında devre dışı bırakılacak butonlar
 * @param {Function} options.onSuccess - Ek başarı işlemleri (payload, state güncellemelerinden sonra)
 * @param {Function} options.onError - Ek hata işlemleri (hata yakalandıktan sonra)
 * @param {boolean} options.skipHistoryUpdate - chatState.history'yi payload.messages'tan güncellemeyi atla
 * @param {boolean} options.skipCanvasUpdate - renderCanvasPanel çağrısını atla
 * @param {Object} options.stateOverrides - Başarı durumunda uygulanacak state override'ları (örn. { isCanvasEditing: false })
 */
async function withCanvasMutation(mutationType, operation, options = {}) {
  const {
    statusMessage = `${mutationType}...`,
    successMessage = null,
    buttonsToDisable = [],
    onSuccess = null,
    onError = null,
    skipHistoryUpdate = false,
    skipCanvasUpdate = false,
    stateOverrides = {},
  } = options;

  // Devre dışı bırakılacak butonları işaretle
  for (const btn of buttonsToDisable) {
    if (btn) btn.disabled = true;
  }

  setCanvasMutationState(mutationType);
  setCanvasStatus(statusMessage, "muted");

  try {
    const payload = await operation();

    setCanvasMutationState("", { rerender: false });

    if (!skipHistoryUpdate && Array.isArray(payload?.messages)) {
      chatState.history = payload.messages.map(normalizeHistoryEntry);
    }

    // Canvas state güncellemeleri (operasyonlarda ortak)
    // stateOverrides ile özelleştirilebilir (fonksiyon değerleri payload ile çağrılır)
    const computedState = {
      streamingCanvasDocuments: [],
      activeCanvasDocumentId: String(
        payload?.active_document_id || payload?.document?.id || ""
      ).trim() || null,
      isCanvasEditing: true,
      editingCanvasDocumentId: null,
    };
    // Apply stateOverrides (functions are called with payload)
    for (const [key, value] of Object.entries(stateOverrides)) {
      computedState[key] = typeof value === "function" ? value(payload) : value;
    }
    canvasState.streamingCanvasDocuments = computedState.streamingCanvasDocuments;
    canvasState.activeCanvasDocumentId = computedState.activeCanvasDocumentId;
    canvasState.isCanvasEditing = computedState.isCanvasEditing;
    canvasState.editingCanvasDocumentId = computedState.editingCanvasDocumentId;

    renderConversationHistory();
    if (!skipCanvasUpdate) {
      renderCanvasPanel();
    }

    // Call onSuccess first - if it returns false, skip default success handling
    let defaultSuccessMessage = successMessage || (payload?.message || `${mutationType} completed.`);
    if (onSuccess) {
      const onSuccessResult = await onSuccess(payload);
      if (onSuccessResult === false) {
        // onSuccess handled everything (status, renders) - don't overwrite
        return payload;
      }
      // If onSuccess returns a string, use it as the success message
      if (typeof onSuccessResult === "string") {
        defaultSuccessMessage = onSuccessResult;
      }
    }
    setCanvasStatus(defaultSuccessMessage, "success");

    return payload;
  } catch (error) {
    setCanvasMutationState("", { rerender: false });
    if (!skipCanvasUpdate) {
      renderCanvasPanel();
    }
    setCanvasStatus(error.message || `${mutationType} failed.`, "danger");

    if (onError) {
      await onError(error);
    }
  } finally {
    // Butonları yeniden etkinleştir
    for (const btn of buttonsToDisable) {
      if (btn) btn.disabled = false;
    }
  }
}

function setCanvasEmptyState(stateKey = "no_documents") {
  if (!canvasEmptyState) {
    return;
  }

  const state = CANVAS_EMPTY_STATES[stateKey] || CANVAS_EMPTY_STATES.no_documents;
  canvasEmptyState.hidden = false;
  canvasEmptyState.replaceChildren();
  const titleEl = document.createElement("h3");
  titleEl.textContent = String(state.title || "").trim();
  const messageEl = document.createElement("p");
  messageEl.textContent = String(state.message || "").trim();
  canvasEmptyState.append(titleEl, messageEl);
}

function syncCanvasFormControls({
  formatDisabled = false,
  formatValue = null,
  searchDisabled = false,
  roleDisabled = false,
  pathDisabled = false,
} = {}) {
  const isBusy = isCanvasMutationPending();
  if (canvasFormatSelect) {
    canvasFormatSelect.disabled = formatDisabled || isBusy;
    if (formatValue !== null) {
      canvasFormatSelect.value = formatValue === "code" ? "code" : "markdown";
    }
  }
  if (canvasSearchInput) {
    canvasSearchInput.disabled = searchDisabled || isBusy;
  }
  if (canvasRoleFilter) {
    canvasRoleFilter.disabled = roleDisabled || isBusy;
  }
  if (canvasPathFilter) {
    canvasPathFilter.disabled = pathDisabled || isBusy;
  }
}

function syncCanvasActionButtons({
  hasDocuments = false,
  hasActiveDocument = false,
  isEditing = false,
  isStreamingPreviewActive = false,
  isPanelOpen = false,
  canEditDocument = false,
  canCopyDocument = false,
} = {}) {
  const isBusy = isCanvasMutationPending();
  setCanvasButtonState(canvasEditBtn, {
    hidden: isEditing,
    disabled: !hasActiveDocument || isStreamingPreviewActive || !canEditDocument || isBusy,
  });
  setCanvasButtonState(canvasNewBtn, {
    hidden: false,
    disabled: isStreamingPreviewActive || isBusy,
  });
  setCanvasButtonState(canvasUploadBtn, {
    hidden: false,
    disabled: isStreamingPreviewActive || isBusy,
  });
  setCanvasButtonState(canvasImportGithubBtn, {
    hidden: false,
    disabled: isStreamingPreviewActive || isBusy,
  });
  setCanvasButtonState(canvasSaveBtn, {
    hidden: !isEditing,
    disabled: !isEditing || isStreamingPreviewActive || !hasActiveDocument || isBusy,
  });
  setCanvasButtonState(canvasCancelBtn, {
    hidden: !isEditing,
    disabled: !isEditing || isStreamingPreviewActive || isBusy,
  });
  setCanvasButtonState(canvasCopyBtn, {
    hidden: !isPanelOpen || !hasActiveDocument,
    disabled: !hasActiveDocument || isEditing || !canCopyDocument || isBusy,
  });
  setCanvasButtonState(canvasDeleteBtn, {
    disabled: !hasActiveDocument || isStreamingPreviewActive || isBusy,
  });
  setCanvasButtonState(canvasRenameBtn, {
    disabled: !hasActiveDocument || isEditing || isStreamingPreviewActive || isBusy,
  });
  setCanvasButtonState(canvasClearBtn, {
    disabled: !hasDocuments || isStreamingPreviewActive || isBusy,
  });
  setCanvasButtonState(canvasDownloadHtmlBtn, {
    disabled: !hasActiveDocument || isStreamingPreviewActive || isBusy,
  });
  setCanvasButtonState(canvasDownloadMdBtn, {
    disabled: !hasActiveDocument || isStreamingPreviewActive || isBusy,
  });
  setCanvasButtonState(canvasDownloadPdfBtn, {
    disabled: !hasActiveDocument || isStreamingPreviewActive || isBusy,
  });
}

function resetCanvasContentDisplay({ clearEditorValue = true, clearTabs = true } = {}) {
  clearCanvasEditingPreviewRender();
  canvasState.isCanvasEditing = false;
  canvasState.editingCanvasDocumentId = null;
  canvasWorkspaceMain?.classList.remove("canvas-workspace-main--editing");

  if (canvasEditorEl) {
    canvasEditorEl.classList.remove("canvas-editor--editing");
    canvasEditorEl.hidden = true;
    if (clearEditorValue) {
      canvasEditorEl.value = "";
    }
  }

  if (canvasDocumentEl) {
    canvasDocumentEl.hidden = true;
    canvasDocumentEl.classList.remove("canvas-document--editing-preview");
    canvasDocumentEl.innerHTML = "";
  }

  if (clearTabs && canvasDocumentTabsEl) {
    canvasDocumentTabsEl.hidden = true;
    canvasDocumentTabsEl.innerHTML = "";
  }
}

function renderCanvasUnavailableState({
  subtitle,
  emptyStateKey,
  documents = [],
  isStreamingPreviewActive = false,
  enableFilters = false,
  clearSearchStatus = false,
} = {}) {
  resetCanvasMetaBar();
  if (canvasSubtitle) {
    canvasSubtitle.textContent = subtitle;
  }
  setCanvasHint("");
  if (clearSearchStatus) {
    setCanvasSearchStatus("");
  }
  setCanvasEmptyState(emptyStateKey);
  resetCanvasContentDisplay();
  syncCanvasFormControls({
    formatDisabled: isStreamingPreviewActive,
    formatValue: getCanvasFormatControlValue(),
    searchDisabled: !enableFilters,
    roleDisabled: !enableFilters,
    pathDisabled: !enableFilters,
  });
  syncCanvasActionButtons({
    hasDocuments: documents.length > 0,
    hasActiveDocument: false,
    isEditing: false,
    isStreamingPreviewActive,
    isPanelOpen: isCanvasOpen(),
    canEditDocument: false,
    canCopyDocument: false,
  });
  closeCanvasOverflowMenu();
}

function clearCanvasRenderJob(jobType) {
  const timer = jobType === "editing-preview" ? canvasState.pendingEditorPreviewTimer : canvasState.pendingPreviewTimer;
  if (!timer) {
    return;
  }
  if (typeof globalThis.cancelAnimationFrame === "function") {
    globalThis.cancelAnimationFrame(timer);
  } else {
    globalThis.clearTimeout(timer);
  }
  if (jobType === "editing-preview") {
    canvasState.pendingEditorPreviewTimer = 0;
    return;
  }
  canvasState.pendingPreviewTimer = 0;
}

function scheduleCanvasRenderJob(jobType, callback) {
  const isEditingPreviewJob = jobType === "editing-preview";
  if (isEditingPreviewJob ? canvasState.pendingEditorPreviewTimer : canvasState.pendingPreviewTimer) {
    return;
  }

  const flushRenderJob = () => {
    if (isEditingPreviewJob) {
      canvasState.pendingEditorPreviewTimer = 0;
    } else {
      canvasState.pendingPreviewTimer = 0;
    }
    callback();
  };

  const timer = typeof globalThis.requestAnimationFrame === "function"
    ? globalThis.requestAnimationFrame(flushRenderJob)
    : globalThis.setTimeout(flushRenderJob, CANVAS_PREVIEW_RENDER_INTERVAL_MS);

  if (isEditingPreviewJob) {
    canvasState.pendingEditorPreviewTimer = timer;
    return;
  }
  canvasState.pendingPreviewTimer = timer;
}

function clearCanvasEditingPreviewRender() {
  clearCanvasRenderJob("editing-preview");
}

function getCanvasEditingPreviewDocument(activeDocument = getActiveCanvasDocument()) {
  if (!activeDocument || !canvasState.isCanvasEditing || !canvasEditorEl) {
    return activeDocument;
  }

  const previewFormat = getCanvasFormatControlValue();
  return normalizeCanvasDocument({
    ...activeDocument,
    format: previewFormat,
    content: canvasEditorEl.value,
  }) || activeDocument;
}

function scheduleCanvasEditingPreviewRender() {
  if (!canvasState.isCanvasEditing) {
    return;
  }

  scheduleCanvasRenderJob("editing-preview", () => {
    if (!canvasState.isCanvasEditing) {
      return;
    }
    const renderState = buildCanvasRenderState();
    if (!renderState.activeDocument) {
      renderCanvasPanel();
      return;
    }
    updateCanvasActiveDocumentDisplay(renderState);
  });
}

function setPendingDocumentCanvasOpen(files) {
  const documentItems = getDocumentCanvasPromptItems(files);
  if (!documentItems.length) {
    attachmentState.pendingDocumentCanvasOpen = null;
    return;
  }

  attachmentState.pendingDocumentCanvasOpen = {
    fileCount: documentItems.length,
    fileName: String(documentItems[0]?.name || "Document").trim() || "Document",
  };
}

async function toggleCanvasAlwaysExpanded(activeDocument) {
  if (!chatState.currentConvId || !activeDocument) return;
  const current = Boolean(activeDocument.always_expanded);
  const next = !current;
  try {
    const response = await fetch(`/api/conversations/${chatState.currentConvId}/canvas`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ document_id: activeDocument.id, always_expanded: next }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Update failed.");
    chatState.history = Array.isArray(payload.messages) ? payload.messages.map(normalizeHistoryEntry) : chatState.history;
    canvasState.activeCanvasDocumentId = String(payload.active_document_id || activeDocument.id || "").trim() || canvasState.activeCanvasDocumentId;
    renderConversationHistory({ preserveScroll: true });
    renderCanvasPanel();
    setCanvasStatus(next ? "Always expanded enabled — AI will receive the full document." : "Always expanded disabled.", "success");
  } catch (err) {
    setCanvasStatus(err.message || "Could not update always_expanded.", "danger");
  }
}

function renderCanvasMetaBar(renderState) {
  if (!canvasMetaBar || !canvasMetaChips) {
    return;
  }

  const { activeDocument: baseActiveDocument, documents, isStreamingPreviewActive, visibleDocuments } = renderState;
  if (!baseActiveDocument || !(documents || []).length) {
    resetCanvasMetaBar();
    return;
  }

  const activeDocument = getCanvasEditingPreviewDocument(baseActiveDocument);

  const modeLabel = getCanvasMode(documents) === "project" ? "Project mode" : "Document mode";
  const countLabel = visibleDocuments.length === documents.length
    ? `${documents.length} file${documents.length === 1 ? "" : "s"}`
    : `${visibleDocuments.length}/${documents.length} shown`;
  const chips = [
    { label: modeLabel, className: "canvas-meta-chip canvas-meta-chip--primary" },
    { label: countLabel, className: "canvas-meta-chip" },
  ];

  if (isStreamingPreviewActive) {
    chips.push({ label: "Live preview", className: "canvas-meta-chip canvas-meta-chip--live" });
  }
  if (Number(activeDocument.page_count) > 1) {
    chips.push({ label: `${activeDocument.page_count} pages`, className: "canvas-meta-chip" });
  }
  if (activeDocument.role) {
    chips.push({ label: activeDocument.role, className: "canvas-meta-chip" });
  }
  chips.push({ label: activeDocument.format === "code" ? "Code" : "Markdown", className: "canvas-meta-chip" });
  if (activeDocument.language) {
    chips.push({ label: activeDocument.language, className: "canvas-meta-chip" });
  }

  const reference = getCanvasDocumentLabel(activeDocument);
  if (reference) {
    chips.push({
      label: reference,
      className: "canvas-meta-chip canvas-meta-chip--path",
      title: reference,
    });
  }

  canvasMetaChips.innerHTML = chips.map((chip) => {
    const titleAttr = chip.title ? ` title="${escHtml(chip.title)}"` : "";
    return `<span class="${chip.className}"${titleAttr}>${escHtml(chip.label)}</span>`;
  }).join("");

  // Always-expanded toggle
  const isAlwaysExpanded = Boolean(activeDocument.always_expanded);
  let expandToggleEl = canvasMetaBar.querySelector(".canvas-meta-expand-toggle");
  if (!expandToggleEl) {
    expandToggleEl = globalThis.document.createElement("button");
    expandToggleEl.className = "canvas-meta-expand-toggle";
    expandToggleEl.type = "button";
    expandToggleEl.addEventListener("click", () => {
      const currentActiveDocument = getCanvasEditingPreviewDocument(getActiveCanvasDocument());
      toggleCanvasAlwaysExpanded(currentActiveDocument);
    });
    canvasMetaBar.appendChild(expandToggleEl);
  }
  expandToggleEl.textContent = isAlwaysExpanded ? "⊛ Always expanded" : "⊙ Always expanded";
  expandToggleEl.title = isAlwaysExpanded
    ? "AI always receives the full document. Click to disable."
    : "Enable so the AI always receives the full document content without truncation.";
  expandToggleEl.classList.toggle("canvas-meta-expand-toggle--on", isAlwaysExpanded);

  canvasMetaBar.hidden = false;

  if (canvasCopyRefBtn) {
    canvasCopyRefBtn.disabled = !reference;
    canvasCopyRefBtn.textContent = activeDocument.path ? "Copy path" : "Copy title";
  }
  if (canvasResetFiltersBtn) {
    canvasResetFiltersBtn.disabled = !hasActiveCanvasFilters();
  }
}

function renderCanvasDocumentTabs(visibleDocuments, allDocuments) {
  if (!canvasDocumentTabsEl) {
    return;
  }

  // In project mode the tree panel already handles navigation.
  // Show tabs only when there are a small number of files without paths.
  const isProjectMode = getCanvasMode(allDocuments || visibleDocuments) === "project";
  const MAX_FLAT_TABS = 8;
  if (isProjectMode || visibleDocuments.length <= 1 || visibleDocuments.length > MAX_FLAT_TABS) {
    canvasDocumentTabsEl.hidden = true;
    canvasDocumentTabsEl.innerHTML = "";
    return;
  }

  canvasDocumentTabsEl.hidden = false;
  canvasDocumentTabsEl.innerHTML = "";
  visibleDocuments.forEach((entry) => {
    const button = globalThis.document.createElement("button");
    button.type = "button";
    button.className = `canvas-document-tab${entry.id === canvasState.activeCanvasDocumentId ? " active" : ""}`;
    button.textContent = getCanvasFileName(entry);
    button.title = `${getCanvasDocumentLabel(entry)} · ${entry.line_count} lines`;
    button.disabled = canvasState.isCanvasEditing && entry.id !== canvasState.activeCanvasDocumentId;
    button.addEventListener("click", () => {
      canvasState.activeCanvasDocumentId = entry.id;
      renderCanvasPanel();
    });
    canvasDocumentTabsEl.appendChild(button);
  });
}

function updateCanvasActiveDocumentDisplay(renderState) {
  const {
    activeDocument,
    documents,
    isCanvasPanelOpen,
    isStreamingPreviewActive,
    searchTerm,
    visibleDocuments,
  } = renderState;

  const displayDocument = getCanvasEditingPreviewDocument(activeDocument);
  canvasState.activeCanvasDocumentId = activeDocument.id;
  canvasWorkspaceMain?.classList.toggle("canvas-workspace-main--editing", Boolean(canvasState.isCanvasEditing));
  const modeLabel = getCanvasMode(documents) === "project" ? "Project mode" : "Document mode";
  const detailLabel = displayDocument.path || displayDocument.title;
  const pageLabel = Number(displayDocument.page_count) > 1 ? ` · ${displayDocument.page_count} pages` : "";
  const roleLabel = displayDocument.role ? ` · ${displayDocument.role}` : "";
  const languageLabel = displayDocument.language ? ` · ${displayDocument.language}` : "";
  canvasSubtitle.textContent = `${modeLabel} · ${visibleDocuments.length}/${documents.length} files · ${detailLabel} · ${displayDocument.line_count} lines${pageLabel}${roleLabel}${languageLabel}`;
  renderCanvasMetaBar(renderState);
  const promptLineLimit = Number(appSettings.canvas_prompt_max_lines || 250);
  if (isStreamingPreviewActive) {
    const previewTool = String(displayDocument.tool || "").trim();
    setCanvasHint(
      CANVAS_EDIT_PREVIEW_TOOLS.has(previewTool)
        ? "Live Canvas edit preview. The preview updates as tool arguments stream in and is replaced by the committed document when the tool finishes."
        : "Live Canvas preview. The preview updates as the assistant streams content and is replaced by the committed document when the tool finishes.",
      "muted"
    );
  } else if (canvasState.isCanvasEditing) {
    setCanvasHint("Edit mode. Make changes and save to commit.", "muted");
  } else if (Number.isFinite(displayDocument.line_count) && displayDocument.line_count > promptLineLimit) {
    setCanvasHint(
      `Large canvas detected. The default view is truncated to the first ${promptLineLimit} lines. Use batch_read_canvas_documents with start_line and end_line for targeted ranges.`,
      "warning"
    );
  } else {
    setCanvasHint("");
  }
  canvasEmptyState.hidden = true;
  syncCanvasFormControls({
    formatDisabled: !canvasState.isCanvasEditing || isStreamingPreviewActive,
    formatValue: displayDocument.format || "markdown",
    searchDisabled: canvasState.isCanvasEditing || isStreamingPreviewActive,
    roleDisabled: canvasState.isCanvasEditing || isStreamingPreviewActive,
    pathDisabled: canvasState.isCanvasEditing || isStreamingPreviewActive,
  });

  if (canvasState.isCanvasEditing && canvasEditorEl) {
    if (canvasState.editingCanvasDocumentId !== activeDocument.id) {
      canvasState.editingCanvasDocumentId = activeDocument.id;
      canvasEditorEl.value = activeDocument.content || "";
    }
    canvasEditorEl.classList.add("canvas-editor--editing");
    canvasEditorEl.hidden = false;
    canvasDocumentEl.hidden = true;
  } else {
    canvasDocumentEl.classList.remove("canvas-document--editing-preview");
    canvasDocumentEl.hidden = false;
    if (activeDocument.isStreamingPreview) {
      const existingPreviewEl = canvasDocumentEl.querySelector('[data-canvas-streaming-preview-container="true"]');
      const existingPreviewId = String(existingPreviewEl?.getAttribute("data-canvas-streaming-preview-id") || "").trim();
      const existingPreviewFormat = String(existingPreviewEl?.getAttribute("data-canvas-streaming-preview-format") || "").trim();
      const nextPreviewId = String(activeDocument.id || "").trim();
      const nextPreviewFormat = String(activeDocument.format || "markdown").trim().toLowerCase() || "markdown";
      if (existingPreviewEl && existingPreviewId === nextPreviewId && existingPreviewFormat === nextPreviewFormat) {
        updateStreamingCanvasPreviewElement(existingPreviewEl, activeDocument);
      } else {
        canvasDocumentEl.innerHTML = renderStreamingCanvasDocumentBody(activeDocument);
      }
    } else {
      canvasDocumentEl.innerHTML = renderCanvasDocumentBody(activeDocument);
      bindCanvasPageNavigation(activeDocument);
    }
    if (canvasEditorEl) {
      canvasEditorEl.classList.remove("canvas-editor--editing");
      canvasEditorEl.hidden = true;
    }
  }

  const matchCount = !canvasState.isCanvasEditing && !isStreamingPreviewActive ? applyCanvasSearchHighlight(searchTerm) : 0;
  updateCanvasSearchFeedback(renderState, matchCount);
  const copySourceText = canvasState.isCanvasEditing && canvasEditorEl ? canvasEditorEl.value : displayDocument.content;
  syncCanvasActionButtons({
    hasDocuments: documents.length > 0,
    hasActiveDocument: Boolean(activeDocument),
    isEditing: canvasState.isCanvasEditing,
    isStreamingPreviewActive,
    isPanelOpen: isCanvasPanelOpen,
    canEditDocument: isCanvasDocumentEditable(displayDocument),
    canCopyDocument: Boolean(String(copySourceText || "").length),
  });
  closeCanvasOverflowMenu();
}

function buildCanvasDocListSignature(documents) {
  // A lightweight signature that only tracks document-list structure (IDs and
  // stored-vs-preview status). Used by renderCanvasPreviewFrame to distinguish
  // real structural changes (add/remove document) from streaming-preview metadata
  // changes (title, format, language updating as the model streams JSON fields).
  return (documents || [])
    .map((d) => `${String(d.id || "").trim()}\u241f${d.isStreamingPreview ? "preview" : "stored"}`)
    .join("\u241e");
}

function renderCanvasPreviewFrame() {
  if (!canvasDocumentEl || !canvasEmptyState || !canvasSubtitle) {
    return;
  }

  flushStreamingCanvasPreviewDeltas();
  const renderState = buildCanvasRenderState();
  if (!renderState.documents.length || !renderState.activeDocument || canvasState.isCanvasEditing || !renderState.isStreamingPreviewActive) {
    renderCanvasPanel();
    return;
  }

  if (renderState.structureSignature !== lastCanvasStructureSignature) {
    // Determine whether the signature change reflects a real structural change
    // (document added or removed) or merely metadata updates on the streaming
    // preview (title / format / language arriving as the model streams the JSON
    // argument fields). Real structural changes require a full panel rebuild for
    // the tree, tabs, and filter controls. Metadata-only changes can go through
    // the fast-path DOM update used for every other preview frame — the content
    // renderer already handles format/language transitions correctly.
    const currentDocListSig = buildCanvasDocListSignature(renderState.documents);
    if (currentDocListSig !== lastCanvasDocListSignature) {
      // Document list changed — full panel rebuild required.
      lastCanvasDocListSignature = currentDocListSig;
      renderCanvasPanel();
      return;
    }
    // Only metadata changed. Keep the full signature in sync so the next frame
    // still detects real structural changes, then fall through to the fast path.
    lastCanvasStructureSignature = renderState.structureSignature;
  }

  updateCanvasActiveDocumentDisplay(renderState);
}

function consumePendingDocumentCanvasOpen() {
  const pendingRequest = attachmentState.pendingDocumentCanvasOpen;
  attachmentState.pendingDocumentCanvasOpen = null;
  return pendingRequest;
}

function isCanvasConfirmOpen() {
  return Boolean(canvasConfirmModal?.classList.contains("open"));
}

function closeCanvasConfirmModal(action = "cancel", executeHandler = true) {
  if (!canvasConfirmModal) {
    return;
  }

  const pendingAction = uiState.pendingCanvasConfirmAction;
  uiState.pendingCanvasConfirmAction = null;
  canvasConfirmModal.classList.remove("open");
  canvasConfirmOverlay?.classList.remove("open");
  canvasConfirmModal.setAttribute("aria-hidden", "true");
  if (canvasConfirmOpenBtn) {
    canvasConfirmOpenBtn.textContent = DEFAULT_CANVAS_CONFIRM_LABEL;
  }
  if (canvasConfirmLaterBtn) {
    canvasConfirmLaterBtn.textContent = DEFAULT_CANVAS_CONFIRM_CANCEL_LABEL;
  }

  if (canvasState.lastCanvasConfirmTriggerEl && typeof canvasState.lastCanvasConfirmTriggerEl.focus === "function") {
    canvasState.lastCanvasConfirmTriggerEl.focus();
  }

  if (!executeHandler || !pendingAction) {
    return;
  }

  if (action === "confirm") {
    pendingAction.onConfirm?.();
    return;
  }

  if (action === "cancel") {
    pendingAction.onCancel?.();
    return;
  }

  pendingAction.onDismiss?.();
}

function openCanvasConfirmModal(options = {}) {
  if (!canvasConfirmModal || !canvasConfirmTitle || !canvasConfirmMessage) {
    options.onConfirm?.();
    return;
  }

  if (isCanvasConfirmOpen()) {
    closeCanvasConfirmModal("cancel", false);
  }

  closeMobileTools();
  closeExportPanel();
  closeStats();
  canvasState.lastCanvasConfirmTriggerEl = document.activeElement instanceof HTMLElement ? document.activeElement : attachBtn;
  uiState.pendingCanvasConfirmAction = {
    onConfirm: typeof options.onConfirm === "function" ? options.onConfirm : null,
    onCancel: typeof options.onCancel === "function" ? options.onCancel : null,
    onDismiss: typeof options.onDismiss === "function"
      ? options.onDismiss
      : typeof options.onCancel === "function"
        ? options.onCancel
        : null,
  };
  canvasConfirmTitle.textContent = String(options.title || "Open document in Canvas?").trim() || "Open document in Canvas?";
  canvasConfirmMessage.textContent = String(options.message || "Your uploaded document is ready in Canvas.").trim() || "Your uploaded document is ready in Canvas.";
  if (canvasConfirmOpenBtn) {
    canvasConfirmOpenBtn.textContent = String(options.confirmLabel || DEFAULT_CANVAS_CONFIRM_LABEL).trim() || DEFAULT_CANVAS_CONFIRM_LABEL;
  }
  if (canvasConfirmLaterBtn) {
    canvasConfirmLaterBtn.textContent = String(options.cancelLabel || DEFAULT_CANVAS_CONFIRM_CANCEL_LABEL).trim() || DEFAULT_CANVAS_CONFIRM_CANCEL_LABEL;
  }
  canvasConfirmModal.classList.add("open");
  canvasConfirmOverlay?.classList.add("open");
  canvasConfirmModal.setAttribute("aria-hidden", "false");
  canvasConfirmOpenBtn?.focus();
}

function promptPdfSubmissionMode(files) {
  const pdfFiles = (files || []).filter((file) => isPdfDocumentFile(file));
  if (!pdfFiles.length) {
    return Promise.resolve(true);
  }

  const requestLabel = pdfFiles.length === 1
    ? `How should ${String(pdfFiles[0]?.name || "this PDF").trim() || "this PDF"} be sent?`
    : `How should these ${pdfFiles.length} PDFs be sent?`;
  const message = pdfFiles.length === 1
    ? `Choose visual mode for page-image analysis with vision-capable models. Visual mode sends up to the first ${VISUAL_PDF_PAGE_LIMIT} pages as images, while text mode extracts text and keeps Canvas editing available.`
    : `Choose one mode for this PDF batch. Visual mode sends up to the first ${VISUAL_PDF_PAGE_LIMIT} pages of each PDF as images. Text mode extracts text and keeps Canvas editing available.`;

  return new Promise((resolve) => {
    openCanvasConfirmModal({
      title: requestLabel,
      message,
      confirmLabel: "Send visually",
      cancelLabel: "Send as text",
      onConfirm: () => {
        pdfFiles.forEach((file) => setDocumentSubmissionMode(file, "visual"));
        renderAttachmentPreview();
        resolve(true);
      },
      onCancel: () => {
        pdfFiles.forEach((file) => setDocumentSubmissionMode(file, "text"));
        renderAttachmentPreview();
        resolve(true);
      },
      onDismiss: () => resolve(false),
    });
  });
}

function normalizeDocumentCanvasPromptItem(item) {
  if (!item || typeof item !== "object") {
    return null;
  }

  if (typeof File !== "undefined" && item instanceof File) {
    if (!isDocumentFile(item)) {
      return null;
    }
    const fileName = String(item.name || "document").trim() || "document";
    return { name: fileName };
  }

  const kind = String(item.kind || "").trim().toLowerCase();
  if (kind && kind !== "document") {
    return null;
  }

  const fileName = String(item.file_name || item.name || "document").trim() || "document";
  return { name: fileName };
}

function getDocumentCanvasPromptItems(items) {
  return (items || [])
    .map((item) => normalizeDocumentCanvasPromptItem(item))
    .filter(Boolean);
}

function getExistingDocumentAttachmentsForCanvasPrompt(message) {
  return getMessageAttachments(message?.metadata).filter((attachment) => String(attachment.kind || "").trim().toLowerCase() === "document");
}

function promptDocumentCanvasAction(files) {
  const documentItems = getDocumentCanvasPromptItems(files);
  if (!documentItems.length) {
    return Promise.resolve("prompt");
  }

  if (!canvasConfirmModal || !canvasConfirmTitle || !canvasConfirmMessage) {
    return Promise.resolve("prompt");
  }

  const fileCount = documentItems.length;
  const fileName = String(documentItems[0]?.name || "document").trim() || "document";
  const requestLabel = fileCount > 1 ? `${fileCount} documents` : fileName;
  const pronoun = fileCount > 1 ? "them" : "it";

  return new Promise((resolve) => {
    openCanvasConfirmModal({
      title: "Open document in Canvas?",
      message: `${requestLabel} can be added to AI Canvas for editing and later reuse. Choose Later to keep ${pronoun} attached to this message only.`,
      onConfirm: () => resolve("open"),
      onCancel: () => resolve("skip"),
      onDismiss: () => resolve("skip"),
    });
  });
}

function setCanvasAttention(enabled) {
  canvasState.canvasHasUnreadUpdates = Boolean(enabled);
  if (canvasBtnIndicator) {
    canvasBtnIndicator.hidden = !canvasState.canvasHasUnreadUpdates;
  }
}

function isCanvasOpen() {
  return Boolean(canvasPanel?.classList.contains("open"));
}

function syncCanvasToggleButton() {
  if (!canvasToggleBtn) {
    return;
  }
  canvasToggleBtn.setAttribute("aria-expanded", String(isCanvasOpen()));
}

function canToggleCanvasTreeOnMobile() {
  return Boolean(isMobileViewport() && canvasTreePanel && !canvasTreePanel.hidden);
}

function syncCanvasTreeToggleButton() {
  if (!canvasTreeToggleBtn) {
    return;
  }
  const isAvailable = canToggleCanvasTreeOnMobile();
  if (!isAvailable) {
    uiState.isCanvasMobileTreeOpen = false;
    canvasPanel?.classList.remove("canvas-panel--tree-open");
  }
  canvasTreeToggleBtn.hidden = !isAvailable;
  canvasTreeToggleBtn.setAttribute("aria-expanded", isAvailable && uiState.isCanvasMobileTreeOpen ? "true" : "false");
  canvasTreeToggleBtn.textContent = isAvailable && uiState.isCanvasMobileTreeOpen ? "Hide files" : "Files";
}

function getCanvasZoomLevel() {
  const boundedIndex = Math.max(0, Math.min(CANVAS_ZOOM_LEVELS.length - 1, uiState.canvasZoomLevelIndex));
  return CANVAS_ZOOM_LEVELS[boundedIndex] || 1;
}

function applyCanvasViewportPreferences() {
  if (!canvasPanel) {
    return;
  }
  canvasPanel.style.setProperty("--canvas-doc-zoom", String(getCanvasZoomLevel()));
  canvasPanel.classList.toggle("canvas-panel--fullscreen", Boolean(uiState.isCanvasFullscreen));
}

function syncCanvasViewportControls() {
  applyCanvasViewportPreferences();
  const hasActiveDocument = Boolean(getActiveCanvasDocument());
  const showViewportControls = Boolean(isMobileViewport() && isCanvasOpen() && hasActiveDocument);
  const zoomPercent = Math.round(getCanvasZoomLevel() * 100);

  if (canvasViewportActionsGroupEl) {
    canvasViewportActionsGroupEl.hidden = !showViewportControls;
  }

  [canvasZoomOutBtn, canvasZoomInBtn, canvasFullscreenToggleBtn].forEach((button) => {
    if (!button) {
      return;
    }
    button.hidden = !showViewportControls;
    button.disabled = !showViewportControls;
  });

  if (canvasZoomOutBtn) {
    canvasZoomOutBtn.disabled = !showViewportControls || uiState.canvasZoomLevelIndex <= 0;
    canvasZoomOutBtn.title = `Zoom out (${zoomPercent}%)`;
  }
  if (canvasZoomInBtn) {
    canvasZoomInBtn.disabled = !showViewportControls || uiState.canvasZoomLevelIndex >= CANVAS_ZOOM_LEVELS.length - 1;
    canvasZoomInBtn.title = `Zoom in (${zoomPercent}%)`;
  }
  if (canvasFullscreenToggleBtn) {
    canvasFullscreenToggleBtn.setAttribute("aria-pressed", uiState.isCanvasFullscreen ? "true" : "false");
    canvasFullscreenToggleBtn.setAttribute("data-icon", uiState.isCanvasFullscreen ? "⤡" : "⤢");
    canvasFullscreenToggleBtn.textContent = uiState.isCanvasFullscreen ? "Exit full screen" : "Full screen";
    canvasFullscreenToggleBtn.title = uiState.isCanvasFullscreen ? "Exit full screen" : "Full screen";
  }
}

function setCanvasZoomLevelIndex(nextIndex) {
  const boundedIndex = Math.max(0, Math.min(CANVAS_ZOOM_LEVELS.length - 1, Number(nextIndex) || 0));
  if (boundedIndex === uiState.canvasZoomLevelIndex) {
    syncCanvasViewportControls();
    return;
  }
  uiState.canvasZoomLevelIndex = boundedIndex;
  syncCanvasViewportControls();
}

function toggleCanvasFullscreen(force = null) {
  const nextValue = force === null ? !uiState.isCanvasFullscreen : Boolean(force);
  if (nextValue === uiState.isCanvasFullscreen) {
    syncCanvasViewportControls();
    return;
  }
  uiState.isCanvasFullscreen = nextValue;
  syncCanvasViewportControls();
  requestCanvasPanelRender({ deferForStreaming: false });
}

function setCanvasMobileTreeOpen(isOpen) {
  const shouldOpen = Boolean(canToggleCanvasTreeOnMobile() && isOpen);
  uiState.isCanvasMobileTreeOpen = shouldOpen;
  canvasPanel?.classList.toggle("canvas-panel--tree-open", shouldOpen);
  syncCanvasTreeToggleButton();
}

function getCanvasFocusableElements() {
  if (!canvasPanel) {
    return [];
  }
  return Array.from(
    canvasPanel.querySelectorAll(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  ).filter((element) => !element.hasAttribute("hidden") && element.getAttribute("aria-hidden") !== "true");
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

function renderCanvasPanel() {
  if (!canvasDocumentEl || !canvasEmptyState || !canvasSubtitle) {
    return;
  }

  syncCanvasViewportControls();

  flushStreamingCanvasPreviewDeltas();
  const documents = getCanvasRenderableDocuments();
  syncCanvasFilterControls(documents);
  const renderState = buildCanvasRenderState(documents);
  const {
    activeDocument,
    documents: renderDocuments,
    isStreamingPreviewActive,
    visibleDocuments,
  } = renderState;
  lastCanvasStructureSignature = renderState.structureSignature;
  lastCanvasDocListSignature = buildCanvasDocListSignature(renderDocuments);

  renderCanvasTree(renderDocuments, activeDocument);
  if (!renderDocuments.length) {
    renderCanvasUnavailableState({
      subtitle: "No canvas document yet.",
      emptyStateKey: "no_documents",
      documents: renderDocuments,
      isStreamingPreviewActive,
      enableFilters: false,
      clearSearchStatus: true,
    });
    syncCanvasViewportControls();
    return;
  }

  if (!activeDocument) {
    const modeLabel = getCanvasMode(renderDocuments) === "project" ? "Project mode" : "Document mode";
    renderCanvasUnavailableState({
      subtitle: `${modeLabel} · ${renderDocuments.length} file${renderDocuments.length === 1 ? "" : "s"} · no matches`,
      emptyStateKey: "no_matches",
      documents: renderDocuments,
      isStreamingPreviewActive,
      enableFilters: true,
    });
    updateCanvasSearchFeedback(renderState, 0);
    syncCanvasViewportControls();
    return;
  }

  updateCanvasActiveDocumentDisplay(renderState);
  renderCanvasDocumentTabs(visibleDocuments, renderDocuments);
  syncCanvasViewportControls();
}

function openCanvas(triggerEl = null, options = {}) {
  const shouldFocusPanel = options.focusPanel !== false;
  closeSummaryPanel();
  
  closeMobileTools();
  closeCanvasConfirmModal("cancel", false);
  closeStats();
  closeExportPanel();
  closeSidebarOnMobile();
  canvasPanel?.classList.add("open");
  canvasOverlay?.classList.add("open");
  canvasPanel?.setAttribute("aria-hidden", "false");
  syncCanvasToggleButton();
  canvasState.lastCanvasTriggerEl = triggerEl instanceof HTMLElement
    ? triggerEl
    : (document.activeElement instanceof HTMLElement ? document.activeElement : mobileToolsBtn);
  setCanvasAttention(false);
  setCanvasMobileTreeOpen(false);
  applyCanvasPanelWidth(readCanvasWidthPreference(), false);
  closeCanvasOverflowMenu();
  requestCanvasPanelRender({ deferForStreaming: options.deferPanelRender !== false });
  syncCanvasViewportControls();
  if (shouldFocusPanel) {
    canvasClose?.focus();
  }
}

function closeCanvas() {
  clearCanvasEditingPreviewRender();
  canvasState.isCanvasEditing = false;
  canvasState.editingCanvasDocumentId = null;
  canvasWorkspaceMain?.classList.remove("canvas-workspace-main--editing");
  canvasEditorEl?.classList.remove("canvas-editor--editing");
  canvasDocumentEl?.classList.remove("canvas-document--editing-preview");
  setCanvasMobileTreeOpen(false);
  uiState.isCanvasFullscreen = false;
  canvasPanel?.classList.remove("open");
  canvasOverlay?.classList.remove("open");
  canvasPanel?.setAttribute("aria-hidden", "true");
  closeCanvasOverflowMenu();
  syncCanvasToggleButton();
  syncCanvasViewportControls();
  if (canvasCopyBtn) {
    canvasCopyBtn.hidden = true;
  }
  if (canvasState.lastCanvasTriggerEl && typeof canvasState.lastCanvasTriggerEl.focus === "function") {
    canvasState.lastCanvasTriggerEl.focus();
  }
}

function isCanvasOverflowMenuOpen() {
  return Boolean(canvasOverflowMenu && !canvasOverflowMenu.hidden);
}

function getCanvasOverflowMenuItems() {
  if (!canvasOverflowMenu) {
    return [];
  }
  return Array.from(canvasOverflowMenu.querySelectorAll('[role="menuitem"]')).filter((item) => {
    if (!(item instanceof HTMLElement) || item.hidden || item.getAttribute("aria-hidden") === "true") {
      return false;
    }
    if ("disabled" in item && item.disabled) {
      return false;
    }
    return true;
  });
}

function focusCanvasOverflowMenuItem(target = "first") {
  const items = getCanvasOverflowMenuItems();
  if (!items.length) {
    return;
  }
  if (target === "last") {
    items[items.length - 1].focus();
    return;
  }
  items[0].focus();
}

function closeCanvasOverflowMenu({ restoreFocus = false } = {}) {
  if (!canvasOverflowMenu || !canvasMoreBtn) {
    return;
  }
  canvasOverflowMenu.hidden = true;
  canvasOverflowMenu.classList.remove("open");
  canvasMoreBtn.setAttribute("aria-expanded", "false");
  if (restoreFocus) {
    canvasMoreBtn.focus();
  }
}

function openCanvasOverflowMenu({ focusTarget = null } = {}) {
  if (!canvasOverflowMenu || !canvasMoreBtn) {
    return;
  }
  canvasOverflowMenu.hidden = false;
  canvasOverflowMenu.classList.add("open");
  canvasMoreBtn.setAttribute("aria-expanded", "true");
  if (focusTarget) {
    globalThis.requestAnimationFrame(() => {
      focusCanvasOverflowMenuItem(focusTarget);
    });
  }
}

function moveCanvasOverflowMenuFocus(step = 1) {
  const items = getCanvasOverflowMenuItems();
  if (!items.length) {
    return;
  }
  const currentIndex = items.indexOf(document.activeElement);
  const baseIndex = currentIndex >= 0 ? currentIndex : (step < 0 ? 0 : -1);
  const nextIndex = (baseIndex + step + items.length) % items.length;
  items[nextIndex].focus();
}

function handleCanvasOverflowMenuKeydown(event) {
  if (!isCanvasOverflowMenuOpen()) {
    return;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    closeCanvasOverflowMenu({ restoreFocus: true });
    return;
  }
  if (event.key === "ArrowDown") {
    event.preventDefault();
    moveCanvasOverflowMenuFocus(1);
    return;
  }
  if (event.key === "ArrowUp") {
    event.preventDefault();
    moveCanvasOverflowMenuFocus(-1);
    return;
  }
  if (event.key === "Home") {
    event.preventDefault();
    focusCanvasOverflowMenuItem("first");
    return;
  }
  if (event.key === "End") {
    event.preventDefault();
    focusCanvasOverflowMenuItem("last");
  }
}

function toggleCanvasOverflowMenu(options = {}) {
  if (isCanvasOverflowMenuOpen()) {
    closeCanvasOverflowMenu();
    return;
  }
  if (uiState.isCanvasMobileTreeOpen) {
    setCanvasMobileTreeOpen(false);
  }
  openCanvasOverflowMenu(options);
}

async function deleteCanvasDocuments({ documentId = null, clearAll = false, confirmed = false } = {}) {
  if (!chatState.currentConvId) {
    setCanvasStatus("Canvas is not available yet.", "warning");
    return;
  }

  const activeDocument = getActiveCanvasDocument();
  const targetDocumentId = documentId || activeDocument?.id || null;
  if (!clearAll && !targetDocumentId) {
    setCanvasStatus("No canvas document is available to delete.", "warning");
    return;
  }
  if (guardCanvasMutation(clearAll ? "clear Canvas" : "delete the active file")) {
    return;
  }

  if (!confirmed) {
    openCanvasConfirmModal({
      title: "Are you sure?",
      message: clearAll
        ? "This will permanently remove every file from Canvas."
        : `This will permanently remove ${activeDocument?.title || "this canvas document"} from Canvas.`,
      confirmLabel: clearAll ? "Clear all" : "Delete",
      cancelLabel: "Cancel",
      onConfirm: () => {
        void deleteCanvasDocuments({ documentId: targetDocumentId, clearAll, confirmed: true });
      },
    });
    return;
  }

  cancelPendingConversationRefreshes();

  return withCanvasMutation(clearAll ? "clear" : "delete", async () => {
    const params = new URLSearchParams();
    if (targetDocumentId) {
      params.set("document_id", targetDocumentId);
    }
    if (clearAll) {
      params.set("clear_all", "true");
    }

    const query = params.toString();
    const response = await fetch(`/api/conversations/${chatState.currentConvId}/canvas${query ? `?${query}` : ""}`, {
      method: "DELETE",
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || "Canvas delete failed.");
    }
    return payload;
  }, {
    statusMessage: clearAll ? "Clearing Canvas..." : "Deleting document...",
    stateOverrides: {
      isCanvasEditing: false,
      activeCanvasDocumentId: payload => (
        payload.cleared
          ? null
          : String(payload?.active_document_id || getActiveCanvasDocument(chatState.history)?.id || "").trim() || null
      ),
    },
    onSuccess: (payload) => {
      if (payload.cleared) {
        // Return false to skip wrapper's default success handling (original had early return)
        setCanvasAttention(false);
        setCanvasStatus("Canvas cleared.", "success");
        return false;
      }
      setCanvasStatus("Canvas document deleted.", "success");
    },
  });
}

async function renameCanvasDocument() {
  const activeDocument = getActiveCanvasDocument();
  if (!chatState.currentConvId || !activeDocument) {
    setCanvasStatus("No canvas document to rename.", "warning");
    return;
  }
  if (guardCanvasMutation("rename the active file")) {
    return;
  }
  const currentTitle = String(activeDocument.path || activeDocument.title || "").trim() || "Untitled";
  const nextTitle = String(globalThis.prompt("Rename document", currentTitle) || "").trim();
  if (!nextTitle || nextTitle === currentTitle) {
    return;
  }

  return withCanvasMutation("rename", async () => {
    const response = await fetch(`/api/conversations/${chatState.currentConvId}/canvas`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ document_id: activeDocument.id, title: nextTitle }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || "Rename failed.");
    }
    return payload;
  }, {
    statusMessage: "Renaming...",
    stateOverrides: {
      // Use activeDocument.id as fallback (different from other operations)
      activeCanvasDocumentId: payload => String(payload?.active_document_id || activeDocument.id || "").trim() || canvasState.activeCanvasDocumentId,
    },
    onSuccess: () => {
      renderConversationHistory({ preserveScroll: true });
      setCanvasStatus(`Renamed to "${nextTitle}".`, "success");
    },
  });
}

async function saveCanvasEdits() {
  const activeDocument = getActiveCanvasDocument();
  if (!chatState.currentConvId || !activeDocument || !canvasEditorEl) {
    setCanvasStatus("Canvas document is not available yet.", "warning");
    return;
  }
  if (guardCanvasMutation("save the active file again")) {
    return;
  }

  const nextContent = canvasEditorEl.value.replace(/\r\n?/g, "\n");
  const nextFormat = getCanvasFormatControlValue();
  cancelPendingConversationRefreshes();

  return withCanvasMutation("save", async () => {
    const response = await fetch(`/api/conversations/${chatState.currentConvId}/canvas`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        document_id: activeDocument.id,
        content: nextContent,
        format: nextFormat,
        language: activeDocument.language || null,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || "Canvas save failed.");
    }
    return payload;
  }, {
    statusMessage: "Saving canvas edits...",
    stateOverrides: {
      isCanvasEditing: false,
      editingCanvasDocumentId: null,
      activeCanvasDocumentId: payload => String(payload?.active_document_id || activeDocument.id).trim() || activeDocument.id,
    },
    onSuccess: () => {
      setCanvasStatus("Canvas saved.", "success");
    },
  });
}
