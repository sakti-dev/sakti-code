/**
 * Tests for Spec Helpers
 *
 * Phase 1 - Spec System Tests
 * Tests verify:
 * - getActiveSpec: Retrieve active spec for session
 * - updateSessionSpec: Set active spec for session
 * - getTaskBySpecAndId: Find task by spec slug and T-###
 * - listTasksBySpec: List all tasks for a spec
 * - getReadyTasks: Get ready tasks for a spec
 */

import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

interface SpecTaskMeta {
  taskId?: string;
}

function getSpecMeta(metadata: unknown): SpecTaskMeta | undefined {
  if (!metadata || typeof metadata !== "object") return undefined;
  const spec = (metadata as { spec?: unknown }).spec;
  if (!spec || typeof spec !== "object") return undefined;
  return spec as SpecTaskMeta;
}

describe("Spec Helpers", () => {
  let getActiveSpec: typeof import("@/spec/helpers").getActiveSpec;
  let updateSessionSpec: typeof import("@/spec/helpers").updateSessionSpec;
  let getTaskBySpecAndId: typeof import("@/spec/helpers").getTaskBySpecAndId;
  let listTasksBySpec: typeof import("@/spec/helpers").listTasksBySpec;
  let getReadyTasks: typeof import("@/spec/helpers").getReadyTasks;
  let taskStorage: import("@/memory/task/storage").TaskStorage;

  beforeEach(async () => {
    // Import helpers - these will fail until implemented
    const helpers = await import("@/spec/helpers");
    getActiveSpec = helpers.getActiveSpec;
    updateSessionSpec = helpers.updateSessionSpec;
    getTaskBySpecAndId = helpers.getTaskBySpecAndId;
    listTasksBySpec = helpers.listTasksBySpec;
    getReadyTasks = helpers.getReadyTasks;

    const { TaskStorage } = await import("@/memory/task/storage");
    taskStorage = new TaskStorage();

    // Clean up tasks and tool_sessions from previous test runs
    const { getDb, sessions } = await import("@/testing/db");
    const { sql } = await import("drizzle-orm");
    const db = await getDb();

    // Clean up in order: tool_sessions (FK to sessions), then sessions
    await db.run(sql`DELETE FROM tool_sessions WHERE tool_name = 'spec'`);
    await db.run(sql`DELETE FROM task_dependencies`);
    await db.run(sql`DELETE FROM tasks`);
    // Create a default session for tests that need it
    await db
      .insert(sessions)
      .values({
        session_id: "test-session-default",
        resource_id: "test",
        thread_id: "test-session-default",
        title: "Test Session",
        created_at: new Date(),
        last_accessed: new Date(),
      })
      .onConflictDoNothing();
  });

  afterAll(async () => {
    const { closeDb } = await import("@/testing/db");
    closeDb();
  });

  describe("getActiveSpec", () => {
    it("should return null when no spec is active for session", async () => {
      const result = await getActiveSpec("nonexistent-session");
      expect(result).toBeNull();
    });

    it("should return null when spec tool session exists but has no data", async () => {
      const sessionId = uuidv7();
      const { getDb, sessions } = await import("@/testing/db");
      const db = await getDb();
      const { toolSessions } = await import("@/testing/db");

      // Create session first (FK constraint)
      await db.insert(sessions).values({
        session_id: sessionId,
        resource_id: "test",
        thread_id: sessionId,
        title: "Test Session",
        created_at: new Date(),
        last_accessed: new Date(),
      });

      await db.insert(toolSessions).values({
        tool_session_id: uuidv7(),
        session_id: sessionId,
        tool_name: "spec",
        tool_key: "activeSpec",
        data: null,
        created_at: new Date(),
        last_accessed: new Date(),
      });

      const result = await getActiveSpec(sessionId);
      expect(result).toBeNull();
    });
  });

  describe("updateSessionSpec", () => {
    it("should set active spec for a session", async () => {
      const sessionId = uuidv7();

      // Create session first (FK constraint)
      const { getDb, sessions } = await import("@/testing/db");
      const db = await getDb();
      await db.insert(sessions).values({
        session_id: sessionId,
        resource_id: "test",
        thread_id: sessionId,
        title: "Test Session",
        created_at: new Date(),
        last_accessed: new Date(),
      });

      await updateSessionSpec(sessionId, "user-auth");

      const { toolSessions } = await import("@/testing/db");
      const { eq, and } = await import("drizzle-orm");

      const result = await db
        .select()
        .from(toolSessions)
        .where(
          and(
            eq(toolSessions.session_id, sessionId),
            eq(toolSessions.tool_name, "spec"),
            eq(toolSessions.tool_key, "activeSpec")
          )
        )
        .get();

      expect(result).toBeDefined();
      expect(result?.data).toEqual({ slug: "user-auth" });
    });

    it("should update existing spec session", async () => {
      const sessionId = uuidv7();

      // Create session first (FK constraint)
      const { getDb, sessions } = await import("@/testing/db");
      const db = await getDb();
      await db.insert(sessions).values({
        session_id: sessionId,
        resource_id: "test",
        thread_id: sessionId,
        title: "Test Session",
        created_at: new Date(),
        last_accessed: new Date(),
      });

      await updateSessionSpec(sessionId, "user-auth");
      await updateSessionSpec(sessionId, "api-v2");

      const result = await getActiveSpec(sessionId);
      expect(result).toBe("api-v2");
    });
  });

  describe("getActiveSpec + updateSessionSpec roundtrip", () => {
    it("should retrieve the spec that was set", async () => {
      const sessionId = uuidv7();

      // Create session first (FK constraint)
      const { getDb, sessions } = await import("@/testing/db");
      const db = await getDb();
      await db.insert(sessions).values({
        session_id: sessionId,
        resource_id: "test",
        thread_id: sessionId,
        title: "Test Session",
        created_at: new Date(),
        last_accessed: new Date(),
      });

      await updateSessionSpec(sessionId, "user-auth");

      const result = await getActiveSpec(sessionId);
      expect(result).toBe("user-auth");
    });
  });

  describe("getTaskBySpecAndId", () => {
    it("should return null when no tasks exist", async () => {
      const result = await getTaskBySpecAndId("user-auth", "T-001");
      expect(result).toBeNull();
    });

    it("should find task by spec slug and T-###", async () => {
      const taskId = "spec-user-auth_T-001";
      const now = Date.now();

      await taskStorage.createTask({
        id: taskId,
        title: "Implement login",
        description: "Create login flow",
        createdAt: now,
        updatedAt: now,
        metadata: { spec: { slug: "user-auth", taskId: "T-001", requirements: ["R-001"] } },
      });

      const task = await getTaskBySpecAndId("user-auth", "T-001");
      expect(task).not.toBeNull();
      expect(task?.title).toBe("Implement login");
    });

    it("should return null when spec slug doesn't match", async () => {
      const taskId = "spec-user-auth_T-001";
      const now = Date.now();

      await taskStorage.createTask({
        id: taskId,
        title: "Implement login",
        createdAt: now,
        updatedAt: now,
        metadata: { spec: { slug: "user-auth", taskId: "T-001" } },
      });

      const task = await getTaskBySpecAndId("api-v2", "T-001");
      expect(task).toBeNull();
    });

    it("should return null when task ID doesn't match", async () => {
      const taskId = "spec-user-auth_T-001";
      const now = Date.now();

      await taskStorage.createTask({
        id: taskId,
        title: "Implement login",
        createdAt: now,
        updatedAt: now,
        metadata: { spec: { slug: "user-auth", taskId: "T-001" } },
      });

      const task = await getTaskBySpecAndId("user-auth", "T-999");
      expect(task).toBeNull();
    });
  });

  describe("listTasksBySpec", () => {
    it("should return empty array when no tasks exist", async () => {
      const tasks = await listTasksBySpec("user-auth");
      expect(tasks).toEqual([]);
    });

    it("should return all tasks belonging to a spec", async () => {
      const now = Date.now();

      await taskStorage.createTask({
        id: "spec-user-auth_T-001",
        title: "Implement login",
        createdAt: now,
        updatedAt: now,
        metadata: { spec: { slug: "user-auth", taskId: "T-001" } },
      });

      await taskStorage.createTask({
        id: "spec-user-auth_T-002",
        title: "Implement logout",
        createdAt: now,
        updatedAt: now,
        metadata: { spec: { slug: "user-auth", taskId: "T-002" } },
      });

      await taskStorage.createTask({
        id: "spec-api-v2_T-001",
        title: "Create API endpoint",
        createdAt: now,
        updatedAt: now,
        metadata: { spec: { slug: "api-v2", taskId: "T-001" } },
      });

      const tasks = await listTasksBySpec("user-auth");
      expect(tasks).toHaveLength(2);
      expect(tasks.map(t => getSpecMeta(t.metadata)?.taskId).sort()).toEqual(["T-001", "T-002"]);
    });
  });

  describe("getReadyTasks", () => {
    it("should return empty array when no tasks exist", async () => {
      const ready = await getReadyTasks("user-auth");
      expect(ready).toEqual([]);
    });

    it("should return open tasks with no blocking dependencies", async () => {
      const now = Date.now();

      const task1 = await taskStorage.createTask({
        id: "spec-user-auth_T-001",
        title: "Implement login",
        status: "open",
        createdAt: now,
        updatedAt: now,
        metadata: { spec: { slug: "user-auth", taskId: "T-001" } },
      });

      await taskStorage.createTask({
        id: "spec-user-auth_T-002",
        title: "Implement logout",
        status: "open",
        createdAt: now,
        updatedAt: now,
        metadata: { spec: { slug: "user-auth", taskId: "T-002" } },
      });

      // Add dependency: T-002 depends on T-001
      await taskStorage.addDependency({
        taskId: "spec-user-auth_T-002",
        dependsOnId: task1.id,
        type: "blocks",
        createdAt: now,
      });

      const ready = await getReadyTasks("user-auth");
      expect(ready).toHaveLength(1);
      expect(getSpecMeta(ready[0].metadata)?.taskId).toBe("T-001");
    });

    it("should not return tasks blocked by open dependencies", async () => {
      const now = Date.now();

      const task1 = await taskStorage.createTask({
        id: "spec-user-auth_T-001",
        title: "Implement login",
        status: "in_progress",
        createdAt: now,
        updatedAt: now,
        metadata: { spec: { slug: "user-auth", taskId: "T-001" } },
      });

      await taskStorage.createTask({
        id: "spec-user-auth_T-002",
        title: "Implement logout",
        status: "open",
        createdAt: now,
        updatedAt: now,
        metadata: { spec: { slug: "user-auth", taskId: "T-002" } },
      });

      await taskStorage.addDependency({
        taskId: "spec-user-auth_T-002",
        dependsOnId: task1.id,
        type: "blocks",
        createdAt: now,
      });

      const ready = await getReadyTasks("user-auth");
      expect(ready).toHaveLength(0);
    });

    it("should filter by spec slug", async () => {
      const now = Date.now();

      await taskStorage.createTask({
        id: "spec-user-auth_T-001",
        title: "User auth task",
        status: "open",
        createdAt: now,
        updatedAt: now,
        metadata: { spec: { slug: "user-auth", taskId: "T-001" } },
      });

      await taskStorage.createTask({
        id: "spec-api-v2_T-001",
        title: "API task",
        status: "open",
        createdAt: now,
        updatedAt: now,
        metadata: { spec: { slug: "api-v2", taskId: "T-001" } },
      });

      const ready = await getReadyTasks("user-auth");
      expect(ready).toHaveLength(1);
      expect(ready[0].title).toBe("User auth task");
    });
  });

  describe("getCurrentTask", () => {
    it("should return null when no current task is set", async () => {
      const { getCurrentTask } = await import("@/spec/helpers");
      const result = await getCurrentTask("nonexistent-session");
      expect(result).toBeNull();
    });

    it("should return current task ID when set", async () => {
      const { updateCurrentTask, getCurrentTask } = await import("@/spec/helpers");
      const sessionId = uuidv7();

      const { getDb, sessions } = await import("@/testing/db");
      const db = await getDb();
      await db
        .insert(sessions)
        .values({
          session_id: sessionId,
          resource_id: "test",
          thread_id: sessionId,
          title: "Test Session",
          created_at: new Date(),
          last_accessed: new Date(),
        })
        .onConflictDoNothing();

      await updateCurrentTask(sessionId, "T-001");

      const result = await getCurrentTask(sessionId);
      expect(result).toBe("T-001");
    });
  });

  describe("updateCurrentTask", () => {
    it("should set current task for a session", async () => {
      const { updateCurrentTask, getCurrentTask } = await import("@/spec/helpers");
      const sessionId = uuidv7();

      const { getDb, sessions } = await import("@/testing/db");
      const db = await getDb();
      await db
        .insert(sessions)
        .values({
          session_id: sessionId,
          resource_id: "test",
          thread_id: sessionId,
          title: "Test Session",
          created_at: new Date(),
          last_accessed: new Date(),
        })
        .onConflictDoNothing();

      await updateCurrentTask(sessionId, "T-002");

      const result = await getCurrentTask(sessionId);
      expect(result).toBe("T-002");
    });

    it("should update existing current task", async () => {
      const { updateCurrentTask, getCurrentTask } = await import("@/spec/helpers");
      const sessionId = uuidv7();

      const { getDb, sessions } = await import("@/testing/db");
      const db = await getDb();
      await db
        .insert(sessions)
        .values({
          session_id: sessionId,
          resource_id: "test",
          thread_id: sessionId,
          title: "Test Session",
          created_at: new Date(),
          last_accessed: new Date(),
        })
        .onConflictDoNothing();

      await updateCurrentTask(sessionId, "T-001");
      await updateCurrentTask(sessionId, "T-003");

      const result = await getCurrentTask(sessionId);
      expect(result).toBe("T-003");
    });
  });

  describe("getSessionRuntimeMode", () => {
    it("should return null when no runtime mode is set", async () => {
      const { getSessionRuntimeMode } = await import("@/spec/helpers");
      const result = await getSessionRuntimeMode("nonexistent-session");
      expect(result).toBeNull();
    });

    it("should return null when runtime mode is not set but tool_session exists", async () => {
      const sessionId = uuidv7();
      const { getDb, sessions, toolSessions } = await import("@/testing/db");
      const db = await getDb();

      await db.insert(sessions).values({
        session_id: sessionId,
        resource_id: "test",
        thread_id: sessionId,
        title: "Test Session",
        created_at: new Date(),
        last_accessed: new Date(),
      });

      await db.insert(toolSessions).values({
        tool_session_id: uuidv7(),
        session_id: sessionId,
        tool_name: "spec",
        tool_key: "runtimeMode",
        data: null,
        created_at: new Date(),
        last_accessed: new Date(),
      });

      const { getSessionRuntimeMode } = await import("@/spec/helpers");
      const result = await getSessionRuntimeMode(sessionId);
      expect(result).toBeNull();
    });

    it("should return null for legacy/invalid stored value like 'explore'", async () => {
      const sessionId = uuidv7();
      const { getDb, sessions, toolSessions } = await import("@/testing/db");
      const db = await getDb();

      await db.insert(sessions).values({
        session_id: sessionId,
        resource_id: "test",
        thread_id: sessionId,
        title: "Test Session",
        created_at: new Date(),
        last_accessed: new Date(),
      });

      await db.insert(toolSessions).values({
        tool_session_id: uuidv7(),
        session_id: sessionId,
        tool_name: "spec",
        tool_key: "runtimeMode",
        data: { mode: "explore" },
        created_at: new Date(),
        last_accessed: new Date(),
      });

      const { getSessionRuntimeMode } = await import("@/spec/helpers");
      const result = await getSessionRuntimeMode(sessionId);
      expect(result).toBeNull();
    });
  });

  describe("updateSessionRuntimeMode", () => {
    it("should set runtime mode to 'plan'", async () => {
      const { updateSessionRuntimeMode, getSessionRuntimeMode } = await import("@/spec/helpers");
      const sessionId = uuidv7();

      const { getDb, sessions } = await import("@/testing/db");
      const db = await getDb();
      await db.insert(sessions).values({
        session_id: sessionId,
        resource_id: "test",
        thread_id: sessionId,
        title: "Test Session",
        created_at: new Date(),
        last_accessed: new Date(),
      });

      await updateSessionRuntimeMode(sessionId, "plan");

      const result = await getSessionRuntimeMode(sessionId);
      expect(result).toBe("plan");
    });

    it("should update runtime mode from 'plan' to 'build'", async () => {
      const { updateSessionRuntimeMode, getSessionRuntimeMode } = await import("@/spec/helpers");
      const sessionId = uuidv7();

      const { getDb, sessions } = await import("@/testing/db");
      const db = await getDb();
      await db.insert(sessions).values({
        session_id: sessionId,
        resource_id: "test",
        thread_id: sessionId,
        title: "Test Session",
        created_at: new Date(),
        last_accessed: new Date(),
      });

      await updateSessionRuntimeMode(sessionId, "plan");
      await updateSessionRuntimeMode(sessionId, "build");

      const result = await getSessionRuntimeMode(sessionId);
      expect(result).toBe("build");
    });

    it("should update in place (upsert behavior) - only one row per session", async () => {
      const { updateSessionRuntimeMode, getSessionRuntimeMode } = await import("@/spec/helpers");
      const sessionId = uuidv7();

      const { getDb, sessions, toolSessions } = await import("@/testing/db");
      const { eq, and } = await import("drizzle-orm");
      const db = await getDb();
      await db.insert(sessions).values({
        session_id: sessionId,
        resource_id: "test",
        thread_id: sessionId,
        title: "Test Session",
        created_at: new Date(),
        last_accessed: new Date(),
      });

      await updateSessionRuntimeMode(sessionId, "plan");
      await updateSessionRuntimeMode(sessionId, "build");

      const countResult = await db
        .select()
        .from(toolSessions)
        .where(
          and(
            eq(toolSessions.session_id, sessionId),
            eq(toolSessions.tool_name, "spec"),
            eq(toolSessions.tool_key, "runtimeMode")
          )
        )
        .all();

      expect(countResult).toHaveLength(1);
      expect(await getSessionRuntimeMode(sessionId)).toBe("build");
    });
  });
});
