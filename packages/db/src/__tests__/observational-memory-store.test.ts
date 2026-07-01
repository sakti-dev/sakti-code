import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";
import { initDatabase } from "../init.ts";
import { SqliteObservationalMemoryStorage } from "../observational-memory-store.ts";

describe("SqliteObservationalMemoryStorage — reads", () => {
  let db: DatabaseSync;
  let tmpDir: string;
  let store: SqliteObservationalMemoryStorage;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(import.meta.dirname!, "om-store-XXXXXX"));
    db = new DatabaseSync(join(tmpDir, "test.db"));
    const drizzle = await initDatabase(db);
    // FK parents
    db.prepare(
      "INSERT INTO projects (id, name, cwd, created_at, updated_at) VALUES (?,?,?,?,?)",
    ).run("proj1", "P", "/tmp/p", 1, 1);
    db.prepare(
      "INSERT INTO sessions (id, project_id, kind, thinking_level, created_at, updated_at) VALUES (?,?,?,?,?,?)",
    ).run("sess1", "proj1", "task", "off", 1, 1);
    store = new SqliteObservationalMemoryStorage(drizzle);
  });

  afterAll(() => {
    db?.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("getObservationalMemory returns null when none exists", async () => {
    const got = await store.getObservationalMemory("sess1", "proj1");
    expect(got).toBeNull();
  });

  test("initializeObservationalMemory then get returns the record", async () => {
    const created = await store.initializeObservationalMemory({
      threadId: "sess1",
      resourceId: "proj1",
      scope: "thread",
      config: { observation: { messageTokens: 30000 } },
    });
    expect(created.generationCount).toBe(0);
    expect(created.originType).toBe("initial");

    const got = await store.getObservationalMemory("sess1", "proj1");
    expect(got).not.toBeNull();
    expect(got!.id).toBe(created.id);
    expect(got!.activeObservations).toBe("");
    expect(got!.isObserving).toBe(false);
  });
});

describe("SqliteObservationalMemoryStorage — mutations (sync path)", () => {
  let db: DatabaseSync;
  let tmpDir: string;
  let store: SqliteObservationalMemoryStorage;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(import.meta.dirname!, "om-mut-XXXXXX"));
    db = new DatabaseSync(join(tmpDir, "test.db"));
    const drizzle = await initDatabase(db);
    db.prepare(
      "INSERT INTO projects (id, name, cwd, created_at, updated_at) VALUES (?,?,?,?,?)",
    ).run("proj1", "P", "/tmp/p", 1, 1);
    db.prepare(
      "INSERT INTO sessions (id, project_id, kind, thinking_level, created_at, updated_at) VALUES (?,?,?,?,?,?)",
    ).run("sess-mut", "proj1", "task", "off", 1, 1);
    db.prepare(
      "INSERT INTO sessions (id, project_id, kind, thinking_level, created_at, updated_at) VALUES (?,?,?,?,?,?)",
    ).run("sess-verb", "proj1", "task", "off", 1, 1);
    store = new SqliteObservationalMemoryStorage(drizzle);
  });

  afterAll(() => {
    db?.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("updateActiveObservations updates content, resets pending, accumulates totals", async () => {
    const created = await store.initializeObservationalMemory({
      threadId: "sess-mut",
      resourceId: "proj1",
      scope: "thread",
      config: {},
    });
    const observedAt = new Date(2_000_000_000_000);
    await store.updateActiveObservations({
      id: created.id,
      observations: "did X",
      lastObservedAt: observedAt,
      tokenCount: 42,
      observedMessageIds: ["e1", "e2"],
    });
    const got = await store.getObservationalMemory("sess-mut", "proj1");
    expect(got!.activeObservations).toBe("did X");
    expect(got!.pendingMessageTokens).toBe(0);
    expect(got!.observationTokenCount).toBe(42);
    expect(got!.totalTokensObserved).toBe(42);
    expect(got!.observedMessageIds).toEqual(["e1", "e2"]);
    expect(got!.lastObservedAt?.getTime()).toBe(observedAt.getTime());
  });

  test("updateActiveObservations throws on unknown id", async () => {
    await expect(
      store.updateActiveObservations({
        id: "nope",
        observations: "x",
        lastObservedAt: new Date(),
        tokenCount: 1,
      }),
    ).rejects.toThrow(/not found/i);
  });

  test("createReflectionGeneration inserts a new generation row", async () => {
    const current = await store.getObservationalMemory("sess-mut", "proj1");
    expect(current).not.toBeNull();
    const reflected = await store.createReflectionGeneration({
      currentRecord: current!,
      reflection: "condensed",
      tokenCount: 7,
    });
    expect(reflected.originType).toBe("reflection");
    expect(reflected.generationCount).toBe(current!.generationCount + 1);
    expect(reflected.activeObservations).toBe("condensed");
    expect(reflected.observationTokenCount).toBe(7);
    expect(reflected.pendingMessageTokens).toBe(0);

    const got = await store.getObservationalMemory("sess-mut", "proj1");
    expect(got!.id).toBe(reflected.id); // latest by generationCount
    expect(got!.generationCount).toBe(current!.generationCount + 1);
  });

  test("getObservationalMemoryHistory returns generations newest-first", async () => {
    const history = await store.getObservationalMemoryHistory("sess-mut", "proj1");
    expect(history.length).toBeGreaterThanOrEqual(2);
    expect(history[0]!.generationCount).toBeGreaterThan(
      history[history.length - 1]!.generationCount,
    );
  });

  test("insertObservationalMemoryRecord writes a fully-formed record verbatim", async () => {
    const now = new Date();
    const record: import("@sakti-code/agent").ObservationalMemoryRecord = {
      id: "verbatim-1",
      scope: "thread",
      threadId: "sess-verb",
      resourceId: "proj1",
      createdAt: now,
      updatedAt: now,
      originType: "observation",
      generationCount: 5,
      activeObservations: "raw",
      totalTokensObserved: 100,
      observationTokenCount: 50,
      pendingMessageTokens: 3,
      isObserving: false,
      isReflecting: false,
      isBufferingObservation: false,
      isBufferingReflection: false,
      lastBufferedAtTokens: 0,
      lastBufferedAtTime: null,
      config: { k: "v" },
      metadata: { m: 1 },
      observedMessageIds: ["a"],
    };
    await store.insertObservationalMemoryRecord(record);
    const got = await store.getObservationalMemory("sess-verb", "proj1");
    expect(got!.id).toBe("verbatim-1");
    expect(got!.generationCount).toBe(5);
    expect(got!.config).toEqual({ k: "v" });
    expect(got!.metadata).toEqual({ m: 1 });
  });
});

