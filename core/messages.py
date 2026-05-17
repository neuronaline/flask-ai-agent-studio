from __future__ import annotations

import base64
from core import config
import hashlib
import json
import logging
import os
import re
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

from core.prompts import get_prompt

from services.canvas_service import (
    build_canvas_project_manifest,
    CANVAS_CONTENT_MUTATING_TOOL_NAMES,
    extract_canvas_documents,
    get_canvas_document_canvas_mode,
    get_canvas_document_capabilities,
    get_canvas_document_content_mode,
    is_canvas_document_editable,
    scale_canvas_char_limit,
)
from core.config import (
    CANVAS_PROMPT_CODE_LINE_MAX_CHARS as CANVAS_PROMPT_DEFAULT_CODE_LINE_MAX_CHARS,
)
from core.config import (
    CANVAS_PROMPT_DEFAULT_MAX_CHARS,
    CANVAS_PROMPT_DEFAULT_MAX_LINES,
    CANVAS_PROMPT_DEFAULT_MAX_TOKENS,
    CLARIFICATION_DEFAULT_MAX_QUESTIONS,
    CLARIFICATION_QUESTION_LIMIT_MAX,
    CLARIFICATION_QUESTION_LIMIT_MIN,
    DEFAULT_MAX_PARALLEL_TOOLS,
    DEFAULT_SEARCH_TOOL_QUERY_LIMIT,
    MAX_PARALLEL_TOOLS_MAX,
    MAX_PARALLEL_TOOLS_MIN,
    SCRATCHPAD_DEFAULT_SECTION,
    SCRATCHPAD_SECTION_METADATA,
    SCRATCHPAD_SECTION_ORDER,
    SEARCH_TOOL_QUERY_LIMIT_MAX,
    SEARCH_TOOL_QUERY_LIMIT_MIN,
)
from core.config import (
    CANVAS_PROMPT_TEXT_LINE_MAX_CHARS as CANVAS_PROMPT_DEFAULT_TEXT_LINE_MAX_CHARS,
)
from core.db import (
    extract_clarification_response,
    extract_message_attachments,
    extract_pending_clarification,
    parse_message_metadata,
    parse_message_tool_calls,
    read_image_asset_bytes,
)
from utils.token_utils import estimate_text_tokens
from lib.tool_registry import PARALLEL_SAFE_READ_ONLY_TOOL_NAMES, resolve_runtime_tool_names

SUMMARY_LABEL = "Conversation summary (generated from deleted messages):"
MODEL_SUMMARY_LABEL = "Conversation summary:"
CANVAS_PROMPT_MAX_CHARS = CANVAS_PROMPT_DEFAULT_MAX_CHARS
CANVAS_PROMPT_MAX_LINES = CANVAS_PROMPT_DEFAULT_MAX_LINES
CANVAS_PROMPT_MAX_TOKENS = CANVAS_PROMPT_DEFAULT_MAX_TOKENS
CANVAS_PROMPT_CODE_LINE_MAX_CHARS = CANVAS_PROMPT_DEFAULT_CODE_LINE_MAX_CHARS
CANVAS_PROMPT_TEXT_LINE_MAX_CHARS = CANVAS_PROMPT_DEFAULT_TEXT_LINE_MAX_CHARS
_CLARIFICATION_QA_LINE_RE = re.compile(r"^\s*(?:(?:Q|A)\s*:\s*.*|-\s*.+?\s*→\s*.+)$", re.IGNORECASE)


def extract_freeform_clarification_user_content(content: str) -> str:
    lines: list[str] = []
    for raw_line in str(content or "").splitlines():
        if _CLARIFICATION_QA_LINE_RE.match(raw_line.strip()):
            continue
        lines.append(raw_line.rstrip())
    return "\n".join(lines).strip()


def _normalize_pending_clarification_payload(payload: dict | None) -> dict | None:
    if not isinstance(payload, dict):
        return None
    return extract_pending_clarification({"pending_clarification": payload})


def _build_clarification_option_summary(question: dict) -> str:
    options = question.get("options") if isinstance(question.get("options"), list) else []
    labels = [
        str(option.get("label") or "").strip()
        for option in options
        if isinstance(option, dict) and str(option.get("label") or "").strip()
    ]
    if not labels:
        return ""
    return " | ".join(labels[:8])


def _build_pending_clarification_message_content(payload: dict | None) -> str:
    normalized_payload = _normalize_pending_clarification_payload(payload)
    if not isinstance(normalized_payload, dict):
        return ""

    questions = normalized_payload.get("questions") if isinstance(normalized_payload.get("questions"), list) else []
    if not questions:
        return ""

    intro = str(normalized_payload.get("intro") or "").strip()
    lines = [intro or "Before I answer, I need a few details."]
    lines.append("Please answer this question:" if len(questions) == 1 else "Please answer these questions:")

    for index, question in enumerate(questions, start=1):
        label = str(question.get("label") or f"Question {index}").strip() or f"Question {index}"
        question_line = f"{index}. {label}"
        if question.get("required") is False:
            question_line += " (optional)"
        option_summary = _build_clarification_option_summary(question)
        if option_summary:
            question_line += f" Options: {option_summary}."
        lines.append(question_line)

    return "\n".join(lines).strip()


def _build_clarification_response_message_content(
    content: str,
    clarification_response: dict | None,
    *,
    clarification_questions: list[dict] | None = None,
) -> str:
    """Build the user-message content that the model sees for a clarification answer."""
    normalized_content = str(content or "").strip()
    response = clarification_response if isinstance(clarification_response, dict) else {}
    answers = response.get("answers") if isinstance(response.get("answers"), list) else []
    if not answers:
        return normalized_content

    lines = []
    for i, answer in enumerate(answers, start=1):
        answer_text = str(answer if not isinstance(answer, dict) else answer.get("display") or answer.get("value") or "").strip()
        if answer_text:
            lines.append(f"{i}. {answer_text}")

    answer_block = "\n".join(lines).strip()
    if normalized_content and answer_block:
        return f"{normalized_content}\n\n{answer_block}"
    return answer_block or normalized_content


def _format_summary_message_for_model(content: str, metadata: dict | None = None) -> str:
    normalized_content = str(content or "").strip()
    if normalized_content.lower().startswith(SUMMARY_LABEL.lower()):
        normalized_content = normalized_content[len(SUMMARY_LABEL) :].strip()

    summary_prefix = MODEL_SUMMARY_LABEL
    summary_level = int(metadata.get("summary_level") or 0) if isinstance(metadata, dict) else 0
    summary_source = str(metadata.get("summary_source") or "").strip().lower() if isinstance(metadata, dict) else ""
    if summary_source == "summary_history" or summary_level > 1:
        summary_prefix = "Conversation summary of earlier summaries:"

    if normalized_content:
        return f"{summary_prefix}\n\n{normalized_content}"
    return summary_prefix


# Tools whose results may still be inputs for other calls in the same batch;
# they are parallel-safe among themselves but must not be batched with any
# call that depends on their output.
DEPENDENT_TOOL_NAMES = ("search_knowledge_base",)

HISTORICAL_CONTEXT_INJECTION_STRIP_HEADINGS = {
    "## Clarification Response",
    "## Double-Check Protocol",
    "## Tool Memory",
    "## Knowledge Base",
    "## User Profile",
    "## Scratchpad (AI Persistent Memory)",
    "## Persona Memory",
    "## Conversation Memory",
    "## Conversation Memory Priority",
    "## Canvas File Set Summary",
    "## Canvas Workspace Summary",
    "## Canvas Editing Guidance",
    "## Code Document Rules",
    "## Active Canvas Document",
    "## Ignored Canvas Documents",
    "## Pinned Canvas Viewports",
    "## Conversation Summaries",
    "## Tool Execution History",
    "## Active Tools This Turn",
    "## Current Date and Time",
}
CANVAS_RUNTIME_CONTEXT_REFRESH_HEADINGS = {
    "## Canvas File Set Summary",
    "## Active Canvas Document",
    "## Ignored Canvas Documents",
    "## Pinned Canvas Viewports",
}
CANVAS_RUNTIME_CONTEXT_INSERT_BEFORE_HEADINGS = (
    "## Conversation Summaries",
    "## Tool Execution History",
    "## Active Tools This Turn",
)


def _normalize_runtime_scratchpad_sections(
    scratchpad_sections: dict | None = None,
    scratchpad: str = "",
) -> dict[str, str]:
    normalized = {section_id: "" for section_id in SCRATCHPAD_SECTION_ORDER}
    if isinstance(scratchpad_sections, dict):
        for section_id in SCRATCHPAD_SECTION_ORDER:
            normalized[section_id] = str(scratchpad_sections.get(section_id) or "").strip()

    legacy_text = str(scratchpad or "").strip()
    if legacy_text and not normalized[SCRATCHPAD_DEFAULT_SECTION]:
        normalized[SCRATCHPAD_DEFAULT_SECTION] = legacy_text

    return {section_id: str(normalized.get(section_id) or "").strip() for section_id in SCRATCHPAD_SECTION_ORDER}


def _iter_non_empty_scratchpad_sections(scratchpad_sections: dict[str, str]) -> list[tuple[str, str]]:
    return [
        (section_id, str(scratchpad_sections.get(section_id) or "").strip())
        for section_id in SCRATCHPAD_SECTION_ORDER
        if str(scratchpad_sections.get(section_id) or "").strip()
    ]


def _format_conversation_memory_timestamp(value: str) -> str:
    text = str(value or "").strip()
    if not text:
        return "--:--"
    try:
        normalized = text.replace("Z", "+00:00")
        return datetime.fromisoformat(normalized).astimezone().strftime("%H:%M")
    except ValueError:
        return text[11:16] if len(text) >= 16 else "--:--"


def _get_conversation_memory_age_label(value: str) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    try:
        normalized = text.replace("Z", "+00:00")
        entry_dt = datetime.fromisoformat(normalized).astimezone()
        now = datetime.now(entry_dt.tzinfo)
        delta = now - entry_dt
        if delta.days == 0:
            return "today"
        elif delta.days == 1:
            return "yesterday"
        elif delta.days < 7:
            return f"{delta.days} days ago"
        elif delta.days < 30:
            weeks = delta.days // 7
            return f"{weeks} week{'s' if weeks > 1 else ''} ago"
        else:
            months = delta.days // 30
            return f"{months} month{'s' if months > 1 else ''} ago"
    except ValueError:
        return ""


def _normalize_conversation_memory_entries(entries) -> list[dict]:
    normalized_entries: list[dict] = []
    for entry in entries or []:
        if not isinstance(entry, dict):
            continue
        entry_type = str(entry.get("entry_type") or "").strip().lower()
        key = str(entry.get("key") or "").strip()
        value = str(entry.get("value") or "").strip()
        created_at = str(entry.get("created_at") or "").strip()
        try:
            entry_id = int(entry.get("id"))
        except (TypeError, ValueError):
            entry_id = None
        if not entry_type or not key or not value:
            continue
        normalized_entries.append(
            {
                "id": entry_id,
                "entry_type": entry_type,
                "key": key,
                "value": value,
                "created_at": created_at,
            }
        )
    return normalized_entries


def _normalize_persona_memory_entries(entries) -> list[dict]:
    normalized_entries: list[dict] = []
    for entry in entries or []:
        if not isinstance(entry, dict):
            continue
        key = str(entry.get("key") or "").strip()
        value = str(entry.get("value") or "").strip()
        created_at = str(entry.get("created_at") or "").strip()
        try:
            entry_id = int(entry.get("id"))
        except (TypeError, ValueError):
            entry_id = None
        if not key or not value:
            continue
        normalized_entries.append(
            {
                "id": entry_id,
                "key": key,
                "value": value,
                "created_at": created_at,
            }
        )
    return normalized_entries


def build_conversation_memory_section(entries) -> list[str]:
    normalized_entries = _normalize_conversation_memory_entries(entries)
    if not normalized_entries:
        return []

    seen: dict[tuple[str, str], int] = {}
    for index, entry in enumerate(normalized_entries):
        seen[(entry["entry_type"], entry["key"])] = index
    normalized_entries = [
        entry
        for index, entry in enumerate(normalized_entries)
        if seen.get((entry["entry_type"], entry["key"])) == index
    ]

    def age_group_key(entry: dict) -> tuple[int, str]:
        age_label = _get_conversation_memory_age_label(entry.get("created_at") or "")
        if age_label == "today":
            return (0, age_label)
        elif age_label == "yesterday":
            return (1, age_label)
        elif "days ago" in age_label:
            return (2, age_label)
        elif "week" in age_label:
            return (3, age_label)
        else:
            return (4, age_label)

    normalized_entries.sort(key=age_group_key)

    parts = [
        get_prompt("memory.conversation.header", "## Conversation Memory"),
        get_prompt("memory.conversation.intro", "") + "\n",
    ]
    current_group = None
    for entry in normalized_entries:
        entry_id = entry.get("id")
        entry_prefix = f"#{entry_id}" if isinstance(entry_id, int) and entry_id > 0 else "#?"
        age_label = _get_conversation_memory_age_label(entry.get("created_at") or "")
        if age_label != current_group:
            if current_group is not None:
                parts.append("")
            if age_label == "today":
                parts.append("*Recent entries:*")
            elif age_label == "yesterday":
                parts.append("*Yesterday:*")
            elif "days ago" in age_label:
                parts.append(f"*{age_label}:*")
            elif "week" in age_label or "month" in age_label:
                parts.append(f"*Older ({age_label}):*")
            current_group = age_label
        parts.append(
            f"- {entry_prefix} [{entry['entry_type']}] {_format_conversation_memory_timestamp(entry.get('created_at'))} - {entry['key']}: {entry['value']}"
        )
    parts.append("")
    return parts


def build_persona_memory_section(entries) -> list[str]:
    normalized_entries = _normalize_persona_memory_entries(entries)
    if not normalized_entries:
        return []

    seen: dict[str, int] = {}
    for index, entry in enumerate(normalized_entries):
        seen[entry["key"]] = index
    normalized_entries = [entry for index, entry in enumerate(normalized_entries) if seen.get(entry["key"]) == index]

    parts = [
        get_prompt("memory.persona.header", "## Persona Memory"),
        get_prompt("memory.persona.intro", "") + "\n",
    ]
    for entry in normalized_entries:
        entry_id = entry.get("id")
        entry_prefix = f"#{entry_id}" if isinstance(entry_id, int) and entry_id > 0 else "#?"
        parts.append(
            f"- {entry_prefix} {_format_conversation_memory_timestamp(entry.get('created_at'))} - {entry['key']}: {entry['value']}"
        )
    parts.append("")
    return parts


