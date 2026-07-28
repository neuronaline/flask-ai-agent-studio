# tool_parsing.py — Tool call argument parsing utilities
#
# Extracted from agent/agent.py to reduce its size. These are pure
# parsing/transformation functions with no dependencies on agent.py
# module-level state.

from __future__ import annotations

import ast
import html
import ijson
import json
import re
from typing import Any


# ── Regex constants for DSML / tool argument parsing ──────────────────────

DSML_INVOKE_TAG_RE = re.compile(
    r'<[^>]*invoke\s+name="(?P<name>[^"]+)"[^>]*>', re.IGNORECASE
)
DSML_FUNCTION_CALLS_TAG_RE = re.compile(
    r"<[^>]*function_calls[^>]*>", re.IGNORECASE
)
DSML_PARAMETER_TAG_RE = re.compile(
    r'<[^>]*parameter\s+name="(?P<name>[^"]*)"(?P<attrs>[^>]*)>(?P<value>.*?)</[^>]*parameter\s*>',
    re.IGNORECASE | re.DOTALL,
)
DSML_STRING_ATTR_RE = re.compile(
    r'\bstring\s*=\s*["\']true["\']', re.IGNORECASE
)
TOOL_ARGUMENT_CODE_FENCE_RE = re.compile(
    r"^\s*```(?:json|javascript|js|python|py)?\s*(?P<body>.*?)\s*```\s*$",
    re.IGNORECASE | re.DOTALL,
)
TOOL_ARGUMENT_LANGUAGE_LABELS = {"json", "javascript", "js", "python", "py"}


# ── Low-level utility functions ──────────────────────────────────────────


def _coerce_text(value) -> str:
    """Convert *value* to a string, flattening list-of-content-blocks."""
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        parts = []
        for item in value:
            if isinstance(item, str):
                if item:
                    parts.append(item)
                continue
            if isinstance(item, dict):
                text = item.get("text")
                if text:
                    parts.append(str(text))
        return "".join(parts)
    return str(value)


def _read_api_field(value, key: str, default=None) -> Any:
    """Read *key* from a dict or object."""
    if isinstance(value, dict):
        return value.get(key, default)
    return getattr(value, key, default)


# ── JSON and DSML parsing ────────────────────────────────────────────────


def _parse_json_like_text(text: str) -> Any:
    """Try to parse *text* as JSON, falling back to ``ast.literal_eval``."""
    raw_text = str(text or "").strip()
    if not raw_text:
        return None
    try:
        return json.loads(raw_text)
    except Exception:
        pass
    try:
        return ast.literal_eval(raw_text)
    except Exception:
        return None


def _strip_tool_argument_code_fence(text: str) -> str | None:
    """Strip a triple-backtick fence (with optional language label).

    Returns the inner body or ``None`` if the text is not a fenced block.
    """
    match = TOOL_ARGUMENT_CODE_FENCE_RE.match(str(text or ""))
    if not match:
        return None
    return str(match.group("body") or "").strip()


def _strip_tool_argument_language_label(text: str) -> str | None:
    """Strip a leading language label (e.g. ``json``, ``python``).

    Returns the remainder after the first line or ``None`` if the first
    line is not a recognised label.
    """
    raw_text = str(text or "").strip()
    if not raw_text or "\n" not in raw_text:
        return None

    first_line, remainder = raw_text.split("\n", 1)
    if first_line.strip().lower() not in TOOL_ARGUMENT_LANGUAGE_LABELS:
        return None

    cleaned_remainder = remainder.strip()
    if not cleaned_remainder.startswith(("{", "[", "<")):
        return None
    return cleaned_remainder


def _iter_tool_argument_text_candidates(arguments_text: str):
    """Yield progressively cleaned versions of a tool-arguments string.

    Attempts in order: raw → HTML-unescaped → code-fence stripped →
    language-label stripped.
    """
    raw_text = str(arguments_text or "").strip()
    if not raw_text:
        return

    pending = [raw_text]
    seen = set()

    while pending:
        candidate = str(pending.pop(0) or "").strip()
        if not candidate or candidate in seen:
            continue

        seen.add(candidate)
        yield candidate

        html_unescaped = html.unescape(candidate).strip()
        if html_unescaped and html_unescaped not in seen and html_unescaped != candidate:
            pending.append(html_unescaped)

        fence_inner = _strip_tool_argument_code_fence(candidate)
        if fence_inner and fence_inner not in seen:
            pending.append(fence_inner)

        unlabeled = _strip_tool_argument_language_label(candidate)
        if unlabeled and unlabeled not in seen:
            pending.append(unlabeled)

        # Strict parsing mode: do not attempt custom fragment repair.


def _parse_dsml_argument_value(value_text: str, attrs_text: str = "") -> Any:
    """Parse a DSML ``<parameter>`` value, respecting the ``string`` attribute."""
    raw_value = str(value_text or "")
    if DSML_STRING_ATTR_RE.search(str(attrs_text or "")):
        return raw_value

    parsed_value = _parse_json_like_text(raw_value)
    if parsed_value is not None:
        return parsed_value

    return raw_value.strip()


