// Render helpers — markdown, code highlighting, math, HTML sanitization.
// Dependencies: utils.js (escHtml), plus CDN: marked, DOMPurify, hljs, katex.
const markdownEngine = globalThis.marked || null;
const sanitizer = globalThis.DOMPurify || null;
const highlighter = globalThis.hljs || null;

function renderHighlightedCodeBlock(codeText, rawLang = null) {
  const normalizedCode = String(codeText || "").replace(/\r\n?/g, "\n");
  const lines = normalizedCode.split("\n");
  const lang = rawLang && highlighter && highlighter.getLanguage(rawLang) ? rawLang : null;
  const renderedLines = lines.map((line, index) => {
    let highlightedLine = line ? escHtml(line) : "&nbsp;";
    if (highlighter) {
      try {
        const sourceLine = line || " ";
        highlightedLine = lang
          ? highlighter.highlight(sourceLine, { language: lang, ignoreIllegals: true }).value
          : highlighter.highlightAuto(sourceLine).value;
      } catch (_) {
        highlightedLine = line ? escHtml(line) : "&nbsp;";
      }
    }
    return `<span class="canvas-code-line"><span class="canvas-code-line__number">${index + 1}</span><span class="canvas-code-line__content">${highlightedLine}</span></span>`;
  }).join("");
  const langClass = lang ? ` language-${lang}` : "";
  const langLabel = `<span class="canvas-code-lang">${escHtml(lang || "Code")}</span>`;
  return (
    `<div class="code-block-shell">` +
      `<div class="code-block-toolbar">` +
        `${langLabel}` +
        `<button type="button" class="code-copy-btn" aria-label="Copy code">Copy code</button>` +
      `</div>` +
      `<pre class="canvas-code-block"><code class="hljs${langClass}">${renderedLines}</code></pre>` +
    `</div>`
  );
}

if (markdownEngine && typeof markdownEngine.use === "function") {
  markdownEngine.use({
    breaks: true,
    gfm: true,
  });

  // KaTeX extension: process math during markdown parsing (Phase 1 refactor)
  // Uses marked-katex-extension if available, otherwise falls back to DOM-based post-processing
  if (globalThis.markedKatex && typeof globalThis.markedKatex === "function") {
    markdownEngine.use(globalThis.markedKatex({
      throwOnError: false,
      strict: false,
      trust: false,
      delimiters: [
        { left: "$$", right: "$$", display: true },
        { left: "$", right: "$", display: false },
      ],
    }));
  }

  markdownEngine.use({
    renderer: {
      // Compatible with both marked v4 (code: string, language: string)
      // and marked v5+ (code: token object with .text and .lang properties).
      code(tokenOrCode, languageHint) {
        const isToken = tokenOrCode !== null && typeof tokenOrCode === "object";
        const codeText = isToken ? String(tokenOrCode.text || "") : String(tokenOrCode || "");
        const rawLang = isToken ? (tokenOrCode.lang || null) : (languageHint || null);
        return `${renderHighlightedCodeBlock(codeText, rawLang)}\n`;
      },
    },
  });
}

function sanitizeHtml(html) {
  const rawHtml = String(html || "");
  if (sanitizer && typeof sanitizer.sanitize === "function") {
    return sanitizer.sanitize(rawHtml);
  }

  const template = document.createElement("template");
  template.innerHTML = rawHtml;
  const blockedTags = new Set(["script", "style", "iframe", "object", "embed", "link", "meta", "img", "svg"]);
  const urlAttributes = new Set(["href", "src", "xlink:href"]);
  const nodes = [template.content];

  while (nodes.length) {
    const node = nodes.pop();
    Array.from(node.children || []).forEach((element) => {
      const tagName = String(element.tagName || "").trim().toLowerCase();
      if (blockedTags.has(tagName)) {
        element.remove();
        return;
      }

      Array.from(element.attributes).forEach((attribute) => {
        const attrName = String(attribute.name || "").trim().toLowerCase();
        const attrValue = String(attribute.value || "").trim();
        if (attrName.startsWith("on") || attrName === "srcdoc" || attrName === "style") {
          element.removeAttribute(attribute.name);
          return;
        }
        if (urlAttributes.has(attrName) && /^(?:javascript:|data:text\/html)/i.test(attrValue)) {
          element.removeAttribute(attribute.name);
        }
      });

      nodes.push(element);
    });
  }

  return template.innerHTML;
}

