/**
 * Required prompt strings for the compaction algorithm.
 * Consumers must provide all four — the algorithm has no defaults.
 *
 * Reference implementation: apps/server/src/compaction/prompts.ts.
 */
export interface CompactionPrompts {
  /** Initial summarization prompt (no previous summary exists). */
  readonly summarization: string;
  /** System prompt for the summarization LLM call. */
  readonly summarizationSystem: string;
  /** Prompt for summarizing the prefix of a split turn. */
  readonly turnPrefix: string;
  /** Update prompt (previous summary exists, merge new messages). */
  readonly update: string;
}

/**
 * Required prompt strings for branch summarization.
 * Consumers must provide all three.
 *
 * Reference implementation: apps/server/src/compaction/prompts.ts.
 */
export interface BranchSummaryPrompts {
  /** Preamble prepended to the stored branch summary message. */
  readonly preamble: string;
  /** Base summarization prompt for the branch. */
  readonly prompt: string;
  /** System prompt for the summarization LLM call. */
  readonly systemPrompt: string;
}

/**
 * Required instructions block for advertising skills in the system prompt.
 * The first element is used as a sentinel marker by stripSkillsBlock —
 * callers MUST ensure the array is non-empty and that the first element
 * is unique enough not to collide with prompt content.
 *
 * Reference implementation: apps/server/src/agents/skills-instructions.ts.
 */
export type SkillsInstructions = readonly string[];
