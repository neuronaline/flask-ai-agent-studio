"""
Context Node Service - Memory management system for tool outputs.

Per AI Memory and Context Management document:
- Tool outcomes are TRANSIENT by default - they do NOT survive the cycle unless explicitly promoted
- Context Nodes are only created when AI explicitly sets keep_alive: true
- This service handles:
  - Adding new context nodes (only when explicitly promoted)
  - Tracking token usage
  - Pre-execution cost estimation (including VFS)
  - Compaction (tombstone cleanup)
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
    get_tombstone_count as db_get_tombstone_count,
    hard_delete_tombstoned_nodes as db_hard_delete_tombstoned_nodes,
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
_MAX_TRANSIENT_BUFFER_SIZE = 200
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
    COMPACTION_TOMBSTONE_THRESHOLD = 5  # Section 6.3

    def __init__(self, model_token_limit: int = DEFAULT_MODEL_TOKEN_LIMIT):
        self.model_token_limit = model_token_limit

    # ------------------------------------------------------------------
    # Pre-execution cost check (Section 6.2)
    # ------------------------------------------------------------------

    def check_execution_cost(
        self,
        tool_name: str,
        args: dict,
        conversation_id: int,
    ) -> ExecutionWarning | None:
        """Check if tool execution would exceed token thresholds.

        Per AI Memory and Context Management document Section 6.2:
        - If current_usage + estimated_cost > 90% of total limit,
          the operation is rejected outright.
        - The AI receives a structured warning with the recommended action.
        - Includes VFS token usage in the calculation.
        """
        # Estimate cost of this execution
        args_preview = self._create_args_preview(args)
        estimated_tokens = estimate_text_tokens(args_preview)

        # Get current stats (context nodes)
        stats = self.get_stats(conversation_id)

        # Also account for VFS token usage
        try:
            from utils.vfs import get_vfs
            vfs_stats = get_vfs().get_stats()
            vfs_tokens = vfs_stats.get("total_tokens", 0)
        except Exception:
            vfs_tokens = 0

        total_current = stats.active_tokens + vfs_tokens
        projected_tokens = total_current + estimated_tokens
        projected_percent = projected_tokens / stats.model_limit if stats.model_limit > 0 else 0

        if projected_percent >= self.BLOCK_THRESHOLD:
            message = (
                f"**System Warning:** The requested action is estimated to consume ~{estimated_tokens:,} tokens, "
                f"which would breach the 90% safety threshold. Operation denied.\n"
                f"**Recommended action:** Run `purge_context_nodes` to free space, narrow the query scope, "
                f"or summarise existing data before retry."
            )
            return ExecutionWarning(
                tool_name=tool_name,
                estimated_tokens=estimated_tokens,
                current_tokens=total_current,
                projected_tokens=projected_tokens,
                threshold_percent=round(projected_percent * 100, 1),
                message=message,
            )

        return None

    # ------------------------------------------------------------------
    # Transient buffer management
    # ------------------------------------------------------------------

    def add_transient(
        self,
        tool_name: str,
        args: dict,
        result: Any,
        conversation_id: int,
        message_id: int | None = None,
    ) -> str:
        """Store tool result as TRANSIENT (not persisted).

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
        # Evict oldest entries if buffer exceeds max size
        if len(_TRANSIENT_BUFFER) >= _MAX_TRANSIENT_BUFFER_SIZE:
            overflow = len(_TRANSIENT_BUFFER) - _MAX_TRANSIENT_BUFFER_SIZE + 1
            oldest_keys = sorted(_TRANSIENT_BUFFER, key=lambda k: _TRANSIENT_BUFFER[k].get("created_at", ""))[:overflow]
            for key in oldest_keys:
                _TRANSIENT_BUFFER.pop(key, None)

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
        """Promote transient data to a persistent Context Node.

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
        """Discard transient data without promoting it.

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
        """Generate a fact-dense summary capped at ~50 tokens.

        Per AI Memory doc Section 4: summaries must answer
        "If this is the only node I can read, what key facts must I know?"
        and be ≤ 50 tokens.
        """
        content = (result_preview or full_content or "").strip()
        if not content:
            return ""

        # Progressive truncation: keep as much meaning as fits in ~50 tokens
        # ~50 tokens ≈ 200 chars (rough 4 chars/token average)
        max_chars = 200

        if len(content) <= max_chars:
            return content

        # Try to cut at a sentence boundary
        truncated = content[:max_chars]
        last_period = truncated.rfind(". ")
        last_comma = truncated.rfind(", ")
        cut_point = max(last_period, last_comma)

        if cut_point > max_chars // 2:
            suffix = truncated[:cut_point + 1].rstrip()
            # Avoid ending with a trailing comma — clean it up
            if suffix.endswith(","):
                suffix = suffix.rstrip(",").rstrip()
            return suffix

        return truncated[:197] + "..."

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
        """Create a new context node from tool execution result.

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
            Created node dict if keep_alive=True, None otherwise.
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
        """Create preview and full content from result.

        Returns:
            Tuple of (preview, full_content)
        """
        if result is None:
            return "", None

        try:
            if isinstance(result, (dict, list)):
                content = json.dumps(result, ensure_ascii=False, sort_keys=True)
            else:
                content = str(result)

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
        """Purge nodes (soft delete - tombestone).

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
        """Update an existing context node.

        Used by compress_context_node to update the payload after compression.
        """
        return update_context_node(
            node_id=node_id,
            full_content=full_content,
            token_count=token_count,
            summary=summary,
            compressed=compressed,
        )

    def generate_status_report(self, conversation_id: int) -> str:
        """Generate a human-readable token status report.

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

    # ------------------------------------------------------------------
    # Compaction event trigger (Section 6.3)
    # ------------------------------------------------------------------

    def trigger_compaction_if_needed(self, conversation_id: int) -> dict:
        """Check if compaction should fire and physically clean tombstoned nodes.

        Per AI Memory doc Section 6.3:
        - Compaction triggers when tombstone count > 5 OR token usage ≥ 90%.
        - This is a controlled cache-break: tombstoned rows are hard-deleted.

        Returns:
            Dict with triggered (bool), tombstones_deleted, tokens_before,
            tokens_after, and reason.
        """
        tombstone_count = db_get_tombstone_count(conversation_id)
        stats = self.get_stats(conversation_id)
        usage_pct = stats.usage_percent

        triggered = tombstone_count > self.COMPACTION_TOMBSTONE_THRESHOLD or usage_pct >= BLOCK_THRESHOLD
        reason = []
        if tombstone_count > self.COMPACTION_TOMBSTONE_THRESHOLD:
            reason.append(f"tombstone_count={tombstone_count} > {self.COMPACTION_TOMBSTONE_THRESHOLD}")
        if usage_pct >= BLOCK_THRESHOLD:
            reason.append(f"token_usage={usage_pct * 100:.1f}% >= {BLOCK_THRESHOLD * 100:.0f}%")

        if not triggered:
            LOGGER.debug(
                f"Compaction not needed for conversation {conversation_id}: "
                f"tombstones={tombstone_count}, usage={usage_pct * 100:.1f}%"
            )
            return {
                "triggered": False,
                "tombstones_deleted": 0,
                "tokens_before": stats.active_tokens,
                "tokens_after": stats.active_tokens,
                "reason": None,
            }

        # Hard-delete all tombstoned nodes
        deleted_count = db_hard_delete_tombstoned_nodes(conversation_id)

        # Re-read stats after deletion
        stats_after = self.get_stats(conversation_id)
        reason_str = "; ".join(reason)
        LOGGER.info(
            f"Compaction executed for conversation {conversation_id}: "
            f"deleted {deleted_count} tombstoned nodes, "
            f"tokens {stats.active_tokens} -> {stats_after.active_tokens}, "
            f"reason: {reason_str}"
        )

        return {
            "triggered": True,
            "tombstones_deleted": deleted_count,
            "tokens_before": stats.active_tokens,
            "tokens_after": stats_after.active_tokens,
            "reason": reason_str,
        }

    # ------------------------------------------------------------------
    # Goal-driven eviction (Section 8.1)
    # ------------------------------------------------------------------

    def evict_irrelevant_nodes(
        self,
        conversation_id: int,
        current_goal_tools: list[str],
    ) -> dict:
        """Evict nodes unrelated to the current task's tool usage.

        Per AI Memory doc Section 8.1, priority order:
        1. Goal Alignment — nodes whose tool_name is NOT in current_goal_tools
        2. Recency of Access — oldest last_accessed first
        3. Dependency Links — nodes with no dependents evicted first
        4. VFS Staleness — nodes with stale VFS references evicted first

        Stops once recovered tokens bring usage below 90%.

        Returns:
            Dict with evicted_count, tokens_recovered, usage_before, usage_after.
        """
        if not current_goal_tools:
            return {
                "evicted_count": 0,
                "tokens_recovered": 0,
                "usage_before": 0.0,
                "usage_after": 0.0,
            }

        goal_tools_set = set(current_goal_tools)
        stats = self.get_stats(conversation_id)
        usage_before = stats.usage_percent

        # Already below threshold
        if usage_before < BLOCK_THRESHOLD:
            return {
                "evicted_count": 0,
                "tokens_recovered": 0,
                "usage_before": round(usage_before * 100, 1),
                "usage_after": round(usage_before * 100, 1),
            }

        # Get all active nodes for this conversation, sorted by token_count desc
        active_nodes = db_list_context_nodes(
            conversation_id=conversation_id,
            status="active",
            limit=500,
            sort_by="token_count",
        )

        # Partition: goal-aligned vs non-aligned
        non_aligned = [
            n for n in active_nodes
            if n.get("tool_name", "") not in goal_tools_set
        ]
        aligned = [
            n for n in active_nodes
            if n.get("tool_name", "") in goal_tools_set
        ]

        # Sort non-aligned by recency (oldest first), then by token count (largest first)
        non_aligned.sort(key=lambda n: (n.get("created_at", ""), -n.get("token_count", 0)))

        target_recovery = stats.active_tokens - int(stats.model_limit * BLOCK_THRESHOLD)
        if target_recovery <= 0:
            target_recovery = stats.active_tokens  # try to recover everything we can

        evicted_ids: list[str] = []
        tokens_recovered = 0

        for node in non_aligned:
            if tokens_recovered >= target_recovery:
                break
            evicted_ids.append(node["node_id"])
            tokens_recovered += node.get("token_count", 0)

        if evicted_ids:
            db_archive_context_nodes(evicted_ids, "goal-driven eviction (Section 8.1)")

        stats_after = self.get_stats(conversation_id)
        LOGGER.info(
            f"Goal-driven eviction for conversation {conversation_id}: "
            f"evicted {len(evicted_ids)} non-aligned nodes, "
            f"recovered ~{tokens_recovered} tokens, "
            f"usage {usage_before * 100:.1f}% -> {stats_after.usage_percent * 100:.1f}%"
        )

        return {
            "evicted_count": len(evicted_ids),
            "tokens_recovered": tokens_recovered,
            "usage_before": round(usage_before * 100, 1),
            "usage_after": round(stats_after.usage_percent * 100, 1),
        }

    # ------------------------------------------------------------------
    # Purge with extraction (Section 5.3)
    # ------------------------------------------------------------------

    def purge_with_extraction(
        self,
        conversation_id: int,
        node_ids: list[str],
        reason: str,
    ) -> dict:
        """Purge nodes, extracting goal-critical content first if needed.

        Per AI Memory doc Section 5.3:
        - Before purging, check if any nodes contain goal-critical data.
        - If so, extract key content into a new summary node (max 50 tokens).
        - Then purge the originals.

        Returns:
            Dict with extracted_node (if any) and purge_result.
        """
        extracted_node = None

        # Read the nodes before purging to check for critical data
        nodes_to_check: list[dict] = []
        for nid in node_ids:
            node = db_get_context_node(nid)
            if node:
                nodes_to_check.append(node)

        # Check if any node has content worth extracting
        # Heuristic: if summary or full_content exists and node is large,
        # it likely contains goal-critical data worth preserving
        for node in nodes_to_check:
            summary = (node.get("summary") or "").strip()
            full_content = (node.get("full_content") or "").strip()
            token_count = node.get("token_count", 0)

            # If the node has a meaningful summary or substantial content,
            # extract the summary as a preserved node
            if summary and token_count > 100:
                extracted_summary = self._generate_summary(summary, full_content)

                # Create a lightweight extraction node
                extraction_node_id = str(uuid.uuid4())
                extraction_tokens = estimate_text_tokens(extracted_summary)

                try:
                    extracted_node = db_insert_context_node(
                        node_id=extraction_node_id,
                        tool_name=node.get("tool_name", ""),
                        args_preview=None,
                        result_preview=extracted_summary[:1000],
                        full_content=extracted_summary,
                        token_count=extraction_tokens,
                        conversation_id=conversation_id,
                        message_id=None,
                    )
                    LOGGER.info(
                        f"Extracted goal-critical summary from node {node['node_id']} "
                        f"into {extraction_node_id} ({extraction_tokens} tokens)"
                    )
                except Exception:
                    LOGGER.exception(f"Failed to extract summary from node {node['node_id']}")
                    extracted_node = None
                # Only extract from the first qualifying node
                break

        # Purge the original nodes
        purge_result = db_purge_context_nodes(node_ids, reason)

        return {
            "extracted_node": extracted_node,
            "purge_result": purge_result,
        }


# Singleton instance
_context_node_service: ContextNodeService | None = None


def get_context_node_service(model_token_limit: int = DEFAULT_MODEL_TOKEN_LIMIT) -> ContextNodeService:
    """Get or create the singleton ContextNodeService instance."""
    global _context_node_service
    if _context_node_service is None:
        _context_node_service = ContextNodeService(model_token_limit=model_token_limit)
    return _context_node_service
