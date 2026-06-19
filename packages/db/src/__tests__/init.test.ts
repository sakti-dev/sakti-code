import { describe, expect, test, afterAll, beforeAll } from "bun:test";
import { Database } from "bun:sqlite";
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
    const journalMode = db.query("PRAGMA journal_mode").get() as Record<string, string>;
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
    expect(names).toContain("messages");
    expect(names).toContain("tool_executions");
    expect(names).toContain("costs");
    expect(names).toContain("settings");
    expect(names).toContain("model_configs");

    // Can insert into each table
    db.prepare("INSERT INTO projects (id, name, cwd, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run("p1", "Test", "/tmp/test", 1, 1);
    db.prepare("INSERT INTO sessions (id, project_id, model_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run("s1", "p1", "claude-sonnet", 1, 1);
    db.prepare("INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)").run("m1", "s1", "user", "hello", 1);
    db.prepare("INSERT INTO tool_executions (id, message_id, session_id, tool_name, arguments, created_at) VALUES (?, ?, ?, ?, ?, ?)").run("te1", "m1", "s1", "bash", "{}", 1);
    db.prepare("INSERT INTO costs (id, session_id, project_id, input_tokens, output_tokens, cost_usd, model_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run("c1", "s1", "p1", 100, 50, 0.01, "claude-sonnet", 1);
    db.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)").run("theme", "dark", 1);
    db.prepare("INSERT INTO model_configs (id, project_id, provider, model_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run("mc1", "p1", "anthropic", "claude-sonnet", 1, 1);

    expect(drizzleDb).toBeDefined();
  });
});
