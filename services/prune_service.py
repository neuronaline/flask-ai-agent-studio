"""Pruning Service — Token-saving output pruning for conversation histories.

Implements the Pruning System Plan (docs/Pruning System Plan.md):

- **Smart pruning**: Remove old edit_file, bash, and stale read_file outputs.
- **Aggressive pruning**: Remove all non-protected tool outputs except the most
  recent *N* (default: 5).
- **Status (dry-run)**: Preview what *would* be pruned without modifying anything.
- **Failed-attempt collapse**: 3+ failed attempts of the same command collapse
  into a single summary.

Pruned outputs are replaced with compact markers so the AI retains awareness of
what was previously done, while saving significant token budget.

Double-prune protection ensures that once an output is re-run after pruning it
is tagged ``protected: true`` and will not be pruned again in the same session.

Typical invocation::

    from services.prune_service import prune_messages

    result = prune_messages(messages, mode="smart", conversation_id=123)
    # result["messages"]       → pruned message list
    # result["pruned_count"]   → number of outputs pruned
    # result["pruned_tokens"]  → estimated tokens saved
"""
from __future__ import annotations

import json
import logging
import re
from typing import Any

from core.db import get_pruning_enabled, get_pruning_aggressive_keep_count, get_pruning_failed_attempts_threshold
from utils.token_utils import estimate_text_tokens

LOGGER = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Configuration defaults
#
# These defaults are used at import time.  When prune_messages() runs it
# syncs from the persisted settings table via _sync_pruning_config_from_db(),
# so values set through the UI (pruning_enabled, aggressive_keep_count,
# failed_attempts_threshold) are picked up at runtime.
# The /api/conversations/<id>/prune endpoint in routes/chat.py can also
# override aggressive_keep_count from the request payload.
# ---------------------------------------------------------------------------

PRUNING_CONFIG: dict[str, Any] = {
    "enabled": False,
    "aggressive_keep_count": 20,
    "failed_attempts_threshold": 3,
    "protect_reruns": True,
    "read_file_prune_strategy": "same_file_edited",
}


def _sync_pruning_config_from_db() -> None:
    """Sync the module-level PRUNING_CONFIG from the persisted settings table.

    Reads the values stored by the UI (settings page) so the runtime state
    reflects the user's current preferences instead of the import-time defaults.
    Called at the beginning of every ``prune_messages()`` call.
    """
    try:
        PRUNING_CONFIG["enabled"] = get_pruning_enabled()
        PRUNING_CONFIG["aggressive_keep_count"] = get_pruning_aggressive_keep_count()
        PRUNING_CONFIG["failed_attempts_threshold"] = get_pruning_failed_attempts_threshold()
    except Exception:
        LOGGER.exception("prune_service: failed to sync pruning config from DB — using module defaults")

# Tool names whose *outputs* (role == "tool") are eligible for pruning.
# Assistant messages that *call* these tools are never touched.
_PRUNABLE_TOOL_NAMES: frozenset[str] = frozenset({
    "edit_file",
    "write_file",
    "bash",
    "read_file",
    "glob",
    "grep",
    "web_search",
    "web_fetch",
    "list_context_summary",
})

# Tool names whose outputs are never pruned (safety-critical).
_IMMUNE_TOOL_NAMES: frozenset[str] = frozenset({
    "question",
})

# Maximum characters kept in a pruning-marker context snippet.
_MARKER_CONTEXT_MAX_CHARS: int = 80

# How many lines of content to count for the marker.
_LINE_COUNT_PATTERN: re.Pattern[str] = re.compile(r"\n")

# Failure/error indicators in tool output content.
_ERROR_INDICATORS: tuple[str, ...] = (
    '"error"',
    '"ok": false',
    '"ok":false',
    "Error:",
    "Traceback (most recent call last)",
    "failed",
    "exit code 1",
    "exit_code: 1",
    "command not found",
)

# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _safe_json_loads(text: str) -> dict | None:
    """Attempt to parse *text* as JSON, returning ``None`` on failure."""
    try:
        parsed = json.loads(text)
        return parsed if isinstance(parsed, dict) else None
    except (json.JSONDecodeError, TypeError):
        return None


