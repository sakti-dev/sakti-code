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
