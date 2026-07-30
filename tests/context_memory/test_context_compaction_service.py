"""Contract checks for the shared explicit compaction service."""

from services.context_compaction import _format_blocks


def test_compaction_operation_receives_complete_block_content():
    content = "x" * 5_001
    prompt = _format_blocks(
        [{"public_id": "msg_1", "kind": "message", "api_role": "user", "content": content}]
    )
    assert content in prompt
    assert "truncated" not in prompt
