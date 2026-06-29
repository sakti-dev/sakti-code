import type { SkillsInstructions } from "../compaction/prompt-bundles";
import type { Skill } from "../harness-types";
import type { AgentTool } from "../types";
import { renderToolInventory } from "./tool-inventory";

export function formatSkillsForSystemPrompt(
  skills: Skill[],
  skillsInstructions: SkillsInstructions
): string {
  const visibleSkills = skills.filter((skill) => !skill.disableModelInvocation);
  if (visibleSkills.length === 0) {
    return "";
  }

  const lines = [skillsInstructions, "", "<available_skills>"];

  for (const skill of visibleSkills) {
    lines.push("  <skill>");
    lines.push(`    <name>${escapeXml(skill.name)}</name>`);
    lines.push(
      `    <description>${escapeXml(skill.description)}</description>`
    );
    lines.push(`    <location>${escapeXml(skill.filePath)}</location>`);
    lines.push("  </skill>");
  }

  lines.push("</available_skills>");
  return lines.join("\n");
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function appendSkillsBlock(
  baseSystemPrompt: string,
  skills: readonly Skill[],
  hasRead: boolean,
  skillsInstructions: SkillsInstructions
): string {
  if (!hasRead) {
    return baseSystemPrompt;
  }
  const block = formatSkillsForSystemPrompt([...skills], skillsInstructions);
  return block ? `${baseSystemPrompt}\n\n${block}` : baseSystemPrompt;
}

/**
 * Strip a trailing `<available_skills>` block (as appended by
 * {@link appendSkillsBlock}) from a composed system prompt, returning the base
 * prompt without the skills advertisement.
 *
 * Used by `removeSkill` to recompose the prompt with a reduced skills list:
 * the base is recovered by stripping, then `appendSkillsBlock` re-appends with
 * only the remaining skills. Deterministic because the block is always a
 * suffix starting with the first line of `skillsInstructions`.
 *
 * If no skills block is present (or `skillsInstructions` is empty), returns
 * the input unchanged.
 */
export function stripSkillsBlock(
  composedSystemPrompt: string,
  skillsInstructions: SkillsInstructions
): string {
  if (!skillsInstructions) {
    return composedSystemPrompt;
  }
  const firstLine = skillsInstructions.split("\n", 1)[0];
  const marker = `\n\n${firstLine}`;
  const index = composedSystemPrompt.lastIndexOf(marker);
  if (index < 0) {
    return composedSystemPrompt;
  }
  return composedSystemPrompt.slice(0, index);
}

/**
 * Strip the tool-inventory section from a composed system prompt, returning
 * the base prompt without any `# Tool:` headings.
 *
 * The tool inventory always starts with `\n\n# Tool: <name>` (inserted by
 * {@link renderToolInventory} via {@link composeSystemPrompt}). This function
 * finds that boundary and returns everything before it.
 *
 * To recover the full base prompt (without tools AND without skills), chain:
 * `stripToolInventory(stripSkillsBlock(composed, skillsInstructions))`.
 *
 * If no tool inventory is present, returns the input unchanged.
 */
export function stripToolInventory(composedSystemPrompt: string): string {
  const marker = "\n\n# Tool: ";
  const index = composedSystemPrompt.indexOf(marker);
  if (index < 0) {
    return composedSystemPrompt;
  }
  return composedSystemPrompt.slice(0, index);
}

/**
 * Compose a complete system prompt from three blocks:
 * 1. The agent's base system prompt (role, principles)
 * 2. A rendered tool inventory (# Tool: <name> sections with descriptions)
 * 3. The skills advertisement (<available_skills> block)
 *
 * Blocks are separated by double newlines. Tools are always included;
 * skills are gated on `hasRead` (the `read` tool must be available for
 * the model to load skill files).
 *
 * This replaces the ad-hoc appendSkillsBlock call in the runner and
 * mirrors pi's unified buildSystemPrompt composition.
 */
export function composeSystemPrompt(
  baseSystemPrompt: string,
  tools: readonly AgentTool[],
  skills: readonly Skill[],
  hasRead: boolean,
  skillsInstructions: SkillsInstructions
): string {
  const parts: string[] = [baseSystemPrompt];

  const toolInventory = renderToolInventory(tools);
  if (toolInventory) {
    parts.push(toolInventory);
  }

  if (hasRead) {
    const skillsBlock = formatSkillsForSystemPrompt(
      [...skills],
      skillsInstructions
    );
    if (skillsBlock) {
      parts.push(skillsBlock);
    }
  }

  return parts.join("\n\n");
}
