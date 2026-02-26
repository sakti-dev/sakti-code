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
    title: "Worker Test",
    workspace_id: null,
    created_at: now,
    last_accessed: now,
    last_activity_at: now,
    status: "researching",
    session_kind: "task",
    spec_type: null,
  });
}

describe("task-run-worker", () => {
  beforeEach(async () => {
    const { setupTestDatabase } = await import("../../../db/test-setup");
    await setupTestDatabase();
    await db.delete(taskSessionRuns);
    await db.delete(taskSessions);
  });

  it("claims and completes queued run", async () => {
    const sessionId = uuidv7();
    await createSession(sessionId);

    const { createTaskSessionRun } = await import("../../../db/task-session-runs");
    const { listTaskRunEventsAfter } = await import("../../../db/task-run-events");
    const run = await createTaskSessionRun({
      taskSessionId: sessionId,
      runtimeMode: "build",
      clientRequestKey: "worker-success",
      input: { message: "hello" },
    });

    const { TaskRunWorker } = await import("../task-run-worker");
    const worker = new TaskRunWorker({
      workerId: "worker-test",
      executor: async () => ({ status: "completed" }),
    });

    const processed = await worker.processOnce();
    expect(processed).toBe(true);

    const stored = await db
      .select()
      .from(taskSessionRuns)
      .where(eq(taskSessionRuns.run_id, run.runId))
      .get();
    expect(stored?.state).toBe("completed");

    const events = await listTaskRunEventsAfter({ runId: run.runId, afterEventSeq: 0, limit: 10 });
    expect(events.map(e => e.eventType)).toContain("run.completed");
  });

  it("marks run failed when executor throws", async () => {
    const sessionId = uuidv7();
    await createSession(sessionId);

    const { createTaskSessionRun } = await import("../../../db/task-session-runs");
    const run = await createTaskSessionRun({
      taskSessionId: sessionId,
      runtimeMode: "plan",
      clientRequestKey: "worker-failure",
      input: { message: "hello" },
    });

    const { TaskRunWorker } = await import("../task-run-worker");
    const worker = new TaskRunWorker({
      workerId: "worker-test",
      executor: async () => {
        throw new Error("boom");
      },
    });

    await worker.processOnce();

    const stored = await db
      .select()
      .from(taskSessionRuns)
      .where(eq(taskSessionRuns.run_id, run.runId))
      .get();
    expect(stored?.state).toBe("failed");
    expect(stored?.error_message).toContain("boom");
  });
});