def _parse_dsml_argument_object(arguments_text: str) -> dict | None:
    """Parse DSML ``<parameter>`` tags into a ``dict``."""
    raw_arguments = str(arguments_text or "")
    parsed_arguments: dict[str, Any] = {}
    found_parameter = False

    for match in DSML_PARAMETER_TAG_RE.finditer(raw_arguments):
        found_parameter = True
        field_name = str(match.group("name") or "").strip()
        if not field_name:
            continue

        field_value = _parse_dsml_argument_value(
            match.group("value"), match.group("attrs")
        )
        existing_value = parsed_arguments.get(field_name)
        if existing_value is None:
            parsed_arguments[field_name] = field_value
            continue
        if isinstance(existing_value, list):
            existing_value.append(field_value)
            continue
        parsed_arguments[field_name] = [existing_value, field_value]

    if not found_parameter:
        return None
    return parsed_arguments


def _extract_dsml_tool_calls_from_content(
    content_text: str,
) -> tuple[str, list[dict] | None]:
    """Extract DSML-format tool calls from assistant content text.

    Returns ``(stripped_content, tool_calls_or_None)``.
    """
    raw_content = str(content_text or "")
    invoke_matches = list(DSML_INVOKE_TAG_RE.finditer(raw_content))
    if not invoke_matches:
        return raw_content, None

    tool_calls: list[dict] = []
    dsml_start = invoke_matches[0].start()
    function_calls_tag_match = DSML_FUNCTION_CALLS_TAG_RE.search(raw_content)
    if function_calls_tag_match and function_calls_tag_match.start() < dsml_start:
        dsml_start = function_calls_tag_match.start()
    for index, match in enumerate(invoke_matches, start=1):
        tool_name = str(match.group("name") or "").strip()
        if not tool_name:
            continue

        next_start = (
            invoke_matches[index].start()
            if index < len(invoke_matches)
            else len(raw_content)
        )
        arguments_text = raw_content[match.end() : next_start]
        parsed_arguments = _parse_dsml_argument_object(arguments_text) or {}
        tool_calls.append(
            {
                "id": f"content-tool-call-{index}",
                "name": tool_name,
                "arguments": parsed_arguments,
            }
        )

    if not tool_calls:
        return raw_content, None

    return raw_content[:dsml_start].strip(), tool_calls


def _prefer_content_dsml_tool_calls(
    content_text: str,
    tool_calls: list[dict] | None,
    tool_call_error: str | None,
) -> tuple[str, list[dict] | None, str | None]:
    """Prefer DSML tool calls extracted from content over native ones.

    Returns ``(content, tool_calls, error)``.
    """
    normalized_content, content_tool_calls = _extract_dsml_tool_calls_from_content(
        content_text
    )
    if content_tool_calls:
        return normalized_content, content_tool_calls, None
    return content_text, tool_calls, tool_call_error


def _parse_tool_call_arguments(
    arguments_text: str, label: str
) -> tuple[dict | None, str | None]:
    """Parse tool call arguments string into a ``dict``.

    Tries JSON, DSML, and various cleaned forms.  Returns ``(parsed_dict, error_or_None)``.
    """
    raw_arguments = str(arguments_text or "").strip()
    if not raw_arguments:
        return {}, None

    json_error = None
    try:
        json.loads(raw_arguments)
    except json.JSONDecodeError as exc:
        json_error = exc.msg

    saw_non_object_candidate = False
    for candidate in _iter_tool_argument_text_candidates(raw_arguments):
        parsed_arguments = _parse_json_like_text(candidate)
        if parsed_arguments is None:
            parsed_arguments = _parse_dsml_argument_object(candidate)
        if parsed_arguments is None:
            continue
        if isinstance(parsed_arguments, dict):
            return parsed_arguments, None
        saw_non_object_candidate = True

    if saw_non_object_candidate:
        return None, f"Tool arguments for {label} must be an object"

    if raw_arguments.startswith("<"):
        return (
            None,
            f"Invalid tool arguments JSON for {label}: {json_error or 'Could not parse arguments'}",
        )

    if raw_arguments.lstrip().startswith("{"):
        return (
            None,
            f"Invalid tool arguments JSON for {label}: {json_error or 'Could not parse arguments'}",
        )
    return (
        None,
        f"Invalid tool arguments JSON for {label}: {json_error or 'Could not parse arguments'}",
    )


