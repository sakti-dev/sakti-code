import { sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { beforeEach, describe, expect, it } from "vitest";

import { db, taskSessionRuns, taskSessions, threads } from "../../../db";

const testApp = (await import("../../index")).app;

describe("run-events routes", () => {
  const auth = `Basic ${btoa("testuser:testpass")}`;

  beforeEach(async () => {
    process.env.SAKTI_CODE_USERNAME = "testuser";
    process.env.SAKTI_CODE_PASSWORD = "testpass";
  });

  it("GET /api/runs/:runId/events returns replay list", async () => {
    const sessionId = uuidv7();
    const runId = uuidv7();
    const now = new Date();

    await db.insert(taskSessions).values({
      session_id: sessionId,
      thread_id: sessionId,
      resource_id: "local",
      title: "Run Events API",
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
      title: "Run Events API",
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

    const { appendTaskRunEvent } = await import("../../../db/task-run-events");
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

    const res = await testApp.request(`/api/runs/${runId}/events?afterEventSeq=0&limit=10`, {
      headers: { Authorization: auth },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.runId).toBe(runId);
    expect(body.events).toHaveLength(2);
    expect(body.lastEventSeq).toBe(2);
  });

  it("GET /api/runs/:runId/events:sse replays backlog and tails until terminal", async () => {
    const sessionId = uuidv7();
    const runId = uuidv7();
    const now = new Date();

    await db.insert(taskSessions).values({
      session_id: sessionId,
      thread_id: sessionId,
      resource_id: "local",
      title: "Run Events API",
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
      title: "Run Events API",
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
      started_at: now,
      lease_owner: "worker-1",
    });

    const { appendTaskRunEvent } = await import("../../../db/task-run-events");
    await appendTaskRunEvent({
      runId,
      taskSessionId: sessionId,
      eventType: "a",
      payload: { n: 1 },
    });

    setTimeout(() => {
      void (async () => {
        await appendTaskRunEvent({
          runId,
          taskSessionId: sessionId,
          eventType: "b",
          payload: { n: 2 },
        });
        await db
          .update(taskSessionRuns)
          .set({
            state: "completed",
            finished_at: new Date(),
            updated_at: new Date(),
            lease_owner: null,
            lease_expires_at: null,
          })
          .where(sql`run_id = ${runId}`);
      })();
    }, 50);

    const res = await testApp.request(`/api/runs/${runId}/events:sse?afterEventSeq=0`, {
      headers: { Authorization: auth },
    });

    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("id: 1");
    expect(body).toContain("id: 2");
    expect(body).toContain('"eventType":"a"');
    expect(body).toContain('"eventType":"b"');
  });
});
