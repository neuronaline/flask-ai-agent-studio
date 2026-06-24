"""
Virtual File System (VFS) — Shadow Store for Token-Efficient File Access

Per AI Memory and Context Management doc Section 2:
- File contents are NEVER written directly to the context window by default.
- Tools return lightweight pointers (Tier 3); the full content is materialised
  on explicit demand via materialise_file.
- Shadow store maintains an in-memory key-value mapping of file path → content.
"""

from __future__ import annotations

import hashlib
import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from utils.token_utils import estimate_text_tokens

LOGGER = logging.getLogger(__name__)

# Default VFS budget: 50% of model context limit
DEFAULT_VFS_TOKEN_BUDGET = 64_000  # 50% of 128k
PREVIEW_LINES = 10
PREVIEW_CHARS = 2000


@dataclass
class ShadowFile:
    """A file entry in the shadow store.

    Per doc Section 2.2 schema:
    - path, hash, content, last_access, dirty
    - content is NEVER sent to AI unless materialise_file is called.
    """
    path: str
    hash: str
    content: str
    last_access: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    dirty: bool = False

    @property
    def lines(self) -> int:
        return len(self.content.splitlines()) if self.content else 0

    @property
    def tokens_estimate(self) -> int:
        return estimate_text_tokens(self.content)

    @property
    def hash_short(self) -> str:
        return self.hash[:8] if len(self.hash) > 8 else self.hash

    def to_pointer(self) -> dict[str, Any]:
        """Return a lightweight Tier-3 pointer — NEVER full content."""
        preview = self._make_preview()
        return {
            "path": self.path,
            "hash": self.hash_short,
            "lines": self.lines,
            "tokens_estimate": self.tokens_estimate,
            "preview": preview,
            "available": True,
        }

    def _make_preview(self) -> str:
        """First PREVIEW_LINES lines or PREVIEW_CHARS chars, whichever is smaller."""
        if not self.content:
            return ""
        lines = self.content.splitlines()
        if len(lines) <= PREVIEW_LINES:
            return self.content[:PREVIEW_CHARS]
        return "\n".join(lines[:PREVIEW_LINES]) + "\n..."


def _compute_hash(content: str) -> str:
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


