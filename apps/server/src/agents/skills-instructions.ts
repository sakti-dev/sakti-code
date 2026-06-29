import type { SkillsInstructions } from "@sakti-code/agent";

/**
 * Sakti house-style instructions block prepended to the skills advertisement
 * in the system prompt. The first line ("The following skills provide…") is
 * the sentinel marker used by stripSkillsBlock — callers MUST NOT change it
 * without coordinating with any persisted system prompts that carry an older
 * marker.
 *
 * Reference implementation for consumers.
 */
export const SKILLS_INSTRUCTIONS: SkillsInstructions = `The following skills provide specialized instructions for specific tasks.
Read the full skill file when the task matches its description, unless a <skill> block for that skill is already present in the conversation (an explicitly triggered skill is already loaded in full — do not read it again).
When a skill file references a relative path, resolve it against the skill directory (parent of SKILL.md / dirname of the path) and use that absolute path in tool commands.`;
