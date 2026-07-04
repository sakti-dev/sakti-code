import type { BranchSummaryPrompts } from "@sakti-code/agent";

const SUMMARIZATION_SYSTEM = `You are a context summarization assistant. Your task is to read a conversation between a user and an AI assistant, then produce a structured summary following the exact format specified.

Do NOT continue the conversation. Do NOT respond to any questions in the conversation. ONLY output the structured summary.`;

/**
 * Sakti house-style branch-summary prompts. Reference implementation for
 * consumers.
 */
export const BRANCH_SUMMARY_PROMPTS: BranchSummaryPrompts = {
  preamble: `The user explored a different conversation branch before returning here.
Summary of that exploration:

`,
  prompt: `Create a structured summary of this conversation branch for context when returning later.

Use this EXACT format:

## Goal
[What was the user trying to accomplish in this branch?]

## Constraints & Preferences
- [Any constraints, preferences, or requirements mentioned]
- [Or "(none)" if none were mentioned]

## Progress
### Done
- [x] [Completed tasks/changes]

### In Progress
- [ ] [Work that was started but not finished]

### Blocked
- [Issues preventing progress, if any]

## Key Decisions
- **[Decision]**: [Brief rationale]

## Next Steps
1. [What should happen next to continue this work]

Keep each section concise. Preserve exact file paths, function names, and error messages.`,
  systemPrompt: SUMMARIZATION_SYSTEM,
} as const;
