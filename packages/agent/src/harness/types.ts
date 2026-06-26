import type { ImageContent, Model, TextContent } from "@sakti-code/llm";
import type { Logger } from "@sakti-code/logger";
import type {
  AgentEvent,
  AgentMessage,
  AgentTool,
  QueueMode,
  StreamFn,
  ThinkingLevel,
} from "../types.ts";

export type { ThinkingLevel } from "../types.ts";

import type { Session } from "./session.ts";

/** Result of a fallible operation. Expected failures are returned as `ok: false` instead of thrown. */
export type Result<TValue, TError> =
  | { ok: true; value: TValue }
  | { ok: false; error: TError };

/** Create a successful {@link Result}. */
export function ok<TValue, TError>(value: TValue): Result<TValue, TError> {
  return { ok: true, value };
}

/** Create a failed {@link Result}. */
export function err<TValue, TError>(error: TError): Result<TValue, TError> {
  return { ok: false, error };
}

/** Return the success value or throw the failure error. Intended for tests and explicit adapter boundaries. */
export function getOrThrow<TValue, TError>(
  result: Result<TValue, TError>
): TValue {
  if (!result.ok) {
    throw result.error;
  }
  return result.value;
}

/** Return the success value or `undefined`. Only object values are allowed to avoid truthiness bugs with primitives. */
export function getOrUndefined<TValue extends object, TError>(
  result: Result<TValue, TError>
): TValue | undefined {
  return result.ok ? result.value : undefined;
}

/** Normalize unknown thrown values into Error instances before using them as typed error causes. */
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

/**
 * Skill loaded from a `SKILL.md` file or provided by an application.
 *
 * `name`, `description`, and `filePath` are inserted into the system prompt in an XML-formatted block as suggested by agentskills.io.
 * Use {@link formatSkillsForSystemPrompt} to generate the spec-compatible system prompt block.
 */
export interface Skill {
  /** Full skill instructions. */
  content: string;
  /** Short model-visible description of when to use the skill. */
  description: string;
  /** Exclude this skill from model-visible skill lists while still allowing explicit application invocation. */
  disableModelInvocation?: boolean;
  /** Absolute path to the skill file. Used for model-visible location and resolving relative references. */
  filePath: string;
  /** Stable skill name used for lookup and model-visible listings. */
  name: string;
}

/** Prompt template that can be formatted into a prompt for explicit invocation. */
export interface PromptTemplate {
  /** Template content. Argument placeholders are formatted by `formatPromptTemplateInvocation`. */
  content: string;
  /** Optional description for command lists or autocomplete. */
  description?: string;
  /** Stable template name used for lookup or application command routing. */
  name: string;
}

/** Runtime role of an agent. Mirrors opencode's mode literals. */
export type AgentMode = "primary" | "subagent" | "all";

/**
 * A named, switchable agent definition. Loaded from markdown under an `agent` or
 * `agents` directory (frontmatter → mode/hidden/description/model, body →
 * systemPrompt) or provided as a builtin by the application. Covers both
 * builtins and user-defined agents. Phase 1 carries `activeToolNames` as a
 * simple tool allowlist; Phase 2 will add a permission ruleset. Named
 * `AgentDefinition` to avoid clashing with the runtime {@link Agent} loop
 * wrapper exported from `agent.ts`.
 */
export interface AgentDefinition {
  /**
   * Phase 1 tool allowlist. When set, only these tool names are active while the
   * agent is selected. Phase 2 replaces/augments this with a permission ruleset.
   */
  activeToolNames?: string[];
  /** Short human-readable summary for menus/autocomplete. */
  description?: string;
  /** Exclude from the `@`-mention menu while still allowing explicit selection. */
  hidden?: boolean;
  /** Runtime role: top-level (`primary`), spawned for subtasks (`subagent`), or both (`all`). */
  mode: AgentMode;
  /** Override the model used while this agent is active. */
  model?: { providerId: string; modelId: string };
  /** Stable agent name used for `@`-mention lookup and switching. */
  name: string;
  /** System prompt used while this agent is active. */
  systemPrompt: string;
  /** Override the reasoning level used while this agent is active. */
  thinkingLevel?: ThinkingLevel;
}

/** Resources made available to explicit invocation methods and system-prompt callbacks. */
export interface AgentHarnessResources<
  TSkill extends Skill = Skill,
  TPromptTemplate extends PromptTemplate = PromptTemplate,
