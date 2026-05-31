"""
Batch canvas editing operations.

Provides multi-operation batch editing with overlap validation,
atomic multi-document editing, and change preview functionality.
"""

from __future__ import annotations

import ast
import json
import re

from services.canvas.constants import CanvasBatchOverlapError

from services.canvas.normalize import (
    list_canvas_lines,
    join_canvas_lines,
    is_canvas_document_editable,
    _clip_text,
    CANVAS_MAX_CONTENT_LENGTH,
    CanvasValidationError,
)

from services.canvas.documents import (
    _find_canvas_document,
    _store_canvas_document,
    insert_canvas_lines,
    replace_canvas_lines,
    delete_canvas_lines,
)

from services.canvas.runtime import (
    create_canvas_runtime_state,
    _refresh_canvas_runtime_state,
    get_canvas_runtime_documents,
)


# ─── JSON Coercion ──────────────────────────────────────────────────────────────

def _coerce_batch_canvas_json_value(value):
    if not isinstance(value, str):
        return value
    raw_value = value.strip()
    if not raw_value:
        return value

    fenced_match = re.match(
        r"^```(?:json|javascript|js|python)?\s*(.*?)\s*```$", raw_value, flags=re.DOTALL | re.IGNORECASE
    )
    if fenced_match:
        raw_value = fenced_match.group(1).strip()

    if not raw_value:
        return value

    candidate_text = raw_value
    if candidate_text[0] not in "[{":
        opener_positions = [(candidate_text.find("["), "[", "]"), (candidate_text.find("{"), "{", "}")]
        opener_positions = [item for item in opener_positions if item[0] >= 0]
        if not opener_positions:
            return value
        opener_index, opener, closer = min(opener_positions, key=lambda item: item[0])
        closer_index = candidate_text.rfind(closer)
        if closer_index <= opener_index:
            return value
        candidate_text = candidate_text[opener_index : closer_index + 1].strip()

    try:
        return json.loads(candidate_text)
    except Exception:
        pass
    try:
        return ast.literal_eval(candidate_text)
    except Exception:
        pass
    return value


def _normalize_batch_canvas_operations_input(operations):
    return _normalize_batch_canvas_list_input(operations, keys=("operations", "edits", "items", "batch"))


def _normalize_batch_canvas_targets_input(targets):
    return _normalize_batch_canvas_list_input(targets, keys=("targets", "items", "documents", "batch"))


def _normalize_batch_canvas_list_input(value, *, keys: tuple[str, ...]):
    normalized = _coerce_batch_canvas_json_value(value)
    if isinstance(normalized, dict):
        for key in keys:
            candidate = _coerce_batch_canvas_json_value(normalized.get(key))
            if isinstance(candidate, list):
                normalized = candidate
                break
            if isinstance(candidate, dict):
                normalized = [candidate]
                break
    while isinstance(normalized, list) and len(normalized) == 1 and isinstance(normalized[0], list):
        normalized = normalized[0]
    if isinstance(normalized, dict):
        normalized = [normalized]
    return normalized


def _unwrap_singleton(candidate):
    """Recursively unwrap single-element lists."""
    while isinstance(candidate, list) and len(candidate) == 1:
        candidate = _coerce_batch_canvas_json_value(candidate[0])
    return candidate


def _unwrap_wrapper_keys(normalized: dict) -> dict:
    """Extract operation from wrapper keys like operation, edit, item, payload, args."""
    for wrapper_key in ("operation", "edit", "item", "payload", "args"):
        wrapped_candidate = _unwrap_singleton(_coerce_batch_canvas_json_value(normalized.get(wrapper_key)))
        if not isinstance(wrapped_candidate, dict):
            continue
        merged_candidate = dict(wrapped_candidate)
        for key, value in normalized.items():
            if key == wrapper_key:
                continue
            merged_candidate.setdefault(key, value)
        return merged_candidate
    return normalized


def _unwrap_action_keys(normalized: dict) -> dict:
    """Extract action from replace, insert, delete keys."""
    for action_key in ("replace", "insert", "delete"):
        wrapped_candidate = _unwrap_singleton(_coerce_batch_canvas_json_value(normalized.get(action_key)))
        if not isinstance(wrapped_candidate, dict):
            continue
        merged_candidate = dict(wrapped_candidate)
        for key, value in normalized.items():
            if key == action_key or key in {"replace", "insert", "delete"}:
                continue
            merged_candidate.setdefault(key, value)
        merged_candidate["action"] = action_key
        return merged_candidate
    return normalized


