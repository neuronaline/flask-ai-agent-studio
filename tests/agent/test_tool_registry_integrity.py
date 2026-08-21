"""Phase 1 — Tool Registry Integrity Guard.

Enforces the contract that every model-callable tool has a registered executor,
tool names are unique, removed tools cannot reappear in any surface, and the
active tool settings filter legacy entries without breaking startup.
"""

from __future__ import annotations

import json

import pytest

from agent import agent as agent_module
from lib.tool_registry import (
    ADDITIONAL_RUNTIME_TOOL_NAMES,
    TOOL_SPEC_BY_NAME,
    TOOL_SPECS,
    get_enabled_tool_specs,
    get_openai_tool_specs,
    get_prompt_tool_context,
    get_runtime_setting,
    get_tool_runtime_metadata,
    resolve_runtime_tool_names,
)
from routes.pages import (
    TOOL_PERMISSION_DESCRIPTIONS,
    TOOL_PERMISSION_LABELS,
    build_tool_permission_options,
)

REMOVED_TOOL_NAMES = {
    "save_to_persona_memory",
    "delete_persona_memory_entry",
    "delegate_task",
}


@pytest.fixture
def all_runtime_tool_names() -> set[str]:
    """The union of tools available to the agent runtime."""
    return set(TOOL_SPEC_BY_NAME) | set(ADDITIONAL_RUNTIME_TOOL_NAMES)


@pytest.fixture
def all_executor_names() -> set[str]:
    """Tool names with a registered executor in agent._TOOL_EXECUTORS."""
    return set(agent_module._TOOL_EXECUTORS)


def test_tool_spec_names_are_unique():
    """Duplicate tool names should fail this deterministic test."""
    names = [tool["name"] for tool in TOOL_SPECS]
    duplicates = sorted({name for name in names if names.count(name) > 1})
    assert not duplicates, f"Duplicate tool names in TOOL_SPECS: {duplicates}"


def test_every_tool_spec_has_executor(all_runtime_tool_names, all_executor_names):
    """Every tool advertised to the model must have a working executor."""
    missing = sorted(all_runtime_tool_names - all_executor_names)
    assert not missing, f"Tool specs without executors: {missing}"


def test_no_removed_tool_in_specs():
    """Removed tools must not reappear in TOOL_SPEC_BY_NAME."""
    present = sorted(set(TOOL_SPEC_BY_NAME) & REMOVED_TOOL_NAMES)
    assert not present, f"Removed tools reappeared in TOOL_SPEC_BY_NAME: {present}"


def test_no_removed_tool_in_executors(all_executor_names):
    """Removed tools must not reappear in agent._TOOL_EXECUTORS."""
    present = sorted(all_executor_names & REMOVED_TOOL_NAMES)
    assert not present, f"Removed tools reappeared in _TOOL_EXECUTORS: {present}"


def test_no_removed_tool_in_openai_schemas():
    """OpenAI-style schema output must omit removed tool names."""
    active = list(TOOL_SPEC_BY_NAME)
    schemas = get_openai_tool_specs(active)
    function_names = {schema["function"]["name"] for schema in schemas}
    leaked = sorted(function_names & REMOVED_TOOL_NAMES)
    assert not leaked, f"Removed tools leaked into openai tool schemas: {leaked}"


def test_no_removed_tool_in_prompt_tool_context():
    """Prompt-visible tool context must omit removed tool names."""
    active = list(TOOL_SPEC_BY_NAME)
    context = get_prompt_tool_context(active) or []
    prompt_names = {entry["name"] for entry in context if isinstance(entry, dict)}
    leaked = sorted(prompt_names & REMOVED_TOOL_NAMES)
    assert not leaked, f"Removed tools leaked into prompt tool context: {leaked}"


def test_no_removed_tool_in_enabled_specs():
    """get_enabled_tool_specs() must filter removed tool names."""
    active = list(TOOL_SPEC_BY_NAME)
    enabled = get_enabled_tool_specs(active)
    enabled_names = {tool["name"] for tool in enabled}
    leaked = sorted(enabled_names & REMOVED_TOOL_NAMES)
    assert not leaked, f"Removed tools leaked into enabled specs: {leaked}"


def test_removed_tools_filtered_from_runtime_resolution(all_runtime_tool_names):
    """resolve_runtime_tool_names() must drop removed names from active lists."""
    legacy = list(all_runtime_tool_names)
    resolved = resolve_runtime_tool_names(legacy)
    leaked = sorted(set(resolved) & REMOVED_TOOL_NAMES)
    assert not leaked, f"Removed tools not filtered by resolve_runtime_tool_names: {leaked}"


def test_removed_tools_not_in_ui_catalog():
    """The UI tool catalog must omit removed names."""
    options = build_tool_permission_options()
    option_names = {option["name"] for option in options}
    leaked = sorted(option_names & REMOVED_TOOL_NAMES)
    assert not leaked, f"Removed tools leaked into UI catalog: {leaked}"


def test_removed_tools_not_in_permission_labels():
    """TOOL_PERMISSION_LABELS / DESCRIPTIONS must not carry removed names."""
    leaked_labels = sorted(set(TOOL_PERMISSION_LABELS) & REMOVED_TOOL_NAMES)
    leaked_desc = sorted(set(TOOL_PERMISSION_DESCRIPTIONS) & REMOVED_TOOL_NAMES)
    assert not leaked_labels, f"Removed tools in TOOL_PERMISSION_LABELS: {leaked_labels}"
    assert not leaked_desc, f"Removed tools in TOOL_PERMISSION_DESCRIPTIONS: {leaked_desc}"


def test_legacy_active_tools_settings_filter_removed_names():
    """Loading legacy settings silently drops removed names without raising."""
    from routes.pages import normalize_active_tool_names

    legacy_settings = {
        "active_tools": json.dumps(
            sorted(set(TOOL_SPEC_BY_NAME) | REMOVED_TOOL_NAMES),
            ensure_ascii=False,
        ),
    }
    normalized = normalize_active_tool_names(legacy_settings.get("active_tools"))
    leaked = sorted(set(normalized) & REMOVED_TOOL_NAMES)
    assert not leaked, f"Removed tools survived settings normalization: {leaked}"


def test_get_runtime_metadata_returns_safe_defaults_for_unknown_tool():
    """Unknown tool names must not crash and must use defaults."""
    metadata = get_tool_runtime_metadata("not_a_real_tool")
    assert isinstance(metadata, dict)
    assert metadata.get("read_only") is False
    assert metadata.get("parallel_safe") is False


def test_runtime_setting_helper_resolves_known_settings():
    """Sanity check: get_runtime_setting() returns booleans for known flags."""
    flag_value = get_runtime_setting("CONVERSATION_MEMORY_ENABLED")
    assert isinstance(flag_value, bool)
