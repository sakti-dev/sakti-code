import type { AgentMessage } from "../types.ts";

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

export type SessionErrorCode =
  | "not_found"
  | "invalid_session"
  | "invalid_entry"
  | "invalid_fork_target"
  | "storage"
  | "unknown";

export class SessionError extends Error {
  public code: SessionErrorCode;

  constructor(code: SessionErrorCode, message: string, cause?: Error) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "SessionError";
    this.code = code;
  }
}

export interface Skill {
  content: string;
  description: string;
  disableModelInvocation?: boolean;
  filePath: string;
  name: string;
}

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
  details?: T;
  firstKeptEntryId: string;
  fromHook?: boolean;
  summary: string;
  tokensBefore: number;
  type: "compaction";
}

export interface BranchSummaryEntry<T = unknown> extends SessionTreeEntryBase {
  details?: T;
  fromHook?: boolean;
  fromId: string;
  summary: string;
  type: "branch_summary";
}

export interface CustomEntry<T = unknown> extends SessionTreeEntryBase {
  customType: string;
  data?: T;
  type: "custom";
}

export interface CustomMessageEntry<T = unknown> extends SessionTreeEntryBase {
  content:
    | string
    | (
        | import("@sakti-code/llm").TextContent
        | import("@sakti-code/llm").ImageContent
      )[];
  customType: string;
  details?: T;
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

export interface SessionMetadata {
  createdAt: string;
  id: string;
}

export interface SessionStorage<
  TMetadata extends SessionMetadata = SessionMetadata,
> {
  appendEntry(entry: SessionTreeEntry): Promise<void>;
  createEntryId(): Promise<string>;
  findEntries<TType extends SessionTreeEntry["type"]>(
    type: TType
  ): Promise<Extract<SessionTreeEntry, { type: TType }>[]>;
  getEntries(): Promise<SessionTreeEntry[]>;
  getEntry(id: string): Promise<SessionTreeEntry | undefined>;
  getLabel(id: string): Promise<string | undefined>;
  getLeafId(): Promise<string | null>;
  getMetadata(): Promise<TMetadata>;
  getPathToRoot(leafId: string | null): Promise<SessionTreeEntry[]>;
  setLeafId(leafId: string | null): Promise<void>;
}
