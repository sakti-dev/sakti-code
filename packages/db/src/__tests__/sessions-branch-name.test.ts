import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { type DrizzleDB, initDatabase, ProjectRepo, SessionRepo } from "../index.ts";

describe("sessions pendingBranchName column", () => {
  let db: DatabaseSync;
  let drizzleDb: DrizzleDB;
  let projectRepo: ProjectRepo;
  let sessionRepo: SessionRepo;
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(import.meta.dirname!, "test-branch-XXXXXX"));
    db = new DatabaseSync(join(tmpDir, "test.db"));
    drizzleDb = await initDatabase(db);
    projectRepo = new ProjectRepo(drizzleDb);
    sessionRepo = new SessionRepo(drizzleDb);
  });

  afterAll(() => {
    db?.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("update accepts pendingBranchName", async () => {
    const project = await projectRepo.create("branch-test-1", "/tmp/branch-test-1");
    const session = await sessionRepo.create(project.id, { kind: "plan" });
    await sessionRepo.update(session.id, { pendingBranchName: "feat/my-feature" });
    const updated = sessionRepo.findById(session.id);
    expect(updated?.pendingBranchName).toBe("feat/my-feature");
  });

  it("update clears pendingBranchName with null", async () => {
    const project = await projectRepo.create("branch-test-2", "/tmp/branch-test-2");
    const session = await sessionRepo.create(project.id, {
      kind: "plan",
      pendingBranchName: "feat/my-feature",
    });
    expect(session.pendingBranchName).toBe("feat/my-feature");
    await sessionRepo.update(session.id, { pendingBranchName: null });
    const updated = sessionRepo.findById(session.id);
    expect(updated?.pendingBranchName).toBeNull();
  });
});
