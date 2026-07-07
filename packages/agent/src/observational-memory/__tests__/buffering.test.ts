import type { CompleteResult, Model, Usage } from "@sakti-code/llm";
import { complete } from "@sakti-code/llm";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type {
  CreateObservationalMemoryInput,
  ObservationalMemoryRecord,
  ObservationalMemoryStorage,
  SwapBufferedToActiveResult,
  UpdateActiveObservationsInput,
  UpdateBufferedObservationsInput,
  UpdateBufferedReflectionInput,
} from "../../observational-memory-storage.ts";
import type { MessageEntry, ObservationEntry, SessionTreeEntry } from "../../session/entries.ts";
import { buildSessionContextFromEntries } from "../../session/session.ts";
import type { SessionStorageShape } from "../../session/storage.ts";
import type { AgentEvent, AgentMessage } from "../../types.ts";
import type { ObservationalMemoryDeps } from "../config.ts";
import { ObservationalMemoryEngine } from "../engine.ts";
import { BufferingCoordinator } from "../buffering-coordinator.ts";
import { TokenCounter } from "../token-counter.ts";

vi.mock("@sakti-code/llm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@sakti-code/llm")>();
  return {
    ...actual,
    complete: vi.fn(),
  };
});

function createMockUsage(): Usage {
  return {
    input: 0,
    output: 0,
    totalTokens: 0,
    cacheRead: 0,
    cacheWrite: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function createFauxModel(): Model {
  return {
    id: "faux",
    name: "faux",
    api: "ai-sdk",
    provider: "faux",
    baseUrl: "",
    reasoning: false,
    input: ["text"],
    contextWindow: 200_000,
    maxTokens: 8192,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };
}

function completeTextResult(text: string): CompleteResult {
  return {
    content: [{ type: "text", text }],
    finishReason: "stop",
    usage: createMockUsage(),
  };
}

function completeErrorResult(message: string): CompleteResult {
  return {
    content: [],
    errorMessage: message,
    finishReason: "error",
    usage: createMockUsage(),
  };
}

function setCompleteResponse(text: string): void {
  vi.mocked(complete).mockImplementation(async () => completeTextResult(text));
}

class FakeObservationalMemoryStorage implements ObservationalMemoryStorage {
  private records: Map<string, ObservationalMemoryRecord> = new Map();
  private nextId = 1;

  async getObservationalMemory(
    threadId: string | null,
    resourceId: string,
  ): Promise<ObservationalMemoryRecord | null> {
    const records = Array.from(this.records.values())
      .filter((r) => (threadId ? r.threadId === threadId : r.resourceId === resourceId))
      .sort((a, b) => b.generationCount - a.generationCount);
    return records[0] ?? null;
  }

  async getObservationalMemoryHistory(): Promise<ObservationalMemoryRecord[]> {
    return [];
  }

  async initializeObservationalMemory(
    input: CreateObservationalMemoryInput,
  ): Promise<ObservationalMemoryRecord> {
    const id = `om-${this.nextId++}`;
    const now = new Date();
    const record: ObservationalMemoryRecord = {
      id,
      scope: input.scope,
      threadId: input.threadId,
      resourceId: input.resourceId,
      createdAt: now,
      updatedAt: now,
      originType: "initial",
      generationCount: 0,
      activeObservations: "",
      totalTokensObserved: 0,
      observationTokenCount: 0,
      pendingMessageTokens: 0,
      isObserving: false,
      isReflecting: false,
      isBufferingObservation: false,
      isBufferingReflection: false,
      lastBufferedAtTokens: 0,
      config: input.config,
    };
    this.records.set(id, record);
    return record;
  }

  async insertObservationalMemoryRecord(): Promise<void> {
    // vestigial
  }

  async updateActiveObservations(input: UpdateActiveObservationsInput): Promise<void> {
    const record = this.records.get(input.id);
    if (!record) throw new Error(`Record not found: ${input.id}`);
    record.activeObservations = input.observations;
    record.lastObservedAt = input.lastObservedAt;
    record.observationTokenCount = input.tokenCount;
    record.pendingMessageTokens = 0;
    record.totalTokensObserved += input.tokenCount;
    if (input.observedMessageIds) record.observedMessageIds = input.observedMessageIds;
    record.updatedAt = new Date();
  }

  async createReflectionGeneration(input: {
    currentRecord: ObservationalMemoryRecord;
    reflection: string;
    tokenCount: number;
  }): Promise<ObservationalMemoryRecord> {
    const c = input.currentRecord;
    const id = `om-${this.nextId++}`;
    const now = new Date();
    const newRecord: ObservationalMemoryRecord = {
      ...c,
      id,
      originType: "reflection",
      generationCount: c.generationCount + 1,
      activeObservations: input.reflection,
      observationTokenCount: input.tokenCount,
      pendingMessageTokens: 0,
      isReflecting: false,
      isBufferingObservation: false,
      isBufferingReflection: false,
      lastBufferedAtTokens: 0,
      lastReflectionAt: now,
      createdAt: now,
      updatedAt: now,
    };
    this.records.set(id, newRecord);
    return newRecord;
  }

  async setReflectingFlag(id: string, isReflecting: boolean): Promise<void> {
    const record = this.records.get(id);
    if (!record) throw new Error(`Record not found: ${id}`);
    record.isReflecting = isReflecting;
    record.updatedAt = new Date();
  }

  async setObservingFlag(): Promise<void> {
    // vestigial
  }

  async setBufferingObservationFlag(
    id: string,
    isBuffering: boolean,
    lastBufferedAtTokens?: number,
  ): Promise<void> {
    const record = this.records.get(id);
    if (!record) throw new Error(`Record not found: ${id}`);
    record.isBufferingObservation = isBuffering;
    if (lastBufferedAtTokens !== undefined) record.lastBufferedAtTokens = lastBufferedAtTokens;
    record.updatedAt = new Date();
  }

  async setBufferingReflectionFlag(id: string, isBuffering: boolean): Promise<void> {
    const record = this.records.get(id);
    if (!record) throw new Error(`Record not found: ${id}`);
    record.isBufferingReflection = isBuffering;
    record.updatedAt = new Date();
  }

  async clearObservationalMemory(): Promise<void> {
    // not used
  }

  async pruneHistory(threadId: string | null, resourceId: string, keepId: string): Promise<void> {
    for (const [id, record] of this.records) {
      if (id === keepId) continue;
      const matches = threadId ? record.threadId === threadId : record.resourceId === resourceId;
      if (matches) this.records.delete(id);
    }
  }

  async setPendingMessageTokens(id: string, tokenCount: number): Promise<void> {
    const record = this.records.get(id);
    if (!record) throw new Error(`Record not found: ${id}`);
    record.pendingMessageTokens = tokenCount;
    record.updatedAt = new Date();
  }

  async updateObservationalMemoryConfig(): Promise<void> {
    // not used
  }

  async updateBufferedObservations(input: UpdateBufferedObservationsInput): Promise<void> {
    const record = this.records.get(input.id);
    if (!record) throw new Error(`Record not found: ${input.id}`);
    const chunks = record.bufferedObservationChunks ?? [];
    chunks.push({
      ...input.chunk,
      id: `chunk-${chunks.length + 1}`,
      createdAt: new Date(),
    });
    record.bufferedObservationChunks = chunks;
    if (input.lastBufferedAtTime) record.lastBufferedAtTime = input.lastBufferedAtTime;
    record.updatedAt = new Date();
  }

  async swapBufferedToActive(input: {
    id: string;
    messageTokensThreshold: number;
    activationRatio: number;
    currentPendingTokens: number;
    forceMaxActivation: boolean;
  }): Promise<SwapBufferedToActiveResult> {
    const record = this.records.get(input.id);
    if (!record) throw new Error(`Record not found: ${input.id}`);
    const chunks = record.bufferedObservationChunks ?? [];
    if (chunks.length === 0) {
      return {
        chunksActivated: 0,
        messageTokensActivated: 0,
        observationTokensActivated: 0,
        messagesActivated: 0,
        activatedCycleIds: [],
        activatedMessageIds: [],
      };
    }

    const retentionFloor = input.messageTokensThreshold * (1 - input.activationRatio);
    const target = Math.max(0, input.currentPendingTokens - retentionFloor);
    let cumulative = 0;
    let boundary = 0;
    for (let i = 0; i < chunks.length; i++) {
      cumulative += chunks[i]!.messageTokens ?? 0;
      if (cumulative >= target) {
        boundary = i + 1;
        break;
      }
    }
    if (boundary === 0) boundary = chunks.length;

    const activated = chunks.slice(0, boundary);
    const remaining = chunks.slice(boundary);
    const activatedContent = activated.map((c) => c.observations).join("\n\n");
    const activatedTokens = activated.reduce((sum, c) => sum + c.tokenCount, 0);
    const activatedMessageTokens = activated.reduce((sum, c) => sum + (c.messageTokens ?? 0), 0);
    const activatedMessageCount = activated.reduce((sum, c) => sum + c.messageIds.length, 0);

    record.activeObservations = record.activeObservations
      ? `${record.activeObservations}\n\n${activatedContent}`
      : activatedContent;
    record.observationTokenCount += activatedTokens;
    record.pendingMessageTokens = Math.max(0, record.pendingMessageTokens - activatedMessageTokens);
    if (remaining.length > 0) {
      record.bufferedObservationChunks = remaining;
    } else {
      delete record.bufferedObservationChunks;
    }
    record.updatedAt = new Date();

    return {
      chunksActivated: activated.length,
      messageTokensActivated: activatedMessageTokens,
      observationTokensActivated: activatedTokens,
      messagesActivated: activatedMessageCount,
      activatedCycleIds: activated.map((c) => c.cycleId),
      activatedMessageIds: activated.flatMap((c) => c.messageIds),
    };
  }

  async clearBufferedObservations(id: string): Promise<void> {
    const record = this.records.get(id);
    if (record) delete record.bufferedObservationChunks;
  }

  async updateBufferedReflection(input: UpdateBufferedReflectionInput): Promise<void> {
    const record = this.records.get(input.id);
    if (!record) throw new Error(`Record not found: ${input.id}`);
    record.bufferedReflection = record.bufferedReflection
      ? `${record.bufferedReflection}\n\n${input.reflection}`
      : input.reflection;
    record.bufferedReflectionTokens = (record.bufferedReflectionTokens ?? 0) + input.tokenCount;
    record.bufferedReflectionInputTokens =
      (record.bufferedReflectionInputTokens ?? 0) + input.inputTokenCount;
    record.reflectedObservationLineCount = input.reflectedObservationLineCount;
    record.updatedAt = new Date();
  }

  async swapBufferedReflectionToActive(input: {
    currentRecord: ObservationalMemoryRecord;
    tokenCount: number;
  }): Promise<ObservationalMemoryRecord> {
    const c = input.currentRecord;
    const record = this.records.get(c.id);
    if (!record) throw new Error(`Record not found: ${c.id}`);

    const allLines = (record.activeObservations ?? "").split("\n");
    const reflectedLineCount = record.reflectedObservationLineCount ?? 0;
    const unreflectedLines = allLines.slice(reflectedLineCount);
    const unreflectedContent = unreflectedLines.join("\n").trim();
    const newObservations = unreflectedContent
      ? `${record.bufferedReflection}\n\n${unreflectedContent}`
      : record.bufferedReflection;

    const id = `om-${this.nextId++}`;
    const now = new Date();
    const newRecord: ObservationalMemoryRecord = {
      ...c,
      id,
      originType: "reflection",
      generationCount: c.generationCount + 1,
      activeObservations: newObservations ?? "",
      observationTokenCount: input.tokenCount,
      pendingMessageTokens: 0,
      isReflecting: false,
      isBufferingObservation: false,
      isBufferingReflection: false,
      lastBufferedAtTokens: 0,
      lastReflectionAt: now,
      createdAt: now,
      updatedAt: now,
    };
    delete newRecord.bufferedReflection;
    delete newRecord.bufferedReflectionTokens;
    delete newRecord.bufferedReflectionInputTokens;
    delete newRecord.reflectedObservationLineCount;
    this.records.set(id, newRecord);

    delete record.bufferedReflection;
    delete record.bufferedReflectionTokens;
    delete record.bufferedReflectionInputTokens;
    delete record.reflectedObservationLineCount;
    record.updatedAt = now;

    return newRecord;
  }
}

class FakeSessionStorage implements SessionStorageShape {
  private entries: SessionTreeEntry[] = [];

  setEntries(entries: SessionTreeEntry[]): void {
    this.entries = entries;
  }

  appendEntry = (entry: SessionTreeEntry): Effect.Effect<void, never> => {
    this.entries.push(entry);
    return Effect.void;
  };

  createEntryId = (): Effect.Effect<string, never> => {
    return Effect.succeed(`entry-${Math.random().toString(36).slice(2, 11)}`);
  };

  findEntries = <TType extends SessionTreeEntry["type"]>(
    type: TType,
  ): Effect.Effect<Array<Extract<SessionTreeEntry, { type: TType }>>, never> => {
    return Effect.succeed(
      this.entries.filter(
        (entry): entry is Extract<SessionTreeEntry, { type: TType }> => entry.type === type,
      ),
    );
  };

  getEntries = (): Effect.Effect<SessionTreeEntry[], never> => {
    return Effect.succeed([...this.entries]);
  };

  getEntry = (id: string): Effect.Effect<SessionTreeEntry | undefined, never> => {
    return Effect.succeed(this.entries.find((entry) => entry.id === id));
  };

  getLabel = (): Effect.Effect<string | undefined, never> => {
    return Effect.succeed(undefined);
  };

  getLeafId = (): Effect.Effect<string | null, never> => {
    return Effect.succeed(null);
  };

  getMetadata = (): Effect.Effect<{ id: string; createdAt: string }, never> => {
    return Effect.succeed({ id: "meta-1", createdAt: new Date().toISOString() });
  };

  getPathToRoot = (): Effect.Effect<SessionTreeEntry[], never> => {
    return Effect.succeed([...this.entries]);
  };

  setLeafId = (): Effect.Effect<void, never> => {
    return Effect.void;
  };
}

function createMessageEntry(message: AgentMessage, parentId: string | null = null): MessageEntry {
  return {
    type: "message",
    id: `entry-${Math.random().toString(36).slice(2, 11)}`,
    parentId,
    timestamp: new Date().toISOString(),
    message,
  };
}

function createDeps(
  storage: FakeObservationalMemoryStorage,
  sessionStorage: FakeSessionStorage,
  buffering?: ObservationalMemoryDeps["buffering"],
): ObservationalMemoryDeps {
  return {
    storage,
    sessionId: "sess-1",
    projectId: "proj-1",
    scope: "thread",
    observeModel: createFauxModel(),
    observeApiKey: "observe-key",
    reflectModel: createFauxModel(),
    reflectApiKey: "reflect-key",
    thresholds: { observation: 100, reflection: 200 },
    tokenCounter: new TokenCounter(),
    sessionStorage,
    ...(buffering !== undefined ? { buffering } : {}),
  };
}

describe("ObservationalMemoryEngine buffering", () => {
  let storage: FakeObservationalMemoryStorage;
  let sessionStorage: FakeSessionStorage;

  beforeEach(() => {
    storage = new FakeObservationalMemoryStorage();
    sessionStorage = new FakeSessionStorage();
    BufferingCoordinator.asyncBufferingOps.clear();
    BufferingCoordinator.lastBufferedBoundary.clear();
    BufferingCoordinator.lastBufferedAtTime.clear();
    BufferingCoordinator.reflectionBufferCycleIds.clear();
  });

  afterEach(() => {
    vi.mocked(complete).mockReset();
  });

  describe("buffered observations", () => {
    it("buffers observations when pending tokens cross the buffer interval", async () => {
      const deps = createDeps(storage, sessionStorage, {
        observationBufferTokens: 20,
        observationBufferActivation: 0.5,
        reflectionBufferActivation: 1,
      });
      const engine = new ObservationalMemoryEngine({ deps });

      const record = await engine.getOrCreateRecord();
      const messages: AgentMessage[] = [
        { role: "user", content: "Hello world this is a test message", timestamp: Date.now() },
      ];
      const entry = createMessageEntry(messages[0]!);
      sessionStorage.setEntries([entry]);
      setCompleteResponse(`<observations>\n* 🔴 User said hello\n</observations>`);

      const updated = await engine.maybeBufferObservation(record, [entry], 50);

      expect(updated.id).toBe(record.id);
      expect(updated.bufferedObservationChunks).toHaveLength(1);
      expect(updated.isBufferingObservation).toBe(false);
      expect(updated.lastBufferedAtTokens).toBeGreaterThan(0);
      expect(updated.activeObservations).toBe("");
    });

    it("does not buffer when buffering config is absent", async () => {
      const deps = createDeps(storage, sessionStorage);
      const engine = new ObservationalMemoryEngine({ deps });

      const record = await engine.getOrCreateRecord();
      const messages: AgentMessage[] = [
        { role: "user", content: "Hello world this is a test message", timestamp: Date.now() },
      ];
      const entry = createMessageEntry(messages[0]!);

      const updated = await engine.maybeBufferObservation(record, [entry], 50);

      expect(updated.bufferedObservationChunks).toBeUndefined();
      expect(vi.mocked(complete)).not.toHaveBeenCalled();
    });

    it("thread scope: activates buffered observations into ObservationEntry tree entries", async () => {
      const deps = createDeps(storage, sessionStorage, {
        observationBufferTokens: 20,
        observationBufferActivation: 0.5,
        reflectionBufferActivation: 1,
      });
      const engine = new ObservationalMemoryEngine({ deps });

      const record = await engine.getOrCreateRecord();
      const t0 = Date.now();
      const messages: AgentMessage[] = [
        { role: "user", content: "First message content", timestamp: t0 },
      ];
      const entry = createMessageEntry(messages[0]!);
      sessionStorage.setEntries([entry]);
      setCompleteResponse(`<observations>\n* 🔴 First observation\n</observations>`);

      const buffered = await engine.maybeBufferObservation(record, [entry], 50);
      expect(buffered.bufferedObservationChunks).toHaveLength(1);

      const activated = await engine.maybeActivateBufferedObservations(buffered);

      // ObservationEntry appended to the session tree (thread scope).
      const obsEntries = await Effect.runPromise(sessionStorage.findEntries("observation"));
      expect(obsEntries.length).toBeGreaterThanOrEqual(1);
      expect(obsEntries[0]!.summary).toContain("First observation");
      // Chunks cleared on the record.
      expect(activated.bufferedObservationChunks ?? []).toHaveLength(0);
    });

    it("maybeObserve uses buffering below threshold and activates above threshold", async () => {
      const deps = createDeps(storage, sessionStorage, {
        observationBufferTokens: 20,
        observationBufferActivation: 0.5,
        reflectionBufferActivation: 1,
      });
      const engine = new ObservationalMemoryEngine({ deps });

      const record = await engine.getOrCreateRecord();
      const t0 = Date.now();
      const messages: AgentMessage[] = [
        { role: "user", content: "First message content", timestamp: t0 },
      ];
      sessionStorage.setEntries([createMessageEntry(messages[0]!)]);
      setCompleteResponse(`<observations>\n* 🔴 First observation\n</observations>`);

      // Below observation threshold (100) but above buffer interval (20).
      // Detached: the chunk lands asynchronously, so drain before asserting.
      await engine.maybeObserve(record);
      await engine.waitForBuffering(2_000);
      const afterBuffer = await engine.getOrCreateRecord();
      expect(afterBuffer.bufferedObservationChunks).toHaveLength(1);
      expect(afterBuffer.activeObservations).toBe("");

      // Add more messages to push pending tokens over the observation threshold
      const t1 = t0 + 1000;
      const moreMessages: AgentMessage[] = [
        { role: "user", content: "a".repeat(500), timestamp: t1 },
      ];
      sessionStorage.setEntries([
        createMessageEntry(messages[0]!),
        createMessageEntry(moreMessages[0]!, null),
      ]);

      const activated = await engine.maybeObserve(afterBuffer);
      // Thread scope: activation creates ObservationEntry tree entries.
      const obsEntries = await Effect.runPromise(sessionStorage.findEntries("observation"));
      expect(obsEntries.some((e) => e.summary.includes("First observation"))).toBe(true);
      expect(activated.bufferedObservationChunks ?? []).toHaveLength(0);
    });
  });

  describe("buffered reflection", () => {
    it("buffers reflection when observation tokens cross the activation point", async () => {
      const deps = createDeps(storage, sessionStorage, {
        observationBufferTokens: 20,
        observationBufferActivation: 0.5,
        reflectionBufferActivation: 0.5,
      });
      const engine = new ObservationalMemoryEngine({ deps });

      const record = await engine.getOrCreateRecord();
      // Seed an ObservationEntry in the tree (thread-scope source of truth).
      const obsSeed: ObservationEntry = {
        id: "obs-seed",
        parentId: null,
        timestamp: new Date().toISOString(),
        type: "observation",
        summary: "* Observation one\n* Observation two",
        observationRecordId: record.id,
      };
      await Effect.runPromise(sessionStorage.appendEntry(obsSeed));
      // Set observationTokenCount so it crosses the reflection activation point.
      await storage.updateActiveObservations({
        id: record.id,
        observations: "",
        lastObservedAt: new Date(),
        tokenCount: 120,
      });
      const seeded = await engine.getOrCreateRecord();

      setCompleteResponse(`<observations>\n* 🔴 Reflected observation\n</observations>`);

      const updated = await engine.maybeBufferReflection(seeded);

      expect(updated.bufferedReflection).toContain("Reflected observation");
      expect(updated.isBufferingReflection).toBe(false);
      expect(updated.bufferedReflectionTokens).toBeGreaterThan(0);
      expect(updated.reflectedObservationLineCount).toBeGreaterThan(0);
    });

    it("activates buffered reflection into a new generation", async () => {
      const deps = createDeps(storage, sessionStorage, {
        observationBufferTokens: 20,
        observationBufferActivation: 0.5,
        reflectionBufferActivation: 0.5,
      });
      const engine = new ObservationalMemoryEngine({ deps });

      const record = await engine.getOrCreateRecord();
      await storage.updateActiveObservations({
        id: record.id,
        observations: "* Observation one\n* Observation two\n* Observation three",
        lastObservedAt: new Date(),
        tokenCount: 120,
      });
      const seeded = await engine.getOrCreateRecord();

      setCompleteResponse(`<observations>\n* 🔴 Reflected observation\n</observations>`);
      const buffered = await engine.maybeBufferReflection(seeded);
      expect(buffered.bufferedReflection).toBeDefined();

      const activated = await engine.maybeActivateBufferedReflection(buffered);

      expect(activated.activeObservations).toContain("Reflected observation");
      expect(activated.generationCount).toBe(seeded.generationCount + 1);
      expect(activated.bufferedReflection).toBeUndefined();
      expect(activated.bufferedReflectionTokens).toBeUndefined();
      expect(activated.bufferedReflectionInputTokens).toBeUndefined();
      expect(activated.reflectedObservationLineCount).toBeUndefined();
    });

    it("maybeReflect activates buffered reflection when over threshold", async () => {
      const deps = createDeps(storage, sessionStorage, {
        observationBufferTokens: 20,
        observationBufferActivation: 0.5,
        reflectionBufferActivation: 0.5,
      });
      const engine = new ObservationalMemoryEngine({ deps });

      const record = await engine.getOrCreateRecord();
      await storage.updateActiveObservations({
        id: record.id,
        observations: "* Observation one\n* Observation two\n* Observation three",
        lastObservedAt: new Date(),
        tokenCount: 120,
      });
      const seeded = await engine.getOrCreateRecord();

      setCompleteResponse(`<observations>\n* 🔴 Reflected observation\n</observations>`);

      // First call starts detached buffered reflection; drain to let it land.
      await engine.maybeReflect(seeded);
      await engine.waitForBuffering(2_000);
      const afterBuffer = await engine.getOrCreateRecord();
      expect(afterBuffer.bufferedReflection).toBeDefined();

      // Manually bump observation tokens above reflection threshold so activation triggers
      await storage.updateActiveObservations({
        id: afterBuffer.id,
        observations: afterBuffer.activeObservations,
        lastObservedAt: new Date(),
        tokenCount: 250,
      });
      const beforeActivate = await engine.getOrCreateRecord();

      const activated = await engine.maybeReflect(beforeActivate);

      expect(activated.activeObservations).toContain("Reflected observation");
      expect(activated.bufferedReflection).toBeUndefined();
    });
  });

  describe("detached buffering", () => {
    it("getInFlightOp exposes the stored promise per kind", async () => {
      const deps = createDeps(storage, sessionStorage, {
        observationBufferTokens: 20,
        observationBufferActivation: 0.5,
        reflectionBufferActivation: 1,
      });
      const engine = new ObservationalMemoryEngine({ deps });
      const coord = engine["bufferingCoordinator"];

      // Before any op: nothing in flight.
      expect(coord.getInFlightOp("observation")).toBeUndefined();

      // Plant a promise directly and confirm the getter returns it.
      let resolveOp!: () => void;
      const p = new Promise<void>((r) => {
        resolveOp = r;
      });
      coord.setAsyncOp("observation", p);
      expect(coord.getInFlightOp("observation")).toBe(p);
      resolveOp();
      await p;
    });

    it("passes the engine abortSignal to runObserver (cancellation plumbing)", async () => {
      const ac = new AbortController();
      const deps = createDeps(storage, sessionStorage, {
        observationBufferTokens: 20,
        observationBufferActivation: 0.5,
        reflectionBufferActivation: 1,
      });
      const engine = new ObservationalMemoryEngine({
        deps,
        ...(ac ? { abortSignal: ac.signal } : {}),
      });

      const messages: AgentMessage[] = [
        { role: "user", content: "Hello world this is a test message", timestamp: Date.now() },
      ];
      const entry = createMessageEntry(messages[0]!);
      sessionStorage.setEntries([entry]);
      setCompleteResponse(`<observations>\n* x\n</observations>`);

      const record = await engine.getOrCreateRecord();
      await engine.maybeBufferObservation(record, [entry], 50);

      const lastCall = vi.mocked(complete).mock.lastCall?.[0];
      expect(lastCall?.abortSignal).toBe(ac.signal);
    });

    it("passes the engine abortSignal to runReflector (cancellation plumbing)", async () => {
      const ac = new AbortController();
      const deps = createDeps(storage, sessionStorage, {
        observationBufferTokens: 20,
        observationBufferActivation: 0.5,
        reflectionBufferActivation: 0.5,
      });
      const engine = new ObservationalMemoryEngine({
        deps,
        ...(ac ? { abortSignal: ac.signal } : {}),
      });

      const record = await engine.getOrCreateRecord();
      await storage.updateActiveObservations({
        id: record.id,
        observations: "* Observation one\n* Observation two",
        lastObservedAt: new Date(),
        tokenCount: 120,
      });
      const seeded = await engine.getOrCreateRecord();

      setCompleteResponse(`<observations>\n* Reflected\n</observations>`);
      await engine.maybeBufferReflection(seeded);

      const lastCall = vi.mocked(complete).mock.lastCall?.[0];
      expect(lastCall?.abortSignal).toBe(ac.signal);
    });

    it("maybeObserve returns immediately while the buffer observe runs detached", async () => {
      const deps = createDeps(storage, sessionStorage, {
        observationBufferTokens: 20,
        observationBufferActivation: 0.5,
        reflectionBufferActivation: 1,
      });
      const engine = new ObservationalMemoryEngine({ deps });

      // Slow observer: resolves only when we release the deferred.
      let releaseObserver!: () => void;
      const deferred = new Promise<CompleteResult>((resolve) => {
        releaseObserver = () =>
          resolve(completeTextResult(`<observations>\n* detached\n</observations>`));
      });
      vi.mocked(complete).mockImplementation(async () => deferred);

      const record = await engine.getOrCreateRecord();
      const messages: AgentMessage[] = [
        { role: "user", content: "Hello world this is a test message", timestamp: Date.now() },
      ];
      sessionStorage.setEntries([createMessageEntry(messages[0]!)]);

      // Turn hook fires detached and returns the UNCHANGED record immediately.
      const before = Date.now();
      const returned = await engine.maybeObserve(record);
      const elapsed = Date.now() - before;
      expect(returned.id).toBe(record.id);
      expect(returned.bufferedObservationChunks).toBeUndefined();
      expect(elapsed).toBeLessThan(50);

      // Now let the detached op finish and drain it.
      releaseObserver();
      await engine.waitForBuffering(2_000);
      const after = await engine.getOrCreateRecord();
      expect(after.bufferedObservationChunks?.[0]?.observations).toContain("detached");
    });

    it("maybeReflect returns immediately while the buffer reflect runs detached", async () => {
      const deps = createDeps(storage, sessionStorage, {
        observationBufferTokens: 20,
        observationBufferActivation: 0.5,
        reflectionBufferActivation: 0.5,
      });
      const engine = new ObservationalMemoryEngine({ deps });

      const record = await engine.getOrCreateRecord();
      await storage.updateActiveObservations({
        id: record.id,
        observations: "* Observation one\n* Observation two",
        lastObservedAt: new Date(),
        tokenCount: 120,
      });
      const seeded = await engine.getOrCreateRecord();

      // Slow reflector: resolves only when we release the deferred.
      let releaseReflector!: () => void;
      const deferred = new Promise<CompleteResult>((resolve) => {
        releaseReflector = () =>
          resolve(completeTextResult(`<observations>\n* detached reflection\n</observations>`));
      });
      vi.mocked(complete).mockImplementation(async () => deferred);

      // Turn hook fires detached and returns the UNCHANGED record immediately.
      const before = Date.now();
      const returned = await engine.maybeReflect(seeded);
      const elapsed = Date.now() - before;
      expect(returned.id).toBe(seeded.id);
      expect(returned.bufferedReflection).toBeUndefined();
      expect(elapsed).toBeLessThan(50);

      // Now let the detached op finish and drain it.
      releaseReflector();
      await engine.waitForBuffering(2_000);
      const after = await engine.getOrCreateRecord();
      expect(after.bufferedReflection).toContain("detached reflection");
    });

    it("a second maybeObserve while the buffer op is in flight does not double-fire", async () => {
      const deps = createDeps(storage, sessionStorage, {
        observationBufferTokens: 20,
        observationBufferActivation: 0.5,
        reflectionBufferActivation: 1,
      });
      const engine = new ObservationalMemoryEngine({ deps });

      let release!: () => void;
      const deferred = new Promise<CompleteResult>((resolve) => {
        release = () => resolve(completeTextResult(`<observations>x</observations>`));
      });
      vi.mocked(complete).mockImplementation(async () => deferred);

      const record = await engine.getOrCreateRecord();
      const messages: AgentMessage[] = [
        { role: "user", content: "Hello world this is a test message", timestamp: Date.now() },
      ];
      sessionStorage.setEntries([createMessageEntry(messages[0]!)]);

      await engine.maybeObserve(record); // fires detached op #1
      await engine.maybeObserve(record); // in flight → guard skips
      expect(vi.mocked(complete)).toHaveBeenCalledTimes(1);
      release!();
      await engine.waitForBuffering(2_000);
    });

    it("waitForBuffering blocks until a planted in-flight promise resolves", async () => {
      const deps = createDeps(storage, sessionStorage, {
        observationBufferTokens: 20,
        observationBufferActivation: 0.5,
        reflectionBufferActivation: 1,
      });
      const engine = new ObservationalMemoryEngine({ deps });
      const coord = engine["bufferingCoordinator"];

      let resolveOp!: () => void;
      const p = new Promise<void>((r) => {
        resolveOp = r;
      });
      coord.setAsyncOp("observation", p);

      let drainResolved = false;
      const drainPromise = engine.waitForBuffering(2_000).then(() => {
        drainResolved = true;
      });

      // Drain should NOT resolve while the planted promise is pending.
      await new Promise((r) => setTimeout(r, 20));
      expect(drainResolved).toBe(false);

      resolveOp();
      await drainPromise;
      expect(drainResolved).toBe(true);
    });
  });

  describe("best-effort failure handling", () => {
    it("returns unchanged record when buffer observation LLM fails", async () => {
      const deps = createDeps(storage, sessionStorage, {
        observationBufferTokens: 20,
        observationBufferActivation: 0.5,
        reflectionBufferActivation: 1,
      });
      const engine = new ObservationalMemoryEngine({ deps });

      const record = await engine.getOrCreateRecord();
      const messages: AgentMessage[] = [
        { role: "user", content: "Hello world this is a test message", timestamp: Date.now() },
      ];
      const entry = createMessageEntry(messages[0]!);
      sessionStorage.setEntries([entry]);
      vi.mocked(complete).mockImplementation(async () => completeErrorResult("provider error"));

      const updated = await engine.maybeBufferObservation(record, [entry], 50);

      expect(updated.id).toBe(record.id);
      expect(updated.bufferedObservationChunks).toBeUndefined();
      expect(updated.isBufferingObservation).toBe(false);
    });
  });

  describe("onOmEvent callback", () => {
    it("fires om_start + om_end + om_status on sync observe", async () => {
      const deps = createDeps(storage, sessionStorage);
      const events: AgentEvent[] = [];
      const engine = new ObservationalMemoryEngine({
        deps,
        onOmEvent: (e) => events.push(e),
      });

      const record = await engine.getOrCreateRecord();
      const t0 = Date.now();
      const messages: AgentMessage[] = [
        { role: "user", content: "a".repeat(500), timestamp: t0 },
        { role: "user", content: "b".repeat(500), timestamp: t0 + 1000 },
      ];
      sessionStorage.setEntries([
        createMessageEntry(messages[0]!),
        createMessageEntry(messages[1]!, null),
      ]);
      vi.mocked(complete).mockResolvedValue(
        completeTextResult("<observations>\n* 🔴 P1: test\n</observations>"),
      );

      await engine.maybeObserve(record);

      const start = events.find((e) => e.type === "om_start");
      const end = events.find((e) => e.type === "om_end");
      const status = events.find((e) => e.type === "om_status");
      expect(start).toBeDefined();
      expect(start!.operationType).toBe("observation");
      expect(end).toBeDefined();
      expect(end!.operationType).toBe("observation");
      expect(end!.observations).toContain("P1");
      expect(status).toBeDefined();
      expect(status!.windows.messages).toBeDefined();
    });

    it("fires om_failed when sync observe errors", async () => {
      const deps = createDeps(storage, sessionStorage);
      const events: AgentEvent[] = [];
      const engine = new ObservationalMemoryEngine({
        deps,
        onOmEvent: (e) => events.push(e),
      });

      const record = await engine.getOrCreateRecord();
      const t0 = Date.now();
      sessionStorage.setEntries([
        createMessageEntry({ role: "user", content: "a".repeat(500), timestamp: t0 }),
        createMessageEntry({ role: "user", content: "b".repeat(500), timestamp: t0 + 1000 }, null),
      ]);
      vi.mocked(complete).mockRejectedValue(new Error("LLM down"));

      await engine.maybeObserve(record);

      const failed = events.find((e) => e.type === "om_failed");
      expect(failed).toBeDefined();
      expect(failed!.error).toContain("LLM down");
    });

    it("fires om_start + om_end on sync reflect", async () => {
      const deps = createDeps(storage, sessionStorage);
      const events: AgentEvent[] = [];
      const engine = new ObservationalMemoryEngine({
        deps,
        onOmEvent: (e) => events.push(e),
      });

      const record = await engine.getOrCreateRecord();
      await storage.updateActiveObservations({
        id: record.id,
        observations: "test observations",
        lastObservedAt: new Date(),
        tokenCount: 250,
      });
      const seeded = await engine.getOrCreateRecord();
      vi.mocked(complete).mockResolvedValue(completeTextResult("reflected observations"));

      await engine.maybeReflect(seeded);

      const start = events.find((e) => e.type === "om_start" && e.operationType === "reflection");
      const end = events.find((e) => e.type === "om_end" && e.operationType === "reflection");
      expect(start).toBeDefined();
      expect(end).toBeDefined();
    });

    it("fires om_start/om_end with buffering operationType on buffer observation", async () => {
      const deps = createDeps(storage, sessionStorage, {
        observationBufferTokens: 20,
        observationBufferActivation: 0.5,
        reflectionBufferActivation: 1,
      });
      const events: AgentEvent[] = [];
      const engine = new ObservationalMemoryEngine({
        deps,
        onOmEvent: (e) => events.push(e),
      });

      const record = await engine.getOrCreateRecord();
      const messages: AgentMessage[] = [
        { role: "user", content: "Hello world test message", timestamp: Date.now() },
      ];
      const entry = createMessageEntry(messages[0]!);
      sessionStorage.setEntries([entry]);
      setCompleteResponse("<observations>\n* x\n</observations>");

      await engine.maybeBufferObservation(record, [entry], 50);

      const start = events.find((e) => e.type === "om_start" && e.operationType === "buffering");
      const end = events.find((e) => e.type === "om_end" && e.operationType === "buffering");
      expect(start).toBeDefined();
      expect(end).toBeDefined();
    });

    it("fires om_activation when buffered observations activate", async () => {
      const deps = createDeps(storage, sessionStorage, {
        observationBufferTokens: 20,
        observationBufferActivation: 0.5,
        reflectionBufferActivation: 1,
      });
      const events: AgentEvent[] = [];
      const engine = new ObservationalMemoryEngine({
        deps,
        onOmEvent: (e) => events.push(e),
      });

      const record = await engine.getOrCreateRecord();
      const entry = createMessageEntry({
        role: "user",
        content: "Hello world test",
        timestamp: Date.now(),
      });
      sessionStorage.setEntries([entry]);
      setCompleteResponse("<observations>\n* x\n</observations>");

      await engine.maybeBufferObservation(record, [entry], 50);
      const buffered = await engine.getOrCreateRecord();

      await engine.maybeActivateBufferedObservations(buffered);

      const activation = events.find((e) => e.type === "om_activation");
      expect(activation).toBeDefined();
    });

    it("does not throw when onOmEvent is undefined", async () => {
      const deps = createDeps(storage, sessionStorage);
      const engine = new ObservationalMemoryEngine({ deps });

      const record = await engine.getOrCreateRecord();
      const t0 = Date.now();
      sessionStorage.setEntries([
        createMessageEntry({ role: "user", content: "a".repeat(500), timestamp: t0 }),
        createMessageEntry({ role: "user", content: "b".repeat(500), timestamp: t0 + 1000 }, null),
      ]);
      vi.mocked(complete).mockResolvedValue(
        completeTextResult("<observations>\n* x\n</observations>"),
      );

      await engine.maybeObserve(record);
    });
  });

  describe("context pruning", () => {
    it("appends ObservationPruneEntry after sync observe", async () => {
      const deps = createDeps(storage, sessionStorage);
      const engine = new ObservationalMemoryEngine({ deps });

      const record = await engine.getOrCreateRecord();
      const t0 = Date.now();
      const messages: AgentMessage[] = [
        { role: "user", content: "a".repeat(500), timestamp: t0 },
        { role: "user", content: "b".repeat(500), timestamp: t0 + 1000 },
      ];
      const entries = [createMessageEntry(messages[0]!), createMessageEntry(messages[1]!, null)];
      sessionStorage.setEntries(entries);
      vi.mocked(complete).mockResolvedValue(
        completeTextResult("<observations>\n* 🔴 P1: test\n</observations>"),
      );

      await engine.maybeObserve(record);

      // Verify a prune entry was appended to the session tree
      const allEntries = await Effect.runPromise(sessionStorage.getPathToRoot());
      const pruneEntry = allEntries.find((e) => e.type === "observation_prune");
      expect(pruneEntry).toBeDefined();
      expect(pruneEntry!.type).toBe("observation_prune");
    });

    it("does not append prune entry when no observation happened", async () => {
      const deps = createDeps(storage, sessionStorage);
      const engine = new ObservationalMemoryEngine({ deps });

      const record = await engine.getOrCreateRecord();
      // No messages → no observation → no prune
      sessionStorage.setEntries([]);

      await engine.maybeObserve(record);

      const allEntries = await Effect.runPromise(sessionStorage.getPathToRoot());
      const pruneEntry = allEntries.find((e) => e.type === "observation_prune");
      expect(pruneEntry).toBeUndefined();
    });

    it("pruned messages disappear from buildSessionContextFromEntries", async () => {
      const deps = createDeps(storage, sessionStorage);
      const engine = new ObservationalMemoryEngine({ deps });

      const record = await engine.getOrCreateRecord();
      const t0 = Date.now();
      const messages: AgentMessage[] = [
        { role: "user", content: "a".repeat(500), timestamp: t0 },
        { role: "user", content: "b".repeat(500), timestamp: t0 + 1000 },
      ];
      const entries = [createMessageEntry(messages[0]!), createMessageEntry(messages[1]!, null)];
      sessionStorage.setEntries(entries);
      vi.mocked(complete).mockResolvedValue(
        completeTextResult("<observations>\n* x\n</observations>"),
      );

      await engine.maybeObserve(record);

      // After pruning, the builder should filter observed messages
      const allEntries = await Effect.runPromise(sessionStorage.getPathToRoot());
      const ctx = buildSessionContextFromEntries(allEntries);
      // The observed messages should be filtered out (replaced by observations in system prompt)
      // Since both messages were observed and no retention floor with bufferActivation=1 (no buffering)
      // all observed messages are pruned
      expect(ctx.messages.length).toBeLessThan(messages.length);
    });
  });
});