> {
  /** Prompt templates available for explicit invocation. */
  promptTemplates?: TPromptTemplate[] | undefined;
  /** Skills available to the model and explicit skill invocation. */
  skills?: TSkill[] | undefined;
}

/** Curated provider request options owned by the harness and snapshotted per turn. */
export interface AgentHarnessStreamOptions {
  /** Additional request headers merged with auth and lifecycle headers. */
  headers?: Record<string, string> | undefined;
}

/** Per-request stream option patch returned by provider hooks. */
export interface AgentHarnessStreamOptionsPatch {
  /** Header patch. `undefined` values delete keys; explicit `headers: undefined` clears all headers. */
  headers?: Record<string, string | undefined>;
}

/** Kind of filesystem object as addressed by a {@link FileSystem}. Symlinks are not followed automatically. */
export type FileKind = "file" | "directory" | "symlink";

/** Stable, backend-independent file error codes returned by {@link FileSystem} file operations. */
export type FileErrorCode =
  | "aborted"
  | "not_found"
  | "permission_denied"
  | "not_directory"
  | "is_directory"
  | "invalid"
  | "not_supported"
  | "unknown";

/** Error returned by {@link FileSystem} file operations. */
export class FileError extends Error {
  /** Backend-independent error code. */
  public code: FileErrorCode;
  /** Absolute addressed path associated with the failure, when available. */
  public path: string | undefined;

  constructor(
    code: FileErrorCode,
    message: string,
    path?: string,
    cause?: Error
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "FileError";
    this.code = code;
    this.path = path;
  }
}

/** Stable, backend-independent execution error codes returned by {@link ExecutionEnv.exec}. */
export type ExecutionErrorCode =
  | "aborted"
  | "timeout"
  | "shell_unavailable"
  | "spawn_error"
  | "callback_error"
  | "unknown";

/** Error returned by {@link ExecutionEnv.exec}. */
export class ExecutionError extends Error {
  /** Backend-independent error code. */
  public code: ExecutionErrorCode;

  constructor(code: ExecutionErrorCode, message: string, cause?: Error) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "ExecutionError";
    this.code = code;
  }
}

/** Stable compaction error codes returned by compaction helpers. */
export type CompactionErrorCode =
  | "aborted"
  | "summarization_failed"
  | "invalid_session"
  | "unknown";

/** Error returned by compaction helpers. */
export class CompactionError extends Error {
  /** Backend-independent error code. */
  public code: CompactionErrorCode;

  constructor(code: CompactionErrorCode, message: string, cause?: Error) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "CompactionError";
    this.code = code;
  }
}

/** Stable branch-summary error codes returned by branch summarization helpers. */
export type BranchSummaryErrorCode =
  | "aborted"
  | "summarization_failed"
  | "invalid_session";

/** Error returned by branch summarization helpers. */
export class BranchSummaryError extends Error {
  /** Backend-independent error code. */
  public code: BranchSummaryErrorCode;

  constructor(code: BranchSummaryErrorCode, message: string, cause?: Error) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "BranchSummaryError";
    this.code = code;
  }
}

export type SessionErrorCode =
  | "not_found"
  | "invalid_session"
  | "invalid_entry"
  | "invalid_fork_target"
  | "storage"
  | "unknown";

/** Error thrown by session storage, repositories, and session tree operations. */
export class SessionError extends Error {
  /** Session subsystem error code. */
  public code: SessionErrorCode;

  constructor(code: SessionErrorCode, message: string, cause?: Error) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "SessionError";
    this.code = code;
  }
}

export type AgentHarnessErrorCode =
  | "busy"
  | "invalid_state"
  | "invalid_argument"
  | "session"
  | "hook"
  | "auth"
  | "compaction"
  | "branch_summary"
  | "unknown";

/** Public AgentHarness failure with a stable top-level classification. */
export class AgentHarnessError extends Error {
  public code: AgentHarnessErrorCode;

  constructor(code: AgentHarnessErrorCode, message: string, cause?: Error) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "AgentHarnessError";
    this.code = code;
  }
}

/** Metadata for one filesystem object in a {@link FileSystem}. */
export interface FileInfo {
  /** Object kind. Symlink targets are not followed; use {@link FileSystem.canonicalPath} explicitly. */
  kind: FileKind;
  /** Modification time as milliseconds since Unix epoch. */
  mtimeMs: number;
  /** Basename of {@link path}. */
  name: string;
  /** Absolute, syntactically normalized addressed path in the execution environment. Symlinks are not followed. */
  path: string;
  /** Size in bytes for the addressed filesystem object. */
  size: number;
}

