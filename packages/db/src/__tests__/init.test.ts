import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";
import { initDatabase } from "../init";

describe("initDatabase", () => {
  let db: DatabaseSync;
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(import.meta.dirname!, "test-db-XXXXXX"));
  });

  afterAll(() => {
    db?.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("creates all tables, enables WAL mode and foreign keys", async () => {
    db = new DatabaseSync(join(tmpDir, "test.db"));
    const drizzleDb = await initDatabase(db);

    // WAL mode
    const journalMode = db.prepare("PRAGMA journal_mode").get() as Record<string, string>;
    expect(journalMode.journal_mode).toBe("wal");

    // Foreign keys
    const fk = db.prepare("PRAGMA foreign_keys").get() as Record<string, number>;
    expect(fk.foreign_keys).toBe(1);

    // Tables exist
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as Array<{ name: string }>;
    const names = tables.map((t) => t.name);

    expect(names).toContain("projects");
    expect(names).toContain("sessions");
    expect(names).toContain("settings");
    expect(names).toContain("session_entries");
    expect(names).toContain("observational_memory");
    expect(names).not.toContain("model_configs");

    // Can insert into each table
    db.prepare(
      "INSERT INTO projects (id, name, cwd, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    ).run("p1", "Test", "/tmp/test", 1, 1);
    db.prepare(
      "INSERT INTO sessions (id, project_id, model_id, profile_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("s1", "p1", "claude-sonnet", null, 1, 1);
    db.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)").run(
      "theme",
      "dark",
      1,
    );

    // profile_id column on sessions exists and is nullable
    const session = db.prepare("SELECT profile_id FROM sessions WHERE id = ?").get("s1") as {
      profile_id: string | null;
    };
    expect(session.profile_id).toBeNull();

    expect(drizzleDb).toBeDefined();
  });
});