describe("SqliteObservationalMemoryStorage — flags & maintenance", () => {
  let db: DatabaseSync;
  let tmpDir: string;
  let store: SqliteObservationalMemoryStorage;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(import.meta.dirname!, "om-flag-XXXXXX"));
    db = new DatabaseSync(join(tmpDir, "test.db"));
    const drizzle = await initDatabase(db);
    db.prepare(
      "INSERT INTO projects (id, name, cwd, created_at, updated_at) VALUES (?,?,?,?,?)",
    ).run("proj1", "P", "/tmp/p", 1, 1);
    for (const sid of [
      "sess-flags",
      "sess-refl",
      "sess-bufobs",
      "sess-bufref",
      "sess-pend",
      "sess-cfg",
      "sess-clear",
    ]) {
      db.prepare(
        "INSERT INTO sessions (id, project_id, kind, thinking_level, created_at, updated_at) VALUES (?,?,?,?,?,?)",
      ).run(sid, "proj1", "task", "off", 1, 1);
    }
    store = new SqliteObservationalMemoryStorage(drizzle);
  });

  afterAll(() => {
    db?.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("setObservingFlag sets isObserving and advances updatedAt", async () => {
    const created = await store.initializeObservationalMemory({
      threadId: "sess-flags",
      resourceId: "proj1",
      scope: "thread",
      config: {},
    });
    await store.setObservingFlag(created.id, true);
    const got = await store.getObservationalMemory("sess-flags", "proj1");
    expect(got!.isObserving).toBe(true);
    expect(got!.updatedAt.getTime()).toBeGreaterThanOrEqual(created.updatedAt.getTime());
  });

  test("setReflectingFlag sets isReflecting", async () => {
    const created = await store.initializeObservationalMemory({
      threadId: "sess-refl",
      resourceId: "proj1",
      scope: "thread",
      config: {},
    });
    await store.setReflectingFlag(created.id, true);
    const got = await store.getObservationalMemory("sess-refl", "proj1");
    expect(got!.isReflecting).toBe(true);
  });

  test("setBufferingObservationFlag writes lastBufferedAtTokens whenever provided (Mastra semantics)", async () => {
    const created = await store.initializeObservationalMemory({
      threadId: "sess-bufobs",
      resourceId: "proj1",
      scope: "thread",
      config: {},
    });
    // turning on with token
    await store.setBufferingObservationFlag(created.id, true, 1234);
    let got = await store.getObservationalMemory("sess-bufobs", "proj1");
    expect(got!.isBufferingObservation).toBe(true);
    expect(got!.lastBufferedAtTokens).toBe(1234);
    // turning off WITHOUT token → token unchanged
    await store.setBufferingObservationFlag(created.id, false);
    got = await store.getObservationalMemory("sess-bufobs", "proj1");
    expect(got!.isBufferingObservation).toBe(false);
    expect(got!.lastBufferedAtTokens).toBe(1234);
    // turning off WITH token → token updated (Mastra writes it regardless of flag value)
    await store.setBufferingObservationFlag(created.id, false, 5678);
    got = await store.getObservationalMemory("sess-bufobs", "proj1");
    expect(got!.isBufferingObservation).toBe(false);
    expect(got!.lastBufferedAtTokens).toBe(5678);
  });

  test("setBufferingReflectionFlag flips isBufferingReflection", async () => {
    const created = await store.initializeObservationalMemory({
      threadId: "sess-bufref",
      resourceId: "proj1",
      scope: "thread",
      config: {},
    });
    await store.setBufferingReflectionFlag(created.id, true);
    let got = await store.getObservationalMemory("sess-bufref", "proj1");
    expect(got!.isBufferingReflection).toBe(true);
    await store.setBufferingReflectionFlag(created.id, false);
    got = await store.getObservationalMemory("sess-bufref", "proj1");
    expect(got!.isBufferingReflection).toBe(false);
  });

  test("flag setters throw on unknown id", async () => {
    await expect(store.setObservingFlag("no-such-id", true)).rejects.toThrow(/not found/i);
    await expect(store.setReflectingFlag("no-such-id", true)).rejects.toThrow(/not found/i);
    await expect(store.setBufferingObservationFlag("no-such-id", true)).rejects.toThrow(
      /not found/i,
    );
    await expect(store.setBufferingReflectionFlag("no-such-id", true)).rejects.toThrow(
      /not found/i,
    );
  });

  test("setPendingMessageTokens updates token count", async () => {
    const created = await store.initializeObservationalMemory({
      threadId: "sess-pend",
      resourceId: "proj1",
      scope: "thread",
      config: {},
    });
    await store.setPendingMessageTokens(created.id, 999);
    const got = await store.getObservationalMemory("sess-pend", "proj1");
    expect(got!.pendingMessageTokens).toBe(999);
  });

  test("setPendingMessageTokens throws on unknown id", async () => {
    await expect(store.setPendingMessageTokens("no-such-id", 1)).rejects.toThrow(/not found/i);
  });

  test("updateObservationalMemoryConfig deep-merges config", async () => {
    const created = await store.initializeObservationalMemory({
      threadId: "sess-cfg",
      resourceId: "proj1",
      scope: "thread",
      config: { existing: true, nested: { a: 1 } },
    });
    await store.updateObservationalMemoryConfig({
      id: created.id,
      config: { new: 1, nested: { b: 2 } },
    });
    const got = await store.getObservationalMemory("sess-cfg", "proj1");
    expect(got!.config).toEqual({ existing: true, new: 1, nested: { a: 1, b: 2 } });
  });

  test("clearObservationalMemory removes all rows for the key", async () => {
    await store.initializeObservationalMemory({
      threadId: "sess-clear",
      resourceId: "proj1",
      scope: "thread",
      config: {},
    });
    await store.clearObservationalMemory("sess-clear", "proj1");
    const got = await store.getObservationalMemory("sess-clear", "proj1");
    expect(got).toBeNull();
    const history = await store.getObservationalMemoryHistory("sess-clear", "proj1");
    expect(history).toEqual([]);
  });
});