def _infer_action_if_missing(normalized: dict) -> dict:
    """Infer action type from field names when action is not explicitly set."""
    action = str(normalized.get("action") or "").strip().lower()
    if action in {"replace", "insert", "delete"}:
        normalized["action"] = action
        return normalized

    inferred_action = None
    if "after_line" in normalized:
        inferred_action = "insert"
    elif "start_line" in normalized and "end_line" in normalized:
        if any(key in normalized for key in ("lines", "content", "text", "value")):
            inferred_action = "replace"
        else:
            inferred_action = "delete"

    if not inferred_action:
        return normalized

    normalized = dict(normalized)
    normalized["action"] = inferred_action
    return normalized


def _normalize_line_payload(normalized: dict) -> dict:
    """Normalize line payload for replace/insert actions."""
    action = normalized.get("action")
    if action not in {"replace", "insert"} or "lines" in normalized:
        return normalized

    for field_name in ("lines", "content", "text", "value"):
        if field_name in normalized:
            line_payload = normalized.pop(field_name)
            normalized["lines"] = _normalize_batch_canvas_lines(line_payload, field_name="lines")
            break

    return normalized


def _normalize_batch_canvas_operation_candidate(operation):
    # Step 1: Coerce and unwrap singletons
    normalized = _coerce_batch_canvas_json_value(operation)
    normalized = _unwrap_singleton(normalized)

    if not isinstance(normalized, dict):
        return normalized

    # Step 2: Unwrap wrapper keys
    normalized = _unwrap_wrapper_keys(normalized)

    # Step 3: Unwrap action keys
    normalized = _unwrap_action_keys(normalized)

    # Step 4: Infer action if missing
    normalized = _infer_action_if_missing(normalized)

    # Step 5: Normalize line payload
    normalized = _normalize_line_payload(normalized)

    return normalized


def _normalize_batch_canvas_lines(value, *, field_name: str) -> list[str]:
    value = _coerce_batch_canvas_json_value(value)
    if value is None:
        return []
    if isinstance(value, str):
        return [value]
    if not isinstance(value, list):
        raise ValueError(f"Batch canvas edit field '{field_name}' must be an array of strings.")
    return [str(line) for line in value]


def _normalize_batch_canvas_operation(operation: dict, index: int) -> dict:
    operation = _normalize_batch_canvas_operation_candidate(operation)
    if not isinstance(operation, dict):
        raise ValueError(f"Batch canvas operation #{index + 1} must be an object.")

    action = str(operation.get("action") or "").strip().lower()
    if action not in {"replace", "insert", "delete"}:
        raise ValueError(f"Batch canvas operation #{index + 1} has unsupported action: {action or '<empty>'}.")

    normalized = {"action": action, "index": index}
    expected_lines = operation.get("expected_lines")
    if expected_lines is not None:
        normalized["expected_lines"] = _normalize_batch_canvas_lines(expected_lines, field_name="expected_lines")

    expected_start_line = operation.get("expected_start_line")
    if expected_start_line is not None:
        try:
            normalized_expected_start_line = int(expected_start_line)
        except (TypeError, ValueError) as exc:
            raise ValueError(f"Batch canvas operation #{index + 1} has an invalid expected_start_line.") from exc
        if normalized_expected_start_line < 1:
            raise ValueError(f"Batch canvas operation #{index + 1} expected_start_line must be at least 1.")
        normalized["expected_start_line"] = normalized_expected_start_line

    if action == "insert":
        try:
            after_line = int(operation.get("after_line"))
        except (TypeError, ValueError) as exc:
            raise ValueError(f"Batch canvas operation #{index + 1} is missing a valid after_line.") from exc
        if after_line < 0:
            raise ValueError(f"Batch canvas operation #{index + 1} after_line must be at least 0.")
        normalized["after_line"] = after_line
        normalized["lines"] = _normalize_batch_canvas_lines(operation.get("lines"), field_name="lines")
        return normalized

    try:
        start_line = int(operation.get("start_line"))
        end_line = int(operation.get("end_line"))
    except (TypeError, ValueError) as exc:
        raise ValueError(f"Batch canvas operation #{index + 1} is missing a valid line range.") from exc

    if start_line < 1 or end_line < start_line:
        raise ValueError(f"Batch canvas operation #{index + 1} must define a valid 1-based inclusive range.")

    normalized["start_line"] = start_line
    normalized["end_line"] = end_line
    if action == "replace":
        normalized["lines"] = _normalize_batch_canvas_lines(operation.get("lines"), field_name="lines")
    return normalized


