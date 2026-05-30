from __future__ import annotations

from datetime import datetime

from core.config import RAG_SOURCE_CONVERSATION, RAG_SOURCE_TOOL_RESULT
from core.db import (
    delete_file_asset,
    delete_image_asset,
    delete_video_asset,
    get_db,
    mark_messages_deleted_by_edit_replay,
    revert_conversation_state_mutations,
    soft_delete_messages,
)


from services.rag_service import (
    conversation_archived_rag_source_key,
    conversation_rag_source_key,
    delete_rag_source_record,
)


def _get_anchor_message_row(conversation_id: int, message_id: int):
    with get_db() as conn:
        return conn.execute(
            """SELECT id, conversation_id, position, role, deleted_at
               FROM messages
               WHERE id = ? AND conversation_id = ? AND deleted_at IS NULL""",
            (int(message_id), int(conversation_id)),
        ).fetchone()


def collect_branch_message_rows(
    conversation_id: int,
    anchor_message_id: int,
    *,
    include_anchor: bool,
) -> list[dict]:
    anchor_row = _get_anchor_message_row(conversation_id, anchor_message_id)
    if not anchor_row:
        return []

    operator = ">=" if include_anchor else ">"
    with get_db() as conn:
        rows = conn.execute(
            f"""SELECT id, conversation_id, position, role, content, metadata, tool_calls, tool_call_id,
                       prompt_tokens, completion_tokens, total_tokens, deleted_at
                  FROM messages
                 WHERE conversation_id = ? AND deleted_at IS NULL AND position {operator} ?
                 ORDER BY position ASC, id ASC""",
            (int(conversation_id), int(anchor_row["position"] or 0)),
        ).fetchall()
    return [dict(row) for row in rows]


def _delete_model_invocations_for_messages(conversation_id: int, message_ids: list[int]) -> int:
    normalized_ids = [int(message_id) for message_id in message_ids if int(message_id or 0) > 0]
    if not normalized_ids:
        return 0

    placeholders = ", ".join("?" for _ in normalized_ids)
    with get_db() as conn:
        cursor = conn.execute(
            f"""DELETE FROM model_invocations
                WHERE conversation_id = ?
                  AND (
                    source_message_id IN ({placeholders})
                    OR assistant_message_id IN ({placeholders})
                  )""",
            (int(conversation_id), *normalized_ids, *normalized_ids),
        )
    return int(cursor.rowcount or 0)


def purge_message_linked_assets(conversation_id: int, message_ids: list[int]) -> dict:
    normalized_ids = [int(message_id) for message_id in message_ids if int(message_id or 0) > 0]
    if not normalized_ids:
        return {"image_ids": [], "file_ids": [], "video_ids": []}

    placeholders = ", ".join("?" for _ in normalized_ids)
    with get_db() as conn:
        image_ids = [
            str(row["image_id"] or "").strip()
            for row in conn.execute(
                f"SELECT image_id FROM image_assets WHERE conversation_id = ? AND message_id IN ({placeholders})",
                (int(conversation_id), *normalized_ids),
            ).fetchall()
            if str(row["image_id"] or "").strip()
        ]
        file_ids = [
            str(row["file_id"] or "").strip()
            for row in conn.execute(
                f"SELECT file_id FROM file_assets WHERE conversation_id = ? AND message_id IN ({placeholders})",
                (int(conversation_id), *normalized_ids),
            ).fetchall()
            if str(row["file_id"] or "").strip()
        ]
        video_ids = [
            str(row["video_id"] or "").strip()
            for row in conn.execute(
                f"SELECT video_id FROM video_assets WHERE conversation_id = ? AND message_id IN ({placeholders})",
                (int(conversation_id), *normalized_ids),
            ).fetchall()
            if str(row["video_id"] or "").strip()
        ]

    for image_id in image_ids:
        delete_image_asset(image_id, conversation_id=conversation_id)
    for file_id in file_ids:
        delete_file_asset(file_id, conversation_id=conversation_id)
    for video_id in video_ids:
        delete_video_asset(video_id, conversation_id=conversation_id)

    return {
        "image_ids": image_ids,
        "file_ids": file_ids,
        "video_ids": video_ids,
    }


def rollback_conversation_branch(
    conversation_id: int,
    anchor_message_id: int,
    *,
    include_anchor: bool,
    deleted_at: str | None = None,
) -> dict:
    anchor_row = _get_anchor_message_row(conversation_id, anchor_message_id)
    if not anchor_row:
        return {
            "anchor_found": False,
            "deleted_message_ids": [],
            "asset_ids": {"image_ids": [], "file_ids": [], "video_ids": []},
            "reverted_state_mutation_count": 0,
            "deleted_model_invocation_count": 0,
        }

    branch_rows = collect_branch_message_rows(
        conversation_id,
        anchor_message_id,
        include_anchor=include_anchor,
    )
    branch_message_ids = [int(row["id"] or 0) for row in branch_rows if int(row["id"] or 0) > 0]
    if branch_message_ids:
        with get_db() as conn:
            soft_delete_messages(
                conn,
                int(conversation_id),
                branch_message_ids,
                deleted_at or datetime.now().astimezone().isoformat(timespec="seconds"),
            )
            mark_messages_deleted_by_edit_replay(conn, int(conversation_id), branch_message_ids)

    asset_ids = purge_message_linked_assets(int(conversation_id), branch_message_ids)
    reverted_mutations = revert_conversation_state_mutations(
        int(conversation_id),
        source_message_ids=branch_message_ids,
    )
    deleted_model_invocation_count = _delete_model_invocations_for_messages(int(conversation_id), branch_message_ids)
    return {
        "anchor_found": True,
        "anchor_position": int(anchor_row["position"] or 0),
        "deleted_message_ids": branch_message_ids,
        "asset_ids": asset_ids,
        "reverted_state_mutation_count": int(reverted_mutations.get("reverted_count") or 0),
        "deleted_model_invocation_count": deleted_model_invocation_count,
    }


def purge_conversation_rag_sources(conversation_id: int, *, include_archived: bool = True) -> dict:
    normalized_conversation_id = int(conversation_id or 0)
    if normalized_conversation_id <= 0:
        return {"deleted_chunk_count": 0, "source_keys": []}

    source_keys = [
        conversation_rag_source_key(RAG_SOURCE_CONVERSATION, normalized_conversation_id),
        conversation_rag_source_key(RAG_SOURCE_TOOL_RESULT, normalized_conversation_id),
    ]
    if include_archived:
        source_keys.append(conversation_archived_rag_source_key(normalized_conversation_id))

    deleted_chunk_count = 0
    deleted_source_keys: list[str] = []
    for source_key in source_keys:
        deleted_chunk_count += delete_rag_source_record(source_key)
        deleted_source_keys.append(source_key)
    return {
        "deleted_chunk_count": deleted_chunk_count,
        "source_keys": deleted_source_keys,
    }
