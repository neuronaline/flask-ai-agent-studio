"""Shared extraction utilities used across multiple modules.

Consolidates duplicated functions that previously existed in both
agent.agent and routes.chat to avoid code duplication.
"""
from __future__ import annotations


def extract_chat_completion_text(response) -> str:
    """Extract the text content from an OpenAI-style chat completion response.

    Handles both string content and list-of-blocks content formats.

    Args:
        response: An OpenAI chat completion response object with .choices.

    Returns:
        The extracted text content, stripped of whitespace.
    """
    choices = getattr(response, "choices", None) or []
    if not choices:
        return ""
    message = getattr(choices[0], "message", None)
    content = getattr(message, "content", "")
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, dict) and item.get("type") == "text":
                text = str(item.get("text") or "")
                if text:
                    parts.append(text)
        return "".join(parts).strip()
    return str(content or "").strip()
