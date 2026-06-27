export const SKILLS_INSTRUCTIONS: readonly string[] = [
  "The following skills provide specialized instructions for specific tasks.",
  "Read the full skill file when the task matches its description, unless a <skill> block for that skill is already present in the conversation (an explicitly triggered skill is already loaded in full — do not read it again).",
  "When a skill file references a relative path, resolve it against the skill directory (parent of SKILL.md / dirname of the path) and use that absolute path in tool commands.",
];
