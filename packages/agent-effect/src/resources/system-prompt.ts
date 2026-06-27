import type { Skill } from "~/harness-types";
import { SKILLS_INSTRUCTIONS } from "~/prompts/skills-instructions";

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