def _build_tool_call_index(messages: list[dict]) -> dict[str, dict]:
    """Index all assistant ``tool_calls`` by their ``id`` for fast lookup.

    Returns ``{tool_call_id: {"name": str, "arguments": dict, "assistant_pos": int}}``.
    """
    index: dict[str, dict] = {}
    for pos, msg in enumerate(messages):
        if msg.get("role") != "assistant":
            continue
        for tc in (msg.get("tool_calls") or []):
            tc_id = str(tc.get("id") or "").strip()
            if not tc_id:
                continue
            func = tc.get("function") or {}
            raw_args = func.get("arguments") or "{}"
            if isinstance(raw_args, str):
                parsed_args = _safe_json_loads(raw_args) or {}
            elif isinstance(raw_args, dict):
                parsed_args = raw_args
            else:
                parsed_args = {}
            index[tc_id] = {
                "name": str(func.get("name") or "").strip(),
                "arguments": parsed_args,
                "assistant_pos": pos,
            }
    return index


def _count_turns_ago(msg_pos: int, messages: list[dict]) -> int:
    """Count how many user messages appear *after* *msg_pos*.

    Each user message represents one "turn" in the conversation.
    """
    count = 0
    for i in range(msg_pos + 1, len(messages)):
        if messages[i].get("role") == "user":
            count += 1
    return count


def _count_content_lines(content: str) -> int:
    """Return the number of lines in *content*."""
    if not content:
        return 0
    return len(_LINE_COUNT_PATTERN.split(content))


def _is_failed_output(content: str) -> bool:
    """Heuristic: does *content* look like a failed/error tool output?"""
    lower = content.lower()
    return any(ind.lower() in lower for ind in _ERROR_INDICATORS)


def _truncate_str(text: str, max_len: int) -> str:
    """Truncate *text* to *max_len* characters, appending ``…`` if trimmed."""
    text = text.strip()
    if len(text) <= max_len:
        return text
    return text[: max_len - 1].rstrip() + "…"


def _extract_read_file_path(arguments: dict) -> str:
    """Extract the file path from read_file / edit_file / write_file arguments."""
    return str(
        arguments.get("file_path")
        or arguments.get("path")
        or ""
    ).strip()


def _extract_brief_context(
    tool_name: str,
    tool_args: dict,
    content: str,
) -> str:
    """Build a short context string for the pruning marker.

    Examples::

        bash: npm test | exit: 0 | 247 lines | 12 turns ago
        edit_file: src/app.py | 12 lines | 5 turns ago
        read_file: requirements.txt | 43 lines | 8 turns ago
    """
    context = ""

    if tool_name in {"bash"}:
        cmd = str(tool_args.get("command") or tool_args.get("cmd") or "").strip()
        if cmd:
            context = _truncate_str(cmd, _MARKER_CONTEXT_MAX_CHARS)

    elif tool_name in {"edit_file", "write_file", "read_file"}:
        path = _extract_read_file_path(tool_args)
        if path:
            context = _truncate_str(path, _MARKER_CONTEXT_MAX_CHARS)

    elif tool_name == "glob":
        pattern = str(tool_args.get("pattern") or "").strip()
        if pattern:
            context = _truncate_str(pattern, _MARKER_CONTEXT_MAX_CHARS)

    elif tool_name == "grep":
        pattern = str(tool_args.get("pattern") or "").strip()
        if pattern:
            context = _truncate_str(pattern, _MARKER_CONTEXT_MAX_CHARS)

    elif tool_name in {"web_search"}:
        query = str(tool_args.get("query") or "").strip()
        if query:
            context = _truncate_str(query, _MARKER_CONTEXT_MAX_CHARS)

    elif tool_name in {"web_fetch"}:
        url = str(tool_args.get("url") or "").strip()
        if url:
            context = _truncate_str(url, _MARKER_CONTEXT_MAX_CHARS)

    return context


def _exit_code_from_content(content: str) -> str | None:
    """Try to extract an exit code string from a bash tool output."""
    # Patterns: ``"exit_code": 0``, ``exit code 0``, ``Exit code: 1``
    match = re.search(r'"?exit[_\s]?code"?\s*[:=]\s*(-?\d+)', content, re.IGNORECASE)
    if match:
        return match.group(1)
    # Patterns: ``"ok": true/false`` in JSON
    parsed = _safe_json_loads(content)
    if parsed is not None:
        if "exit_code" in parsed:
            return str(parsed["exit_code"])
        if parsed.get("ok") is False and "error" in parsed:
            return "error"
        if parsed.get("ok") is True:
            return "0"
    return None


