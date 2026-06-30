import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { initDatabase } from "../init.ts";

describe("turns table schema", () => {
  let tmpDir: string;
  let rawDb: DatabaseSync;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(import.meta.dirname!, "test-XXXXXX"));
    rawDb = new DatabaseSync(join(tmpDir, "test.db"));
    initDatabase(rawDb);
  });

  afterAll(() => {
    rawDb.close?.();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates the turns table", () => {
    const tables = rawDb
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='turns'")
      .all() as Array<{ name: string }>;
    expect(tables).toHaveLength(1);
  });

  it("has expected columns", () => {
    const cols = rawDb.prepare("PRAGMA table_info(turns)").all() as {
      name: string;
      type: string;
      notnull: number;
    }[];
    const colMap = new Map(cols.map((c) => [c.name, c]));
    expect(colMap.get("id")?.type.toLowerCase()).toBe("text");
    expect(colMap.get("session_id")?.type.toLowerCase()).toBe("text");
    expect(colMap.get("sequence")?.type.toLowerCase()).toBe("integer");
    expect(colMap.get("started_at")?.type.toLowerCase()).toBe("integer");
    expect(colMap.get("ended_at")?.type.toLowerCase()).toBe("integer");
    expect(colMap.get("created_at")?.type.toLowerCase()).toBe("integer");
    expect(colMap.get("ended_at")?.notnull).toBe(0);
  });

  it("has unique index on session_id + sequence", () => {
    const indexes = rawDb
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='turns'")
      .all() as { name: string }[];
    const indexNames = indexes.map((i) => i.name);
    expect(indexNames).toContain("turns_session_id_sequence_idx");
  });
});
