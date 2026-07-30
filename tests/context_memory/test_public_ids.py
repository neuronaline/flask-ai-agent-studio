"""Unit tests for public-ID generation, validation, and classification."""

from __future__ import annotations

import pytest

from core.context_memory import (
    ContextBlockKind,
    classify_public_id,
    make_public_id,
    resolve_kind_from_public_id,
    validate_public_id,
    validate_public_ids,
)


class TestMakePublicId:
    """Construction of public IDs from kind + parts."""

    def test_message_id(self):
        assert make_public_id(ContextBlockKind.MESSAGE, 104) == "msg_104"

    def test_tool_call_id(self):
        assert make_public_id(ContextBlockKind.TOOL_CALL, 105, 1) == "tool_call_105_1"

    def test_tool_result_id(self):
        assert make_public_id(ContextBlockKind.TOOL_RESULT, 106) == "tool_res_106"

    def test_delegate_report_id(self):
        result = make_public_id(ContextBlockKind.DELEGATE_REPORT, "abc123")
        assert result.startswith("delegate_res_")
        assert result == "delegate_res_abc123"

    def test_web_report_id(self):
        result = make_public_id(ContextBlockKind.WEB_REPORT, "abc123")
        assert result == "web_res_abc123"

    def test_compacted_state_id(self):
        result = make_public_id(ContextBlockKind.COMPACTED_STATE, "abc123")
        assert result == "state_abc123"

    def test_resume_instruction_id(self):
        result = make_public_id(ContextBlockKind.RESUME_INSTRUCTION, "abc123")
        assert result == "resume_abc123"

    def test_summary_id(self):
        result = make_public_id(ContextBlockKind.SUMMARY, "abc123")
        assert result == "summary_abc123"

    def test_unknown_kind_raises(self):
        with pytest.raises(ValueError):
            make_public_id("nonexistent")  # type: ignore[arg-type]


class TestValidatePublicId:
    """Individual public-ID validation."""

    @pytest.mark.parametrize("pid", [
        "msg_1",
        "msg_104",
        "msg_999999",
    ])
    def test_valid_message_ids(self, pid):
        assert validate_public_id(pid)

    @pytest.mark.parametrize("pid", [
        "tool_call_105_1",
        "tool_call_1_0",
        "tool_call_999_42",
    ])
    def test_valid_tool_call_ids(self, pid):
        assert validate_public_id(pid)

    @pytest.mark.parametrize("pid", [
        "tool_res_106",
        "tool_res_1",
        "tool_res_999999",
    ])
    def test_valid_tool_result_ids(self, pid):
        assert validate_public_id(pid)

    @pytest.mark.parametrize("pid", [
        "delegate_res_abc123",
        "delegate_res_1",
        "delegate_res_abc-def_ghi",
    ])
    def test_valid_delegate_report_ids(self, pid):
        assert validate_public_id(pid)

    @pytest.mark.parametrize("pid", [
        "web_res_abc123",
        "state_abc123",
        "resume_abc123",
        "summary_abc123",
    ])
    def test_valid_opaque_ids(self, pid):
        assert validate_public_id(pid)

    @pytest.mark.parametrize("pid", [
        "",
        "msg_",
        "tool_call_",
        "msg_abc",       # not numeric
        "tool_call_a_b",  # non-numeric parts
        "tool_res_",     # empty suffix
        "unknown_1",     # unknown prefix
        "123",           # no prefix
    ])
    def test_invalid_ids(self, pid):
        assert not validate_public_id(pid)


class TestClassifyPublicId:
    """Prefix-based kind classification."""

    def test_classify_message(self):
        assert classify_public_id("msg_104") == ContextBlockKind.MESSAGE

    def test_classify_tool_call(self):
        assert classify_public_id("tool_call_105_1") == ContextBlockKind.TOOL_CALL

    def test_classify_tool_result(self):
        assert classify_public_id("tool_res_106") == ContextBlockKind.TOOL_RESULT

    def test_classify_unknown(self):
        assert classify_public_id("unknown_123") is None

    def test_classify_empty(self):
        assert classify_public_id("") is None

    def test_classify_none(self):
        assert classify_public_id(None) is None  # type: ignore[arg-type]


class TestResolveKindFromPublicId:
    """kind resolution for validated IDs."""

    def test_resolve_message(self):
        assert resolve_kind_from_public_id("msg_104") == ContextBlockKind.MESSAGE

    def test_resolve_raises_on_unknown(self):
        with pytest.raises(ValueError, match="Unrecognised"):
            resolve_kind_from_public_id("bad_123")


class TestValidatePublicIds:
    """Batch validation."""

    def test_filters_invalid(self):
        result = validate_public_ids(["msg_1", "bad", "tool_call_2_1", "", "web_res_x"])
        assert result == ["msg_1", "tool_call_2_1", "web_res_x"]

    def test_all_valid(self):
        ids = ["msg_1", "tool_call_2_1", "tool_res_3"]
        assert validate_public_ids(ids) == ids

    def test_all_invalid(self):
        assert validate_public_ids(["bad", "also_bad", ""]) == []
