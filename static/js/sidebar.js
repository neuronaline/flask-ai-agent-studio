/**
 * Sidebar module — conversation list rendering, rename, and sidebar management.
 * Depends on: state.js, utils.js (escHtml), DOM: sidebarList, activeSidebarRename
 */

/* ------------------------------------------------------------------ */
/*  Sidebar Rendering                                                  */
/* ------------------------------------------------------------------ */

/**
 * Fetches conversation list and rebuilds the sidebar.
 */
async function loadSidebar() {
  cancelSidebarRename();
  try {
    const response = await fetch("/api/conversations");
    const list = await response.json();
    sidebarList.innerHTML = "";
    if (list.length === 0) {
      sidebarList.innerHTML = '<p class="sidebar-empty">No conversations yet.</p>';
      return;
    }
    buildConversationSidebarSections(list).forEach(({ label, conversations }) => {
      const section = document.createElement("section");
      section.className = "sidebar-section";

      const heading = document.createElement("div");
      heading.className = "sidebar-section__heading";
      heading.textContent = label;
      section.appendChild(heading);

      const items = document.createElement("div");
      items.className = "sidebar-section__items";

      conversations.forEach((conversation) => {
        if (conversation.id === chatState.currentConvId) {
          chatState.currentConvTitle = String(conversation.title || "New Chat").trim() || "New Chat";
          chatState.currentConversationTitleSource = String(conversation.title_source || chatState.currentConversationTitleSource || "system").trim().toLowerCase() || "system";
          chatState.currentConversationTitleOverridden = conversation.title_overridden === true || Number(conversation.title_overridden || 0) === 1;
          chatState.currentConversationPersonaName = resolveConversationPersonaName(conversation.persona_id, conversation.persona_name || "");
        }
        const conversationDisplayTitle = getConversationDisplayTitle(conversation);
        const conversationPersonaName = resolveConversationPersonaName(conversation.persona_id, conversation.persona_name || "");
        const conversationPersonaBadge = conversationPersonaName
          ? `<span class="sidebar-persona-label" title="Persona: ${escHtml(conversationPersonaName)}">${escHtml(conversationPersonaName)}</span>`
          : "";
        const item = document.createElement("div");
        item.className = "sidebar-item" + (conversation.id === chatState.currentConvId ? " active" : "");
        item.dataset.id = conversation.id;
        item.innerHTML =
          `<span class="sidebar-title">${escHtml(conversationDisplayTitle)}</span>` +
          conversationPersonaBadge +
          `<button class="sidebar-edit" title="Rename" aria-label="Rename" data-id="${conversation.id}">` +
          `  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">` +
          `    <path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>` +
          `  </svg>` +
          `</button>` +
          `<button class="sidebar-del" title="Delete" data-id="${conversation.id}">` +
          `  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">` +
          `    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>` +
          `  </svg>` +
          `</button>`;
        item.addEventListener("click", (event) => {
          if (event.target.closest(".sidebar-del") || event.target.closest(".sidebar-edit")) {
            return;
          }
          if (conversation.id !== chatState.currentConvId) {
            openConversation(conversation.id);
            closeSidebarOnMobile();
          }
        });
        item.querySelector(".sidebar-edit").addEventListener("click", (event) => {
          event.stopPropagation();
          startSidebarRename(conversation, item);
        });
        item.querySelector(".sidebar-del").addEventListener("click", (event) => {
          event.stopPropagation();
          if (!window.confirm("Are you sure you want to delete this conversation?")) {
            return;
          }
          deleteConversation(conversation.id);
        });
        items.appendChild(item);
      });

      section.appendChild(items);
      sidebarList.appendChild(section);
    });
  } catch (error) {
    if (sidebarList.childElementCount === 0) {
      sidebarList.innerHTML = '<p class="sidebar-empty">Could not load conversations.</p>';
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Conversation Title State                                           */
/* ------------------------------------------------------------------ */

/**
 * Updates the conversation title in chatState and refreshes the export panel.
 * @param {number|string} conversationId
 * @param {{title?: string, title_source?: string, title_overridden?: boolean}|string} titleOrPayload
 */
function updateConversationTitleInState(conversationId, titleOrPayload) {
  const payload = titleOrPayload && typeof titleOrPayload === "object"
    ? titleOrPayload
    : { title: titleOrPayload };
  const normalizedTitle = String(payload.title || "New Chat").trim() || "New Chat";
  if (Number(conversationId) === Number(chatState.currentConvId)) {
    chatState.currentConvTitle = normalizedTitle;
    chatState.currentConversationTitleSource = String(payload.title_source || "manual").trim().toLowerCase() || "manual";
    chatState.currentConversationTitleOverridden = payload.title_overridden === true
      || Number(payload.title_overridden || 0) === 1
      || chatState.currentConversationTitleSource === "manual";
    updateExportPanel();
  }
}

/* ------------------------------------------------------------------ */
/*  Sidebar Rename                                                     */
/* ------------------------------------------------------------------ */

function cancelSidebarRename() {
  if (!activeSidebarRename) {
    return;
  }

  const { item, originalTitle } = activeSidebarRename;
  const titleInput = item.querySelector(".sidebar-title-input");
  if (titleInput) {
    titleInput.replaceWith(createSidebarTitleSpan(originalTitle));
  }
  item.classList.remove("editing");
  activeSidebarRename = null;
}

function createSidebarTitleSpan(title) {
  const span = document.createElement("span");
  span.className = "sidebar-title";
  span.textContent = String(title || "New Chat").trim() || "New Chat";
  return span;
}

function startSidebarRename(conversation, item) {
  if (!conversation || !item) {
    return;
  }

  if (activeSidebarRename && activeSidebarRename.item !== item) {
    cancelSidebarRename();
  }

  const titleNode = item.querySelector(".sidebar-title");
  if (!titleNode || item.querySelector(".sidebar-title-input")) {
    return;
  }

  const originalTitle = String(conversation.title || "New Chat").trim() || "New Chat";
  const titleInput = document.createElement("input");
  titleInput.type = "text";
  titleInput.className = "sidebar-title-input";
  titleInput.value = originalTitle;
  titleInput.spellcheck = false;
  titleInput.autocomplete = "off";
  titleInput.setAttribute("aria-label", "Rename conversation");

  item.classList.add("editing");
  titleNode.replaceWith(titleInput);
  activeSidebarRename = {
    item,
    conversationId: conversation.id,
    originalTitle,
    committing: false,
  };

  const submitRename = async () => {
    if (!activeSidebarRename || activeSidebarRename.item !== item || activeSidebarRename.committing) {
      return;
    }

    const nextTitle = titleInput.value.trim();
    if (!nextTitle) {
      cancelSidebarRename();
      return;
    }

    activeSidebarRename.committing = true;
    try {
      const response = await fetch(`/api/conversations/${conversation.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: nextTitle }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || "Unable to rename conversation.");
      }

      updateConversationTitleInState(conversation.id, {
        title: data.title || nextTitle,
        title_source: data.title_source || "manual",
        title_overridden: data.title_overridden,
      });
      activeSidebarRename = null;
      await loadSidebar();
    } catch (error) {
      activeSidebarRename = null;
      showError(error.message || "Unable to rename conversation.");
      await loadSidebar();
    }
  };

  const cancelRename = () => {
    if (!activeSidebarRename || activeSidebarRename.item !== item || activeSidebarRename.committing) {
      return;
    }
    cancelSidebarRename();
  };

  titleInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      submitRename();
    } else if (event.key === "Escape") {
      event.preventDefault();
      cancelRename();
    }
  });
  titleInput.addEventListener("blur", () => {
    window.setTimeout(cancelRename, 0);
  });

  titleInput.focus();
  titleInput.select();
}

/* ------------------------------------------------------------------ */
/*  Sidebar Section Grouping                                           */
/* ------------------------------------------------------------------ */

/**
 * Parses a date from a conversation updated_at value.
 * @param {string} value
 * @returns {Date|null}
 */
function parseConversationUpdatedAt(value) {
  const date = new Date(String(value || "").trim());
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Returns a section key for a given updatedAt date.
 * @param {string} updatedAt
 * @returns {string}
 */
function getConversationSectionKey(updatedAt) {
  const date = parseConversationUpdatedAt(updatedAt);
  if (!date) {
    return "older";
  }

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const targetDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((today.getTime() - targetDay.getTime()) / 86400000);

  if (diffDays <= 0) {
    return "today";
  }
  if (diffDays === 1) {
    return "yesterday";
  }
  if (diffDays < 7) {
    return "week";
  }
  if (date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth()) {
    return "month";
  }
  return "older";
}

/**
 * Groups conversations into time-based sections for the sidebar.
 * @param {Array} conversations
 * @returns {Array<{label: string, conversations: Array}>}
 */
function buildConversationSidebarSections(conversations) {
  const order = ["today", "yesterday", "week", "month", "older"];
  const labels = {
    today: "Today",
    yesterday: "Yesterday",
    week: "This Week",
    month: "This Month",
    older: "Earlier",
  };
  const grouped = new Map(order.map((key) => [key, []]));

  (Array.isArray(conversations) ? conversations : []).forEach((conversation) => {
    const key = getConversationSectionKey(conversation?.updated_at);
    grouped.get(key)?.push(conversation);
  });

  return order
    .map((key) => ({ label: labels[key], conversations: grouped.get(key) || [] }))
    .filter((entry) => entry.conversations.length > 0);
}
