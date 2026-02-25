import { taskStorage } from "@sakti-code/core/memory/task/storage";
import { getDb, taskSessions, tasks } from "@sakti-code/server/db";
import { eq, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const testApp = (await import("../../index")).app;

describe("Tasks API", () => {
  let testSessionId: string;
  const testCredentials = btoa("testuser:testpass");

  beforeEach(async () => {
    process.env.SAKTI_CODE_USERNAME = "testuser";
    process.env.SAKTI_CODE_PASSWORD = "testpass";
    const db = await getDb();
    const sessionId = uuidv7();
    await db
      .insert(taskSessions)
      .values({
        session_id: sessionId,
        thread_id: sessionId,
        resource_id: "resource-456",
        title: "Test Session",
        last_accessed: new Date(),
        created_at: new Date(),
      })
      .returning();
    testSessionId = sessionId;
  });

  afterEach(async () => {
    const db = await getDb();
    await db.delete(tasks).where(eq(tasks.id, "task-api-1")).execute();
    await db.delete(tasks).where(eq(tasks.id, "task-all-1")).execute();
    await db.delete(tasks).where(eq(tasks.id, "task-all-2")).execute();
    await db.delete(tasks).where(eq(tasks.id, "task-session-target")).execute();
    await db
      .delete(tasks)
      .where(sql`${tasks.id} LIKE 'task-noise-%'`)
      .execute();
    await db.delete(taskSessions).where(eq(taskSessions.session_id, testSessionId)).execute();
  });

  it("GET /api/agent-tasks/:sessionId should return tasks for session", async () => {
    await taskStorage.createTask({
      id: "task-api-1",
      title: "API Test Task",
      sessionId: testSessionId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const res = await testApp.request(`/api/agent-tasks/${testSessionId}`, {
      headers: {
        Authorization: `Basic ${testCredentials}`,
        "X-Task-Session-ID": testSessionId,
      },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tasks).toHaveLength(1);
    expect(body.tasks[0].title).toBe("API Test Task");
  });

  it("GET /api/agent-tasks/:sessionId should return empty array when no tasks", async () => {
    const res = await testApp.request(`/api/agent-tasks/${testSessionId}`, {
      headers: {
        Authorization: `Basic ${testCredentials}`,
        "X-Task-Session-ID": testSessionId,
      },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tasks).toHaveLength(0);
  });

  it("GET /api/agent-tasks should list all tasks with filters", async () => {
    await taskStorage.createTask({
      id: "task-all-1",
      title: "Open Task",
      status: "open",
      sessionId: testSessionId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    await taskStorage.createTask({
      id: "task-all-2",
      title: "Closed Task",
      status: "closed",
      sessionId: testSessionId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const res = await testApp.request("/api/agent-tasks?status=open", {
      headers: {
        Authorization: `Basic ${testCredentials}`,
        "X-Task-Session-ID": testSessionId,
      },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tasks.length).toBeGreaterThan(0);
    expect(body.tasks[0].status).toBe("open");
  });

  it(
    "GET /api/agent-tasks/:sessionId should not be clipped by unrelated global tasks",
    async () => {
    const now = Date.now();
    for (let i = 0; i < 120; i++) {
      await taskStorage.createTask({
        id: `task-noise-${i}`,
        title: `Noise ${i}`,
        createdAt: now + i,
        updatedAt: now + i,
      });
    }

    await taskStorage.createTask({
      id: "task-session-target",
      title: "Target session task",
      sessionId: testSessionId,
      createdAt: now + 500,
      updatedAt: now + 500,
    });

    const res = await testApp.request(`/api/agent-tasks/${testSessionId}`, {
      headers: {
        Authorization: `Basic ${testCredentials}`,
        "X-Task-Session-ID": testSessionId,
      },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tasks).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "task-session-target" })])
    );
    }
  );
});
