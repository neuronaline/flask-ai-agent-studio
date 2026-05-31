"""
Context Node Service - Memory management system for tool outputs.

Per AI Memory and Context Management document:
- Tool outcomes are TRANSIENT by default - they do NOT survive the cycle unless explicitly promoted
- Context Nodes are only created when AI explicitly sets keep_alive: true
- This service handles:
  - Adding new context nodes (only when explicitly promoted)
  - Tracking token usage
  - Pre-execution cost estimation
  - Runtime stats reporting
"""

from __future__ import annotations

import json
import logging
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from utils.token_utils import estimate_text_tokens

from core.db import (
    archive_context_nodes as db_archive_context_nodes,
    get_context_node as db_get_context_node,
    get_context_node_stats as db_get_context_node_stats,
    insert_context_node as db_insert_context_node,
    list_context_nodes as db_list_context_nodes,
    list_context_summary,
    merge_context_nodes,
    purge_context_nodes as db_purge_context_nodes,
    update_context_node,
)

LOGGER = logging.getLogger(__name__)

# Hardcoded thresholds (not configurable per decisions)
WARN_THRESHOLD = 0.70  # 70% → warning
BLOCK_THRESHOLD = 0.90  # 90% → block
MAX_NODE_TOKENS = 50_000
DEFAULT_MODEL_TOKEN_LIMIT = 128_000

