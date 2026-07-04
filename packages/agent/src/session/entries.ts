import type { ImageContent, Model, TextContent } from "@sakti-code/llm";
import type { SessionShape } from "../session/session";
import type { AgentMessage } from "../types";

export type { ThinkingLevel } from "../types";

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

export interface ObservationPruneEntry extends SessionTreeEntryBase {
  /** Cumulative set of session entry IDs whose messages have been observed.
   * The context builder skips these — their content is available as
   * compressed observations in the system prompt. */
  observedEntryIds: string[];
  /** Link to the OM record for cross-referencing. */
  observationRecordId: string;
  type: "observation_prune";
}

export type SessionTreeEntry =
  | MessageEntry
  | ThinkingLevelChangeEntry
  | ModelChangeEntry
  | ActiveToolsChangeEntry
  | BranchSummaryEntry
  | CustomEntry
  | CustomMessageEntry
  | LabelEntry
  | SessionInfoEntry
  | LeafEntry
  | ObservationPruneEntry;

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
  fork(source: TMetadata, options: SessionForkOptions & TCreateOptions): Promise<SessionShape>;
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

export interface JsonlSessionRepoApi extends SessionRepo<
  JsonlSessionMetadata,
  JsonlSessionCreateOptions,
  JsonlSessionListOptions
> {}

export type PendingSessionWrite = SessionTreeEntry extends infer TEntry
  ? TEntry extends SessionTreeEntry
    ? Omit<TEntry, "id" | "parentId" | "timestamp">
    : never
  : never;

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

import { Schema } from "effect";

export class FileError extends Schema.TaggedErrorClass<FileError>()("FileError", {
  code: FileErrorCode,
  message: Schema.String,
  path: Schema.optional(Schema.String),
  cause: Schema.optional(Schema.Defect()),
}) {}

export interface FileInfo {
  kind: FileKind;
  mtimeMs: number;
  name: string;
  path: string;
  size: number;
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

export class SessionError extends Schema.TaggedErrorClass<SessionError>()("SessionError", {
  code: SessionErrorCode,
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

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

export type { Session, SessionShape } from "./session.ts";
