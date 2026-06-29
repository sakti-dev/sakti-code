import type { ImageContent, Model, TextContent } from "@sakti-code/llm";
import type { Logger } from "@sakti-code/logger";
import { Schema } from "effect";
import type { Result } from "./lib/result";
import type {
  AgentEvent,
  AgentMessage,
  AgentTool,
  QueueMode,
  StreamFn,
  ThinkingLevel,
} from "./types";

export type { ThinkingLevel } from "./types";

import type { PermissionRuleset } from "./agents/permission";
import type {
  BranchSummaryPrompts,
  CompactionPrompts,
  SkillsInstructions,
} from "./compaction/prompt-bundles";
import type {
  BranchSummaryEntry,
  CompactionEntry,
  CompactionPreparation,
  CompactResult,
  FileInfo,
  SessionShape,
  SessionTreeEntry,
  TreePreparation,
} from "./session/entries";

export type {
  ActiveToolsChangeEntry,
  BranchSummaryEntry,
  BranchSummaryResult,
  CompactionEntry,
  CompactionPreparation,
  CompactionSettings,
  CompactResult,
  CustomEntry,
  CustomMessageEntry,
  FileInfo,
  FileKind,
  FileOperations,
  GenerateBranchSummaryOptions,
  JsonlSessionCreateOptions,
  JsonlSessionListOptions,
  JsonlSessionMetadata,
  JsonlSessionRepoApi,
  LabelEntry,
  LeafEntry,
  MessageEntry,
  ModelChangeEntry,
  PendingSessionWrite,
  SessionContext,
  SessionCreateOptions,
  SessionForkOptions,
  SessionInfoEntry,
  SessionMetadata,
  SessionRepo,
  SessionTreeEntry,
  ThinkingLevelChangeEntry,
  TreePreparation,
} from "./session/entries";
export type { Session, SessionShape } from "./session/session";
export { PromiseSession } from "./session/session";
export type { SessionStorageShape } from "./session/storage";
export { SessionStorage } from "./session/storage";

import type { FileError } from "./session/entries";

export type { Result } from "./lib/result";
export {
  err,
  getOrThrow,
  getOrUndefined,
  isFailure,
  isSuccess,
  ok,
  toError,
} from "./lib/result";
export { FileError, FileErrorCode, SessionError } from "./session/entries";
export { InMemorySessionStorageLive } from "./session/storage";

export interface Skill {
  content: string;
  description: string;
  disableModelInvocation?: boolean;
  filePath: string;
  name: string;
}

export interface PromptTemplate {
  content: string;
  description?: string;
  name: string;
}

export type AgentMode = "primary" | "subagent" | "all";

export interface AgentDefinition {
  activeToolNames?: string[];
  description?: string;
  hidden?: boolean;
  mode: AgentMode;
  model?: { providerId: string; modelId: string };
  name: string;
  permission?: PermissionRuleset;
  systemPrompt: string;
  thinkingLevel?: ThinkingLevel;
}

export interface AgentHarnessResources<
  TSkill extends Skill = Skill,
  TPromptTemplate extends PromptTemplate = PromptTemplate,
> {
  promptTemplates?: TPromptTemplate[] | undefined;
  skills?: TSkill[] | undefined;
}

export interface AgentHarnessStreamOptions {
  headers?: Record<string, string> | undefined;
}

export interface AgentHarnessStreamOptionsPatch {
  headers?: Record<string, string | undefined>;
}

export const ExecutionErrorCode = Schema.Literals([
  "aborted",
  "timeout",
  "shell_unavailable",
  "spawn_error",
  "callback_error",
  "unknown",
]);
export type ExecutionErrorCode = typeof ExecutionErrorCode.Type;

export class ExecutionError extends Schema.TaggedErrorClass<ExecutionError>()(
  "ExecutionError",
  {
    code: ExecutionErrorCode,
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  }
) {}

export const CompactionErrorCode = Schema.Literals([
  "aborted",
  "summarization_failed",
  "invalid_session",
  "unknown",
]);
export type CompactionErrorCode = typeof CompactionErrorCode.Type;

export class CompactionError extends Schema.TaggedErrorClass<CompactionError>()(
  "CompactionError",
  {
    code: CompactionErrorCode,
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  }
) {}