def _build_prune_marker(
    tool_name: str,
    context: str,
    content: str,
    turns_ago: int,
    *,
    exit_code: str | None = None,
    is_error: bool = False,
) -> str:
    """Build a compact pruning marker string.

    Format::

        [PRUNED] tool_name: brief_context | exit: code | N lines | M turns ago
    """
    parts = [f"[PRUNED] {tool_name}"]
    if context:
        parts[0] += f": {context}"

    if exit_code is not None:
        parts.append(f"exit: {exit_code}")
    elif is_error:
        parts.append("status: error")

    line_count = _count_content_lines(content)
    if line_count > 0:
        parts.append(f"{line_count} {'line' if line_count == 1 else 'lines'}")

    parts.append(f"{turns_ago} {'turn' if turns_ago == 1 else 'turns'} ago")

    return " | ".join(parts)


# ---------------------------------------------------------------------------
# File-path suffix computation (stale read_file detection)
# ---------------------------------------------------------------------------


def _build_edit_file_paths_map(
    messages: list[dict],
    tool_call_index: dict[str, dict],
) -> dict[int, set[str]]:
    """Map each message position to the set of files edited *after* that position.

    For each position ``i``, ``result[i]`` contains file paths that were edited
    via ``edit_file`` / ``write_file`` at any assistant position > ``i``.  This
    lets us determine whether a ``read_file`` at position ``i`` is stale.
    """
    # Collect all edit_file/write_file calls and their positions.
    edit_calls: list[tuple[int, str]] = []  # (assistant_pos, file_path)
    for pos, msg in enumerate(messages):
        if msg.get("role") != "assistant":
            continue
        for tc in (msg.get("tool_calls") or []):
            tc_id = str(tc.get("id") or "").strip()
            info = tool_call_index.get(tc_id)
            if info and info["name"] in {"edit_file", "write_file"}:
                fp = _extract_read_file_path(info["arguments"])
                if fp:
                    edit_calls.append((pos, fp))

    # Build a suffix set: for each position, which files are edited *after* it.
    # Iterate backwards: record edits at each position AFTER assigning result_map,
    # so result_map[pos] only includes files edited at positions > pos (strictly after).
    # O(n + m) via position→files dict pre-built from edit_calls.
    files_at_pos: dict[int, set[str]] = {}
    for edit_pos, edit_fp in edit_calls:
        files_at_pos.setdefault(edit_pos, set()).add(edit_fp)
    suffix_edited: set[str] = set()
    result_map: dict[int, set[str]] = {}
    for pos in range(len(messages) - 1, -1, -1):
        result_map[pos] = set(suffix_edited)
        suffix_edited.update(files_at_pos.get(pos, set()))
    return result_map


# ---------------------------------------------------------------------------
# Failed-attempt detection
# ---------------------------------------------------------------------------


def _detect_failed_runs(
    messages: list[dict],
    tool_call_index: dict[str, dict],
) -> dict[str, list[int]]:
    """Detect repeated failed attempts of the same command.

    Returns ``{command_signature: [message_positions]}`` for groups with
    ``>= failed_attempts_threshold`` failures.
    """
    threshold = PRUNING_CONFIG["failed_attempts_threshold"]

    # Group failed tool outputs by a "command signature".
    failed_by_signature: dict[str, list[tuple[int, dict]]] = {}

    for pos, msg in enumerate(messages):
        if msg.get("role") != "tool":
            continue
        if msg.get("pruned") is True:
            continue
        content = str(msg.get("content") or "")
        if not _is_failed_output(content):
            continue

        tc_id = str(msg.get("tool_call_id") or "").strip()
        info = tool_call_index.get(tc_id)
        if not info:
            continue

        tool_name = info["name"]
        args = info["arguments"]

        # Build a signature from tool name + key arguments.
        if tool_name == "bash":
            sig_key = str(args.get("command") or args.get("cmd") or "").strip()
        elif tool_name in {"edit_file", "write_file", "read_file"}:
            sig_key = _extract_read_file_path(args)
        else:
            sig_key = json.dumps(args, sort_keys=True, ensure_ascii=False)[:200]

        sig = f"{tool_name}::{sig_key}"
        failed_by_signature.setdefault(sig, []).append((pos, info))

    # Filter to only signatures with >= threshold failures.
    result: dict[str, list[int]] = {}
    for sig, entries in failed_by_signature.items():
        if len(entries) >= threshold:
            result[sig] = [pos for pos, _info in entries]
    return result


