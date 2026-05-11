"""
Context Node Service - Memory management system for tool outputs.

Every tool output is stored as a 'Context Node'. This service handles:
- Adding new context nodes
- Tracking token usage
- Pre-execution cost estimation
- Runtime stats reporting
"""

from __future__ import annotations

import json
import logging
import uuid
from dataclasses import dataclass, field
from typing import Any

from utils.token_utils import estimate_text_tokens

from core.db import (
    archive_context_nodes as db_archive_context_nodes,
    get_context_node as db_get_context_node,
    get_context_node_stats as db_get_context_node_stats,
    insert_context_node as db_insert_context_node,
    list_context_nodes as db_list_context_nodes,
    purge_context_nodes as db_purge_context_nodes,
)

LOGGER = logging.getLogger(__name__)

# Hardcoded thresholds (not configurable per decisions)
WARN_THRESHOLD = 0.70  # 70% → warning
BLOCK_THRESHOLD = 0.90  # 90% → block
MAX_NODE_TOKENS = 50_000
DEFAULT_MODEL_TOKEN_LIMIT = 128_000


@dataclass
class RuntimeStats:
    """Token usage statistics for runtime."""
    total_nodes: int = 0
    active_nodes: int = 0
    archived_nodes: int = 0
    total_tokens: int = 0
    active_tokens: int = 0
    model_limit: int = DEFAULT_MODEL_TOKEN_LIMIT

    @property
    def usage_percent(self) -> float:
        if self.model_limit <= 0:
            return 0.0
        return self.active_tokens / self.model_limit

    @property
    def is_warn_level(self) -> bool:
        return self.usage_percent >= WARN_THRESHOLD

    @property
    def is_block_level(self) -> bool:
        return self.usage_percent >= BLOCK_THRESHOLD

    def to_dict(self) -> dict:
        return {
            "total_nodes": self.total_nodes,
            "active_nodes": self.active_nodes,
            "archived_nodes": self.archived_nodes,
            "total_tokens": self.total_tokens,
            "active_tokens": self.active_tokens,
            "model_limit": self.model_limit,
            "usage_percent": round(self.usage_percent * 100, 1),
            "is_warn_level": self.is_warn_level,
            "is_block_level": self.is_block_level,
        }


@dataclass
class ExecutionWarning:
    """Warning when tool execution would exceed thresholds."""
    tool_name: str
    estimated_tokens: int
    current_tokens: int
    projected_tokens: int
    threshold_percent: float
    message: str


