import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { initDatabase } from "../../init.ts";
import { ModelConfigRepo, ProjectRepo, SessionRepo, SettingsRepo } from "..";

describe("ProjectRepo", () => {
  let db: any;
  let tmpDir: string;
  let repo: ProjectRepo;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(import.meta.dirname!, "test-XXXXXX"));
    const sqlite = new Database(join(tmpDir, "test.db"));
    db = await initDatabase(sqlite);
    repo = new ProjectRepo(db);
  });

  afterAll(() => {
    db.$client.close?.();
    rmSync(tmpDir, { recursive: true, force: true });
  });
  test("create + findById + findByCwd + list", async () => {
    const p = await repo.create("my-app", "/tmp/my-app");
    expect(p.id).toBeDefined();
    expect(p.name).toBe("my-app");
    expect(p.cwd).toBe("/tmp/my-app");

    const found = repo.findById(p.id);
    expect(found?.id).toBe(p.id);

    const byCwd = repo.findByCwd("/tmp/my-app");
    expect(byCwd?.id).toBe(p.id);

    const all = repo.list();
    expect(all.length).toBe(1);
  });

  test("findByCwd returns undefined for missing", () => {
    expect(repo.findByCwd("/nonexistent")).toBeUndefined();
  });
});

describe("SessionRepo", () => {
  let db: any;
  let tmpDir: string;
  let repo: SessionRepo;
  let projectRepo: ProjectRepo;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(import.meta.dirname!, "test-XXXXXX"));
    const sqlite = new Database(join(tmpDir, "test.db"));
    db = await initDatabase(sqlite);
    repo = new SessionRepo(db);
    projectRepo = new ProjectRepo(db);
  });

  afterAll(() => {
    db.$client.close?.();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("create + findById + listByProject", async () => {
    const proj = await projectRepo.create("p", "/tmp/p");
    const s = await repo.create(proj.id, "claude-sonnet", {
      title: "First session",
    });
    expect(s.id).toBeDefined();
    expect(s.modelId).toBe("claude-sonnet");
    expect(s.title).toBe("First session");

    const found = repo.findById(s.id);
    expect(found?.id).toBe(s.id);

    const list = repo.listByProject(proj.id);
    expect(list.length).toBe(1);
  });
});

describe("SettingsRepo", () => {
  let db: any;
  let tmpDir: string;
  let repo: SettingsRepo;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(import.meta.dirname!, "test-XXXXXX"));
    const sqlite = new Database(join(tmpDir, "test.db"));
    db = await initDatabase(sqlite);
    repo = new SettingsRepo(db);
  });

  afterAll(() => {
    db.$client.close?.();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("set + get + getAll", async () => {
    expect(repo.get("theme")).toBeNull();
    await repo.set("theme", "dark");
    expect(repo.get("theme")).toBe("dark");
    await repo.set("theme", "light");
    expect(repo.get("theme")).toBe("light");
    expect(repo.getAll().length).toBe(1);
  });

  test("getByPrefix returns all keys matching a prefix", async () => {
    await repo.set("session:sess_1:auto_compaction", "false");
    await repo.set("session:sess_1:auto_retry", "true");
    await repo.set("session:sess_1:max_retries", "5");
    await repo.set("session:sess_2:auto_retry", "true");

    const rows = repo.getByPrefix("session:sess_1:");
    expect(rows).toHaveLength(3);
    const keys = rows.map((r) => r.key).sort();
    expect(keys).toEqual(
      [
        "session:sess_1:auto_compaction",
        "session:sess_1:auto_retry",
        "session:sess_1:max_retries",
      ].sort()
    );
    // Each row carries its value.
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    expect(byKey["session:sess_1:auto_retry"]).toBe("true");
  });

  test("getByPrefix returns [] for an unmatched prefix", () => {
    expect(repo.getByPrefix("session:never_set:")).toEqual([]);
  });
});

describe("ModelConfigRepo", () => {
  let db: any;
  let tmpDir: string;
  let repo: ModelConfigRepo;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(import.meta.dirname!, "test-XXXXXX"));
    const sqlite = new Database(join(tmpDir, "test.db"));
    db = await initDatabase(sqlite);
    repo = new ModelConfigRepo(db);
    db.$client
      .prepare(
        "INSERT INTO projects (id, name, cwd, created_at, updated_at) VALUES ('p1', 'P', '/tmp', 1, 1)"
      )
      .run();
  });

  afterAll(() => {
    db.$client.close?.();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("set + getForProject with fallback to global", async () => {
    await repo.set({
      projectId: "p1",
      provider: "anthropic",
      modelId: "claude-sonnet",
    });
    const config = repo.getForProject("p1");
    expect(config?.provider).toBe("anthropic");

    // Project with no config falls back to global
    db.$client
      .prepare(
        "INSERT INTO projects (id, name, cwd, created_at, updated_at) VALUES ('p2', 'P2', '/tmp2', 1, 1)"
      )
      .run();
    expect(repo.getForProject("p2")).toBeNull();

    // After setting global default
    await repo.set({ provider: "openai", modelId: "gpt-4o" });
    expect(repo.getForProject("p2")?.provider).toBe("openai");
    // Project-specific still takes precedence
    expect(repo.getForProject("p1")?.provider).toBe("anthropic");
  });
});
