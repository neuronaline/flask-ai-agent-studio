"""
Authoritative set of canvas tool names that mutate state.

This module is the single source of truth for which tools modify canvas
content or viewport, imported by agent.py and messages.py.
"""

from __future__ import annotations

# Authoritative set of tool names that mutate canvas state (content or viewport).
# This is the single source of truth imported by agent.py and messages.py.
# Line-level and full-content document edits are exposed only through
# batch_canvas_edits. Lower-level document helpers remain internal.
CANVAS_MUTATING_TOOL_NAMES: frozenset[str] = frozenset({
    "create_canvas_document",
    "batch_canvas_edits",
    "delete_canvas_document",
})

# Subset of CANVAS_MUTATING_TOOL_NAMES that modify document *content* (not just
# viewport/navigation state).  Used by the prompt layer to decide whether to
# include editing-specific guidance sections.
CANVAS_CONTENT_MUTATING_TOOL_NAMES: frozenset[str] = frozenset({
    "create_canvas_document",
    "batch_canvas_edits",
    "delete_canvas_document",
})
