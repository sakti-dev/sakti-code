import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { initDatabase } from "../init";

describe("initDatabase", () => {
  let db: Database;
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(import.meta.dirname!, "test-db-XXXXXX"));
  });

  afterAll(() => {
    db?.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("creates all tables, enables WAL mode and foreign keys", async () => {
    db = new Database(join(tmpDir, "test.db"));
    const drizzleDb = await initDatabase(db);

    // WAL mode
    const journalMode = db.query("PRAGMA journal_mode").get() as Record<
      string,
      string
    >;
    expect(journalMode.journal_mode).toBe("wal");

    // Foreign keys
    const fk = db.query("PRAGMA foreign_keys").get() as Record<string, number>;
    expect(fk.foreign_keys).toBe(1);

    // Tables exist
    const tables = db
      .query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as Array<{ name: string }>;
    const names = tables.map((t) => t.name);

    expect(names).toContain("projects");
    expect(names).toContain("sessions");
    expect(names).toContain("settings");
    expect(names).toContain("model_configs");
    expect(names).toContain("session_entries");

    // Can insert into each table
    db.prepare(
      "INSERT INTO projects (id, name, cwd, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
    ).run("p1", "Test", "/tmp/test", 1, 1);
    db.prepare(
      "INSERT INTO sessions (id, project_id, model_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
    ).run("s1", "p1", "claude-sonnet", 1, 1);
    db.prepare(
      "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)"
    ).run("theme", "dark", 1);
    db.prepare(
      "INSERT INTO model_configs (id, project_id, provider, model_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run("mc1", "p1", "anthropic", "claude-sonnet", 1, 1);

    expect(drizzleDb).toBeDefined();
  });
});
