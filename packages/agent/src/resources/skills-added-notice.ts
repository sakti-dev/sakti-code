import type { Skill } from "../harness-types";

/**
 * Format a `<skills-added>` block to prepend to a user turn.
 *
 * Used when a skill is installed mid-session: the system-prompt
 * `<available_skills>` block is frozen (cache-stable), so the new skill is
 * advertised via a transient turn-tail notice. The model reads the skill
 * body on-demand via the `read` tool — only the {name, description, location}
 * triple needs to reach it for the skill to be invocable.
 */
export function formatSkillsAddedNotice(skills: readonly Skill[]): string {
  const visible = skills.filter((skill) => !skill.disableModelInvocation);
  if (visible.length === 0) {
    return "";
  }
  const lines = [
    "<skills-added>",
    "The following skills were just installed and are available now. Read the full SKILL.md when the task matches its description.",
  ];
  for (const skill of visible) {
    lines.push("  <skill>");
    lines.push(`    <name>${escapeXml(skill.name)}</name>`);
    lines.push(`    <description>${escapeXml(skill.description)}</description>`);
    lines.push(`    <location>${escapeXml(skill.filePath)}</location>`);
    lines.push("  </skill>");
  }
  lines.push("</skills-added>");
  return lines.join("\n");
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
