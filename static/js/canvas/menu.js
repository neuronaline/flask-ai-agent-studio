// canvas/menu.js — Overflow menu

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
