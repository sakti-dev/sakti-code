/**
 * Tests for task sessions API routes
 */

import { app } from "@/app/app";
import { getDb, taskSessions } from "@sakti-code/server/db";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

describe("task-sessions routes", () => {
  const testCredentials = btoa("testuser:testpass");

  beforeEach(async () => {
    process.env.SAKTI_CODE_USERNAME = "testuser";
    process.env.SAKTI_CODE_PASSWORD = "testpass";
    const db = await getDb();
    await db.delete(taskSessions);
  });

  async function cleanupTaskSessions() {
    const db = await getDb();
    await db
      .delete(taskSessions)
      .where(eq(taskSessions.session_id, "test-task-session-1"))
      .execute();
    await db
      .delete(taskSessions)
      .where(eq(taskSessions.session_id, "test-task-session-2"))
      .execute();
    await db.delete(taskSessions).where(sql`${taskSessions.session_id} LIKE 'test-%'`);
    await db
      .delete(taskSessions)
      .where(sql`${taskSessions.session_id} LIKE 'test-task-session-kind-%'`);
  }

  describe("GET /api/task-sessions", () => {
    it("should list task sessions filtered by kind", async () => {
      const db = await getDb();
      const now = new Date();
      await db.insert(taskSessions).values([
        {
          session_id: "test-task-session-kind-1",
          resource_id: "local",
          thread_id: "test-task-session-kind-1",
          title: "Intake Session",
          session_kind: "intake",
          status: "researching",
          created_at: now,
          last_accessed: now,
          last_activity_at: now,
        },
        {
          session_id: "test-task-session-kind-2",
          resource_id: "local",
          thread_id: "test-task-session-kind-2",
          title: "Task Session",
          session_kind: "task",
          status: "researching",
          created_at: now,
          last_accessed: now,
          last_activity_at: now,
        },
      ]);

      const res = await app.request("/api/task-sessions?kind=task", {
        headers: { Authorization: `Basic ${testCredentials}` },
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.taskSessions).toHaveLength(1);
      expect(json.taskSessions[0].sessionKind).toBe("task");
    });

    it("should reject invalid kind filter", async () => {
      const res = await app.request("/api/task-sessions?kind=invalid", {
        headers: { Authorization: `Basic ${testCredentials}` },
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain("Invalid kind");
    });
  });

  describe("GET /api/task-sessions/latest", () => {
    it("should require workspaceId", async () => {
      const res = await app.request("/api/task-sessions/latest", {
        headers: { Authorization: `Basic ${testCredentials}` },
      });

      expect(res.status).toBe(400);
    });
  });

  describe("GET /api/task-sessions/:taskSessionId", () => {
    it("should return 404 for non-existent session", async () => {
      const res = await app.request("/api/task-sessions/non-existent-id", {
        headers: { Authorization: `Basic ${testCredentials}` },
      });

      expect(res.status).toBe(404);
    });
  });

  describe("POST /api/task-sessions", () => {
    it("should create new task session", async () => {
      await cleanupTaskSessions();

      const res = await app.request("/api/task-sessions", {
        method: "POST",
        headers: {
          Authorization: `Basic ${testCredentials}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ resourceId: "local", sessionKind: "task" }),
      });

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.taskSession.taskSessionId).toBeDefined();
      expect(json.taskSession.status).toBe("researching");

      await cleanupTaskSessions();
    });

    it("should require resourceId", async () => {
      const res = await app.request("/api/task-sessions", {
        method: "POST",
        headers: {
          Authorization: `Basic ${testCredentials}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
    });
  });

  describe("DELETE /api/task-sessions/:taskSessionId", () => {
    it("should delete task session", async () => {
      await cleanupTaskSessions();

      const db = await getDb();
      const now = new Date();
      await db.insert(taskSessions).values({
        session_id: "test-task-session-delete",
        resource_id: "local",
        thread_id: "test-task-session-delete",
        title: "To Delete",
        session_kind: "task",
        status: "researching",
        created_at: now,
        last_accessed: now,
        last_activity_at: now,
      });

      const res = await app.request("/api/task-sessions/test-task-session-delete", {
        method: "DELETE",
        headers: { Authorization: `Basic ${testCredentials}` },
      });

      expect(res.status).toBe(200);
    });
  });

  describe("PATCH /api/task-sessions/:taskSessionId", () => {
    it("should reject invalid status", async () => {
      const sessionId = "01234567-89ab-7123-8123-456789abcdef";
      const { createTaskSessionWithId } = await import("../../../db/task-sessions");
      await createTaskSessionWithId("local", sessionId);

      const res = await app.request(`/api/task-sessions/${sessionId}`, {
        method: "PATCH",
        headers: {
          Authorization: `Basic ${testCredentials}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          status: "not-a-status",
        }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain("Invalid status");
    });

    it("should reject invalid specType", async () => {
      const sessionId = "11111111-89ab-7123-8123-456789abcdef";
      const { createTaskSessionWithId } = await import("../../../db/task-sessions");
      await createTaskSessionWithId("local", sessionId);

      const res = await app.request(`/api/task-sessions/${sessionId}`, {
        method: "PATCH",
        headers: {
          Authorization: `Basic ${testCredentials}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          specType: "bad-spec",
        }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain("Invalid specType");
    });
  });
});
