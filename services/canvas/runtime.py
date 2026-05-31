"""
Canvas runtime state management.

Provides functions for creating and querying the canvas runtime state,
which is the in-memory representation of the canvas across a conversation.
"""

from __future__ import annotations

import hashlib

from services.canvas.normalize import (
    extract_canvas_documents,
    determine_canvas_mode,
    extract_canvas_active_document_id,
)

from services.canvas.viewport import extract_canvas_viewports


def create_canvas_runtime_state(
    initial_documents: list[dict] | None = None,
    active_document_id: str | None = None,
    viewports: dict[str, dict] | None = None,
) -> dict:
    documents = extract_canvas_documents({"canvas_documents": initial_documents or []})
    resolved_active_document_id = extract_canvas_active_document_id(
        {"active_document_id": active_document_id}, documents
    )
    runtime_state = {
        "documents": documents,
        "active_document_id": resolved_active_document_id,
        "viewports": extract_canvas_viewports({"canvas_viewports": viewports or {}}, documents),
    }
    runtime_state["mode"] = determine_canvas_mode(documents)
    return runtime_state


def get_canvas_runtime_active_document_id(runtime_state: dict | None) -> str | None:
    if not isinstance(runtime_state, dict):
        return None
    return extract_canvas_active_document_id(
        {"active_document_id": runtime_state.get("active_document_id")},
        runtime_state.get("documents") if isinstance(runtime_state.get("documents"), list) else [],
    )


def get_canvas_runtime_snapshot(runtime_state: dict | None) -> dict:
    documents = get_canvas_runtime_documents(runtime_state)
    active_document_id = get_canvas_runtime_active_document_id(runtime_state)
    return {
        "documents": documents,
        "active_document_id": active_document_id,
        "viewports": extract_canvas_viewports({"canvas_viewports": (runtime_state or {}).get("viewports")}, documents),
        "mode": determine_canvas_mode(documents),
        "manifest": None,  # filled in by caller if needed
    }


def compute_canvas_content_hash(runtime_state: dict | None) -> str | None:
    """Compute a short SHA-256 hash of the active canvas document's content from runtime state.

    This function should be called after mutations to get the authoritative hash
    based on backend runtime state, ensuring UI and backend are synchronized.
    """
    if not isinstance(runtime_state, dict):
        return None
    documents = get_canvas_runtime_documents(runtime_state)
    active_document_id = get_canvas_runtime_active_document_id(runtime_state)
    if not documents or not active_document_id:
        return None
    for doc in documents:
        if not isinstance(doc, dict):
            continue
        if str(doc.get("id") or "") == active_document_id:
            content = str(doc.get("content") or "")
            if content:
                return hashlib.sha256(content.encode("utf-8")).hexdigest()[:16]
    return None


def get_canvas_runtime_documents(runtime_state: dict | None) -> list[dict]:
    if not isinstance(runtime_state, dict):
        return []
    return extract_canvas_documents({"canvas_documents": runtime_state.get("documents") or []})


def _refresh_canvas_runtime_state(runtime_state: dict) -> None:
    documents = get_canvas_runtime_documents(runtime_state)
    runtime_state["documents"] = documents
    runtime_state["active_document_id"] = extract_canvas_active_document_id(
        {"active_document_id": runtime_state.get("active_document_id")},
        documents,
    )
    runtime_state["mode"] = determine_canvas_mode(documents)
    runtime_state["viewports"] = extract_canvas_viewports(
        {"canvas_viewports": runtime_state.get("viewports")}, documents
    )