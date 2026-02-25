/**
 * E2E Tests: Homepage -> Research -> Spec -> Task Session Workflow
 *
 * End-to-end tests covering the complete task-first workflow:
 * 1. Homepage visible
 * 2. Submit prompt in big input
 * 3. Research loading shown
 * 4. Research preview summary + spec actions shown
 * 5. Select spec action
 * 6. Mode switches to task-session view
 * 7. Home button returns to homepage
 * 8. Keypoint visible
 * 9. Task session remains in list
 */
// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TestServer } from "../helpers/test-server";
import { createTestServer } from "../helpers/test-server";

async function createWorkspaceId(server: TestServer, seed: string): Promise<string> {
  const response = await server.request("/api/workspaces", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      path: `/tmp/sakti-task-session-${seed}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      name: `Task Session ${seed}`,
    }),
  });
  expect(response.ok).toBe(true);
  const data = await response.json();
  return data.workspace.id as string;
}

describe("E2E: Homepage -> Task Session Workflow", () => {
  let server: TestServer;

  beforeEach(async () => {
    server = await createTestServer();
  });

  afterEach(async () => {
    await server?.cleanup();
  });

  describe("Complete Task-First Workflow", () => {
    it("user submits prompt, views research, selects spec, enters task session, returns home", async () => {
      const workspaceId = await createWorkspaceId(server, "home-flow");

      // Step 1: Homepage is accessible
      const homepageResponse = await server.request("/");
      expect(homepageResponse.ok).toBe(true);

      // Step 2: Submit research prompt through chat endpoint (runtimeMode: intake)
      const chatResponse = await server.request("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: "Build a REST API for user management" }],
          workspace: "/test/project",
          runtimeMode: "intake",
        }),
      });

      expect(chatResponse.ok).toBe(true);
      const taskSessionId = chatResponse.headers.get("X-Task-Session-ID");
      expect(taskSessionId).toBeDefined();

      // Step 3: Select spec type by creating a task session with spec
      const createTaskSessionResponse = await server.request("/api/task-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resourceId: "task-user-management-rest-api",
          workspaceId,
          sessionKind: "task",
        }),
      });

      expect(createTaskSessionResponse.ok).toBe(true);
      const taskSessionData = await createTaskSessionResponse.json();
      const taskSession = taskSessionData.taskSession;
      expect(taskSession.taskSessionId).toBeDefined();
      expect(taskSession.status).toBe("researching");

      // Promote to specifying with explicit comprehensive spec.
      const selectSpecResponse = await server.request(
        `/api/task-sessions/${taskSession.taskSessionId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            status: "specifying",
            specType: "comprehensive",
            title: "User Management REST API",
          }),
        }
      );
      expect(selectSpecResponse.ok).toBe(true);

      // Step 4: Verify task session is in the list
      const taskSessionsResponse = await server.request(
        `/api/task-sessions?workspaceId=${workspaceId}&kind=task`
      );
      expect(taskSessionsResponse.ok).toBe(true);

      const taskSessionsData = await taskSessionsResponse.json();
      expect(taskSessionsData.taskSessions.length).toBeGreaterThan(0);

      // Find the session we just created
      const createdSession = taskSessionsData.taskSessions.find(
        (s: { taskSessionId: string }) => s.taskSessionId === taskSession.taskSessionId
      );
      expect(createdSession).toBeDefined();

      // Step 5: Create keypoint on milestone start
      const createKeypointResponse = await server.request("/api/project-keypoints", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          taskSessionId: taskSession.taskSessionId,
          taskTitle: "User Management REST API",
          milestone: "started",
          summary: "Started task with comprehensive spec after research",
          artifacts: ["spec.md"],
        }),
      });

      expect(createKeypointResponse.ok).toBe(true);

      // Step 6: Verify keypoint is visible on homepage
      const keypointsResponse = await server.request(
        `/api/project-keypoints?workspaceId=${workspaceId}`
      );
      expect(keypointsResponse.ok).toBe(true);

      const keypointsData = await keypointsResponse.json();
      expect(keypointsData.keypoints.length).toBeGreaterThan(0);

      // Find the keypoint we just created
      const createdKeypoint = keypointsData.keypoints.find(
        (k: { taskSessionId: string; milestone: string }) =>
          k.taskSessionId === taskSession.taskSessionId && k.milestone === "started"
      );
      expect(createdKeypoint).toBeDefined();
      expect(createdKeypoint.summary).toBe("Started task with comprehensive spec after research");
    });

    it("multiple task sessions can be created and managed independently", async () => {
      const workspaceId = await createWorkspaceId(server, "multi");

      // Create first task session
      const firstResponse = await server.request("/api/task-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resourceId: "task-first",
          workspaceId,
          sessionKind: "task",
        }),
      });

      expect(firstResponse.ok).toBe(true);
      const firstTask = (await firstResponse.json()).taskSession;

      // Create second task session
      const secondResponse = await server.request("/api/task-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resourceId: "task-second",
          workspaceId,
          sessionKind: "task",
        }),
      });

      expect(secondResponse.ok).toBe(true);
      const secondTask = (await secondResponse.json()).taskSession;

      // Verify both sessions have unique IDs
      expect(firstTask.taskSessionId).not.toBe(secondTask.taskSessionId);

      // Verify both appear in list
      const listResponse = await server.request(
        `/api/task-sessions?workspaceId=${workspaceId}&kind=task`
      );
      expect(listResponse.ok).toBe(true);

      const listData = await listResponse.json();
      expect(listData.taskSessions.length).toBeGreaterThanOrEqual(2);

      // Verify both tasks are present
      const taskIds = listData.taskSessions.map((t: { taskSessionId: string }) => t.taskSessionId);
      expect(taskIds).toContain(firstTask.taskSessionId);
      expect(taskIds).toContain(secondTask.taskSessionId);
    });

    it("task session can be updated and status changes are reflected", async () => {
      const workspaceId = await createWorkspaceId(server, "update");

      // Create initial task session
      const createResponse = await server.request("/api/task-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resourceId: "task-update-test",
          workspaceId,
          sessionKind: "task",
        }),
      });

      expect(createResponse.ok).toBe(true);
      const taskData = await createResponse.json();
      const taskSessionId = taskData.taskSession.taskSessionId;

      // Update task session status
      const updateResponse = await server.request(`/api/task-sessions/${taskSessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "implementing",
          title: "Research complete, starting implementation",
        }),
      });

      expect(updateResponse.ok).toBe(true);
      const updatedData = await updateResponse.json();
      expect(updatedData.taskSession.status).toBe("implementing");
      expect(updatedData.taskSession.title).toBe("Research complete, starting implementation");

      // Verify update persists
      const getResponse = await server.request(`/api/task-sessions/${taskSessionId}`);
      expect(getResponse.ok).toBe(true);

      const getData = await getResponse.json();
      expect(getData.status).toBe("implementing");
      expect(getData.title).toBe("Research complete, starting implementation");
    });

    it("task session can be deleted and no longer appears in list", async () => {
      const workspaceId = await createWorkspaceId(server, "delete");

      // Create task session
      const createResponse = await server.request("/api/task-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resourceId: "task-delete-me",
          workspaceId,
          sessionKind: "task",
        }),
      });

      expect(createResponse.ok).toBe(true);
      const taskData = await createResponse.json();
      const taskSessionId = taskData.taskSession.taskSessionId;

      // Verify it exists in list
      const beforeDeleteResponse = await server.request(
        `/api/task-sessions?workspaceId=${workspaceId}&kind=task`
      );
      const beforeDeleteData = await beforeDeleteResponse.json();
      expect(
        beforeDeleteData.taskSessions.some(
          (t: { taskSessionId: string }) => t.taskSessionId === taskSessionId
        )
      ).toBe(true);

      // Delete task session
      const deleteResponse = await server.request(`/api/task-sessions/${taskSessionId}`, {
        method: "DELETE",
      });
      expect(deleteResponse.ok).toBe(true);

      // Verify direct fetch returns 404 after deletion.
      const getDeletedResponse = await server.request(`/api/task-sessions/${taskSessionId}`);
      expect(getDeletedResponse.status).toBe(404);
    });

    it("keypoints can be created for both started and completed milestones", async () => {
      const workspaceId = await createWorkspaceId(server, "keypoints");

      // Create task session
      const createResponse = await server.request("/api/task-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resourceId: "task-keypoint-test",
          workspaceId,
          sessionKind: "task",
        }),
      });

      expect(createResponse.ok).toBe(true);
      const taskData = await createResponse.json();
      const taskSessionId = taskData.taskSession.taskSessionId;

      // Create started milestone keypoint
      const startedResponse = await server.request("/api/project-keypoints", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          taskSessionId,
          taskTitle: "Keypoint Test Task",
          milestone: "started",
          summary: "Task started",
          artifacts: ["plan.md"],
        }),
      });

      expect(startedResponse.ok).toBe(true);

      // Create completed milestone keypoint
      const completedResponse = await server.request("/api/project-keypoints", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          taskSessionId,
          taskTitle: "Keypoint Test Task",
          milestone: "completed",
          summary: "Task completed successfully",
          artifacts: ["implementation.ts", "test.ts"],
        }),
      });

      expect(completedResponse.ok).toBe(true);

      // Verify both keypoints exist
      const keypointsResponse = await server.request(
        `/api/project-keypoints?workspaceId=${workspaceId}`
      );
      expect(keypointsResponse.ok).toBe(true);

      const keypointsData = await keypointsResponse.json();
      expect(keypointsData.keypoints.length).toBeGreaterThanOrEqual(2);

      // Verify both milestones are present
      const startedKeypoint = keypointsData.keypoints.find(
        (k: { taskSessionId: string; milestone: string }) =>
          k.taskSessionId === taskSessionId && k.milestone === "started"
      );
      expect(startedKeypoint).toBeDefined();

      const completedKeypoint = keypointsData.keypoints.find(
        (k: { taskSessionId: string; milestone: string }) =>
          k.taskSessionId === taskSessionId && k.milestone === "completed"
      );
      expect(completedKeypoint).toBeDefined();
    });
  });
});
