// static/js/slash.js — Slash command system
// Extracted from app.js (Phase 5.9)
// Dependencies: state.js (uiState, chatState), constants.js (SLASH_COMMAND_MENU_MAX_VISIBLE_ITEMS),
//   utils.js (autoResize), DOM consts: inputEl, slashCommandMenuEl (app.js)

const CHAT_SLASH_COMMANDS = Object.freeze([
  Object.freeze({
    name: "check",
    label: "Double-check",
    badgeLabel: "Double Check",
    icon: "\u2713",
    usage: "/check <claim, answer, or topic>",
    description: "Run a deliberate second-pass verification pass before the assistant finalizes its answer.",
    keywords: Object.freeze(["verify", "review", "audit", "fact", "confidence", "counterargument", "risk"]),
    insertText: "/check ",
    metadataKeys: Object.freeze(["double_check", "double_check_query"]),
    parse(argsText = "") {
      const query = String(argsText || "").trim();
      const payload = {
        double_check: true,
        ...(query ? { double_check_query: query } : {}),
      };
      return {
        requested: true,
        query,
        text: query,
        metadata: payload,
        requestPayload: payload,
        fallbackText: "Double-check request.",
      };
    },
    extractMetadata(metadata) {
      if (!metadata || typeof metadata !== "object" || metadata.double_check !== true) {
        return null;
      }
      const query = String(metadata.double_check_query || "").trim();
      return {
        requested: true,
        query,
        text: query,
        metadata: {
          double_check: true,
          ...(query ? { double_check_query: query } : {}),
        },
        requestPayload: {
          double_check: true,
          ...(query ? { double_check_query: query } : {}),
        },
        fallbackText: "Double-check request.",
      };
    },
  }),
]);

const CHAT_SLASH_COMMAND_BY_NAME = new Map(
  CHAT_SLASH_COMMANDS.map((command) => [command.name, command])
);

function getSlashCommandByName(commandName) {
  return CHAT_SLASH_COMMAND_BY_NAME.get(String(commandName || "").trim().toLowerCase()) || null;
}

function getSlashCommandSearchText(command) {
  return [
    command?.name,
    command?.label,
    command?.description,
    command?.usage,
    ...(Array.isArray(command?.keywords) ? command.keywords : []),
  ]
    .filter(Boolean)
    .join(" ")
    .trim()
    .toLowerCase();
}

function normalizeSlashCommandResolution(command, resolution) {
  if (!command || !resolution || typeof resolution !== "object") {
    return null;
  }

  const text = String(resolution.text ?? "").trim();
  const query = String(resolution.query ?? text).trim();
  return {
    command,
    requested: resolution.requested === true,
    text,
    query,
    metadata: resolution.metadata && typeof resolution.metadata === "object" ? { ...resolution.metadata } : null,
    requestPayload: resolution.requestPayload && typeof resolution.requestPayload === "object"
      ? { ...resolution.requestPayload }
      : null,
    fallbackText: String(resolution.fallbackText || "").trim(),
  };
}

function extractComposerSlashCommandMetadata(metadata) {
  for (const command of CHAT_SLASH_COMMANDS) {
    if (typeof command.extractMetadata !== "function") {
      continue;
    }
    const resolution = normalizeSlashCommandResolution(command, command.extractMetadata(metadata));
    if (resolution?.requested) {
      return resolution;
    }
  }
  return null;
}

function getMatchingSlashCommands(query = "") {
  const normalizedQuery = String(query || "").trim().toLowerCase();
  return CHAT_SLASH_COMMANDS.filter((command) => {
    if (!normalizedQuery) {
      return true;
    }
    return getSlashCommandSearchText(command).includes(normalizedQuery);
  });
}

function getSlashCommandAutocompleteState(rawText) {
  const trimmedStart = String(rawText || "").trimStart();
  const commandMatch = trimmedStart.match(/^\/([^\s\n]*)$/);
  if (!commandMatch) {
    return { active: false, query: "", matches: [] };
  }

  const query = String(commandMatch[1] || "").trim().toLowerCase();
  return {
    active: true,
    query,
    matches: getMatchingSlashCommands(query),
  };
}

