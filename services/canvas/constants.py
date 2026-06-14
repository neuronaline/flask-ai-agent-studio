"""
Canvas service constants and shared configuration.

This module is the single source of truth for Canvas-related constants,
including size limits, mode flags, and language mappings used by both
Python (backend) and JavaScript (frontend) code.
"""

from __future__ import annotations

# ─── Custom Exceptions ─────────────────────────────────────────────────────────


class CanvasError(Exception):
    """Base exception for all Canvas-related errors."""

    def __init__(self, message: str, *, document_title: str | None = None) -> None:
        self.document_title = document_title
        super().__init__(message)


class CanvasDocumentNotFoundError(CanvasError):
    """Raised when a canvas document cannot be found by id or path."""

    def __init__(
        self,
        document_id: str | None = None,
        document_path: str | None = None,
        *,
        suggestion: str | None = None,
    ) -> None:
        self.document_id = document_id
        self.document_path = document_path
        self.suggestion = suggestion
        parts = []
        if document_id:
            parts.append(f"id={document_id!r}")
        if document_path:
            parts.append(f"path={document_path!r}")
        msg = f"Canvas document not found: {', '.join(parts)}"
        if suggestion:
            msg += f". {suggestion}"
        super().__init__(msg, document_title=document_path or document_id)


class CanvasCapabilityError(ValueError, CanvasError):
    """Raised when an operation is not permitted for the document type."""

    def __init__(
        self,
        action: str,
        document: dict,
        capability: str,
    ) -> None:
        self.action = action
        self.capability = capability
        title = str(document.get("title") or "Canvas").strip() or "Canvas"
        ignored = document.get("ignored") is True
        if ignored:
            message = (
                f"{action} is not available for the ignored canvas document {title!r}. "
                "Re-enable it with ignored=false before using text-addressable tools."
            )
        elif capability == "editable":
            message = (
                f"{action} is not available for the read-only visual canvas document {title!r}. "
                "Visual canvas documents must be inspected instead of edited."
            )
        else:
            message = (
                f"{action} is not available for the visual canvas document {title!r}. "
                "This document is image-backed and does not provide text-addressable lines. "
                "Switch to a text-extracted document for line-based tools."
            )
        CanvasError.__init__(self, message, document_title=title)


class CanvasValidationError(CanvasError):
    """Raised when canvas input validation fails."""

    pass


class CanvasContextDriftError(CanvasValidationError):
    """Raised when expected lines no longer match the current document state."""

    def __init__(
        self,
        message: str,
        *,
        expected_start_line: int | None = None,
        expected_end_line: int | None = None,
    ) -> None:
        self.expected_start_line = expected_start_line
        self.expected_end_line = expected_end_line
        super().__init__(message)


class CanvasBatchOverlapError(CanvasValidationError):
    """Raised when batch operations have overlapping line ranges."""

    def __init__(
        self,
        operation_a: int,
        operation_b: int,
    ) -> None:
        self.operation_a = operation_a
        self.operation_b = operation_b
        super().__init__(
            f"Batch canvas operations #{operation_a} and #{operation_b} overlap. "
            "Split them into separate non-overlapping edits."
        )


# ─── Size Limits ────────────────────────────────────────────────────────────────
CANVAS_MAX_DOCUMENTS: int = 50
CANVAS_MAX_TITLE_LENGTH: int = 160
CANVAS_MAX_CONTENT_LENGTH: int = 120_000
CANVAS_MAX_LANGUAGE_LENGTH: int = 48
CANVAS_MAX_PATH_LENGTH: int = 240
CANVAS_MAX_SUMMARY_LENGTH: int = 280
CANVAS_MAX_IGNORE_REASON_LENGTH: int = 280
CANVAS_MAX_SOURCE_URL_LENGTH: int = 500
CANVAS_MAX_SCOPE_ID_LENGTH: int = 80
CANVAS_MAX_RELATION_COUNT: int = 24
CANVAS_MAX_RELATION_ITEM_LENGTH: int = 120
CANVAS_CONTEXT_MAX_CHARS: int = 20_000
CANVAS_CONTEXT_MAX_LINES: int = 800
CANVAS_MAX_RELATIONSHIP_ITEMS_PER_CATEGORY: int = 8
CANVAS_MAX_RELATIONSHIP_AGGREGATE: int = 24
CANVAS_MAX_DEPENDENCY_SUMMARIES: int = 16
CANVAS_MAX_ID_LENGTH: int = 80