# ---------------------------------------------------------------------------
# Message classification
# ---------------------------------------------------------------------------


def _is_prunable_tool_message(
    msg: dict,
    tc_info: dict | None,
) -> bool:
    """Return ``True`` if *msg* is a tool output eligible for pruning.

    Respects ``pruned`` and ``protected`` flags already present on the message.
    """
    if msg.get("role") != "tool":
        return False
    if msg.get("pruned") is True:
        return False
    if msg.get("protected") is True:
        return False
    if not tc_info:
        return False

    tool_name = tc_info.get("name") or ""
    if tool_name in _IMMUNE_TOOL_NAMES:
        return False
    if tool_name not in _PRUNABLE_TOOL_NAMES:
        return False

    return True


# ---------------------------------------------------------------------------
# Smart pruning strategy
# ---------------------------------------------------------------------------


def _smart_prune(
    messages: list[dict],
    tool_call_index: dict[str, dict],
) -> tuple[list[dict], list[dict]]:
    """Smart pruning: remove old edit_file, bash, and stale read_file outputs.

    Returns ``(pruned_messages, pruned_entries)`` where *pruned_entries* is a
    list of dicts describing each pruned item (for AI awareness).
    """
    edit_paths_after = _build_edit_file_paths_map(messages, tool_call_index)
    failed_runs = _detect_failed_runs(messages, tool_call_index)

    # Build positions to collapse for failed attempt groups.
    failed_positions_to_collapse: set[int] = set()
    for _sig, positions in failed_runs.items():
        sorted_pos = sorted(positions)
        # Keep the most recent failure as a summary; collapse the rest.
        failed_positions_to_collapse.update(sorted_pos[:-1])

    pruned_messages = list(messages)
    pruned_entries: list[dict] = []

    # Track the most recent edit_file output per file (by message position).
    # We keep the most recent one and prune older ones.
    latest_edit_per_file: dict[str, int] = {}  # file_path → message position
    for pos, msg in enumerate(messages):
        if msg.get("role") != "tool":
            continue
        tc_id = str(msg.get("tool_call_id") or "").strip()
        info = tool_call_index.get(tc_id)
        if not info or info["name"] not in {"edit_file", "write_file"}:
            continue
        fp = _extract_read_file_path(info["arguments"])
        if fp:
            latest_edit_per_file[fp] = pos

    # Decide what to prune at each position.
    for pos, msg in enumerate(messages):
        tc_id = str(msg.get("tool_call_id") or "").strip()
        info = tool_call_index.get(tc_id)
        if not _is_prunable_tool_message(msg, info):
            continue

        tool_name = info["name"]
        content = str(msg.get("content") or "")
        original_tokens = estimate_text_tokens(content)
        turns_ago = _count_turns_ago(pos, messages)
        args = info["arguments"]

        should_prune = False

        if tool_name in {"edit_file", "write_file"}:
            # Prune older edit_file outputs — keep only the most recent per file.
            fp = _extract_read_file_path(args)
            if fp and latest_edit_per_file.get(fp) != pos:
                should_prune = True

        elif tool_name == "bash":
            # Prune bash outputs older than 3 turns.
            if turns_ago > 3:
                should_prune = True

        elif tool_name == "read_file":
            # Prune read_file only when the same file was edited since the read.
            fp = _extract_read_file_path(args)
            if fp:
                files_after = edit_paths_after.get(pos, set())
                if fp in files_after:
                    should_prune = True

        elif tool_name in {
            "glob", "grep", "web_search", "web_fetch", "list_context_summary",
        }:
            # Prune these when older than 5 turns.
            if turns_ago > 5:
                should_prune = True

        # Handle failed attempt collapse.
        if pos in failed_positions_to_collapse:
            should_prune = True

        if should_prune:
            context = _extract_brief_context(tool_name, args, content)
            exit_code = _exit_code_from_content(content) if tool_name == "bash" else None
            is_err = _is_failed_output(content)

            marker = _build_prune_marker(
                tool_name,
                context,
                content,
                turns_ago,
                exit_code=exit_code,
                is_error=is_err,
            )

            pruned_entries.append({
                "tool_name": tool_name,
                "position": pos,
                "turns_ago": turns_ago,
                "original_tokens": original_tokens,
                "marker": marker,
                "file_path": _extract_read_file_path(args) if args else None,
            })

            pruned_messages[pos] = {
                **msg,
                "content": marker,
                "pruned": True,
                "original_tokens": original_tokens,
            }

    return pruned_messages, pruned_entries


