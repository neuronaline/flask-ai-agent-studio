"""
Isolated Agent Runner — Reusable sub-agent execution for delegation and web tools.

Per Phase 6 of AI Memory and Context Management:
- Fresh message list (no access to parent Tier 2 history)
- Explicit tool allowlist
- No recursive delegation (delegate_task stripped from child context)
- Cancellation, timeout, structured failure handling
- Canvas: read-only snapshot provided as context preamble
"""

from __future__ import annotations

import threading
import time
from typing import Any

from core.config import get_runtime_setting, DEFAULT_CHAT_MODEL
from lib.model_registry import get_operation_model, resolve_model_target, DEFAULT_CHAT_MODEL as _MD

ISOLATED_AGENT_DEFAULT_MAX_STEPS = 8
ISOLATED_AGENT_DEFAULT_TIMEOUT = 120.0
ISOLATED_AGENT_REPORT_MAX_CHARS = 30_000


def _build_isolated_system_message(
    task_description: str,
    *,
    allowlist_tools: list[str] | None = None,
    constraints: str = "",
    canvas_readonly_snapshot: str = "",
) -> str:
    """Build a minimal, task-focused system message for an isolated sub-agent."""
    parts: list[str] = []

    parts.append(
        "You are a focused sub-agent executing a self-contained task. "
        "Work efficiently within your limited tool access. "
        "Do NOT ask clarifying questions — make reasonable assumptions and proceed."
    )

    parts.append(f"\n## Task\n{task_description}")

    if constraints:
        parts.append(f"\n## Constraints\n{constraints}")

    tools_note = ", ".join(sorted(allowlist_tools or []))
    parts.append(
        f"\n## Available Tools\n{tools_note}\n"
        "You do NOT have access to delegate_task — you must complete the work directly."
    )

    if canvas_readonly_snapshot:
        parts.append(
            "\n## Canvas (Read-Only Reference)\n"
            "The following Canvas documents are provided for context only. "
            "You cannot modify them. If changes are needed, describe them in your report.\n\n"
            f"{canvas_readonly_snapshot}"
        )

    parts.append(
        "\n## Output Format\n"
        "Provide a detailed report of your findings and actions. "
        "Include specific details, file paths, code snippets, URLs, and data you discovered. "
        "This report will be returned to the parent orchestrator."
    )

    return "\n".join(parts)


def _build_web_agent_system_message(
    query: str,
    *,
    focus: str = "",
) -> str:
    """Build a system message for web search/fetch agents."""
    parts: list[str] = []
    parts.append(
        "You are a web research agent. Your job is to search for information, "
        "read relevant pages, and synthesize a clear, detailed report."
    )

    parts.append(f"\n## Research Query\n{query}")

    if focus:
        parts.append(f"\n## Focus Areas\n{focus}")

    parts.append(
        "\n## Instructions\n"
        "1. Search the web for relevant information.\n"
        "2. Read the most promising pages to extract details.\n"
        "3. Synthesize everything into one comprehensive report.\n"
        "4. Include URLs for all sources cited.\n"
        "5. Be thorough — the parent agent cannot browse the web itself."
    )

    parts.append(
        "\n## Output\n"
        "Return a single detailed Markdown report with:\n"
        "- Summary of findings\n"
        "- Key details organized by theme\n"
        "- Source URLs for every claim\n"
        "- Any relevant caveats or uncertainties"
    )

    return "\n".join(parts)


def run_isolated_agent(
    task_messages: list[dict],
    model: str | None = None,
    *,
    allowlist_tools: list[str] | None = None,
    max_steps: int = ISOLATED_AGENT_DEFAULT_MAX_STEPS,
    temperature: float = 0.7,
    cancel_event: threading.Event | None = None,
    timeout_seconds: float = ISOLATED_AGENT_DEFAULT_TIMEOUT,
    conversation_id: int | None = None,
) -> dict:
    """Run a sub-agent in an isolated context.

    The child agent gets a fresh message list with no access to the parent's
    Tier 2 history. It runs with an explicit tool allowlist and cannot delegate.

    Args:
        task_messages: Initial messages for the child (system + user).
        model: Model ID (falls back to delegation operation model).
        allowlist_tools: Tool names the child may use.
        max_steps: Maximum agent loop iterations.
        temperature: Model temperature.
        cancel_event: External cancellation trigger.
        timeout_seconds: Hard timeout for child execution.
        conversation_id: Parent conversation ID (for tracing only).

    Returns:
        dict with keys: report, errors, tool_results, usage, success, elapsed_ms
    """
    # Avoid circular import — import here
    from agent.agent import run_agent_stream

    if not allowlist_tools:
        allowlist_tools = []

    # Strip delegate_task to prevent recursive delegation
    safe_tools = [t for t in allowlist_tools if t != "delegate_task"]

    # Resolve model
    from core.db import get_app_settings

    settings = get_app_settings()
    if not model:
        try:
            model = get_operation_model("delegation", settings)
        except Exception:
            model = DEFAULT_CHAT_MODEL

    # Timeout tracking
    started_at = time.monotonic()
    timed_out = False

    report_parts: list[str] = []
    errors: list[str] = []
    tool_results: list[dict] = []
    usage_data: dict | None = None
    success = False

    try:
        for event in run_agent_stream(
            api_messages=list(task_messages),
            model=model,
            max_steps=max_steps,
            enabled_tool_names=safe_tools,
            prompt_tool_names=safe_tools,
            max_parallel_tools=4,
            temperature=temperature,
            agent_context={
                "conversation_id": conversation_id or 0,
                "cancel_event": cancel_event,
            },
        ):
            # Check timeout
            if (time.monotonic() - started_at) > timeout_seconds:
                timed_out = True
                break

            event_type = event.get("type", "")

            if event_type == "answer_delta":
                report_parts.append(event.get("text", ""))
            elif event_type == "usage":
                usage_data = event
            elif event_type == "tool_capture":
                tool_results = event.get("tool_results") or []
            elif event_type == "tool_error":
                errors.append(event.get("error") or "Unknown tool error")
            elif event_type == "done":
                success = True

    except Exception as exc:
        exc_str = str(exc)
        if "Cancelled" in exc_str or "cancel" in exc_str.lower():
            errors.append("Sub-agent was cancelled.")
        else:
            errors.append(f"Sub-agent failed: {exc_str}")

    if timed_out:
        errors.append(f"Sub-agent timed out after {timeout_seconds:.0f}s.")

    elapsed_ms = max(0, round((time.monotonic() - started_at) * 1000))

    report = "".join(report_parts).strip()
    if not report and not errors:
        report = "Sub-agent completed but produced no output."

    # Truncate overly long reports
    if len(report) > ISOLATED_AGENT_REPORT_MAX_CHARS:
        report = report[:ISOLATED_AGENT_REPORT_MAX_CHARS] + "\n\n... [report truncated]"

    return {
        "report": report,
        "errors": errors,
        "tool_results": tool_results,
        "usage": usage_data,
        "success": success and not timed_out,
        "elapsed_ms": elapsed_ms,
    }
