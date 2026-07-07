import type { CompleteResult, Model, Usage } from "@sakti-code/llm";
import { complete } from "@sakti-code/llm";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type {
  CreateObservationalMemoryInput,
  ObservationalMemoryRecord,
  ObservationalMemoryStorage,
  SwapBufferedReflectionToActiveInput,
  SwapBufferedToActiveInput,
  SwapBufferedToActiveResult,
  UpdateActiveObservationsInput,
} from "../../observational-memory-storage.ts";
import type { SessionTreeEntry } from "../../session/entries.ts";
import type { SessionStorageShape } from "../../session/storage.ts";
import type { AgentMessage } from "../../types.ts";
import { ObservationalMemoryEngine } from "../engine.ts";
import { BufferingCoordinator } from "../buffering-coordinator.ts";
import { TokenCounter } from "../token-counter.ts";
import type { ObservationalMemoryDeps } from "../config.ts";

vi.mock("@sakti-code/llm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@sakti-code/llm")>();
  return { ...actual, complete: vi.fn() };
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

function textResult(text: string): CompleteResult {
  return { content: [{ type: "text", text }], finishReason: "stop", usage: createMockUsage() };
}

function setComplete(text: string): void {
  vi.mocked(complete).mockImplementation(async () => textResult(text));
}

/**
 * Sync-only OM storage fake. Sync methods do real work; buffering methods
 * throw so we'd notice if the sync path accidentally touched them.
 */
class SyncOmStorage implements ObservationalMemoryStorage {
  records = new Map<string, ObservationalMemoryRecord>();
  private nextId = 1;
  updateActiveCalls: Array<{
    id: string;
    observations: string;
    tokenCount: number;
    observedMessageIds?: string[];
  }> = [];
  reflectionCalls: Array<{ tokenCount: number }> = [];
  reflectingFlagCalls: boolean[] = [];

  async getObservationalMemory(threadId: string | null, resourceId: string) {
    const found = [...this.records.values()]
      .filter((r) => (threadId ? r.threadId === threadId : r.resourceId === resourceId))
      .sort((a, b) => b.generationCount - a.generationCount)[0];
    return found ?? null;
  }
  async getObservationalMemoryHistory() {
    return [];
  }
  async initializeObservationalMemory(input: CreateObservationalMemoryInput) {
    const id = `om-${this.nextId++}`;
    const now = new Date();
    const rec: ObservationalMemoryRecord = {
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
    this.records.set(id, rec);
    return rec;
  }
  async insertObservationalMemoryRecord() {}
  async updateActiveObservations(input: UpdateActiveObservationsInput) {
    const r = this.records.get(input.id);
    if (!r) throw new Error(`not found: ${input.id}`);
    r.activeObservations = input.observations;
    r.observationTokenCount = input.tokenCount;
    r.pendingMessageTokens = 0;
    if (input.lastObservedAt) r.lastObservedAt = input.lastObservedAt;
    r.updatedAt = new Date();
    this.updateActiveCalls.push({
      id: input.id,
      observations: input.observations,
      tokenCount: input.tokenCount,
      ...(input.observedMessageIds ? { observedMessageIds: input.observedMessageIds } : {}),
    });
  }
  async createReflectionGeneration(input: {
    currentRecord: ObservationalMemoryRecord;
    reflection: string;
    tokenCount: number;
  }) {
    const c = input.currentRecord;
    const id = `om-${this.nextId++}`;
    const now = new Date();
    const rec: ObservationalMemoryRecord = {
      ...c,
      id,
      originType: "reflection",
      generationCount: c.generationCount + 1,
      activeObservations: input.reflection,
      observationTokenCount: input.tokenCount,
      pendingMessageTokens: 0,
      isReflecting: false,
      lastReflectionAt: now,
      createdAt: now,
      updatedAt: now,
    };
    this.records.set(id, rec);
    this.reflectionCalls.push({ tokenCount: input.tokenCount });
    return rec;
  }
  async setReflectingFlag(_id: string, isReflecting: boolean) {
    this.reflectingFlagCalls.push(isReflecting);
  }
  async setObservingFlag() {}
  async setBufferingObservationFlag() {
    throw new Error("buffering not supported in sync-only fake");
  }
  async setBufferingReflectionFlag() {
    throw new Error("buffering not supported in sync-only fake");
  }
  async clearObservationalMemory() {}
  async pruneHistory() {}
  async setPendingMessageTokens() {}
  async updateObservationalMemoryConfig() {}
  async updateBufferedObservations() {
    throw new Error("buffering not supported in sync-only fake");
  }
  async swapBufferedToActive(
    _input: SwapBufferedToActiveInput,
  ): Promise<SwapBufferedToActiveResult> {
    throw new Error("buffering not supported in sync-only fake");
  }
  async clearBufferedObservations() {}
  async updateBufferedReflection() {
    throw new Error("buffering not supported in sync-only fake");
  }
  async swapBufferedReflectionToActive(
    _input: SwapBufferedReflectionToActiveInput,
  ): Promise<ObservationalMemoryRecord> {
    throw new Error("buffering not supported in sync-only fake");
  }
}

/**
 * Session storage that HONORS the tree: getPathToRoot walks parentId, and
 * getLeafId returns the most-recently-appended entry. This is the missing
 * fidelity that let the frozen-leafId bug (C2) slip through.
 */
class TreeSessionStorage implements SessionStorageShape {
  private byId = new Map<string, SessionTreeEntry>();
  private leafId: string | null = null;

