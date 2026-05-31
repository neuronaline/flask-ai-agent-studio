"""
Canvas project manifest building.

Produces the project-level summary of all canvas documents including
file list, dependency summaries, and relationship map.
"""

from __future__ import annotations

from services.canvas.normalize import (
    extract_canvas_documents,
    normalize_canvas_document,
    _document_sort_key,
    _build_canvas_summary,
    _normalize_document_path_for_lookup,
    _normalize_canvas_path,
    _normalize_canvas_chunk_position,
    _normalize_canvas_string_list,
    _resolve_active_canvas_document,
    determine_canvas_mode,
    _infer_canvas_target_type,
    _infer_manifest_name,
    build_canvas_relationship_map,
    CANVAS_FILE_PRIORITY,
    CANVAS_MAX_DOCUMENTS,
    CANVAS_MAX_RELATIONSHIP_ITEMS_PER_CATEGORY,
    CANVAS_MAX_DEPENDENCY_SUMMARIES,
    CANVAS_MODE_PROJECT,
)


def build_canvas_project_manifest(documents: list[dict] | None, active_document_id: str | None = None) -> dict | None:
    raw_documents = documents or []
    normalized_documents = extract_canvas_documents({"canvas_documents": raw_documents})
    if not normalized_documents:
        return None

    raw_normalized_documents = [
        cleaned
        for cleaned in (normalize_canvas_document(entry) for entry in raw_documents[:CANVAS_MAX_DOCUMENTS])
        if cleaned
    ]

    active_document = _resolve_active_canvas_document(normalized_documents, active_document_id)
    mode = determine_canvas_mode(raw_normalized_documents or normalized_documents)
    dependency_summaries = []
    seen_dependency_summaries = set()
    open_issues = []
    file_list = []

    missing_paths = 0
    missing_roles = 0
    for document in normalized_documents:
        summary = str(document.get("summary") or "").strip() or _build_canvas_summary(
            str(document.get("title") or "Canvas"),
            document.get("path"),
            document.get("role"),
            str(document.get("content") or ""),
        )
        role = str(document.get("role") or "note")
        entry = {
            "id": document["id"],
            "title": document["title"],
            "format": document["format"],
            "summary": summary,
            "line_count": int(document.get("line_count") or 0),
            "active": active_document is not None and document["id"] == active_document["id"],
            "priority": CANVAS_FILE_PRIORITY.get(role, 999),
        }
        for key in (
            "path",
            "role",
            "language",
            "project_id",
            "workspace_id",
            "content_mode",
            "canvas_mode",
        ):
            if document.get(key):
                entry[key] = document[key]
        for key in ("source_url", "source_title", "source_kind", "import_group_id"):
            if document.get(key):
                entry[key] = document[key]
        for key in ("chunk_index", "chunk_count"):
            normalized_chunk_position = _normalize_canvas_chunk_position(document.get(key))
            if normalized_chunk_position is not None:
                entry[key] = normalized_chunk_position
        for key in ("imports", "exports", "symbols", "dependencies"):
            values = document.get(key) if isinstance(document.get(key), list) else []
            if values:
                entry[key] = values[:CANVAS_MAX_RELATIONSHIP_ITEMS_PER_CATEGORY]
        if int(document.get("page_count") or 0) > 0:
            entry["page_count"] = int(document["page_count"])
        if document.get("ignored") is True:
            entry["ignored"] = True
        if document.get("ignored_reason"):
            entry["ignored_reason"] = document["ignored_reason"]
        file_list.append(entry)

        if mode == CANVAS_MODE_PROJECT and not document.get("path"):
            missing_paths += 1
        if mode == CANVAS_MODE_PROJECT and not document.get("role"):
            missing_roles += 1

        dependency_values = document.get("dependencies") if isinstance(document.get("dependencies"), list) else []
        for value in dependency_values:
            normalized_value = str(value).strip()
            dedupe_key = normalized_value.lower()
            if not normalized_value or dedupe_key in seen_dependency_summaries:
                continue
            dependency_summaries.append(normalized_value)
            seen_dependency_summaries.add(dedupe_key)

    if mode == CANVAS_MODE_PROJECT and missing_paths:
        open_issues.append("Some project canvas documents are missing a path.")
    if mode == CANVAS_MODE_PROJECT and missing_roles:
        open_issues.append("Some project canvas documents are missing a role.")

    file_list.sort(key=_document_sort_key)

    validation_issues = []
    if mode == CANVAS_MODE_PROJECT:
        raw_normalized_paths = []
        for entry in raw_documents[:CANVAS_MAX_DOCUMENTS]:
            if not isinstance(entry, dict):
                continue
            path = _normalize_document_path_for_lookup(entry.get("path"))
            if path:
                raw_normalized_paths.append(path.lower())
        if len(raw_normalized_paths) != len(set(raw_normalized_paths)):
            validation_issues.append("Duplicate project paths detected.")
        active_paths = [entry.get("path") for entry in file_list if entry.get("path")]
        if not any((entry.get("role") == "source") for entry in file_list):
            validation_issues.append("No source file is marked in the project manifest.")

    manifest = {
        "mode": mode,
        "project_name": _infer_manifest_name(normalized_documents, active_document),
        "target_type": _infer_canvas_target_type(normalized_documents, active_document),
        "document_count": len(normalized_documents),
        "active_document_id": active_document["id"] if active_document else None,
        "active_path": active_document.get("path") if active_document else None,
        "active_file": active_document.get("path") or active_document.get("title") if active_document else None,
        "file_list": file_list,
        "open_issues": [*open_issues, *validation_issues],
        "last_validation_status": "ok" if not validation_issues else "needs_attention",
        "dependency_summaries": dependency_summaries[:CANVAS_MAX_DEPENDENCY_SUMMARIES],
        "relationship_map": build_canvas_relationship_map(normalized_documents),
    }
    if active_document and active_document.get("project_id"):
        manifest["project_id"] = active_document["project_id"]
    if active_document and active_document.get("workspace_id"):
        manifest["workspace_id"] = active_document["workspace_id"]
    return manifest