# ─── Offset Calculation ─────────────────────────────────────────────────────────

def _batch_canvas_operation_delta(operation: dict) -> int:
    action = operation["action"]
    if action == "insert":
        return len(operation.get("lines") or [])
    replaced_count = operation["end_line"] - operation["start_line"] + 1
    if action == "delete":
        return -replaced_count
    return len(operation.get("lines") or []) - replaced_count


def _calculate_batch_canvas_offset(reference_line: int, prior_operations: list[dict]) -> int:
    offset = 0
    for operation in prior_operations:
        if operation["action"] == "insert":
            if operation["after_line"] < reference_line:
                offset += len(operation.get("lines") or [])
            continue
        if operation["start_line"] < reference_line:
            offset += _batch_canvas_operation_delta(operation)
    return offset


# ─── Overlap Detection ──────────────────────────────────────────────────────────

def _batch_canvas_operations_overlap(left: dict, right: dict) -> bool:
    left_action = left["action"]
    right_action = right["action"]

    if left_action == "insert" and right_action == "insert":
        return False
    if left_action == "insert":
        return right["start_line"] <= left["after_line"] <= right["end_line"]
    if right_action == "insert":
        return left["start_line"] <= right["after_line"] <= left["end_line"]
    return max(left["start_line"], right["start_line"]) <= min(left["end_line"], right["end_line"])


def _validate_batch_canvas_operations(operations: list[dict]) -> list[dict]:
    normalized_operations = [
        _normalize_batch_canvas_operation(operation, index) for index, operation in enumerate(operations)
    ]
    for index, left in enumerate(normalized_operations):
        for right in normalized_operations[index + 1 :]:
            if _batch_canvas_operations_overlap(left, right):
                raise CanvasBatchOverlapError(left["index"] + 1, right["index"] + 1)
    return normalized_operations


# ─── Apply Batch Edits ──────────────────────────────────────────────────────────

def _apply_validated_batch_canvas_edits(
    runtime_state: dict,
    normalized_operations: list[dict],
    *,
    document_id: str | None = None,
    document_path: str | None = None,
) -> dict:
    _, document = _find_canvas_document(runtime_state, document_id=document_id, document_path=document_path)
    resolved_document_id = str(document.get("id") or "").strip() or document_id

    applied_operations: list[dict] = []
    changed_ranges: list[dict] = []
    current_document = dict(document)
    for operation in normalized_operations:
        expected_start_line = operation.get("expected_start_line")
        adjusted_expected_start_line = None
        if expected_start_line is not None:
            adjusted_expected_start_line = expected_start_line + _calculate_batch_canvas_offset(
                expected_start_line,
                applied_operations,
            )

        if operation["action"] == "insert":
            original_after_line = operation["after_line"]
            adjusted_after_line = original_after_line + _calculate_batch_canvas_offset(
                original_after_line, applied_operations
            )
            current_document = insert_canvas_lines(
                runtime_state,
                after_line=adjusted_after_line,
                lines=operation.get("lines") or [],
                document_id=resolved_document_id,
                expected_lines=operation.get("expected_lines"),
                expected_start_line=adjusted_expected_start_line,
            )
            edit_start_line = adjusted_after_line + 1
            edit_end_line = adjusted_after_line + len(operation.get("lines") or [])
            changed_ranges.append(
                {
                    "operation_index": operation["index"],
                    "action": "insert",
                    "requested_after_line": original_after_line,
                    "applied_after_line": adjusted_after_line,
                    "edit_start_line": edit_start_line,
                    "edit_end_line": max(edit_start_line, edit_end_line),
                }
            )
        else:
            original_start_line = operation["start_line"]
            original_end_line = operation["end_line"]
            adjusted_start_line = original_start_line + _calculate_batch_canvas_offset(
                original_start_line, applied_operations
            )
            adjusted_end_line = original_end_line + _calculate_batch_canvas_offset(
                original_end_line, applied_operations
            )
            if operation["action"] == "replace":
                current_document = replace_canvas_lines(
                    runtime_state,
                    start_line=adjusted_start_line,
                    end_line=adjusted_end_line,
                    lines=operation.get("lines") or [],
                    document_id=resolved_document_id,
                    expected_lines=operation.get("expected_lines"),
                    expected_start_line=adjusted_expected_start_line,
                )
                replacement_line_count = len(operation.get("lines") or [])
                changed_ranges.append(
                    {
                        "operation_index": operation["index"],
                        "action": "replace",
                        "requested_start_line": original_start_line,
                        "requested_end_line": original_end_line,
                        "applied_start_line": adjusted_start_line,
                        "applied_end_line": adjusted_end_line,
                        "edit_start_line": adjusted_start_line,
                        "edit_end_line": max(adjusted_start_line, adjusted_start_line + replacement_line_count - 1),
                    }
                )
            else:
                current_document = delete_canvas_lines(
                    runtime_state,
                    start_line=adjusted_start_line,
                    end_line=adjusted_end_line,
                    document_id=resolved_document_id,
                    expected_lines=operation.get("expected_lines"),
                    expected_start_line=adjusted_expected_start_line,
                )
                changed_ranges.append(
                    {
                        "operation_index": operation["index"],
                        "action": "delete",
                        "requested_start_line": original_start_line,
                        "requested_end_line": original_end_line,
                        "applied_start_line": adjusted_start_line,
                        "applied_end_line": adjusted_end_line,
                        "edit_start_line": adjusted_end_line,
                        "edit_end_line": adjusted_end_line,
                    }
                )
        applied_operations.append(operation)

    edit_start_line = None
    edit_end_line = None
    if changed_ranges:
        edit_start_line = min(
            int(entry.get("edit_start_line") or 0) for entry in changed_ranges if entry.get("edit_start_line")
        )
        edit_end_line = max(
            int(entry.get("edit_end_line") or 0) for entry in changed_ranges if entry.get("edit_end_line")
        )

    return {
        "status": "ok",
        "action": "batch_edited",
        "document": current_document,
        "document_id": current_document.get("id"),
        "document_path": current_document.get("path"),
        "title": current_document.get("title"),
        "applied_count": len(applied_operations),
        "operation_count": len(normalized_operations),
        "changed_ranges": changed_ranges,
        "edit_start_line": edit_start_line,
        "edit_end_line": edit_end_line,
    }


