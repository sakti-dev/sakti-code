import { eq } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { beforeEach, describe, expect, it } from "vitest";

import { db, taskSessionRuns, taskSessions } from "../../../db";

async function createSession(sessionId: string): Promise<void> {
  const now = new Date();
  await db.insert(taskSessions).values({
    session_id: sessionId,
    thread_id: sessionId,
    resource_id: "local",
    title: "Recovery Test",
    workspace_id: null,
    created_at: now,
    last_accessed: now,
    last_activity_at: now,
    status: "researching",
    session_kind: "task",
    spec_type: null,
  });
}

describe("task-run-recovery", () => {
  beforeEach(async () => {
    const { setupTestDatabase } = await import("../../../db/test-setup");
    await setupTestDatabase();
    await db.delete(taskSessionRuns);
    await db.delete(taskSessions);
  });

  it("requeues expired running runs", async () => {
    const sessionId = uuidv7();
    const runId = uuidv7();
    await createSession(sessionId);

    const now = new Date();
    const expired = new Date(now.getTime() - 60_000);
    await db.insert(taskSessionRuns).values({
      run_id: runId,
      task_session_id: sessionId,
      runtime_mode: "build",
      state: "running",
      attempt: 0,
      max_attempts: 3,
      created_at: now,
      updated_at: now,
      queued_at: now,
      lease_owner: "worker-x",
      lease_expires_at: expired,
    });

    const { recoverExpiredTaskRuns } = await import("../task-run-recovery");
    const count = await recoverExpiredTaskRuns(now);
    expect(count).toBe(1);

    const stored = await db
      .select()
      .from(taskSessionRuns)
      .where(eq(taskSessionRuns.run_id, runId))
      .get();
    expect(stored?.state).toBe("queued");
    expect(stored?.attempt).toBe(1);
  });
});