def _build_clarification_policy_payload(
    active_tool_names: list[str], clarification_max_questions: int | None = None
) -> dict | None:
    if "ask_clarifying_question" not in set(active_tool_names or []):
        return None
    return {
        "tool": "ask_clarifying_question",
        "guidance": get_prompt("policies.clarification.guidance", ""),
    }


def format_knowledge_base_auto_context(retrieved_context) -> str:
    normalized = str(retrieved_context or "").strip()
    if isinstance(retrieved_context, str):
        return normalized
    if not isinstance(retrieved_context, dict):
        return normalized

    matches = retrieved_context.get("matches") if isinstance(retrieved_context.get("matches"), list) else []
    if not matches:
        return ""

    query = str(retrieved_context.get("query") or "").strip()
    sections: list[str] = []
    if query:
        sections.append(f"Auto-injected query: {query}")

    for index, match in enumerate(matches, start=1):
        if not isinstance(match, dict):
            continue
        source_name = (
            str(match.get("source_name") or match.get("source") or f"Match {index}").strip() or f"Match {index}"
        )
        similarity = match.get("similarity")
        excerpt = str(match.get("text") or match.get("excerpt") or "").strip()
        is_archived = match.get("archived_conversation") is True

        # Build a human-readable source label so the model cannot mistake
        # retrieved chunks for messages from the current conversation.
        if source_name.startswith("conversation_archive:"):
            remainder = source_name[len("conversation_archive:") :]
            _parts = remainder.split(":", 1)
            title = (_parts[1].strip() if len(_parts) == 2 else _parts[0].strip()) or "Untitled"
            source_label = f"Retrieved from a different archived past conversation: {title}"
        elif source_name.startswith("conversation:"):
            remainder = source_name[len("conversation:") :]
            _parts = remainder.split(":", 1)
            title = (_parts[1].strip() if len(_parts) == 2 else _parts[0].strip()) or "Untitled"
            source_label = f"Retrieved from a different past conversation: {title}"
        else:
            source_label = source_name
        if is_archived:
            source_label += " [Archived]"

        block_parts = [f"Source: {source_label}"]
        if isinstance(similarity, (int, float)):
            block_parts.append(f"Similarity: {float(similarity):.2f}")
        if excerpt:
            block_parts.append(excerpt)
        sections.append("\n".join(block_parts))

    return "\n\n".join(section for section in sections if section).strip()


def _build_knowledge_base_payload(retrieved_context, active_tool_names: list[str]) -> dict | None:
    if not config.RAG_ENABLED:
        return None

    if not retrieved_context:
        return None

    payload = {}
    if retrieved_context:
        formatted_context = format_knowledge_base_auto_context(retrieved_context)
        if formatted_context:
            payload["auto_injected_context"] = formatted_context
    return payload or None


def _normalize_clarification_rounds(
    clarification_response: dict | None,
    all_clarification_rounds: list[dict] | None = None,
) -> list[dict]:
    # Only inject clarification context when the current turn actually carries a
    # clarification response.  Historical rounds (all_clarification_rounds) may
    # supplement the current round with earlier Q/A, but they must never be
    # injected on their own — those answers were already consumed by earlier
    # turns and re-injecting them on every subsequent non-clarification turn
    # misleads the model into treating the current user message as a
    # clarification response.
    current_has_clarification = (
        isinstance(clarification_response, dict)
        and isinstance(clarification_response.get("answers"), list)
        and bool(clarification_response["answers"])
    )
    if not current_has_clarification:
        return []

    normalized_rounds: list[dict] = []
    current_assistant_message_id = str((clarification_response or {}).get("assistant_message_id") or "").strip()
    raw_rounds = all_clarification_rounds if isinstance(all_clarification_rounds, list) else []
    if not raw_rounds:
        raw_rounds = [clarification_response] if isinstance(clarification_response, dict) else []

    # Deduplicate rounds by assistant_message_id + normalized questions + normalized answers.
    # When user resends (cancel+resend or cancel+edit+resend), the same round can appear multiple
    # times in all_clarification_rounds, causing the AI to see duplicate clarification answers
    # and wrongly conclude "questions were already answered twice".
    seen_round_sigs: set[str] = set()
    deduped_rounds: list[dict] = []
    for rp in raw_rounds:
        if not isinstance(rp, dict):
            continue
        answers_sig_parts: list[str] = []
        answers_list = rp.get("answers") if isinstance(rp.get("answers"), list) else []
        for i, a in enumerate(answers_list):
            if isinstance(a, dict):
                answers_sig_parts.append(f"{i}:{a.get('display', '')}")
            else:
                answers_sig_parts.append(f"{i}:{a}")
        questions_sig_parts: list[str] = []
        questions_list = rp.get("questions") if isinstance(rp.get("questions"), list) else []
        for q in questions_list:
            if isinstance(q, dict):
                qtxt = str(q.get("label") or "").strip()[:300]
                if qtxt:
                    questions_sig_parts.append(qtxt)
        assistant_id = str(rp.get("assistant_message_id") or "").strip()
        sig = f"{assistant_id}|#Q#{'|'.join(questions_sig_parts)}|#A#{'|'.join(answers_sig_parts)}"
        if sig not in seen_round_sigs:
            seen_round_sigs.add(sig)
            deduped_rounds.append(rp)
    raw_rounds = deduped_rounds

    # Freshness guard:
    # - If historical rounds include explicit assistant_message_id values,
    #   the current clarification response must match one of them.
    # - When matched, only include rounds up to that matched point so future
    #   stale rounds (if any) cannot leak into the current turn injection.
    has_round_assistant_ids = any(
        str((round_payload or {}).get("assistant_message_id") or "").strip()
        for round_payload in raw_rounds
        if isinstance(round_payload, dict)
    )
    if current_assistant_message_id and has_round_assistant_ids:
        matched_index = -1
        for round_index, round_payload in enumerate(raw_rounds):
            if not isinstance(round_payload, dict):
                continue
            if str(round_payload.get("assistant_message_id") or "").strip() == current_assistant_message_id:
                matched_index = round_index
                break
        if matched_index < 0:
            return []
        raw_rounds = raw_rounds[: matched_index + 1]

    for round_payload in raw_rounds[:10]:
        if not isinstance(round_payload, dict):
            continue

        answers = round_payload.get("answers") if isinstance(round_payload.get("answers"), list) else []
        if not answers:
            continue

        questions = round_payload.get("questions") if isinstance(round_payload.get("questions"), list) else []
        normalized_questions = []
        for question in questions[:CLARIFICATION_QUESTION_LIMIT_MAX]:
            if not isinstance(question, dict):
                continue
            question_text = str(question.get("label") or "").strip()[:300]
            if question_text:
                normalized_questions.append({"text": question_text})

        normalized_rounds.append(
            {
                "assistant_message_id": str(round_payload.get("assistant_message_id") or "").strip() or None,
                "questions": normalized_questions,
                "answers": answers,
            }
        )

    return normalized_rounds


def _build_clarification_response_payload(
    clarification_response: dict | None,
    *,
    all_clarification_rounds: list[dict] | None = None,
) -> dict | None:
    rounds = _normalize_clarification_rounds(clarification_response, all_clarification_rounds)
    if not rounds:
        return None

    rendered_rounds: list[str] = []
    multiple_rounds = len(rounds) > 1
    for round_index, round_payload in enumerate(rounds, start=1):
        if multiple_rounds:
            rendered_rounds.append(f"Round {round_index}")

        questions = round_payload.get("questions") if isinstance(round_payload.get("questions"), list) else []
        answers = round_payload.get("answers") if isinstance(round_payload.get("answers"), list) else []

        for i, question in enumerate(questions):
            if not isinstance(question, dict):
                continue
            question_text = str(question.get("text") or "").strip()
            answer = answers[i] if i < len(answers) else None
            answer_text = str(answer if not isinstance(answer, dict) else answer.get("display") or answer.get("value") or "").strip()
            if question_text and answer_text:
                rendered_rounds.append(f"- {question_text} → {answer_text}")

        if multiple_rounds and round_index < len(rounds):
            rendered_rounds.append("")

    return {
        "guidance": (
            "The following answers were provided by the user in response to your clarification questions. "
            "Proceed directly to the task using these answers. "
            "Do not re-list the original clarification questions in your answer unless the user explicitly asks for them. "
            "Saving them again wastes tool steps and creates duplicate context."
        ),
        "formatted_answers": "\n".join(rendered_rounds).strip(),
    }


def normalize_chat_messages(messages) -> list[dict]:
    normalized = []
    allowed_roles = {"user", "assistant", "system", "tool", "summary"}

    for message in messages or []:
        if not isinstance(message, dict):
            continue
        role = str(message.get("role") or "").strip()
        if role not in allowed_roles:
            continue
        content = message.get("content")
        if content is None:
            content = ""
        if not isinstance(content, str):
            content = str(content)
        normalized.append(
            {
                "id": str(message.get("id") or "").strip() or None,
                "role": role,
                "content": content,
                "metadata": parse_message_metadata(message.get("metadata")),
                "tool_calls": parse_message_tool_calls(message.get("tool_calls")),
                "tool_call_id": str(message.get("tool_call_id") or "").strip() or None,
            }
        )

    return normalized


def _normalize_canvas_document_name(value: str | None) -> str:
    return os.path.basename(str(value or "").strip()).casefold()


def _normalize_canvas_document_stem(value: str | None) -> str:
    normalized_name = _normalize_canvas_document_name(value)
    if not normalized_name:
        return ""
    stem, _separator, _suffix = normalized_name.rpartition(".")
    return stem or normalized_name


def _extract_document_context_body(context_block: str | None) -> str:
    normalized = str(context_block or "").strip()
    if not normalized:
        return ""

    lines = normalized.splitlines()
    if lines and lines[0].startswith("[Uploaded document:"):
        lines = lines[1:]
        while lines and not lines[0].strip():
            lines = lines[1:]
    return "\n".join(lines).strip()


def _build_canvas_document_lookup(canvas_documents) -> dict[str, list[str]]:
    documents = extract_canvas_documents({"canvas_documents": canvas_documents or []})
    lookup: dict[str, list[str]] = {}
    for document in documents:
        normalized_content = str(document.get("content") or "").strip().casefold()
        if not normalized_content:
            continue
        for candidate in (
            _normalize_canvas_document_name(document.get("title")),
            _normalize_canvas_document_name(document.get("path")),
            _normalize_canvas_document_stem(document.get("title")),
            _normalize_canvas_document_stem(document.get("path")),
        ):
            if not candidate:
                continue
            lookup.setdefault(candidate, []).append(normalized_content)
    return lookup


def _clip_canvas_preview_line(
    line: str,
    *,
    format_name: str | None = None,
    code_line_max_chars: int | None = None,
    text_line_max_chars: int | None = None,
) -> tuple[str, bool]:
    normalized_format = str(format_name or "").strip().lower()
    code_limit = max(40, int(code_line_max_chars or CANVAS_PROMPT_CODE_LINE_MAX_CHARS))
    text_limit = max(40, int(text_line_max_chars or CANVAS_PROMPT_TEXT_LINE_MAX_CHARS))
    max_chars = code_limit if normalized_format == "code" else text_limit
    if len(line) <= max_chars:
        return line, False
    return line[: max_chars - 2].rstrip() + "..", True


def _build_full_canvas_preview_lines_if_fit(
    all_lines: list[str],
    *,
    max_lines: int,
    max_chars: int,
    max_tokens: int,
) -> list[str] | None:
    if len(all_lines) > max_lines:
        return None

    numbered_lines = [f"{index}: {line}" for index, line in enumerate(all_lines, start=1)]
    preview_text = "\n".join(numbered_lines)
    if len(preview_text) > max_chars:
        return None
    if max_tokens > 0 and len(preview_text.encode("utf-8")) > max_tokens * 2:
        return None
    return numbered_lines


def _document_attachment_is_represented_in_canvas(
    attachment: dict, canvas_document_lookup: dict[str, list[str]]
) -> bool:
    if not canvas_document_lookup:
        return False

    candidate_names = [
        _normalize_canvas_document_name(attachment.get("file_name")),
        _normalize_canvas_document_stem(attachment.get("file_name")),
    ]
    candidate_names = [name for name in candidate_names if name]
    if not candidate_names:
        return False

    candidate_contents: list[str] = []
    for candidate_name in candidate_names:
        candidate_contents.extend(canvas_document_lookup.get(candidate_name) or [])
    if not candidate_contents:
        return False

    body_excerpt = _extract_document_context_body(attachment.get("file_context_block"))
    if not body_excerpt:
        return True

    normalized_excerpt = body_excerpt[:500].casefold()
    return any(normalized_excerpt in content for content in candidate_contents)