# ─── Public Batch API ───────────────────────────────────────────────────────────

def batch_canvas_edits(
    runtime_state: dict,
    operations: list[dict],
    *,
    document_id: str | None = None,
    document_path: str | None = None,
    atomic: bool = False,
    targets: list[dict] | None = None,
) -> dict:
    if targets is not None:
        targets = _normalize_batch_canvas_targets_input(targets)
        if not isinstance(targets, list) or not targets:
            raise ValueError("batch_canvas_edits requires a non-empty targets array when targets is provided.")

        staged_documents: list[dict] = []
        results: list[dict] = []
        total_applied_count = 0
        for index, target in enumerate(targets):
            target = _normalize_batch_canvas_operation_candidate(target)
            if not isinstance(target, dict):
                raise ValueError(f"batch_canvas_edits target #{index + 1} must be an object.")
            target_operations = _normalize_batch_canvas_operations_input(target.get("operations"))
            if not isinstance(target_operations, list) or not target_operations:
                raise ValueError(f"batch_canvas_edits target #{index + 1} requires a non-empty operations array.")
            normalized_operations = _validate_batch_canvas_operations(target_operations)
            target_document_id = target.get("document_id")
            target_document_path = target.get("document_path")

            if atomic:
                _, target_document = _find_canvas_document(
                    runtime_state,
                    document_id=target_document_id,
                    document_path=target_document_path,
                )
                preview_state = create_canvas_runtime_state(
                    [dict(target_document)], active_document_id=target_document.get("id")
                )
                target_result = _apply_validated_batch_canvas_edits(
                    preview_state,
                    normalized_operations,
                    document_id=target_document.get("id"),
                )
                staged_documents.append(dict(target_result["document"]))
            else:
                target_result = _apply_validated_batch_canvas_edits(
                    runtime_state,
                    normalized_operations,
                    document_id=target_document_id,
                    document_path=target_document_path,
                )

            total_applied_count += int(target_result.get("applied_count") or 0)
            results.append(
                {
                    "document": build_canvas_document_result_snapshot(target_result.get("document")),
                    "document_id": target_result.get("document_id"),
                    "document_path": target_result.get("document_path"),
                    "title": target_result.get("title"),
                    "applied_count": target_result.get("applied_count", 0),
                    "operation_count": target_result.get("operation_count", 0),
                    "changed_ranges": target_result.get("changed_ranges") or [],
                    "edit_start_line": target_result.get("edit_start_line"),
                    "edit_end_line": target_result.get("edit_end_line"),
                }
            )

        if atomic:
            for staged_document in staged_documents:
                _store_canvas_document(runtime_state, staged_document)

        return {
            "status": "ok",
            "action": "batch_multi_edited",
            "results": results,
            "target_count": len(results),
            "total_applied_count": total_applied_count,
        }

    operations = _normalize_batch_canvas_operations_input(operations)
    if not isinstance(operations, list) or not operations:
        raise ValueError("batch_canvas_edits requires a non-empty operations array.")

    normalized_operations = _validate_batch_canvas_operations(operations)
    if not atomic:
        return _apply_validated_batch_canvas_edits(
            runtime_state,
            normalized_operations,
            document_id=document_id,
            document_path=document_path,
        )

    _, document = _find_canvas_document(runtime_state, document_id=document_id, document_path=document_path)
    preview_state = create_canvas_runtime_state([dict(document)], active_document_id=document.get("id"))
    result = _apply_validated_batch_canvas_edits(
        preview_state,
        normalized_operations,
        document_id=document.get("id"),
    )
    committed_document = _store_canvas_document(runtime_state, result["document"])
    result["document"] = committed_document
    result["document_id"] = committed_document.get("id")
    result["document_path"] = committed_document.get("path")
    result["title"] = committed_document.get("title")
    return result