function closeUnclosedCodeFences(text) {
  const fenceCount = (text.match(/^```/gm) || []).length;
  return fenceCount % 2 !== 0 ? text + "\n```" : text;
}

function canRenderCanvasMath() {
  return Boolean(globalThis.katex && typeof globalThis.katex.renderToString === "function");
}

function findClosingMathDelimiter(text, startIndex, delimiter) {
  let searchIndex = startIndex;
  while (searchIndex < text.length) {
    const delimiterIndex = text.indexOf(delimiter, searchIndex);
    if (delimiterIndex < 0) {
      return -1;
    }
    if (delimiterIndex > startIndex && text[delimiterIndex - 1] === "\\") {
      searchIndex = delimiterIndex + delimiter.length;
      continue;
    }
    if (delimiter === "$" && text.slice(startIndex, delimiterIndex).includes("\n")) {
      searchIndex = delimiterIndex + delimiter.length;
      continue;
    }
    return delimiterIndex;
  }
  return -1;
}

function appendCanvasMathFragment(fragment, mathText, displayMode) {
  const wrapper = document.createElement("span");
  try {
    wrapper.innerHTML = globalThis.katex.renderToString(mathText, {
      displayMode,
      throwOnError: false,
      strict(errorCode) {
        return errorCode === "unicodeTextInMathMode" ? "ignore" : "warn";
      },
      trust: false,
      output: "html",
    });
  } catch (_) {
    fragment.appendChild(document.createTextNode(displayMode ? `$$${mathText}$$` : `$${mathText}$`));
    return;
  }

  while (wrapper.firstChild) {
    fragment.appendChild(wrapper.firstChild);
  }
}

function renderMathExpressionsInHtml(html) {
  const rawHtml = String(html || "");
  if (!rawHtml) {
    return rawHtml;
  }

  // Passthrough mode: if KaTeX was already processed by marked-katex-extension
  // during markdown parsing, skip DOM-based post-processing to avoid double-handling.
  // The marked-katex-extension adds class="katex" to rendered math elements.
  if (rawHtml.includes("class=\"katex\"")) {
    return rawHtml;
  }

  if (!rawHtml.includes("$") || !canRenderCanvasMath()) {
    return rawHtml;
  }

  const container = document.createElement("div");
  container.innerHTML = rawHtml;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const text = String(node.textContent || "");
      if (!text.includes("$")) {
        return NodeFilter.FILTER_REJECT;
      }
      const parent = node.parentNode;
      if (!parent || !(parent instanceof Element)) {
        return NodeFilter.FILTER_REJECT;
      }
      if (parent.closest("pre, code, script, style, textarea, kbd, samp, svg, math, .katex")) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const textNodes = [];
  let currentNode;
  while ((currentNode = walker.nextNode())) {
    textNodes.push(currentNode);
  }

  textNodes.forEach((textNode) => {
    const source = String(textNode.textContent || "");
    const fragment = document.createDocumentFragment();
    let buffer = "";
    let index = 0;

    const flushBuffer = () => {
      if (!buffer) {
        return;
      }
      fragment.appendChild(document.createTextNode(buffer));
      buffer = "";
    };

    while (index < source.length) {
      const character = source[index];
      if (character === "\\") {
        const nextCharacter = source[index + 1] || "";
        if (nextCharacter === "$") {
          buffer += "$";
          index += 2;
          continue;
        }
        buffer += character;
        index += 1;
        continue;
      }

      if (character !== "$") {
        buffer += character;
        index += 1;
        continue;
      }

      const displayMode = source[index + 1] === "$";
      const delimiter = displayMode ? "$$" : "$";
      const mathStart = index + delimiter.length;
      const mathEnd = findClosingMathDelimiter(source, mathStart, delimiter);
      if (mathEnd < 0) {
        buffer += character;
        index += 1;
        continue;
      }

      const mathText = source.slice(mathStart, mathEnd).trim();
      if (!mathText) {
        buffer += delimiter;
        index = mathStart;
        continue;
      }

      flushBuffer();
      appendCanvasMathFragment(fragment, mathText, displayMode);
      index = mathEnd + delimiter.length;
    }

    flushBuffer();
    textNode.parentNode.replaceChild(fragment, textNode);
  });

  return container.innerHTML;
}

function renderMarkdown(text) {
  const rawText = closeUnclosedCodeFences(String(text || ""));
  if (markdownEngine && typeof markdownEngine.parse === "function") {
    try {
      return renderMathExpressionsInHtml(sanitizeHtml(markdownEngine.parse(rawText)));
    } catch (_) {
      // Fall through to plain-text fallback if the markdown engine throws.
    }
  }
  return renderMathExpressionsInHtml(sanitizeHtml(escHtml(rawText).replace(/\n/g, "<br>")));
}

function buildStreamingMarkdownRenderer() {
  const rendererCtor = globalThis.marked && typeof globalThis.marked.Renderer === "function"
    ? globalThis.marked.Renderer
    : null;
  if (!rendererCtor) {
    return null;
  }

  const renderer = new rendererCtor();
  renderer.code = (tokenOrCode, languageHint) => {
    const isToken = tokenOrCode !== null && typeof tokenOrCode === "object";
    const codeText = isToken ? String(tokenOrCode.text || "") : String(tokenOrCode || "");
    const rawLang = isToken ? (tokenOrCode.lang || null) : (languageHint || null);
    const language = String(rawLang || "").trim().toLowerCase();
    const languageClass = language ? ` class="language-${escHtml(language)}"` : "";
    return `<pre class="canvas-stream-code-block"><code${languageClass}>${escHtml(codeText)}</code></pre>`;
  };
  return renderer;
}

const streamingMarkdownRenderer = buildStreamingMarkdownRenderer();

function renderStreamingMarkdown(text) {
  const rawText = closeUnclosedCodeFences(String(text || ""));
  if (markdownEngine && typeof markdownEngine.parse === "function") {
    try {
      const parsed = streamingMarkdownRenderer
        ? markdownEngine.parse(rawText, { breaks: true, gfm: true, renderer: streamingMarkdownRenderer })
        : markdownEngine.parse(rawText);
      return sanitizeHtml(parsed);
    } catch (_) {
      return sanitizeHtml(escHtml(rawText).replace(/\n/g, "<br>"));
    }
  }
  return sanitizeHtml(escHtml(rawText).replace(/\n/g, "<br>"));
}

function renderCanvasMarkdownSheet(contentHtml, options = {}) {
  const extraClasses = Array.isArray(options.extraClasses) ? options.extraClasses.filter(Boolean) : [];
  const classes = ["canvas-page-sheet", ...extraClasses].join(" ");
  const rawAttributes = options.attributes && typeof options.attributes === "object"
    ? Object.entries(options.attributes)
        .filter(([, value]) => value !== undefined && value !== null && value !== "")
        .map(([key, value]) => `${key}="${escHtml(String(value))}"`)
        .join(" ")
    : "";
  const attributeText = rawAttributes ? ` ${rawAttributes}` : "";
  return (
    `<div class="canvas-document-shell">` +
      `<div class="canvas-page-content">` +
        `<article class="${classes}"${attributeText}>${contentHtml}</article>` +
      `</div>` +
    `</div>`
  );
}