def build_user_message_for_model(
    content: str,
    metadata: dict | None = None,
    *,
    canvas_documents: list[dict] | None = None,
    clarification_questions: list[dict] | None = None,
) -> str:
    content = (content or "").strip()
    metadata = metadata if isinstance(metadata, dict) else {}

    clarification_response = extract_clarification_response(metadata)
    clarification_answers = clarification_response.get("answers") if isinstance(clarification_response, dict) else {}
    if isinstance(clarification_answers, dict) and clarification_answers:
        content = _build_clarification_response_message_content(
            content,
            clarification_response,
            clarification_questions=clarification_questions,
        )

    attachments = extract_message_attachments(metadata)
    canvas_document_lookup = _build_canvas_document_lookup(canvas_documents)
    file_context_blocks = []
    video_context_blocks = []
    vision_attachments = []
    direct_image_notices = []
    for attachment in attachments:
        if attachment.get("kind") == "document":
            context_block = str(attachment.get("file_context_block") or "").strip()
            if _document_attachment_is_represented_in_canvas(attachment, canvas_document_lookup):
                continue
            if attachment.get("excluded_from_context") is True:
                continue
            if context_block and context_block not in file_context_blocks:
                file_context_blocks.append(context_block)
            continue

        if attachment.get("kind") == "video":
            context_block = str(attachment.get("transcript_context_block") or "").strip()
            if context_block and context_block not in video_context_blocks:
                video_context_blocks.append(context_block)
            continue

        image_id = str(attachment.get("image_id") or "").strip()
        image_name = str(attachment.get("image_name") or "").strip()
        analysis_method = str(attachment.get("analysis_method") or "").strip().lower()
        ocr_text = str(attachment.get("ocr_text") or "").strip()
        vision_summary = str(attachment.get("vision_summary") or "").strip()
        assistant_guidance = str(attachment.get("assistant_guidance") or "").strip()
        key_points = attachment.get("key_points") if isinstance(attachment.get("key_points"), list) else []
        if analysis_method == "multimodal":
            direct_label = image_name or (f"image_id={image_id}" if image_id else "uploaded image")
            direct_notice = (
                f"Uploaded image for direct multimodal analysis: {direct_label}. The original image is attached below."
            )
            if direct_notice not in direct_image_notices:
                direct_image_notices.append(direct_notice)
            continue
        has_vision = image_id or image_name or ocr_text or vision_summary or assistant_guidance or key_points
        if has_vision:
            vision_attachments.append(attachment)

    if (
        not file_context_blocks
        and not video_context_blocks
        and not vision_attachments
        and not direct_image_notices
    ):
        return content

    parts = []
    if content:
        parts.append(content)

    parts.extend(file_context_blocks)
    parts.extend(video_context_blocks)
    parts.extend(direct_image_notices)

    for index, attachment in enumerate(vision_attachments, start=1):
        image_id = str(attachment.get("image_id") or "").strip()
        image_name = str(attachment.get("image_name") or "").strip()
        ocr_text = str(attachment.get("ocr_text") or "").strip()
        vision_summary = str(attachment.get("vision_summary") or "").strip()
        assistant_guidance = str(attachment.get("assistant_guidance") or "").strip()
        key_points = attachment.get("key_points") if isinstance(attachment.get("key_points"), list) else []

        heading = "[Image attachment context]"
        if len(vision_attachments) > 1:
            heading = f"{heading} Attachment {index}"
        vision_parts = [heading]
        if image_id:
            reference_label = f"Stored image reference: image_id={image_id}"
            if image_name:
                reference_label += f", file={image_name}"
            vision_parts.append(reference_label)
        elif image_name:
            vision_parts.append(f"Uploaded image: {image_name}")
        if vision_summary:
            vision_parts.append(f"Visual summary: {vision_summary}")
        if key_points:
            vision_parts.append("Key observations:\n- " + "\n- ".join(str(point) for point in key_points))
        if ocr_text:
            vision_parts.append("OCR text:\n" + ocr_text)
        if assistant_guidance:
            vision_parts.append("Answering guidance: " + assistant_guidance)
        parts.append("\n\n".join(vision_parts))

    return "\n\n".join(parts)


def _build_visual_document_api_blocks(
    metadata: dict | None, *, warning_messages: list[str] | None = None
) -> list[dict]:
    attachments = extract_message_attachments(metadata)
    blocks: list[dict] = []
    for attachment in attachments:
        if attachment.get("kind") != "document":
            continue
        if str(attachment.get("submission_mode") or "").strip().lower() != "visual":
            continue
        file_name = str(attachment.get("file_name") or "PDF").strip() or "PDF"
        image_ids = (
            attachment.get("visual_page_image_ids") if isinstance(attachment.get("visual_page_image_ids"), list) else []
        )
        page_numbers = [
            int(page_number)
            for page_number in (attachment.get("visual_page_numbers") or [])
            if isinstance(page_number, int) or str(page_number).isdigit()
        ]
        missing_pages: list[int] = []
        for index, image_id in enumerate(image_ids, start=1):
            mapped_page_number = page_numbers[index - 1] if index - 1 < len(page_numbers) else index
            asset, image_bytes = read_image_asset_bytes(str(image_id or "").strip())
            if not asset or not image_bytes:
                missing_pages.append(mapped_page_number)
                continue
            mime_type = str(asset.get("mime_type") or "image/jpeg").strip() or "image/jpeg"
            image_b64 = base64.b64encode(image_bytes).decode("utf-8")
            blocks.append(
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:{mime_type};base64,{image_b64}"},
                }
            )
        if missing_pages and warning_messages is not None:
            page_list = ", ".join(str(page_number) for page_number in missing_pages[:10])
            if len(missing_pages) > 10:
                page_list += ", ..."
            warning_messages.append(
                f"Warning: One or more visual PDF preview images for {file_name} were unavailable at request time (page(s): {page_list}). Analyze only the attached page images."
            )
    return blocks


def _build_direct_image_api_blocks(metadata: dict | None) -> list[dict]:
    attachments = extract_message_attachments(metadata)
    blocks: list[dict] = []
    for attachment in attachments:
        if attachment.get("kind") != "image":
            continue
        if str(attachment.get("analysis_method") or "").strip().lower() != "multimodal":
            continue
        image_id = str(attachment.get("image_id") or "").strip()
        asset, image_bytes = read_image_asset_bytes(image_id)
        if not asset or not image_bytes:
            continue
        mime_type = str(asset.get("mime_type") or "image/jpeg").strip() or "image/jpeg"
        image_b64 = base64.b64encode(image_bytes).decode("utf-8")
        blocks.append(
            {
                "type": "image_url",
                "image_url": {"url": f"data:{mime_type};base64,{image_b64}"},
            }
        )
    return blocks


def build_user_message_for_api(
    content: str,
    metadata: dict | None = None,
    *,
    canvas_documents: list[dict] | None = None,
    clarification_questions: list[dict] | None = None,
) -> str | list[dict]:
    text_content = build_user_message_for_model(
        content,
        metadata,
        canvas_documents=canvas_documents,
        clarification_questions=clarification_questions,
    )
    visual_warning_messages: list[str] = []
    visual_blocks = _build_direct_image_api_blocks(metadata)
    prompt_text = str(text_content or "").strip() or "Analyze the attached visual inputs carefully."
    if not visual_blocks:
        return prompt_text
    return [
        {"type": "text", "text": prompt_text},
        *visual_blocks,
    ]


def _strip_volatile_sections_from_context_injection(context_injection: str) -> str:
    """Return the stable static subset of a runtime context injection.

    This function preserves the cache-friendly static prefix (tool contracts,
    policies, memory write guidelines) and removes volatile per-turn sections
    (timestamps, active tools, canvas summaries, tool execution history) that
    would introduce cache entropy if persisted across turns.

    The static prefix retained here is the same content emitted first in
    ``build_runtime_system_message`` and ``build_runtime_context_injection``
    via ``_build_runtime_static_parts`` and ``_build_runtime_dynamic_state_parts``.
    When a historical message is rebuilt for a new turn, the caller re-injects
    the current runtime context (which includes fresh volatile sections) so
    the model always sees up-to-date runtime state while the static contract
    content remains cache-stable across requests.
    """
    normalized = str(context_injection or "").strip()
    if not normalized:
        return ""
    has_structured_headings = any(line.startswith("## ") for line in normalized.splitlines())

    retained_sections: list[str] = []
    current_lines: list[str] = []
    current_heading: str | None = None

    def flush_section() -> None:
        nonlocal current_lines, current_heading
        if not current_lines:
            return
        section_text = "\n".join(current_lines).strip()
        if section_text and current_heading not in HISTORICAL_CONTEXT_INJECTION_STRIP_HEADINGS:
            if current_heading is None and has_structured_headings:
                # Drop unstructured preamble chunks when the payload is already
                # sectioned by headings. These preambles are typically legacy
                # dynamic runtime leftovers and add avoidable cache entropy.
                current_lines = []
                current_heading = None
                return
            retained_sections.append(section_text)
        current_lines = []
        current_heading = None

    for line in normalized.splitlines():
        if line.startswith("## "):
            flush_section()
            current_heading = line.strip()
            current_lines = [line]
            continue

        if not current_lines:
            current_lines = [line]
        else:
            current_lines.append(line)

    flush_section()
    return "\n\n".join(section for section in retained_sections if section).strip()


def compute_static_prefix_tokens(context_injection: str) -> int:
    """Measure the static (cacheable) prefix tokens in a runtime context injection.

    This function computes the token count of the stable static subset of a
    runtime context injection by stripping volatile per-turn sections (timestamps,
    active tools, canvas summaries, tool execution history) that would introduce
    cache entropy if persisted across turns.

    The static prefix is the same content that remains cache-stable across requests
    when using ``_strip_volatile_sections_from_context_injection`` and is the
    content that benefits most from prompt caching.

    Args:
        context_injection: The full runtime context injection string to measure.

    Returns:
        The estimated token count of the static prefix portion.
    """
    static_content = _strip_volatile_sections_from_context_injection(context_injection)
    return estimate_text_tokens(static_content)


def _split_context_injection_sections(context_injection: str) -> list[tuple[str | None, str]]:
    normalized = str(context_injection or "").strip()
    if not normalized:
        return []

    sections: list[tuple[str | None, str]] = []
    current_lines: list[str] = []
    current_heading: str | None = None

    def flush_section() -> None:
        nonlocal current_lines, current_heading
        if not current_lines:
            return
        section_text = "\n".join(current_lines).strip()
        if section_text:
            sections.append((current_heading, section_text))
        current_lines = []
        current_heading = None

    for line in normalized.splitlines():
        if line.startswith("## "):
            flush_section()
            current_heading = line.strip()
            current_lines = [line]
            continue

        if not current_lines:
            current_lines = [line]
        else:
            current_lines.append(line)

    flush_section()
    return sections


def prepare_context_injection_for_history(context_injection: str) -> str:
    """Return the stable subset of a runtime context injection worth persisting.

    The latest turn still receives the full runtime injection directly in the live
    request payload. When that user message becomes historical, only the durable
    non-volatile subset should remain attached to the stored message metadata so
    future turns avoid replaying per-turn cache busters such as timestamps,
    active tool lists, transient retrieval snippets, or canvas excerpts.
    """
    return _strip_volatile_sections_from_context_injection(context_injection)


def _filter_clarification_answers_for_questions(
    answers: dict | None,
    questions: list[dict] | None,
) -> dict[str, dict[str, str]]:
    normalized_answers = answers if isinstance(answers, dict) else {}
    normalized_questions = questions if isinstance(questions, list) else []
    filtered_answers: dict[str, dict[str, str]] = {}

    for question in normalized_questions:
        if not isinstance(question, dict):
            continue
        question_id = str(question.get("id") or "").strip()
        if not question_id:
            continue
        answer = normalized_answers.get(question_id)
        if not isinstance(answer, dict):
            continue
        display = str(answer.get("display") or "").strip()
        if not display:
            continue
        filtered_answers[question_id] = {"display": display}

    return filtered_answers


def _collect_answered_clarification_skip_indexes(messages: list[dict]) -> set[int]:
    skip_indexes: set[int] = set()
    answered_assistant_ids: set[str] = set()
    assistant_index_by_id: dict[str, int] = {}

    for index, message in enumerate(messages):
        if not isinstance(message, dict):
            continue
        if str(message.get("role") or "").strip() == "assistant":
            message_id = str(message.get("id") or "").strip()
            if message_id:
                assistant_index_by_id[message_id] = index
        if str(message.get("role") or "").strip() != "user":
            continue
        metadata = message.get("metadata") if isinstance(message.get("metadata"), dict) else {}
        clarification_response = extract_clarification_response(metadata)
        answers = clarification_response.get("answers") if isinstance(clarification_response, dict) else []
        assistant_message_id = str((clarification_response or {}).get("assistant_message_id") or "").strip()
        if isinstance(answers, list) and answers and assistant_message_id:
            answered_assistant_ids.add(assistant_message_id)

    if not answered_assistant_ids:
        return skip_indexes

    for assistant_index, assistant_message in enumerate(messages):
        if not isinstance(assistant_message, dict):
            continue
        assistant_metadata = (
            assistant_message.get("metadata") if isinstance(assistant_message.get("metadata"), dict) else {}
        )
        pending_clarification = extract_pending_clarification(assistant_metadata)
        if not pending_clarification:
            continue
        assistant_message_id = str(assistant_message.get("id") or "").strip()
        if not assistant_message_id:
            continue
        if assistant_message_id not in answered_assistant_ids:
            questions = pending_clarification.get("questions") if isinstance(pending_clarification, dict) else []
            question_ids = {
                str(question.get("id") or "").strip()
                for question in questions
                if isinstance(question, dict) and str(question.get("id") or "").strip()
            }
            if not question_ids or not any(
                question_ids.issubset(answer_keys) for answer_keys in answered_question_key_sets
            ):
                continue

        # Keep the pending-clarification assistant message itself so the model
        # still sees the asked question text, but strip obsolete tool-call/tool
        # scaffolding when it exists.
        tool_indexes: list[int] = []
        probe_index = assistant_index - 1
        while probe_index >= 0 and str(messages[probe_index].get("role") or "").strip() == "tool":
            tool_indexes.append(probe_index)
            probe_index -= 1

        if probe_index < 0 or str(messages[probe_index].get("role") or "").strip() != "assistant":
            continue

        tool_call_message = messages[probe_index]
        tool_calls = parse_message_tool_calls(tool_call_message.get("tool_calls"))
        clarification_call_ids = {
            str(tool_call.get("id") or "").strip()
            for tool_call in tool_calls
            if str(((tool_call.get("function") or {}).get("name") or "")).strip() == "ask_clarifying_question"
        }
        if not clarification_call_ids:
            continue

        matched_tool_indexes = {
            index
            for index in tool_indexes
            if str(messages[index].get("tool_call_id") or "").strip() in clarification_call_ids
        }
        if matched_tool_indexes:
            skip_indexes.add(probe_index)
            skip_indexes.update(matched_tool_indexes)

    # Fallback: some legacy transcripts store answered clarification on a rendered
    # assistant message that does not carry pending_clarification metadata.
    # In that case, still strip the obsolete ask_clarifying_question tool-call
    # scaffolding directly preceding the answered assistant message.
    for answered_assistant_id in answered_assistant_ids:
        assistant_index = assistant_index_by_id.get(answered_assistant_id)
        if assistant_index is None:
            continue

        tool_indexes: list[int] = []
        probe_index = assistant_index - 1
        while probe_index >= 0 and str(messages[probe_index].get("role") or "").strip() == "tool":
            tool_indexes.append(probe_index)
            probe_index -= 1

        if probe_index < 0 or str(messages[probe_index].get("role") or "").strip() != "assistant":
            continue

        tool_call_message = messages[probe_index]
        tool_calls = parse_message_tool_calls(tool_call_message.get("tool_calls"))
        clarification_call_ids = {
            str(tool_call.get("id") or "").strip()
            for tool_call in tool_calls
            if str(((tool_call.get("function") or {}).get("name") or "")).strip() == "ask_clarifying_question"
        }
        if not clarification_call_ids:
            continue

        matched_tool_indexes = {
            index
            for index in tool_indexes
            if str(messages[index].get("tool_call_id") or "").strip() in clarification_call_ids
        }
        if matched_tool_indexes:
            skip_indexes.add(probe_index)
            skip_indexes.update(matched_tool_indexes)
    return skip_indexes


