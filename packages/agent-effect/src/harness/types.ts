import type { ImageContent, Model, TextContent } from "@sakti-code/llm";
import type { Logger } from "@sakti-code/logger";
import { Context, type Effect, Schema } from "effect";
import type {
  AgentEvent,
  AgentMessage,
  AgentTool,
  QueueMode,
  StreamFn,
  ThinkingLevel,
} from "../types.ts";

export type { ThinkingLevel } from "../types.ts";

import type { PermissionRuleset } from "./permission.ts";
import type { SessionShape } from "./session.ts";

// v4-compatible Result type. Shape matches effect's Result (Success/Failure
// with _tag/success/failure) so Result.isSuccess/isFailure from "effect"
// work on our values. Kept as a bare type so `Result<A, E>` annotations work
// without namespace qualification.
export type Result<A, E = never> =
  | { readonly _tag: "Success"; readonly success: A }
  | { readonly _tag: "Failure"; readonly failure: E };

export function ok<A, E = never>(value: A): Result<A, E> {
  return { _tag: "Success", success: value };
}

export function err<A, E = never>(error: E): Result<A, E> {
  return { _tag: "Failure", failure: error };
}

export function getOrThrow<A, E>(result: Result<A, E>): A {
  if (result._tag === "Failure") {
    throw result.failure;
  }
  return result.success;
}

export function getOrUndefined<A extends object, E>(
  result: Result<A, E>
): A | undefined {
  return result._tag === "Success" ? result.success : undefined;
}

export function isSuccess<A, E>(
  result: Result<A, E>
): result is { readonly _tag: "Success"; readonly success: A } {
  return result._tag === "Success";
}

export function isFailure<A, E>(
  result: Result<A, E>
): result is { readonly _tag: "Failure"; readonly failure: E } {
  return result._tag === "Failure";
}

export function toError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  if (typeof error === "string") {
    return new Error(error);
  }
  try {
    return new Error(JSON.stringify(error));
  } catch {
    return new Error(String(error));
  }
}

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

export type FileKind = "file" | "directory" | "symlink";

export const FileErrorCode = Schema.Literals([
  "aborted",
  "not_found",
  "permission_denied",
  "not_directory",
  "is_directory",
  "invalid",
  "not_supported",
  "unknown",
]);
export type FileErrorCode = typeof FileErrorCode.Type;

export class FileError extends Schema.TaggedErrorClass<FileError>()(
  "FileError",
  {
    code: FileErrorCode,
    message: Schema.String,
    path: Schema.optional(Schema.String),
    cause: Schema.optional(Schema.Defect()),
  }
) {}

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

export const SessionErrorCode = Schema.Literals([
  "not_found",
  "invalid_session",
  "invalid_entry",
  "invalid_fork_target",
  "storage",
  "unknown",
]);
export type SessionErrorCode = typeof SessionErrorCode.Type;

