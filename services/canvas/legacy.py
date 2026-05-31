"""
Legacy canvas state finding from message history.

Provides functions for finding the latest canvas state/documents
by scanning backwards through a message list.
"""

from __future__ import annotations

from services.canvas.normalize import (
    extract_canvas_documents,
    extract_canvas_active_document_id,
    _normalize_document_path_for_lookup,
)

from services.canvas.runtime import create_canvas_runtime_state

from services.canvas.lookup import _find_canvas_document_by_path_locator

from services.canvas.viewport import extract_canvas_viewports


def find_latest_canvas_state(messages: list[dict]) -> dict:
    for message in reversed(messages or []):
        metadata = message.get("metadata") if isinstance(message, dict) else None
        if isinstance(metadata, dict) and metadata.get("canvas_cleared") is True:
            return create_canvas_runtime_state([], active_document_id=None)
        documents = extract_canvas_documents(metadata)
        if not documents:
            continue
        active_document_id = extract_canvas_active_document_id(metadata, documents)
        viewports = extract_canvas_viewports(metadata, documents)
        return create_canvas_runtime_state(documents, active_document_id=active_document_id, viewports=viewports)
    return create_canvas_runtime_state()


def find_latest_canvas_documents(messages: list[dict]) -> list[dict]:
    runtime_state = find_latest_canvas_state(messages)
    message_id = None
    for message in reversed(messages or []):
        metadata = message.get("metadata") if isinstance(message, dict) else None
        if isinstance(metadata, dict) and extract_canvas_documents(metadata):
            message_id = message.get("id") if isinstance(message.get("id"), int) else None
            break
    results = []
    for document in runtime_state.get("documents", []):
        result = dict(document)
        if message_id is not None:
            result["source_message_id"] = message_id
        results.append(result)
    return results


def find_latest_canvas_document(
    messages: list[dict],
    document_id: str | None = None,
    document_path: str | None = None,
) -> dict | None:
    target_id = str(document_id or "").strip()
    target_path = _normalize_document_path_for_lookup(document_path)
    documents = list(reversed(find_latest_canvas_documents(messages)))
    if target_path:
        match = _find_canvas_document_by_path_locator(documents, target_path)
        if match:
            _, document = match
            return dict(document)
        return None
    for document in documents:
        if not target_id or document.get("id") == target_id:
            return dict(document)
    return None