/** Options for {@link Shell.exec}. */
export interface ExecutionEnvExecOptions {
  /** Abort signal used to terminate the command. Defaults to no abort signal. */
  abortSignal?: AbortSignal;
  /** Working directory for the command. Relative paths are resolved against {@link ExecutionEnv.cwd}. Defaults to {@link ExecutionEnv.cwd}. */
  cwd?: string;
  /** Additional environment variables for the command. Values override the environment defaults. Defaults to no overrides. */
  env?: Record<string, string>;
  /** Called with stderr chunks as they are produced. */
  onStderr?: (chunk: string) => void;
  /** Called with stdout chunks as they are produced. */
  onStdout?: (chunk: string) => void;
  /** Timeout in seconds. Implementations should return a timeout error when the command exceeds this duration. Defaults to no timeout. */
  timeout?: number;
}

/**
 * Filesystem capability used by the harness.
 *
 * Paths passed to methods may be absolute or relative to {@link cwd}. Paths returned by file operations are addressed paths
 * in the filesystem namespace, but are not canonicalized through symlinks unless returned by {@link canonicalPath}.
 *
 * Operation methods must never throw or reject. All filesystem failures, including unexpected backend failures, must be
 * encoded in the returned {@link Result}. Implementations must preserve this invariant.
 */
export interface FileSystem {
  /** Return an absolute addressed path without requiring it to exist and without resolving symlinks. */
  absolutePath(
    path: string,
    abortSignal?: AbortSignal
  ): Promise<Result<string, FileError>>;
  /** Create or append to a file, creating parent directories when supported. */
  appendFile(
    path: string,
    content: string | Uint8Array,
    abortSignal?: AbortSignal
  ): Promise<Result<void, FileError>>;
  /** Return the canonical path for an existing path, resolving symlinks where supported. */
  canonicalPath(
    path: string,
    abortSignal?: AbortSignal
  ): Promise<Result<string, FileError>>;

  /** Release filesystem resources. Must be best-effort and must not throw or reject. */
  cleanup(): Promise<void>;
  /** Create a directory. Defaults: `recursive: true`, no abort signal. */
  createDir(
    path: string,
    options?: { recursive?: boolean; abortSignal?: AbortSignal }
  ): Promise<Result<void, FileError>>;
  /** Create a temporary directory and return its absolute path. Defaults: `prefix: "tmp-"`, no abort signal. */
  createTempDir(
    prefix?: string,
    abortSignal?: AbortSignal
  ): Promise<Result<string, FileError>>;
  /** Create a temporary file and return its absolute path. Defaults: `prefix: ""`, `suffix: ""`, no abort signal. */
  createTempFile(options?: {
    prefix?: string;
    suffix?: string;
    abortSignal?: AbortSignal;
  }): Promise<Result<string, FileError>>;
  /** Current working directory for relative paths. */
  cwd: string;
  /** Return false for missing paths. Other errors, such as permission failures, return a {@link FileError}. */
  exists(
    path: string,
    abortSignal?: AbortSignal
  ): Promise<Result<boolean, FileError>>;
  /** Return metadata for the addressed path without following symlinks. */
  fileInfo(
    path: string,
    abortSignal?: AbortSignal
  ): Promise<Result<FileInfo, FileError>>;
  /** Join path segments in the filesystem namespace without requiring the result to exist. */
  joinPath(
    parts: string[],
    abortSignal?: AbortSignal
  ): Promise<Result<string, FileError>>;
  /** List direct children of a directory without following symlinks. */
  listDir(
    path: string,
    abortSignal?: AbortSignal
  ): Promise<Result<FileInfo[], FileError>>;
  /** Read a binary file. */
  readBinaryFile(
    path: string,
    abortSignal?: AbortSignal
  ): Promise<Result<Uint8Array, FileError>>;
  /** Read a UTF-8 text file. */
  readTextFile(
    path: string,
    abortSignal?: AbortSignal
  ): Promise<Result<string, FileError>>;
  /** Read UTF-8 text lines. Implementations should stop once `maxLines` lines have been read. */
  readTextLines(
    path: string,
    options?: { maxLines?: number; abortSignal?: AbortSignal }
  ): Promise<Result<string[], FileError>>;
  /** Remove a file or directory. Defaults: `recursive: false`, `force: false`, no abort signal. */
  remove(
    path: string,
    options?: {
      recursive?: boolean;
      force?: boolean;
      abortSignal?: AbortSignal;
    }
  ): Promise<Result<void, FileError>>;
  /** Create or overwrite a file, creating parent directories when supported. */
  writeFile(
    path: string,
    content: string | Uint8Array,
    abortSignal?: AbortSignal
  ): Promise<Result<void, FileError>>;
}