export class SessionError extends Schema.TaggedErrorClass<SessionError>()(
  "SessionError",
  {
    code: SessionErrorCode,
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

export interface FileInfo {
  kind: FileKind;
  mtimeMs: number;
  name: string;
  path: string;
  size: number;
}

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

export interface SessionTreeEntryBase {
  id: string;
  parentId: string | null;
  timestamp: string;
  type: string;
}

export interface MessageEntry extends SessionTreeEntryBase {
  message: AgentMessage;
  type: "message";
}

export interface ThinkingLevelChangeEntry extends SessionTreeEntryBase {
  thinkingLevel: string;
  type: "thinking_level_change";
}

export interface ModelChangeEntry extends SessionTreeEntryBase {
  modelId: string;
  provider: string;
  type: "model_change";
}

export interface ActiveToolsChangeEntry extends SessionTreeEntryBase {
  activeToolNames: string[];
  type: "active_tools_change";
}

export interface CompactionEntry<T = unknown> extends SessionTreeEntryBase {
  details?: T | undefined;
  firstKeptEntryId: string;
  fromHook?: boolean | undefined;
  summary: string;
  tokensBefore: number;
  type: "compaction";
}

export interface BranchSummaryEntry<T = unknown> extends SessionTreeEntryBase {
  details?: T | undefined;
  fromHook?: boolean | undefined;
  fromId: string;
  summary: string;
  type: "branch_summary";
}

export interface CustomEntry<T = unknown> extends SessionTreeEntryBase {
  customType: string;
  data?: T | undefined;
  type: "custom";
}

export interface CustomMessageEntry<T = unknown> extends SessionTreeEntryBase {
  content: string | (TextContent | ImageContent)[];
  customType: string;
  details?: T | undefined;
  display: boolean;
  type: "custom_message";
}

export interface LabelEntry extends SessionTreeEntryBase {
  label: string | undefined;
  targetId: string;
  type: "label";
}

export interface SessionInfoEntry extends SessionTreeEntryBase {
  name?: string | undefined;
  type: "session_info";
}

export interface LeafEntry extends SessionTreeEntryBase {
  targetId: string | null;
  type: "leaf";
}

export type SessionTreeEntry =
  | MessageEntry
  | ThinkingLevelChangeEntry
  | ModelChangeEntry
  | ActiveToolsChangeEntry
  | CompactionEntry
  | BranchSummaryEntry
  | CustomEntry
  | CustomMessageEntry
  | LabelEntry
  | SessionInfoEntry
  | LeafEntry;

export interface SessionContext {
  activeToolNames: string[] | null;
  messages: AgentMessage[];
  model: { provider: string; modelId: string } | null;
  thinkingLevel: string;
}

export interface SessionMetadata {
  createdAt: string;
  id: string;
}

export interface JsonlSessionMetadata extends SessionMetadata {
  cwd: string;
  parentSessionPath?: string;
  path: string;
}

export interface SessionStorageShape {
  readonly appendEntry: (
    entry: SessionTreeEntry
  ) => Effect.Effect<void, SessionError>;
  readonly createEntryId: () => Effect.Effect<string, SessionError>;
  readonly findEntries: <TType extends SessionTreeEntry["type"]>(
    type: TType
  ) => Effect.Effect<
    Array<Extract<SessionTreeEntry, { type: TType }>>,
    SessionError
  >;
  readonly getEntries: () => Effect.Effect<SessionTreeEntry[], SessionError>;
  readonly getEntry: (
    id: string
  ) => Effect.Effect<SessionTreeEntry | undefined, SessionError>;
  readonly getLabel: (
    id: string
  ) => Effect.Effect<string | undefined, SessionError>;
  readonly getLeafId: () => Effect.Effect<string | null, SessionError>;
  readonly getMetadata: () => Effect.Effect<SessionMetadata, SessionError>;
  readonly getPathToRoot: (
    leafId: string | null
  ) => Effect.Effect<SessionTreeEntry[], SessionError>;
  readonly setLeafId: (
    leafId: string | null
  ) => Effect.Effect<void, SessionError>;
}

export class SessionStorage extends Context.Service<
  SessionStorage,
  SessionStorageShape
>()("@sakti-code/agent-effect/SessionStorage") {}

export type { Session, SessionShape } from "./session.ts";

export interface SessionCreateOptions {
  id?: string;
}

export interface SessionForkOptions {
  entryId?: string;
  id?: string;
  position?: "before" | "at";
}

export interface SessionRepo<
  TMetadata extends SessionMetadata = SessionMetadata,
  TCreateOptions extends SessionCreateOptions = SessionCreateOptions,
  TListOptions = void,
> {
  create(options: TCreateOptions): Promise<SessionShape>;
  delete(metadata: TMetadata): Promise<void>;
  fork(
    source: TMetadata,
    options: SessionForkOptions & TCreateOptions
  ): Promise<SessionShape>;
  list(options?: TListOptions): Promise<TMetadata[]>;
  open(metadata: TMetadata): Promise<SessionShape>;
}

export interface JsonlSessionCreateOptions extends SessionCreateOptions {
  cwd: string;
  parentSessionPath?: string;
}

export interface JsonlSessionListOptions {
  cwd?: string;
}

export interface JsonlSessionRepoApi
  extends SessionRepo<
    JsonlSessionMetadata,
    JsonlSessionCreateOptions,
    JsonlSessionListOptions
  > {}

export type AgentHarnessPhase =
  | "idle"
  | "turn"
  | "compaction"
  | "branch_summary";

export type PendingSessionWrite = SessionTreeEntry extends infer TEntry
  ? TEntry extends SessionTreeEntry
    ? Omit<TEntry, "id" | "parentId" | "timestamp">
    : never
  : never;

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
  source: "set" | "restore";
  toolNames: string[];
  type: "tools_update";
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
  | ToolsUpdateEvent;

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

export interface CompactResult {
  details?: unknown;
  firstKeptEntryId: string;
  summary: string;
  tokensBefore: number;
}

export interface NavigateTreeResult {
  cancelled: boolean;
  editorText?: string | undefined;
  summaryEntry?: BranchSummaryEntry | undefined;
}

export interface CompactionSettings {
  enabled: boolean;
  keepRecentTokens: number;
  reserveTokens: number;
}

export interface CompactionPreparation {
  fileOps: FileOperations;
  firstKeptEntryId: string;
  isSplitTurn: boolean;
  messagesToSummarize: AgentMessage[];
  previousSummary?: string | undefined;
  settings: CompactionSettings;
  tokensBefore: number;
  turnPrefixMessages: AgentMessage[];
}

export interface FileOperations {
  edited: Set<string>;
  read: Set<string>;
  written: Set<string>;
}

export interface TreePreparation {
  commonAncestorId: string | null;
  customInstructions?: string | undefined;
  entriesToSummarize: SessionTreeEntry[];
  label?: string | undefined;
  oldLeafId: string | null;
  replaceInstructions?: boolean | undefined;
  targetId: string;
  userWantsSummary: boolean;
}

export interface GenerateBranchSummaryOptions {
  apiKey: string;
  customInstructions?: string | undefined;
  headers?: Record<string, string> | undefined;
  model: Model;
  replaceInstructions?: boolean | undefined;
  reserveTokens?: number | undefined;
  signal: AbortSignal;
}

export interface BranchSummaryResult {
  modifiedFiles: string[];
  readFiles: string[];
  summary: string;
}

export interface AgentHarnessOptions<
  TSkill extends Skill = Skill,
  TPromptTemplate extends PromptTemplate = PromptTemplate,
  TTool extends AgentTool = AgentTool,
> {
  activeToolNames?: string[];
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

export type { AgentHarness } from "./agent-harness.ts";
