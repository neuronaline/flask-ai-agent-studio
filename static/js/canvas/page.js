// canvas/page.js — Page-aware document navigation

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
    const prevBtn = canvasDocumentEl.querySelector('[data-canvas-page-action="prev"]');
    const nextBtn = canvasDocumentEl.querySelector('[data-canvas-page-action="next"]');
    if (prevBtn) {
      prevBtn.onclick = () => scrollCanvasToPage(document, getCanvasCurrentPage(document) - 1, "auto");
    }
    if (nextBtn) {
      nextBtn.onclick = () => scrollCanvasToPage(document, getCanvasCurrentPage(document) + 1, "auto");
    }
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

  const prevBtn = canvasDocumentEl.querySelector('[data-canvas-page-action="prev"]');
  const nextBtn = canvasDocumentEl.querySelector('[data-canvas-page-action="next"]');
  if (prevBtn) {
    prevBtn.onclick = () => scrollCanvasToPage(document, getCanvasCurrentPage(document) - 1);
  }
  if (nextBtn) {
    nextBtn.onclick = () => scrollCanvasToPage(document, getCanvasCurrentPage(document) + 1);
  }

  updateCanvasPageNavigationUi(document);
  canvasDocumentEl.onscroll = () => scheduleCanvasPageSync(document);
  if (getCanvasCurrentPage(document) > 1) {
    scrollCanvasToPage(document, getCanvasCurrentPage(document), "auto");
  } else {
    syncCanvasCurrentPageFromScroll(document);
  }
}