# ---------------------------------------------------------------------------
# Aggressive pruning strategy
# ---------------------------------------------------------------------------


def _aggressive_prune(
    messages: list[dict],
    tool_call_index: dict[str, dict],
    keep_count: int = 5,
) -> tuple[list[dict], list[dict]]:
    """Aggressive pruning: keep only the last *keep_count* tool outputs.

    Respects ``protected: true`` markers.  Returns
    ``(pruned_messages, pruned_entries)``.
    """
    # Collect all prunable tool message positions in order.
    tool_positions: list[int] = []
    for pos, msg in enumerate(messages):
        tc_id = str(msg.get("tool_call_id") or "").strip()
        info = tool_call_index.get(tc_id)
        if _is_prunable_tool_message(msg, info):
            tool_positions.append(pos)

    # The last keep_count tool outputs are safe.
    protected_positions: set[int] = set(tool_positions[-keep_count:])

    pruned_messages = list(messages)
    pruned_entries: list[dict] = []

    for pos in tool_positions:
        if pos in protected_positions:
            continue

        msg = messages[pos]
        tc_id = str(msg.get("tool_call_id") or "").strip()
        info = tool_call_index.get(tc_id)
        if not info:
            continue

        tool_name = info["name"]
        content = str(msg.get("content") or "")
        original_tokens = estimate_text_tokens(content)
        turns_ago = _count_turns_ago(pos, messages)
        args = info["arguments"]

        context = _extract_brief_context(tool_name, args, content)
        exit_code = _exit_code_from_content(content) if tool_name == "bash" else None
        is_err = _is_failed_output(content)

        marker = _build_prune_marker(
            tool_name,
            context,
            content,
            turns_ago,
            exit_code=exit_code,
            is_error=is_err,
        )

        pruned_entries.append({
            "tool_name": tool_name,
            "position": pos,
            "turns_ago": turns_ago,
            "original_tokens": original_tokens,
            "marker": marker,
            "file_path": _extract_read_file_path(args) if args else None,
        })

        pruned_messages[pos] = {
            **msg,
            "content": marker,
            "pruned": True,
            "original_tokens": original_tokens,
        }

    return pruned_messages, pruned_entries


# ---------------------------------------------------------------------------
# Status (dry-run) report
# ---------------------------------------------------------------------------


def _status_report(
    messages: list[dict],
    tool_call_index: dict[str, dict],
    aggressive_keep_count: int = 5,
) -> list[dict]:
    """Dry-run: report what *would* be pruned without modifying messages.

    Returns a list of dicts describing each candidate for pruning.
    """
    candidates: list[dict] = []
    edit_paths_after = _build_edit_file_paths_map(messages, tool_call_index)
    failed_runs = _detect_failed_runs(messages, tool_call_index)

    failed_positions_to_collapse: set[int] = set()
    for _sig, positions in failed_runs.items():
        sorted_pos = sorted(positions)
        failed_positions_to_collapse.update(sorted_pos[:-1])

    # Track latest edit per file for smart mode simulation.
    latest_edit_per_file: dict[str, int] = {}
    for pos, msg in enumerate(messages):
        if msg.get("role") != "tool":
            continue
        tc_id = str(msg.get("tool_call_id") or "").strip()
        info = tool_call_index.get(tc_id)
        if not info or info["name"] not in {"edit_file", "write_file"}:
            continue
        fp = _extract_read_file_path(info["arguments"])
        if fp:
            latest_edit_per_file[fp] = pos

    # Collect all tool positions for aggressive mode simulation.
    all_tool_positions: list[int] = []
    for pos, msg in enumerate(messages):
        tc_id = str(msg.get("tool_call_id") or "").strip()
        info = tool_call_index.get(tc_id)
        if _is_prunable_tool_message(msg, info):
            all_tool_positions.append(pos)

    aggressive_protected: set[int] = set(all_tool_positions[-aggressive_keep_count:])

    for pos, msg in enumerate(messages):
        tc_id = str(msg.get("tool_call_id") or "").strip()
        info = tool_call_index.get(tc_id)
        if not _is_prunable_tool_message(msg, info):
            continue

        tool_name = info["name"]
        content = str(msg.get("content") or "")
        original_tokens = estimate_text_tokens(content)
        turns_ago = _count_turns_ago(pos, messages)
        args = info["arguments"]

        # --- Smart mode reasoning ---
        smart_would_prune = False
        smart_reason = ""

        if tool_name in {"edit_file", "write_file"}:
            fp = _extract_read_file_path(args)
            if fp and latest_edit_per_file.get(fp) != pos:
                smart_would_prune = True
                smart_reason = f"older edit_file output for {fp}"

        elif tool_name == "bash":
            if turns_ago > 3:
                smart_would_prune = True
                smart_reason = f"bash output {turns_ago} turns old (>3)"

        elif tool_name == "read_file":
            fp = _extract_read_file_path(args)
            if fp and fp in edit_paths_after.get(pos, set()):
                smart_would_prune = True
                smart_reason = f"read_file stale: {fp} was edited after read"

        elif tool_name in {
            "glob", "grep", "web_search", "web_fetch", "list_context_summary",
        }:
            if turns_ago > 5:
                smart_would_prune = True
                smart_reason = f"{tool_name} output {turns_ago} turns old (>5)"

        if pos in failed_positions_to_collapse:
            smart_would_prune = True
            smart_reason = smart_reason or "failed attempt (part of collapse group)"

        # --- Aggressive mode reasoning ---
        aggressive_would_prune = pos not in aggressive_protected

        candidates.append({
            "position": pos,
            "tool_name": tool_name,
            "turns_ago": turns_ago,
            "original_tokens": original_tokens,
            "smart_would_prune": smart_would_prune,
            "smart_reason": smart_reason,
            "aggressive_would_prune": aggressive_would_prune,
            "file_path": _extract_read_file_path(args) if args else None,
        })

    return candidates