class ContextNodeService:
    """Service for managing context nodes."""

    WARN_THRESHOLD = WARN_THRESHOLD
    BLOCK_THRESHOLD = BLOCK_THRESHOLD
    MAX_NODE_TOKENS = MAX_NODE_TOKENS

    def __init__(self, model_token_limit: int = DEFAULT_MODEL_TOKEN_LIMIT):
        self.model_token_limit = model_token_limit

    def add_node(
        self,
        tool_name: str,
        args: dict,
        result: Any,
        conversation_id: int,
        message_id: int | None = None,
    ) -> dict | None:
        """
        Create a new context node from tool execution result.

        Args:
            tool_name: Name of the executed tool
            args: Tool arguments
            result: Tool execution result
            conversation_id: Conversation ID
            message_id: Optional message ID

        Returns:
            Created node dict or None if creation failed
        """
        node_id = str(uuid.uuid4())

        # Create previews
        args_preview = self._create_args_preview(args)
        result_preview, full_content = self._create_result_preview(result)

        # Estimate tokens
        token_count = estimate_text_tokens(full_content) if full_content else 0

        # Enforce max node tokens
        if token_count > self.MAX_NODE_TOKENS:
            LOGGER.warning(
                f"Context node token count {token_count} exceeds max {self.MAX_NODE_TOKENS}, truncating"
            )
            token_count = self.MAX_NODE_TOKENS

        try:
            return db_insert_context_node(
                node_id=node_id,
                tool_name=tool_name,
                args_preview=args_preview,
                result_preview=result_preview,
                full_content=full_content,
                token_count=token_count,
                conversation_id=conversation_id,
                message_id=message_id,
            )
        except Exception:
            LOGGER.exception(f"Failed to insert context node for tool {tool_name}")
            return None

    def _create_args_preview(self, args: dict) -> str:
        """Create a short preview of tool arguments."""
        if not args:
            return ""
        try:
            args_str = json.dumps(args, ensure_ascii=False, sort_keys=True)
            if len(args_str) > 500:
                args_str = args_str[:497] + "..."
            return args_str
        except Exception:
            return str(args)[:500]

    def _create_result_preview(self, result: Any) -> tuple[str, str | None]:
        """
        Create preview and full content from result.

        Returns:
            Tuple of (preview, full_content)
        """
        if result is None:
            return "", None

        try:
            # Try to serialize as JSON
            if isinstance(result, (dict, list)):
                content = json.dumps(result, ensure_ascii=False, sort_keys=True)
            else:
                content = str(result)

            # Create preview (first 1000 chars)
            preview = content[:1000] if len(content) > 1000 else content

            return preview, content
        except Exception:
            preview = str(result)[:1000]
            return preview, preview

    def get_node(self, node_id: str) -> dict | None:
        """Get a single context node by node_id."""
        return db_get_context_node(node_id)

    def list_nodes(
        self,
        conversation_id: int,
        status: str | None = None,
        tool_name: str | None = None,
        limit: int = 100,
        sort_by: str = "token_count",
    ) -> list[dict]:
        """List context nodes for a conversation."""
        return db_list_context_nodes(
            conversation_id=conversation_id,
            status=status,
            tool_name=tool_name,
            limit=limit,
            sort_by=sort_by,
        )

    def archive_nodes(self, node_ids: list[str], reason: str) -> int:
        """Archive nodes (move to archived status, frees tokens)."""
        return db_archive_context_nodes(node_ids, reason)

    def purge_nodes(self, node_ids: list[str], reason: str) -> dict:
        """
        Purge nodes (soft delete - tombestone).

        Returns dict with purged, archived, not_found counts.
        """
        return db_purge_context_nodes(node_ids, reason)

    def get_stats(self, conversation_id: int) -> RuntimeStats:
        """Get runtime stats for a conversation."""
        stats = db_get_context_node_stats(conversation_id)
        return RuntimeStats(
            total_nodes=stats.get("total_nodes", 0),
            active_nodes=stats.get("active_nodes", 0),
            archived_nodes=stats.get("archived_nodes", 0),
            total_tokens=stats.get("total_tokens", 0),
            active_tokens=stats.get("active_tokens", 0),
            model_limit=self.model_token_limit,
        )

    def check_execution_cost(
        self,
        tool_name: str,
        args: dict,
        conversation_id: int,
    ) -> ExecutionWarning | None:
        """
        Check if tool execution would exceed token thresholds.

        Returns ExecutionWarning if threshold would be exceeded at 90%, None otherwise.
        """
        # Estimate cost of this execution
        args_preview = self._create_args_preview(args)
        estimated_tokens = estimate_text_tokens(args_preview)

        # Get current stats
        stats = self.get_stats(conversation_id)
        projected_tokens = stats.active_tokens + estimated_tokens
        projected_percent = projected_tokens / stats.model_limit if stats.model_limit > 0 else 0

        if projected_percent >= self.BLOCK_THRESHOLD:
            return ExecutionWarning(
                tool_name=tool_name,
                estimated_tokens=estimated_tokens,
                current_tokens=stats.active_tokens,
                projected_tokens=projected_tokens,
                threshold_percent=round(projected_percent * 100, 1),
                message=f"**System Warning:** This operation is estimated to produce ~{estimated_tokens // 1000}k tokens and will exceed your limit. Please clean up memory with `purge_context_nodes` first.",
            )

        return None

    def generate_status_report(self, conversation_id: int) -> str:
        """
        Generate a human-readable token status report.

        This is included in runtime volatile parts for AI to see memory status.
        Format: **Status:** Usage: 42,100 / 128,000 (32%) | Buffer: 85,900 free.
        """
        stats = self.get_stats(conversation_id)

        status_line = f"**Status:** Usage: {stats.active_tokens:,} / {stats.model_limit:,} ({stats.usage_percent * 100:.1f}%) | Buffer: {max(0, stats.model_limit - stats.active_tokens):,} free."

        if stats.is_block_level:
            status_line += "\n\n⚠️ **WARNING**: Token usage is above 90%! Archive or purge nodes before continuing."
        elif stats.is_warn_level:
            status_line += "\n\n💡 **NOTE**: Token usage is above 70%. Consider archiving irrelevant nodes."

        return status_line


# Singleton instance
_context_node_service: ContextNodeService | None = None


def get_context_node_service(model_token_limit: int = DEFAULT_MODEL_TOKEN_LIMIT) -> ContextNodeService:
    """Get or create the singleton ContextNodeService instance."""
    global _context_node_service
    if _context_node_service is None:
        _context_node_service = ContextNodeService(model_token_limit=model_token_limit)
    return _context_node_service