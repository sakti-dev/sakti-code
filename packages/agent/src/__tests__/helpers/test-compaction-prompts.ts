import type { CompactionPrompts } from "../../compaction/prompt-bundles.ts";

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
