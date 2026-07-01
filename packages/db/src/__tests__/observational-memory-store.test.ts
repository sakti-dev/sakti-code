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

  test("setBufferingObservationFlag sets flag and lastBufferedAtTokens when turning on", async () => {
    const created = await store.initializeObservationalMemory({
      threadId: "sess-bufobs",
      resourceId: "proj1",
      scope: "thread",
      config: {},
    });
    await store.setBufferingObservationFlag(created.id, true, 1234);
    let got = await store.getObservationalMemory("sess-bufobs", "proj1");
    expect(got!.isBufferingObservation).toBe(true);
    expect(got!.lastBufferedAtTokens).toBe(1234);
    await store.setBufferingObservationFlag(created.id, false);
    got = await store.getObservationalMemory("sess-bufobs", "proj1");
    expect(got!.isBufferingObservation).toBe(false);
    expect(got!.lastBufferedAtTokens).toBe(1234); // unchanged
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