def _sanitize_tool_call_chain(api_messages: list[dict]) -> list[dict]:
    """Ensure every assistant tool_call has a matching tool result and vice versa.

    - Tool messages without tool_call_id are already excluded upstream; this pass
      removes assistant tool_calls whose IDs have no corresponding tool result, which
      would cause an API 400 error on providers that enforce the completeness of the
      tool-call / tool-result chain.
    - Assistant messages that become empty after filtering are dropped entirely (unless
      they still carry text content).
    """
    present_call_ids: set[str] = {
        msg["tool_call_id"] for msg in api_messages if msg.get("role") == "tool" and msg.get("tool_call_id")
    }
    result: list[dict] = []
    for msg in api_messages:
        if msg.get("role") == "assistant" and msg.get("tool_calls"):
            surviving = [tc for tc in msg["tool_calls"] if str(tc.get("id") or "").strip() in present_call_ids]
            if len(surviving) == len(msg["tool_calls"]):
                result.append(msg)
                continue
            if not surviving:
                # Drop tool_calls; keep the message only if it has text content.
                if str(msg.get("content") or "").strip():
                    result.append({k: v for k, v in msg.items() if k != "tool_calls"})
            else:
                result.append({**msg, "tool_calls": surviving})
        else:
            result.append(msg)
    return result


def _inject_reasoning_before_orphan_tools(api_messages: list[dict]) -> list[dict]:
    """Inject assistant messages with reasoning_content before tool messages
    that lack a preceding assistant message with tool_calls.

    DeepSeek's thinking mode requires that when tool calls were made, the
    assistant messages with reasoning_content must be present before the
    tool result messages. When messages are reloaded from the database,
    intermediate assistant messages with empty content and tool_calls may
    not have been persisted. This pass detects orphan tool messages and
    injects synthetic assistant messages with reasoning_content from the
    nearest assistant message that has it.
    """
    if not api_messages:
        return api_messages

    # Collect the reasoning_content from the most recent assistant message
    # that has it, for use as a fallback.
    last_reasoning: str = ""
    for msg in reversed(api_messages):
        if msg.get("role") == "assistant" and msg.get("reasoning_content"):
            last_reasoning = msg["reasoning_content"]
            break

    # Debug: trace tool message injection
    debug_tool_count = sum(1 for m in api_messages if m.get("role") == "tool")
    debug_assistant_count = sum(1 for m in api_messages if m.get("role") == "assistant")
    debug_reasoning_providers = [m.get("reasoning_content", "")[:50] for m in api_messages if m.get("role") == "assistant" and m.get("reasoning_content")]
    logger.debug(
        "_inject_reasoning_before_orphan_tools: tools=%d assistants=%d last_reasoning=%s reasoning_assistants=%s",
        debug_tool_count,
        debug_assistant_count,
        bool(last_reasoning),
        debug_reasoning_providers,
    )

    result: list[dict] = []
    prev_role: str = ""
    for msg in api_messages:
        role = str(msg.get("role") or "").strip()

        # If we see a tool message and the previous message was NOT already
        # an assistant, inject a synthetic assistant message with reasoning_content.
        # This handles both:
        #   - First tool message after a user message
        #   - Consecutive tool messages (after a non-assistant)
        if role == "tool" and prev_role != "assistant" and last_reasoning:
            result.append({
                "role": "assistant",
                "content": None,
                "reasoning_content": last_reasoning,
            })

        result.append(msg)
        prev_role = role

    return result


def build_api_messages(
    messages: list[dict],
    *,
    canvas_documents: list[dict] | None = None,
    embed_visual_documents: bool = False,
) -> list[dict]:
    api_messages = []
    last_reasoning_content: str = ""  # Track for DeepSeek fallback in tool_call messages
    skip_indexes = _collect_answered_clarification_skip_indexes(messages)
    latest_user_message_index = max(
        (index for index, message in enumerate(messages) if message.get("role") == "user"),
        default=-1,
    )
    latest_user_metadata = (
        messages[latest_user_message_index].get("metadata")
        if latest_user_message_index >= 0 and isinstance(messages[latest_user_message_index], dict)
        else {}
    )
    latest_user_metadata = latest_user_metadata if isinstance(latest_user_metadata, dict) else {}
    latest_clarification_response = extract_clarification_response(latest_user_metadata)
    latest_clarification_answers = (
        latest_clarification_response.get("answers") if isinstance(latest_clarification_response, dict) else []
    )
    latest_user_is_clarification_response = bool(
        isinstance(latest_clarification_answers, list) and latest_clarification_answers
    )
    if latest_user_is_clarification_response:
        # Defensive cleanup for legacy/reordered transcripts: when the latest user
        # turn is a clarification response, any ask_clarifying_question tool-call
        # scaffolding should be treated as already consumed and removed from the
        # model input, regardless of exact message-id linkage.
        clarification_call_ids_to_strip: set[str] = set()
        for index, message in enumerate(messages):
            if not isinstance(message, dict) or str(message.get("role") or "").strip() != "assistant":
                continue
            tool_calls = parse_message_tool_calls(message.get("tool_calls"))
            matching_call_ids = {
                str(tool_call.get("id") or "").strip()
                for tool_call in tool_calls
                if str(((tool_call.get("function") or {}).get("name") or "")).strip() == "ask_clarifying_question"
            }
            if matching_call_ids:
                skip_indexes.add(index)
                clarification_call_ids_to_strip.update(call_id for call_id in matching_call_ids if call_id)

        if clarification_call_ids_to_strip:
            for index, message in enumerate(messages):
                if not isinstance(message, dict) or str(message.get("role") or "").strip() != "tool":
                    continue
                tool_call_id = str(message.get("tool_call_id") or "").strip()
                if tool_call_id and tool_call_id in clarification_call_ids_to_strip:
                    skip_indexes.add(index)

    active_tool_names_by_id: dict[str, str] = {}
    active_tool_names_in_order: list[str] = []
    active_tool_name_index = 0
    clarification_questions_by_assistant_id: dict[str, list[dict]] = {}

    for message in messages:
        if not isinstance(message, dict):
            continue
        if str(message.get("role") or "").strip() != "assistant":
            continue
        message_id = str(message.get("id") or "").strip()
        if not message_id:
            continue
        metadata = message.get("metadata") if isinstance(message.get("metadata"), dict) else {}
        pending_clarification = extract_pending_clarification(metadata)
        questions = pending_clarification.get("questions") if isinstance(pending_clarification, dict) else []
        if isinstance(questions, list) and questions:
            clarification_questions_by_assistant_id[message_id] = questions

    # Collect latest user message's context_injection separately to append at the end.
    # This follows the cache-friendly "Prefix Alignment" pattern where dynamic
    # per-turn content (timestamps, active tools) is placed at the END of the
    # message list, keeping the stable prefix cacheable.
    latest_user_context_injection: str = ""
    for index, message in enumerate(messages):
        if index != latest_user_message_index:
            continue
        if not isinstance(message, dict):
            continue
        if str(message.get("role") or "").strip() != "user":
            continue
        metadata = message.get("metadata") if isinstance(message.get("metadata"), dict) else {}
        latest_user_context_injection = str(metadata.get("context_injection") or "").strip()
        break

    for index, message in enumerate(messages):
        if index in skip_indexes:
            continue
        content = message["content"]
        role = message["role"]
        metadata = message.get("metadata") if isinstance(message.get("metadata"), dict) else {}
        tool_calls = None
        context_injection = ""
        if role == "user":
            context_injection = str(metadata.get("context_injection") or "").strip()
            if context_injection and index != latest_user_message_index:
                context_injection = _strip_volatile_sections_from_context_injection(context_injection)
            clarification_response = extract_clarification_response(metadata)
            assistant_message_id = str((clarification_response or {}).get("assistant_message_id") or "").strip()
            clarification_questions = clarification_questions_by_assistant_id.get(assistant_message_id)
            if embed_visual_documents:
                content = build_user_message_for_api(
                    content,
                    metadata,
                    canvas_documents=canvas_documents,
                    clarification_questions=clarification_questions,
                )
            else:
                content = build_user_message_for_model(
                    content,
                    metadata,
                    canvas_documents=canvas_documents,
                    clarification_questions=clarification_questions,
                )
        elif role == "summary":
            role = "assistant"
            content = _format_summary_message_for_model(content, metadata)
        elif role == "assistant":
            tool_calls = parse_message_tool_calls(message.get("tool_calls"))
            pending_clarification = extract_pending_clarification(metadata)
            if pending_clarification and not tool_calls and not str(content or "").strip():
                content = _build_pending_clarification_message_content(pending_clarification)
            if tool_calls and not content.strip():
                content = None
            active_tool_names_by_id = {}
            active_tool_names_in_order = []
            active_tool_name_index = 0
            for tool_call in tool_calls or []:
                tool_call_id = str(tool_call.get("id") or "").strip()
                tool_name = str(((tool_call.get("function") or {}).get("name") or "")).strip()
                if not tool_name:
                    continue
                active_tool_names_in_order.append(tool_name)
                if tool_call_id:
                    active_tool_names_by_id[tool_call_id] = tool_name

        api_message = {
            "role": role,
            "content": content,
        }

        if role == "assistant":
            # DeepSeek requires reasoning_content in assistant messages when there are tool calls
            # to maintain continuity of the reasoning process across multi-round conversations.
            # Check both top-level (from agent runtime) and metadata (from database).
            reasoning_content = message.get("reasoning_content") or message.get("metadata", {}).get("reasoning_content") or ""
            if tool_calls:
                api_message["tool_calls"] = tool_calls
                # DeepSeek API requires the reasoning_content field to be PRESENT (not absent)
                # in assistant messages when tool_calls exist, even if the value is empty.
                # An empty string is acceptable; absent field causes HTTP 400.
                # If reasoning_content is empty but we have a fallback from a previous message,
                # use it to maintain reasoning continuity.
                if not reasoning_content and last_reasoning_content:
                    reasoning_content = last_reasoning_content
                api_message["reasoning_content"] = reasoning_content
            elif reasoning_content:
                api_message["reasoning_content"] = reasoning_content
            # Track last reasoning_content for fallback in subsequent tool_call messages
            if reasoning_content:
                last_reasoning_content = reasoning_content
        elif role == "tool":
            tool_call_id = str(message.get("tool_call_id") or "").strip()
            if not tool_call_id:
                # Every tool message must carry tool_call_id; skip if missing to avoid
                # an API 400 "missing field tool_call_id" rejection.
                continue
            tool_name = active_tool_names_by_id.get(tool_call_id, "")
            if not tool_name and active_tool_name_index < len(active_tool_names_in_order):
                tool_name = active_tool_names_in_order[active_tool_name_index]
                active_tool_name_index += 1
            if not tool_name:
                tool_name = "tool"
            api_message["name"] = tool_name
            api_message["tool_call_id"] = tool_call_id

        api_messages.append(api_message)
        # For non-latest user messages with context_injection, add it as system message
        # immediately after the user message (historical context is already stable).
        if role == "user" and context_injection and index != latest_user_message_index:
            api_messages.append(
                {
                    "role": "system",
                    "content": context_injection,
                }
            )

    # Append latest user message's context_injection at the END of the message list.
    # This follows the "Prefix Alignment" rule: dynamic per-turn content (timestamps,
    # active tools) should be at the END to keep the stable prefix cacheable.
    if latest_user_context_injection:
        api_messages.append(
            {
                "role": "system",
                "content": latest_user_context_injection,
            }
        )

    return _inject_reasoning_before_orphan_tools(_sanitize_tool_call_chain(api_messages))


def _estimate_canvas_document_line_count(document: dict | None) -> int:
    if not isinstance(document, dict):
        return 0
    stored_line_count = int(document.get("line_count") or 0)
    if stored_line_count > 0:
        return stored_line_count
    content = str(document.get("content") or "")
    if not content:
        return 0
    return len(content.split("\n"))


def _estimate_canvas_document_token_count(document: dict | None) -> int:
    if not isinstance(document, dict):
        return 0
    content = str(document.get("content") or "")
    if not content:
        return 0
    return estimate_text_tokens(content)


def _with_canvas_document_prompt_metrics(document: dict) -> dict:
    if not isinstance(document, dict):
        return {}
    return {
        **document,
        "line_count": _estimate_canvas_document_line_count(document),
        "token_count": _estimate_canvas_document_token_count(document),
    }


