"""
Canvas metadata update operations.

Provides functions for updating document metadata fields including
title, summary, role, ignored state, and relationship lists.
"""

from __future__ import annotations

from services.canvas.normalize import (
    _normalize_canvas_short_text,
    _normalize_canvas_role,
    _normalize_canvas_ignore_reason,
    _normalize_canvas_string_list,
    is_canvas_document_editable,
    CANVAS_MAX_TITLE_LENGTH,
    CANVAS_MAX_SUMMARY_LENGTH,
)

from services.canvas.documents import _find_canvas_document, _store_canvas_document

from services.canvas.runtime import _refresh_canvas_runtime_state


def _merge_canvas_metadata_values(
    existing_values: list[str] | None,
    *,
    add_values: list[str] | None = None,
    remove_values: list[str] | None = None,
) -> list[str]:
    merged_values = list(existing_values or [])
    value_lookup = {str(item).casefold(): str(item) for item in merged_values}
    for value in _normalize_canvas_string_list(add_values):
        if value.casefold() in value_lookup:
            continue
        merged_values.append(value)
        value_lookup[value.casefold()] = value
    for value in _normalize_canvas_string_list(remove_values):
        value_lookup.pop(value.casefold(), None)
        merged_values = [item for item in merged_values if item.casefold() != value.casefold()]
    return merged_values


def update_canvas_metadata(
    runtime_state: dict,
    *,
    document_id: str | None = None,
    document_path: str | None = None,
    title: str | None = None,
    summary: str | None = None,
    role: str | None = None,
    ignored: bool | None = None,
    ignored_reason: str | None = None,
    add_imports: list[str] | None = None,
    remove_imports: list[str] | None = None,
    add_exports: list[str] | None = None,
    remove_exports: list[str] | None = None,
    add_dependencies: list[str] | None = None,
    remove_dependencies: list[str] | None = None,
    add_symbols: list[str] | None = None,
) -> dict:
    _, document = _find_canvas_document(runtime_state, document_id=document_id, document_path=document_path)
    if not is_canvas_document_editable(document):
        from services.canvas.constants import CanvasCapabilityError
        raise CanvasCapabilityError("update_canvas_metadata", document, "editable")
    next_document = dict(document)
    updated_fields: list[str] = []

    def add_updated_field(field_name: str) -> None:
        if field_name not in updated_fields:
            updated_fields.append(field_name)

    if title is not None:
        next_document["title"] = str(title or "Canvas").strip()[:CANVAS_MAX_TITLE_LENGTH] or "Canvas"
        add_updated_field("title")
    if summary is not None:
        next_document["summary"] = _normalize_canvas_short_text(
            summary, CANVAS_MAX_SUMMARY_LENGTH
        ) or next_document.get("summary")
        add_updated_field("summary")
    if role is not None:
        normalized_role = _normalize_canvas_role(role)
        if not normalized_role:
            raise ValueError(f"Unsupported canvas role: {role}")
        next_document["role"] = normalized_role
        add_updated_field("role")

    previous_ignored = document.get("ignored") is True
    previous_ignored_reason = _normalize_canvas_ignore_reason(document.get("ignored_reason"))
    next_ignored = previous_ignored
    if ignored is not None:
        next_ignored = bool(ignored)
    elif ignored_reason is not None and not next_ignored:
        next_ignored = True

    next_ignored_reason = previous_ignored_reason
    if ignored_reason is not None:
        next_ignored_reason = _normalize_canvas_ignore_reason(ignored_reason)

    if next_ignored:
        if not next_ignored_reason:
            raise ValueError("ignored_reason is required when ignoring a canvas document.")
        next_document["ignored"] = True
        next_document["ignored_reason"] = next_ignored_reason
    else:
        next_document.pop("ignored", None)
        next_document.pop("ignored_reason", None)

    if next_ignored != previous_ignored:
        add_updated_field("ignored")
    if next_ignored:
        if next_ignored_reason != previous_ignored_reason:
            add_updated_field("ignored_reason")
    elif previous_ignored_reason is not None:
        add_updated_field("ignored_reason")

    if add_imports is not None or remove_imports is not None:
        next_document["imports"] = _merge_canvas_metadata_values(
            next_document.get("imports"),
            add_values=add_imports,
            remove_values=remove_imports,
        )
        add_updated_field("imports")

    if add_exports is not None or remove_exports is not None:
        next_document["exports"] = _merge_canvas_metadata_values(
            next_document.get("exports"),
            add_values=add_exports,
            remove_values=remove_exports,
        )
        add_updated_field("exports")

    if add_dependencies is not None or remove_dependencies is not None:
        next_document["dependencies"] = _merge_canvas_metadata_values(
            next_document.get("dependencies"),
            add_values=add_dependencies,
            remove_values=remove_dependencies,
        )
        add_updated_field("dependencies")

    if add_symbols is not None:
        symbol_values = list(next_document.get("symbols") or [])
        symbol_lookup = {str(item).casefold() for item in symbol_values}
        for value in _normalize_canvas_string_list(add_symbols):
            if value.casefold() in symbol_lookup:
                continue
            symbol_values.append(value)
            symbol_lookup.add(value.casefold())
        next_document["symbols"] = symbol_values
        add_updated_field("symbols")

    normalized_document = _store_canvas_document(runtime_state, next_document)
    return {
        "status": "ok",
        "action": "metadata_updated",
        "document": normalized_document,
        "updated_fields": updated_fields,
    }