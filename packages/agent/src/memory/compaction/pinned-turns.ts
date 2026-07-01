import type { AgentMessage } from "../../types";
import { estimateTokens } from "./compaction";

/**
 * # Pinned user turns (§5.1)
 *
 * Small user turns in the compaction range are kept verbatim rather than
 * summarized — a user-stated fact or constraint survives every compaction
 * unchanged. Mirrors Reasonix's `pinnableUserTurn` + `partitionFold`
 * (compact.go:376-400).
 *
 * Token estimate uses the same chars/4 heuristic as {@link estimateTokens}.
 */

export const DEFAULT_MAX_PINNED_USER_TOKENS = 1500;

export interface PinnableOptions {
  /** Maximum token estimate for a user turn to be pinnable. Default 1500. */
  maxTokens?: number;
}

/** Whether a message is a small-enough user turn to pin through compaction. */
export function isPinnableUserTurn(message: AgentMessage, options: PinnableOptions = {}): boolean {
  if (message.role !== "user") {
    return false;
  }
  const maxTokens = options.maxTokens ?? DEFAULT_MAX_PINNED_USER_TOKENS;
  return estimateTokens(message) <= maxTokens;
}

/** Split messages into pinned (small user turns) and foldable (the rest). */
export function partitionPinnedTurns(
  messages: AgentMessage[],
  options: PinnableOptions = {},
): { pinned: AgentMessage[]; foldable: AgentMessage[] } {
  const pinned: AgentMessage[] = [];
  const foldable: AgentMessage[] = [];
  for (const message of messages) {
    if (isPinnableUserTurn(message, options)) {
      pinned.push(message);
    } else {
      foldable.push(message);
    }
  }
  return { pinned, foldable };
}

/**
 * Render pinned user turns into a verbatim marker block for embedding at the
 * top of a compaction summary. The model sees these as inviolable context.
 */
export function renderPinnedTurns(pinned: AgentMessage[]): string {
  if (pinned.length === 0) {
    return "";
  }
  const turns = pinned
    .map((m) => {
      const text =
        typeof (m as { content: unknown }).content === "string"
          ? (m as { content: string }).content
          : (
              m as {
                content: Array<{ type: string; text?: string }>;
              }
            ).content
              .filter((p) => p.type === "text" && typeof p.text === "string")
              .map((p) => p.text)
              .join("\n");
      return `<pinned-user-turn>\n${text}\n</pinned-user-turn>`;
    })
    .join("\n\n");
  return `<pinned-user-turns>\n${turns}\n</pinned-user-turns>`;
}
