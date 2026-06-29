import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";
import { initDatabase } from "../../init.ts";
import { ProjectRepo, SessionRepo, SettingsRepo } from "..";

describe("ProjectRepo", () => {
  let db: any;
  let tmpDir: string;
  let repo: ProjectRepo;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(import.meta.dirname!, "test-XXXXXX"));
    const sqlite = new DatabaseSync(join(tmpDir, "test.db"));
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
    const sqlite = new DatabaseSync(join(tmpDir, "test.db"));
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
    const s = await repo.create(proj.id, { title: "First session" });
    expect(s.id).toBeDefined();
    expect(s.modelId).toBeNull();
    expect(s.profileId).toBeNull();
    expect(s.title).toBe("First session");

    const found = repo.findById(s.id);
    expect(found?.id).toBe(s.id);

    const list = repo.listByProject(proj.id);
    expect(list.length).toBe(1);
  });

  test("create with profileId", async () => {
    const proj = await projectRepo.create("p-prof", "/tmp/p-prof");
    const s = await repo.create(proj.id, { profileId: "fast" });
    expect(s.profileId).toBe("fast");
    expect(s.modelId).toBeNull();
  });

  test("update can set profileId", async () => {
    const proj = await projectRepo.create("p-upd", "/tmp/p-upd");
    const s = await repo.create(proj.id);
    const updated = await repo.update(s.id, { profileId: "balanced" });
    expect(updated.profileId).toBe("balanced");
  });

  test("update can clear profileId", async () => {
    const proj = await projectRepo.create("p-clear", "/tmp/p-clear");
    const s = await repo.create(proj.id, { profileId: "fast" });
    const updated = await repo.update(s.id, { profileId: null });
    expect(updated.profileId).toBeNull();
  });
});

describe("SettingsRepo", () => {
  let db: any;
  let tmpDir: string;
  let repo: SettingsRepo;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(import.meta.dirname!, "test-XXXXXX"));
    const sqlite = new DatabaseSync(join(tmpDir, "test.db"));
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
