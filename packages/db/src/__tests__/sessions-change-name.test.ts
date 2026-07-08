import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { type DrizzleDB, initDatabase, ProjectRepo, SessionRepo } from "../index";

describe("sessions changeName column", () => {
  let db: DatabaseSync;
  let drizzleDb: DrizzleDB;
  let projectRepo: ProjectRepo;
  let sessionRepo: SessionRepo;
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(import.meta.dirname!, "test-changename-XXXXXX"));
    db = new DatabaseSync(join(tmpDir, "test.db"));
    drizzleDb = await initDatabase(db);
    projectRepo = new ProjectRepo(drizzleDb);
    sessionRepo = new SessionRepo(drizzleDb);
  });

  afterAll(() => {
    db?.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("defaults to null when not specified", async () => {
    const project = await projectRepo.create("test", "/tmp/test");
    const session = await sessionRepo.create(project.id);
    expect(session.changeName).toBeNull();
  });

  it("can be set at creation", async () => {
    const project = await projectRepo.create("test2", "/tmp/test2");
    const session = await sessionRepo.create(project.id, {
      changeName: "add-phase-transition",
    });
    expect(session.changeName).toBe("add-phase-transition");
  });

  it("can be updated after creation", async () => {
    const project = await projectRepo.create("test3", "/tmp/test3");
    const session = await sessionRepo.create(project.id);
    const updated = await sessionRepo.update(session.id, {
      changeName: "graduate-to-mission",
    });
    expect(updated.changeName).toBe("graduate-to-mission");
  });

  it("can be cleared back to null", async () => {
    const project = await projectRepo.create("test4", "/tmp/test4");
    const session = await sessionRepo.create(project.id, {
      changeName: "temp-change",
    });
    const cleared = await sessionRepo.update(session.id, { changeName: null });
    expect(cleared.changeName).toBeNull();
  });
});