# ---------------------------------------------------------------------------
# System-awareness message builder
# ---------------------------------------------------------------------------


def _build_awareness_message(pruned_entries: list[dict]) -> str | None:
    """Build a system message snippet informing the AI about pruning.

    Returns ``None`` if nothing was pruned.  The returned string is meant to be
    included as a system-level note in the next LLM call.
    """
    if not pruned_entries:
        return None

    lines = ["[SYSTEM] Pruning occurred. The following tool outputs were removed:"]
    for entry in pruned_entries:
        tool_name = entry.get("tool_name") or "unknown"
        turns_ago = entry.get("turns_ago", 0)
        file_path = entry.get("file_path")
        fp_note = f" ({file_path})" if file_path else ""
        lines.append(f"- {tool_name}{fp_note} (turn {turns_ago})")

    lines.append("")
    lines.append("If you need any of this information, re-run the corresponding tool.")
    lines.append("Protected outputs (re-runs) are marked and will not be pruned again.")

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Internal helpers (continued)
# ---------------------------------------------------------------------------


def _count_protected(messages: list[dict]) -> int:
    """Count tool messages that are marked as ``protected: true``."""
    return sum(
        1 for msg in messages
        if msg.get("role") == "tool" and msg.get("protected") is True
    )


def _result(messages: list[dict]) -> dict:
    """Build a no-op result dict (nothing pruned)."""
    return {
        "messages": list(messages),
        "pruned_count": 0,
        "pruned_list": [],
        "pruned_tokens": 0,
        "protected_count": 0,
        "awareness_message": None,
        "mode": "none",
    }


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def prune_messages(
    messages: list[dict],
    mode: str = "smart",
    aggressive_keep_count: int | None = None,
    conversation_id: int | None = None,
) -> dict:
    """Prune tool outputs from a conversation message list.

    Parameters
    ----------
    messages:
        The full conversation message list (``[{"role": ..., "content": ...}]``).
        This list is **not** mutated — a new list is returned.
    mode:
        One of ``"smart"``, ``"aggressive"``, or ``"status"`` (dry-run).
    aggressive_keep_count:
        Override for ``PRUNING_CONFIG["aggressive_keep_count"]``.
        Only used when *mode* is ``"aggressive"``.
    conversation_id:
        Optional conversation id for logging context.

    Returns
    -------
    dict
        ``messages``        — The (possibly pruned) message list.
        ``pruned_count``    — Number of tool outputs that were pruned.
        ``pruned_list``     — Descriptive dicts for each pruned item (for AI awareness).
        ``pruned_tokens``   — Estimated total tokens saved.
        ``protected_count`` — Number of outputs protected from pruning.
        ``awareness_message`` — Optional system message snippet for the next LLM call.
    """
    if not messages:
        return _result(messages)

    # Sync runtime config from the persisted settings table so user
    # preferences (UI toggle, thresholds) take effect immediately.
    # This must happen before the enabled check below.
    _sync_pruning_config_from_db()

    if not PRUNING_CONFIG.get("enabled", True):
        return _result(messages)

    normalized_mode = str(mode or "smart").strip().lower()
    if normalized_mode not in {"smart", "aggressive", "status"}:
        LOGGER.warning("prune_service: unknown mode %r — falling back to 'smart'", mode)
        normalized_mode = "smart"

    # Deep-copy the message list to avoid mutating the caller's data.
    messages_copy = [dict(m) for m in messages]

    # Build the tool_call index for this conversation.
    tool_call_index = _build_tool_call_index(messages_copy)

    # Count protected messages.
    protected_count = _count_protected(messages_copy)

    # Dispatch to the appropriate strategy.
    if normalized_mode == "status":
        candidates = _status_report(
            messages_copy,
            tool_call_index,
            aggressive_keep_count=(
                aggressive_keep_count or PRUNING_CONFIG["aggressive_keep_count"]
            ),
        )
        pruned_entries = [
            {
                "tool_name": c["tool_name"],
                "position": c["position"],
                "turns_ago": c["turns_ago"],
                "original_tokens": c["original_tokens"],
                "smart_would_prune": c["smart_would_prune"],
                "smart_reason": c["smart_reason"],
                "aggressive_would_prune": c["aggressive_would_prune"],
            }
            for c in candidates
            if c["smart_would_prune"] or c["aggressive_would_prune"]
        ]
        pruned_count = len(pruned_entries)
        pruned_tokens = sum(e.get("original_tokens", 0) for e in pruned_entries)
        awareness_msg = _build_awareness_message(
            [e for e in pruned_entries if e.get("smart_would_prune")]
        )

        return {
            "messages": messages_copy,  # unmodified in status mode
            "pruned_count": pruned_count,
            "pruned_list": pruned_entries,
            "pruned_tokens": pruned_tokens,
            "protected_count": protected_count,
            "awareness_message": awareness_msg,
            "mode": "status",
        }

    if normalized_mode == "aggressive":
        keep = aggressive_keep_count or PRUNING_CONFIG["aggressive_keep_count"]
        pruned_messages, pruned_entries = _aggressive_prune(
            messages_copy, tool_call_index, keep_count=keep,
        )
    else:
        pruned_messages, pruned_entries = _smart_prune(messages_copy, tool_call_index)

    pruned_count = len(pruned_entries)
    pruned_tokens = sum(e.get("original_tokens", 0) for e in pruned_entries)
    awareness_msg = _build_awareness_message(pruned_entries)

    return {
        "messages": pruned_messages,
        "pruned_count": pruned_count,
        "pruned_list": pruned_entries,
        "pruned_tokens": pruned_tokens,
        "protected_count": protected_count,
        "awareness_message": awareness_msg,
        "mode": normalized_mode,
    }