describe("SqliteObservationalMemoryStorage — buffered observations", () => {
  let db: DatabaseSync;
  let tmpDir: string;
  let store: SqliteObservationalMemoryStorage;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(import.meta.dirname!, "om-buf-XXXXXX"));
    db = new DatabaseSync(join(tmpDir, "test.db"));
    const drizzle = await initDatabase(db);
    db.prepare(
      "INSERT INTO projects (id, name, cwd, created_at, updated_at) VALUES (?,?,?,?,?)",
    ).run("proj1", "P", "/tmp/p", 1, 1);
    for (const sid of [
      "sess-bufobs-add",
      "sess-bufobs-accum",
      "sess-bufobs-partial",
      "sess-bufobs-over",
      "sess-bufobs-zero",
      "sess-bufobs-un",
    ]) {
      db.prepare(
        "INSERT INTO sessions (id, project_id, kind, thinking_level, created_at, updated_at) VALUES (?,?,?,?,?,?)",
      ).run(sid, "proj1", "task", "off", 1, 1);
    }
    store = new SqliteObservationalMemoryStorage(drizzle);
  });

  afterAll(() => {
    db?.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("updateBufferedObservations appends a chunk (single-chunk API) and enriches id/createdAt", async () => {
    const created = await store.initializeObservationalMemory({
      threadId: "sess-bufobs-add",
      resourceId: "proj1",
      scope: "thread",
      config: {},
    });
    await store.updateBufferedObservations({
      id: created.id,
      chunk: {
        cycleId: "cyc-A",
        observations: "chunk A",
        tokenCount: 5,
        messageIds: ["m1"],
        messageTokens: 100,
        lastObservedAt: new Date(1_000),
      },
    });
    const got = await store.getObservationalMemory("sess-bufobs-add", "proj1");
    const chunks = got!.bufferedObservationChunks!;
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.observations).toBe("chunk A");
    expect(chunks[0]!.cycleId).toBe("cyc-A");
    expect(chunks[0]!.messageTokens).toBe(100);
    expect(chunks[0]!.id).toMatch(/^ombuf-/);
    expect(chunks[0]!.createdAt).toBeInstanceOf(Date);
    expect(chunks[0]!.lastObservedAt).toEqual(new Date(1_000));
  });

  test("updateBufferedObservations accumulates across calls and persists lastBufferedAtTime (epoch-ms)", async () => {
    const created = await store.initializeObservationalMemory({
      threadId: "sess-bufobs-accum",
      resourceId: "proj1",
      scope: "thread",
      config: {},
    });
    await store.updateBufferedObservations({
      id: created.id,
      chunk: {
        cycleId: "cyc-A",
        observations: "chunk A",
        tokenCount: 5,
        messageIds: ["m1"],
        messageTokens: 100,
        lastObservedAt: new Date(1_000),
      },
    });
    const bufferedAt = new Date(9_999);
    await store.updateBufferedObservations({
      id: created.id,
      chunk: {
        cycleId: "cyc-B",
        observations: "chunk B",
        tokenCount: 3,
        messageIds: ["m2"],
        messageTokens: 50,
        lastObservedAt: new Date(2_000),
      },
      lastBufferedAtTime: bufferedAt,
    });
    const got = await store.getObservationalMemory("sess-bufobs-accum", "proj1");
    const chunks = got!.bufferedObservationChunks!;
    expect(chunks).toHaveLength(2);
    expect(chunks.map((c) => c.observations)).toEqual(["chunk A", "chunk B"]);
    // lastBufferedAtTime persisted as epoch-ms and revived to a Date
    expect(got!.lastBufferedAtTime).toEqual(bufferedAt);
  });

  test("swapBufferedToActive partial-activation: activates best-under boundary, leaves remainder, advances lastObservedAt, reports cycleIds", async () => {
    const created = await store.initializeObservationalMemory({
      threadId: "sess-bufobs-partial",
      resourceId: "proj1",
      scope: "thread",
      config: {},
    });
    // chunkA=300 (under target), chunkB=900 (pushes over target with too much overshoot)
    // → algorithm picks best-under (chunkA only); chunkB stays buffered.
    await store.updateBufferedObservations({
      id: created.id,
      chunk: {
        cycleId: "cyc-A",
        observations: "chunk A",
        tokenCount: 5,
        messageIds: ["m1", "m2"],
        messageTokens: 300,
        lastObservedAt: new Date(1_000),
      },
    });
    await store.updateBufferedObservations({
      id: created.id,
      chunk: {
        cycleId: "cyc-B",
        observations: "chunk B",
        tokenCount: 7,
        messageIds: ["m3"],
        messageTokens: 900,
        lastObservedAt: new Date(2_000),
      },
    });
    await store.setPendingMessageTokens(created.id, 1000);

    const result = await store.swapBufferedToActive({
      id: created.id,
      messageTokensThreshold: 800,
      activationRatio: 0.8,
      currentPendingTokens: 1000,
      forceMaxActivation: false,
    });
    expect(result.chunksActivated).toBe(1);
    expect(result.observationTokensActivated).toBe(5);
    expect(result.messagesActivated).toBe(2);
    expect(result.activatedMessageIds).toEqual(["m1", "m2"]);
    expect(result.activatedCycleIds).toEqual(["cyc-A"]);

    const got = await store.getObservationalMemory("sess-bufobs-partial", "proj1");
    expect(got!.activeObservations).toContain("chunk A");
    expect(got!.activeObservations).not.toContain("chunk B");
    // remainder kept
    expect(got!.bufferedObservationChunks).toHaveLength(1);
    expect(got!.bufferedObservationChunks![0]!.cycleId).toBe("cyc-B");
    expect(got!.pendingMessageTokens).toBe(700); // 1000 - 300
    // lastObservedAt advanced to the latest activated chunk's timestamp
    expect(got!.lastObservedAt).toEqual(new Date(1_000));
  });

  test("swapBufferedToActive over-path: selects best-over boundary when overshoot is within budget", async () => {
    const created = await store.initializeObservationalMemory({
      threadId: "sess-bufobs-over",
      resourceId: "proj1",
      scope: "thread",
      config: {},
    });
    // retentionFloor=5000, target=5000, one chunk=5200 crosses target with small overshoot
    // and leaves enough remaining → best-over branch (branch 2) is taken.
    await store.updateBufferedObservations({
      id: created.id,
      chunk: {
        cycleId: "cyc-O",
        observations: "over chunk",
        tokenCount: 20,
        messageIds: ["m1"],
        messageTokens: 5200,
        lastObservedAt: new Date(5_000),
      },
    });
    await store.setPendingMessageTokens(created.id, 10000);

    const result = await store.swapBufferedToActive({
      id: created.id,
      messageTokensThreshold: 10000,
      activationRatio: 0.5,
      currentPendingTokens: 10000,
      forceMaxActivation: false,
    });
    expect(result.chunksActivated).toBe(1);
    expect(result.activatedCycleIds).toEqual(["cyc-O"]);

    const got = await store.getObservationalMemory("sess-bufobs-over", "proj1");
    expect(got!.activeObservations).toContain("over chunk");
    expect(got!.bufferedObservationChunks).toBeUndefined();
    expect(got!.pendingMessageTokens).toBe(4800); // 10000 - 5200
    expect(got!.lastObservedAt).toEqual(new Date(5_000));
  });

  test("swapBufferedToActive with no chunks returns zeroes", async () => {
    const created = await store.initializeObservationalMemory({
      threadId: "sess-bufobs-zero",
      resourceId: "proj1",
      scope: "thread",
      config: {},
    });
    const result = await store.swapBufferedToActive({
      id: created.id,
      messageTokensThreshold: 800,
      activationRatio: 0.8,
      currentPendingTokens: 0,
      forceMaxActivation: false,
    });
    expect(result.chunksActivated).toBe(0);
    expect(result.observationTokensActivated).toBe(0);
    expect(result.activatedMessageIds).toEqual([]);
  });

  test("swapBufferedToActive throws on unknown id", async () => {
    await expect(
      store.swapBufferedToActive({
        id: "nope",
        messageTokensThreshold: 800,
        activationRatio: 0.8,
        currentPendingTokens: 0,
        forceMaxActivation: false,
      }),
    ).rejects.toThrow(/not found/i);
  });
});

