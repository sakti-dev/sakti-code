import type { Skill } from "../harness-types";
import { SKILLS_INSTRUCTIONS } from "../prompts/skills-instructions";

export function formatSkillsForSystemPrompt(skills: Skill[]): string {
  const visibleSkills = skills.filter((skill) => !skill.disableModelInvocation);
  if (visibleSkills.length === 0) {
    return "";
  }

  const lines = [...SKILLS_INSTRUCTIONS, "", "<available_skills>"];

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
  hasRead: boolean
): string {
  if (!hasRead) {
    return baseSystemPrompt;
  }
  const block = formatSkillsForSystemPrompt([...skills]);
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
 * suffix starting with the first `SKILLS_INSTRUCTIONS` line.
 *
 * If no skills block is present, returns the input unchanged.
 */
export function stripSkillsBlock(composedSystemPrompt: string): string {
  const marker = `\n\n${SKILLS_INSTRUCTIONS[0]}`;
  const index = composedSystemPrompt.lastIndexOf(marker);
  if (index < 0) {
    return composedSystemPrompt;
  }
  return composedSystemPrompt.slice(0, index);
}
