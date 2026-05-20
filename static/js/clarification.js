/**
 * Clarification module — clarification panels, drafts, form management, and message group utilities.
 * Depends on: state.js, render.js, constants.js, utils.js (escHtml, autoResize), DOM: document
 */

/* ------------------------------------------------------------------ */
/*  Clarification Normalization                                        */
/* ------------------------------------------------------------------ */

/**
 * Normalizes a single clarification question from server metadata.
 * @param {object|null} question
 * @param {number} index
 * @returns {object|null}
 */
function normalizeClarificationQuestion(question, index) {
  if (!question || typeof question !== "object") {
    return null;
  }

  const inputType = String(question.input_type || "text").trim();
  if (!["text", "single_select", "multi_select"].includes(inputType)) {
    return null;
  }

  const label = String(question.label || "").trim();
  if (!label) {
    return null;
  }

  const normalized = {
    id: String(question.id || `question_${index + 1}`).trim() || `question_${index + 1}`,
    label,
    input_type: inputType,
    required: question.required !== false,
    placeholder: String(question.placeholder || "").trim(),
    allow_free_text: question.allow_free_text === true,
    options: [],
  };

  const dependsOn = normalizeClarificationDependency(question.depends_on);
  if (dependsOn) {
    normalized.depends_on = dependsOn;
  }

  const rawOptions = Array.isArray(question.options) ? question.options : [];
  normalized.options = rawOptions
    .map((option) => {
      if (!option || typeof option !== "object") {
        return null;
      }
      const optionLabel = String(option.label || option.value || "").trim();
      const optionValue = String(option.value || option.label || "").trim();
      const optionDescription = String(option.description || "").trim();
      if (!optionLabel || !optionValue) {
        return null;
      }
      return {
        label: optionLabel,
        value: optionValue,
        description: optionDescription,
      };
    })
    .filter(Boolean);

  return normalized;
}

/**
 * Normalizes a clarification dependency object.
 * @param {object|null} dependsOn
 * @returns {object|null}
 */
function normalizeClarificationDependency(dependsOn) {
  if (!dependsOn || typeof dependsOn !== "object") {
    return null;
  }

  const questionId = String(dependsOn.question_id || dependsOn.id || dependsOn.question || "").trim();
  const rawValues = Array.isArray(dependsOn.values) ? [...dependsOn.values] : [];
  if (dependsOn.value !== undefined && dependsOn.value !== null && String(dependsOn.value).trim()) {
    rawValues.unshift(dependsOn.value);
  }

  const values = rawValues
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .filter((value, idx, array) => array.findIndex((entry) => entry === value) === idx)
    .slice(0, 10);

  if (!questionId || !values.length) {
    return null;
  }

  return {
    question_id: questionId,
    values,
  };
}

/**
 * Extracts a pending clarification from assistant metadata.
 * @param {object|null} metadata
 * @returns {{intro: string, submit_label: string, questions: Array}|null}
 */
function getPendingClarification(metadata) {
  if (!metadata || typeof metadata !== "object") {
    return null;
  }

  const payload = metadata.pending_clarification;
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const questions = Array.isArray(payload.questions)
    ? payload.questions.map(normalizeClarificationQuestion).filter(Boolean)
    : [];
  if (!questions.length) {
    return null;
  }

  return {
    intro: String(payload.intro || "").trim(),
    submit_label: String(payload.submit_label || "").trim() || "Send answers",
    questions,
  };
}

/**
 * Finds the newest assistant message ID with a pending clarification.
 * @param {Array} [entries=chatState.history]
 * @returns {number|null}
 */
