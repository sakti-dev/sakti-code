import { sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { beforeEach, describe, expect, it } from "vitest";

import { db, taskRunEvents, taskSessionRuns, taskSessions } from "../../../db";

const testApp = (await import("../../index")).app;

describe("task-run routes", () => {
  const auth = `Basic ${btoa("testuser:testpass")}`;

  beforeEach(async () => {
    process.env.SAKTI_CODE_USERNAME = "testuser";
    process.env.SAKTI_CODE_PASSWORD = "testpass";
  });

  it("POST /api/task-sessions/:id/runs creates run", async () => {
    const sessionId = uuidv7();
    const now = new Date();
    await db.insert(taskSessions).values({
      session_id: sessionId,
      thread_id: sessionId,
      resource_id: "local",
      title: "Run API",
      workspace_id: null,
      created_at: now,
      last_accessed: now,
      last_activity_at: now,
      status: "researching",
      session_kind: "task",
      spec_type: null,
    });

    const res = await testApp.request(`/api/task-sessions/${sessionId}/runs`, {
      method: "POST",
      headers: {
        Authorization: auth,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        runtimeMode: "plan",
        input: { message: "hello" },
        clientRequestKey: "k-1",
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.run?.taskSessionId).toBe(sessionId);
    expect(body.run?.state).toBe("queued");

    const runEvents = await db
      .select()
      .from(taskRunEvents)
      .where(sql`run_id = ${body.run.runId}`);
    expect(runEvents.length).toBeGreaterThanOrEqual(1);
  });

  it("POST with same clientRequestKey is idempotent and returns 200", async () => {
    const sessionId = uuidv7();
    const now = new Date();
    await db.insert(taskSessions).values({
      session_id: sessionId,
      thread_id: sessionId,
      resource_id: "local",
      title: "Run API",
      workspace_id: null,
      created_at: now,
      last_accessed: now,
      last_activity_at: now,
      status: "researching",
      session_kind: "task",
      spec_type: null,
    });

    const payload = JSON.stringify({
      runtimeMode: "plan",
      input: { message: "hello" },
      clientRequestKey: "idem-key",
    });

    const first = await testApp.request(`/api/task-sessions/${sessionId}/runs`, {
      method: "POST",
      headers: {
        Authorization: auth,
        "Content-Type": "application/json",
      },
      body: payload,
    });
    const second = await testApp.request(`/api/task-sessions/${sessionId}/runs`, {
      method: "POST",
      headers: {
        Authorization: auth,
        "Content-Type": "application/json",
      },
      body: payload,
    });

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    const a = await first.json();
    const b = await second.json();
    expect(b.run.runId).toBe(a.run.runId);
  });

  it("GET /api/task-sessions/:id/runs lists runs", async () => {
    const sessionId = uuidv7();
    const now = new Date();
    await db.insert(taskSessions).values({
      session_id: sessionId,
      thread_id: sessionId,
      resource_id: "local",
      title: "Run API",
      workspace_id: null,
      created_at: now,
      last_accessed: now,
      last_activity_at: now,
      status: "researching",
      session_kind: "task",
      spec_type: null,
    });

    await testApp.request(`/api/task-sessions/${sessionId}/runs`, {
      method: "POST",
      headers: {
        Authorization: auth,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        runtimeMode: "build",
        input: { message: "a" },
        clientRequestKey: "k-2",
      }),
    });

    const res = await testApp.request(`/api/task-sessions/${sessionId}/runs`, {
      headers: { Authorization: auth },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.runs)).toBe(true);
    expect(body.runs.length).toBeGreaterThanOrEqual(1);
  });

  it("POST /api/runs/:runId/cancel requests cancel", async () => {
    const sessionId = uuidv7();
    const now = new Date();
    await db.insert(taskSessions).values({
      session_id: sessionId,
      thread_id: sessionId,
      resource_id: "local",
      title: "Run API",
      workspace_id: null,
      created_at: now,
      last_accessed: now,
      last_activity_at: now,
      status: "researching",
      session_kind: "task",
      spec_type: null,
    });

    const createRes = await testApp.request(`/api/task-sessions/${sessionId}/runs`, {
      method: "POST",
      headers: {
        Authorization: auth,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        runtimeMode: "build",
        input: { message: "a" },
        clientRequestKey: "k-3",
      }),
    });
    const created = await createRes.json();

    const res = await testApp.request(`/api/runs/${created.run.runId}/cancel`, {
      method: "POST",
      headers: { Authorization: auth },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.run.state).toBe("canceled");
  });

  it("POST /api/runs/:runId/cancel marks running run as cancel_requested", async () => {
    const sessionId = uuidv7();
    const runId = uuidv7();
    const now = new Date();
    await db.insert(taskSessions).values({
      session_id: sessionId,
      thread_id: sessionId,
      resource_id: "local",
      title: "Run API",
      workspace_id: null,
      created_at: now,
      last_accessed: now,
      last_activity_at: now,
      status: "researching",
      session_kind: "task",
      spec_type: null,
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
      lease_expires_at: new Date(now.getTime() + 30_000),
    });

    const res = await testApp.request(`/api/runs/${runId}/cancel`, {
      method: "POST",
      headers: { Authorization: auth },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.run.state).toBe("cancel_requested");
  });

  it("POST /api/task-sessions/:id/runs returns 409 when active run exists", async () => {
    const sessionId = uuidv7();
    const now = new Date();
    await db.insert(taskSessions).values({
      session_id: sessionId,
      thread_id: sessionId,
      resource_id: "local",
      title: "Run API",
      workspace_id: null,
      created_at: now,
      last_accessed: now,
      last_activity_at: now,
      status: "researching",
      session_kind: "task",
      spec_type: null,
    });

    await db.insert(taskSessionRuns).values({
      run_id: uuidv7(),
      task_session_id: sessionId,
      runtime_mode: "plan",
      state: "running",
      created_at: now,
      updated_at: now,
      queued_at: now,
      lease_owner: "worker-1",
    });

    const res = await testApp.request(`/api/task-sessions/${sessionId}/runs`, {
      method: "POST",
      headers: {
        Authorization: auth,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        runtimeMode: "plan",
        input: { message: "next" },
        clientRequestKey: "k-4",
      }),
    });

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(typeof body.existingRunId).toBe("string");
  });
});
