/**
 * Tests for TaskStorage CRUD operations
 *
 * Phase 1 Memory System - Task storage tests.
 * Tests verify:
 * - createTask: Create new tasks
 * - getTask: Retrieve tasks by ID
 * - updateTask: Update task properties
 * - deleteTask: Delete tasks
 * - addDependency: Add blocking relationships
 * - removeDependency: Remove blocking relationships
 * - getDependencies: Get task dependencies
 * - computeBlockedStatus: Compute if task is blocked
 */

import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

describe("TaskStorage", () => {
  let taskStorage: import("@/memory/task/storage").TaskStorage;

  beforeEach(async () => {
    const { TaskStorage } = await import("@/memory/task/storage");
    taskStorage = new TaskStorage();

    // Clean up tasks from previous test runs
    const { getDb } = await import("@/testing/db");
    const { sql } = await import("drizzle-orm");
    const db = await getDb();

    // Delete all dependencies first (foreign key constraint)
    await db.run(sql`DELETE FROM task_dependencies`);
    // Delete all tasks
    await db.run(sql`DELETE FROM tasks`);
  });

  afterAll(async () => {
    const { closeDb } = await import("@/testing/db");
    closeDb();
  });

  describe("createTask", () => {
    it("should create a task with required fields", async () => {
      const taskId = uuidv7();
      const now = Date.now();

      const task = await taskStorage.createTask({
        id: taskId,
        title: "Implement login feature",
        createdAt: now,
        updatedAt: now,
      });

      expect(task).toBeDefined();
      expect(task.id).toBe(taskId);
      expect(task.title).toBe("Implement login feature");
      expect(task.status).toBe("open");
      expect(task.priority).toBe(2);
      expect(task.type).toBe("task");
    });

    it("should create a task with all optional fields", async () => {
      const taskId = uuidv7();
      const now = Date.now();

      const task = await taskStorage.createTask({
        id: taskId,
        title: "Fix auth bug",
        description: "Critical bug in authentication flow",
        status: "open",
        priority: 0,
        type: "bug",
        assignee: "agent-1",
        sessionId: "session-123",
        createdAt: now,
        updatedAt: now,
        metadata: { labels: ["urgent", "auth"] },
      });

      expect(task.description).toBe("Critical bug in authentication flow");
      expect(task.priority).toBe(0);
      expect(task.type).toBe("bug");
      expect(task.assignee).toBe("agent-1");
      expect(task.session_id).toBe("session-123");
      expect(task.metadata).toEqual({ labels: ["urgent", "auth"] });
    });
  });

  describe("getTask", () => {
    it("should retrieve a task by ID", async () => {
      const taskId = uuidv7();
      const now = Date.now();

      await taskStorage.createTask({
        id: taskId,
        title: "Test task",
        createdAt: now,
        updatedAt: now,
      });

      const task = await taskStorage.getTask(taskId);

      expect(task).toBeDefined();
      expect(task?.id).toBe(taskId);
      expect(task?.title).toBe("Test task");
    });

    it("should return null for non-existent task", async () => {
      const task = await taskStorage.getTask("non-existent-id");

      expect(task).toBeNull();
    });
  });

  describe("updateTask", () => {
    it("should update task status", async () => {
      const taskId = uuidv7();
      const now = Date.now();

      await taskStorage.createTask({
        id: taskId,
        title: "Test task",
        createdAt: now,
        updatedAt: now,
      });

      const updated = await taskStorage.updateTask(taskId, {
        status: "in_progress",
        sessionId: "session-456",
      });

      expect(updated?.status).toBe("in_progress");
      expect(updated?.session_id).toBe("session-456");
    });

    it("should update task when closed", async () => {
      const taskId = uuidv7();
      const now = Date.now();
      const closedAt = now + 1000;

      await taskStorage.createTask({
        id: taskId,
        title: "Test task",
        createdAt: now,
        updatedAt: now,
      });

      const updated = await taskStorage.updateTask(taskId, {
        status: "closed",
        closeReason: "completed",
        summary: "Implemented successfully",
        closedAt,
      });

      expect(updated?.status).toBe("closed");
      expect(updated?.close_reason).toBe("completed");
      expect(updated?.summary).toBe("Implemented successfully");
      // SQLite stores timestamps with second precision (not ms)
      // Just verify closed_at is set and within reasonable range (within 2 seconds)
      expect(updated?.closed_at).toBeInstanceOf(Date);
      const closedAtDiff = Math.abs((updated?.closed_at?.getTime() ?? 0) - closedAt);
      expect(closedAtDiff).toBeLessThan(2000);
    });

    it("should return null for non-existent task", async () => {
      const updated = await taskStorage.updateTask("non-existent", { status: "closed" });

      expect(updated).toBeNull();
    });
  });

  describe("deleteTask", () => {
    it("should delete a task", async () => {
      const taskId = uuidv7();
      const now = Date.now();

      await taskStorage.createTask({
        id: taskId,
        title: "Test task",
        createdAt: now,
        updatedAt: now,
      });

      await taskStorage.deleteTask(taskId);

      const task = await taskStorage.getTask(taskId);
      expect(task).toBeNull();
    });

    it("should not throw for non-existent task", async () => {
      await expect(taskStorage.deleteTask("non-existent")).resolves.not.toThrow();
    });
  });

  describe("listTasks", () => {
    it("should list all tasks", async () => {
      const now = Date.now();
      const taskId1 = uuidv7();
      const taskId2 = uuidv7();

      await taskStorage.createTask({
        id: taskId1,
        title: "Task 1",
        createdAt: now,
        updatedAt: now,
      });
      await taskStorage.createTask({
        id: taskId2,
        title: "Task 2",
        createdAt: now + 1,
        updatedAt: now + 1,
      });

      const tasks = await taskStorage.listTasks();

      expect(tasks.length).toBeGreaterThanOrEqual(2);
      expect(tasks.map(t => t.id)).toContain(taskId1);
      expect(tasks.map(t => t.id)).toContain(taskId2);
    });

    it("should list tasks by status", async () => {
      const now = Date.now();
      const openTask = uuidv7();
      const closedTask = uuidv7();

      await taskStorage.createTask({
        id: openTask,
        title: "Open Task",
        createdAt: now,
        updatedAt: now,
      });
      await taskStorage.createTask({
        id: closedTask,
        title: "Closed Task",
        status: "closed",
        closeReason: "completed",
        createdAt: now,
        updatedAt: now,
        closedAt: now,
      });

      const openTasks = await taskStorage.listTasks({ status: "open" });
      const closedTasks = await taskStorage.listTasks({ status: "closed" });

      expect(openTasks.map(t => t.id)).toContain(openTask);
      expect(openTasks.map(t => t.id)).not.toContain(closedTask);
      expect(closedTasks.map(t => t.id)).toContain(closedTask);
      expect(closedTasks.map(t => t.id)).not.toContain(openTask);
    });

    it("should limit results", async () => {
      const now = Date.now();
      const prefix = `limit-test-${Date.now()}`;

      for (let i = 0; i < 5; i++) {
        await taskStorage.createTask({
          id: uuidv7(),
          title: `${prefix}-${i}`,
          createdAt: now + i,
          updatedAt: now + i,
        });
      }

      const tasks = await taskStorage.listTasks({ limit: 3, titlePrefix: prefix });
      expect(tasks.length).toBe(3);
    });
  });

  describe("listTasksBySession", () => {
    it("returns tasks only for requested session without global clipping", async () => {
      const now = Date.now();
      const targetSession = "session-target";
      const targetTask = uuidv7();

      for (let i = 0; i < 120; i++) {
        await taskStorage.createTask({
          id: uuidv7(),
          title: `bulk-${i}`,
          createdAt: now + i,
          updatedAt: now + i,
        });
      }

      await taskStorage.createTask({
        id: targetTask,
        title: "session-task",
        sessionId: targetSession,
        createdAt: now + 500,
        updatedAt: now + 500,
      });

      const sessionTasks = await taskStorage.listTasksBySession(targetSession);
      expect(sessionTasks).toHaveLength(1);
      expect(sessionTasks[0].id).toBe(targetTask);
    });
  });

  describe("addDependency", () => {
    it("should add a blocking dependency", async () => {
      const now = Date.now();
      const task1 = uuidv7();
      const task2 = uuidv7();

      await taskStorage.createTask({ id: task1, title: "Task 1", createdAt: now, updatedAt: now });
      await taskStorage.createTask({ id: task2, title: "Task 2", createdAt: now, updatedAt: now });

      await taskStorage.addDependency({
        taskId: task2,
        dependsOnId: task1,
        type: "blocks",
        createdAt: now,
      });

      const deps = await taskStorage.getDependencies(task2);
      expect(deps.length).toBe(1);
      expect(deps[0].depends_on_id).toBe(task1);
      expect(deps[0].task_id).toBe(task2);
      expect(deps[0].type).toBe("blocks");
    });

    it("should add a parent-child dependency", async () => {
      const now = Date.now();
      const parent = uuidv7();
      const child = uuidv7();

      await taskStorage.createTask({ id: parent, title: "Parent", createdAt: now, updatedAt: now });
      await taskStorage.createTask({ id: child, title: "Child", createdAt: now, updatedAt: now });

      await taskStorage.addDependency({
        taskId: child,
        dependsOnId: parent,
        type: "parent-child",
        createdAt: now,
      });

      const deps = await taskStorage.getDependencies(child);
      expect(deps[0].type).toBe("parent-child");
    });
  });

  describe("removeDependency", () => {
    it("should remove a dependency", async () => {
      const now = Date.now();
      const task1 = uuidv7();
      const task2 = uuidv7();

      await taskStorage.createTask({ id: task1, title: "Task 1", createdAt: now, updatedAt: now });
      await taskStorage.createTask({ id: task2, title: "Task 2", createdAt: now, updatedAt: now });

      await taskStorage.addDependency({
        taskId: task2,
        dependsOnId: task1,
        type: "blocks",
        createdAt: now,
      });

      await taskStorage.removeDependency(task2, task1, "blocks");

      const deps = await taskStorage.getDependencies(task2);
      expect(deps.length).toBe(0);
    });
  });

  describe("computeBlockedStatus", () => {
    it("should return not blocked when no dependencies", async () => {
      const now = Date.now();
      const taskId = uuidv7();

      await taskStorage.createTask({ id: taskId, title: "Task", createdAt: now, updatedAt: now });

      const status = await taskStorage.computeBlockedStatus(taskId);

      expect(status.isBlocked).toBe(false);
      expect(status.blockingTasks.length).toBe(0);
    });

    it("should return blocked when dependency is not closed", async () => {
      const now = Date.now();
      const task1 = uuidv7();
      const task2 = uuidv7();

      await taskStorage.createTask({ id: task1, title: "Task 1", createdAt: now, updatedAt: now });
      await taskStorage.createTask({ id: task2, title: "Task 2", createdAt: now, updatedAt: now });

      await taskStorage.addDependency({
        taskId: task2,
        dependsOnId: task1,
        type: "blocks",
        createdAt: now,
      });

      const status = await taskStorage.computeBlockedStatus(task2);

      expect(status.isBlocked).toBe(true);
      expect(status.blockingTasks.length).toBe(1);
      expect(status.blockingTasks[0].id).toBe(task1);
    });

    it("should return not blocked when dependency is closed", async () => {
      const now = Date.now();
      const task1 = uuidv7();
      const task2 = uuidv7();

      await taskStorage.createTask({
        id: task1,
        title: "Task 1",
        status: "closed",
        closeReason: "completed",
        closedAt: now,
        createdAt: now,
        updatedAt: now,
      });
      await taskStorage.createTask({ id: task2, title: "Task 2", createdAt: now, updatedAt: now });

      await taskStorage.addDependency({
        taskId: task2,
        dependsOnId: task1,
        type: "blocks",
        createdAt: now,
      });

      const status = await taskStorage.computeBlockedStatus(task2);

      expect(status.isBlocked).toBe(false);
      expect(status.blockingTasks.length).toBe(0);
    });

    it("should not consider parent-child as blocking", async () => {
      const now = Date.now();
      const parent = uuidv7();
      const child = uuidv7();

      await taskStorage.createTask({ id: parent, title: "Parent", createdAt: now, updatedAt: now });
      await taskStorage.createTask({ id: child, title: "Child", createdAt: now, updatedAt: now });

      await taskStorage.addDependency({
        taskId: child,
        dependsOnId: parent,
        type: "parent-child",
        createdAt: now,
      });

      const status = await taskStorage.computeBlockedStatus(child);

      expect(status.isBlocked).toBe(false);
    });
  });

  describe("getReadyTasks", () => {
    it("should return open tasks that are not blocked", async () => {
      const now = Date.now();
      const readyTask = uuidv7();
      const blockedTask = uuidv7();
      const blockingTask = uuidv7();

      await taskStorage.createTask({
        id: readyTask,
        title: "Ready Task",
        createdAt: now,
        updatedAt: now,
      });
      await taskStorage.createTask({
        id: blockedTask,
        title: "Blocked Task",
        createdAt: now,
        updatedAt: now,
      });
      await taskStorage.createTask({
        id: blockingTask,
        title: "Blocking Task",
        createdAt: now,
        updatedAt: now,
      });

      await taskStorage.addDependency({
        taskId: blockedTask,
        dependsOnId: blockingTask,
        type: "blocks",
        createdAt: now,
      });

      const ready = await taskStorage.getReadyTasks();

      expect(ready.map(t => t.id)).toContain(readyTask);
      expect(ready.map(t => t.id)).not.toContain(blockedTask);
      // blockingTask IS ready because it's open and not blocked itself
      expect(ready.map(t => t.id)).toContain(blockingTask);
    });

    it("should exclude closed tasks", async () => {
      const now = Date.now();
      const openTask = uuidv7();
      const closedTask = uuidv7();

      await taskStorage.createTask({
        id: openTask,
        title: "Open Task",
        createdAt: now,
        updatedAt: now,
      });
      await taskStorage.createTask({
        id: closedTask,
        title: "Closed Task",
        status: "closed",
        closeReason: "completed",
        closedAt: now,
        createdAt: now,
        updatedAt: now,
      });

      const ready = await taskStorage.getReadyTasks();

      expect(ready.map(t => t.id)).toContain(openTask);
      expect(ready.map(t => t.id)).not.toContain(closedTask);
    });
  });
});
