"""
Canvas service — structured sub-package.

This module provides all canvas-related functionality organized into
coherent sub-modules.
"""

from __future__ import annotations

# ─── Constants & Exceptions ───────────────────────────────────────────────────

from services.canvas.constants import (
    CanvasError,
    CanvasDocumentNotFoundError,
    CanvasCapabilityError,
    CanvasValidationError,
    CanvasContextDriftError,
    CanvasBatchOverlapError,
    CANVAS_MAX_DOCUMENTS,
    CANVAS_MAX_TITLE_LENGTH,
    CANVAS_MAX_CONTENT_LENGTH,
    CANVAS_MAX_LANGUAGE_LENGTH,
    CANVAS_MAX_PATH_LENGTH,
    CANVAS_MAX_SUMMARY_LENGTH,
    CANVAS_MAX_IGNORE_REASON_LENGTH,
    CANVAS_MAX_SOURCE_URL_LENGTH,
    CANVAS_MAX_SCOPE_ID_LENGTH,
    CANVAS_MAX_RELATION_COUNT,
    CANVAS_MAX_RELATION_ITEM_LENGTH,
    CANVAS_CONTEXT_MAX_CHARS,
    CANVAS_CONTEXT_MAX_LINES,
    CANVAS_MAX_RELATIONSHIP_ITEMS_PER_CATEGORY,
    CANVAS_MAX_RELATIONSHIP_AGGREGATE,
    CANVAS_MAX_DEPENDENCY_SUMMARIES,
    CANVAS_MAX_ID_LENGTH,
    CANVAS_MODE_DOCUMENT,
    CANVAS_MODE_PROJECT,
    CANVAS_CONTENT_MODE_TEXT,
    CANVAS_CONTENT_MODE_VISUAL,
    CANVAS_CONTENT_MODE_HYBRID,
    CANVAS_DOCUMENT_MODE_EDITABLE,
    CANVAS_DOCUMENT_MODE_PREVIEW_ONLY,
    CANVAS_ALLOWED_FORMATS,
    CANVAS_ALLOWED_ROLES,
    CANVAS_ALLOWED_CONTENT_MODES,
    CANVAS_ALLOWED_DOCUMENT_MODES,
    CANVAS_FILE_PRIORITY,
    CANVAS_ROOT_PATH_FILTER,
    EXTENSION_LANGUAGE_MAP,
    NAME_LANGUAGE_MAP,
    SHEBANG_LANGUAGE_MAP,
    MARKDOWN_EXTENSIONS,
)

# ─── Page & Tools ─────────────────────────────────────────────────────────────

from services.canvas.page import CANVAS_PAGE_HEADING_RE

from services.canvas.tools import (
    CANVAS_MUTATING_TOOL_NAMES,
    CANVAS_CONTENT_MUTATING_TOOL_NAMES,
)

# ─── Normalize ────────────────────────────────────────────────────────────────

from services.canvas.normalize import (
    normalize_canvas_document,
    extract_canvas_documents,
    list_canvas_lines,
    join_canvas_lines,
    get_canvas_document_capabilities,
    is_canvas_document_editable,
    is_canvas_document_visual,
    is_canvas_document_ignored,
    get_canvas_document_content_mode,
    get_canvas_document_canvas_mode,
    scale_canvas_char_limit,
    extract_canvas_primary_locator,
    extract_canvas_active_document_id,
    determine_canvas_mode,
    build_canvas_relationship_map,
)

# ─── Runtime ─────────────────────────────────────────────────────────────────

from services.canvas.runtime import (
    create_canvas_runtime_state,
    get_canvas_runtime_active_document_id,
    get_canvas_runtime_snapshot,
    compute_canvas_content_hash,
    get_canvas_runtime_documents,
)

# ─── Manifest ────────────────────────────────────────────────────────────────

from services.canvas.manifest import build_canvas_project_manifest

# ─── Viewport ────────────────────────────────────────────────────────────────

from services.canvas.viewport import (
    extract_canvas_viewports,
    set_canvas_viewport,
    clear_canvas_viewport,
    decrement_canvas_viewport_ttls,
    get_canvas_viewport_payloads,
    clear_overlapping_canvas_viewports,
)

# ─── Documents ──────────────────────────────────────────────────────────────

from services.canvas.documents import (
    create_canvas_document,
    rewrite_canvas_document,
    replace_canvas_lines,
    insert_canvas_lines,
    delete_canvas_lines,
    find_canvas_document,
)

from services.canvas.delete import delete_canvas_document

# ─── Batch ──────────────────────────────────────────────────────────────────

from services.canvas.batch import (
    batch_canvas_edits,
    preview_canvas_changes,
)

# ─── Transform ───────────────────────────────────────────────────────────────

from services.canvas.transform import transform_canvas_lines

# ─── Metadata ───────────────────────────────────────────────────────────────

from services.canvas.metadata import update_canvas_metadata

# ─── Search ─────────────────────────────────────────────────────────────────

from services.canvas.search import (
    scroll_canvas_document,
    search_canvas_document,
    batch_read_canvas_documents,
    build_canvas_document_context_result,
)

# ─── Validate ────────────────────────────────────────────────────────────────

from services.canvas.validate import validate_canvas_document

# ─── Snapshots ─────────────────────────────────────────────────────────────

from services.canvas.snapshots import (
    build_canvas_document_result_snapshot,
    build_canvas_tool_result,
)

# ─── Export ─────────────────────────────────────────────────────────────────

from services.canvas.export import (
    build_markdown_download,
    build_html_download,
    build_pdf_download,
)

# ─── Legacy ─────────────────────────────────────────────────────────────────

from services.canvas.legacy import (
    find_latest_canvas_state,
    find_latest_canvas_documents,
    find_latest_canvas_document,
)

