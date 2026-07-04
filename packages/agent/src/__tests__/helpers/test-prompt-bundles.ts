import type { BranchSummaryPrompts, SkillsInstructions } from "../../harness-types.ts";

/** Test-only branch-summary prompts fixture. */
export const TEST_BRANCH_SUMMARY_PROMPTS: BranchSummaryPrompts = {
  preamble: "test-preamble",
  prompt: "test-branch-prompt",
  systemPrompt: "test-branch-system",
};

/** Test-only skills-instructions fixture (first line is the strip marker). */
export const TEST_SKILLS_INSTRUCTIONS: SkillsInstructions =
  "test-skill-instructions-line-1\ntest-skill-instructions-line-2";