# Transient buffer - tool results are stored here temporarily and NOT persisted
# unless explicitly promoted by AI with keep_alive: true
_TRANSIENT_BUFFER: dict[str, dict] = {}


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
    """Service for managing context nodes.

    Per AI Memory and Context Management document:
    - Tool outcomes are TRANSIENT by default (stored in scratchpad buffer, not persisted)
    - Context Nodes are only created when AI explicitly promotes transient data with keep_alive: true
    - This follows the "Transient (Working) Memory" pattern where raw payloads are discarded
      after analysis unless explicitly preserved
    """

    WARN_THRESHOLD = WARN_THRESHOLD
    BLOCK_THRESHOLD = BLOCK_THRESHOLD
    MAX_NODE_TOKENS = MAX_NODE_TOKENS

    def __init__(self, model_token_limit: int = DEFAULT_MODEL_TOKEN_LIMIT):
        self.model_token_limit = model_token_limit

    def add_transient(
        self,
        tool_name: str,
        args: dict,
        result: Any,
        conversation_id: int,
        message_id: int | None = None,
    ) -> str:
        """
        Store tool result as TRANSIENT (not persisted).

        Per AI Memory and Context Management document:
        - "All tool outcomes are tagged transient by default"
        - "the system treats this buffer as a scratchpad"
        - "By default, nothing survives the cycle unless the AI explicitly promotes it"

        Args:
            tool_name: Name of the executed tool
            args: Tool arguments
            result: Tool execution result
            conversation_id: Conversation ID
            message_id: Optional message ID

        Returns:
            transient_id that can be used to promote this data later
        """
        transient_id = str(uuid.uuid4())

        # Create preview and content
        args_preview = self._create_args_preview(args)
        result_preview, full_content = self._create_result_preview(result)

        # Estimate tokens
        token_count = estimate_text_tokens(full_content) if full_content else 0

        # Enforce max node tokens
        if token_count > self.MAX_NODE_TOKENS:
            LOGGER.warning(
                f"Transient data token count {token_count} exceeds max {self.MAX_NODE_TOKENS}, truncating"
            )
            full_content = (full_content or "")[: self.MAX_NODE_TOKENS * 4]  # rough char estimate
            token_count = self.MAX_NODE_TOKENS

        # Store in transient buffer - NOT persisted
        _TRANSIENT_BUFFER[transient_id] = {
            "transient_id": transient_id,
            "tool_name": tool_name,
            "args": args,
            "args_preview": args_preview,
            "result": result,
            "result_preview": result_preview,
            "full_content": full_content,
            "token_count": token_count,
            "conversation_id": conversation_id,
            "message_id": message_id,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }

        LOGGER.debug(
            f"Stored transient tool result for {tool_name}, transient_id={transient_id}, tokens={token_count}"
        )
        return transient_id

    def promote_to_node(
        self,
        transient_id: str,
        summary: str | None = None,
    ) -> dict | None:
        """
        Promote transient data to a persistent Context Node.

        Per AI Memory and Context Management document:
        - "A context node is created only when the AI sets a flag such as keep_alive: true"
        - The AI must explicitly decide to persist data for long-term value

        Args:
            transient_id: ID returned from add_transient
            summary: Optional AI-generated summary (< 50 tokens recommended per doc)

        Returns:
            Created node dict or None if promotion failed
        """
        if transient_id not in _TRANSIENT_BUFFER:
            LOGGER.warning(f"Transient ID {transient_id} not found in buffer")
            return None

        transient_data = _TRANSIENT_BUFFER.pop(transient_id)
        node_id = str(uuid.uuid4())

        # Generate summary if not provided (compress the content)
        if not summary:
            summary = self._generate_summary(
                transient_data.get("result_preview", ""),
                transient_data.get("full_content", "")
            )

        # Create payload from full_content
        payload = transient_data.get("full_content", "")

        try:
            # Note: db_insert_context_node signature may need updating to match doc schema
            # Doc specifies: node_id, tool_name, timestamp, token_count, summary, payload, status
            return db_insert_context_node(
                node_id=node_id,
                tool_name=transient_data.get("tool_name", ""),
                args_preview=transient_data.get("args_preview"),
                result_preview=transient_data.get("result_preview"),
                full_content=payload,
                token_count=transient_data.get("token_count", 0),
                conversation_id=transient_data.get("conversation_id"),
                message_id=transient_data.get("message_id"),
            )
        except Exception:
            LOGGER.exception(f"Failed to promote transient data to context node")
            # Restore to transient buffer on failure
            _TRANSIENT_BUFFER[transient_id] = transient_data
            return None

    def discard_transient(self, transient_id: str) -> bool:
        """
        Discard transient data without promoting it.

        Per AI Memory and Context Management document:
        - "the raw payload is immediately discarded once the derived insight has been captured"

        Args:
            transient_id: ID returned from add_transient

        Returns:
            True if discarded, False if not found
        """
        if transient_id in _TRANSIENT_BUFFER:
            del _TRANSIENT_BUFFER[transient_id]
            LOGGER.debug(f"Discarded transient data {transient_id}")
            return True
        return False

    def _generate_summary(self, result_preview: str, full_content: str) -> str:
        """Generate a concise summary (per doc: < 50 tokens recommended)."""
        # Simple truncation-based summary for now
        # In production, could use a separate LLM call for better summarization
        content = result_preview or full_content
        if len(content) <= 200:
            return content
        return content[:197] + "..."

    def get_transient(self, transient_id: str) -> dict | None:
        """Get transient data by ID."""
        return _TRANSIENT_BUFFER.get(transient_id)

    def add_node(
        self,
        tool_name: str,
        args: dict,
        result: Any,
        conversation_id: int,
        message_id: int | None = None,
        keep_alive: bool = False,
    ) -> dict | None:
        """
        Create a new context node from tool execution result.

        Per AI Memory and Context Management document:
        - Tool outcomes are TRANSIENT by default
        - Context Nodes are only created when AI explicitly promotes with keep_alive: true
        - This method implements the full cycle: transient storage + optional promotion

        Args:
            tool_name: Name of the executed tool
            args: Tool arguments
            result: Tool execution result
            conversation_id: Conversation ID
            message_id: Optional message ID
            keep_alive: If True, promote to persistent Context Node. If False, store as transient only.

        Returns:
            Created node dict if keep_alive=True, None otherwise. If keep_alive=False,
            returns None but the transient_id is logged for debugging.
        """
        # First store as transient (this is the default per doc)
        transient_id = self.add_transient(tool_name, args, result, conversation_id, message_id)

        # Per doc: "nothing survives the cycle unless the AI explicitly promotes it"
        if not keep_alive:
            LOGGER.debug(
                f"Tool result stored as transient (not persisted). "
                f"Use promote_to_node('{transient_id}') to persist. "
                f"Tool: {tool_name}, Conversation: {conversation_id}"
            )
            return None

        # AI explicitly promoted - create persistent Context Node
        return self.promote_to_node(transient_id)

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

    def list_summary(
        self,
        conversation_id: int,
        sort_by: str = "created_at",
    ) -> list[dict]:
        """Lightweight overview of context nodes — no full payloads.

        Per AI Memory and Context Management doc Section 2.1:
        Returns node_id, summary, token_count, timestamp.

        Args:
            conversation_id: Conversation to query.
            sort_by: 'created_at' or 'token_count'.

        Returns:
            List of lightweight node summaries.
        """
        return list_context_summary(
            conversation_id=conversation_id,
            sort_by=sort_by,
        )

    def merge_nodes(
        self,
        conversation_id: int,
        node_ids: list[str],
        new_summary: str,
    ) -> dict | None:
        """Merge multiple related context nodes into one.

        Per AI Memory and Context Management doc Section 2.3.

        Args:
            conversation_id: Conversation ID.
            node_ids: List of node UUIDs to merge.
            new_summary: Condensed summary (max ~50 tokens).

        Returns:
            New merged node dict or None.
        """
        return merge_context_nodes(
            conversation_id=conversation_id,
            node_ids=node_ids,
            new_summary=new_summary,
        )

    def update_node(
        self,
        node_id: str,
        *,
        full_content: str | None = None,
        token_count: int | None = None,
        summary: str | None = None,
        compressed: bool | None = None,
    ) -> dict | None:
        """Update an existing context node's content, token_count, summary, or compressed flag.

        Used by compress_context_node to update the payload after compression.

        Args:
            node_id: UUID of the node.
            full_content: Optional new content.
            token_count: Optional new token count.
            summary: Optional new summary.
            compressed: Optional compressed flag.

        Returns:
            Updated node dict or None.
        """
        return update_context_node(
            node_id=node_id,
            full_content=full_content,
            token_count=token_count,
            summary=summary,
            compressed=compressed,
        )

    def check_execution_cost(
        self,
        tool_name: str,
        args: dict,
        conversation_id: int,
    ) -> ExecutionWarning | None:
        """
        Check if tool execution would exceed token thresholds.

        Per AI Memory and Context Management document:
        - "If current_usage + estimated_cost > 90% of total limit, the operation is rejected outright"
        - "The AI receives a structured warning with the recommended action"

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
            # Per doc format:
            # "> **System Warning:** The requested action is estimated to consume ~[X] tokens,
            #    which would breach the 90% safety threshold. Operation denied.
            #    > **Recommended action:** Run `purge_context_nodes` to free space..."
            message = (
                f"**System Warning:** The requested action is estimated to consume ~{estimated_tokens:,} tokens, "
                f"which would breach the 90% safety threshold. Operation denied.\n"
                f"**Recommended action:** Run `purge_context_nodes` to free space, narrow the query scope, "
                f"or summarise existing data before retry."
            )
            return ExecutionWarning(
                tool_name=tool_name,
                estimated_tokens=estimated_tokens,
                current_tokens=stats.active_tokens,
                projected_tokens=projected_tokens,
                threshold_percent=round(projected_percent * 100, 1),
                message=message,
            )

        return None

    def generate_status_report(self, conversation_id: int) -> str:
        """
        Generate a human-readable token status report.

        Per AI Memory and Context Management document:
        - "Every processing cycle receives an up-to-date telemetry line"
        - Format: **Status:** Token Usage: 42,100 / 128,000 (32%) | Buffer Free: 85,900 tokens.

        This is included in runtime volatile parts for AI to see memory status.
        """
        stats = self.get_stats(conversation_id)

        # Per doc format: "**Status:** Token Usage: 42,100 / 128,000 (32%) | Buffer Free: 85,900 tokens."
        status_line = (
            f"**Status:** Token Usage: {stats.active_tokens:,} / {stats.model_limit:,} "
            f"({stats.usage_percent * 100:.1f}%) | Buffer Free: "
            f"{max(0, stats.model_limit - stats.active_tokens):,} tokens."
        )

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