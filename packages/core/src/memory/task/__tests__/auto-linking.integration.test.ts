/**
 * Tests for auto task-linking feature
 *
 * Verifies that claiming a task automatically links subsequent messages to that task.
 */

import { eq, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

describe("auto task-linking", () => {
  beforeEach(async () => {
    const { getDb } = await import("@/testing/db");
    const db = await getDb();

    await db.run(sql`DELETE FROM task_messages`);
    await db.run(sql`DELETE FROM task_dependencies`);
    await db.run(sql`DELETE FROM messages`);
    await db.run(sql`DELETE FROM tasks`);
    await db.run(sql`DELETE FROM threads`);
  });

  afterAll(async () => {
    const { closeDb } = await import("@/testing/db");
    closeDb();
  });

  describe("claim action", () => {
    it("stores activeTaskId in thread metadata when claiming a task", async () => {
      const { getDb, threads } = await import("@/testing/db");
      const { executeTaskMutate } = await import("@/memory/task/task-mutate");
      const { taskStorage } = await import("@/memory/task/storage");
      const db = await getDb();

      // Setup: Create a thread and a task
      const threadId = uuidv7();
      const resourceId = "test-resource";
      const taskId = uuidv7();
      const now = Date.now();

      await db.insert(threads).values({
        id: threadId,
        resource_id: resourceId,
        title: "Test Thread",
        metadata: {},
        created_at: new Date(now),
        updated_at: new Date(now),
      });

      await taskStorage.createTask({
        id: taskId,
        title: "Test Task",
        createdAt: now,
        updatedAt: now,
      });

      // Execute: Claim the task with threadId
      const result = await executeTaskMutate({
        action: "claim",
        id: taskId,
        threadId,
      });

      // Verify: Task was claimed successfully
      expect(result).toMatchObject({
        success: true,
      });

      // Verify: Thread metadata contains activeTaskId
      const thread = await db.select().from(threads).where(eq(threads.id, threadId)).get();
      expect(thread).toBeDefined();
      expect(thread?.metadata).toMatchObject({
        activeTaskId: taskId,
      });
    });

    it("updates task session_id when claiming", async () => {
      const { getDb, threads } = await import("@/testing/db");
      const { executeTaskMutate } = await import("@/memory/task/task-mutate");
      const { taskStorage } = await import("@/memory/task/storage");
      const db = await getDb();

      const threadId = uuidv7();
      const resourceId = "test-resource";
      const taskId = uuidv7();
      const sessionId = uuidv7();
      const now = Date.now();

      await db.insert(threads).values({
        id: threadId,
        resource_id: resourceId,
        title: "Test Thread",
        metadata: {},
        created_at: new Date(now),
        updated_at: new Date(now),
      });

      await taskStorage.createTask({
        id: taskId,
        title: "Test Task",
        createdAt: now,
        updatedAt: now,
      });

      // Execute: Claim with sessionId
      await executeTaskMutate({
        action: "claim",
        id: taskId,
        threadId,
        sessionId,
      });

      // Verify: Task has session_id set
      const task = await taskStorage.getTask(taskId);
      expect(task?.session_id).toBe(sessionId);
    });
  });

  describe("message creation", () => {
    it("auto-injects taskId when creating message in thread with active task", async () => {
      const { getDb, threads } = await import("@/testing/db");
      const { executeTaskMutate } = await import("@/memory/task/task-mutate");
      const { taskStorage } = await import("@/memory/task/storage");
      const { messageStorage } = await import("@/memory/message/storage");
      const db = await getDb();

      const threadId = uuidv7();
      const resourceId = "test-resource";
      const taskId = uuidv7();
      const sessionId = uuidv7();
      const now = Date.now();

      // Setup: Create thread and task
      await db.insert(threads).values({
        id: threadId,
        resource_id: resourceId,
        title: "Test Thread",
        metadata: {},
        created_at: new Date(now),
        updated_at: new Date(now),
      });

      await taskStorage.createTask({
        id: taskId,
        title: "Test Task",
        createdAt: now,
        updatedAt: now,
      });

      // Setup: Claim the task
      await executeTaskMutate({
        action: "claim",
        id: taskId,
        threadId,
        sessionId,
      });

      // Execute: Create a message (without explicit taskId)
      const message = await messageStorage.createMessage({
        id: uuidv7(),
        threadId,
        resourceId,
        role: "assistant",
        rawContent: "Working on the task...",
        createdAt: now,
        messageIndex: 0,
      });

      // Verify: Message was auto-linked to the task
      expect(message.task_id).toBe(taskId);
    });

    it("does not auto-link message when no active task in thread", async () => {
      const { getDb, threads } = await import("@/testing/db");
      const { messageStorage } = await import("@/memory/message/storage");
      const db = await getDb();

      const threadId = uuidv7();
      const resourceId = "test-resource";
      const now = Date.now();

      // Setup: Create thread WITHOUT claiming any task
      await db.insert(threads).values({
        id: threadId,
        resource_id: resourceId,
        title: "Test Thread",
        metadata: {},
        created_at: new Date(now),
        updated_at: new Date(now),
      });

      // Execute: Create a message
      const message = await messageStorage.createMessage({
        id: uuidv7(),
        threadId,
        resourceId,
        role: "assistant",
        rawContent: "General message...",
        createdAt: now,
        messageIndex: 0,
      });

      // Verify: Message has no task_id
      expect(message.task_id).toBeNull();
    });

    it("does not auto-link when session_id mismatch", async () => {
      const { getDb, threads } = await import("@/testing/db");
      const { executeTaskMutate } = await import("@/memory/task/task-mutate");
      const { taskStorage } = await import("@/memory/task/storage");
      const { messageStorage } = await import("@/memory/message/storage");
      const db = await getDb();

      const threadId = uuidv7();
      const resourceId = "test-resource";
      const taskId = uuidv7();
      const claimingSessionId = uuidv7();
      const differentSessionId = uuidv7();
      const now = Date.now();

      // Setup: Create thread and task
      await db.insert(threads).values({
        id: threadId,
        resource_id: resourceId,
        title: "Test Thread",
        metadata: {},
        created_at: new Date(now),
        updated_at: new Date(now),
      });

      await taskStorage.createTask({
        id: taskId,
        title: "Test Task",
        createdAt: now,
        updatedAt: now,
      });

      // Setup: Claim the task with one session
      await executeTaskMutate({
        action: "claim",
        id: taskId,
        threadId,
        sessionId: claimingSessionId,
      });

      // Execute: Create message with different session
      const message = await messageStorage.createMessage({
        id: uuidv7(),
        threadId,
        resourceId,
        role: "assistant",
        rawContent: "Message from different session...",
        createdAt: now,
        messageIndex: 0,
        sessionId: differentSessionId, // Different session!
      });

      // Verify: Message is NOT auto-linked (session mismatch)
      expect(message.task_id).toBeNull();
    });
  });

  describe("close action", () => {
    it("clears activeTaskId from thread metadata when closing task", async () => {
      const { getDb, threads } = await import("@/testing/db");
      const { executeTaskMutate } = await import("@/memory/task/task-mutate");
      const { taskStorage } = await import("@/memory/task/storage");
      const db = await getDb();

      const threadId = uuidv7();
      const resourceId = "test-resource";
      const taskId = uuidv7();
      const now = Date.now();

      // Setup: Create thread and task
      await db.insert(threads).values({
        id: threadId,
        resource_id: resourceId,
        title: "Test Thread",
        metadata: {},
        created_at: new Date(now),
        updated_at: new Date(now),
      });

      await taskStorage.createTask({
        id: taskId,
        title: "Test Task",
        createdAt: now,
        updatedAt: now,
      });

      // Setup: Claim the task
      await executeTaskMutate({
        action: "claim",
        id: taskId,
        threadId,
      });

      // Verify: Task is active
      let thread = await db.select().from(threads).where(eq(threads.id, threadId)).get();
      expect(thread?.metadata?.activeTaskId).toBe(taskId);

      // Execute: Close the task
      await executeTaskMutate({
        action: "close",
        id: taskId,
        reason: "completed",
        summary: "Task completed successfully",
      });

      // Verify: Thread metadata no longer has activeTaskId
      thread = await db.select().from(threads).where(eq(threads.id, threadId)).get();
      expect(thread?.metadata?.activeTaskId).toBeUndefined();
    });

    it("does not clear activeTaskId when closing different task", async () => {
      const { getDb, threads } = await import("@/testing/db");
      const { executeTaskMutate } = await import("@/memory/task/task-mutate");
      const { taskStorage } = await import("@/memory/task/storage");
      const db = await getDb();

      const threadId = uuidv7();
      const resourceId = "test-resource";
      const activeTaskId = uuidv7();
      const otherTaskId = uuidv7();
      const now = Date.now();

      // Setup: Create thread and both tasks
      await db.insert(threads).values({
        id: threadId,
        resource_id: resourceId,
        title: "Test Thread",
        metadata: {},
        created_at: new Date(now),
        updated_at: new Date(now),
      });

      await taskStorage.createTask({
        id: activeTaskId,
        title: "Active Task",
        createdAt: now,
        updatedAt: now,
      });

      await taskStorage.createTask({
        id: otherTaskId,
        title: "Other Task",
        createdAt: now,
        updatedAt: now,
      });

      // Setup: Claim the active task
      await executeTaskMutate({
        action: "claim",
        id: activeTaskId,
        threadId,
      });

      // Execute: Close the OTHER task
      await executeTaskMutate({
        action: "close",
        id: otherTaskId,
        reason: "completed",
        summary: "Other task completed",
      });

      // Verify: Thread still has activeTaskId pointing to first task
      const thread = await db.select().from(threads).where(eq(threads.id, threadId)).get();
      expect(thread?.metadata?.activeTaskId).toBe(activeTaskId);
    });
  });

  describe("edge cases", () => {
    it("switching tasks updates activeTaskId to new task", async () => {
      const { getDb, threads } = await import("@/testing/db");
      const { executeTaskMutate } = await import("@/memory/task/task-mutate");
      const { taskStorage } = await import("@/memory/task/storage");
      const db = await getDb();

      const threadId = uuidv7();
      const resourceId = "test-resource";
      const firstTaskId = uuidv7();
      const secondTaskId = uuidv7();
      const now = Date.now();

      // Setup: Create thread and both tasks
      await db.insert(threads).values({
        id: threadId,
        resource_id: resourceId,
        title: "Test Thread",
        metadata: {},
        created_at: new Date(now),
        updated_at: new Date(now),
      });

      await taskStorage.createTask({
        id: firstTaskId,
        title: "First Task",
        createdAt: now,
        updatedAt: now,
      });

      await taskStorage.createTask({
        id: secondTaskId,
        title: "Second Task",
        createdAt: now,
        updatedAt: now,
      });

      // Setup: Claim first task
      await executeTaskMutate({
        action: "claim",
        id: firstTaskId,
        threadId,
      });

      let thread = await db.select().from(threads).where(eq(threads.id, threadId)).get();
      expect(thread?.metadata?.activeTaskId).toBe(firstTaskId);

      // Execute: Claim second task (should update activeTaskId)
      await executeTaskMutate({
        action: "claim",
        id: secondTaskId,
        threadId,
      });

      // Verify: Thread now points to second task
      thread = await db.select().from(threads).where(eq(threads.id, threadId)).get();
      expect(thread?.metadata?.activeTaskId).toBe(secondTaskId);
    });

    it("claim fails if task is blocked by dependencies", async () => {
      const { getDb, threads } = await import("@/testing/db");
      const { executeTaskMutate } = await import("@/memory/task/task-mutate");
      const { taskStorage } = await import("@/memory/task/storage");
      const db = await getDb();

      const threadId = uuidv7();
      const resourceId = "test-resource";
      const blockingTaskId = uuidv7();
      const blockedTaskId = uuidv7();
      const now = Date.now();

      // Setup: Create thread and tasks
      await db.insert(threads).values({
        id: threadId,
        resource_id: resourceId,
        title: "Test Thread",
        metadata: {},
        created_at: new Date(now),
        updated_at: new Date(now),
      });

      await taskStorage.createTask({
        id: blockingTaskId,
        title: "Blocking Task",
        status: "open",
        createdAt: now,
        updatedAt: now,
      });

      await taskStorage.createTask({
        id: blockedTaskId,
        title: "Blocked Task",
        createdAt: now,
        updatedAt: now,
      });

      // Setup: Create dependency (blockedTask depends on blockingTask)
      await taskStorage.addDependency({
        taskId: blockedTaskId,
        dependsOnId: blockingTaskId,
        type: "blocks",
        createdAt: now,
      });

      // Execute: Try to claim blocked task
      const result = await executeTaskMutate({
        action: "claim",
        id: blockedTaskId,
        threadId,
      });

      // Verify: Claim fails
      expect(result).toMatchObject({
        success: false,
        error: expect.stringContaining("blocked"),
      });

      // Verify: Thread metadata is NOT updated
      const thread = await db.select().from(threads).where(eq(threads.id, threadId)).get();
      expect(thread?.metadata?.activeTaskId).toBeUndefined();
    });
  });
});
