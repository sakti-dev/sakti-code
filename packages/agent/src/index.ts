export { AgentHarness } from "./agent/agent-harness.ts";
export { buildHarnessStreamRequest } from "./agent/build-stream-request.ts";
export { configEntryNameFromPath } from "./agents/config-entry-name.ts";
export { defineAgent } from "./agents/define-agent.ts";
export type { AgentDiagnostic, AgentDiagnosticCode } from "./agents/loader.ts";
export { loadAgents, loadAgentsEffect } from "./agents/loader.ts";
export type {
  PermissionAction,
  PermissionConfig,
  PermissionRule,
  PermissionRuleset,
} from "./agents/permission.ts";
export { disabled, evaluate, fromConfig, match, merge } from "./agents/permission.ts";
export type {
  CheckCompactionInput,
  CompactionDecision,
  CompactionReason,
  RunCompactionDeps,
  RunCompactionOutcome,
} from "./memory/compaction/auto-compaction.ts";
export {
  checkCompaction,
  parseCompactionSettings,
  runAutoCompaction,
  runAutoCompactionEffect,
} from "./memory/compaction/auto-compaction.ts";
export {
  collectEntriesForBranchSummary,
  collectEntriesForBranchSummaryEffect,
  generateBranchSummary,
  generateBranchSummaryEffect,
} from "./memory/compaction/branch-summarization.ts";
export type { CompactionSettings } from "./memory/compaction/compaction.ts";
export {
  calculateContextTokens,
  compact,
  compactEffect,
  DEFAULT_COMPACTION_SETTINGS,
  estimateContextTokens,
  estimateTokens,
  generateSummaryEffect,
  prepareCompaction,
  shouldCompact,
} from "./memory/compaction/compaction.ts";
export type {
  BranchSummaryPrompts,
  CompactionPrompts,
  SkillsInstructions,
} from "./memory/compaction/prompt-bundles.ts";
export type {
  RetryDecisionInput,
  RetryRunnerDepsEffect,
  RetrySettings,
  StuckGuardState,
} from "./memory/compaction/retry-loop.ts";
export {
  abortableSleep,
  computeRetryDelay,
  executeWithRetryEffect,
  parseRetrySettings,
  shouldRetry,
} from "./memory/compaction/retry-loop.ts";
export type { FileOperations } from "./memory/compaction/utils.ts";
export { serializeConversation } from "./memory/compaction/utils.ts";
export { runAgentLoop, runAgentLoopContinue } from "./core/agent-loop.ts";
export type { CacheDiagnostics, PrefixShape } from "./core/cache-shape.ts";
export { captureShape, compareShape } from "./core/cache-shape.ts";
export { validateToolArguments } from "./core/validation.ts";
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
  SessionStorageShape,
  SessionTreeEntry,
  Skill,
  ThinkingLevel,
} from "./harness-types.ts";
export type {
  BufferedObservationChunk,
  BufferedObservationChunkInput,
  CreateObservationalMemoryInput,
  CreateReflectionGenerationInput,
  ObservationalMemoryHistoryOptions,
  ObservationalMemoryOriginType,
  ObservationalMemoryRecord,
  ObservationalMemoryScope,
  ObservationalMemoryStorage,
  SwapBufferedReflectionToActiveInput,
  SwapBufferedToActiveInput,
  SwapBufferedToActiveResult,
  UpdateActiveObservationsInput,
  UpdateBufferedObservationsInput,
  UpdateBufferedReflectionInput,
  UpdateObservationalMemoryConfigInput,
} from "./observational-memory-storage.ts";
export type {
  ObservationalMemoryBuffering,
  ObservationalMemoryDeps,
  ObservationalMemoryOptions,
  ObservationalMemoryThresholds,
} from "./memory/observational-memory/config.ts";
export { TokenCounter } from "./memory/observational-memory/token-counter.ts";
export type { TokenCounterModelContext } from "./memory/observational-memory/token-counter.ts";
export { ObservationalMemoryEngine } from "./memory/observational-memory/engine.ts";
export { runObserver, ObservationError } from "./memory/observational-memory/observer.ts";
export { runReflector, ReflectionError } from "./memory/observational-memory/reflector.ts";
export {
  ExecutionError,
  err,
  FileError,
  getOrThrow,
  getOrUndefined,
  isFailure,
  isSuccess,
  ok,
  SessionError,
  toError,
} from "./harness-types.ts";
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
export type { CommandDiagnostic, CommandDiagnosticCode } from "./resources/commands.ts";
export { loadCommands, loadCommandsEffect } from "./resources/commands.ts";
export type {
  FirstTurnPlan,
  LeadingInvocation,
  LoadedResources,
  ReadFile,
} from "./resources/prompt-preprocessor.ts";
export {
  expandFileMentions,
  parseLeadingInvocation,
  planFirstTurn,
} from "./resources/prompt-preprocessor.ts";
export {
  formatPromptTemplateInvocation,
  loadPromptTemplates,
  loadPromptTemplatesEffect,
  loadSourcedPromptTemplates,
} from "./resources/prompt-templates.ts";
export type { SkillDiagnostic, SkillDiagnosticCode } from "./resources/skills.ts";
export {
  loadSkills,
  loadSkillsEffect,
  loadSourcedSkills,
  loadSourcedSkillsEffect,
} from "./resources/skills.ts";
export { formatSkillsAddedNotice } from "./resources/skills-added-notice.ts";
export {
  appendSkillsBlock,
  composeSystemPrompt,
  formatSkillsForSystemPrompt,
  stripSkillsBlock,
  stripToolInventory,
} from "./resources/system-prompt.ts";
export {
  demoteHeaders,
  renderToolInventory,
  renderToolSection,
} from "./resources/tool-inventory.ts";
export type { AgentRunDeps } from "./runner/agent-run.ts";
export { runAgentRunEffect } from "./runner/agent-run.ts";
export type { EditMode as SessionEditMode, SessionSettings } from "./runner/session-settings.ts";
export {
  DEFAULT_AGENT_NAME as DEFAULT_SESSION_AGENT_NAME,
  DEFAULT_SESSION_SETTINGS,
  parseSessionSettings,
} from "./runner/session-settings.ts";
export type { CompletionProviderShape, StreamProviderShape } from "./services/llm.ts";
export {
  CompletionProvider,
  CompletionProviderLive,
  StreamProvider,
  StreamProviderLive,
} from "./services/llm.ts";
export type {
  BashExecutionMessage,
  BranchSummaryMessage,
  CompactionSummaryMessage,
  CustomMessage,
} from "./session/messages.ts";
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
} from "./session/messages.ts";
export {
  buildSessionContext,
  buildSessionContextFromEntries,
  PromiseSession,
  promiseSessionAsShape,
  Session,
} from "./session/session.ts";
export { InMemorySessionStorageLive } from "./session/storage.ts";
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
