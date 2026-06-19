import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { initDatabase } from "../../init.ts";
import {
  CostRepo,
  MessageRepo,
  ModelConfigRepo,
  ProjectRepo,
  SessionRepo,
  SettingsRepo,
} from "..";

describe("ProjectRepo", () => {
  let db: ReturnType<
    typeof initDatabase extends Promise<infer T> ? () => T : never
  >;
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

describe("MessageRepo", () => {
  let db: any;
  let tmpDir: string;
  let repo: MessageRepo;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(import.meta.dirname!, "test-XXXXXX"));
    const sqlite = new Database(join(tmpDir, "test.db"));
    db = await initDatabase(sqlite);
    repo = new MessageRepo(db);
    db.$client
      .prepare(
        "INSERT INTO projects (id, name, cwd, created_at, updated_at) VALUES ('p1', 'P', '/tmp', 1, 1)"
      )
      .run();
    db.$client
      .prepare(
        "INSERT INTO sessions (id, project_id, model_id, created_at, updated_at) VALUES ('s1', 'p1', 'm1', 1, 1)"
      )
      .run();
  });

  afterAll(() => {
    db.$client.close?.();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("append + loadBySession + countBySession", async () => {
    await repo.append("s1", { role: "user", content: "hello" });
    await repo.append("s1", {
      role: "assistant",
      content: "hi there",
      usage: '{"input":10}',
    });

    const msgs = repo.loadBySession("s1");
    expect(msgs.length).toBe(2);
    expect(msgs[0]?.role).toBe("user");
    expect(msgs[1]?.role).toBe("assistant");

    expect(repo.countBySession("s1")).toBe(2);
  });

  test("replaceForSession atomically swaps messages", async () => {
    await repo.replaceForSession("s1", [
      { role: "user", content: "summary" },
      { role: "assistant", content: "ok", usage: "{}" },
    ]);

    const msgs = repo.loadBySession("s1");
    expect(msgs.length).toBe(2);
    expect(msgs[0]?.content).toBe("summary");
    expect(msgs[1]?.content).toBe("ok");
  });
});

describe("CostRepo", () => {
  let db: any;
  let tmpDir: string;
  let repo: CostRepo;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(import.meta.dirname!, "test-XXXXXX"));
    const sqlite = new Database(join(tmpDir, "test.db"));
    db = await initDatabase(sqlite);
    repo = new CostRepo(db);
    db.$client
      .prepare(
        "INSERT INTO projects (id, name, cwd, created_at, updated_at) VALUES ('p1', 'P', '/tmp', 1, 1)"
      )
      .run();
    db.$client
      .prepare(
        "INSERT INTO sessions (id, project_id, model_id, created_at, updated_at) VALUES ('s1', 'p1', 'm1', 1, 1)"
      )
      .run();
  });

  afterAll(() => {
    db.$client.close?.();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("record + aggregateByProject", async () => {
    await repo.record(
      "s1",
      "p1",
      { inputTokens: 100, outputTokens: 50, costUsd: 0.01 },
      "claude-sonnet"
    );

    const agg = repo.aggregateByProject("p1");
    expect(agg.totalInputTokens).toBe(100);
    expect(agg.totalOutputTokens).toBe(50);
    expect(agg.totalCostUsd).toBeCloseTo(0.01, 5);
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
