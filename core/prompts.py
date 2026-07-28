"""
Merkezi prompt metinleri erişim modülü.

Bu modül prompts.yaml dosyasından prompt metinlerini yükler ve
erişim fonksiyonları sağlar.

Fallback mekanizması: Eğer YAML dosyası bulunamazsa veya yüklenemezse,
boş dict döndürülür ve çağrı yerinde hardcoded fallback kullanılabilir.

Cache Versioning:
Uses mtime-based cache invalidation to detect prompt changes without
re-hashing file contents on every call. When either the YAML file or
this logic file changes, the cache is auto-invalidated.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml
from utils.logging_config import get_logger

LOGGER = get_logger(__name__)

_PROMPTS: dict[str, Any] | None = None
_PROMPTS_CACHE_HASH: str = ""

# YAML dosyasının bulunamadığı durumlar için fallback metinler
from core.prompts_fallback import _FALLBACK_PROMPTS  # noqa: F811


def _load_prompts() -> dict[str, Any]:
    """Load prompts from YAML with mtime-based cache invalidation.

    Uses file modification time instead of content hashing to avoid
    unnecessary disk I/O on every ``get_prompt()`` call in production.
    If either the YAML or this logic file has changed since the last load,
    the cache is invalidated and the file is re-read.
    """
    global _PROMPTS, _PROMPTS_CACHE_HASH

    prompts_path = Path(__file__).parent / "prompts.yaml"
    project_prompts_path = Path(__file__).parent.parent / "prompts.yaml"
    logic_file = Path(__file__)

    # Build a composite fingerprint from file mtimes to detect changes without
    # reading file bytes on every call.
    yaml_path = project_prompts_path if project_prompts_path.exists() else prompts_path
    try:
        yaml_mtime = str(int(yaml_path.stat().st_mtime))
    except OSError:
        yaml_mtime = ""
    try:
        logic_mtime = str(int(logic_file.stat().st_mtime))
    except OSError:
        logic_mtime = ""
    composite_hash = f"{yaml_mtime}:{logic_mtime}"

    if _PROMPTS is not None and _PROMPTS_CACHE_HASH == composite_hash:
        return _PROMPTS

    try:
        if project_prompts_path.exists():
            with open(project_prompts_path, encoding="utf-8") as f:
                _PROMPTS = yaml.safe_load(f) or {}
            LOGGER.info("Loaded prompts from %s", project_prompts_path)
        else:
            with open(prompts_path, encoding="utf-8") as f:
                _PROMPTS = yaml.safe_load(f) or {}
            LOGGER.info("Loaded prompts from %s", prompts_path)
        _PROMPTS_CACHE_HASH = composite_hash
        return _PROMPTS
    except FileNotFoundError:
        LOGGER.warning("prompts.yaml not found at %s, using fallback prompts", prompts_path)
        _PROMPTS = _FALLBACK_PROMPTS
        _PROMPTS_CACHE_HASH = composite_hash
        return _PROMPTS
    except yaml.YAMLError as exc:
        LOGGER.error("Failed to parse prompts.yaml: %s, using fallback prompts", exc)
        _PROMPTS = _FALLBACK_PROMPTS
        _PROMPTS_CACHE_HASH = composite_hash
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


def get_agent_prompt(key: str, default: str = "") -> str:
    """Agent runtime prompt metnine erişir (final_answer, reasoning_replay, working_state, constants, recovery_hints)."""
    return get_prompt(f"agent.{key}", default)


def get_tool_prompt(tool_name: str, key: str, default: str = "") -> str:
    """Belirli bir tool için prompt metnine erişir.

    Args:
        tool_name: Tool adı (örn: 'search_web', 'fetch_url')
        key: Alt anahtar (örn: 'description', 'purpose', 'guidance')
    """
    return get_prompt(f"tools.{tool_name}.{key}", default)


def get_tool_prompt_dict(tool_name: str) -> dict[str, str]:
    """Belirli bir tool için tüm prompt metinlerini dict olarak döndürür.

    Returns:
        {'description': ..., 'purpose': ..., 'guidance': ...}
        Bulunamayan anahtarlar boş string olur.
    """
    return {
        "description": get_tool_prompt(tool_name, "description", ""),
        "purpose": get_tool_prompt(tool_name, "purpose", ""),
        "guidance": get_tool_prompt(tool_name, "guidance", ""),
    }


def get_canvas_prompt(key: str, default: str = "") -> str:
    """Canvas prompt metnine erişir (editing_guidance, runtime_context, etc.)."""
    return get_prompt(f"canvas.{key}", default)


def get_tool_calling_prompt(key: str, default: str = "") -> str:
    """Tool calling kuralları prompt metnine erişir."""
    return get_prompt(f"tool_calling.{key}", default)


def get_message_prompt(key: str, default: str = "") -> str:
    """Mesaj formatlama şablonu prompt metnine erişir."""
    return get_prompt(f"messages.{key}", default)


def get_image_prompt(key: str, default: str = "") -> str:
    """Görüntü analizi prompt metnine erişir."""
    return get_prompt(f"image.{key}", default)


def get_summary_prompt(key: str, default: str = "") -> str:
    """Konuşma özetleme prompt metnine erişir."""
    return get_prompt(f"summary.{key}", default)


def get_all_tool_names() -> list[str]:
    """YAML'de tanımlı tüm tool isimlerini döndürür."""
    prompts = _load_prompts()
    tools = prompts.get("tools")
    if isinstance(tools, dict):
        return list(tools.keys())
    return []


def reload_prompts() -> None:
    """
    Prompts cache'ini temizler ve yeniden yüklemeye zorlar.
    Testler için veya prompts.yaml değiştiğinde kullanılabilir.
    """
    global _PROMPTS
    _PROMPTS = None
    _load_prompts()
