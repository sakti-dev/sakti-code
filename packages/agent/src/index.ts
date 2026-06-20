export {
  type CompactionOptions,
  type CompactionResult,
  compactMessages,
  shouldCompact,
} from "./_legacy/compaction.ts";
export { Agent } from "./agent.ts";
export {
  collectEntriesForBranchSummary,
  generateBranchSummary,
} from "./compaction/branch-summarization.ts";
export {
  calculateContextTokens,
  compact,
  DEFAULT_COMPACTION_SETTINGS,
  estimateContextTokens,
  estimateTokens,
  prepareCompaction,
} from "./compaction.ts";
export { AgentHarness } from "./harness/agent-harness.ts";
export { convertToLlm } from "./harness/messages.ts";
export {
  formatPromptTemplateInvocation,
  loadPromptTemplates,
  loadSourcedPromptTemplates,
} from "./harness/prompt-templates.ts";
export { Session } from "./harness/session.ts";
export { loadSkills, loadSourcedSkills } from "./harness/skills.ts";
export { formatSkillsForSystemPrompt } from "./harness/system-prompt.ts";
export type {
  AgentHarnessEvent,
  AgentHarnessOptions,
  AgentHarnessPhase,
  AgentHarnessResources,
  ExecutionEnv,
  FileInfo,
  PromptTemplate,
  Result,
  SessionMetadata,
  SessionStorage,
  SessionTreeEntry,
  Skill,
} from "./harness/types.ts";
export {
  err,
  getOrThrow,
  getOrUndefined,
  ok,
  toError,
} from "./harness/types.ts";
export { truncateHead, truncateTail } from "./lib/truncate.ts";
export { runAgentLoop, runAgentLoopContinue } from "./loop/agent-loop.ts";
export * from "./types.ts";
