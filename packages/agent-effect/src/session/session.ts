import type { ImageContent, TextContent } from "@sakti-code/llm";
import { Context, Effect, Layer } from "effect";
import type { AgentMessage } from "~/types";
import type {
  ActiveToolsChangeEntry,
  BranchSummaryEntry,
  CompactionEntry,
  CustomEntry,
  CustomMessageEntry,
  LabelEntry,
  MessageEntry,
  ModelChangeEntry,
  SessionContext,
  SessionInfoEntry,
  SessionMetadata,
  SessionTreeEntry,
  ThinkingLevelChangeEntry,
} from "./entries.ts";
import { SessionError } from "./entries.ts";
import {
  createBranchSummaryMessage,
  createCompactionSummaryMessage,
  createCustomMessage,
} from "./messages.ts";
import { SessionStorage } from "./storage.ts";

export function buildSessionContextFromEntries(
  pathEntries: SessionTreeEntry[]
): SessionContext {
  let thinkingLevel = "off";
  let model: { provider: string; modelId: string } | null = null;
  let activeToolNames: string[] | null = null;
  let compaction: CompactionEntry | null = null;

  for (const entry of pathEntries) {
    if (entry.type === "thinking_level_change") {
      thinkingLevel = entry.thinkingLevel;
    } else if (entry.type === "model_change") {
      model = { provider: entry.provider, modelId: entry.modelId };
    } else if (entry.type === "message" && entry.message.role === "assistant") {
      model = {
        provider: entry.message.provider,
        modelId: entry.message.model,
      };
    } else if (entry.type === "active_tools_change") {
      activeToolNames = [...entry.activeToolNames];
    } else if (entry.type === "compaction") {
      compaction = entry;
    }
  }

  const messages: AgentMessage[] = [];
  const appendMessage = (entry: SessionTreeEntry) => {
    if (entry.type === "message") {
      messages.push(entry.message as AgentMessage);
    } else if (entry.type === "custom_message") {
      messages.push(
        createCustomMessage(
          entry.customType,
          entry.content as string | (TextContent | ImageContent)[],
          entry.display,
          entry.details,
          entry.timestamp
        )
      );
    } else if (entry.type === "branch_summary" && entry.summary) {
      messages.push(
        createBranchSummaryMessage(entry.summary, entry.fromId, entry.timestamp)
      );
    }
  };

  if (compaction) {
    messages.push(
      createCompactionSummaryMessage(
        compaction.summary,
        compaction.tokensBefore,
        compaction.timestamp
      )
    );
    const compactionIdx = pathEntries.findIndex(
      (e) => e.type === "compaction" && e.id === compaction!.id
    );
    let foundFirstKept = false;
    for (let i = 0; i < compactionIdx; i++) {
      const entry = pathEntries[i]!;
      if (entry.id === compaction.firstKeptEntryId) {
        foundFirstKept = true;
      }
      if (foundFirstKept) {
        appendMessage(entry);
      }
    }
    for (let i = compactionIdx + 1; i < pathEntries.length; i++) {
      appendMessage(pathEntries[i]!);
    }
  } else {
    for (const entry of pathEntries) {
      appendMessage(entry);
    }
  }

  return { messages, thinkingLevel, model, activeToolNames };
}

