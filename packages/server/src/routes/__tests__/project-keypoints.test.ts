/**
 * Tests for project keypoints API routes
 */

import { getDb, projectKeypoints, taskSessions, workspaces } from "@sakti-code/server/db";
import { eq, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { beforeEach, describe, expect, it } from "vitest";

const testApp = (await import("../../index")).app;

describe("project-keypoints routes", () => {
  const testCredentials = btoa("testuser:testpass");
  let headerSessionId: string;

  beforeEach(async () => {
    process.env.SAKTI_CODE_USERNAME = "testuser";
    process.env.SAKTI_CODE_PASSWORD = "testpass";
    const db = await getDb();
    headerSessionId = uuidv7();
    const now = new Date();
    await db.insert(taskSessions).values({
      session_id: headerSessionId,
      resource_id: "local",
      thread_id: headerSessionId,
      title: "Header Session",
      session_kind: "task",
      status: "researching",
      created_at: now,
      last_accessed: now,
      last_activity_at: now,
    });
  });

  async function cleanup() {
    const db = await getDb();
    await db
      .delete(projectKeypoints)
      .where(sql`${projectKeypoints.id} LIKE 'test-%'`)
      .execute();
    await db
      .delete(taskSessions)
      .where(sql`${taskSessions.session_id} LIKE 'test-%'`)
      .execute();
    await db.delete(workspaces).where(sql`${workspaces.id} LIKE 'test-%'`).execute();
  }

  describe("GET /api/project-keypoints", () => {
    it("should require workspaceId", async () => {
      const res = await testApp.request("/api/project-keypoints", {
        headers: {
          Authorization: `Basic ${testCredentials}`,
          "X-Task-Session-ID": headerSessionId,
        },
      });

      expect(res.status).toBe(400);
    });

    it("should list empty keypoints for new workspace", async () => {
      await cleanup();
      
      const db = await getDb();
      const now = new Date();
      const wsId = "test-ws-" + Date.now();
      await db.insert(workspaces).values({
        id: wsId,
        path: "/tmp/test-ws",
        name: "Test",
        status: "active",
        created_at: now,
        last_opened_at: now,
      });

      const res = await testApp.request(`/api/project-keypoints?workspaceId=${wsId}`, {
        headers: {
          Authorization: `Basic ${testCredentials}`,
          "X-Task-Session-ID": headerSessionId,
        },
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.keypoints).toHaveLength(0);

      await cleanup();
    });
  });

  describe("POST /api/project-keypoints", () => {
    it("should create a project keypoint", async () => {
      await cleanup();
      
      const db = await getDb();
      const now = new Date();
      const wsId = "test-ws-" + Date.now();
      const tsId = uuidv7();
      
      await db.insert(workspaces).values({
        id: wsId,
        path: "/tmp/test-ws",
        name: "Test",
        status: "active",
        created_at: now,
        last_opened_at: now,
      });
      
      await db.insert(taskSessions).values({
        session_id: tsId,
        resource_id: "local",
        thread_id: tsId,
        title: "Test Task",
        session_kind: "task",
        status: "researching",
        created_at: now,
        last_accessed: now,
        last_activity_at: now,
      });

      const res = await testApp.request("/api/project-keypoints", {
        method: "POST",
        headers: { 
          Authorization: `Basic ${testCredentials}`,
          "Content-Type": "application/json",
          "X-Task-Session-ID": headerSessionId,
        },
        body: JSON.stringify({
          workspaceId: wsId,
          taskSessionId: tsId,
          taskTitle: "Test Task",
          milestone: "started",
          summary: "Started working on the task",
          artifacts: ["file1.ts"],
        }),
      });

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.keypoint.id).toBeDefined();
      expect(json.keypoint.milestone).toBe("started");
      expect(json.keypoint.summary).toBe("Started working on the task");

      await cleanup();
    });

    it("should require workspaceId", async () => {
      const res = await testApp.request("/api/project-keypoints", {
        method: "POST",
        headers: { 
          Authorization: `Basic ${testCredentials}`,
          "Content-Type": "application/json",
          "X-Task-Session-ID": headerSessionId,
        },
        body: JSON.stringify({
          taskSessionId: "test",
          taskTitle: "Test",
          milestone: "started",
          summary: "test",
        }),
      });

      expect(res.status).toBe(400);
    });

    it("should require valid milestone", async () => {
      await cleanup();
      
      const db = await getDb();
      const now = new Date();
      const wsId = "test-ws-" + Date.now();
      const tsId = uuidv7();
      
      await db.insert(workspaces).values({
        id: wsId,
        path: "/tmp/test-ws",
        name: "Test",
        status: "active",
        created_at: now,
        last_opened_at: now,
      });
      
      await db.insert(taskSessions).values({
        session_id: tsId,
        resource_id: "local",
        thread_id: tsId,
        title: "Test Task",
        session_kind: "task",
        status: "researching",
        created_at: now,
        last_accessed: now,
        last_activity_at: now,
      });

      const res = await testApp.request("/api/project-keypoints", {
        method: "POST",
        headers: { 
          Authorization: `Basic ${testCredentials}`,
          "Content-Type": "application/json",
          "X-Task-Session-ID": headerSessionId,
        },
        body: JSON.stringify({
          workspaceId: wsId,
          taskSessionId: tsId,
          taskTitle: "Test",
          milestone: "invalid",
          summary: "test",
        }),
      });

      expect(res.status).toBe(400);

      await cleanup();
    });

    it("should keep only latest keypoint for same taskSessionId and milestone", async () => {
      await cleanup();

      const db = await getDb();
      const now = new Date();
      const wsId = "test-ws-" + Date.now();
      const tsId = uuidv7();

      await db.insert(workspaces).values({
        id: wsId,
        path: "/tmp/test-ws",
        name: "Test",
        status: "active",
        created_at: now,
        last_opened_at: now,
      });

      await db.insert(taskSessions).values({
        session_id: tsId,
        resource_id: "local",
        thread_id: tsId,
        title: "Test Task",
        session_kind: "task",
        status: "researching",
        created_at: now,
        last_accessed: now,
        last_activity_at: now,
      });

      await testApp.request("/api/project-keypoints", {
        method: "POST",
        headers: {
          Authorization: `Basic ${testCredentials}`,
          "Content-Type": "application/json",
          "X-Task-Session-ID": headerSessionId,
        },
        body: JSON.stringify({
          workspaceId: wsId,
          taskSessionId: tsId,
          taskTitle: "Test Task",
          milestone: "started",
          summary: "first summary",
          artifacts: ["a.txt"],
        }),
      });

      await testApp.request("/api/project-keypoints", {
        method: "POST",
        headers: {
          Authorization: `Basic ${testCredentials}`,
          "Content-Type": "application/json",
          "X-Task-Session-ID": headerSessionId,
        },
        body: JSON.stringify({
          workspaceId: wsId,
          taskSessionId: tsId,
          taskTitle: "Test Task",
          milestone: "started",
          summary: "latest summary",
          artifacts: ["b.txt"],
        }),
      });

      const rows = await db
        .select()
        .from(projectKeypoints)
        .where(eq(projectKeypoints.task_session_id, tsId));

      expect(rows).toHaveLength(1);
      expect(rows[0]?.summary).toBe("latest summary");
      expect(rows[0]?.artifacts).toEqual(["b.txt"]);

      await cleanup();
    });

    it("should keep one row for concurrent writes on same milestone", async () => {
      await cleanup();

      const db = await getDb();
      const now = new Date();
      const wsId = "test-ws-" + Date.now();
      const tsId = uuidv7();

      await db.insert(workspaces).values({
        id: wsId,
        path: "/tmp/test-ws",
        name: "Test",
        status: "active",
        created_at: now,
        last_opened_at: now,
      });

      await db.insert(taskSessions).values({
        session_id: tsId,
        resource_id: "local",
        thread_id: tsId,
        title: "Test Task",
        session_kind: "task",
        status: "researching",
        created_at: now,
        last_accessed: now,
        last_activity_at: now,
      });

      const post = (summary: string) =>
        testApp.request("/api/project-keypoints", {
          method: "POST",
          headers: {
            Authorization: `Basic ${testCredentials}`,
            "Content-Type": "application/json",
            "X-Task-Session-ID": headerSessionId,
          },
          body: JSON.stringify({
            workspaceId: wsId,
            taskSessionId: tsId,
            taskTitle: "Test Task",
            milestone: "started",
            summary,
            artifacts: [],
          }),
        });

      const [res1, res2] = await Promise.all([post("concurrent-1"), post("concurrent-2")]);
      expect(res1.status).toBe(201);
      expect(res2.status).toBe(201);

      const rows = await db
        .select()
        .from(projectKeypoints)
        .where(eq(projectKeypoints.task_session_id, tsId));

      expect(rows).toHaveLength(1);

      await cleanup();
    });
  });

  describe("DELETE /api/project-keypoints/:id", () => {
    it("should delete a project keypoint", async () => {
      await cleanup();
      
      const db = await getDb();
      const now = new Date();
      const wsId = "test-ws-" + Date.now();
      const tsId = uuidv7();
      const kpId = "test-kp-" + Date.now();
      
      await db.insert(workspaces).values({
        id: wsId,
        path: "/tmp/test-ws",
        name: "Test",
        status: "active",
        created_at: now,
        last_opened_at: now,
      });
      
      await db.insert(taskSessions).values({
        session_id: tsId,
        resource_id: "local",
        thread_id: tsId,
        title: "Test Task",
        session_kind: "task",
        status: "researching",
        created_at: now,
        last_accessed: now,
        last_activity_at: now,
      });

      await db.insert(projectKeypoints).values({
        id: kpId,
        workspace_id: wsId,
        task_session_id: tsId,
        task_title: "Test Task",
        milestone: "started",
        completed_at: now,
        summary: "Test",
        artifacts: [],
        created_at: now,
      });

      const res = await testApp.request(`/api/project-keypoints/${kpId}`, {
        method: "DELETE",
        headers: {
          Authorization: `Basic ${testCredentials}`,
          "X-Task-Session-ID": headerSessionId,
        },
      });

      expect(res.status).toBe(200);

      await cleanup();
    });
  });
});
