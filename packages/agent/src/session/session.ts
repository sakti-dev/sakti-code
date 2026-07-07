import type { ImageContent, TextContent } from "@sakti-code/llm";
import { Context, Effect, Layer } from "effect";
import type { AgentMessage } from "../types";
import type {
  ActiveToolsChangeEntry,
  BranchSummaryEntry,
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
  createCustomMessage,
  createObservationMessage,
  createReflectionMessage,
} from "./messages.ts";
import type { SessionStorageShape } from "./storage.ts";
import { SessionStorage } from "./storage.ts";

export function buildSessionContextFromEntries(pathEntries: SessionTreeEntry[]): SessionContext {
  let thinkingLevel = "off";
  let model: { provider: string; modelId: string } | null = null;
  let activeToolNames: string[] | null = null;

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
    }
  }

  // Find the latest observation_prune entry (cumulative observed set).
  // The builder skips messages whose entry IDs are in this set — their
  // content is available as compressed observations in the system prompt.
  let observedEntryIds: Set<string> | undefined;
  for (let i = pathEntries.length - 1; i >= 0; i--) {
    const entry = pathEntries[i]!;
    if (entry.type === "observation_prune") {
      observedEntryIds = new Set(entry.observedEntryIds);
      break;
    }
  }

  const messages: AgentMessage[] = [];
  const appendMessage = (entry: SessionTreeEntry) => {
    if (observedEntryIds?.has(entry.id)) return;
    if (entry.type === "message") {
      messages.push(entry.message as AgentMessage);
    } else if (entry.type === "custom_message") {
      messages.push(
        createCustomMessage(
          entry.customType,
          entry.content as string | (TextContent | ImageContent)[],
          entry.display,
          entry.details,
          entry.timestamp,
        ),
      );
    } else if (entry.type === "branch_summary" && entry.summary) {
      messages.push(createBranchSummaryMessage(entry.summary, entry.fromId, entry.timestamp));
    } else if (entry.type === "observation") {
      messages.push(createObservationMessage(entry.summary, entry.timestamp));
    } else if (entry.type === "reflection") {
      messages.push(createReflectionMessage(entry.summary, entry.timestamp));
    }
  };

  for (const entry of pathEntries) {
    appendMessage(entry);
  }

  return { messages, thinkingLevel, model, activeToolNames };
}

export interface SessionShape {
  readonly appendActiveToolsChange: (
    activeToolNames: string[],
  ) => Effect.Effect<string, SessionError>;
  readonly appendCustomEntry: (
    customType: string,
    data?: unknown,
  ) => Effect.Effect<string, SessionError>;
  readonly appendCustomMessageEntry: <T = unknown>(
    customType: string,
    content: string | (TextContent | ImageContent)[],
    display: boolean,
    details?: T,
  ) => Effect.Effect<string, SessionError>;
  readonly appendLabel: (
    targetId: string,
    label: string | undefined,
  ) => Effect.Effect<string, SessionError>;
  readonly appendMessage: (message: AgentMessage) => Effect.Effect<string, SessionError>;
  readonly appendModelChange: (
    provider: string,
    modelId: string,
  ) => Effect.Effect<string, SessionError>;
  readonly appendSessionName: (name: string) => Effect.Effect<string, SessionError>;
  readonly appendThinkingLevelChange: (
    thinkingLevel: string,
  ) => Effect.Effect<string, SessionError>;
  readonly buildContext: () => Effect.Effect<SessionContext, SessionError>;
  readonly getBranch: (fromId?: string) => Effect.Effect<SessionTreeEntry[], SessionError>;
  readonly getEntries: () => Effect.Effect<SessionTreeEntry[], SessionError>;
  readonly getEntry: (id: string) => Effect.Effect<SessionTreeEntry | undefined, SessionError>;
  readonly getLabel: (id: string) => Effect.Effect<string | undefined, SessionError>;
  readonly getLeafId: () => Effect.Effect<string | null, SessionError>;
  readonly getMetadata: () => Effect.Effect<SessionMetadata, SessionError>;
  readonly getSessionName: () => Effect.Effect<string | undefined, SessionError>;
  readonly moveTo: (
    entryId: string | null,
    summary?: {
      summary: string;
      details?: unknown;
      fromHook?: boolean;
    },
  ) => Effect.Effect<string | undefined, SessionError>;
}

export class Session extends Context.Service<Session, SessionShape>()(
  "@sakti-code/agent/Session",
) {}

