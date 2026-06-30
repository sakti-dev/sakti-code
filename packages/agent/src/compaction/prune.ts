import type { AgentMessage } from "../types";

/**
 * # Pre-compaction prune
 *
 * Elides large stale tool-result content before paying for a compaction
 * summarizer call. Tool output is re-derivable (re-read the file, re-run the
 * command); the summarizer costs a network round-trip and tokens, so replacing
 * old large tool results with a short placeholder shrinks the summarizer input
 * for free. Mirrors Reasonix's `prune.go` (≥1024-byte threshold + `[elided
 * tool result — …]` marker).
 *
 * Pure: operates on a message array and returns a new array (or the same
 * reference when nothing changed). The session store stays append-only —
 * pruning affects only the messages handed to the summarizer, not the stored
 * entries.
 *
 * @see docs/plans/2026-06-28-reasonix-cache-followups.md (§13)
 */

const PRUNED_MARKER = "[elided tool result — ";
export const DEFAULT_MIN_PRUNE_BYTES = 1024;

export interface PruneOptions {
  /**
   * Minimum content bytes for a tool result to be considered for pruning.
   * Default {@link DEFAULT_MIN_PRUNE_BYTES} (1024).
   */
  minPruneBytes?: number;
  /**
   * Messages from this index onward are protected (the "tail"). Tool results
   * before this index are candidates for elision; at or after it are kept
   * verbatim.
   */
  tailStartIndex: number;
}

export interface PruneStats {
  /** Number of tool results elided. */
  results: number;
  /** Characters saved (original content length − placeholder length). */
  savedChars: number;
}

interface ToolResultLike {
  content?: unknown;
  isError?: boolean;
  toolName?: string;
}

/**
 * Elide stale tool-result content older than the recent tail.
 *
 * - Only `role: "toolResult"` messages are touched (roles/order/IDs unchanged).
 * - Content ≥ `minPruneBytes` (default 1024) is replaced with a placeholder.
 * - Error results (`isError: true`) are kept verbatim — they're not re-derivable.
 * - Already-elided results are skipped (idempotency).
 * - Tail messages (index ≥ `tailStartIndex`) are never touched.
 *
 * @returns `{ pruned, stats }`. When nothing changed, `pruned === messages`
 *   (same reference) so callers can cheaply skip downstream effects.
 */
export function pruneStaleToolResults(
  messages: AgentMessage[],
  options: PruneOptions,
): { pruned: AgentMessage[]; stats: PruneStats } {
  const minPruneBytes = options.minPruneBytes ?? DEFAULT_MIN_PRUNE_BYTES;
  const stats: PruneStats = { results: 0, savedChars: 0 };

  if (messages.length === 0) {
    return { pruned: messages, stats };
  }

  let modified = false;
  const result = [...messages];
  const cutoff = Math.min(options.tailStartIndex, result.length);

  for (let i = 0; i < cutoff; i++) {
    const msg = result[i] as AgentMessage | undefined;
    if (msg === undefined || msg.role !== "toolResult") {
      continue;
    }

    const like = msg as unknown as ToolResultLike;
    if (like.isError === true) {
      continue;
    }

    const contentText = extractTextContent(like.content);
    if (contentText.length < minPruneBytes) {
      continue;
    }
    if (contentText.startsWith(PRUNED_MARKER)) {
      continue;
    }

    const toolName = like.toolName ?? "unknown";
    const placeholder = `${PRUNED_MARKER}${toolName}, ${contentText.length} bytes dropped to save context; re-run the tool if the data is needed again]`;
    stats.savedChars += contentText.length - placeholder.length;
    stats.results++;

    result[i] = {
      ...msg,
      content: [{ type: "text", text: placeholder }],
    } as AgentMessage;
    modified = true;
  }

  return { pruned: modified ? result : messages, stats };
}

/** Concatenate all text content from a toolResult content field. */
function extractTextContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    let out = "";
    for (const part of content) {
      if (
        typeof part === "object" &&
        part !== null &&
        (part as { type?: string }).type === "text" &&
        typeof (part as { text?: unknown }).text === "string"
      ) {
        out += (part as { text: string }).text;
      }
    }
    return out;
  }
  return "";
}

/**
 * Decide whether pruning alone clears the compaction threshold, letting the
 * caller skip the summarizer LLM call (§13 "free win").
 *
 * Uses the same `chars / 4` token heuristic as {@link estimateTokens}. When
 * the estimated post-prune token count is at or under
 * `contextWindow - reserveTokens`, the pruned conversation is short enough to
 * keep verbatim (with elided tool output) — serializing it is cheaper than a
 * summary and preserves full conversational flow.
 *
 * @returns `false` when the context window is unknown (0) or pruning saved
 *   nothing, so the caller always falls back to the summarizer.
 */
export function canSkipSummarizer(input: {
  tokensBefore: number;
  pruneStats: PruneStats;
  contextWindow: number;
  reserveTokens: number;
}): boolean {
  if (input.contextWindow <= 0) {
    return false;
  }
  if (input.pruneStats.results === 0) {
    return false;
  }
  const estimatedPruneTokensSaved = Math.ceil(input.pruneStats.savedChars / 4);
  const projectedTokens = input.tokensBefore - estimatedPruneTokensSaved;
  const threshold = input.contextWindow - input.reserveTokens;
  return projectedTokens <= threshold;
}
