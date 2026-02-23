import { CreateTaskInput, taskStorage } from "@/memory/task/storage";
import { getDb, tasks } from "@/testing/db";
import { registerCoreBusBindings } from "@sakti-code/shared/core-server-bridge";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

describe("TaskStorage Event Emission", () => {
  const publish = vi.fn();
  const TaskUpdated = { type: "task.updated" } as const;

  beforeEach(async () => {
    vi.clearAllMocks();
    registerCoreBusBindings({
      publishTaskUpdated: async (sessionId, tasks) => {
        publish(TaskUpdated, { sessionId, tasks });
      },
    });

    const db = await getDb();
    await db.delete(tasks).where(eq(tasks.id, "task-123")).execute();
    await db.delete(tasks).where(eq(tasks.id, "task-456")).execute();
    await db.delete(tasks).where(eq(tasks.id, "task-789")).execute();
    await db
      .delete(tasks)
      .where(sql`${tasks.id} LIKE 'task-bulk-%'`)
      .execute();
    await db.delete(tasks).where(eq(tasks.id, "task-session-target")).execute();
  });

  it("should publish TaskUpdated event after creating a task", async () => {
    const input: CreateTaskInput = {
      id: "task-123",
      title: "Test task",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      sessionId: "session-456",
    };

    await taskStorage.createTask(input);

    expect(publish).toHaveBeenCalledWith(
      TaskUpdated,
      expect.objectContaining({
        sessionId: "session-456",
        tasks: expect.arrayContaining([
          expect.objectContaining({
            id: "task-123",
            title: "Test task",
            status: "open",
          }),
        ]),
      })
    );
  });

  it("should publish TaskUpdated event after updating a task", async () => {
    const input: CreateTaskInput = {
      id: "task-456",
      title: "Original title",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      sessionId: "session-789",
    };
    await taskStorage.createTask(input);

    vi.clearAllMocks();

    await taskStorage.updateTask("task-456", { title: "Updated title", status: "in_progress" });

    expect(publish).toHaveBeenCalledWith(
      TaskUpdated,
      expect.objectContaining({
        sessionId: "session-789",
        tasks: expect.arrayContaining([
          expect.objectContaining({
            id: "task-456",
            title: "Updated title",
            status: "in_progress",
          }),
        ]),
      })
    );
  });

  it("should publish TaskUpdated event after deleting a task", async () => {
    const input: CreateTaskInput = {
      id: "task-789",
      title: "To be deleted",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      sessionId: "session-abc",
    };
    await taskStorage.createTask(input);

    vi.clearAllMocks();

    await taskStorage.deleteTask("task-789");

    expect(publish).toHaveBeenCalledWith(
      TaskUpdated,
      expect.objectContaining({
        sessionId: "session-abc",
        tasks: expect.not.arrayContaining([expect.objectContaining({ id: "task-789" })]),
      })
    );
  });

  it("should publish session tasks even when many unrelated tasks exist", async () => {
    const now = Date.now();
    for (let i = 0; i < 120; i++) {
      await taskStorage.createTask({
        id: `task-bulk-${i}`,
        title: `Bulk ${i}`,
        createdAt: now + i,
        updatedAt: now + i,
      });
    }

    vi.clearAllMocks();

    await taskStorage.createTask({
      id: "task-session-target",
      title: "Session target",
      createdAt: now + 200,
      updatedAt: now + 200,
      sessionId: "session-target",
    });

    expect(publish).toHaveBeenCalledWith(
      TaskUpdated,
      expect.objectContaining({
        sessionId: "session-target",
        tasks: expect.arrayContaining([expect.objectContaining({ id: "task-session-target" })]),
      })
    );
  });
});
