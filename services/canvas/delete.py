"""
Canvas document deletion.

Provides single and batch document deletion from canvas runtime state.
"""

from __future__ import annotations

from services.canvas.documents import _find_canvas_document

from services.canvas.viewport import clear_canvas_viewport

from services.canvas.runtime import _refresh_canvas_runtime_state, get_canvas_runtime_active_document_id

from services.canvas.constants import CanvasError

from services.canvas.normalize import extract_canvas_documents


def delete_canvas_document(
    runtime_state: dict,
    document_id: str | None = None,
    document_path: str | None = None,
    documents: list[dict] | None = None,
) -> dict:
    canvas_docs = runtime_state.get("documents") if isinstance(runtime_state, dict) else None
    if not isinstance(canvas_docs, list):
        raise ValueError("No canvas document is available yet.")

    if documents and len(documents) > 0:
        deleted_ids = []
        deleted_titles = []
        for doc_spec in documents:
            doc_id = doc_spec.get("document_id") if isinstance(doc_spec, dict) else None
            doc_path = doc_spec.get("document_path") if isinstance(doc_spec, dict) else None
            try:
                idx, doc = _find_canvas_document(runtime_state, document_id=doc_id, document_path=doc_path)
                removed = canvas_docs.pop(idx)
                deleted_ids.append(removed.get("id"))
                deleted_titles.append(removed.get("title"))
                clear_canvas_viewport(
                    runtime_state, document_id=str(removed.get("id") or "") or None, document_path=removed.get("path")
                )
            except (ValueError, CanvasError):
                pass
        runtime_state["active_document_id"] = None
        _refresh_canvas_runtime_state(runtime_state)
        return {
            "status": "ok",
            "action": "deleted",
            "deleted_ids": deleted_ids,
            "deleted_titles": deleted_titles,
            "remaining_count": len(canvas_docs),
        }
    else:
        index, document = _find_canvas_document(runtime_state, document_id=document_id, document_path=document_path)
        previous_active_document_id = get_canvas_runtime_active_document_id(runtime_state)
        removed = canvas_docs.pop(index)
        clear_canvas_viewport(
            runtime_state, document_id=str(removed.get("id") or "") or None, document_path=removed.get("path")
        )
        if canvas_docs:
            runtime_state["active_document_id"] = (
                canvas_docs[-1]["id"]
                if str(removed.get("id") or "") == str(previous_active_document_id or "")
                else previous_active_document_id
            )
        else:
            runtime_state["active_document_id"] = None
        _refresh_canvas_runtime_state(runtime_state)
        return {
            "status": "ok",
            "action": "deleted",
            "deleted_id": removed.get("id"),
            "deleted_title": removed.get("title"),
            "remaining_count": len(canvas_docs),
        }