def _build_canvas_prompt_payload(
    canvas_documents,
    active_document_id: str | None = None,
    canvas_viewports: list[dict] | None = None,
    *,
    max_lines: int = CANVAS_PROMPT_MAX_LINES,
    max_chars: int | None = None,
    max_tokens: int = CANVAS_PROMPT_MAX_TOKENS,
    code_line_max_chars: int | None = None,
    text_line_max_chars: int | None = None,
) -> dict | None:
    documents = extract_canvas_documents({"canvas_documents": canvas_documents or []})
    if not documents:
        return None

    if max_chars is None:
        max_chars = scale_canvas_char_limit(
            max_lines,
            default_lines=CANVAS_PROMPT_MAX_LINES,
            default_chars=CANVAS_PROMPT_MAX_CHARS,
        )

    manifest = build_canvas_project_manifest(documents, active_document_id=active_document_id)
    resolved_active_document_id = str((manifest or {}).get("active_document_id") or "").strip()
    active_document = documents[-1]
    if resolved_active_document_id:
        for document in documents:
            if str(document.get("id") or "") == resolved_active_document_id:
                active_document = document
                break

    manifest_file_list = (
        (manifest or {}).get("file_list") if isinstance((manifest or {}).get("file_list"), list) else []
    )
    ignored_documents = [
        _with_canvas_document_prompt_metrics(entry)
        for entry in manifest_file_list
        if isinstance(entry, dict) and entry.get("ignored") is True
    ]
    ignored_document_ids = {str(entry.get("id") or "").strip() for entry in ignored_documents}
    other_documents = [
        _with_canvas_document_prompt_metrics(entry)
        for entry in manifest_file_list
        if isinstance(entry, dict)
        and str(entry.get("id") or "").strip() != str(active_document.get("id") or "").strip()
        and str(entry.get("id") or "").strip() not in ignored_document_ids
    ]
    active_document = _with_canvas_document_prompt_metrics(active_document)
    filtered_viewports = [
        viewport
        for viewport in (canvas_viewports or [])
        if isinstance(viewport, dict) and str(viewport.get("document_id") or "").strip() not in ignored_document_ids
    ]

    # If the active document has always_expanded set, bypass the line/char budget
    # so the AI always receives the full content regardless of size limits.
    active_document_always_expanded = active_document.get("always_expanded") is True

    content = str(active_document.get("content") or "")
    content_hash = hashlib.sha256(content.encode("utf-8")).hexdigest()[:16]
    all_lines = content.split("\n") if content else []
    active_document_token_count = int(active_document.get("token_count") or 0)
    visible_lines = []
    visible_char_count = 0
    clipped_line_count = 0
    line_format = str(active_document.get("format") or "").strip().lower()
    document_capabilities = get_canvas_document_capabilities(active_document)
    active_document_ignored = active_document.get("ignored") is True

    if active_document_ignored:
        return {
            "mode": (manifest or {}).get("mode") or "document",
            "manifest": manifest,
            "relationship_map": (manifest or {}).get("relationship_map"),
            "document_count": len(documents),
            "active_document": active_document,
            "active_document_ignored": True,
            "ignored_documents": ignored_documents,
            "other_documents": other_documents,
            "visible_lines": [],
            "clipped_line_count": 0,
            "is_truncated": False,
            "visible_line_end": 0,
            "total_lines": int(active_document.get("line_count") or len(all_lines)),
            "active_document_token_count": active_document_token_count,
            "visible_excerpt_token_count": 0,
            "viewports": filtered_viewports,
            "content_hash": content_hash,
        }

    if not document_capabilities["line_addressable"]:
        return {
            "mode": (manifest or {}).get("mode") or "document",
            "manifest": manifest,
            "relationship_map": (manifest or {}).get("relationship_map"),
            "document_count": len(documents),
            "active_document": active_document,
            "active_document_ignored": False,
            "ignored_documents": ignored_documents,
            "other_documents": other_documents,
            "visible_lines": [],
            "clipped_line_count": 0,
            "is_truncated": False,
            "visible_line_end": 0,
            "total_lines": int(active_document.get("line_count") or len(all_lines)),
            "active_document_token_count": active_document_token_count,
            "visible_excerpt_token_count": 0,
            "viewports": filtered_viewports,
            "content_hash": content_hash,
        }

    full_preview_lines = _build_full_canvas_preview_lines_if_fit(
        all_lines,
        max_lines=max_lines if not active_document_always_expanded else len(all_lines) + 1,
        max_chars=max_chars if not active_document_always_expanded else 2_000_000_000,
        max_tokens=max_tokens if not active_document_always_expanded else 0,
    )
    if full_preview_lines is not None:
        visible_lines = full_preview_lines
    else:
        for index, line in enumerate(all_lines, start=1):
            preview_line, line_was_clipped = _clip_canvas_preview_line(
                line,
                format_name=line_format,
                code_line_max_chars=code_line_max_chars if not active_document_always_expanded else None,
                text_line_max_chars=text_line_max_chars if not active_document_always_expanded else None,
            )
            numbered_line = f"{index}: {preview_line}"
            extra_chars = len(numbered_line) + (1 if visible_lines else 0)
            if (
                not active_document_always_expanded
                and visible_lines
                and (len(visible_lines) >= max_lines or visible_char_count + extra_chars > max_chars)
            ):
                break
            if not active_document_always_expanded and not visible_lines and extra_chars > max_chars:
                visible_lines.append(numbered_line[:max_chars])
                visible_char_count = len(visible_lines[0])
                if line_was_clipped:
                    clipped_line_count += 1
                break
            visible_lines.append(numbered_line)
            visible_char_count += extra_chars
            if line_was_clipped:
                clipped_line_count += 1

    # Content-size trim using UTF-8 byte budget as a language-agnostic proxy for
    # token cost. tiktoken (cl100k_base) severely underestimates actual provider
    # token counts for non-ASCII content: Turkish/Arabic/CJK text can tokenise
    # at 3-4x the rate of ASCII on DeepSeek and similar models. Byte counts
    # scale proportionally with this density (Turkish chars are 2 bytes each,
    # CJK chars are 3 bytes), making bytes a much safer budget metric.
    # Budget: max_tokens * 2  (1 token ≈ 2 UTF-8 bytes conservatively; this is
    # accurate for ASCII-heavy docs and safely limits Unicode-heavy ones).
    if max_tokens > 0 and len(visible_lines) > 1:
        byte_budget = max_tokens * 2
        if len("\n".join(visible_lines).encode("utf-8")) > byte_budget:
            lo, hi = 1, len(visible_lines) - 1
            while lo < hi:
                mid = (lo + hi + 1) // 2
                if len("\n".join(visible_lines[:mid]).encode("utf-8")) <= byte_budget:
                    lo = mid
                else:
                    hi = mid - 1
            visible_lines = visible_lines[:lo]

    visible_excerpt_token_count = estimate_text_tokens("\n".join(visible_lines)) if visible_lines else 0

    return {
        "mode": (manifest or {}).get("mode") or "document",
        "manifest": manifest,
        "relationship_map": (manifest or {}).get("relationship_map"),
        "document_count": len(documents),
        "active_document": active_document,
        "active_document_ignored": False,
        "ignored_documents": ignored_documents,
        "other_documents": other_documents,
        "visible_lines": visible_lines,
        "clipped_line_count": clipped_line_count,
        "is_truncated": len(visible_lines) < len(all_lines),
        "visible_line_end": len(visible_lines),
        "total_lines": int(active_document.get("line_count") or len(all_lines)),
        "active_document_token_count": active_document_token_count,
        "visible_excerpt_token_count": visible_excerpt_token_count,
        "viewports": filtered_viewports,
        "content_hash": content_hash,
    }


def _build_canvas_workspace_summary(canvas_payload: dict) -> list[str]:
    manifest = canvas_payload.get("manifest") if isinstance(canvas_payload.get("manifest"), dict) else {}
    active_document = (
        canvas_payload.get("active_document") if isinstance(canvas_payload.get("active_document"), dict) else {}
    )
    if int(canvas_payload.get("document_count") or 0) <= 1 and (canvas_payload.get("mode") or "document") != "project":
        return []

    is_project_mode = str(canvas_payload.get("mode") or "document").strip().lower() == "project"
    has_explicit_paths = (
        any(str(entry.get("path") or "").strip() for entry in (canvas_payload.get("other_documents") or []))
        or str(active_document.get("path") or "").strip() != ""
    )

    def _document_label(entry: dict) -> str:
        if not isinstance(entry, dict):
            return "Canvas"
        if is_project_mode and has_explicit_paths:
            return str(entry.get("path") or entry.get("title") or entry.get("id") or "Canvas").strip() or "Canvas"
        return str(entry.get("title") or entry.get("path") or entry.get("id") or "Canvas").strip() or "Canvas"

    def _document_size_summary(entry: dict) -> str | None:
        if not isinstance(entry, dict):
            return None
        label = _document_label(entry)
        if not label:
            return None
        line_count = int(entry.get("line_count") or 0)
        token_count = int(entry.get("token_count") or 0)
        size_parts = []
        if line_count > 0:
            size_parts.append(f"{line_count} line{'s' if line_count != 1 else ''}")
        if token_count > 0:
            size_parts.append(f"~{token_count} tokens")
        if not size_parts:
            return label
        return f"{label} — {', '.join(size_parts)}"

    lines = ["## Canvas File Set Summary"]
    lines.append(f"- Working mode: {canvas_payload.get('mode') or 'document'}")

    project_name = str(manifest.get("project_name") or "").strip()
    if project_name:
        lines.append(f"- Project label: {project_name}")

    active_label = _document_label(active_document)
    lines.append(f"- {'Active file' if is_project_mode and has_explicit_paths else 'Active document'}: {active_label}")
    active_size_summary = _document_size_summary(active_document)
    if active_size_summary:
        lines.append(f"- Active file size: {active_size_summary}")

    total_lines = int(active_document.get("line_count") or 0)
    total_pages = int(active_document.get("page_count") or 0)
    visible_line_end = int(canvas_payload.get("visible_line_end") or 0)
    if active_document.get("ignored") is True:
        lines.append("- Canvas view status: hidden (active document is ignored for prompt content)")
    elif total_lines and visible_line_end:
        if visible_line_end >= total_lines:
            lines.append(f"- Canvas view status: full document visible ({visible_line_end}/{total_lines} lines)")
            lines.append(
                "- Canvas visibility note: the entire document is already in view; do not expand it just to see more of this same file."
            )
        else:
            lines.append(f"- Canvas view status: truncated excerpt ({visible_line_end}/{total_lines} lines visible)")
    else:
        lines.append("- Canvas view status: unknown")

    if total_pages > 1:
        lines.append(f"- Active document pages: {total_pages}")

    other_documents = (
        canvas_payload.get("other_documents") if isinstance(canvas_payload.get("other_documents"), list) else []
    )
    other_labels = [_document_label(entry) for entry in other_documents if _document_label(entry)]
    if other_labels:
        shown_labels = other_labels[:4]
        lines.append(
            f"- {'Other files' if is_project_mode and has_explicit_paths else 'Other canvas documents'}: {', '.join(shown_labels)}"
        )
        if len(other_labels) > len(shown_labels):
            lines.append(f"- Additional documents omitted: {len(other_labels) - len(shown_labels)}")
    other_size_summaries = [
        _document_size_summary(entry) for entry in other_documents[:4] if _document_size_summary(entry)
    ]
    if other_size_summaries:
        lines.append(
            f"- {'Other file sizes' if is_project_mode and has_explicit_paths else 'Other document sizes'}: "
            + "; ".join(other_size_summaries)
        )

    ignored_documents = (
        canvas_payload.get("ignored_documents") if isinstance(canvas_payload.get("ignored_documents"), list) else []
    )
    ignored_labels = [
        _document_label(entry)
        for entry in ignored_documents
        if isinstance(entry, dict)
        and str(entry.get("id") or "").strip() != str(active_document.get("id") or "").strip()
    ]
    if ignored_labels:
        shown_ignored_labels = ignored_labels[:4]
        lines.append(
            f"- {'Ignored files' if is_project_mode and has_explicit_paths else 'Ignored canvas documents'}: "
            f"{', '.join(shown_ignored_labels)} (metadata only)"
        )
        if len(ignored_labels) > len(shown_ignored_labels):
            lines.append(f"- Additional ignored documents omitted: {len(ignored_labels) - len(shown_ignored_labels)}")
    ignored_size_summaries = [
        _document_size_summary(entry)
        for entry in ignored_documents[:4]
        if isinstance(entry, dict)
        and str(entry.get("id") or "").strip() != str(active_document.get("id") or "").strip()
        if _document_size_summary(entry)
    ]
    if ignored_size_summaries:
        lines.append(
            f"- {'Ignored file sizes' if is_project_mode and has_explicit_paths else 'Ignored document sizes'}: "
            + "; ".join(ignored_size_summaries)
        )

    lines.append("")
    return lines


def _format_canvas_metadata_values(values) -> str | None:
    if not isinstance(values, list):
        return None
    cleaned_values = [str(value).strip() for value in values if str(value).strip()]
    if not cleaned_values:
        return None
    return ", ".join(cleaned_values[:8])


def _build_ignored_canvas_documents_section(canvas_payload: dict) -> list[str]:
    ignored_documents = (
        canvas_payload.get("ignored_documents") if isinstance(canvas_payload.get("ignored_documents"), list) else []
    )
    if not ignored_documents:
        return []

    is_project_mode = str(canvas_payload.get("mode") or "document").strip().lower() == "project"
    prefer_path = any(str(entry.get("path") or "").strip() for entry in ignored_documents)
    lines = [
        "## Ignored Canvas Documents",
        "- These documents still exist in Canvas state, but their content is intentionally omitted from the prompt until re-enabled with ignored=false.",
    ]

    for entry in ignored_documents[:6]:
        if not isinstance(entry, dict):
            continue
        label = (
            str(entry.get("path") or entry.get("title") or entry.get("id") or "Canvas").strip()
            if is_project_mode and prefer_path
            else str(entry.get("title") or entry.get("path") or entry.get("id") or "Canvas").strip()
        ) or "Canvas"
        lines.append(f"- {label}")
        title = str(entry.get("title") or "").strip()
        if title and title != label:
            lines.append(f"  - Title: {title}")
        ignore_reason = str(entry.get("ignored_reason") or "").strip() or "No reason recorded."
        lines.append(f"  - Ignore reason: {ignore_reason}")
        if entry.get("role"):
            lines.append(f"  - Role: {entry['role']}")
        if entry.get("format"):
            lines.append(f"  - Format: {entry['format']}")
        if entry.get("content_mode"):
            lines.append(f"  - Content mode: {entry['content_mode']}")
        if entry.get("canvas_mode"):
            lines.append(f"  - Canvas mode: {entry['canvas_mode']}")
        if entry.get("language"):
            lines.append(f"  - Language: {entry['language']}")
        line_count = int(entry.get("line_count") or 0)
        if line_count > 0:
            lines.append(f"  - Total lines: {line_count}")
        page_count = int(entry.get("page_count") or 0)
        if page_count > 1:
            lines.append(f"  - Total pages: {page_count}")
        for key, label_text in (
            ("imports", "Imports"),
            ("exports", "Exports"),
            ("symbols", "Symbols"),
            ("dependencies", "Dependencies"),
        ):
            metadata_values = _format_canvas_metadata_values(entry.get(key))
            if metadata_values:
                lines.append(f"  - {label_text}: {metadata_values}")

    if len(ignored_documents) > 6:
        lines.append(f"- Additional ignored documents omitted: {len(ignored_documents) - 6}")
    lines.append("")
    return lines


def _canvas_inspection_tool_flags(active_tool_names: list[str]) -> dict[str, bool]:
    active_set = set(active_tool_names or [])
    return {
        "search": "search_canvas_document" in active_set,
        "batch_read": "batch_read_canvas_documents" in active_set,
    }


def _build_canvas_search_guidance_line(active_tool_names: list[str]) -> str | None:
    flags = _canvas_inspection_tool_flags(active_tool_names)
    if not flags["search"]:
        return None
    return "- If you first need to locate text or a symbol in a large canvas, use search_canvas_document first."


def _build_canvas_inspect_first_line(active_tool_names: list[str]) -> str | None:
    flags = _canvas_inspection_tool_flags(active_tool_names)
    if flags["batch_read"]:
        return "- If the target lines are not visible yet, inspect first with batch_read_canvas_documents."
    return None


