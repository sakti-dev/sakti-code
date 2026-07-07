import type { MessageEntry } from "../session/entries.ts";

/**
 * Filter out tool-result entries whose preceding `read` call targeted a path
 * inside `skillRoot`. Used by the observer to exclude skill content (forced
 * injection + agent-initiated reference reads) from observe input — skill
 * content is structural instruction, not work signal.
 *
 * Returns the entries unchanged when `skillRoot` is undefined (filter
 * disabled — archive phase, subagents).
 *
 * The filter walks the entries once to build a `toolCallId → read-filePath`
 * map from assistant messages, then drops tool-result entries whose source
 * path is inside skillRoot.
 */
export function filterSkillContentEntries(
  entries: MessageEntry[],
  skillRoot: string | undefined,
): MessageEntry[] {
  if (!skillRoot) return entries;

  // Build the set of toolCallIds whose read targeted a skill path.
  const skillCallIds = new Set<string>();
  for (const entry of entries) {
    const msg = entry.message;
    if (msg.role !== "assistant") continue;
    for (const block of msg.content) {
      if (block.type !== "toolCall") continue;
      if (block.name !== "read") continue;
      const fp = block.arguments.filePath;
      if (typeof fp === "string" && fp.startsWith(skillRoot)) {
        skillCallIds.add(block.id);
      }
    }
  }

  return entries.filter((entry) => {
    const msg = entry.message;

    // Drop toolResults for skill reads.
    if (msg.role === "toolResult") {
      return !skillCallIds.has(msg.toolCallId);
    }

    // Drop assistant entries whose ONLY content is skill-read toolCalls
    // (no text — pure tool-call with no agent output). Keeps entries that
    // have text alongside the toolCall.
    if (msg.role === "assistant") {
      const toolCalls = msg.content.filter((b) => b.type === "toolCall");
      const hasText = msg.content.some(
        (b) => b.type === "text" && "text" in b && b.text.length > 0,
      );
      if (toolCalls.length > 0 && !hasText && toolCalls.every((tc) => skillCallIds.has(tc.id))) {
        return false;
      }
    }

    return true;
  });
}
