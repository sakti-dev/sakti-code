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

  const readPaths = new Map<string, string>();
  for (const entry of entries) {
    const msg = entry.message;
    if (msg.role !== "assistant") continue;
    for (const block of msg.content) {
      if (block.type !== "toolCall") continue;
      if (block.name !== "read") continue;
      const fp = block.arguments.filePath;
      if (typeof fp === "string") {
        readPaths.set(block.id, fp);
      }
    }
  }

  return entries.filter((entry) => {
    const msg = entry.message;
    if (msg.role !== "toolResult") return true;
    const path = readPaths.get(msg.toolCallId);
    if (!path) return true;
    return !path.startsWith(skillRoot);
  });
}