export const BranchSummaryErrorCode = Schema.Literals([
  "aborted",
  "summarization_failed",
  "invalid_session",
]);
export type BranchSummaryErrorCode = typeof BranchSummaryErrorCode.Type;

export class BranchSummaryError extends Schema.TaggedErrorClass<BranchSummaryError>()(
  "BranchSummaryError",
  {
    code: BranchSummaryErrorCode,
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  }
) {}

export const AgentHarnessErrorCode = Schema.Literals([
  "busy",
  "invalid_state",
  "invalid_argument",
  "session",
  "hook",
  "auth",
  "compaction",
  "branch_summary",
  "unknown",
]);
export type AgentHarnessErrorCode = typeof AgentHarnessErrorCode.Type;

export class AgentHarnessError extends Schema.TaggedErrorClass<AgentHarnessError>()(
  "AgentHarnessError",
  {
    code: AgentHarnessErrorCode,
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  }
) {}

export const AgentErrorCode = Schema.Literals([
  "already_processing",
  "no_messages",
  "cannot_continue_from_assistant",
]);
export type AgentErrorCode = typeof AgentErrorCode.Type;

export class AgentError extends Schema.TaggedErrorClass<AgentError>()(
  "AgentError",
  {
    code: AgentErrorCode,
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  }
) {}

export interface ExecutionEnvExecOptions {
  abortSignal?: AbortSignal;
  cwd?: string;
  env?: Record<string, string>;
  onStderr?: (chunk: string) => void;
  onStdout?: (chunk: string) => void;
  timeout?: number;
}

export interface FileSystem {
  absolutePath(
    path: string,
    abortSignal?: AbortSignal
  ): Promise<Result<string, FileError>>;
  appendFile(
    path: string,
    content: string | Uint8Array,
    abortSignal?: AbortSignal
  ): Promise<Result<void, FileError>>;
  canonicalPath(
    path: string,
    abortSignal?: AbortSignal
  ): Promise<Result<string, FileError>>;

  cleanup(): Promise<void>;
  createDir(
    path: string,
    options?: { recursive?: boolean; abortSignal?: AbortSignal }
  ): Promise<Result<void, FileError>>;
  createTempDir(
    prefix?: string,
    abortSignal?: AbortSignal
  ): Promise<Result<string, FileError>>;
  createTempFile(options?: {
    prefix?: string;
    suffix?: string;
    abortSignal?: AbortSignal;
  }): Promise<Result<string, FileError>>;
  cwd: string;
  exists(
    path: string,
    abortSignal?: AbortSignal
  ): Promise<Result<boolean, FileError>>;
  fileInfo(
    path: string,
    abortSignal?: AbortSignal
  ): Promise<Result<FileInfo, FileError>>;
  joinPath(
    parts: string[],
    abortSignal?: AbortSignal
  ): Promise<Result<string, FileError>>;
  listDir(
    path: string,
    abortSignal?: AbortSignal
  ): Promise<Result<FileInfo[], FileError>>;
  readBinaryFile(
    path: string,
    abortSignal?: AbortSignal
  ): Promise<Result<Uint8Array, FileError>>;
  readTextFile(
    path: string,
    abortSignal?: AbortSignal
  ): Promise<Result<string, FileError>>;
  readTextLines(
    path: string,
    options?: { maxLines?: number; abortSignal?: AbortSignal }
  ): Promise<Result<string[], FileError>>;
  remove(
    path: string,
    options?: {
      recursive?: boolean;
      force?: boolean;
      abortSignal?: AbortSignal;
    }
  ): Promise<Result<void, FileError>>;
  writeFile(
    path: string,
    content: string | Uint8Array,
    abortSignal?: AbortSignal
  ): Promise<Result<void, FileError>>;
}

export interface Shell {
  cleanup(): Promise<void>;
  exec(
    command: string,
    options?: ExecutionEnvExecOptions
  ): Promise<
    Result<{ stdout: string; stderr: string; exitCode: number }, ExecutionError>
  >;
}

export interface ExecutionEnv extends FileSystem, Shell {}

export type AgentHarnessPhase =
  | "idle"
  | "turn"
  | "compaction"
  | "branch_summary";