def _extract_native_tool_calls(
    message,
) -> tuple[list[dict] | None, str | None]:
    """Extract native OpenAI-style ``tool_calls`` from a message dict/object.

    Returns ``(normalised_calls_or_None, error_or_None)``.
    """
    raw_tool_calls = _read_api_field(message, "tool_calls") or []
    if not raw_tool_calls:
        return None, None

    normalized_calls: list[dict] = []
    for index, raw_call in enumerate(raw_tool_calls, start=1):
        function = _read_api_field(raw_call, "function")
        tool_name = str(_read_api_field(function, "name") or "").strip()
        if not tool_name:
            return None, f"tool_calls[{index}] is missing a tool name"

        arguments_text = _coerce_text(_read_api_field(function, "arguments", ""))
        tool_args, parse_error = _parse_tool_call_arguments(
            arguments_text, tool_name
        )
        if parse_error:
            return None, parse_error

        normalized_calls.append(
            {
                "id": str(
                    _read_api_field(raw_call, "id") or f"tool-call-{index}"
                ),
                "name": tool_name,
                "arguments": tool_args or {},
            }
        )
    return normalized_calls, None


def _merge_stream_tool_call_delta(
    tool_call_parts: list[dict], delta
) -> None:
    """Merge a streaming chunk's ``tool_calls`` delta into accumulator parts."""
    raw_tool_calls = _read_api_field(delta, "tool_calls") or []
    for fallback_index, raw_call in enumerate(raw_tool_calls):
        index_value = _read_api_field(raw_call, "index", fallback_index)
        try:
            index = max(0, int(index_value))
        except (TypeError, ValueError):
            index = fallback_index

        while len(tool_call_parts) <= index:
            tool_call_parts.append(
                {"id": "", "name": "", "arguments_parts": []}
            )

        entry = tool_call_parts[index]
        call_id = _read_api_field(raw_call, "id")
        if call_id:
            entry["id"] = str(call_id)

        function = _read_api_field(raw_call, "function")
        name_part = str(_read_api_field(function, "name") or "")
        if name_part:
            if not entry["name"]:
                entry["name"] = name_part
            elif not entry["name"].endswith(name_part):
                entry["name"] += name_part

        arguments_part = _coerce_text(
            _read_api_field(function, "arguments", "")
        )
        if arguments_part:
            entry["arguments_parts"].append(arguments_part)


def _stream_tool_call_entry_has_meaningful_content(raw_call: dict) -> bool:
    """Return True if a streaming tool-call entry has a name or argument data."""
    if not isinstance(raw_call, dict):
        return False
    if str(raw_call.get("name") or "").strip():
        return True
    arguments_parts = (
        raw_call.get("arguments_parts")
        if isinstance(raw_call.get("arguments_parts"), list)
        else []
    )
    return any(str(part or "") for part in arguments_parts)


def _has_meaningful_stream_tool_calls(tool_call_parts: list[dict]) -> bool:
    """Return True if any entry in *tool_call_parts* has meaningful content."""
    return any(
        _stream_tool_call_entry_has_meaningful_content(raw_call)
        for raw_call in tool_call_parts
    )


def _extract_partial_json_string_value(
    arguments_text: str, field_name: str
) -> str | None:
    """Extract a string field value from potentially incomplete JSON.

    Uses ``ijson`` for robust streaming parsing, falling back to regex
    for edge cases.
    """
    raw_arguments = str(arguments_text or "")
    raw_field_name = str(field_name or "").strip()
    if not raw_arguments or not raw_field_name:
        return None

    # Fast path: try to parse complete JSON first
    try:
        parsed = json.loads(raw_arguments)
        if isinstance(parsed, dict) and raw_field_name in parsed:
            value = parsed.get(raw_field_name)
            if value is not None:
                return str(value)
    except (json.JSONDecodeError, ValueError):
        pass

    # Streaming path: use ijson to parse partial JSON
    try:
        parser = ijson.parse(raw_arguments)
        current_key = None
        in_target_field = False
        field_value_parts: list[str] = []
        depth = 0

        for prefix, event, value in parser:
            if event == "start_map":
                if depth == 0 and current_key == raw_field_name:
                    in_target_field = True
                depth += 1
            elif event == "end_map":
                depth -= 1
                if depth == 0 and in_target_field:
                    return "".join(field_value_parts)
                in_target_field = False
                current_key = None
            elif event == "map_key":
                current_key = value
                if current_key == raw_field_name and depth == 1:
                    in_target_field = True
                else:
                    in_target_field = False
            elif in_target_field and event == "string":
                field_value_parts.append(
                    value if isinstance(value, str) else str(value)
                )
            elif in_target_field and event in ("number", "boolean"):
                field_value_parts.append(str(value))

        if field_value_parts:
            return "".join(field_value_parts)
    except Exception:
        pass

    # Fallback: regex-based extraction for malformed partial JSON
    try:
        escaped_field = re.escape(raw_field_name)
        pattern = rf'"{escaped_field}"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"'
        match = re.search(pattern, raw_arguments, re.DOTALL)
        if match:
            return json.loads(f'"{match.group(1)}"')
    except Exception:
        pass

    return None


def _parse_json_like_value(value: Any) -> Any:
    """Parse *value* as JSON-like text if it is a string, otherwise pass through."""
    if isinstance(value, (dict, list)):
        return value
    if not isinstance(value, str):
        return None
    return _parse_json_like_text(value)