def _build_canvas_parallel_read_guidance_line(active_tool_names: list[str]) -> str | None:
    ordered_names = [
        tool_name
        for tool_name in ("search_canvas_document", "batch_read_canvas_documents")
        if tool_name in set(active_tool_names or [])
    ]
    if not ordered_names:
        return None
    if len(ordered_names) == 1:
        readable_names = ordered_names[0]
    else:
        readable_names = f"{ordered_names[0]} or {ordered_names[1]}"
    return (
        "- Read-only canvas inspections can run in parallel, so prefer one answer that includes every needed "
        f"{readable_names} call before the edit turn."
    )


def _build_canvas_hidden_excerpt_guidance_line(active_tool_names: list[str]) -> str | None:
    flags = _canvas_inspection_tool_flags(active_tool_names)
    if flags["batch_read"]:
        return (
            "- If the excerpt says [Excerpt: lines 1–N of M], use batch_read_canvas_documents before editing hidden lines."
        )
    return None


def _build_canvas_preview_compaction_note(active_tool_names: list[str], clipped_line_count: int) -> str | None:
    if clipped_line_count <= 0:
        return None
    flags = _canvas_inspection_tool_flags(active_tool_names)
    if flags["batch_read"]:
        tool_guidance = "use batch_read_canvas_documents if exact full line text matters"
    else:
        tool_guidance = "exact full line text may require enabling a canvas read tool"
    return f"- Preview compaction: {int(clipped_line_count)} long line(s) were clipped for token efficiency; {tool_guidance}."


def _build_canvas_truncated_excerpt_guidance(active_tool_names: list[str]) -> str:
    flags = _canvas_inspection_tool_flags(active_tool_names)
    if flags["batch_read"]:
        inspect_guidance = "Call batch_read_canvas_documents for a targeted range before editing."
    else:
        inspect_guidance = "Do not guess line numbers outside the visible excerpt when no canvas read tool is enabled."
    return (
        "- Guidance: This canvas excerpt is truncated. Use visible line numbers for line-level canvas edits. "
        "The Canvas UI may show more content than the model currently has in context; only the excerpt below and any pinned viewports are visible to you right now. "
        "If an explicit document_path is listed in the Canvas File Set Summary or Active Canvas Document block, use that exact value. Otherwise do not invent a path; target the active document or use document_id instead. "
        f"{inspect_guidance} Never guess line numbers outside the visible excerpt."
    )


def _build_canvas_editing_guidance(active_tool_names: list[str], canvas_payload: dict | None = None) -> list[str]:
    active_set = set(active_tool_names or [])
    active_document = (
        (canvas_payload or {}).get("active_document")
        if isinstance((canvas_payload or {}).get("active_document"), dict)
        else {}
    )
    if active_document and not get_canvas_document_capabilities(active_document)["editable"]:
        return [
            "## Canvas Editing Guidance",
            "- The active canvas document is a read-only visual preview backed by images.",
            "- Do not use line-based canvas editing tools on this document.",
            "- Metadata and content edits should wait until a text or hybrid document representation exists.",
            "",
        ]

    if not active_set.intersection(CANVAS_CONTENT_MUTATING_TOOL_NAMES):
        return []

    search_guidance_line = _build_canvas_search_guidance_line(active_tool_names)
    inspect_first_line = _build_canvas_inspect_first_line(active_tool_names)
    parallel_read_guidance_line = _build_canvas_parallel_read_guidance_line(active_tool_names)
    hidden_excerpt_guidance_line = _build_canvas_hidden_excerpt_guidance_line(active_tool_names)

    lines = [
        "## Canvas",
        "- Prefer the smallest valid change. Use batch_canvas_edits for all line-level operations.",
        "- Batch known non-overlapping edits for the same document with batch_canvas_edits.",
        "- Use batch_canvas_edits with a single replace operation for bulk find-replace.",
        "- Verify affected region with a read-only tool after mutating.",
        "- Set ignored=true to hide a document; re-enable with ignored=false when needed.",
        "- Do not use line-based tools on an ignored document until re-enabled with ignored=false.",
        "- When targeting, prefer document_path over document_id when shown in the prompt.",
        "- All code must be inside the `lines` array as properly escaped JSON strings.",
        "- Use batch_canvas_edits with a single replace operation when most of the document should change.",
    ]
    if "create_canvas_document" in active_set:
        lines.insert(2, "- create_canvas_document always needs BOTH title and content.")
        lines.insert(
            3,
            "- When creating a new canvas document, never omit title. If a project path is known, reuse its basename as the title; otherwise provide a short artifact name such as README.md, app.py, or Release Plan.",
        )
    if search_guidance_line:
        lines.insert(9, search_guidance_line)
    if inspect_first_line:
        lines.insert(10, inspect_first_line)
    if parallel_read_guidance_line:
        lines.insert(12, parallel_read_guidance_line)
    if hidden_excerpt_guidance_line:
        lines.append(hidden_excerpt_guidance_line)
    if (canvas_payload or {}).get("mode") == "project":
        lines.append(
            "- In project mode, prefer document_path for targeting, even when you do not know the document_id yet."
        )
    lines.append("")
    return lines


def _build_canvas_runtime_context_sections(
    active_tool_names: list[str],
    canvas_payload: dict | None,
    *,
    previous_canvas_content_hash: str | None = None,
) -> list[str]:
    if not isinstance(canvas_payload, dict):
        return []

    sections: list[str] = []
    workspace_summary_lines = _build_canvas_workspace_summary(canvas_payload)
    if workspace_summary_lines:
        sections.append(_finalize_prompt_text(workspace_summary_lines))

    active_document = (
        canvas_payload.get("active_document") if isinstance(canvas_payload.get("active_document"), dict) else {}
    )
    if not active_document:
        return sections

    active_document_ignored = active_document.get("ignored") is True
    active_lines = ["## Active Canvas Document"]
    active_lines.append(f"- Active document id: {active_document['id']}")
    if not workspace_summary_lines and active_document.get("path"):
        active_lines.append(f"- Path: {active_document['path']}")
    elif not workspace_summary_lines and active_document.get("title"):
        active_lines.append(f"- Title: {active_document['title']}")
    if active_document.get("role"):
        active_lines.append(f"- Role: {active_document['role']}")
    active_lines.append(f"- Format: {active_document['format']}")
    active_lines.append(f"- Content mode: {get_canvas_document_content_mode(active_document)}")
    active_lines.append(f"- Canvas mode: {get_canvas_document_canvas_mode(active_document)}")
    if active_document.get("language"):
        active_lines.append(f"- Language: {active_document['language']}")
    active_lines.append(f"- Total lines: {canvas_payload['total_lines']}")
    active_lines.append(f"- Total tokens (estimated): ~{int(canvas_payload.get('active_document_token_count') or 0)}")
    if int(active_document.get("page_count") or 0) > 1:
        active_lines.append(f"- Total pages: {int(active_document.get('page_count') or 0)}")
    if active_document_ignored:
        active_lines.append("- Ignored in prompt: true")
        if active_document.get("ignored_reason"):
            active_lines.append(f"- Ignore reason: {active_document['ignored_reason']}")
        active_lines.append("- Visible lines in prompt: hidden (ignored document)")
    elif get_canvas_document_capabilities(active_document)["line_addressable"]:
        active_lines.append(
            f"- Visible lines in prompt: 1-{canvas_payload['visible_line_end']}"
            + (" (truncated excerpt)" if canvas_payload["is_truncated"] else "")
        )
        active_lines.append(
            f"- Visible excerpt tokens (estimated): ~{int(canvas_payload.get('visible_excerpt_token_count') or 0)}"
        )
    else:
        active_lines.append(
            "- Visual preview: page images are available in the UI, but line excerpts are not injected for this document type."
        )
    if not active_document_ignored:
        preview_compaction_note = _build_canvas_preview_compaction_note(
            active_tool_names,
            int(canvas_payload.get("clipped_line_count") or 0),
        )
        if preview_compaction_note:
            active_lines.append(preview_compaction_note)
    if active_document_ignored:
        active_lines.append(
            "- Guidance: This canvas document is intentionally ignored for automatic prompt content. Its metadata stays visible so you can re-enable it later with ignored=false when needed."
        )
    elif not get_canvas_document_capabilities(active_document)["line_addressable"]:
        active_lines.append(
            "- Guidance: This active canvas document is an image-backed visual preview. Treat it as read-only and avoid line-based canvas inspection or editing tools."
        )
    elif canvas_payload["is_truncated"]:
        active_lines.append(_build_canvas_truncated_excerpt_guidance(active_tool_names))
    else:
        active_lines.append(
            "- Guidance: The active canvas document is fully visible in the current excerpt. Canvas is already fully visible, so use the visible line numbers directly for line-level edits."
        )
    if canvas_payload["mode"] == "project":
        active_lines.append(
            "- In project mode, prefer the explicit document_path shown in the prompt for targeting, even when you do not know the document_id yet."
        )
    if canvas_payload["visible_lines"] and not active_document_ignored:
        active_lines.append("```text\n" + "\n".join(canvas_payload["visible_lines"]) + "\n```")
    elif get_canvas_document_capabilities(active_document)["line_addressable"] and not active_document_ignored:
        active_lines.append("(The active canvas document is empty.)")
    sections.append(_finalize_prompt_text(active_lines))

    ignored_documents_section = _build_ignored_canvas_documents_section(canvas_payload)
    if ignored_documents_section:
        sections.append(_finalize_prompt_text(ignored_documents_section))

    viewport_payloads = canvas_payload.get("viewports") if isinstance(canvas_payload.get("viewports"), list) else []
    if viewport_payloads:
        viewport_lines = [
            "## Pinned Canvas Viewports",
            "- These pinned ranges are auto-injected from prior viewport selections. Reuse them before asking to scroll or expand the same region again.",
        ]
        for viewport in viewport_payloads[:6]:
            target_label = str(
                viewport.get("document_path") or viewport.get("title") or viewport.get("document_id") or "Canvas"
            ).strip()
            page_label = (
                f" page {int(viewport.get('page_number') or 0)}" if int(viewport.get("page_number") or 0) > 0 else ""
            )
            viewport_lines.append(
                f"- {target_label}{page_label} lines {int(viewport.get('start_line') or 0)}-{int(viewport.get('end_line') or 0)}"
                + (
                    f" (remaining turns: {int(viewport.get('remaining_turns') or 0)})"
                    if int(viewport.get("remaining_turns") or 0) > 0
                    else ""
                )
            )
            visible_lines = viewport.get("visible_lines") if isinstance(viewport.get("visible_lines"), list) else []
            if visible_lines:
                viewport_lines.append("```text\n" + "\n".join(str(line) for line in visible_lines) + "\n```")
        sections.append(_finalize_prompt_text(viewport_lines))

    return [section for section in sections if section]


def refresh_canvas_sections_in_context_injection(
    context_injection: str,
    *,
    active_tool_names: list[str] | None = None,
    canvas_documents=None,
    canvas_active_document_id: str | None = None,
    canvas_viewports: list[dict] | None = None,
    canvas_prompt_max_lines: int | None = None,
    canvas_prompt_max_chars: int | None = None,
    canvas_prompt_max_tokens: int | None = None,
    canvas_prompt_code_line_max_chars: int | None = None,
    canvas_prompt_text_line_max_chars: int | None = None,
) -> str:
    normalized_context = str(context_injection or "").strip()
    if not normalized_context:
        return ""

    canvas_payload = _build_canvas_prompt_payload(
        canvas_documents,
        active_document_id=canvas_active_document_id,
        canvas_viewports=canvas_viewports,
        max_lines=canvas_prompt_max_lines or CANVAS_PROMPT_MAX_LINES,
        max_chars=canvas_prompt_max_chars,
        max_tokens=canvas_prompt_max_tokens if canvas_prompt_max_tokens is not None else CANVAS_PROMPT_MAX_TOKENS,
        code_line_max_chars=canvas_prompt_code_line_max_chars,
        text_line_max_chars=canvas_prompt_text_line_max_chars,
    )
    replacement_sections = _build_canvas_runtime_context_sections(
        _normalize_tool_name_list(active_tool_names),
        canvas_payload,
        previous_canvas_content_hash=None,
    )

    retained_sections: list[tuple[str | None, str]] = []
    insert_index: int | None = None
    removed_any = False
    for heading, section_text in _split_context_injection_sections(normalized_context):
        if heading in CANVAS_RUNTIME_CONTEXT_REFRESH_HEADINGS:
            removed_any = True
            if insert_index is None:
                insert_index = len(retained_sections)
            continue
        retained_sections.append((heading, section_text))

    if insert_index is None:
        for index, (heading, _) in enumerate(retained_sections):
            if heading in CANVAS_RUNTIME_CONTEXT_INSERT_BEFORE_HEADINGS:
                insert_index = index
                break
    if insert_index is None:
        insert_index = len(retained_sections)

    if not replacement_sections and not removed_any:
        return normalized_context

    final_sections = [section_text for _, section_text in retained_sections[:insert_index]]
    final_sections.extend(replacement_sections)
    final_sections.extend(section_text for _, section_text in retained_sections[insert_index:])
    return "\n\n".join(section for section in final_sections if section).strip()


def _normalize_clarification_max_questions(value: int | None) -> int:
    try:
        normalized = int(value) if value is not None else CLARIFICATION_DEFAULT_MAX_QUESTIONS
    except (TypeError, ValueError):
        normalized = CLARIFICATION_DEFAULT_MAX_QUESTIONS
    return max(CLARIFICATION_QUESTION_LIMIT_MIN, min(CLARIFICATION_QUESTION_LIMIT_MAX, normalized))


def _normalize_max_parallel_tools(value: int | None, default_value: int = DEFAULT_MAX_PARALLEL_TOOLS) -> int:
    try:
        normalized = int(value) if value is not None else int(default_value)
    except (TypeError, ValueError):
        normalized = int(default_value)
    return max(MAX_PARALLEL_TOOLS_MIN, min(MAX_PARALLEL_TOOLS_MAX, normalized))


def _normalize_tool_name_list(values) -> list[str]:
    normalized: list[str] = []
    for raw_value in values or []:
        name = str(raw_value or "").strip()
        if name and name not in normalized:
            normalized.append(name)
    return normalized


def _format_tool_name_list(values: list[str]) -> str:
    normalized = _normalize_tool_name_list(values)
    if not normalized:
        return "none"
    return ", ".join(f"`{name}`" for name in normalized)