  appendChild(message: AgentMessage, ts: number): string {
    const id = `e${this.byId.size + 1}`;
    const entry: SessionTreeEntry = {
      type: "message",
      id,
      parentId: this.leafId,
      timestamp: new Date(ts).toISOString(),
      message,
    };
    this.byId.set(id, entry);
    this.leafId = id;
    return id;
  }

  appendEntry = (entry: SessionTreeEntry) =>
    Effect.sync(() => {
      this.byId.set(entry.id, entry);
      this.leafId = entry.id;
    });
  createEntryId = () => Effect.succeed(`e${this.byId.size + 1}`);
  findEntries = <TType extends SessionTreeEntry["type"]>(type: TType) =>
    Effect.succeed(
      [...this.byId.values()].filter(
        (e): e is Extract<SessionTreeEntry, { type: TType }> => e.type === type,
      ),
    );
  getEntries = () => Effect.succeed([...this.byId.values()]);
  getEntry = (id: string) => Effect.succeed(this.byId.get(id));
  getLabel = () => Effect.succeed(undefined);
  getLeafId = () => Effect.succeed(this.leafId);
  getMetadata = () => Effect.succeed({ id: "s1", createdAt: new Date(0).toISOString() });
  getPathToRoot = (leafId: string | null) => {
    if (!leafId) return Effect.succeed<SessionTreeEntry[]>([]);
    const path: SessionTreeEntry[] = [];
    let cur: SessionTreeEntry | undefined = this.byId.get(leafId);
    while (cur) {
      path.unshift(cur);
      cur = cur.parentId ? this.byId.get(cur.parentId) : undefined;
    }
    return Effect.succeed(path);
  };
  setLeafId = (id: string | null) => Effect.sync(() => void (this.leafId = id));
}

function createDeps(
  storage: SyncOmStorage,
  session: TreeSessionStorage,
  overrides: {
    thresholds?: { observation: number; reflection: number };
    logger?: ObservationalMemoryDeps["logger"];
    scope?: ObservationalMemoryDeps["scope"];
    sessionId?: string;
    projectId?: string;
  } = {},
): ObservationalMemoryDeps {
  return {
    storage,
    sessionId: overrides.sessionId ?? "sess-1",
    projectId: overrides.projectId ?? "proj-1",
    scope: overrides.scope ?? "thread",
    observeModel: createFauxModel(),
    observeApiKey: "observe-key",
    reflectModel: createFauxModel(),
    reflectApiKey: "reflect-key",
    thresholds: overrides.thresholds ?? { observation: 100, reflection: 200 },
    tokenCounter: new TokenCounter(),
    sessionStorage: session,
    ...(overrides.logger === undefined ? {} : { logger: overrides.logger }),
  };
}

describe("ObservationalMemoryEngine (sync)", () => {
  let storage: SyncOmStorage;
  let session: TreeSessionStorage;

  beforeEach(() => {
    storage = new SyncOmStorage();
    session = new TreeSessionStorage();
    BufferingCoordinator.asyncBufferingOps.clear();
    BufferingCoordinator.lastBufferedBoundary.clear();
    BufferingCoordinator.lastBufferedAtTime.clear();
    BufferingCoordinator.reflectionBufferCycleIds.clear();
  });
  afterEach(() => {
    vi.mocked(complete).mockReset();
  });

  it("getOrCreateRecord initializes then returns the existing record", async () => {
    const engine = new ObservationalMemoryEngine({ deps: createDeps(storage, session) });
    const first = await engine.getOrCreateRecord();
    expect(first.originType).toBe("initial");
    const second = await engine.getOrCreateRecord();
    expect(second.id).toBe(first.id);
  });

  it("resource scope: two sessions in the same project share one record", async () => {
    const sharedStorage = new SyncOmStorage();
    const sessionA = new TreeSessionStorage();
    const sessionB = new TreeSessionStorage();

    const engineA = new ObservationalMemoryEngine({
      deps: createDeps(sharedStorage, sessionA, {
        scope: "resource",
        sessionId: "sess-a",
        projectId: "proj-1",
      }),
    });
    const engineB = new ObservationalMemoryEngine({
      deps: createDeps(sharedStorage, sessionB, {
        scope: "resource",
        sessionId: "sess-b",
        projectId: "proj-1",
      }),
    });

    const recA = await engineA.getOrCreateRecord();
    const recB = await engineB.getOrCreateRecord();

    // Same project record — not a per-session one.
    expect(recB.id).toBe(recA.id);
    expect(recA.threadId).toBeNull();
    expect(recA.scope).toBe("resource");
    expect(recA.resourceId).toBe("proj-1");
  });

  it("sees messages appended AFTER engine construction (leaf refresh — C2)", async () => {
    session.appendChild({ role: "user", content: "old prior message", timestamp: 1 }, 1);
    const engine = new ObservationalMemoryEngine({ deps: createDeps(storage, session) });
    const record = await engine.getOrCreateRecord();

    // Append a NEW child after the engine exists — simulates a run turn.
    session.appendChild({ role: "user", content: "x".repeat(200), timestamp: 2 }, 2);

    const unobserved = await engine.loadUnobservedMessages(record);
    const found = unobserved.some(
      (m) => m.role === "user" && typeof m.content === "string" && m.content.startsWith("x"),
    );
    expect(found).toBe(true);
  });

  it("below observation threshold: no observe", async () => {
    session.appendChild({ role: "user", content: "tiny", timestamp: 1 }, 1);
    const engine = new ObservationalMemoryEngine({ deps: createDeps(storage, session) });
    const record = await engine.getOrCreateRecord();
    const after = await engine.maybeObserve(record);
    expect(vi.mocked(complete)).not.toHaveBeenCalled();
    expect(storage.updateActiveCalls).toHaveLength(0);
    expect(after.id).toBe(record.id);
  });

  it("above observation threshold: observe appends ObservationEntry to tree (thread scope)", async () => {
    session.appendChild({ role: "user", content: "x".repeat(800), timestamp: 1 }, 1);
    setComplete("<observations>\n* 🔴 saw the message\n</observations>");
    const engine = new ObservationalMemoryEngine({ deps: createDeps(storage, session) });
    const record = await engine.getOrCreateRecord();
    await engine.maybeObserve(record);
    expect(vi.mocked(complete)).toHaveBeenCalledTimes(1);
    const obsEntries = await Effect.runPromise(session.findEntries("observation"));
    expect(obsEntries).toHaveLength(1);
    expect(obsEntries[0]!.summary).toContain("saw the message");
  });

  it("observe persists real observedMessageIds from the message entries (M2)", async () => {
    const id1 = session.appendChild({ role: "user", content: "x".repeat(800), timestamp: 1 }, 1);
    const id2 = session.appendChild({ role: "user", content: "y".repeat(800), timestamp: 2 }, 2);
    setComplete("<observations>\n* 🔴 obs\n</observations>");
    const engine = new ObservationalMemoryEngine({ deps: createDeps(storage, session) });
    const record = await engine.getOrCreateRecord();
    await engine.maybeObserve(record);
    expect(storage.updateActiveCalls[0]!.observedMessageIds).toEqual([id1, id2]);
  });

  it("above reflection threshold: creates a new reflection generation", async () => {
    // Low reflection threshold (1) so the observed token count triggers reflect.
    const deps = createDeps(storage, session, { thresholds: { observation: 100, reflection: 1 } });
    session.appendChild({ role: "user", content: "x".repeat(800), timestamp: 1 }, 1);
    setComplete("<observations>\n* 🔴 obs line one\n</observations>");
    const engine = new ObservationalMemoryEngine({ deps });
    let record = await engine.getOrCreateRecord();
    record = await engine.maybeObserve(record);
    expect(record.observationTokenCount).toBeGreaterThan(1);

    setComplete("<observations>\n* reflected compact obs\n</observations>");
    await engine.maybeReflect(record);
    expect(storage.reflectingFlagCalls).toContain(true);
    expect(storage.reflectingFlagCalls.at(-1)).toBe(false);
    expect(storage.reflectionCalls).toHaveLength(1);
  });

  it("reflect LLM error: caught at the outer boundary, flag cleared, logger warned (M3)", async () => {
    const deps = createDeps(storage, session, { thresholds: { observation: 100, reflection: 1 } });
    const logger = {
      warn: vi.fn(),
      debug: vi.fn(),
      info: vi.fn(),
      error: vi.fn(),
      child: vi.fn(),
    };
    const engine = new ObservationalMemoryEngine({
      deps: { ...deps, logger: logger as unknown as ObservationalMemoryDeps["logger"] },
    });
    // Get a record whose observationTokenCount exceeds the reflection threshold (1).
    session.appendChild({ role: "user", content: "x".repeat(800), timestamp: 1 }, 1);
    setComplete("<observations>\n* 🔴 obs line\n</observations>");
    let record = await engine.getOrCreateRecord();
    record = await engine.maybeObserve(record);
    expect(record.observationTokenCount).toBeGreaterThan(1);

    // Now make the reflector blow up.
    vi.mocked(complete).mockImplementation(async () => {
      throw new Error("reflect boom");
    });
    const after = await engine.maybeReflect(record);
    expect(after.id).toBe(record.id);
    // Flag was set true then cleared false in the finally.
    expect(storage.reflectingFlagCalls).toContain(true);
    expect(storage.reflectingFlagCalls.at(-1)).toBe(false);
    // No new generation was created.
    expect(storage.reflectionCalls).toHaveLength(0);
    // Outer boundary logged the failure.
    expect(logger.warn).toHaveBeenCalled();
  });

  it("LLM error during observe: no throw, record unchanged (best-effort)", async () => {
    session.appendChild({ role: "user", content: "x".repeat(800), timestamp: 1 }, 1);
    vi.mocked(complete).mockImplementation(async () => {
      throw new Error("provider down");
    });
    const engine = new ObservationalMemoryEngine({ deps: createDeps(storage, session) });
    const record = await engine.getOrCreateRecord();
    const after = await engine.maybeObserve(record);
    expect(after.id).toBe(record.id);
    expect(storage.updateActiveCalls).toHaveLength(0);
  });

  it("observe failure routes through the injected logger (I2)", async () => {
    session.appendChild({ role: "user", content: "x".repeat(800), timestamp: 1 }, 1);
    vi.mocked(complete).mockImplementation(async () => {
      throw new Error("provider down");
    });
    const logger = { warn: vi.fn(), debug: vi.fn(), info: vi.fn(), error: vi.fn(), child: vi.fn() };
    const engine = new ObservationalMemoryEngine({
      deps: createDeps(storage, session, {
        logger: logger as unknown as ObservationalMemoryDeps["logger"],
      }),
    });
    const record = await engine.getOrCreateRecord();
    await engine.maybeObserve(record);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    const [message, ctx] = logger.warn.mock.calls[0]!;
    expect(message).toContain("observational-memory");
    expect(ctx).toMatchObject({ phase: expect.stringContaining("observe") });
  });

  it("buildContextSystemMessage is undefined for empty record, formatted when populated (resource scope)", async () => {
    const engine = new ObservationalMemoryEngine({
      deps: createDeps(storage, session, { scope: "resource" }),
    });
    const empty = await engine.getOrCreateRecord();
    expect(engine.buildContextSystemMessage(empty)).toBeUndefined();

    session.appendChild({ role: "user", content: "x".repeat(800), timestamp: 1 }, 1);
    setComplete("<observations>\n* 🔴 obs\n</observations>");
    let record = await engine.getOrCreateRecord();
    record = await engine.maybeObserve(record);
    const msg = engine.buildContextSystemMessage(record);
    expect(msg).toContain("<observations>");
    expect(msg).toContain("obs");
  });

  it("buildContextSystemMessages (plural) returns string[] of cache-stable chunks (resource scope)", async () => {
    const engine = new ObservationalMemoryEngine({
      deps: createDeps(storage, session, { scope: "resource" }),
    });
    session.appendChild({ role: "user", content: "x".repeat(800), timestamp: 1 }, 1);
    setComplete("<observations>\n* 🔴 obs\n</observations>");
    let record = await engine.getOrCreateRecord();
    record = await engine.maybeObserve(record);
    const chunks = engine.buildContextSystemMessages(record);
    expect(Array.isArray(chunks)).toBe(true);
    expect(chunks).toBeDefined();
    expect(chunks!.length).toBeGreaterThanOrEqual(2);
    const obsChunk = chunks!.find((c) => c.includes("<observations>"));
    expect(obsChunk).toBeDefined();
    expect(obsChunk).toContain("obs");
  });

  it("buildContextSystemMessages returns undefined for empty record", async () => {
    const engine = new ObservationalMemoryEngine({ deps: createDeps(storage, session) });
    const empty = await engine.getOrCreateRecord();
    expect(engine.buildContextSystemMessages(empty)).toBeUndefined();
  });

  it("buildContextSystemMessage (singular) joins the plural chunks", async () => {
    const engine = new ObservationalMemoryEngine({ deps: createDeps(storage, session) });
    session.appendChild({ role: "user", content: "x".repeat(800), timestamp: 1 }, 1);
    setComplete("<observations>\n* 🔴 obs\n</observations>");
    let record = await engine.getOrCreateRecord();
    record = await engine.maybeObserve(record);
    const chunks = engine.buildContextSystemMessages(record);
    const joined = engine.buildContextSystemMessage(record);
    expect(joined).toBe(chunks?.join("\n\n"));
  });

  it("runSyncObserve appends an ObservationEntry to the session tree (thread scope)", async () => {
    const engine = new ObservationalMemoryEngine({ deps: createDeps(storage, session) });
    session.appendChild({ role: "user", content: "x".repeat(800), timestamp: 1 }, 1);
    setComplete("<observations>\n* 🔴 obs\n</observations>");
    let record = await engine.getOrCreateRecord();
    record = await engine.maybeObserve(record);
    const obsEntries = await Effect.runPromise(session.findEntries("observation"));
    expect(obsEntries).toHaveLength(1);
    expect(obsEntries[0]!.summary).toContain("obs");
    expect(obsEntries[0]!.observationRecordId).toBe(record.id);
  });
});

describe("ObservationalMemoryEngine — pruneHistory after reflection", () => {
  let storage: SyncOmStorage;
  let session: TreeSessionStorage;

  beforeEach(() => {
    storage = new SyncOmStorage();
    session = new TreeSessionStorage();
    BufferingCoordinator.asyncBufferingOps.clear();
    BufferingCoordinator.lastBufferedBoundary.clear();
    BufferingCoordinator.lastBufferedAtTime.clear();
    BufferingCoordinator.reflectionBufferCycleIds.clear();
  });
  afterEach(() => {
    vi.mocked(complete).mockReset();
  });

  it("calls pruneHistory after runSyncReflect (triggered via maybeReflect)", async () => {
    const pruneSpy = vi.spyOn(storage, "pruneHistory");
    const deps = createDeps(storage, session, {
      thresholds: { observation: 100, reflection: 1 },
    });
    session.appendChild({ role: "user", content: "x".repeat(800), timestamp: 1 }, 1);
    setComplete("<observations>\n* 🔴 obs line one\n</observations>");
    const engine = new ObservationalMemoryEngine({ deps });
    let record = await engine.getOrCreateRecord();
    record = await engine.maybeObserve(record);
    expect(record.observationTokenCount).toBeGreaterThan(1);

    setComplete("<observations>\n* reflected compact obs\n</observations>");
    await engine.maybeReflect(record);

    expect(pruneSpy).toHaveBeenCalledTimes(1);
    const callArgs = pruneSpy.mock.calls[0] as unknown as [string | null, string, string];
    const [threadId, resourceId, keepId] = callArgs;
    expect(threadId).toBe("sess-1");
    expect(resourceId).toBe("proj-1");
    // The new generation is om-2 (om-1 is the initial record).
    expect(keepId).toBe("om-2");
  });

  it("calls pruneHistory with null threadId for resource scope", async () => {
    const pruneSpy = vi.spyOn(storage, "pruneHistory");
    const deps = createDeps(storage, session, {
      thresholds: { observation: 100, reflection: 1 },
      scope: "resource",
      sessionId: "sess-r",
      projectId: "proj-r",
    });
    session.appendChild({ role: "user", content: "x".repeat(800), timestamp: 1 }, 1);
    setComplete("<observations>\n* 🔴 obs\n</observations>");
    const engine = new ObservationalMemoryEngine({ deps });
    let record = await engine.getOrCreateRecord();
    record = await engine.maybeObserve(record);

    setComplete("<observations>\n* reflected\n</observations>");
    await engine.maybeReflect(record);

    expect(pruneSpy).toHaveBeenCalledTimes(1);
    const callArgs = pruneSpy.mock.calls[0] as unknown as [string | null, string, string];
    expect(callArgs[0]).toBeNull();
    expect(callArgs[1]).toBe("proj-r");
  });
});

describe("ObservationalMemoryEngine — forceReflect", () => {
  let storage: SyncOmStorage;
  let session: TreeSessionStorage;

  beforeEach(() => {
    storage = new SyncOmStorage();
    session = new TreeSessionStorage();
    BufferingCoordinator.asyncBufferingOps.clear();
    BufferingCoordinator.lastBufferedBoundary.clear();
    BufferingCoordinator.lastBufferedAtTime.clear();
    BufferingCoordinator.reflectionBufferCycleIds.clear();
  });
  afterEach(() => {
    vi.mocked(complete).mockReset();
  });

  it("reflects when observations exist, ignoring threshold", async () => {
    const pruneSpy = vi.spyOn(storage, "pruneHistory");
    // Set up: observe with low observation threshold, high reflection threshold.
    const deps = createDeps(storage, session, {
      thresholds: { observation: 100, reflection: 999_999 },
    });
    session.appendChild({ role: "user", content: "x".repeat(800), timestamp: 1 }, 1);
    setComplete("<observations>\n* 🔴 obs line\n</observations>");
    const engine = new ObservationalMemoryEngine({ deps });
    let record = await engine.getOrCreateRecord();
    record = await engine.maybeObserve(record);
    expect(record.observationTokenCount).toBeGreaterThan(0);
    // observationTokenCount is way below the 999_999 reflection threshold.
    expect(record.observationTokenCount).toBeLessThan(999_999);

    // forceReflect should still reflect.
    setComplete("<observations>\n* reflected compact obs\n</observations>");
    const result = await engine.forceReflect();

    expect(result.reflected).toBe(true);
    expect(result.reason).toBeUndefined();
    expect(storage.reflectionCalls).toHaveLength(1);
    expect(pruneSpy).toHaveBeenCalled();
  });

  it("returns nothing-to-reflect when no observations exist", async () => {
    const engine = new ObservationalMemoryEngine({ deps: createDeps(storage, session) });
    const result = await engine.forceReflect();
    expect(result.reflected).toBe(false);
    expect(result.reason).toBe("nothing-to-reflect");
    expect(storage.reflectionCalls).toHaveLength(0);
  });

  it("emits om_start and om_end events", async () => {
    const omEvents: Array<{ type: string; operationType?: string }> = [];
    const deps = createDeps(storage, session, {
      thresholds: { observation: 100, reflection: 999_999 },
    });
    session.appendChild({ role: "user", content: "x".repeat(800), timestamp: 1 }, 1);
    setComplete("<observations>\n* 🔴 obs line\n</observations>");
    const engine = new ObservationalMemoryEngine({
      deps,
      onOmEvent: (event) => omEvents.push(event),
    });
    let record = await engine.getOrCreateRecord();
    record = await engine.maybeObserve(record);

    setComplete("<observations>\n* reflected\n</observations>");
    await engine.forceReflect();

    const types = omEvents.map((e) => e.type);
    expect(types).toContain("om_start");
    expect(types).toContain("om_end");
    const starts = omEvents.filter((e) => e.type === "om_start");
    expect(starts.some((e) => e.operationType === "reflection")).toBe(true);
  });
});

describe("ObservationalMemoryEngine — forceObserve", () => {
  let storage: SyncOmStorage;
  let session: TreeSessionStorage;

  beforeEach(() => {
    storage = new SyncOmStorage();
    session = new TreeSessionStorage();
    BufferingCoordinator.asyncBufferingOps.clear();
    BufferingCoordinator.lastBufferedBoundary.clear();
    BufferingCoordinator.lastBufferedAtTime.clear();
    BufferingCoordinator.reflectionBufferCycleIds.clear();
  });
  afterEach(() => {
    vi.mocked(complete).mockReset();
  });

  it("observes when unobserved messages exist, ignoring the threshold", async () => {
    // Observation threshold far above the message size so maybeObserve won't fire.
    const deps = createDeps(storage, session, {
      thresholds: { observation: 999_999, reflection: 999_999 },
    });
    session.appendChild({ role: "user", content: "x".repeat(800), timestamp: 1 }, 1);
    setComplete("<observations>\n* 🔴 obs line\n</observations>");
    const engine = new ObservationalMemoryEngine({ deps });

    let record = await engine.getOrCreateRecord();
    // maybeObserve stays below the 999_999 threshold → no observation yet.
    record = await engine.maybeObserve(record);
    expect(storage.updateActiveCalls).toHaveLength(0);

    // forceObserve bypasses the threshold.
    const result = await engine.forceObserve();
    expect(storage.updateActiveCalls).toHaveLength(1);
    const obsEntries = await Effect.runPromise(session.findEntries("observation"));
    expect(obsEntries).toHaveLength(1);
    expect(obsEntries[0]!.summary).toContain("obs line");
    expect(result.observationTokenCount).toBeGreaterThan(0);
  });

  it("returns the record unchanged when no unobserved messages exist", async () => {
    const engine = new ObservationalMemoryEngine({ deps: createDeps(storage, session) });
    const result = await engine.forceObserve();
    expect(storage.updateActiveCalls).toHaveLength(0);
    expect(result.activeObservations).toBe("");
  });

  it("emits om_start and om_end events with operationType observation", async () => {
    const omEvents: Array<{ type: string; operationType?: string }> = [];
    const deps = createDeps(storage, session, {
      thresholds: { observation: 999_999, reflection: 999_999 },
    });
    session.appendChild({ role: "user", content: "x".repeat(800), timestamp: 1 }, 1);
    setComplete("<observations>\n* 🔴 obs line\n</observations>");
    const engine = new ObservationalMemoryEngine({
      deps,
      onOmEvent: (event) => omEvents.push(event),
    });

    await engine.forceObserve();

    const types = omEvents.map((e) => e.type);
    expect(types).toContain("om_start");
    expect(types).toContain("om_end");
    const starts = omEvents.filter((e) => e.type === "om_start");
    expect(starts.some((e) => e.operationType === "observation")).toBe(true);
  });
});
