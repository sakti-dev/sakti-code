import type { ImageContent, Model, TextContent } from "@sakti-code/llm";
import type { Logger } from "@sakti-code/logger";
import { Schema } from "effect";
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
import type { Session } from "./session.ts";

export type Result<TValue, TError> =
  | { ok: true; value: TValue }
  | { ok: false; error: TError };

export function ok<TValue, TError>(value: TValue): Result<TValue, TError> {
  return { ok: true, value };
}

export function err<TValue, TError>(error: TError): Result<TValue, TError> {
  return { ok: false, error };
}

export function getOrThrow<TValue, TError>(
  result: Result<TValue, TError>
): TValue {
  if (!result.ok) {
    throw result.error;
  }
  return result.value;
}

export function getOrUndefined<TValue extends object, TError>(
  result: Result<TValue, TError>
): TValue | undefined {
  return result.ok ? result.value : undefined;
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

export type FileErrorCode =
  | "aborted"
  | "not_found"
  | "permission_denied"
  | "not_directory"
  | "is_directory"
  | "invalid"
  | "not_supported"
  | "unknown";

export class FileError extends Error {
  public code: FileErrorCode;
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

export type ExecutionErrorCode =
  | "aborted"
  | "timeout"
  | "shell_unavailable"
  | "spawn_error"
  | "callback_error"
  | "unknown";

export class ExecutionError extends Error {
  public code: ExecutionErrorCode;

  constructor(code: ExecutionErrorCode, message: string, cause?: Error) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "ExecutionError";
    this.code = code;
  }
}

export type CompactionErrorCode =
  | "aborted"
  | "summarization_failed"
  | "invalid_session"
  | "unknown";

export class CompactionError extends Error {
  public code: CompactionErrorCode;

  constructor(code: CompactionErrorCode, message: string, cause?: Error) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "CompactionError";
    this.code = code;
  }
}

export type BranchSummaryErrorCode =
  | "aborted"
  | "summarization_failed"
  | "invalid_session";

export class BranchSummaryError extends Error {
  public code: BranchSummaryErrorCode;

  constructor(code: BranchSummaryErrorCode, message: string, cause?: Error) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "BranchSummaryError";
    this.code = code;
  }
}

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

export class AgentHarnessError extends Error {
  public code: AgentHarnessErrorCode;

  constructor(code: AgentHarnessErrorCode, message: string, cause?: Error) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "AgentHarnessError";
    this.code = code;
  }
}

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
  logger?: Logger;
  maxSteps?: number;
  model: Model;
  resources?: AgentHarnessResources<TSkill, TPromptTemplate>;
  session: Session;
  steeringMode?: QueueMode;
  streamFn?: StreamFn;
  streamLogger?: Logger;
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