describe("SqliteObservationalMemoryStorage — buffered reflection", () => {
  let db: DatabaseSync;
  let tmpDir: string;
  let store: SqliteObservationalMemoryStorage;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(import.meta.dirname!, "om-ref-XXXXXX"));
    db = new DatabaseSync(join(tmpDir, "test.db"));
    const drizzle = await initDatabase(db);
    db.prepare(
      "INSERT INTO projects (id, name, cwd, created_at, updated_at) VALUES (?,?,?,?,?)",
    ).run("proj1", "P", "/tmp/p", 1, 1);
    for (const sid of ["sess-ref-set", "sess-ref-accum", "sess-ref-thr", "sess-ref-swap"]) {
      db.prepare(
        "INSERT INTO sessions (id, project_id, kind, thinking_level, created_at, updated_at) VALUES (?,?,?,?,?,?)",
      ).run(sid, "proj1", "task", "off", 1, 1);
    }
    store = new SqliteObservationalMemoryStorage(drizzle);
  });

  afterAll(() => {
    db?.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("updateBufferedReflection sets reflection fields", async () => {
    const created = await store.initializeObservationalMemory({
      threadId: "sess-ref-set",
      resourceId: "proj1",
      scope: "thread",
      config: {},
    });
    await store.updateBufferedReflection({
      id: created.id,
      reflection: "my reflection",
      tokenCount: 50,
      inputTokenCount: 200,
      reflectedObservationLineCount: 10,
    });
    const got = await store.getObservationalMemory("sess-ref-set", "proj1");
    expect(got!.bufferedReflection).toBe("my reflection");
    expect(got!.bufferedReflectionTokens).toBe(50);
    expect(got!.bufferedReflectionInputTokens).toBe(200);
    expect(got!.reflectedObservationLineCount).toBe(10);
  });

  test("updateBufferedReflection accumulates across calls (appends reflection, adds tokens)", async () => {
    const created = await store.initializeObservationalMemory({
      threadId: "sess-ref-accum",
      resourceId: "proj1",
      scope: "thread",
      config: {},
    });
    await store.updateBufferedReflection({
      id: created.id,
      reflection: "part one",
      tokenCount: 50,
      inputTokenCount: 200,
      reflectedObservationLineCount: 2,
    });
    await store.updateBufferedReflection({
      id: created.id,
      reflection: "part two",
      tokenCount: 30,
      inputTokenCount: 100,
      reflectedObservationLineCount: 2,
    });
    const got = await store.getObservationalMemory("sess-ref-accum", "proj1");
    expect(got!.bufferedReflection).toBe("part one\n\npart two");
    expect(got!.bufferedReflectionTokens).toBe(80); // 50 + 30
    expect(got!.bufferedReflectionInputTokens).toBe(300); // 200 + 100
    expect(got!.reflectedObservationLineCount).toBe(2); // last write wins
  });

  test("updateBufferedReflection throws on unknown id", async () => {
    await expect(
      store.updateBufferedReflection({
        id: "nope",
        reflection: "x",
        tokenCount: 1,
        inputTokenCount: 1,
        reflectedObservationLineCount: 0,
      }),
    ).rejects.toThrow(/not found/i);
  });

  test("swapBufferedReflectionToActive swaps reflection into active, creates new generation, and clears old record", async () => {
    const created = await store.initializeObservationalMemory({
      threadId: "sess-ref-swap",
      resourceId: "proj1",
      scope: "thread",
      config: {},
    });
    const initial = await store.getObservationalMemory("sess-ref-swap", "proj1");
    // Set some active observations and buffered reflection
    await store.updateActiveObservations({
      id: created.id,
      observations: "line1\nline2\nline3\nline4",
      lastObservedAt: new Date(),
      tokenCount: 20,
    });
    await store.updateBufferedReflection({
      id: created.id,
      reflection: "reflected content",
      tokenCount: 8,
      inputTokenCount: 20,
      reflectedObservationLineCount: 2,
    });

    const newRecord = await store.swapBufferedReflectionToActive({
      currentRecord: initial!,
      tokenCount: 30,
    });
    expect(newRecord.generationCount).toBe(1);
    expect(newRecord.originType).toBe("reflection");
    expect(newRecord.activeObservations).toContain("reflected content");
    // Lines 1-2 replaced, lines 3-4 remain
    expect(newRecord.activeObservations).toContain("line3");
    expect(newRecord.activeObservations).toContain("line4");
    expect(newRecord.bufferedReflection).toBeUndefined();
    // Current (latest generation) is the new record
    const got = await store.getObservationalMemory("sess-ref-swap", "proj1");
    expect(got!.id).toBe(newRecord.id);

    // #13: the OLD record's buffered fields were cleared
    const history = await store.getObservationalMemoryHistory("sess-ref-swap", "proj1");
    const oldRecord = history.find((r) => r.id === created.id);
    expect(oldRecord).toBeDefined();
    expect(oldRecord!.bufferedReflection).toBeUndefined();
    expect(oldRecord!.bufferedReflectionTokens).toBeUndefined();
    expect(oldRecord!.bufferedReflectionInputTokens).toBeUndefined();
    expect(oldRecord!.reflectedObservationLineCount).toBeUndefined();
  });
});