export interface SessionShape {
  readonly appendActiveToolsChange: (
    activeToolNames: string[]
  ) => Effect.Effect<string, SessionError>;
  readonly appendCompaction: <T = unknown>(
    summary: string,
    firstKeptEntryId: string,
    tokensBefore: number,
    details?: T,
    fromHook?: boolean
  ) => Effect.Effect<string, SessionError>;
  readonly appendCustomEntry: (
    customType: string,
    data?: unknown
  ) => Effect.Effect<string, SessionError>;
  readonly appendCustomMessageEntry: <T = unknown>(
    customType: string,
    content: string | (TextContent | ImageContent)[],
    display: boolean,
    details?: T
  ) => Effect.Effect<string, SessionError>;
  readonly appendLabel: (
    targetId: string,
    label: string | undefined
  ) => Effect.Effect<string, SessionError>;
  readonly appendMessage: (
    message: AgentMessage
  ) => Effect.Effect<string, SessionError>;
  readonly appendModelChange: (
    provider: string,
    modelId: string
  ) => Effect.Effect<string, SessionError>;
  readonly appendSessionName: (
    name: string
  ) => Effect.Effect<string, SessionError>;
  readonly appendThinkingLevelChange: (
    thinkingLevel: string
  ) => Effect.Effect<string, SessionError>;
  readonly buildContext: () => Effect.Effect<SessionContext, SessionError>;
  readonly getBranch: (
    fromId?: string
  ) => Effect.Effect<SessionTreeEntry[], SessionError>;
  readonly getEntries: () => Effect.Effect<SessionTreeEntry[], SessionError>;
  readonly getEntry: (
    id: string
  ) => Effect.Effect<SessionTreeEntry | undefined, SessionError>;
  readonly getLabel: (
    id: string
  ) => Effect.Effect<string | undefined, SessionError>;
  readonly getLeafId: () => Effect.Effect<string | null, SessionError>;
  readonly getMetadata: () => Effect.Effect<SessionMetadata, SessionError>;
  readonly getSessionName: () => Effect.Effect<
    string | undefined,
    SessionError
  >;
  readonly moveTo: (
    entryId: string | null,
    summary?: {
      summary: string;
      details?: unknown;
      fromHook?: boolean;
    }
  ) => Effect.Effect<string | undefined, SessionError>;
}

export class Session extends Context.Service<Session, SessionShape>()(
  "@sakti-code/agent-effect/Session"
) {}

