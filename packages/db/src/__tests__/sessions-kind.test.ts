import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type DrizzleDB,
  initDatabase,
  ProjectRepo,
  SessionRepo,
} from "../index";

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

  it("defaults to 'task' when not specified", async () => {
    const project = await projectRepo.create("test", "/tmp/test");
    const session = await sessionRepo.create(project.id);
    expect(session.kind).toBe("task");
  });

  it("can be set to 'intake'", async () => {
    const project = await projectRepo.create("test2", "/tmp/test2");
    const session = await sessionRepo.create(project.id, {
      kind: "intake",
    });
    expect(session.kind).toBe("intake");
  });
});