class ShadowFileSystem:
    """In-memory shadow store for file contents.

    Singleton — one instance per process.
    """

    def __init__(self, token_budget: int = DEFAULT_VFS_TOKEN_BUDGET):
        self._store: dict[str, ShadowFile] = {}
        self._token_budget = token_budget
        self._total_tokens: int = 0

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def read_file(self, path: str) -> dict[str, Any]:
        """Load a file into the shadow store and return a pointer.

        Per doc Section 2.3 read_file:
        - Content is loaded into the shadow store.
        - The pointer appears in Tier 3.
        - The AI can reason about the file without consuming full token budget.

        Args:
            path: Absolute or relative file path.

        Returns:
            Pointer dict with path, hash, lines, tokens_estimate, preview.
            If the file cannot be read, returns {"available": False, "error": ...}.
        """
        resolved_path = self._resolve_path(path)
        if resolved_path is None:
            LOGGER.warning("VFS: File not found: %s", path)
            return {"path": path, "available": False, "error": f"File not found: {path}"}

        # Check if already in store — refresh last_access
        existing = self._store.get(resolved_path)
        if existing is not None:
            existing.last_access = datetime.now(timezone.utc)
            LOGGER.debug("VFS: Cache hit for %s", resolved_path)
            return existing.to_pointer()

        # Read from disk
        try:
            with open(resolved_path, "r", encoding="utf-8", errors="replace") as f:
                content = f.read()
        except Exception as exc:
            LOGGER.warning("VFS: Failed to read %s: %s", resolved_path, exc)
            return {"path": path, "available": False, "error": str(exc)}

        # Create shadow file entry
        file_hash = _compute_hash(content)
        tokens = estimate_text_tokens(content)
        shadow = ShadowFile(
            path=resolved_path,
            hash=file_hash,
            content=content,
            last_access=datetime.now(timezone.utc),
            dirty=False,
        )

        # Evict if over budget
        self._ensure_budget(tokens)

        self._store[resolved_path] = shadow
        self._total_tokens += tokens
        LOGGER.debug("VFS: Loaded %s (%d lines, %d tokens)", resolved_path, shadow.lines, tokens)
        return shadow.to_pointer()

    def materialise_file(self, path: str) -> str | None:
        """Inject full file content into a Tier-2-appendable string.

        Per doc Section 2.3 materialise_file:
        1. Retrieves content from shadow store (loads from disk if needed).
        2. Returns a header-prefixed content block.
        3. Updates last_access timestamp.

        Args:
            path: File path to materialise.

        Returns:
            Formatted content string ready for Tier 2 append, or None if file
            cannot be read.
        """
        # Ensure it's in the store
        pointer = self.read_file(path)
        if not pointer.get("available"):
            return None

        resolved = self._resolve_path(path)
        if resolved is None:
            return None

        shadow = self._store.get(resolved)
        if shadow is None:
            return None

        shadow.last_access = datetime.now(timezone.utc)
        LOGGER.debug("VFS: Materialised %s (%d tokens)", resolved, shadow.tokens_estimate)

        # Format as a Tier-2-appendable block
        header = f"[File: {resolved} | Hash: {shadow.hash_short}]"
        return f"{header}\n```\n{shadow.content}\n```\n"

    def edit_file(self, path: str, old_string: str, new_string: str) -> dict[str, Any]:
        """Apply a patch to a file in the shadow store.

        Per doc Section 2.3 edit_file:
        1. Retrieves current content from shadow store.
        2. Applies patch (string replacement).
        3. Updates shadow store with new content. Sets dirty: true.
        4. Returns confirmation — full file content is NOT injected.

        Args:
            path: File path.
            old_string: Text to find (must match exactly once).
            new_string: Replacement text.

        Returns:
            Confirmation dict with path, hash, status, lines_changed, new_hash.
            If patch fails, returns error with current content preview.
        """
        resolved = self._resolve_path(path)
        if resolved is None or resolved not in self._store:
            return {"path": path, "status": "error", "error": "File not loaded in VFS. Call read_file first."}

        shadow = self._store[resolved]
        content = shadow.content

        # Check for exact match
        if old_string not in content:
            # Try whitespace-normalized fallback
            normalized_content = " ".join(content.split())
            normalized_old = " ".join(old_string.split())
            if normalized_old in normalized_content:
                # Find exact-match position via normalized alignment
                idx = normalized_content.index(normalized_old)
                # Map back to original content
                orig_idx = self._map_normalized_index(content, normalized_content, idx)
                if orig_idx is not None:
                    old_string = content[orig_idx:orig_idx + len(old_string.strip())]
                else:
                    return {
                        "path": path,
                        "status": "error",
                        "error": "Patch context mismatch — old_string not found exactly. Current preview:\n" + shadow._make_preview(),
                    }
            else:
                return {
                    "path": path,
                    "status": "error",
                    "error": "Patch context mismatch — old_string not found exactly. Current preview:\n" + shadow._make_preview(),
                }

        # Apply patch
        new_content = content.replace(old_string, new_string, 1)
        lines_changed = new_string.count("\n") - old_string.count("\n")

        # Update shadow store
        new_hash = _compute_hash(new_content)
        shadow.content = new_content
        shadow.hash = new_hash
        shadow.dirty = True
        shadow.last_access = datetime.now(timezone.utc)

        # Update token tracking
        old_tokens = estimate_text_tokens(content)
        new_tokens = estimate_text_tokens(new_content)
        self._total_tokens += (new_tokens - old_tokens)

        LOGGER.debug("VFS: Patched %s (hash %s, %d lines changed)", resolved, shadow.hash_short, abs(lines_changed))
        return {
            "path": resolved,
            "hash": shadow.hash_short,
            "status": "applied",
            "lines_changed": abs(lines_changed),
            "new_hash": shadow.hash_short,
        }

    def write_file(self, path: str, content: str) -> dict[str, Any]:
        """Write new content into the shadow store (and optionally to disk).

        Args:
            path: File path.
            content: Full new content.

        Returns:
            Confirmation dict.
        """
        resolved = self._resolve_path(path)
        if resolved is None:
            resolved = path

        file_hash = _compute_hash(content)
        tokens = estimate_text_tokens(content)

        old_shadow = self._store.get(resolved)
        old_tokens = old_shadow.tokens_estimate if old_shadow else 0

        self._ensure_budget(tokens - old_tokens)

        self._store[resolved] = ShadowFile(
            path=resolved,
            hash=file_hash,
            content=content,
            last_access=datetime.now(timezone.utc),
            dirty=False,
        )
        self._total_tokens += (tokens - old_tokens)

        return {
            "path": resolved,
            "hash": file_hash[:8],
            "status": "written",
            "lines": len(content.splitlines()),
            "tokens_estimate": tokens,
        }

    def is_loaded(self, path: str) -> bool:
        """Check if a file is currently in the shadow store."""
        resolved = self._resolve_path(path)
        return resolved is not None and resolved in self._store

    def get_shadow(self, path: str) -> ShadowFile | None:
        """Get the shadow file entry (internal use)."""
        resolved = self._resolve_path(path)
        if resolved is None:
            return None
        return self._store.get(resolved)

    def get_content(self, path: str) -> str | None:
        """Get raw content from shadow store (for tool internal use)."""
        shadow = self.get_shadow(path)
        return shadow.content if shadow else None

    def evict(self, path: str) -> bool:
        """Evict a specific file from the shadow store.

        Per doc Section 2.4: only evict files with dirty=False.
        """
        resolved = self._resolve_path(path)
        if resolved is None or resolved not in self._store:
            return False
        shadow = self._store[resolved]
        if shadow.dirty:
            LOGGER.debug("VFS: Refusing to evict dirty file %s", resolved)
            return False
        self._total_tokens -= shadow.tokens_estimate
        del self._store[resolved]
        LOGGER.debug("VFS: Evicted %s", resolved)
        return True

    def evict_lru(self, count: int = 1) -> int:
        """Evict oldest non-dirty files to free budget.

        Per doc Section 2.4:
        1. Evict files with dirty: false and oldest last_access.
        2. Never evict dirty: true files.
        3. Evicted files can be re-read from disk if needed.

        Args:
            count: Number of files to evict.

        Returns:
            Number of files actually evicted.
        """
        candidates = sorted(
            [s for s in self._store.values() if not s.dirty],
            key=lambda s: s.last_access,
        )
        evicted = 0
        for shadow in candidates:
            if evicted >= count:
                break
            self._total_tokens -= shadow.tokens_estimate
            del self._store[shadow.path]
            evicted += 1
        if evicted > 0:
            LOGGER.debug("VFS: LRU evicted %d files", evicted)
        return evicted

    def search_codebase(self, query: str, scope: str | None = None, max_results: int = 20) -> dict:
        """Search across the shadow store and file system for a pattern.
        
        Per doc Section 2.3 search_codebase:
        - Returns matches with path, line, context_before, context_after.
        - Files not yet in the shadow store are loaded temporarily for searching,
          then evicted unless they contain matches.
        - Matched files remain in the shadow store for future access.
        
        Args:
            query: Text or regex pattern to search for.
            scope: Optional directory scope.
            max_results: Maximum matches to return.
            
        Returns:
            dict with matches list and total_matches count.
        """
        import re as _re
        
        matches = []
        seen_files: set[str] = set()
        search_paths: list[str] = []
        
        # Search shadow store first
        try:
            scope_prefix = str(Path(scope).resolve()) + "/" if scope else None
        except Exception:
            scope_prefix = None
        for shadow in self._store.values():
            if scope_prefix and not shadow.path.startswith(scope_prefix):
                continue
            seen_files.add(shadow.path)
            for lineno, line in enumerate(shadow.content.splitlines(), 1):
                if query in line or _re.search(query, line, _re.IGNORECASE):
                    before = shadow.content.splitlines()[max(0, lineno-3):lineno-1]
                    after = shadow.content.splitlines()[lineno:lineno+2]
                    matches.append({
                        "path": shadow.path,
                        "line": lineno,
                        "context": line.strip(),
                        "context_before": "\n".join(b.strip() for b in before[-2:]),
                        "context_after": "\n".join(a.strip() for a in after[:2]),
                    })
                    if len(matches) >= max_results:
                        break
            if len(matches) >= max_results:
                break
        
        # Search filesystem for non-loaded files if needed
        if len(matches) < max_results:
            search_root = Path(scope) if scope else Path.cwd()
            try:
                for fpath in search_root.rglob("*"):
                    if not fpath.is_file():
                        continue
                    resolved = str(fpath.resolve())
                    if resolved in seen_files:
                        continue
                    try:
                        if fpath.stat().st_size > 1_000_000:  # skip >1MB
                            continue
                        content = fpath.read_text(encoding="utf-8", errors="replace")
                    except Exception:
                        continue
                    has_match = False
                    for lineno, line in enumerate(content.splitlines(), 1):
                        if query in line or _re.search(query, line, _re.IGNORECASE):
                            before = content.splitlines()[max(0, lineno-3):lineno-1]
                            after = content.splitlines()[lineno:lineno+2]
                            matches.append({
                                "path": resolved,
                                "line": lineno,
                                "context": line.strip(),
                                "context_before": "\n".join(b.strip() for b in before[-2:]),
                                "context_after": "\n".join(a.strip() for a in after[:2]),
                            })
                            has_match = True
                            if len(matches) >= max_results:
                                break
                    # Only keep matched files in shadow store
                    if has_match and resolved not in self._store:
                        file_hash = _compute_hash(content)
                        tokens = estimate_text_tokens(content)
                        self._ensure_budget(tokens)
                        self._store[resolved] = ShadowFile(
                            path=resolved,
                            hash=file_hash,
                            content=content,
                            last_access=datetime.now(timezone.utc),
                            dirty=False,
                        )
                        self._total_tokens += tokens
                    if len(matches) >= max_results:
                        break
            except Exception:
                pass
        
        return {
            "matches": matches[:max_results],
            "total_matches": len(matches),
        }

    def get_stats(self) -> dict[str, Any]:
        """Return current VFS statistics for the Dynamic Status Line.

        Per doc Section 6.1.

        Returns:
            dict with file_count, total_tokens, dirty_count, budget, usage_pct.
        """
        file_count = len(self._store)
        dirty_count = sum(1 for s in self._store.values() if s.dirty)
        return {
            "file_count": file_count,
            "total_tokens": self._total_tokens,
            "dirty_count": dirty_count,
            "budget": self._token_budget,
            "usage_pct": round(self._total_tokens / self._token_budget * 100, 1) if self._token_budget > 0 else 0,
        }

    def clear(self) -> None:
        """Clear the entire shadow store (session end)."""
        self._store.clear()
        self._total_tokens = 0
        LOGGER.debug("VFS: Cleared")

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _resolve_path(self, path: str) -> str | None:
        """Resolve a potentially relative path to an absolute path."""
        if not path or not str(path or "").strip():
            return None
        path = str(path).strip()

        # If already absolute and exists, use it
        p = Path(path)
        if p.is_absolute():
            return str(p.resolve()) if p.exists() else None

        # Try resolving relative to cwd
        abs_p = Path.cwd() / path
        if abs_p.exists():
            return str(abs_p.resolve())

        # Try resolving relative to project root (grandparent of utils/)
        project_root = Path(__file__).resolve().parent.parent
        project_p = project_root / path
        if project_p.exists():
            return str(project_p.resolve())

        return None

    def _ensure_budget(self, needed_tokens: int) -> None:
        """Evict files if adding ``needed_tokens`` would exceed budget."""
        if needed_tokens <= 0:
            return
        projected = self._total_tokens + needed_tokens
        while projected > self._token_budget:
            evicted = self.evict_lru(1)
            if evicted == 0:
                # All remaining files are dirty — cannot evict further
                LOGGER.warning("VFS: Budget exceeded but all remaining files are dirty")
                break
            projected = self._total_tokens + needed_tokens

    @staticmethod
    def _map_normalized_index(original: str, normalized: str, norm_idx: int) -> int | None:
        """Map an index in whitespace-normalized text back to original text."""
        # Walk both strings in parallel counting non-whitespace characters
        orig_idx = 0
        norm_pos = 0
        for orig_char in original:
            if norm_pos >= norm_idx:
                return orig_idx
            if orig_char.isspace():
                if norm_pos < len(normalized) and normalized[norm_pos].isspace():
                    norm_pos += 1
                orig_idx += 1
            else:
                if norm_pos < len(normalized) and orig_char == normalized[norm_pos]:
                    norm_pos += 1
                orig_idx += 1
        return None


# Singleton
_vfs: ShadowFileSystem | None = None


def get_vfs(token_budget: int = DEFAULT_VFS_TOKEN_BUDGET) -> ShadowFileSystem:
    """Get or create the singleton VFS instance."""
    global _vfs
    if _vfs is None:
        _vfs = ShadowFileSystem(token_budget=token_budget)
    return _vfs


def reset_vfs() -> None:
    """Reset the singleton (for testing)."""
    global _vfs
    if _vfs is not None:
        _vfs.clear()
    _vfs = None
