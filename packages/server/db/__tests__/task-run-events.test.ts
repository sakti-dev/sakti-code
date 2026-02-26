import { v7 as uuidv7 } from "uuid";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { db, taskRunEvents, taskSessionRuns, taskSessions, threads } from "../index";

async function createRun(runId: string, sessionId: string): Promise<void> {
  const now = new Date();
  await db.insert(taskSessions).values({
    session_id: sessionId,
    thread_id: sessionId,
    resource_id: "local",
    title: "Run Events",
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
    title: "Run Events",
    metadata: null,
    created_at: now,
    updated_at: now,
  });
  await db.insert(taskSessionRuns).values({
    run_id: runId,
    task_session_id: sessionId,
    runtime_mode: "build",
    state: "running",
    created_at: now,
    updated_at: now,
    queued_at: now,
  });
}

describe("task-run-events db", () => {
  beforeEach(async () => {
    const { setupTestDatabase } = await import("../test-setup");
    await setupTestDatabase();
    await db.delete(taskRunEvents);
  });

  afterEach(async () => {
    await db.delete(taskRunEvents);
  });

  it("appends monotonic event_seq for run", async () => {
    const runId = uuidv7();
    const sessionId = uuidv7();
    await createRun(runId, sessionId);

    const { appendTaskRunEvent } = await import("../task-run-events");
    const e1 = await appendTaskRunEvent({
      runId,
      taskSessionId: sessionId,
      eventType: "task-run.updated",
      payload: { state: "running" },
    });
    const e2 = await appendTaskRunEvent({
      runId,
      taskSessionId: sessionId,
      eventType: "message.part.updated",
      payload: { text: "delta" },
    });

    expect(e1.eventSeq).toBe(1);
    expect(e2.eventSeq).toBe(2);
  });

  it("lists events strictly after cursor", async () => {
    const runId = uuidv7();
    const sessionId = uuidv7();
    await createRun(runId, sessionId);

    const { appendTaskRunEvent, listTaskRunEventsAfter } = await import("../task-run-events");
    await appendTaskRunEvent({
      runId,
      taskSessionId: sessionId,
      eventType: "a",
      payload: { n: 1 },
    });
    await appendTaskRunEvent({
      runId,
      taskSessionId: sessionId,
      eventType: "b",
      payload: { n: 2 },
    });
    await appendTaskRunEvent({
      runId,
      taskSessionId: sessionId,
      eventType: "c",
      payload: { n: 3 },
    });

    const items = await listTaskRunEventsAfter({ runId, afterEventSeq: 1, limit: 10 });
    expect(items.map(i => i.eventType)).toEqual(["b", "c"]);
  });

  it("returns last sequence for run", async () => {
    const runId = uuidv7();
    const sessionId = uuidv7();
    await createRun(runId, sessionId);

    const { appendTaskRunEvent, getLastTaskRunEventSeq } = await import("../task-run-events");
    await appendTaskRunEvent({ runId, taskSessionId: sessionId, eventType: "a", payload: {} });
    await appendTaskRunEvent({ runId, taskSessionId: sessionId, eventType: "b", payload: {} });
    const seq = await getLastTaskRunEventSeq(runId);
    expect(seq).toBe(2);
  });

  it("deduplicates by dedupeKey per run", async () => {
    const runId = uuidv7();
    const sessionId = uuidv7();
    await createRun(runId, sessionId);

    const { appendTaskRunEvent } = await import("../task-run-events");
    const a = await appendTaskRunEvent({
      runId,
      taskSessionId: sessionId,
      eventType: "message.part.updated",
      dedupeKey: "part-1",
      payload: { t: 1 },
    });
    const b = await appendTaskRunEvent({
      runId,
      taskSessionId: sessionId,
      eventType: "message.part.updated",
      dedupeKey: "part-1",
      payload: { t: 2 },
    });

    expect(b.eventId).toBe(a.eventId);
    expect(b.eventSeq).toBe(a.eventSeq);
  });
});
