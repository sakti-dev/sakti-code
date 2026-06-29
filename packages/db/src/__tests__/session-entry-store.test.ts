import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { SessionMetadata, SessionTreeEntry } from "@sakti-code/agent";
import { Effect } from "effect";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { DrizzleDB } from "../init";
import { initDatabase } from "../init";
import { SqliteSessionStorage } from "../session-entry-store";

describe("SqliteSessionStorage", () => {
  let sqlite: DatabaseSync;
  let db: DrizzleDB;
  let tmpDir: string;
  let storage: SqliteSessionStorage;

  const metadata: SessionMetadata = {
    id: "s1",
    createdAt: new Date().toISOString(),
  };

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(import.meta.dirname!, "test-entries-XXXXXX"));
    sqlite = new DatabaseSync(join(tmpDir, "test.db"));
    db = await initDatabase(sqlite);

    sqlite
      .prepare(
        "INSERT INTO projects (id, name, cwd, created_at, updated_at) VALUES ('p1', 'P', '/tmp', 1, 1)"
      )
      .run();
    sqlite
      .prepare(
        "INSERT INTO sessions (id, project_id, model_id, created_at, updated_at) VALUES ('s1', 'p1', 'claude', 1, 1)"
      )
      .run();

    storage = new SqliteSessionStorage(db, "s1", metadata);
  });

  afterAll(() => {
    sqlite.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("getMetadata returns provided metadata", async () => {
    const m = await Effect.runPromise(storage.getMetadata());
    expect(m.id).toBe("s1");
  });

  test("appendEntry + getEntry round-trip for message entry", async () => {
    const id = await Effect.runPromise(storage.createEntryId());
    const entry: SessionTreeEntry = {
      type: "message",
      id,
      parentId: null,
      timestamp: new Date().toISOString(),
      message: {
        role: "user",
        content: "hello",
        timestamp: Date.now(),
      },
    };

    await Effect.runPromise(storage.appendEntry(entry));

    const retrieved = await Effect.runPromise(storage.getEntry(id));
    expect(retrieved).toBeDefined();
    expect(retrieved!.type).toBe("message");
    if (retrieved!.type === "message") {
      expect(retrieved.message.role).toBe("user");
    }
  });

  test("appendEntry updates leafId on sessions table", async () => {
    const leafId = await Effect.runPromise(storage.getLeafId());
    expect(leafId).not.toBeNull();
  });

  test("leaf entry does NOT update leafId", async () => {
    const prevLeaf = await Effect.runPromise(storage.getLeafId());
    const id = await Effect.runPromise(storage.createEntryId());
    const leafEntry: SessionTreeEntry = {
      type: "leaf",
      id,
      parentId: null,
      timestamp: new Date().toISOString(),
      targetId: prevLeaf,
    };

    await Effect.runPromise(storage.appendEntry(leafEntry));

    const leafId = await Effect.runPromise(storage.getLeafId());
    expect(leafId).toBe(prevLeaf);
  });

  test("findEntries filters by kind", async () => {
    const msgEntries = await Effect.runPromise(storage.findEntries("message"));
    expect(msgEntries.length).toBeGreaterThanOrEqual(1);
    for (const e of msgEntries) {
      expect(e.type).toBe("message");
    }
  });

  test("getPathToRoot returns entries in root-to-leaf order", async () => {
    const leafId = await Effect.runPromise(storage.getLeafId());
    if (!leafId) {
      return;
    }
    const entries = await Effect.runPromise(storage.getPathToRoot(leafId));
    expect(entries.length).toBeGreaterThanOrEqual(1);
    expect(entries[0]!.parentId).toBeNull();
  });

  test("getEntries returns all entries ordered by sequence", async () => {
    const entries = await Effect.runPromise(storage.getEntries());
    expect(entries.length).toBeGreaterThanOrEqual(2);
  });

  test("setLeafId updates leaf pointer", async () => {
    await Effect.runPromise(storage.setLeafId("custom-leaf"));
    const leafId = await Effect.runPromise(storage.getLeafId());
    expect(leafId).toBe("custom-leaf");

    await Effect.runPromise(storage.setLeafId("e1"));
  });

  test("getLabel returns label for label entries", async () => {
    const id = await Effect.runPromise(storage.createEntryId());
    await Effect.runPromise(
      storage.appendEntry({
        type: "label",
        id,
        parentId: "e1",
        timestamp: new Date().toISOString(),
        targetId: "e1",
        label: "my-label",
      })
    );

    const label = await Effect.runPromise(storage.getLabel(id));
    expect(label).toBe("my-label");
  });

  test("getPathToRoot with null returns all entries", async () => {
    const entries = await Effect.runPromise(storage.getPathToRoot(null));
    const allEntries = await Effect.runPromise(storage.getEntries());
    expect(entries.length).toBe(allEntries.length);
  });

  test("compaction entry round-trip", async () => {
    const id = await Effect.runPromise(storage.createEntryId());
    const entry: SessionTreeEntry = {
      type: "compaction",
      id,
      parentId: "e1",
      timestamp: new Date().toISOString(),
      summary: "Previous work summarized",
      firstKeptEntryId: "e1",
      tokensBefore: 5000,
    };

    await Effect.runPromise(storage.appendEntry(entry));
    const retrieved = await Effect.runPromise(storage.getEntry(id));
    expect(retrieved).toBeDefined();
    expect(retrieved!.type).toBe("compaction");
    if (retrieved!.type === "compaction") {
      expect(retrieved.summary).toBe("Previous work summarized");
      expect(retrieved.tokensBefore).toBe(5000);
    }
  });
});