export const SessionLive: Layer.Layer<Session, SessionError, SessionStorage> =
  Layer.effect(
    Session,
    Effect.gen(function* () {
      const storage = yield* SessionStorage;

      const getMetadata = () => storage.getMetadata();
      const getLeafId = () => storage.getLeafId();
      const getEntry = (id: string) => storage.getEntry(id);
      const getEntries = () => storage.getEntries();
      const getLabel = (id: string) => storage.getLabel(id);

      const getBranch = Effect.fnUntraced(function* (fromId?: string) {
        const leafId = fromId ?? (yield* storage.getLeafId());
        return yield* storage.getPathToRoot(leafId);
      });

      const buildContext = Effect.fnUntraced(function* () {
        const branch = yield* getBranch();
        return buildSessionContextFromEntries(branch);
      });

      const getSessionName = Effect.fnUntraced(function* () {
        const entries = yield* storage.findEntries("session_info");
        return entries[entries.length - 1]?.name?.trim() || undefined;
      });

      const appendMessage = Effect.fnUntraced(function* (
        message: AgentMessage
      ) {
        const id = yield* storage.createEntryId();
        const parentId = yield* storage.getLeafId();
        const entry: MessageEntry = {
          type: "message",
          id,
          parentId,
          timestamp: new Date().toISOString(),
          message,
        };
        yield* storage.appendEntry(entry);
        return id;
      });

      const appendThinkingLevelChange = Effect.fnUntraced(function* (
        thinkingLevel: string
      ) {
        const id = yield* storage.createEntryId();
        const parentId = yield* storage.getLeafId();
        const entry: ThinkingLevelChangeEntry = {
          type: "thinking_level_change",
          id,
          parentId,
          timestamp: new Date().toISOString(),
          thinkingLevel,
        };
        yield* storage.appendEntry(entry);
        return id;
      });

      const appendModelChange = Effect.fnUntraced(function* (
        provider: string,
        modelId: string
      ) {
        const id = yield* storage.createEntryId();
        const parentId = yield* storage.getLeafId();
        const entry: ModelChangeEntry = {
          type: "model_change",
          id,
          parentId,
          timestamp: new Date().toISOString(),
          provider,
          modelId,
        };
        yield* storage.appendEntry(entry);
        return id;
      });

      const appendActiveToolsChange = Effect.fnUntraced(function* (
        activeToolNames: string[]
      ) {
        const id = yield* storage.createEntryId();
        const parentId = yield* storage.getLeafId();
        const entry: ActiveToolsChangeEntry = {
          type: "active_tools_change",
          id,
          parentId,
          timestamp: new Date().toISOString(),
          activeToolNames: [...activeToolNames],
        };
        yield* storage.appendEntry(entry);
        return id;
      });

      const appendCompaction = Effect.fnUntraced(function* <T = unknown>(
        summary: string,
        firstKeptEntryId: string,
        tokensBefore: number,
        details?: T,
        fromHook?: boolean
      ) {
        const id = yield* storage.createEntryId();
        const parentId = yield* storage.getLeafId();
        const entry: CompactionEntry<T> = {
          type: "compaction",
          id,
          parentId,
          timestamp: new Date().toISOString(),
          summary,
          firstKeptEntryId,
          tokensBefore,
          details,
          fromHook,
        };
        yield* storage.appendEntry(entry);
        return id;
      });

      const appendCustomEntry = Effect.fnUntraced(function* (
        customType: string,
        data?: unknown
      ) {
        const id = yield* storage.createEntryId();
        const parentId = yield* storage.getLeafId();
        const entry: CustomEntry = {
          type: "custom",
          id,
          parentId,
          timestamp: new Date().toISOString(),
          customType,
          data,
        };
        yield* storage.appendEntry(entry);
        return id;
      });

      const appendCustomMessageEntry = Effect.fnUntraced(function* <
        T = unknown,
      >(
        customType: string,
        content: string | (TextContent | ImageContent)[],
        display: boolean,
        details?: T
      ) {
        const id = yield* storage.createEntryId();
        const parentId = yield* storage.getLeafId();
        const entry: CustomMessageEntry<T> = {
          type: "custom_message",
          id,
          parentId,
          timestamp: new Date().toISOString(),
          customType,
          content,
          display,
          details,
        };
        yield* storage.appendEntry(entry);
        return id;
      });

      const appendLabel = Effect.fnUntraced(function* (
        targetId: string,
        label: string | undefined
      ) {
        const target = yield* storage.getEntry(targetId);
        if (!target) {
          return yield* new SessionError({
            code: "not_found",
            message: `Entry ${targetId} not found`,
          });
        }
        const id = yield* storage.createEntryId();
        const parentId = yield* storage.getLeafId();
        const entry: LabelEntry = {
          type: "label",
          id,
          parentId,
          timestamp: new Date().toISOString(),
          targetId,
          label,
        };
        yield* storage.appendEntry(entry);
        return id;
      });

      const appendSessionName = Effect.fnUntraced(function* (name: string) {
        const id = yield* storage.createEntryId();
        const parentId = yield* storage.getLeafId();
        const entry: SessionInfoEntry = {
          type: "session_info",
          id,
          parentId,
          timestamp: new Date().toISOString(),
          name: name.trim(),
        };
        yield* storage.appendEntry(entry);
        return id;
      });

      const moveTo = Effect.fnUntraced(function* (
        entryId: string | null,
        summary?: {
          summary: string;
          details?: unknown;
          fromHook?: boolean;
        }
      ) {
        if (entryId !== null) {
          const target = yield* storage.getEntry(entryId);
          if (!target) {
            return yield* new SessionError({
              code: "not_found",
              message: `Entry ${entryId} not found`,
            });
          }
        }
        yield* storage.setLeafId(entryId);
        if (!summary) {
          return;
        }
        const id = yield* storage.createEntryId();
        const entry: BranchSummaryEntry = {
          type: "branch_summary",
          id,
          parentId: entryId,
          timestamp: new Date().toISOString(),
          fromId: entryId ?? "root",
          summary: summary.summary,
          details: summary.details,
          fromHook: summary.fromHook,
        };
        yield* storage.appendEntry(entry);
        return id;
      });

      const shape: SessionShape = {
        getMetadata,
        getLeafId,
        getEntry,
        getEntries,
        getLabel,
        getBranch,
        buildContext,
        getSessionName,
        appendMessage,
        appendThinkingLevelChange,
        appendModelChange,
        appendActiveToolsChange,
        appendCompaction,
        appendCustomEntry,
        appendCustomMessageEntry,
        appendLabel,
        appendSessionName,
        moveTo,
      };
      return shape;
    })
  );

export const buildSessionContext = (
  fromId?: string
): Effect.Effect<SessionContext, SessionError, Session> =>
  Effect.gen(function* () {
    const session = yield* Session;
    const branch = yield* session.getBranch(fromId);
    return buildSessionContextFromEntries(branch);
  });