def _finalize_prompt_text(parts: list[str]) -> str:
    text = "\n".join(str(part or "") for part in parts)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _build_active_tools_context(active_tool_names: list[str]) -> list[str]:
    normalized_tool_names = _normalize_tool_name_list(active_tool_names)
    if not normalized_tool_names:
        return []

    parallel_safe_tool_names = [name for name in normalized_tool_names if name in PARALLEL_SAFE_READ_ONLY_TOOL_NAMES]

    lines = [
        "## Active Tools This Turn",
        "*These are the exact tools callable in this turn after runtime gating. Do not attempt to call tools outside this list.*\n",
        f"- Callable tools: {_format_tool_name_list(normalized_tool_names)}",
    ]
    if parallel_safe_tool_names:
        lines.append(f"- Parallel-safe read tools: {_format_tool_name_list(parallel_safe_tool_names)}")
        lines.append(
            "- Default batching behavior: if several parallel-safe reads are independent, group them into the same assistant turn instead of calling them one by one."
        )
    else:
        lines.append("- Parallel-safe read tools: none")
    lines.append("")
    return lines


def build_tool_call_contract(
    active_tool_names: list[str],
    clarification_max_questions: int | None = None,
    search_tool_query_limit: int | None = None,
    max_parallel_tools: int | None = None,
) -> dict | None:
    normalized_tool_names = _normalize_tool_name_list(active_tool_names)
    if not normalized_tool_names:
        return None
    rules = [
        "Call a tool only when strictly required. If you can answer from the current context without current/external/source-specific verification, do not call a tool.",
        "Use only the tools listed in the Active Tools section. Do not invent unavailable tools.",
        "Before repeating a tool call, check Tool Execution History and Conversation Memory first. Repeat only when there is concrete new evidence to gather; otherwise reuse the existing result and continue.",
    ]

    web_research_tool_names = {
        "search_web",
        "search_news_ddgs",
        "search_news_google",
        "fetch_url",
        "fetch_url_summarized",
        "grep_fetched_content",
    }
    if any(name in normalized_tool_names for name in web_research_tool_names):
        rules.append(
            "Use web-research tools only when the task genuinely needs current facts, external verification, or exact source text. If the answer is already available from the current context, do not search or fetch anything."
        )

    normalized_search_tool_query_limit = _normalize_search_tool_query_limit(search_tool_query_limit)
    if any(name in normalized_tool_names for name in {"search_web", "search_news_ddgs", "search_news_google"}):
        rules.append(
            f"Each search_web/search_news call may include between 1 and {normalized_search_tool_query_limit} queries in its queries array. If you need more queries, split them across multiple calls."
        )

    if "search_web" in normalized_tool_names:
        rules.append(
            "search_web accepts only the queries array. Do not pass max_results, top_k, limit, or any other control arguments; the runtime already caps results and batches queries automatically."
        )

    batching_sections = []
    parallel_safe_in_use = [name for name in normalized_tool_names if name in PARALLEL_SAFE_READ_ONLY_TOOL_NAMES]
    if parallel_safe_in_use:
        parallel_limit = _normalize_max_parallel_tools(max_parallel_tools)
        batching_sections.append(
            "Batch independent tool calls into one assistant turn when their inputs do not depend on each other. "
            "GATHER → REASON → ACT: issue all independent reads in one turn, reason over all results together, then act.\n"
            f"Parallel-safe tools (see Active Tools) run concurrently; cap is {parallel_limit} per turn. "
            "Sequential tools can also be batched in one turn to save an LLM round-trip. "
            "Only split into separate turns when tool B genuinely needs the output of tool A."
        )
        batching_sections.append(
            "**Default strategy:** when you need several independent read-only checks, prefer one high-value batch of parallel-safe tool calls in the same answer instead of drip-feeding single calls across many turns."
        )

    if any(name in normalized_tool_names for name in DEPENDENT_TOOL_NAMES):
        batching_sections.append(
            "**Dependency guard:** search_knowledge_base can be batched with other independent reads, "
            "but not with any tool that depends on their output."
        )

    if "ask_clarifying_question" in normalized_tool_names:
        limit = _normalize_clarification_max_questions(clarification_max_questions)
        rules.append(
            "ask_clarifying_question must be the only tool call in its assistant turn. "
            "Put the actual questions only in the tool arguments, not in the assistant text. "
            "Your reasoning or thinking process is NOT a substitute for the tool call — "
            "you must emit the function call even if you already outlined the questions in your thinking. "
            "Do not say that you prepared questions unless you emitted the tool call in that same turn. "
            "Each question label and option label must use plain UI text only in structured fields: avoid Q:/A: prefixes, markdown bullets, XML/tag wrappers, or <|...|> markers. "
            f"Ask at most {limit} question(s) per call and keep the assistant-visible reply short and brief."
        )

    return {
        "rules": rules,
        "batching_guidance": "\n\n".join(section.strip() for section in batching_sections if section.strip()),
    }


