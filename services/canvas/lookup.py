"""
Document lookup utilities for canvas.

Provides path-based document matching using a single-pass algorithm
that pre-computes normalized keys before iteration.
"""

from __future__ import annotations

from services.canvas.normalize import (
    _normalize_canvas_lookup_key,
    _normalize_canvas_lookup_basename,
    _normalize_document_path_for_lookup,
)


def _collect_canvas_document_path_matches(
    documents: list[dict], document_path: str | None
) -> dict[str, list[tuple[int, dict]]]:
    """Collect path matches for documents in a single O(n) pass.

    Pre-computes lookup keys before iteration to avoid redundant normalization.
    """
    lookup_key = _normalize_canvas_lookup_key(document_path)
    match_groups: dict[str, list[tuple[int, dict]]] = {
        "exact_path": [],
        "exact_title": [],
        "suffix": [],
        "basename": [],
    }
    if not lookup_key:
        return match_groups

    lookup_basename = _normalize_canvas_lookup_basename(document_path)
    has_path_segments = "/" in lookup_key
    suffix = f"/{lookup_key}" if has_path_segments else None
    seen_ids_by_group = {key: set() for key in match_groups}

    def add_match(group_key: str, index: int, document: dict) -> None:
        document_id = str(document.get("id") or "").strip() or f"index:{index}"
        if document_id in seen_ids_by_group[group_key]:
            return
        seen_ids_by_group[group_key].add(document_id)
        match_groups[group_key].append((index, document))

    for index, document in enumerate(documents):
        # Pre-compute normalized keys once per document
        path_key = _normalize_canvas_lookup_key(document.get("path"))
        title_key = _normalize_canvas_lookup_key(document.get("title"))

        if path_key == lookup_key:
            add_match("exact_path", index, document)
            continue

        if title_key == lookup_key:
            add_match("exact_title", index, document)
            continue

        if has_path_segments:
            if path_key and path_key.endswith(suffix):
                add_match("suffix", index, document)
                continue
            if title_key and title_key.endswith(suffix):
                add_match("suffix", index, document)
                continue

        if not lookup_basename:
            continue
        path_basename = path_key.rsplit("/", 1)[-1] if path_key else None
        title_basename = title_key.rsplit("/", 1)[-1] if path_key else None
        if path_basename == lookup_basename:
            add_match("basename", index, document)
            continue
        if title_basename == lookup_basename:
            add_match("basename", index, document)

    return match_groups


def _find_canvas_document_by_path_locator(documents: list[dict], document_path: str | None) -> tuple[int, dict] | None:
    matches = _collect_canvas_document_path_matches(documents, document_path)
    if matches["exact_path"]:
        return matches["exact_path"][0]
    if len(matches["exact_title"]) == 1:
        return matches["exact_title"][0]
    if len(matches["suffix"]) == 1:
        return matches["suffix"][0]
    if len(matches["basename"]) == 1:
        return matches["basename"][0]
    return None


def _describe_canvas_path_matches(documents: list[dict], document_path: str | None) -> str:
    matches = _collect_canvas_document_path_matches(documents, document_path)
    candidate_matches = matches["exact_path"] or matches["exact_title"] or matches["suffix"] or matches["basename"]
    if len(candidate_matches) <= 1:
        return ""

    candidates = []
    for _, document in candidate_matches[:5]:
        label = str(document.get("path") or document.get("title") or document.get("id") or "Canvas").strip()
        if label:
            candidates.append(label)
    if not candidates:
        return ""
    return ", ".join(candidates)