function parseComposerSlashCommand(rawText) {
  const normalizedInput = String(rawText || "").trim();
  if (!normalizedInput.startsWith("/")) {
    return {
      command: null,
      requested: false,
      text: normalizedInput,
      query: "",
      metadata: null,
      requestPayload: null,
      fallbackText: "",
    };
  }

  const commandMatch = normalizedInput.match(/^\/([a-z0-9_-]+)(?:\s+([\s\S]*))?$/i);
  if (!commandMatch) {
    return {
      command: null,
      requested: false,
      text: normalizedInput,
      query: "",
      metadata: null,
      requestPayload: null,
      fallbackText: "",
    };
  }

  const command = getSlashCommandByName(commandMatch[1]);
  if (!command || typeof command.parse !== "function") {
    return {
      command: null,
      requested: false,
      text: normalizedInput,
      query: "",
      metadata: null,
      requestPayload: null,
      fallbackText: "",
    };
  }

  return normalizeSlashCommandResolution(command, command.parse(commandMatch[2] || "", { rawInput: normalizedInput })) || {
    command: null,
    requested: false,
    text: normalizedInput,
    query: "",
    metadata: null,
    requestPayload: null,
    fallbackText: "",
  };
}

function clearComposerSlashCommandMetadata(target) {
  const base = target && typeof target === "object" ? target : {};
  CHAT_SLASH_COMMANDS.forEach((command) => {
    (Array.isArray(command.metadataKeys) ? command.metadataKeys : []).forEach((key) => {
      delete base[key];
    });
  });
  return base;
}

function buildComposerSlashCommandMetadata(metadata, slashCommandResolution) {
  const base = metadata && typeof metadata === "object" ? { ...metadata } : {};
  clearComposerSlashCommandMetadata(base);
  if (!slashCommandResolution?.requested || !slashCommandResolution.metadata) {
    return Object.keys(base).length ? base : null;
  }
  return {
    ...base,
    ...slashCommandResolution.metadata,
  };
}

function getSlashCommandRequestPayload(slashCommandResolution) {
  const payload = slashCommandResolution?.requestPayload && typeof slashCommandResolution.requestPayload === "object"
    ? slashCommandResolution.requestPayload
    : {};
  return Object.entries(payload).reduce((acc, [key, value]) => {
    if (value === undefined || value === null) {
      return acc;
    }
    if (typeof value === "string" && !value.trim()) {
      return acc;
    }
    acc[key] = value;
    return acc;
  }, {});
}

function appendSlashCommandFormData(formData, slashCommandResolution) {
  if (!(formData instanceof FormData)) {
    return;
  }
  Object.entries(getSlashCommandRequestPayload(slashCommandResolution)).forEach(([key, value]) => {
    formData.append(key, typeof value === "boolean" ? String(value) : String(value));
  });
}

function buildComposerSlashCommandEditableText(content, metadata) {
  const commandState = extractComposerSlashCommandMetadata(metadata);
  if (!commandState?.command) {
    return String(content || "");
  }
  return commandState.query
    ? `/${commandState.command.name} ${commandState.query}`
    : `/${commandState.command.name}`;
}

function getActiveSlashCommandSuggestion() {
  if (!uiState.slashCommandSuggestions.length) {
    return null;
  }
  return uiState.slashCommandSuggestions[Math.max(0, Math.min(uiState.slashCommandSelectedIndex, uiState.slashCommandSuggestions.length - 1))] || null;
}

function isSlashCommandMenuOpen() {
  return Boolean(uiState.slashCommandMenuOpen && slashCommandMenuEl && slashCommandMenuEl.hidden === false);
}

function closeSlashCommandMenu() {
  uiState.slashCommandMenuOpen = false;
  uiState.slashCommandMenuQuery = "";
  uiState.slashCommandSuggestions = [];
  uiState.slashCommandSelectedIndex = 0;
  if (!slashCommandMenuEl) {
    return;
  }
  slashCommandMenuEl.hidden = true;
  slashCommandMenuEl.setAttribute("aria-hidden", "true");
  slashCommandMenuEl.replaceChildren();
  if (inputEl) {
    inputEl.setAttribute("aria-expanded", "false");
    inputEl.removeAttribute("aria-activedescendant");
  }
}

function applySlashCommandSuggestion(command) {
  if (!inputEl || !command) {
    return;
  }

  const leadingWhitespace = (String(inputEl.value || "").match(/^\s*/) || [""])[0];
  inputEl.value = `${leadingWhitespace}${String(command.insertText || `/${command.name} `)}`;
  autoResize(inputEl);
  closeSlashCommandMenu();
  inputEl.focus();
  inputEl.setSelectionRange(inputEl.value.length, inputEl.value.length);
}

function moveSlashCommandSelection(direction) {
  if (!uiState.slashCommandSuggestions.length) {
    return;
  }
  const normalizedDirection = direction < 0 ? -1 : 1;
  uiState.slashCommandSelectedIndex = (uiState.slashCommandSelectedIndex + normalizedDirection + uiState.slashCommandSuggestions.length) % uiState.slashCommandSuggestions.length;
  renderSlashCommandMenu();
}

