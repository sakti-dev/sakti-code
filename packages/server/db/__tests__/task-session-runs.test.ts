import { eq, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { db, taskSessionRuns, taskSessions, threads } from "../index";

async function createSession(sessionId: string): Promise<void> {
  const now = new Date();
  await db.insert(taskSessions).values({
    session_id: sessionId,
    thread_id: sessionId,
    resource_id: "local",
    title: "Run Test",
    workspace_id: null,
    created_at: now,
    last_accessed: now,
    last_activity_at: now,
    status: "researching",
    session_kind: "task",
    spec_type: null,
  });
  await db.insert(threads).values({
    id: sessionId,
    resource_id: "local",
    title: "Run Test",
    metadata: null,
    created_at: now,
    updated_at: now,
  });
}

describe("task-session-runs db", () => {
  beforeEach(async () => {
    const { setupTestDatabase } = await import("../test-setup");
    await setupTestDatabase();
    await db.delete(taskSessionRuns).where(sql`1=1`);
  });

  afterEach(async () => {
    await db.delete(taskSessionRuns).where(sql`1=1`);
  });

  it("creates queued run with idempotency key", async () => {
    const sessionId = uuidv7();
    await createSession(sessionId);

    const { createTaskSessionRun } = await import("../task-session-runs");
    const run = await createTaskSessionRun({
      taskSessionId: sessionId,
      runtimeMode: "plan",
      clientRequestKey: "req-1",
      input: { message: "hello" },
    });

    expect(run.state).toBe("queued");
    expect(run.clientRequestKey).toBe("req-1");
  });

  it("returns same run for duplicate idempotency key", async () => {
    const sessionId = uuidv7();
    await createSession(sessionId);

    const { createTaskSessionRun } = await import("../task-session-runs");
    const first = await createTaskSessionRun({
      taskSessionId: sessionId,
      runtimeMode: "build",
      clientRequestKey: "idem-1",
      input: { message: "a" },
    });
    const second = await createTaskSessionRun({
      taskSessionId: sessionId,
      runtimeMode: "build",
      clientRequestKey: "idem-1",
      input: { message: "b" },
    });

    expect(second.runId).toBe(first.runId);
  });

  it("claims queued run with lease owner and expiry", async () => {
    const sessionId = uuidv7();
    await createSession(sessionId);

    const { createTaskSessionRun, claimNextTaskSessionRun } = await import("../task-session-runs");
    await createTaskSessionRun({
      taskSessionId: sessionId,
      runtimeMode: "build",
      clientRequestKey: "req-2",
      input: { message: "build" },
    });

    const claimed = await claimNextTaskSessionRun({ workerId: "worker-A", leaseMs: 30000 });
    expect(claimed).not.toBeNull();
    expect(claimed?.state).toBe("running");
    expect(claimed?.leaseOwner).toBe("worker-A");
  });

  it("heartbeats running run", async () => {
    const sessionId = uuidv7();
    await createSession(sessionId);

    const {
      createTaskSessionRun,
      claimNextTaskSessionRun,
      heartbeatTaskSessionRun,
      getTaskSessionRunById,
    } = await import("../task-session-runs");

    const run = await createTaskSessionRun({
      taskSessionId: sessionId,
      runtimeMode: "build",
      clientRequestKey: "req-3",
      input: { message: "hb" },
    });

    await claimNextTaskSessionRun({ workerId: "worker-A", leaseMs: 1000 });
    await heartbeatTaskSessionRun({ runId: run.runId, workerId: "worker-A", leaseMs: 1000 });

    const refreshed = await getTaskSessionRunById(run.runId);
    expect(refreshed?.lastHeartbeatAt).toBeDefined();
    expect(refreshed?.leaseExpiresAt).toBeDefined();
  });

  it("supports cancel request then canceled terminal state", async () => {
    const sessionId = uuidv7();
    await createSession(sessionId);

    const { createTaskSessionRun, requestTaskSessionRunCancel, getTaskSessionRunById } =
      await import("../task-session-runs");

    const run = await createTaskSessionRun({
      taskSessionId: sessionId,
      runtimeMode: "plan",
      clientRequestKey: "req-4",
      input: { message: "cancel" },
    });

    await requestTaskSessionRunCancel(run.runId);
    const afterRequest = await getTaskSessionRunById(run.runId);
    expect(afterRequest?.state).toBe("canceled");
  });

  it("does not mutate terminal run when cancel is requested again", async () => {
    const sessionId = uuidv7();
    await createSession(sessionId);

    const {
      createTaskSessionRun,
      requestTaskSessionRunCancel,
      markTaskSessionRunCompleted,
      claimNextTaskSessionRun,
      getTaskSessionRunById,
    } = await import("../task-session-runs");

    const run = await createTaskSessionRun({
      taskSessionId: sessionId,
      runtimeMode: "build",
      clientRequestKey: "terminal-cancel",
      input: { message: "done" },
    });

    await claimNextTaskSessionRun({ workerId: "worker-A", leaseMs: 30_000 });
    await markTaskSessionRunCompleted({ runId: run.runId, workerId: "worker-A" });

    const before = await getTaskSessionRunById(run.runId);
    expect(before?.state).toBe("completed");

    const after = await requestTaskSessionRunCancel(run.runId);
    expect(after?.state).toBe("completed");
  });

  it("marks completed terminal state", async () => {
    const sessionId = uuidv7();
    await createSession(sessionId);

    const {
      createTaskSessionRun,
      claimNextTaskSessionRun,
      markTaskSessionRunCompleted,
      getTaskSessionRunById,
    } = await import("../task-session-runs");

    const run = await createTaskSessionRun({
      taskSessionId: sessionId,
      runtimeMode: "build",
      clientRequestKey: "req-5",
      input: { message: "done" },
    });

    await claimNextTaskSessionRun({ workerId: "worker-A", leaseMs: 30000 });
    await markTaskSessionRunCompleted({ runId: run.runId, workerId: "worker-A" });

    const completed = await getTaskSessionRunById(run.runId);
    expect(completed?.state).toBe("completed");
    expect(completed?.finishedAt).toBeDefined();
  });

  it("stores run rows in db", async () => {
    const sessionId = uuidv7();
    await createSession(sessionId);

    const { createTaskSessionRun } = await import("../task-session-runs");
    const run = await createTaskSessionRun({
      taskSessionId: sessionId,
      runtimeMode: "intake",
      clientRequestKey: "req-db",
      input: { message: "db" },
    });

    const stored = await db
      .select()
      .from(taskSessionRuns)
      .where(eq(taskSessionRuns.run_id, run.runId))
      .get();

    expect(stored).toBeDefined();
    expect(stored?.state).toBe("queued");
  });
});
