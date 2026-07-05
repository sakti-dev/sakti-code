import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { type DrizzleDB, initDatabase, ProjectRepo, SessionRepo } from "../index.ts";

describe("sessions status column", () => {
  let db: DatabaseSync;
  let drizzleDb: DrizzleDB;
  let projectRepo: ProjectRepo;
  let sessionRepo: SessionRepo;
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(import.meta.dirname!, "test-status-XXXXXX"));
    db = new DatabaseSync(join(tmpDir, "test.db"));
    drizzleDb = await initDatabase(db);
    projectRepo = new ProjectRepo(drizzleDb);
    sessionRepo = new SessionRepo(drizzleDb);
  });

  afterAll(() => {
    db?.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("defaults a new task session to 'specifying'", async () => {
    const project = await projectRepo.create("status-test", "/tmp/status-test");
    const session = await sessionRepo.create(project.id);
    expect(session.status).toBe("specifying");
  });

  it("can be updated to building/review/merged", async () => {
    const project = await projectRepo.create("status-test-2", "/tmp/status-test-2");
    const session = await sessionRepo.create(project.id);

    const building = await sessionRepo.update(session.id, { status: "building" });
    expect(building.status).toBe("building");

    const review = await sessionRepo.update(session.id, { status: "review" });
    expect(review.status).toBe("review");

    const merged = await sessionRepo.update(session.id, { status: "merged" });
    expect(merged.status).toBe("merged");
  });

  it("can be created with an explicit status", async () => {
    const project = await projectRepo.create("status-test-3", "/tmp/status-test-3");
    const session = await sessionRepo.create(project.id, { status: "building" });
    expect(session.status).toBe("building");
  });
});