def preview_canvas_changes(
    runtime_state: dict,
    operations: list[dict],
    *,
    document_id: str | None = None,
    document_path: str | None = None,
) -> dict:
    _, document = _find_canvas_document(runtime_state, document_id=document_id, document_path=document_path)
    if not is_canvas_document_editable(document):
        from services.canvas.constants import CanvasCapabilityError
        raise CanvasCapabilityError("preview_canvas_changes", document, "editable")
    preview_state = create_canvas_runtime_state([document], active_document_id=document.get("id"))
    operations = _normalize_batch_canvas_operations_input(operations)
    if not isinstance(operations, list) or not operations:
        raise ValueError("preview_canvas_changes requires a non-empty operations array.")
    normalized_operations = _validate_batch_canvas_operations(operations)
    preview_entries: list[dict] = []
    applied_operations: list[dict] = []

    for operation in normalized_operations:
        preview_document = get_canvas_runtime_documents(preview_state)[0]
        preview_lines = list_canvas_lines(preview_document.get("content") or "")
        if operation["action"] == "insert":
            original_after_line = operation["after_line"]
            adjusted_after_line = original_after_line + _calculate_batch_canvas_offset(
                original_after_line, applied_operations
            )
            after_index = max(0, adjusted_after_line)
            before_text = ""
            after_text = join_canvas_lines(operation.get("lines") or [])
            edit_start_line = adjusted_after_line + 1
            edit_end_line = max(edit_start_line, adjusted_after_line + len(operation.get("lines") or []))
            preview_entries.append(
                {
                    "operation_index": operation["index"],
                    "action": "insert",
                    "affected_lines": f"{edit_start_line}-{edit_end_line}",
                    "before": before_text,
                    "after": after_text,
                }
            )
        else:
            original_start_line = operation["start_line"]
            original_end_line = operation["end_line"]
            adjusted_start_line = original_start_line + _calculate_batch_canvas_offset(
                original_start_line, applied_operations
            )
            adjusted_end_line = original_end_line + _calculate_batch_canvas_offset(
                original_end_line, applied_operations
            )
            before_text = join_canvas_lines(preview_lines[adjusted_start_line - 1 : adjusted_end_line])
            after_text = "" if operation["action"] == "delete" else join_canvas_lines(operation.get("lines") or [])
            preview_entries.append(
                {
                    "operation_index": operation["index"],
                    "action": operation["action"],
                    "affected_lines": f"{adjusted_start_line}-{adjusted_end_line}",
                    "before": before_text,
                    "after": after_text,
                }
            )

        expected_start_line = operation.get("expected_start_line")
        adjusted_expected_start_line = None
        if expected_start_line is not None:
            adjusted_expected_start_line = expected_start_line + _calculate_batch_canvas_offset(
                expected_start_line, applied_operations
            )
        if operation["action"] == "insert":
            adjusted_after_line = operation["after_line"] + _calculate_batch_canvas_offset(
                operation["after_line"], applied_operations
            )
            insert_canvas_lines(
                preview_state,
                after_line=adjusted_after_line,
                lines=operation.get("lines") or [],
                document_id=document.get("id"),
                expected_lines=operation.get("expected_lines"),
                expected_start_line=adjusted_expected_start_line,
            )
        elif operation["action"] == "replace":
            adjusted_start_line = operation["start_line"] + _calculate_batch_canvas_offset(
                operation["start_line"], applied_operations
            )
            adjusted_end_line = operation["end_line"] + _calculate_batch_canvas_offset(
                operation["end_line"], applied_operations
            )
            replace_canvas_lines(
                preview_state,
                start_line=adjusted_start_line,
                end_line=adjusted_end_line,
                lines=operation.get("lines") or [],
                document_id=document.get("id"),
                expected_lines=operation.get("expected_lines"),
                expected_start_line=adjusted_expected_start_line,
            )
        else:
            adjusted_start_line = operation["start_line"] + _calculate_batch_canvas_offset(
                operation["start_line"], applied_operations
            )
            adjusted_end_line = operation["end_line"] + _calculate_batch_canvas_offset(
                operation["end_line"], applied_operations
            )
            delete_canvas_lines(
                preview_state,
                start_line=adjusted_start_line,
                end_line=adjusted_end_line,
                document_id=document.get("id"),
                expected_lines=operation.get("expected_lines"),
                expected_start_line=adjusted_expected_start_line,
            )
        applied_operations.append(operation)

    insertion_count = sum(1 for entry in preview_entries if entry["action"] == "insert")
    deletion_count = sum(1 for entry in preview_entries if entry["action"] == "delete")
    replace_count = sum(1 for entry in preview_entries if entry["action"] == "replace")
    summary_parts = []
    if insertion_count:
        summary_parts.append(f"{insertion_count} insertion(s)")
    if deletion_count:
        summary_parts.append(f"{deletion_count} deletion(s)")
    if replace_count:
        summary_parts.append(f"{replace_count} replacement(s)")
    summary = ", ".join(summary_parts) if summary_parts else "No changes"

    return {
        "status": "ok",
        "action": "previewed",
        "preview": {
            "document_path": document.get("path"),
            "document_id": document.get("id"),
            "title": document.get("title"),
            "changes": preview_entries,
            "summary": summary,
        },
    }


