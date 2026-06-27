export { Agent } from "./agent.ts";
export type {
  CheckCompactionInput,
  CompactionDecision,
  CompactionReason,
  RunCompactionDeps,
  RunCompactionOutcome,
} from "./compaction/auto-compaction.ts";
export {
  checkCompaction,
  parseCompactionSettings,
  runAutoCompaction,
} from "./compaction/auto-compaction.ts";
export {
  collectEntriesForBranchSummary,
  generateBranchSummary,
} from "./compaction/branch-summarization.ts";
export type { FileOperations } from "./compaction/utils.ts";
export { serializeConversation } from "./compaction/utils.ts";
export type { CompactionSettings } from "./compaction.ts";
export {
  calculateContextTokens,
  compact,
  DEFAULT_COMPACTION_SETTINGS,
  estimateContextTokens,
  estimateTokens,
  prepareCompaction,
  shouldCompact,
} from "./compaction.ts";
export { AgentHarness } from "./harness/agent-harness.ts";
export type {
  AgentDiagnostic,
  AgentDiagnosticCode,
} from "./harness/agents.ts";
export { loadAgents } from "./harness/agents.ts";
export { buildHarnessStreamRequest } from "./harness/build-stream-request.ts";
export {
  BUILTIN_AGENTS,
  DEFAULT_AGENT_NAME,
  resolveBuiltinAgent,
} from "./harness/builtin-agents.ts";
export type {
  CommandDiagnostic,
  CommandDiagnosticCode,
} from "./harness/commands.ts";
export { loadCommands } from "./harness/commands.ts";
export { configEntryNameFromPath } from "./harness/config-entry-name.ts";
export { InMemorySessionStorageLive } from "./harness/memory-storage.ts";
export type {
  BashExecutionMessage,
  BranchSummaryMessage,
  CompactionSummaryMessage,
  CustomMessage,
} from "./harness/messages.ts";
export {
  BRANCH_SUMMARY_PREFIX,
  BRANCH_SUMMARY_SUFFIX,
  bashExecutionToText,
  COMPACTION_SUMMARY_PREFIX,
  COMPACTION_SUMMARY_SUFFIX,
  convertToLlm,
  createBranchSummaryMessage,
  createCompactionSummaryMessage,
  createCustomMessage,
} from "./harness/messages.ts";
export type {
  PermissionAction,
  PermissionConfig,
  PermissionRule,
  PermissionRuleset,
} from "./harness/permission.ts";
export {
  disabled,
  evaluate,
  fromConfig,
  match,
  merge,
} from "./harness/permission.ts";
export type {
  FirstTurnPlan,
  LeadingInvocation,
  LoadedResources,
  ReadFile,
} from "./harness/prompt-preprocessor.ts";
export {
  expandFileMentions,
  parseLeadingInvocation,
  planFirstTurn,
} from "./harness/prompt-preprocessor.ts";
export {
  formatPromptTemplateInvocation,
  loadPromptTemplates,
  loadSourcedPromptTemplates,
} from "./harness/prompt-templates.ts";
export { buildSessionContext, Session } from "./harness/session.ts";
export type {
  SkillDiagnostic,
  SkillDiagnosticCode,
} from "./harness/skills.ts";
export { loadSkills, loadSourcedSkills } from "./harness/skills.ts";
export {
  appendSkillsBlock,
  formatSkillsForSystemPrompt,
} from "./harness/system-prompt.ts";
export type {
  AgentDefinition,
  AgentHarnessEvent,
  AgentHarnessOptions,
  AgentHarnessPhase,
  AgentHarnessResources,
  AgentMode,
  ExecutionEnv,
  ExecutionEnvExecOptions,
  FileErrorCode,
  FileInfo,
  FileKind,
  PromptTemplate,
  Result,
  SessionMetadata,
  SessionStorage,
  SessionTreeEntry,
  Skill,
  ThinkingLevel,
} from "./harness/types.ts";
export {
  ExecutionError,
  err,
  FileError,
  getOrThrow,
  getOrUndefined,
  ok,
  toError,
} from "./harness/types.ts";
export type { TruncationOptions, TruncationResult } from "./lib/truncate.ts";
export {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  GREP_MAX_LINE_LENGTH,
  truncateHead,
  truncateLine,
  truncateTail,
} from "./lib/truncate.ts";
export { runAgentLoop, runAgentLoopContinue } from "./loop/agent-loop.ts";
export { INTAKE_SYSTEM_PROMPT } from "./prompts/intake-system-prompt.ts";
export type {
  RetryDecisionInput,
  RetryRunnerDeps,
  RetrySettings,
} from "./retry-loop.ts";
export {
  abortableSleep,
  computeRetryDelay,
  executeWithRetry,
  executeWithRetryEffect,
  parseRetrySettings,
  shouldRetry,
} from "./retry-loop.ts";
export type {
  CompletionProviderShape,
  StreamProviderShape,
} from "./services/llm.ts";
// LLM provider services (Effect-native wrappers around @sakti-code/llm).
export {
  CompletionProvider,
  CompletionProviderLive,
  StreamProvider,
  StreamProviderLive,
} from "./services/llm.ts";
export type {
  AgentEvent,
  AgentLoopConfig,
  AgentMessage,
  AgentState,
  AgentTool,
  AgentToolCall,
  AgentToolResult,
  AgentToolUpdateCallback,
  PermissionAskRequest,
  PermissionReply,
  PermissionRequest,
  QueueMode,
  StreamFn,
  ToolExecutionMode,
} from "./types.ts";
export { EventStream } from "./utils/event-stream.ts";
export { validateToolArguments } from "./utils/validation.ts";