def _round_time_for_cache(now: datetime, window_minutes: int = 5) -> datetime:
    normalized_now = now.astimezone().replace(second=0, microsecond=0)
    if window_minutes <= 1:
        return normalized_now
    total_minutes = normalized_now.hour * 60 + normalized_now.minute
    rounded_total = (total_minutes // window_minutes) * window_minutes
    rounded_hour = rounded_total // 60
    rounded_minute = rounded_total % 60
    return normalized_now.replace(hour=rounded_hour, minute=rounded_minute)


def _build_current_time_context(now: datetime) -> str:
    normalized_now = _round_time_for_cache(now)
    offset = normalized_now.strftime("%z")
    timezone_label = f"UTC{offset[:3]}:{offset[3:]}" if offset else (normalized_now.tzname() or "UTC")
    emphasized_timestamp = normalized_now.strftime("%A, %d %B %Y — %H:%M")
    time_header = get_prompt("system.time_context_header", "## Current Date and Time\n> **AUTHORITATIVE CURRENT TIME:**")
    return (
        f"{time_header} {emphasized_timestamp} ({timezone_label})\n"
        f"- ISO: {normalized_now.isoformat(timespec='seconds')}\n"
        f"- Date: {normalized_now.date().isoformat()}\n- Time: {normalized_now.strftime('%H:%M')}\n"
        f"- Weekday: {normalized_now.strftime('%A')}\n- Timezone: {timezone_label}\n"
    )


def build_current_time_context(now: datetime | None = None) -> str:
    utc_now = datetime.now(timezone.utc)
    return _build_current_time_context((now or utc_now).astimezone())


def _count_summary_messages(messages: list[dict] | None) -> int:
    count = 0
    for message in messages or []:
        if not isinstance(message, dict):
            continue
        role = str(message.get("role") or "").strip()
        if role == "summary":
            count += 1
            continue
        if role == "assistant":
            content = str(message.get("content") or "").strip()
            if content.lower().startswith(SUMMARY_LABEL.lower()):
                count += 1
    return count


def _build_runtime_dynamic_state_parts(
    runtime_tool_names: list[str],
    user_profile_context=None,
    persona_memory=None,
    conversation_memory=None,
    scratchpad: str = "",
    scratchpad_sections=None,
    summary_count: int = 0,
) -> list[str]:
    """Build dynamic state sections: user profile, persona memory, conversation memory, scratchpad."""
    parts: list[str] = []
    persona_memory_tools_enabled = any(
        name in {"save_to_persona_memory", "delete_persona_memory_entry"} for name in runtime_tool_names
    )
    conversation_memory_tools_enabled = any(
        name in {"save_to_conversation_memory", "delete_conversation_memory_entry"} for name in runtime_tool_names
    )

    persona_memory_section = build_persona_memory_section(persona_memory)
    if persona_memory_section:
        parts.extend(persona_memory_section)

    conversation_memory_section = build_conversation_memory_section(conversation_memory)
    if conversation_memory_section:
        parts.extend(conversation_memory_section)

    if summary_count and conversation_memory_tools_enabled:
        parts.append(get_prompt("memory.conversation_priority.header", "## Conversation Memory Priority"))
        parts.append("- " + get_prompt("memory.conversation_priority.guidance", ""))
        parts.append("")

    return parts


def _build_runtime_volatile_parts(
    *,
    active_tool_names: list[str],
    is_first_turn: bool = False,
    clarification_response: dict | None = None,
    all_clarification_rounds: list[dict] | None = None,
    retrieved_context=None,
    tool_trace_context=None,
    now: datetime,
    canvas_documents=None,
    canvas_active_document_id: str | None = None,
    canvas_viewports: list[dict] | None = None,
    canvas_prompt_max_lines: int | None = None,
    canvas_prompt_max_chars: int | None = None,
    canvas_prompt_max_tokens: int | None = None,
    canvas_prompt_code_line_max_chars: int | None = None,
    canvas_prompt_text_line_max_chars: int | None = None,
    canvas_payload: dict | None = None,
    summary_count: int = 0,
    include_time_context: bool = True,
    previous_canvas_content_hash: str | None = None,
    runtime_budget_stats: dict | None = None,
    double_check: bool = False,
    double_check_query: str = "",
    context_node_stats: dict | None = None,
    scratchpad: str = "",
    scratchpad_sections: list[tuple[str, str]] | None = None,
    persona_memory: str = "",
    conversation_memory: str = "",
):
    parts: list[str] = []
    parts.append(get_prompt("scratchpad.header", "## Scratchpad (AI Persistent Memory)"))
    scratchpad_intro = get_prompt("scratchpad.intro", "")
    scratchpad_intro = f"*{scratchpad_intro}*\n"
    parts.append(scratchpad_intro)
    non_empty_scratchpad_sections = [(sid, content) for sid, content in (scratchpad_sections or []) if content.strip()]
    if non_empty_scratchpad_sections:
        for section_id, section_content in non_empty_scratchpad_sections:
            parts.append(f"### {SCRATCHPAD_SECTION_METADATA[section_id]['title']}")
            parts.append(section_content)
            parts.append("")
    if any(name in {"append_scratchpad", "replace_scratchpad"} for name in active_tool_names):
        parts.append(
            f"\n{get_prompt('scratchpad.policy_header', '## Scratchpad Policy')}\n"
            f"{get_prompt('scratchpad.policy', '')}"
        )
    parts.append("")

    persona_memory_section = build_persona_memory_section(persona_memory)
    if persona_memory_section:
        parts.extend(persona_memory_section)

    conversation_memory_section = build_conversation_memory_section(conversation_memory)
    if conversation_memory_section:
        parts.extend(conversation_memory_section)

    conversation_memory_tools_enabled = any(
        name in {"save_to_conversation_memory", "delete_conversation_memory_entry"} for name in active_tool_names
    )
    if summary_count and conversation_memory_tools_enabled:
        parts.append(get_prompt("memory.conversation_priority.header", "## Conversation Memory Priority"))
        parts.append("- " + get_prompt("memory.conversation_priority.guidance", ""))
        parts.append("")

    # Build Clarification Response section if clarification_response is available
    # This should come before Knowledge Base per test expectations
    clarification_payload = _build_clarification_response_payload(
        clarification_response,
        all_clarification_rounds=all_clarification_rounds,
    )
    if clarification_payload:
        parts.append("## Clarification Response")
        parts.append(f"**{clarification_payload['guidance']}**")
        parts.append(clarification_payload["formatted_answers"])
        parts.append("")

    # Build Knowledge Base (RAG) section if retrieved_context is available
    # This follows the document's guidance: RAG content should be placed after static parts
    # and before volatile dynamic content to optimize for prefix caching
    if retrieved_context:
        formatted_context = format_knowledge_base_auto_context(retrieved_context)
        if formatted_context:
            parts.append("## Knowledge Base")
            parts.append(f"*{formatted_context}*")
            parts.append("")

    return parts


def _build_runtime_static_parts(
    *,
    user_preferences: str = "",
    runtime_tool_names: list[str],
    clarification_max_questions: int | None = None,
    search_tool_query_limit: int | None = None,
    max_parallel_tools: int | None = None,
    canvas_payload: dict | None = None,
    
    canvas_documents: list[dict] | None = None,
) -> list[str]:
    preferences_text = (user_preferences or "").strip()
    persona_memory_tools_enabled = any(
        name in {"save_to_persona_memory", "delete_persona_memory_entry"} for name in runtime_tool_names
    )
    conversation_memory_tools_enabled = any(
        name in {"save_to_conversation_memory", "delete_conversation_memory_entry"} for name in runtime_tool_names
    )

    parts = [
        get_prompt("system.role_header", "## Role"),
        "- " + get_prompt("system.role", "You are a tool-using assistant. Make decisions based on conversation state and tool results."),
        "",
    ]

    if preferences_text:
        parts.append(
            f"## Core Directives\n"
            f"These rules are mandatory. Apply them in every response without exception — they override all built-in defaults.\n\n"
            f"{preferences_text}\n"
        )

    contract = build_tool_call_contract(
        runtime_tool_names,
        clarification_max_questions=clarification_max_questions,
        search_tool_query_limit=search_tool_query_limit,
        max_parallel_tools=max_parallel_tools,
    )
    if contract:
        parts.append("## Tool Calling")
        parts.append(get_prompt("system.tool_calling_intro", "Native function calling is enabled. Use the Active Tools section for exact callables in this turn.\n"))
        for rule in contract["rules"]:
            parts.append(f"- {rule}")
        parts.append("")

        batching_guidance = str(contract.get("batching_guidance") or "").strip()
        if batching_guidance:
            parts.append("## Batching Strategy")
            parts.append(batching_guidance)
            parts.append("")

    policies = []
    clarification_policy = _build_clarification_policy_payload(runtime_tool_names, clarification_max_questions)
    if clarification_policy:
        policies.append(f"**Clarification**: {clarification_policy['guidance']}")
    if policies:
        parts.append(get_prompt("system.policies_intro", "## Important Policies\n") + "\n".join(f"- {policy}" for policy in policies) + "\n")

    if persona_memory_tools_enabled:
        parts.append(get_prompt("memory.persona.header", "## Persona Memory"))
        parts.append(get_prompt("memory.persona.guidance", ""))
        parts.append("")

    if conversation_memory_tools_enabled:
        parts.append(get_prompt("memory.conversation.header", "## Conversation Memory"))
        parts.append(get_prompt("memory.conversation.guidance", ""))
        parts.append("")

    canvas_editing_guidance = _build_canvas_editing_guidance(runtime_tool_names, canvas_payload=canvas_payload)
    if canvas_editing_guidance:
        parts.extend(canvas_editing_guidance)

    return parts


def build_runtime_context_injection(
    active_tool_names=None,
    is_first_turn: bool = False,
    clarification_response: dict | None = None,
    all_clarification_rounds: list[dict] | None = None,
    retrieved_context=None,
    tool_trace_context=None,
    
    user_profile_context=None,
    persona_memory=None,
    conversation_memory=None,
    now=None,
    scratchpad="",
    scratchpad_sections=None,
    canvas_documents=None,
    canvas_active_document_id: str | None = None,
    canvas_viewports: list[dict] | None = None,
    canvas_prompt_max_lines: int | None = None,
    canvas_prompt_max_chars: int | None = None,
    canvas_prompt_max_tokens: int | None = None,
    canvas_prompt_code_line_max_chars: int | None = None,
    canvas_prompt_text_line_max_chars: int | None = None,
    
    runtime_tool_names: list[str] | None = None,
    canvas_payload: dict | None = None,
    summary_count: int = 0,
    include_time_context: bool = True,
    previous_canvas_content_hash: str | None = None,
    runtime_budget_stats: dict | None = None,
    include_dynamic_context: bool = False,
    double_check: bool = False,
    double_check_query: str = "",
) -> str:
    normalized_now = (now or datetime.now().astimezone()).astimezone()
    resolved_tool_names = _normalize_tool_name_list(runtime_tool_names)
    if not resolved_tool_names:
        resolved_tool_names = resolve_runtime_tool_names(
            _normalize_tool_name_list(active_tool_names),
            canvas_documents=canvas_documents,
            
        )
    parts: list[str] = []
    if include_dynamic_context:
        parts.extend(
            _build_runtime_dynamic_state_parts(
                runtime_tool_names=resolved_tool_names,
                user_profile_context=user_profile_context,
                persona_memory=persona_memory,
                conversation_memory=conversation_memory,
                scratchpad=scratchpad,
                scratchpad_sections=scratchpad_sections,
                summary_count=summary_count,
            )
        )
    parts.extend(
        _build_runtime_volatile_parts(
            active_tool_names=resolved_tool_names,
            is_first_turn=is_first_turn,
            clarification_response=clarification_response,
            all_clarification_rounds=all_clarification_rounds,
            double_check=double_check,
            double_check_query=double_check_query,
            retrieved_context=retrieved_context,
            tool_trace_context=tool_trace_context,
            
            now=normalized_now,
            canvas_documents=canvas_documents,
            canvas_active_document_id=canvas_active_document_id,
            canvas_viewports=canvas_viewports,
            canvas_prompt_max_lines=canvas_prompt_max_lines,
            canvas_prompt_max_chars=canvas_prompt_max_chars,
            canvas_prompt_max_tokens=canvas_prompt_max_tokens,
            canvas_prompt_code_line_max_chars=canvas_prompt_code_line_max_chars,
            canvas_prompt_text_line_max_chars=canvas_prompt_text_line_max_chars,
            canvas_payload=canvas_payload,
            summary_count=summary_count,
            include_time_context=include_time_context,
            previous_canvas_content_hash=previous_canvas_content_hash,
            runtime_budget_stats=runtime_budget_stats,
        )
    )
    return _finalize_prompt_text(parts)


def build_runtime_system_message(
    user_preferences="",
    active_tool_names=None,
    clarification_response: dict | None = None,
    all_clarification_rounds: list[dict] | None = None,
    retrieved_context=None,
    user_profile_context=None,
    persona_memory=None,
    conversation_memory=None,
    tool_trace_context=None,
    
    now=None,
    scratchpad="",
    scratchpad_sections=None,
    canvas_documents=None,
    canvas_active_document_id: str | None = None,
    canvas_viewports: list[dict] | None = None,
    canvas_prompt_max_lines: int | None = None,
    canvas_prompt_max_chars: int | None = None,
    canvas_prompt_max_tokens: int | None = None,
    canvas_prompt_code_line_max_chars: int | None = None,
    canvas_prompt_text_line_max_chars: int | None = None,
    
    clarification_max_questions: int | None = None,
    search_tool_query_limit: int | None = None,
    max_parallel_tools: int | None = None,
    include_time_context: bool = True,
    include_volatile_context: bool = True,
    include_dynamic_context: bool = True,
    runtime_tool_names: list[str] | None = None,
    canvas_payload: dict | None = None,
    summary_count: int = 0,
    previous_canvas_content_hash: str | None = None,
    runtime_budget_stats: dict | None = None,
    double_check: bool = False,
    double_check_query: str = "",
    context_node_stats: dict | None = None,
):
    now = (now or datetime.now().astimezone()).astimezone()
    configured_tool_names = _normalize_tool_name_list(active_tool_names)
    resolved_runtime_tool_names = _normalize_tool_name_list(runtime_tool_names)
    if not resolved_runtime_tool_names:
        resolved_runtime_tool_names = resolve_runtime_tool_names(
            configured_tool_names,
            canvas_documents=canvas_documents,
            
        )
    runtime_tool_names = resolved_runtime_tool_names
    if canvas_payload is None:
        canvas_payload = _build_canvas_prompt_payload(
            canvas_documents,
            active_document_id=canvas_active_document_id,
            canvas_viewports=canvas_viewports,
            max_lines=canvas_prompt_max_lines or CANVAS_PROMPT_MAX_LINES,
            max_chars=canvas_prompt_max_chars,
            max_tokens=canvas_prompt_max_tokens if canvas_prompt_max_tokens is not None else CANVAS_PROMPT_MAX_TOKENS,
            code_line_max_chars=canvas_prompt_code_line_max_chars,
            text_line_max_chars=canvas_prompt_text_line_max_chars,
        )

    parts = _build_runtime_static_parts(
        user_preferences=user_preferences,
        runtime_tool_names=runtime_tool_names,
        clarification_max_questions=clarification_max_questions,
        search_tool_query_limit=search_tool_query_limit,
        max_parallel_tools=max_parallel_tools,
        canvas_payload=canvas_payload,
        
        canvas_documents=canvas_documents,
    )

    if include_dynamic_context:
        parts.extend(
            _build_runtime_dynamic_state_parts(
                runtime_tool_names=runtime_tool_names,
                user_profile_context=user_profile_context,
                persona_memory=persona_memory,
                conversation_memory=conversation_memory,
                scratchpad=scratchpad,
                scratchpad_sections=scratchpad_sections,
                summary_count=summary_count,
            )
        )

    if include_volatile_context:
        parts.extend(
            _build_runtime_volatile_parts(
                active_tool_names=runtime_tool_names,
                clarification_response=clarification_response,
                all_clarification_rounds=all_clarification_rounds,
                double_check=double_check,
                double_check_query=double_check_query,
                retrieved_context=retrieved_context,
                tool_trace_context=tool_trace_context,
                
                now=now,
                canvas_documents=canvas_documents,
                canvas_active_document_id=canvas_active_document_id,
                canvas_viewports=canvas_viewports,
                canvas_prompt_max_lines=canvas_prompt_max_lines,
                canvas_prompt_max_chars=canvas_prompt_max_chars,
                canvas_prompt_max_tokens=canvas_prompt_max_tokens,
                canvas_prompt_code_line_max_chars=canvas_prompt_code_line_max_chars,
                canvas_prompt_text_line_max_chars=canvas_prompt_text_line_max_chars,
                canvas_payload=canvas_payload,
                summary_count=summary_count,
                include_time_context=include_time_context,
                previous_canvas_content_hash=previous_canvas_content_hash,
                runtime_budget_stats=runtime_budget_stats,
                context_node_stats=context_node_stats,
            )
        )
    elif include_time_context:
        parts.append(_build_current_time_context(now))

    return {
        "role": "system",
        "content": _finalize_prompt_text(parts),
    }


def prepend_runtime_context(
    messages,
    user_preferences="",
    active_tool_names=None,
    clarification_response: dict | None = None,
    all_clarification_rounds: list[dict] | None = None,
    retrieved_context=None,
    user_profile_context=None,
    persona_memory=None,
    conversation_memory=None,
    tool_trace_context=None,
    
    scratchpad="",
    scratchpad_sections=None,
    canvas_documents=None,
    canvas_active_document_id: str | None = None,
    canvas_viewports: list[dict] | None = None,
    canvas_prompt_max_lines: int | None = None,
    canvas_prompt_max_chars: int | None = None,
    canvas_prompt_max_tokens: int | None = None,
    canvas_prompt_code_line_max_chars: int | None = None,
    canvas_prompt_text_line_max_chars: int | None = None,
    
    clarification_max_questions: int | None = None,
    search_tool_query_limit: int | None = None,
    max_parallel_tools: int | None = None,
    runtime_tool_names: list[str] | None = None,
    current_context_injection: str | None = None,
    summary_count: int | None = None,
    runtime_message: dict | None = None,
    now: datetime | None = None,
    previous_canvas_content_hash: str | None = None,
    runtime_budget_stats: dict | None = None,
    double_check: bool = False,
    double_check_query: str = "",
    context_node_stats: dict | None = None,
):
    normalized_now = (now or datetime.now().astimezone()).astimezone()
    resolved_runtime_tool_names = _normalize_tool_name_list(runtime_tool_names)
    if not resolved_runtime_tool_names:
        resolved_runtime_tool_names = resolve_runtime_tool_names(
            _normalize_tool_name_list(active_tool_names),
            canvas_documents=canvas_documents,
            
        )
    injection_content = str(current_context_injection or "").strip()
    canvas_payload = None
    if runtime_message is None or not injection_content:
        canvas_payload = _build_canvas_prompt_payload(
            canvas_documents,
            active_document_id=canvas_active_document_id,
            canvas_viewports=canvas_viewports,
            max_lines=canvas_prompt_max_lines or CANVAS_PROMPT_MAX_LINES,
            max_chars=canvas_prompt_max_chars,
            max_tokens=canvas_prompt_max_tokens if canvas_prompt_max_tokens is not None else CANVAS_PROMPT_MAX_TOKENS,
            code_line_max_chars=canvas_prompt_code_line_max_chars,
            text_line_max_chars=canvas_prompt_text_line_max_chars,
        )

    if isinstance(runtime_message, dict):
        runtime_message = {
            "role": str(runtime_message.get("role") or "system"),
            "content": str(runtime_message.get("content") or ""),
        }
    else:
        runtime_message = build_runtime_system_message(
            user_preferences,
            active_tool_names or [],
            clarification_response=clarification_response,
            all_clarification_rounds=all_clarification_rounds,
            double_check=double_check,
            double_check_query=double_check_query,
            retrieved_context=retrieved_context,
            user_profile_context=user_profile_context,
            persona_memory=persona_memory,
            conversation_memory=conversation_memory,
            tool_trace_context=tool_trace_context,
            
            scratchpad=scratchpad,
            scratchpad_sections=scratchpad_sections,
            canvas_documents=canvas_documents,
            canvas_active_document_id=canvas_active_document_id,
            canvas_viewports=canvas_viewports,
            canvas_prompt_max_lines=canvas_prompt_max_lines,
            canvas_prompt_max_chars=canvas_prompt_max_chars,
            canvas_prompt_max_tokens=canvas_prompt_max_tokens,
            canvas_prompt_code_line_max_chars=canvas_prompt_code_line_max_chars,
            canvas_prompt_text_line_max_chars=canvas_prompt_text_line_max_chars,
            
            clarification_max_questions=clarification_max_questions,
            search_tool_query_limit=search_tool_query_limit,
            max_parallel_tools=max_parallel_tools,
            include_time_context=False,
            include_volatile_context=False,
            include_dynamic_context=False,
            runtime_tool_names=resolved_runtime_tool_names,
            canvas_payload=canvas_payload,
            now=normalized_now,
            context_node_stats=context_node_stats,
        )

    normalized_summary_count = summary_count if summary_count is not None else _count_summary_messages(messages)
    if not injection_content:
        if canvas_payload is None:
            canvas_payload = _build_canvas_prompt_payload(
                canvas_documents,
                active_document_id=canvas_active_document_id,
                canvas_viewports=canvas_viewports,
                max_lines=canvas_prompt_max_lines or CANVAS_PROMPT_MAX_LINES,
                max_chars=canvas_prompt_max_chars,
                max_tokens=canvas_prompt_max_tokens
                if canvas_prompt_max_tokens is not None
                else CANVAS_PROMPT_MAX_TOKENS,
                code_line_max_chars=canvas_prompt_code_line_max_chars,
                text_line_max_chars=canvas_prompt_text_line_max_chars,
            )
        injection_content = build_runtime_context_injection(
            active_tool_names=active_tool_names or [],
            clarification_response=clarification_response,
            all_clarification_rounds=all_clarification_rounds,
            double_check=double_check,
            double_check_query=double_check_query,
            retrieved_context=retrieved_context,
            tool_trace_context=tool_trace_context,
            
            user_profile_context=user_profile_context,
            persona_memory=persona_memory,
            conversation_memory=conversation_memory,
            scratchpad=scratchpad,
            scratchpad_sections=scratchpad_sections,
            canvas_documents=canvas_documents,
            canvas_active_document_id=canvas_active_document_id,
            canvas_viewports=canvas_viewports,
            canvas_prompt_max_lines=canvas_prompt_max_lines,
            canvas_prompt_max_chars=canvas_prompt_max_chars,
            canvas_prompt_max_tokens=canvas_prompt_max_tokens,
            canvas_prompt_code_line_max_chars=canvas_prompt_code_line_max_chars,
            canvas_prompt_text_line_max_chars=canvas_prompt_text_line_max_chars,
            
            runtime_tool_names=resolved_runtime_tool_names,
            canvas_payload=canvas_payload,
            summary_count=normalized_summary_count,
            include_time_context=True,
            now=normalized_now,
            previous_canvas_content_hash=previous_canvas_content_hash,
            runtime_budget_stats=runtime_budget_stats,
            include_dynamic_context=True,
        )

    if not injection_content:
        return [runtime_message, *messages]

    # Keep static runtime instructions and dynamic per-turn context in separate
    # system messages so the leading static prefix remains cache-friendly.
    return [
        runtime_message,
        {
            "role": "system",
            "content": injection_content,
        },
        *messages,
    ]


def _normalize_search_tool_query_limit(value: int | None) -> int:
    try:
        normalized = int(value) if value is not None else DEFAULT_SEARCH_TOOL_QUERY_LIMIT
    except (TypeError, ValueError):
        normalized = DEFAULT_SEARCH_TOOL_QUERY_LIMIT
    return max(SEARCH_TOOL_QUERY_LIMIT_MIN, min(SEARCH_TOOL_QUERY_LIMIT_MAX, normalized))
