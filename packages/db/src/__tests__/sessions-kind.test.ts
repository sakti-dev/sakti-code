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

  it("can be set to 'plan'", async () => {
    const project = await projectRepo.create("test2", "/tmp/test2");
    const session = await sessionRepo.create(project.id, {
      kind: "plan",
    });
    expect(session.kind).toBe("plan");
  });

  it("listChildPlansByProject returns all plan sessions for a project, newest first", async () => {
    const project = await projectRepo.create("list-test", "/tmp/list-test");
    const mission = await sessionRepo.create(project.id, { kind: "mission" });
    const planA = await sessionRepo.create(project.id, { kind: "plan" });
    const planB = await sessionRepo.create(project.id, { kind: "plan" });

    const list = sessionRepo.listChildPlansByProject(project.id);
    expect(list).toHaveLength(2);
    // newest first
    expect(list[0]!.id).toBe(planB.id);
    expect(list[1]!.id).toBe(planA.id);
    // the mission is excluded
    expect(list.find((s) => s.id === mission.id)).toBeUndefined();
  });

  it("listChildPlansByProject returns empty array for a project with no plans", async () => {
    const project = await projectRepo.create("empty-test", "/tmp/empty-test");
    await sessionRepo.create(project.id, { kind: "mission" });

    const list = sessionRepo.listChildPlansByProject(project.id);
    expect(list).toEqual([]);
  });
});