function renderSlashCommandMenu() {
  if (!slashCommandMenuEl) {
    return;
  }
  if (!uiState.slashCommandMenuOpen) {
    closeSlashCommandMenu();
    return;
  }

  const activeSuggestion = getActiveSlashCommandSuggestion();
  const fragment = document.createDocumentFragment();

  const header = document.createElement("div");
  header.className = "slash-command-menu__header";

  const title = document.createElement("div");
  title.className = "slash-command-menu__title";
  title.textContent = "Commands";

  const subtitle = document.createElement("div");
  subtitle.className = "slash-command-menu__subtitle";
  subtitle.textContent = uiState.slashCommandMenuQuery
    ? `Showing matches for /${uiState.slashCommandMenuQuery}`
    : "Choose a command to insert into the composer.";

  header.append(title, subtitle);
  fragment.appendChild(header);

  const list = document.createElement("div");
  list.className = "slash-command-menu__list";
  list.setAttribute("role", "listbox");

  if (uiState.slashCommandSuggestions.length) {
    uiState.slashCommandSuggestions.forEach((command, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.id = `slash-command-option-${command.name}`;
      button.className = "slash-command-menu__item";
      button.setAttribute("role", "option");

      const isActive = index === uiState.slashCommandSelectedIndex;
      if (isActive) {
        button.classList.add("is-active");
      }
      button.setAttribute("aria-selected", String(isActive));
      button.addEventListener("mousedown", (event) => event.preventDefault());
      button.addEventListener("click", () => applySlashCommandSuggestion(command));
      button.addEventListener("mouseenter", () => {
        if (uiState.slashCommandSelectedIndex !== index) {
          uiState.slashCommandSelectedIndex = index;
          renderSlashCommandMenu();
        }
      });

      const icon = document.createElement("span");
      icon.className = "slash-command-menu__icon";
      icon.textContent = String(command.icon || "\u2318");

      const body = document.createElement("span");
      body.className = "slash-command-menu__body";

      const topRow = document.createElement("span");
      topRow.className = "slash-command-menu__top-row";

      const name = document.createElement("span");
      name.className = "slash-command-menu__name";
      name.textContent = `/${command.name}`;

      const usage = document.createElement("span");
      usage.className = "slash-command-menu__usage";
      usage.textContent = command.usage;

      topRow.append(name, usage);

      const description = document.createElement("span");
      description.className = "slash-command-menu__description";
      description.textContent = command.description;

      body.append(topRow, description);

      const hint = document.createElement("span");
      hint.className = "slash-command-menu__insert-hint";
      hint.textContent = "Insert";

      button.append(icon, body, hint);
      list.appendChild(button);
    });
  } else {
    const emptyState = document.createElement("div");
    emptyState.className = "slash-command-menu__empty";
    emptyState.textContent = uiState.slashCommandMenuQuery
      ? `No commands match /${uiState.slashCommandMenuQuery}.`
      : "No slash commands are registered.";
    list.appendChild(emptyState);
  }

  fragment.appendChild(list);

  const footer = document.createElement("div");
  footer.className = "slash-command-menu__footer";
  footer.textContent = uiState.slashCommandSuggestions.length
    ? "\u2191 \u2193 to navigate \u2022 Enter or Tab to insert \u2022 Esc to close"
    : "Keep typing to filter registered commands.";
  fragment.appendChild(footer);

  slashCommandMenuEl.hidden = false;
  slashCommandMenuEl.setAttribute("aria-hidden", "false");
  slashCommandMenuEl.replaceChildren(fragment);

  if (inputEl) {
    inputEl.setAttribute("aria-expanded", "true");
    if (activeSuggestion) {
      inputEl.setAttribute("aria-activedescendant", `slash-command-option-${activeSuggestion.name}`);
    } else {
      inputEl.removeAttribute("aria-activedescendant");
    }
  }
}

function syncSlashCommandMenuWithInput({ preserveSelection = true } = {}) {
  if (!slashCommandMenuEl || !inputEl || chatState.isStreaming || chatState.isFixing) {
    closeSlashCommandMenu();
    return;
  }

  const menuState = getSlashCommandAutocompleteState(inputEl.value);
  if (!menuState.active) {
    closeSlashCommandMenu();
    return;
  }

  const previousSelectedName = preserveSelection ? getActiveSlashCommandSuggestion()?.name : "";
  uiState.slashCommandMenuOpen = true;
  uiState.slashCommandMenuQuery = menuState.query;
  uiState.slashCommandSuggestions = menuState.matches.slice(0, SLASH_COMMAND_MENU_MAX_VISIBLE_ITEMS);

  if (previousSelectedName) {
    const nextIndex = uiState.slashCommandSuggestions.findIndex((command) => command.name === previousSelectedName);
    uiState.slashCommandSelectedIndex = nextIndex >= 0 ? nextIndex : 0;
  } else {
    uiState.slashCommandSelectedIndex = 0;
  }

  renderSlashCommandMenu();
}