export interface QueueUpdateEvent {
  followUp: AgentMessage[];
  nextTurn: AgentMessage[];
  steer: AgentMessage[];
  type: "queue_update";
}

export interface SavePointEvent {
  hadPendingMutations: boolean;
  type: "save_point";
}

export interface AbortEvent {
  clearedFollowUp: AgentMessage[];
  clearedSteer: AgentMessage[];
  type: "abort";
}

export interface SettledEvent {
  nextTurnCount: number;
  type: "settled";
}

export interface BeforeAgentStartEvent<
  TSkill extends Skill = Skill,
  TPromptTemplate extends PromptTemplate = PromptTemplate,
> {
  images?: ImageContent[] | undefined;
  prompt: string;
  resources: AgentHarnessResources<TSkill, TPromptTemplate>;
  systemPrompt: string;
  type: "before_agent_start";
}

export interface ContextEvent {
  messages: AgentMessage[];
  type: "context";
}

export interface BeforeProviderRequestEvent {
  model: Model;
  sessionId: string;
  streamOptions: AgentHarnessStreamOptions;
  type: "before_provider_request";
}

export interface ToolCallEvent {
  input: Record<string, unknown>;
  toolCallId: string;
  toolName: string;
  type: "tool_call";
}

export interface ToolResultEvent {
  content: Array<TextContent | ImageContent>;
  details: unknown;
  input: Record<string, unknown>;
  isError: boolean;
  toolCallId: string;
  toolName: string;
  type: "tool_result";
}

export interface SessionBeforeCompactEvent {
  branchEntries: SessionTreeEntry[];
  customInstructions?: string | undefined;
  preparation: CompactionPreparation;
  signal: AbortSignal;
  type: "session_before_compact";
}

export interface SessionCompactEvent {
  compactionEntry: CompactionEntry;
  fromHook: boolean;
  type: "session_compact";
}

export interface SessionBeforeTreeEvent {
  preparation: TreePreparation;
  signal: AbortSignal;
  type: "session_before_tree";
}

export interface SessionTreeEvent {
  fromHook?: boolean | undefined;
  newLeafId: string | null;
  oldLeafId: string | null;
  summaryEntry?: BranchSummaryEntry | undefined;
  type: "session_tree";
}

export interface ModelUpdateEvent {
  model: Model;
  previousModel: Model | undefined;
  source: "set" | "restore";
  type: "model_update";
}

export interface ThinkingLevelUpdateEvent {
  level: ThinkingLevel;
  previousLevel: ThinkingLevel;
  type: "thinking_level_update";
}

export interface ToolsUpdateEvent {
  activeToolNames: string[];
  previousActiveToolNames: string[];
  previousToolNames: string[];
  source: "set" | "restore" | "swap";
  toolNames: string[];
  type: "tools_update";
}

/**
 * Emitted when a cache-busting change is pending (deferred to compaction).
 * The UI subscribes to this to show "compact recommended" alerts — the user
 * deferred the cache cost, and this event tells them a compact would apply it.
 */
export interface CacheBustPendingEvent {
  /** Human-readable detail for UI alerts. */
  message: string;
  /** What kind of change is pending. */
  reason: "skills_refresh" | "system_prompt_refresh" | "tools_refresh";
  type: "cache_bust_pending";
}

export interface ResourcesUpdateEvent<
  TSkill extends Skill = Skill,
  TPromptTemplate extends PromptTemplate = PromptTemplate,
> {
  previousResources: AgentHarnessResources<TSkill, TPromptTemplate>;
  resources: AgentHarnessResources<TSkill, TPromptTemplate>;
  type: "resources_update";
}

export type AgentHarnessOwnEvent<
  TSkill extends Skill = Skill,
  TPromptTemplate extends PromptTemplate = PromptTemplate,
> =
  | QueueUpdateEvent
  | SavePointEvent
  | AbortEvent
  | SettledEvent
  | BeforeAgentStartEvent<TSkill, TPromptTemplate>
  | ContextEvent
  | BeforeProviderRequestEvent
  | ToolCallEvent
  | ToolResultEvent
  | SessionBeforeCompactEvent
  | SessionCompactEvent
  | SessionBeforeTreeEvent
  | SessionTreeEvent
  | ModelUpdateEvent
  | ThinkingLevelUpdateEvent
  | ResourcesUpdateEvent<TSkill, TPromptTemplate>
  | ToolsUpdateEvent
  | CacheBustPendingEvent;