# ─── Mode Flags ─────────────────────────────────────────────────────────────────
CANVAS_MODE_DOCUMENT: str = "document"
CANVAS_MODE_PROJECT: str = "project"
CANVAS_CONTENT_MODE_TEXT: str = "text"
CANVAS_CONTENT_MODE_VISUAL: str = "visual"
CANVAS_CONTENT_MODE_HYBRID: str = "hybrid"
CANVAS_DOCUMENT_MODE_EDITABLE: str = "editable"
CANVAS_DOCUMENT_MODE_PREVIEW_ONLY: str = "preview_only"

# ─── Allowed Sets ────────────────────────────────────────────────────────────────
CANVAS_ALLOWED_FORMATS: frozenset[str] = frozenset({"markdown", "code"})
CANVAS_ALLOWED_ROLES: frozenset[str] = frozenset({"source", "config", "dependency", "docs", "test", "script", "note"})
CANVAS_ALLOWED_CONTENT_MODES: frozenset[str] = frozenset({
    CANVAS_CONTENT_MODE_TEXT,
    CANVAS_CONTENT_MODE_VISUAL,
    CANVAS_CONTENT_MODE_HYBRID,
})
CANVAS_ALLOWED_DOCUMENT_MODES: frozenset[str] = frozenset({
    CANVAS_DOCUMENT_MODE_EDITABLE,
    CANVAS_DOCUMENT_MODE_PREVIEW_ONLY,
})

# ─── File Priority ──────────────────────────────────────────────────────────────
CANVAS_FILE_PRIORITY: dict[str, int] = {
    "source": 10,
    "config": 20,
    "dependency": 30,
    "test": 40,
    "script": 50,
    "docs": 60,
    "note": 70,
}

# ─── Special Filter Values ───────────────────────────────────────────────────────
CANVAS_ROOT_PATH_FILTER: str = "/"

# ─── Language Mapping (shared with frontend via canvas_config.json) ─────────────
EXTENSION_LANGUAGE_MAP: dict[str, str] = {
    ".py": "python",
    ".pyw": "python",
    ".js": "javascript",
    ".mjs": "javascript",
    ".cjs": "javascript",
    ".ts": "typescript",
    ".mts": "typescript",
    ".jsx": "jsx",
    ".tsx": "tsx",
    ".c": "c",
    ".h": "c",
    ".cpp": "cpp",
    ".cc": "cpp",
    ".cxx": "cpp",
    ".hpp": "cpp",
    ".hh": "cpp",
    ".ino": "cpp",  # Arduino
    ".cs": "csharp",
    ".java": "java",
    ".rb": "ruby",
    ".go": "go",
    ".rs": "rust",
    ".php": "php",
    ".swift": "swift",
    ".kt": "kotlin",
    ".kts": "kotlin",
    ".scala": "scala",
    ".sh": "bash",
    ".bash": "bash",
    ".zsh": "bash",
    ".ps1": "powershell",
    ".psm1": "powershell",
    ".html": "html",
    ".htm": "html",
    ".css": "css",
    ".scss": "scss",
    ".sass": "sass",
    ".less": "less",
    ".sql": "sql",
    ".json": "json",
    ".jsonc": "json",
    ".yaml": "yaml",
    ".yml": "yaml",
    ".toml": "toml",
    ".ini": "ini",
    ".cfg": "ini",
    ".xml": "xml",
    ".md": "markdown",
    ".mdx": "markdown",
    ".r": "r",
    ".lua": "lua",
    ".dart": "dart",
    ".ex": "elixir",
    ".exs": "elixir",
    ".hs": "haskell",
    ".tf": "terraform",
    ".tfvars": "terraform",
    ".proto": "protobuf",
    ".vue": "vue",
    ".svelte": "svelte",
}

NAME_LANGUAGE_MAP: dict[str, str] = {
    "dockerfile": "dockerfile",
    "makefile": "makefile",
    "gemfile": "ruby",
    "rakefile": "ruby",
    "vagrantfile": "ruby",
    "jenkinsfile": "groovy",
}

SHEBANG_LANGUAGE_MAP: dict[str, str] = {
    "python": "python",
    "python3": "python",
    "python2": "python",
    "node": "javascript",
    "nodejs": "javascript",
    "ruby": "ruby",
    "perl": "perl",
    "perl5": "perl",
    "bash": "bash",
    "sh": "bash",
    "zsh": "bash",
    "dash": "bash",
    "php": "php",
    "lua": "lua",
    "rscript": "r",
    "groovy": "groovy",
    "tclsh": "tcl",
    "expect": "tcl",
    "awk": "awk",
    "gawk": "awk",
}

# ─── Markdown Upload Extensions (used by both Python and JS) ───────────────────
MARKDOWN_EXTENSIONS: frozenset[str] = frozenset({".md", ".markdown", ".mdx", ".txt", ".rst", ".adoc", ".org"})