def build_canvas_document_result_snapshot(document: dict | None) -> dict | None:
    from services.canvas.normalize import normalize_canvas_document, CANVAS_CONTENT_MODE_TEXT, CANVAS_DOCUMENT_MODE_EDITABLE, CANVAS_MAX_RELATIONSHIP_ITEMS_PER_CATEGORY

    normalized = normalize_canvas_document(document)
    if not normalized:
        return None

    snapshot = {
        "id": normalized["id"],
        "title": normalized["title"],
        "format": normalized["format"],
        "line_count": normalized["line_count"],
        "content_mode": normalized.get("content_mode") or CANVAS_CONTENT_MODE_TEXT,
        "canvas_mode": normalized.get("canvas_mode") or CANVAS_DOCUMENT_MODE_EDITABLE,
    }
    if int(normalized.get("page_count") or 0) > 0:
        snapshot["page_count"] = int(normalized["page_count"])
    if normalized.get("language"):
        snapshot["language"] = normalized["language"]
    for key in (
        "path",
        "role",
        "summary",
        "project_id",
        "workspace_id",
        "source_file_id",
        "source_mime_type",
        "source_url",
        "source_title",
        "source_kind",
        "import_group_id",
    ):
        if normalized.get(key):
            snapshot[key] = normalized[key]
    for key in ("chunk_index", "chunk_count"):
        if int(normalized.get(key) or 0) > 0:
            snapshot[key] = int(normalized[key])
    for key in ("imports", "exports", "symbols", "dependencies"):
        values = normalized.get(key) if isinstance(normalized.get(key), list) else []
        if values:
            snapshot[key] = values
    visual_page_image_ids = (
        normalized.get("visual_page_image_ids") if isinstance(normalized.get("visual_page_image_ids"), list) else []
    )
    if visual_page_image_ids:
        snapshot["visual_page_image_ids"] = visual_page_image_ids
    if normalized.get("ignored") is True:
        snapshot["ignored"] = True
    if normalized.get("ignored_reason"):
        snapshot["ignored_reason"] = normalized["ignored_reason"]
    return snapshot