/**
 * Required prompt strings for branch summarization.
 * Consumers must provide all three.
 *
 * Reference implementation: apps/server/src/agent/config/branch-summary-prompts.ts.
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
 * Instructions block prepended to the skills advertisement in the system
 * prompt. The first line is used as the sentinel marker by stripSkillsBlock
 * — callers MUST ensure the first line is unique enough not to collide with
 * surrounding prompt content.
 *
 * Reference implementation: apps/server/src/agents/skills-instructions.ts.
 */
export type SkillsInstructions = string;