def mark_rerun_protected(messages: list[dict], tool_call_id: str) -> list[dict]:
    """Tag a tool output as ``protected: true`` after the AI re-runs it.

    Call this when a tool output replaces a previously-pruned marker.  The
    protection prevents the output from being pruned again.

    Parameters
    ----------
    messages:
        The conversation message list (not mutated — returns a new list).
    tool_call_id:
        The ``tool_call_id`` of the re-run tool output to protect.

    Returns
    -------
    list[dict]
        Updated message list with the ``protected`` flag set.
    """
    normalized_id = str(tool_call_id or "").strip()
    if not normalized_id:
        return list(messages)

    result = [dict(m) for m in messages]
    for msg in result:
        if (
            msg.get("role") == "tool"
            and str(msg.get("tool_call_id") or "").strip() == normalized_id
        ):
            msg["protected"] = True
            break
    return result


def get_pruning_config() -> dict[str, Any]:
    """Return a copy of the current pruning configuration."""
    return dict(PRUNING_CONFIG)


def update_pruning_config(**kwargs: Any) -> dict[str, Any]:
    """Update pruning configuration values.

    Returns the updated config.
    """
    for key, value in kwargs.items():
        if key in PRUNING_CONFIG:
            PRUNING_CONFIG[key] = value
            LOGGER.info("prune_service: config updated — %s = %r", key, value)
        else:
            LOGGER.warning("prune_service: unknown config key %r ignored", key)
    return dict(PRUNING_CONFIG)