function findLatestPendingClarificationMessageId(entries = chatState.history) {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const message = entries[index];
    if (!message || message.role !== "assistant") {
      continue;
    }
    if (!getPendingClarification(message.metadata)) {
      continue;
    }
    const messageId = Number(message.id);
    if (Number.isInteger(messageId) && messageId > 0) {
      return messageId;
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/*  Clarification Form Helpers                                         */
/* ------------------------------------------------------------------ */

/**
 * Gets the live value of a clarification field from the form.
 * @param {HTMLFormElement} form
 * @param {object} question
 * @param {number} index
 * @returns {string|string[]}
 */
function getClarificationLiveValue(form, question, index) {
  const fieldName = `clarify_${index}`;
  if (question.input_type === "text") {
    return String(form.elements[fieldName]?.value || "").trim();
  }
  if (question.input_type === "single_select") {
    return String(form.querySelector(`input[name="${fieldName}"]:checked`)?.value || "").trim();
  }
  return Array.from(form.querySelectorAll(`input[name="${fieldName}"]:checked`))
    .map((element) => String(element.value || "").trim())
    .filter(Boolean);
}

/**
 * Checks if a given answer matches a dependency constraint.
 * @param {object|null} dependsOn
 * @param {string|string[]} answerValue
 * @returns {boolean}
 */
function matchesClarificationDependency(dependsOn, answerValue) {
  if (!dependsOn || typeof dependsOn !== "object") {
    return true;
  }

  const allowedValues = Array.isArray(dependsOn.values)
    ? dependsOn.values.map((value) => String(value || "").trim()).filter(Boolean)
    : [];
  if (!allowedValues.length) {
    return true;
  }

  const actualValues = Array.isArray(answerValue)
    ? answerValue.map((value) => String(value || "").trim()).filter(Boolean)
    : [String(answerValue || "").trim()].filter(Boolean);
  return actualValues.some((value) => allowedValues.includes(value));
}

/**
 * Enables or disables all inputs/textarea elements within a field.
 * @param {HTMLElement} field
 * @param {boolean} disabled
 */
function setClarificationFieldDisabled(field, disabled) {
  if (!(field instanceof HTMLElement)) {
    return;
  }
  field.querySelectorAll("input, textarea").forEach((element) => {
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      element.disabled = disabled;
    }
  });
}

/**
 * Updates visibility of clarification fields based on dependencies.
 * @param {HTMLFormElement} form
 * @param {{questions: Array}} clarification
 */
function updateClarificationFieldVisibility(form, clarification) {
  const answersByQuestionId = {};
  clarification.questions.forEach((question, index) => {
    answersByQuestionId[question.id] = getClarificationLiveValue(form, question, index);
  });

  clarification.questions.forEach((question) => {
    const field = form.querySelector(`.clarification-field[data-question-id="${CSS.escape(question.id)}"]`);
    if (!(field instanceof HTMLElement)) {
      return;
    }
    const visible = !question.depends_on
      || matchesClarificationDependency(question.depends_on, answersByQuestionId[question.depends_on.question_id]);
    field.hidden = !visible;
    setClarificationFieldDisabled(field, !visible);
  });
}

/* ------------------------------------------------------------------ */
/*  Clarification Draft Persistence                                    */
/* ------------------------------------------------------------------ */

/**
 * @param {number|string} messageId
 * @returns {string}
 */
function getClarificationDraftStorageKey(messageId) {
  const normalizedConvId = Number.isInteger(Number(chatState.currentConvId)) ? String(Number(chatState.currentConvId)) : "conversation";
  const normalizedMessageId = Number.isInteger(Number(messageId)) ? String(Number(messageId)) : "message";
  return `${CLARIFICATION_DRAFT_STORAGE_PREFIX}.${normalizedConvId}.${normalizedMessageId}`;
}

/**
 * @param {number|string} messageId
 * @returns {object|null}
 */
function loadClarificationDraft(messageId) {
  const key = getClarificationDraftStorageKey(messageId);
  try {
    const raw = localStorage.getItem(key);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (_) {
    return null;
  }
}

/**
 * @param {number|string} messageId
 * @param {object|null} draft
 */
function saveClarificationDraft(messageId, draft) {
  const key = getClarificationDraftStorageKey(messageId);
  try {
    if (!draft || typeof draft !== "object") {
      localStorage.removeItem(key);
      return;
    }
    localStorage.setItem(key, JSON.stringify(draft));
  } catch (_) {
    // Ignore storage failures.
  }
}

/**
 * Collects the current form state into a draft object.
 * @param {HTMLFormElement} form
 * @param {{questions: Array}} clarification
 * @returns {object}
 */
function collectClarificationDraft(form, clarification) {
  const draft = {};

  clarification.questions.forEach((question, index) => {
    const fieldName = `clarify_${index}`;
    const freeTextName = `${fieldName}_free`;

    if (question.input_type === "text") {
      const input = form.elements[fieldName];
      draft[question.id] = { value: String(input?.value || "") };
      return;
    }

    if (question.input_type === "single_select") {
      const selected = form.querySelector(`input[name="${fieldName}"]:checked`);
      const freeTextInput = form.elements[freeTextName];
      draft[question.id] = {
        value: selected ? String(selected.value || "") : "",
        free_text: String(freeTextInput?.value || ""),
      };
      return;
    }

    const selected = Array.from(form.querySelectorAll(`input[name="${fieldName}"]:checked`));
    const freeTextInput = form.elements[freeTextName];
    draft[question.id] = {
      value: selected.map((element) => String(element.value || "").trim()).filter(Boolean),
      free_text: String(freeTextInput?.value || ""),
    };
  });

  return draft;
}

/**
 * Applies a saved draft to the clarification form.
 * @param {HTMLFormElement} form
 * @param {{questions: Array}} clarification
 * @param {object|null} draft
 */
function applyClarificationDraft(form, clarification, draft) {
  if (!draft || typeof draft !== "object") {
    return;
  }

  clarification.questions.forEach((question, index) => {
    const entry = draft[question.id];
    if (!entry || typeof entry !== "object") {
      return;
    }

    const fieldName = `clarify_${index}`;
    const freeTextName = `${fieldName}_free`;

    if (question.input_type === "text") {
      const input = form.elements[fieldName];
      if (input instanceof HTMLTextAreaElement) {
        input.value = String(entry.value || "");
        autoResize(input);
      }
    } else if (question.input_type === "single_select") {
      const selectedValue = String(entry.value || "").trim();
      if (selectedValue) {
        const selected = form.querySelector(`input[name="${fieldName}"][value="${CSS.escape(selectedValue)}"]`);
        if (selected instanceof HTMLInputElement) {
          selected.checked = true;
        }
      }
    } else if (Array.isArray(entry.value)) {
      entry.value.forEach((selectedValue) => {
        const normalizedValue = String(selectedValue || "").trim();
        if (!normalizedValue) {
          return;
        }
        const selected = form.querySelector(`input[name="${fieldName}"][value="${CSS.escape(normalizedValue)}"]`);
        if (selected instanceof HTMLInputElement) {
          selected.checked = true;
        }
      });
    }

    const freeTextInput = form.elements[freeTextName];
    if (freeTextInput instanceof HTMLInputElement) {
      freeTextInput.value = String(entry.free_text || "");
    }
  });
}

/**
 * Formats clarification answers as a bullet-list string.
 * @param {{questions: Array}} clarification
 * @param {object} answers
 * @returns {string}
 */
function formatClarificationResponse(clarification, answers) {
  const lines = [];
  clarification.questions.forEach((question) => {
    const answer = answers[question.id];
    if (!answer || !String(answer.display || "").trim()) {
      return;
    }
    lines.push(`- ${question.label} → ${String(answer.display).trim()}`);
  });
  return lines.join("\n");
}

/**
 * Collects and validates all answers from the clarification form.
 * @param {HTMLFormElement} form
 * @param {{questions: Array}} clarification
 * @returns {{answers?: object, text?: string, error?: string}}
 */
function collectClarificationAnswers(form, clarification) {
  const answers = {};

  for (let index = 0; index < clarification.questions.length; index += 1) {
    const question = clarification.questions[index];
    const field = form.querySelector(`.clarification-field[data-question-id="${CSS.escape(question.id)}"]`);
    if (field instanceof HTMLElement && field.hidden) {
      continue;
    }
    const fieldName = `clarify_${index}`;
    const freeTextName = `${fieldName}_free`;
    let display = "";
    let value = null;

    if (question.input_type === "text") {
      const input = form.elements[fieldName];
      display = String(input?.value || "").trim();
      value = display;
    } else if (question.input_type === "single_select") {
      const selected = form.querySelector(`input[name="${fieldName}"]:checked`);
      value = selected ? String(selected.value || "").trim() : "";
      const selectedOption = question.options.find((option) => option.value === value);
      display = selectedOption ? selectedOption.label : value;
    } else if (question.input_type === "multi_select") {
      const selected = Array.from(form.querySelectorAll(`input[name="${fieldName}"]:checked`));
      value = selected.map((element) => String(element.value || "").trim()).filter(Boolean);
      display = value
        .map((entry) => question.options.find((option) => option.value === entry)?.label || entry)
        .filter(Boolean)
        .join(", ");
    }

    const freeTextInput = form.elements[freeTextName];
    const freeText = String(freeTextInput?.value || "").trim();
    if (freeText) {
      display = display ? `${display} (${freeText})` : freeText;
      if (Array.isArray(value)) {
        value = [...value, freeText];
      } else if (value) {
        value = { selection: value, free_text: freeText };
      } else {
        value = freeText;
      }
    }

    if (question.required && !String(display || "").trim()) {
      return { error: `${question.label} is required.` };
    }

    answers[question.id] = { value, display };
  }

  return {
    answers,
    text: formatClarificationResponse(clarification, answers),
  };
}

/* ------------------------------------------------------------------ */
/*  Clarification Panel Rendering                                      */
/* ------------------------------------------------------------------ */

/**
 * Appends a clarification panel to a message group.
 * @param {HTMLElement} group
 * @param {object|null} metadata
 * @param {{isLatestVisible?: boolean, messageId?: number}} [options={}]
 */
function appendClarificationPanel(group, metadata, options = {}) {
  const clarification = getPendingClarification(metadata);
  if (!clarification) {
    return;
  }

  const panel = document.createElement("section");
  panel.className = "clarification-card";

  const title = document.createElement("div");
  title.className = "clarification-card__title";
  title.textContent = clarification.questions.length === 1 ? "Clarification needed" : "Clarifications needed";
  panel.appendChild(title);

  const summary = document.createElement("div");
  summary.className = "clarification-card__summary";
  summary.textContent = `${clarification.questions.length} question${clarification.questions.length === 1 ? "" : "s"} to answer`;
  panel.appendChild(summary);

  if (clarification.intro) {
    const intro = document.createElement("div");
    intro.className = "clarification-card__intro";
    intro.textContent = clarification.intro;
    panel.appendChild(intro);
  }

  const isInteractive = Boolean(options.isLatestVisible && Number.isInteger(Number(options.messageId)));
  if (!isInteractive) {
    const state = document.createElement("div");
    state.className = "clarification-card__state";
    state.textContent = "Waiting for a reply in this thread.";
    panel.appendChild(state);
    group.appendChild(panel);
    const bubble = group.querySelector(".bubble");
    if (bubble && !bubble.textContent.trim()) {
      bubble.remove();
    }
    return;
  }

  const form = document.createElement("form");
  form.className = "clarification-form";

  const helper = document.createElement("div");
  helper.className = "clarification-card__helper";
  helper.textContent = "Your draft answers stay in this browser until you send them.";
  form.appendChild(helper);

  clarification.questions.forEach((question, index) => {
    const field = document.createElement("div");
    field.className = "clarification-field";
    field.dataset.questionId = question.id;

    const label = document.createElement("label");
    label.className = "clarification-field__label";
    label.textContent = `${question.required ? "* " : ""}${question.label}`;
    field.appendChild(label);

    const fieldName = `clarify_${index}`;
    const freeTextName = `${fieldName}_free`;

    if (question.input_type === "text") {
      const input = document.createElement("textarea");
      input.name = fieldName;
      input.rows = 2;
      input.placeholder = question.placeholder || "A: Type your answer";
      input.className = "clarification-field__textarea";
      input.addEventListener("input", () => autoResize(input));
      field.appendChild(input);
    } else {
      let optionsSearchInput = null;
      const optionsList = document.createElement("div");
      optionsList.className = "clarification-options";
      const optionEntries = [];
      question.options.forEach((option) => {
        const optionLabel = document.createElement("label");
        optionLabel.className = "clarification-option";

        const input = document.createElement("input");
        input.type = question.input_type === "single_select" ? "radio" : "checkbox";
        input.name = fieldName;
        input.value = option.value;

        const textBlock = document.createElement("span");
        textBlock.className = "clarification-option__text";
        textBlock.innerHTML = `<strong>${escHtml(option.label)}</strong>${option.description ? `<small>${escHtml(option.description)}</small>` : ""}`;

        optionLabel.appendChild(input);
        optionLabel.appendChild(textBlock);
        optionsList.appendChild(optionLabel);
        optionEntries.push({
          element: optionLabel,
          searchText: `${option.label} ${option.description || ""}`.toLowerCase(),
        });
      });

      if (question.options.length > 5) {
        optionsSearchInput = document.createElement("input");
        optionsSearchInput.type = "search";
        optionsSearchInput.className = "clarification-field__input clarification-options__search";
        optionsSearchInput.placeholder = "Filter options";
        field.appendChild(optionsSearchInput);

        const emptyState = document.createElement("div");
        emptyState.className = "clarification-options__empty";
        emptyState.textContent = "No matching options.";
        emptyState.hidden = true;

        const applyOptionFilter = () => {
          const query = String(optionsSearchInput.value || "").trim().toLowerCase();
          let visibleCount = 0;
          optionEntries.forEach((entry) => {
            const matches = !query || entry.searchText.includes(query);
            entry.element.hidden = !matches;
            if (matches) {
              visibleCount += 1;
            }
          });
          emptyState.hidden = visibleCount > 0;
        };

        optionsSearchInput.addEventListener("input", applyOptionFilter);
        field.appendChild(optionsList);
        field.appendChild(emptyState);
        applyOptionFilter();
      } else {
        field.appendChild(optionsList);
      }

      if (question.allow_free_text) {
        const freeTextInput = document.createElement("input");
        freeTextInput.type = "text";
        freeTextInput.name = freeTextName;
        freeTextInput.className = "clarification-field__input";
        freeTextInput.placeholder = question.placeholder || "A: Add details if needed";
        field.appendChild(freeTextInput);
      }
    }

    form.appendChild(field);
  });

  applyClarificationDraft(form, clarification, loadClarificationDraft(options.messageId));

  const syncClarificationFormState = () => {
    updateClarificationFieldVisibility(form, clarification);
    saveClarificationDraft(options.messageId, collectClarificationDraft(form, clarification));
  };

  updateClarificationFieldVisibility(form, clarification);

  form.addEventListener("input", () => {
    syncClarificationFormState();
  });

  form.addEventListener("change", () => {
    syncClarificationFormState();
  });

  const error = document.createElement("div");
  error.className = "clarification-form__error";
  error.hidden = true;
  form.appendChild(error);

  const submitButton = document.createElement("button");
  submitButton.type = "submit";
  submitButton.className = "msg-action-btn clarification-form__submit";
  submitButton.textContent = clarification.submit_label;
  form.appendChild(submitButton);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (chatState.isStreaming || chatState.isFixing) {
      return;
    }

    const collected = collectClarificationAnswers(form, clarification);
    if (collected.error) {
      error.hidden = false;
      error.textContent = collected.error;
      return;
    }

    error.hidden = true;
    const draft = collectClarificationDraft(form, clarification);
    saveClarificationDraft(options.messageId, draft);
    submitButton.disabled = true;
    try {
      const result = await sendMessage({
        forcedText: collected.text,
        forcedMetadata: {
          clarification_response: {
            assistant_message_id: Number(options.messageId),
            answers: collected.answers,
          },
        },
      });

      if (result?.ok) {
        saveClarificationDraft(options.messageId, null);
        return;
      }

      if (result?.errorCode === "stale_clarification_response") {
        const latestPendingMessageId = findLatestPendingClarificationMessageId();
        if (Number.isInteger(latestPendingMessageId) && latestPendingMessageId !== Number(options.messageId)) {
          saveClarificationDraft(latestPendingMessageId, draft);
          renderConversationHistory({ preserveScroll: true });
        }
      }
    } finally {
      submitButton.disabled = false;
    }
  });

  panel.appendChild(form);
  group.appendChild(panel);
  const bubble = group.querySelector(".bubble");
  if (bubble && !bubble.textContent.trim()) {
    bubble.remove();
  }
}

/* ------------------------------------------------------------------ */
/*  Scroll-to-Bottom Helper                                            */
/* ------------------------------------------------------------------ */

let scrollToBottomFrame = null;

function scrollToBottom() {
  if (uiState.userScrolledUp) {
    return;
  }
  if (scrollToBottomFrame !== null) {
    return;
  }

  const flushScroll = () => {
    scrollToBottomFrame = null;
    messagesEl.scrollTop = messagesEl.scrollHeight;
  };

  if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
    scrollToBottomFrame = window.requestAnimationFrame(flushScroll);
    return;
  }

  scrollToBottomFrame = window.setTimeout(flushScroll, 16);
}

/* ------------------------------------------------------------------ */
/*  Request ID Generator                                               */
/* ------------------------------------------------------------------ */

function createStreamRequestId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `chat-run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
