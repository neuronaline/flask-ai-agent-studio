// canvas/tree.js — Tree view rendering & keyboard navigation

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

  // A file entry can share its name with a sibling folder (e.g. a root-level file
  // "src" next to a "src/" directory). Mark those entries so the renderer can
  // visually distinguish the file from the folder.
  const markFolderCollisions = (node) => {
    const folderNames = new Set(node.folders.keys());
    node.files.forEach((entry) => {
      entry.hasFolderCollision = folderNames.has(entry.name);
    });
    node.folders.forEach((folder) => markFolderCollisions(folder));
  };
  markFolderCollisions(root);

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

function renderCanvasTreeFile(document, depth, activeDocument, hasFolderCollision = false) {
  const button = globalThis.document.createElement("button");
  const isActive = Boolean(activeDocument && activeDocument.id === document.id);
  const roleBadge = document.role ? `<span class="canvas-tree-file__role">${escHtml(document.role)}</span>` : "";
  const pathLabel = document.path ? `<span class="canvas-tree-file__path">${escHtml(document.path)}</span>` : "";
  const collisionBadge = hasFolderCollision
    ? '<span class="canvas-tree-file__collision" title="A folder with the same name exists at this level">(file)</span>'
    : "";

  button.type = "button";
  button.className = `canvas-tree-file${isActive ? " active" : ""}${hasFolderCollision ? " canvas-tree-file--collision" : ""}`;
  button.style.setProperty("--canvas-tree-depth", String(depth));
  button.disabled = canvasState.isCanvasEditing && !isActive;
  button.dataset.canvasTreeItem = "true";
  button.dataset.canvasDocumentId = document.id;
  button.dataset.treeLabel = getCanvasFileName(document).toLowerCase();
  button.setAttribute("role", "treeitem");
  button.setAttribute("aria-level", String(depth + 1));
  button.setAttribute("aria-selected", isActive ? "true" : "false");
  button.tabIndex = -1;
  button.innerHTML = `<span class="canvas-tree-file__name">${escHtml(getCanvasFileName(document))}</span>${collisionBadge}${roleBadge}${pathLabel}`;
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
        .forEach((entry) => body.appendChild(renderCanvasTreeFile(entry.document, depth + 1, activeDocument, entry.hasFolderCollision)));
      section.appendChild(body);
    }

    return section;
  };

  Array.from(tree.folders.values())
    .sort((left, right) => left.name.localeCompare(right.name))
    .forEach((folder) => fragment.appendChild(renderFolder(folder, 0)));
  tree.files
    .sort((left, right) => left.name.localeCompare(right.name))
    .forEach((entry) => fragment.appendChild(renderCanvasTreeFile(entry.document, 0, activeDocument, entry.hasFolderCollision)));

  canvasTreeEl.innerHTML = "";
  canvasTreeEl.appendChild(fragment);
  syncCanvasTreeTabStops();
}
