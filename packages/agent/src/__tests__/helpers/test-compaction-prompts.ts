import type {
  BranchSummaryPrompts,
  CompactionPrompts,
  SkillsInstructions,
} from "../../compaction/prompt-bundles.ts";

/**
 * Test-only compaction prompts fixture. Tests don't exercise the prompt
 * content (the LLM is mocked); they just need a valid bundle to satisfy the
 * harness's required field. Reference impl lives in apps/server.
 */
export const TEST_COMPACTION_PROMPTS: CompactionPrompts = {
  summarizationSystem: "test-system",
  summarization: "test-summarize",
  update: "test-update",
  turnPrefix: "test-turn-prefix",
};

/** Test-only branch-summary prompts fixture. */
export const TEST_BRANCH_SUMMARY_PROMPTS: BranchSummaryPrompts = {
  preamble: "test-preamble",
  prompt: "test-branch-prompt",
  systemPrompt: "test-branch-system",
};

/** Test-only skills-instructions fixture (first line is the strip marker). */
export const TEST_SKILLS_INSTRUCTIONS: SkillsInstructions =
  "test-skill-instructions-line-1\ntest-skill-instructions-line-2";