/** Shell execution capability used by the harness. */
export interface Shell {
  /** Release shell resources. Must be best-effort and must not throw or reject. */
  cleanup(): Promise<void>;
  /** Execute a shell command in {@link FileSystem.cwd} unless `options.cwd` is provided. */
  exec(
    command: string,
    options?: ExecutionEnvExecOptions
  ): Promise<
    Result<{ stdout: string; stderr: string; exitCode: number }, ExecutionError>
  >;
}

/** Filesystem and process execution environment used by the harness. */
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
  type: "session_info"; // legacy name, kept for backwards compatibility
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

export interface SessionStorage<
  TMetadata extends SessionMetadata = SessionMetadata,
> {
  appendEntry(entry: SessionTreeEntry): Promise<void>;
  createEntryId(): Promise<string>;
  findEntries<TType extends SessionTreeEntry["type"]>(
    type: TType
  ): Promise<Array<Extract<SessionTreeEntry, { type: TType }>>>;
  getEntries(): Promise<SessionTreeEntry[]>;
  getEntry(id: string): Promise<SessionTreeEntry | undefined>;
  getLabel(id: string): Promise<string | undefined>;
  getLeafId(): Promise<string | null>;
  getMetadata(): Promise<TMetadata>;
  getPathToRoot(leafId: string | null): Promise<SessionTreeEntry[]>;
  /** Persist a leaf entry that records the active session-tree leaf. */
  setLeafId(leafId: string | null): Promise<void>;
}

export type { Session } from "./session.ts";

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
  create(options: TCreateOptions): Promise<Session<TMetadata>>;
  delete(metadata: TMetadata): Promise<void>;
  fork(
    source: TMetadata,
    options: SessionForkOptions & TCreateOptions
  ): Promise<Session<TMetadata>>;
  list(options?: TListOptions): Promise<TMetadata[]>;
  open(metadata: TMetadata): Promise<Session<TMetadata>>;
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
  | "branch_summary"
  | "retry";

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

export interface BeforeProviderPayloadEvent {
  model: Model;
  payload: unknown;
  type: "before_provider_payload";
}

export interface AfterProviderResponseEvent {
  headers: Record<string, string>;
  status: number;
  type: "after_provider_response";
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
  | BeforeProviderPayloadEvent
  | AfterProviderResponseEvent
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

export interface BeforeProviderPayloadResult {
  payload: unknown;
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
  before_provider_payload: BeforeProviderPayloadResult | undefined;
  after_provider_response: undefined;
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
  /** Optional logger — threaded into the loop config + the llm stream() call so provider failures surface in agent.log/llm.log. */
  logger?: Logger;
  /**
   * Maximum provider turns per run. The final turn is sent with
   * `toolChoice: "none"` so the model emits a final answer instead of looping
   * on more tool calls. Unset → run until the model stops emitting tool calls.
   */
  maxSteps?: number;
  model: Model;
  /**
   * Concrete resources available to explicit invocation methods and system-prompt callbacks.
   * Applications own loading/reloading resources and should call `setResources()` with new values.
   */
  resources?: AgentHarnessResources<TSkill, TPromptTemplate>;
  session: Session;
  steeringMode?: QueueMode;
  /** Injectable stream function for testing (bypasses real LLM calls). */
  streamFn?: StreamFn;
  /** Optional logger for the LLM stream() call specifically (defaults to `logger`). Route this to `llm.log` so stream errors land separately from loop events. */
  streamLogger?: Logger;
  /** Curated stream/provider request options. Snapshotted at turn start. */
  streamOptions?: AgentHarnessStreamOptions;
  systemPrompt?:
    | string
    | ((context: {
        env: ExecutionEnv;
        session: Session;
        model: Model;
        thinkingLevel: ThinkingLevel;
        activeTools: TTool[];
        resources: AgentHarnessResources<TSkill, TPromptTemplate>;
      }) => string | Promise<string>);
  thinkingLevel?: ThinkingLevel;
  tools?: TTool[];
}

export type { AgentHarness } from "./agent-harness.ts";