export const SessionLive: Layer.Layer<Session, SessionError, SessionStorage> = Layer.effect(
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

    const appendMessage = Effect.fnUntraced(function* (message: AgentMessage) {
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

    const appendThinkingLevelChange = Effect.fnUntraced(function* (thinkingLevel: string) {
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

    const appendModelChange = Effect.fnUntraced(function* (provider: string, modelId: string) {
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

    const appendActiveToolsChange = Effect.fnUntraced(function* (activeToolNames: string[]) {
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

    const appendCustomEntry = Effect.fnUntraced(function* (customType: string, data?: unknown) {
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

    const appendCustomMessageEntry = Effect.fnUntraced(function* <T = unknown>(
      customType: string,
      content: string | (TextContent | ImageContent)[],
      display: boolean,
      details?: T,
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

    const appendLabel = Effect.fnUntraced(function* (targetId: string, label: string | undefined) {
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
      },
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
      appendCustomEntry,
      appendCustomMessageEntry,
      appendLabel,
      appendSessionName,
      moveTo,
    };
    return shape;
  }),
);

export const buildSessionContext = (
  fromId?: string,
): Effect.Effect<SessionContext, SessionError, Session> =>
  Effect.gen(function* () {
    const session = yield* Session;
    const branch = yield* session.getBranch(fromId);
    return buildSessionContextFromEntries(branch);
  });

export class PromiseSession<TMetadata extends SessionMetadata = SessionMetadata> {
  private readonly storage: SessionStorageShape;

  constructor(storage: SessionStorageShape) {
    this.storage = storage;
  }

  /** Bridge an Effect-returning storage op to a Promise (legacy callers). */
  private run<T>(eff: Effect.Effect<T, SessionError>): Promise<T> {
    return Effect.runPromise(eff);
  }

  getMetadata(): Promise<TMetadata> {
    return this.run(this.storage.getMetadata()) as Promise<TMetadata>;
  }

  getStorage(): SessionStorageShape {
    return this.storage;
  }

  getLeafId(): Promise<string | null> {
    return this.run(this.storage.getLeafId());
  }

  getEntry(id: string): Promise<SessionTreeEntry | undefined> {
    return this.run(this.storage.getEntry(id));
  }

  getEntries(): Promise<SessionTreeEntry[]> {
    return this.run(this.storage.getEntries());
  }

  async getBranch(fromId?: string): Promise<SessionTreeEntry[]> {
    const leafId = fromId ?? (await this.run(this.storage.getLeafId()));
    return this.run(this.storage.getPathToRoot(leafId));
  }

  async buildContext(): Promise<SessionContext> {
    return buildSessionContextFromEntries(await this.getBranch());
  }

  getLabel(id: string): Promise<string | undefined> {
    return this.run(this.storage.getLabel(id));
  }

  async getSessionName(): Promise<string | undefined> {
    const entries = await this.run(this.storage.findEntries("session_info"));
    return entries[entries.length - 1]?.name?.trim() || undefined;
  }

  private async appendTypedEntry<TEntry extends SessionTreeEntry>(entry: TEntry): Promise<string> {
    await this.run(this.storage.appendEntry(entry));
    return entry.id;
  }

  async appendMessage(message: AgentMessage): Promise<string> {
    return this.appendTypedEntry({
      type: "message",
      id: await this.run(this.storage.createEntryId()),
      parentId: await this.run(this.storage.getLeafId()),
      timestamp: new Date().toISOString(),
      message,
    } satisfies MessageEntry);
  }

  async appendThinkingLevelChange(thinkingLevel: string): Promise<string> {
    return this.appendTypedEntry({
      type: "thinking_level_change",
      id: await this.run(this.storage.createEntryId()),
      parentId: await this.run(this.storage.getLeafId()),
      timestamp: new Date().toISOString(),
      thinkingLevel,
    } satisfies ThinkingLevelChangeEntry);
  }

  async appendModelChange(provider: string, modelId: string): Promise<string> {
    return this.appendTypedEntry({
      type: "model_change",
      id: await this.run(this.storage.createEntryId()),
      parentId: await this.run(this.storage.getLeafId()),
      timestamp: new Date().toISOString(),
      provider,
      modelId,
    } satisfies ModelChangeEntry);
  }

  async appendActiveToolsChange(activeToolNames: string[]): Promise<string> {
    return this.appendTypedEntry({
      type: "active_tools_change",
      id: await this.run(this.storage.createEntryId()),
      parentId: await this.run(this.storage.getLeafId()),
      timestamp: new Date().toISOString(),
      activeToolNames: [...activeToolNames],
    } satisfies ActiveToolsChangeEntry);
  }

  async appendCustomEntry(customType: string, data?: unknown): Promise<string> {
    return this.appendTypedEntry({
      type: "custom",
      id: await this.run(this.storage.createEntryId()),
      parentId: await this.run(this.storage.getLeafId()),
      timestamp: new Date().toISOString(),
      customType,
      ...(data === undefined ? {} : { data }),
    } satisfies CustomEntry);
  }

  async appendCustomMessageEntry<T = unknown>(
    customType: string,
    content: string | (TextContent | ImageContent)[],
    display: boolean,
    details?: T,
  ): Promise<string> {
    return this.appendTypedEntry({
      type: "custom_message",
      id: await this.run(this.storage.createEntryId()),
      parentId: await this.run(this.storage.getLeafId()),
      timestamp: new Date().toISOString(),
      customType,
      content,
      display,
      ...(details === undefined ? {} : { details }),
    } satisfies CustomMessageEntry<T>);
  }

  async appendLabel(targetId: string, label: string | undefined): Promise<string> {
    if (!(await this.run(this.storage.getEntry(targetId)))) {
      throw new SessionError({
        code: "not_found",
        message: `Entry ${targetId} not found`,
      });
    }
    return this.appendTypedEntry({
      type: "label",
      id: await this.run(this.storage.createEntryId()),
      parentId: await this.run(this.storage.getLeafId()),
      timestamp: new Date().toISOString(),
      targetId,
      label,
    } satisfies LabelEntry);
  }

  async appendSessionName(name: string): Promise<string> {
    return this.appendTypedEntry({
      type: "session_info",
      id: await this.run(this.storage.createEntryId()),
      parentId: await this.run(this.storage.getLeafId()),
      timestamp: new Date().toISOString(),
      name: name.trim(),
    } satisfies SessionInfoEntry);
  }

  async moveTo(
    entryId: string | null,
    summary?: {
      summary: string;
      details?: unknown;
      fromHook?: boolean;
    },
  ): Promise<string | undefined> {
    if (entryId !== null && !(await this.run(this.storage.getEntry(entryId)))) {
      throw new SessionError({
        code: "not_found",
        message: `Entry ${entryId} not found`,
      });
    }
    await this.run(this.storage.setLeafId(entryId));
    if (!summary) {
      return;
    }
    return this.appendTypedEntry({
      type: "branch_summary",
      id: await this.run(this.storage.createEntryId()),
      parentId: entryId,
      timestamp: new Date().toISOString(),
      fromId: entryId ?? "root",
      summary: summary.summary,
      ...(summary.details === undefined ? {} : { details: summary.details }),
      ...(summary.fromHook === undefined ? {} : { fromHook: summary.fromHook }),
    } satisfies BranchSummaryEntry);
  }
}

export function promiseSessionAsShape(session: PromiseSession): SessionShape {
  const wrap = <T>(fn: () => Promise<T>): Effect.Effect<T, SessionError> =>
    Effect.tryPromise({
      try: fn,
      catch: (e) =>
        e instanceof SessionError
          ? e
          : new SessionError({
              code: "unknown",
              message: e instanceof Error ? e.message : String(e),
            }),
    });

  return {
    getMetadata: () => wrap(() => session.getMetadata()),
    getLeafId: () => wrap(() => session.getLeafId()),
    getEntry: (id) => wrap(() => session.getEntry(id)),
    getEntries: () => wrap(() => session.getEntries()),
    getBranch: (fromId) => wrap(() => session.getBranch(fromId)),
    buildContext: () => wrap(() => session.buildContext()),
    getLabel: (id) => wrap(() => session.getLabel(id)),
    getSessionName: () => wrap(() => session.getSessionName()),
    appendMessage: (msg) => wrap(() => session.appendMessage(msg)),
    appendThinkingLevelChange: (level) => wrap(() => session.appendThinkingLevelChange(level)),
    appendModelChange: (provider, modelId) =>
      wrap(() => session.appendModelChange(provider, modelId)),
    appendActiveToolsChange: (names) => wrap(() => session.appendActiveToolsChange(names)),
    appendCustomEntry: (customType, data) =>
      wrap(() => session.appendCustomEntry(customType, data)),
    appendCustomMessageEntry: (customType, content, display, details) =>
      wrap(() => session.appendCustomMessageEntry(customType, content, display, details)),
    appendLabel: (targetId, label) => wrap(() => session.appendLabel(targetId, label)),
    appendSessionName: (name) => wrap(() => session.appendSessionName(name)),
    moveTo: (entryId, summary) => wrap(() => session.moveTo(entryId, summary)),
  };
}
