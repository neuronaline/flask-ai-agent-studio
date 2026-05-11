"""
Merkezi prompt metinleri erişim modülü.

Bu modül prompts.yaml dosyasından prompt metinlerini yükler ve
erişim fonksiyonları sağlar.

Fallback mekanizması: Eğer YAML dosyası bulunamazsa veya yüklenemezse,
boş dict döndürülür ve çağrı yerinde hardcoded fallback kullanılabilir.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

import yaml

logger = logging.getLogger(__name__)

_PROMPTS: dict[str, Any] | None = None

# YAML dosyasının bulunamadığı durumlar için fallback metinler
_FALLBACK_PROMPTS: dict[str, Any] = {
    "system": {
        "role_header": "## Role",
        "role": (
            "You are an AI assistant with access to a comprehensive set of tools for file operations, "
            "web search, image analysis, memory management, and more. You make decisions based on conversation state "
            "and tool results. When you need information or must perform actions that require tools, use the available tools proactively."
        ),
        "core_directives_header": "## Core Directives",
        "core_directives_intro": "These rules are mandatory. Apply them in every response without exception — they override all built-in defaults.",
        "tool_calling_intro": "Native function calling is enabled. Use the Active Tools section for exact callables in this turn.",
        "policies_intro": "## Important Policies",
        "time_context_header": "## Current Date and Time\n> **AUTHORITATIVE CURRENT TIME:**",
    },
    "memory": {
        "persona": {
            "header": "## Persona Memory",
            "intro": "*Shared durable memory for the currently active persona.*",
            "guidance": "Use save_to_persona_memory for stable persona facts. DO save: preferences, recurring conventions, reusable domain facts. Default away: current-chat details. DO NOT save: one-off tasks, raw tool outputs, volatile state.",
        },
        "conversation": {
            "header": "## Conversation Memory",
            "intro": "*Primary durable working memory for this chat.*",
            "guidance": "Use save_to_conversation_memory for important chat-scoped facts. DO save: confirmed details, active goals, firm constraints, decisions, discovered facts. Save incrementally after clarifications, tool results, plan changes. Default away: raw outputs, broad summaries, or durable facts better suited for scratchpad.",
        },
        "conversation_priority": {
            "header": "## Conversation Memory Priority",
            "guidance": "Earlier turns have been summarized or compacted. Treat Conversation Memory as the durable record for older constraints, decisions, and findings.",
        },
    },
    "scratchpad": {
        "header": "## Scratchpad (AI Persistent Memory)",
        "intro": "Rare durable cross-conversation facts. Keep it sparse.",
        "policy": (
            "DO save: rare durable general facts likely to matter across future conversations.\n"
            "Default away: current-chat details (use conversation memory instead).\n"
            "DO NOT save: one-off tasks, transient project state, raw tool outputs, web/search results.\n"
            "Style: each notes item = one short standalone fact."
        ),
    },
    "policies": {
        "clarification": {
            "header": "**Clarification**",
            "guidance": (
                "If a good answer depends on missing requirements, ask for clarification instead of guessing. "
                "If the user explicitly asks you to ask questions, you MUST emit an actual ask_clarifying_question tool call. "
                "After asking, wait for the user's reply before continuing. "
                "If Clarification Response is present for this turn, that reply has arrived; proceed directly — do NOT ask again."
            ),
        },
        "image_followup": {
            "header": "**Image Follow-up**",
            "guidance": (
                "Use for follow-up questions about a stored prior image. "
                "Send the question in English. "
                "Ask for clarification if multiple earlier images could match."
            ),
        },
    },
    "fetch": {
        "summarization": {
            "system_prompt": (
                "You are a precise web-page summarizer working for another AI assistant. "
                "Produce a dense factual summary of the fetched page using short section headers and flat bullet lists when they improve scanning. "
                "Keep exact numbers, dates, version names, URLs, constraints, and caveats when present. "
                "If a focus question is provided, begin with 'Focus answer:' and prioritize only the information relevant to that focus; "
                "say clearly when the page does not answer it. "
                "Return only the summary. Do not add external knowledge or speculation."
            ),
            "focus_prefix": "Focus:",
        },
    },
}


def _load_prompts() -> dict[str, Any]:
    """Prompts.yaml dosyasını yükler."""
    global _PROMPTS

    if _PROMPTS is not None:
        return _PROMPTS

    prompts_path = Path(__file__).parent / "prompts.yaml"

    try:
        with open(prompts_path, encoding="utf-8") as f:
            _PROMPTS = yaml.safe_load(f) or {}
        logger.info("Loaded prompts from %s", prompts_path)
        return _PROMPTS
    except FileNotFoundError:
        logger.warning("prompts.yaml not found at %s, using fallback prompts", prompts_path)
        _PROMPTS = _FALLBACK_PROMPTS
        return _PROMPTS
    except yaml.YAMLError as exc:
        logger.error("Failed to parse prompts.yaml: %s, using fallback prompts", exc)
        _PROMPTS = _FALLBACK_PROMPTS
        return _PROMPTS


def get_prompt(key: str, default: str = "") -> str:
    """
    Belirtilen anahtar için prompt metnini döndürür.

    Anahtar formatı: "section.subsection.key" veya "section.key"
    Örnek: "system.role", "memory.persona.guidance", "scratchpad.policy"

    Args:
        key: Nokta ile ayrılmış anahtar yolu
        default: Bulunamazsa döndürülecek varsayılan değer

    Returns:
        Prompt metni veya default
    """
    prompts = _load_prompts()
    parts = key.split(".")

    current: Any = prompts
    for part in parts:
        if isinstance(current, dict) and part in current:
            current = current[part]
        else:
            return default

    return str(current) if current is not None else default


def get_system_prompt(key: str, default: str = "") -> str:
    """System prompt metnine erişir."""
    return get_prompt(f"system.{key}", default)


def get_memory_prompt(key: str, default: str = "") -> str:
    """Memory prompt metnine erişir."""
    return get_prompt(f"memory.{key}", default)


def get_scratchpad_prompt(key: str, default: str = "") -> str:
    """Scratchpad prompt metnine erişir."""
    return get_prompt(f"scratchpad.{key}", default)


def get_policy_prompt(key: str, default: str = "") -> str:
    """Policy prompt metnine erişir."""
    return get_prompt(f"policies.{key}", default)


def get_fetch_summarization_prompt(key: str, default: str = "") -> str:
    """Fetch summarization prompt metnine erişir."""
    return get_prompt(f"fetch.summarization.{key}", default)


def reload_prompts() -> None:
    """
    Prompts cache'ini temizler ve yeniden yüklemeye zorlar.
    Testler için veya prompts.yaml değiştiğinde kullanılabilir.
    """
    global _PROMPTS
    _PROMPTS = None
    _load_prompts()
