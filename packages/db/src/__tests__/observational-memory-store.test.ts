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