export type AgentHarnessEvent<
  TSkill extends Skill = Skill,
  TPromptTemplate extends PromptTemplate = PromptTemplate,
> = AgentEvent | AgentHarnessOwnEvent<TSkill, TPromptTemplate>;

export interface BeforeAgentStartResult {
  messages?: AgentMessage[];
  systemPrompt?: string;
}

export interface ContextResult {
  messages: AgentMessage[];
}

export interface BeforeProviderRequestResult {
  streamOptions?: AgentHarnessStreamOptionsPatch;
}

export interface ToolCallResult {
  block?: boolean;
  reason?: string;
}

export interface ToolResultPatch {
  content?: Array<TextContent | ImageContent>;
  details?: unknown;
  isError?: boolean;
  terminate?: boolean;
}

export interface SessionBeforeCompactResult {
  cancel?: boolean;
  compaction?: CompactResult;
}

export interface SessionBeforeTreeResult {
  cancel?: boolean;
  customInstructions?: string;
  label?: string;
  replaceInstructions?: boolean;
  summary?: { summary: string; details?: unknown };
}

export type AgentHarnessEventResultMap = {
  before_agent_start: BeforeAgentStartResult | undefined;
  context: ContextResult | undefined;
  before_provider_request: BeforeProviderRequestResult | undefined;
  tool_call: ToolCallResult | undefined;
  tool_result: ToolResultPatch | undefined;
  session_before_compact: SessionBeforeCompactResult | undefined;
  session_compact: undefined;
  session_before_tree: SessionBeforeTreeResult | undefined;
  session_tree: undefined;
  model_update: undefined;
  thinking_level_update: undefined;
  resources_update: undefined;
  tools_update: undefined;
  cache_bust_pending: undefined;
  queue_update: undefined;
  save_point: undefined;
  abort: undefined;
  settled: undefined;
};

export interface AgentHarnessPromptOptions {
  images?: ImageContent[];
}

export interface AbortResult {
  clearedFollowUp: AgentMessage[];
  clearedSteer: AgentMessage[];
}

export interface NavigateTreeResult {
  cancelled: boolean;
  editorText?: string | undefined;
  summaryEntry?: BranchSummaryEntry | undefined;
}

export interface AgentHarnessOptions<
  TSkill extends Skill = Skill,
  TPromptTemplate extends PromptTemplate = PromptTemplate,
  TTool extends AgentTool = AgentTool,
> {
  activeToolNames?: string[];
  /** Required: prompt bundle for the harness's branch-summary path. */
  branchSummaryPrompts: BranchSummaryPrompts;
  /** Required: prompt bundle for the harness's idle-time compaction path. */
  compactionPrompts: CompactionPrompts;
  env: ExecutionEnv;
  followUpMode?: QueueMode;
  getApiKeyAndHeaders?: (
    model: Model
  ) => Promise<
    { apiKey: string; headers?: Record<string, string> } | undefined
  >;
  logger?: Logger;
  maxSteps?: number;
  model: Model;
  resources?: AgentHarnessResources<TSkill, TPromptTemplate>;
  session: SessionShape;
  /**
   * Required: instructions block for the skills advertisement in the system
   * prompt. The first element is used as the sentinel marker for
   * stripSkillsBlock — callers MUST ensure the array is non-empty.
   */
  skillsInstructions: SkillsInstructions;
  steeringMode?: QueueMode;
  streamFn?: StreamFn;
  streamLogger?: Logger;
  streamOptions?: AgentHarnessStreamOptions;
  systemPrompt?:
    | string
    | ((context: {
        env: ExecutionEnv;
        session: SessionShape;
        model: Model;
        thinkingLevel: ThinkingLevel;
        activeTools: TTool[];
        resources: AgentHarnessResources<TSkill, TPromptTemplate>;
      }) => string | Promise<string>);
  thinkingLevel?: ThinkingLevel;
  tools?: TTool[];
}

export type { AgentHarness } from "./agent/agent-harness";
