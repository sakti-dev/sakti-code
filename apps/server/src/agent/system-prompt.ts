import { formatSkillsForSystemPrompt, type Skill } from "@sakti-code/agent";

/**
 * Compose the agent's base system prompt with the available-skills block.
 *
 * Mirrors pi's coding-agent `buildSystemPrompt`: skills are advertised only
 * when the `read` tool is available (skills are loaded by calling `read` on
 * the SKILL.md path), and the block is appended to the base prompt. Returns
 * the base prompt unchanged when `read` is unavailable or there are no
 * model-visible skills (disabled skills are filtered by
 * `formatSkillsForSystemPrompt`).
 */
export function appendSkillsBlock(
  baseSystemPrompt: string,
  skills: readonly Skill[],
  hasRead: boolean
): string {
  if (!hasRead) {
    return baseSystemPrompt;
  }
  const block = formatSkillsForSystemPrompt([...skills]);
  return block ? `${baseSystemPrompt}\n\n${block}` : baseSystemPrompt;
}
