import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";
import { initDatabase } from "../init.ts";

describe("observational_memory table", () => {
  let db: DatabaseSync;
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(import.meta.dirname!, "om-db-XXXXXX"));
    db = new DatabaseSync(join(tmpDir, "test.db"));
  });

  afterAll(() => {
    db?.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("table exists after migration", async () => {
    await initDatabase(db);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as Array<{ name: string }>;
    expect(tables.map((t) => t.name)).toContain("observational_memory");
  });
});
