import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { desc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";
import { initDatabase } from "../init.ts";
import { observationalMemory } from "../schema.ts";

describe("observational_memory table", () => {
  let db: DatabaseSync;
  let tmpDir: string;
  let drizzleDb: Awaited<ReturnType<typeof initDatabase>>;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(import.meta.dirname!, "om-db-XXXXXX"));
    db = new DatabaseSync(join(tmpDir, "test.db"));
    drizzleDb = await initDatabase(db);
  });

  afterAll(() => {
    db?.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("table exists after migration", () => {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as Array<{ name: string }>;
    expect(tables.map((t) => t.name)).toContain("observational_memory");
  });

  test("round-trips a fully-populated record (JSON, booleans, epoch-ms) and keeps history by lookupKey", () => {
    // FK parents
    db.prepare(
      "INSERT INTO projects (id, name, cwd, created_at, updated_at) VALUES (?,?,?,?,?)",
    ).run("proj1", "P", "/tmp/p", 1, 1);
    db.prepare(
      "INSERT INTO sessions (id, project_id, kind, thinking_level, created_at, updated_at) VALUES (?,?,?,?,?,?)",
    ).run("sess1", "proj1", "task", "off", 1, 1);

    const now = Date.now();
    const config = { observation: { messageTokens: 30000 } };

    drizzleDb
      .insert(observationalMemory)
      .values({
        id: "om1",
        lookupKey: "thread:sess1",
        scope: "thread",
        resourceId: "proj1",
        threadId: "sess1",
        activeObservations: "observed: user wants X",
        bufferedObservationChunks: JSON.stringify([{ text: "chunk", tokens: 10 }]),
        observedMessageIds: JSON.stringify(["e1", "e2"]),
        observedTimezone: "America/Los_Angeles",
        originType: "observation",
        generationCount: 1,
        config: JSON.stringify(config),
        pendingMessageTokens: 1234,
        totalTokensObserved: 5678,
        observationTokenCount: 90,
        isObserving: false,
        isReflecting: true, // boolean-mode flag must round-trip as true
        isBufferingObservation: false,
        isBufferingReflection: false,
        lastBufferedAtTokens: 0,
        lastObservedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const row = drizzleDb
      .select()
      .from(observationalMemory)
      .where(eq(observationalMemory.id, "om1"))
      .get();

    expect(row).toBeDefined();
    expect(row!.scope).toBe("thread");
    expect(row!.threadId).toBe("sess1");
    expect(row!.resourceId).toBe("proj1");
    expect(row!.isReflecting).toBe(true); // boolean mode
    expect(row!.isObserving).toBe(false);
    expect(JSON.parse(row!.config)).toEqual(config);
    expect(JSON.parse(row!.observedMessageIds!)).toEqual(["e1", "e2"]);
    expect(row!.lastObservedAt).toBe(now);

    // history: a second row with the SAME lookup_key is allowed
    drizzleDb
      .insert(observationalMemory)
      .values({
        id: "om2",
        lookupKey: "thread:sess1",
        scope: "thread",
        resourceId: "proj1",
        threadId: "sess1",
        activeObservations: "reflected summary",
        originType: "reflection",
        generationCount: 2,
        config: JSON.stringify(config),
        pendingMessageTokens: 0,
        totalTokensObserved: 6000,
        observationTokenCount: 40,
        isObserving: false,
        isReflecting: false,
        isBufferingObservation: false,
        isBufferingReflection: false,
        lastBufferedAtTokens: 0,
        createdAt: now + 1000,
        updatedAt: now + 1000,
      })
      .run();

    // "current" = latest generationCount DESC (NOT updatedAt). Mastra orders by
    // generationCount; the storage adapter follows the same convention so that
    // "current record" means the same thing at every layer.
    const latest = drizzleDb
      .select()
      .from(observationalMemory)
      .where(eq(observationalMemory.lookupKey, "thread:sess1"))
      .orderBy(desc(observationalMemory.generationCount))
      .all()[0];

    expect(latest!.id).toBe("om2");
    expect(latest!.generationCount).toBe(2);
  });
});
