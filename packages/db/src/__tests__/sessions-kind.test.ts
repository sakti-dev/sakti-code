import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { type DrizzleDB, initDatabase, ProjectRepo, SessionRepo } from "../index";

describe("sessions kind column", () => {
  let db: DatabaseSync;
  let drizzleDb: DrizzleDB;
  let projectRepo: ProjectRepo;
  let sessionRepo: SessionRepo;
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(import.meta.dirname!, "test-kind-XXXXXX"));
    db = new DatabaseSync(join(tmpDir, "test.db"));
    drizzleDb = await initDatabase(db);
    projectRepo = new ProjectRepo(drizzleDb);
    sessionRepo = new SessionRepo(drizzleDb);
  });

  afterAll(() => {
    db?.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("defaults to 'mission' when not specified", async () => {
    const project = await projectRepo.create("test", "/tmp/test");
    const session = await sessionRepo.create(project.id);
    expect(session.kind).toBe("mission");
  });

  it("can be set to 'intake'", async () => {
    const project = await projectRepo.create("test2", "/tmp/test2");
    const session = await sessionRepo.create(project.id, {
      kind: "intake",
    });
    expect(session.kind).toBe("intake");
  });

  it("listChildIntakesByProject returns all intake sessions for a project, newest first", async () => {
    const project = await projectRepo.create("list-test", "/tmp/list-test");
    const mission = await sessionRepo.create(project.id, { kind: "mission" });
    const intakeA = await sessionRepo.create(project.id, { kind: "intake" });
    const intakeB = await sessionRepo.create(project.id, { kind: "intake" });

    const list = sessionRepo.listChildIntakesByProject(project.id);
    expect(list).toHaveLength(2);
    // newest first
    expect(list[0]!.id).toBe(intakeB.id);
    expect(list[1]!.id).toBe(intakeA.id);
    // the mission is excluded
    expect(list.find((s) => s.id === mission.id)).toBeUndefined();
  });

  it("listChildIntakesByProject returns empty array for a project with no intakes", async () => {
    const project = await projectRepo.create("empty-test", "/tmp/empty-test");
    await sessionRepo.create(project.id, { kind: "mission" });

    const list = sessionRepo.listChildIntakesByProject(project.id);
    expect(list).toEqual([]);
  });
});
