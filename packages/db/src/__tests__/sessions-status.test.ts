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

  it("defaults a new task session to 'specify'", async () => {
    const project = await projectRepo.create("status-test", "/tmp/status-test");
    const session = await sessionRepo.create(project.id);
    expect(session.status).toBe("specify");
  });

  it("can be updated to build/verify/archive/done", async () => {
    const project = await projectRepo.create("status-test-2", "/tmp/status-test-2");
    const session = await sessionRepo.create(project.id);

    const build = await sessionRepo.update(session.id, { status: "build" });
    expect(build.status).toBe("build");

    const verify = await sessionRepo.update(session.id, { status: "verify" });
    expect(verify.status).toBe("verify");

    const archive = await sessionRepo.update(session.id, { status: "archive" });
    expect(archive.status).toBe("archive");

    const done = await sessionRepo.update(session.id, { status: "done" });
    expect(done.status).toBe("done");
  });

  it("can be created with an explicit status", async () => {
    const project = await projectRepo.create("status-test-3", "/tmp/status-test-3");
    const session = await sessionRepo.create(project.id, { status: "build" });
    expect(session.status).toBe("build");
  });
});
