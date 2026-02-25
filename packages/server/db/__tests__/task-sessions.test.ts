/**
 * Tests for task-session storage
 *
 * TDD approach: Tests written first to define expected behavior
 */

import { eq } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db, taskSessions, threads } from "../../db";
import { workspaces } from "../schema";

// Mock uuidv7 for consistent testing
vi.mock("uuid", () => ({
  v7: vi.fn(),
}));

const uuidv7Mock = vi.mocked(uuidv7) as unknown as ReturnType<typeof vi.fn>;

describe("task-sessions", () => {
  beforeAll(async () => {
    // Setup database schema
    const { setupTestDatabase } = await import("../../db/test-setup");
    await setupTestDatabase();
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    // Setup uuid mock with counter to ensure unique IDs
    let counter = 0;
    uuidv7Mock.mockImplementation(() => {
      counter++;
      return `01234567-89ab-cdef-0123-${String(counter).padStart(12, "0")}`;
    });
    // Clean up database before each test
    await db.delete(taskSessions);
    await db.delete(threads);
    await db.delete(workspaces);
  });

  afterEach(async () => {
    // Clean up after each test
    await db.delete(taskSessions);
    await db.delete(threads);
    await db.delete(workspaces);
  });

  describe("createTaskSession", () => {
    it("should create task session with UUIDv7", async () => {
      const mockSessionId = "01234567-89ab-cdef-0123-456789abcdef";
      uuidv7Mock.mockReturnValue(mockSessionId);

      const { createTaskSession } = await import("../../db/task-sessions");
      const session = await createTaskSession("local");

      expect(session.taskSessionId).toBe(mockSessionId);
      expect(session.resourceId).toBe("local");
      expect(session.threadId).toBe(mockSessionId);
      expect(session.status).toBe("researching");
      expect(session.sessionKind).toBe("task");
      expect(session.createdAt).toBeInstanceOf(Date);
      expect(session.lastAccessed).toBeInstanceOf(Date);
      expect(session.lastActivityAt).toBeInstanceOf(Date);
    });

    it("should create task session with custom resourceId", async () => {
      const mockSessionId = "01234567-89ab-cdef-0123-456789abcdef";
      uuidv7Mock.mockReturnValue(mockSessionId);

      const { createTaskSession } = await import("../../db/task-sessions");
      const session = await createTaskSession("user-123");

      expect(session.resourceId).toBe("user-123");
    });

    it("should persist task session to database", async () => {
      const mockSessionId = "01234567-89ab-cdef-0123-456789abcdef";
      uuidv7Mock.mockReturnValue(mockSessionId);

      const { createTaskSession } = await import("../../db/task-sessions");
      const created = await createTaskSession("local");

      // Verify it's in the database
      const retrieved = await db
        .select()
        .from(taskSessions)
        .where(eq(taskSessions.session_id, created.taskSessionId))
        .get();

      expect(retrieved).toBeDefined();
      expect(retrieved?.session_id).toBe(created.taskSessionId);
      expect(retrieved?.resource_id).toBe("local");
      expect(retrieved?.status).toBe("researching");
      expect(retrieved?.session_kind).toBe("task");
    });

    it("should create provisional session and thread titles", async () => {
      const mockSessionId = "01234567-89ab-cdef-0123-456789abcdef";
      uuidv7Mock.mockReturnValue(mockSessionId);

      const { createTaskSession } = await import("../../db/task-sessions");
      const created = await createTaskSession("local");

      const storedSession = await db
        .select()
        .from(taskSessions)
        .where(eq(taskSessions.session_id, created.taskSessionId))
        .get();
      const storedThread = await db
        .select()
        .from(threads)
        .where(eq(threads.id, created.threadId))
        .get();

      expect(storedSession?.title).toBe("New Chat");
      expect(storedThread?.title).toBe("New Chat");
      expect(storedThread?.metadata).toMatchObject({
        titleSource: "auto",
        provisionalTitle: true,
      });
    });

    it("should support intake session kind", async () => {
      const mockSessionId = "01234567-89ab-cdef-0123-456789abcdef";
      uuidv7Mock.mockReturnValue(mockSessionId);

      const { createTaskSession } = await import("../../db/task-sessions");
      const session = await createTaskSession("local", undefined, "intake");

      expect(session.sessionKind).toBe("intake");
      expect(session.status).toBe("researching");
    });
  });

  describe("createTaskSessionWithId", () => {
    it("should create task session with provided ID", async () => {
      const { createTaskSessionWithId } = await import("../../db/task-sessions");
      const session = await createTaskSessionWithId("local", "custom-session-id");

      expect(session.taskSessionId).toBe("custom-session-id");
      expect(session.threadId).toBe("custom-session-id");
      expect(session.sessionKind).toBe("task");
    });
  });

  describe("getTaskSession", () => {
    it("should retrieve existing task session", async () => {
      const mockSessionId = "01234567-89ab-cdef-0123-456789abcdef";
      uuidv7Mock.mockReturnValue(mockSessionId);

      const { createTaskSession, getTaskSession } = await import("../../db/task-sessions");
      await createTaskSession("local");
      const retrieved = await getTaskSession(mockSessionId);

      expect(retrieved).toBeDefined();
      expect(retrieved?.taskSessionId).toBe(mockSessionId);
      expect(retrieved?.resourceId).toBe("local");
      expect(retrieved?.status).toBe("researching");
      expect(retrieved?.sessionKind).toBe("task");
    });

    it("should return null for non-existent task session", async () => {
      const { getTaskSession } = await import("../../db/task-sessions");
      const retrieved = await getTaskSession("non-existent-id");

      expect(retrieved).toBeNull();
    });
  });

  describe("listTaskSessions", () => {
    it("should list all task sessions ordered by last activity", async () => {
      const { createTaskSession, listTaskSessions } = await import("../../db/task-sessions");

      await createTaskSession("local");
      await new Promise(r => setTimeout(r, 100));
      await createTaskSession("local");
      await new Promise(r => setTimeout(r, 100));
      await createTaskSession("local");

      const sessions = await listTaskSessions();

      expect(sessions).toHaveLength(3);
      // Most recent first (allow ties when timestamps are equal).
      for (let i = 1; i < sessions.length; i++) {
        expect(sessions[i - 1].lastActivityAt.getTime()).toBeGreaterThanOrEqual(
          sessions[i].lastActivityAt.getTime()
        );
      }
    });

    it("should filter by session kind", async () => {
      const { createTaskSession, listTaskSessions } = await import("../../db/task-sessions");

      await createTaskSession("local", undefined, "intake");
      await createTaskSession("local", undefined, "task");
      await createTaskSession("local", undefined, "intake");

      const taskSessions = await listTaskSessions({ kind: "task" });
      const intakeSessions = await listTaskSessions({ kind: "intake" });

      expect(taskSessions).toHaveLength(1);
      expect(intakeSessions).toHaveLength(2);
    });

    it("should filter by workspace ID", async () => {
      const { createTaskSession, listTaskSessions } = await import("../../db/task-sessions");
      const { createWorkspace, getWorkspaceByPath } = await import("../../db/workspaces");

      await createWorkspace({ path: "/tmp/ws1", name: "ws1" });
      await createWorkspace({ path: "/tmp/ws2", name: "ws2" });

      const ws1 = await getWorkspaceByPath("/tmp/ws1");
      const ws2 = await getWorkspaceByPath("/tmp/ws2");

      await createTaskSession("local", ws1!.id, "task");
      await createTaskSession("local", ws2!.id, "task");

      const ws1Sessions = await listTaskSessions({ workspaceId: ws1!.id });

      expect(ws1Sessions).toHaveLength(1);
      expect(ws1Sessions[0].workspaceId).toBe(ws1!.id);
    });
  });

  describe("getLatestTaskSessionByWorkspace", () => {
    it("should return most recent task session for workspace", async () => {
      const { createTaskSession, getLatestTaskSessionByWorkspace } =
        await import("../../db/task-sessions");
      const { createWorkspace, getWorkspaceByPath } = await import("../../db/workspaces");

      await createWorkspace({ path: "/tmp/test-workspace", name: "test-workspace" });
      const ws = await getWorkspaceByPath("/tmp/test-workspace");

      await createTaskSession("local", ws!.id, "task");
      await new Promise(r => setTimeout(r, 100));
      const session2 = await createTaskSession("local", ws!.id, "task");

      const latest = await getLatestTaskSessionByWorkspace(ws!.id, "task");

      expect(latest?.taskSessionId).toBe(session2.taskSessionId);
    });

    it("should filter by session kind", async () => {
      const { createTaskSession, getLatestTaskSessionByWorkspace } =
        await import("../../db/task-sessions");
      const { createWorkspace, getWorkspaceByPath } = await import("../../db/workspaces");

      await createWorkspace({ path: "/tmp/test-workspace", name: "test-workspace" });
      const ws = await getWorkspaceByPath("/tmp/test-workspace");

      await createTaskSession("local", ws!.id, "intake");
      const taskSession = await createTaskSession("local", ws!.id, "task");

      const latestTask = await getLatestTaskSessionByWorkspace(ws!.id, "task");
      const latestIntake = await getLatestTaskSessionByWorkspace(ws!.id, "intake");

      expect(latestTask?.taskSessionId).toBe(taskSession.taskSessionId);
      expect(latestIntake?.sessionKind).toBe("intake");
    });

    it("should return null for workspace with no task sessions", async () => {
      const { getLatestTaskSessionByWorkspace } = await import("../../db/task-sessions");
      const { createWorkspace, getWorkspaceByPath } = await import("../../db/workspaces");

      await createWorkspace({ path: "/tmp/test-workspace", name: "test-workspace" });
      const ws = await getWorkspaceByPath("/tmp/test-workspace");

      const latest = await getLatestTaskSessionByWorkspace(ws!.id, "task");

      expect(latest).toBeNull();
    });
  });

  describe("updateTaskSession", () => {
    it("should update task session status", async () => {
      const { createTaskSession, updateTaskSession, getTaskSession } =
        await import("../../db/task-sessions");

      const session = await createTaskSession("local");
      await updateTaskSession(session.taskSessionId, { status: "implementing" });

      const updated = await getTaskSession(session.taskSessionId);

      expect(updated?.status).toBe("implementing");
    });

    it("should update task session spec type", async () => {
      const { createTaskSession, updateTaskSession, getTaskSession } =
        await import("../../db/task-sessions");

      const session = await createTaskSession("local");
      await updateTaskSession(session.taskSessionId, { specType: "comprehensive" });

      const updated = await getTaskSession(session.taskSessionId);

      expect(updated?.specType).toBe("comprehensive");
    });

    it("should update multiple fields", async () => {
      const { createTaskSession, updateTaskSession, getTaskSession } =
        await import("../../db/task-sessions");

      const session = await createTaskSession("local");
      await updateTaskSession(session.taskSessionId, {
        status: "specifying",
        specType: "quick",
        title: "Custom Title",
      });

      const updated = await getTaskSession(session.taskSessionId);

      expect(updated?.status).toBe("specifying");
      expect(updated?.specType).toBe("quick");
      expect(updated?.title).toBe("Custom Title");
    });

    it("should update last_activity_at timestamp", async () => {
      const { createTaskSession, updateTaskSession, getTaskSession } =
        await import("../../db/task-sessions");

      const session = await createTaskSession("local");

      const fromDb = await getTaskSession(session.taskSessionId);
      const originalActivityAt = fromDb?.lastActivityAt;
      expect(originalActivityAt).toBeDefined();

      await new Promise(r => setTimeout(r, 100));
      await updateTaskSession(session.taskSessionId, { status: "implementing" });

      const updated = await getTaskSession(session.taskSessionId);

      expect(updated?.lastActivityAt.getTime()).toBeGreaterThanOrEqual(
        originalActivityAt!.getTime()
      );
    });
  });

  describe("touchTaskSession", () => {
    it("should update lastAccessed and lastActivityAt timestamps", async () => {
      const mockSessionId = "01234567-89ab-cdef-0123-456789abcdef";
      uuidv7Mock.mockReturnValue(mockSessionId);

      const { createTaskSession, touchTaskSession, getTaskSession } =
        await import("../../db/task-sessions");
      await createTaskSession("local");

      const session = await getTaskSession(mockSessionId);
      expect(session).toBeDefined();

      await new Promise(resolve => setTimeout(resolve, 100));
      await touchTaskSession(mockSessionId);
      const updated = await getTaskSession(mockSessionId);

      expect(updated?.lastAccessed.getTime() ?? 0).toBeGreaterThanOrEqual(
        session?.lastAccessed.getTime() ?? 0
      );
      expect(updated?.lastActivityAt.getTime() ?? 0).toBeGreaterThanOrEqual(
        session?.lastActivityAt.getTime() ?? 0
      );
    });

    it("should not modify other fields", async () => {
      const mockSessionId = "01234567-89ab-cdef-0123-456789abcdef";
      uuidv7Mock.mockReturnValue(mockSessionId);

      const { createTaskSession, touchTaskSession, getTaskSession } =
        await import("../../db/task-sessions");
      await createTaskSession("user-123");

      const session = await getTaskSession(mockSessionId);
      expect(session).toBeDefined();

      await touchTaskSession(mockSessionId);
      const updated = await getTaskSession(mockSessionId);

      expect(updated?.taskSessionId).toBe(session?.taskSessionId);
      expect(updated?.resourceId).toBe(session?.resourceId);
      expect(updated?.threadId).toBe(session?.threadId);
      expect(updated?.createdAt.getTime()).toBe(session?.createdAt.getTime() ?? 0);
    });
  });

  describe("updateTaskSessionTitle", () => {
    it("should update both task session title and thread title", async () => {
      const mockSessionId = "01234567-89ab-cdef-0123-456789abcdef";
      uuidv7Mock.mockReturnValue(mockSessionId);

      const { createTaskSession, updateTaskSessionTitle } = await import("../../db/task-sessions");
      await createTaskSession("local");

      const updated = await updateTaskSessionTitle(mockSessionId, "Implement auth flow", {
        source: "auto",
        onlyIfProvisional: true,
      });
      expect(updated).toBe(true);

      const storedSession = await db
        .select()
        .from(taskSessions)
        .where(eq(taskSessions.session_id, mockSessionId))
        .get();
      const storedThread = await db
        .select()
        .from(threads)
        .where(eq(threads.id, mockSessionId))
        .get();

      expect(storedSession?.title).toBe("Implement auth flow");
      expect(storedThread?.title).toBe("Implement auth flow");
      expect(storedThread?.metadata).toMatchObject({
        titleSource: "auto",
        provisionalTitle: false,
      });
    });

    it("should not auto-overwrite manual titles when onlyIfProvisional is true", async () => {
      const mockSessionId = "01234567-89ab-cdef-0123-456789abcdef";
      uuidv7Mock.mockReturnValue(mockSessionId);

      const { createTaskSession, updateTaskSessionTitle } = await import("../../db/task-sessions");
      await createTaskSession("local");
      await updateTaskSessionTitle(mockSessionId, "My Manual Title", { source: "manual" });

      const updated = await updateTaskSessionTitle(mockSessionId, "LLM Suggested Title", {
        source: "auto",
        onlyIfProvisional: true,
      });
      expect(updated).toBe(false);

      const storedSession = await db
        .select()
        .from(taskSessions)
        .where(eq(taskSessions.session_id, mockSessionId))
        .get();
      const storedThread = await db
        .select()
        .from(threads)
        .where(eq(threads.id, mockSessionId))
        .get();

      expect(storedSession?.title).toBe("My Manual Title");
      expect(storedThread?.title).toBe("My Manual Title");
      expect(storedThread?.metadata).toMatchObject({
        titleSource: "manual",
        provisionalTitle: false,
      });
    });
  });

  describe("deleteTaskSession", () => {
    it("should delete task session from database", async () => {
      const mockSessionId = "01234567-89ab-cdef-0123-456789abcdef";
      uuidv7Mock.mockReturnValue(mockSessionId);

      const { createTaskSession, deleteTaskSession, getTaskSession } =
        await import("../../db/task-sessions");
      const session = await createTaskSession("local");

      await deleteTaskSession(session.taskSessionId);
      const retrieved = await getTaskSession(session.taskSessionId);

      expect(retrieved).toBeNull();
    });

    it("should handle deleting non-existent task session gracefully", async () => {
      const { deleteTaskSession } = await import("../../db/task-sessions");

      await expect(deleteTaskSession("non-existent")).resolves.not.toThrow();
    });
  });

  describe("updateTaskSessionStatus", () => {
    it("should update status and last_activity_at", async () => {
      const { createTaskSession, updateTaskSessionStatus, getTaskSession } =
        await import("../../db/task-sessions");

      const session = await createTaskSession("local");

      const fromDb = await getTaskSession(session.taskSessionId);
      const originalActivityAt = fromDb?.lastActivityAt;
      expect(originalActivityAt).toBeDefined();

      await new Promise(r => setTimeout(r, 100));
      await updateTaskSessionStatus(session.taskSessionId, "implementing");

      const updated = await getTaskSession(session.taskSessionId);

      expect(updated?.status).toBe("implementing");
      expect(updated?.lastActivityAt.getTime()).toBeGreaterThanOrEqual(
        originalActivityAt!.getTime()
      );
    });
  });
});
