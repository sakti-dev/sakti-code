/**
 * Tests for task-mutate tool executor
 *
 * Verifies task mutations and working-memory update behavior.
 */

import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

describe("task-mutate executor", () => {
  beforeEach(async () => {
    const { getDb } = await import("@/testing/db");
    const db = await getDb();

    await db.run(sql`DELETE FROM task_messages`);
    await db.run(sql`DELETE FROM task_dependencies`);
    await db.run(sql`DELETE FROM tasks`);
    await db.run(sql`DELETE FROM working_memory`);
  });

  afterAll(async () => {
    const { closeDb } = await import("@/testing/db");
    closeDb();
  });

  it("creates a task via action=create", async () => {
    const { executeTaskMutate } = await import("@/memory/task/task-mutate");

    const result = await executeTaskMutate({
      action: "create",
      title: "Implement task memory indexing",
      description: "Add indexing support for BM25 search",
    });

    expect(result).toMatchObject({
      success: true,
    });
    if ("success" in result && result.success) {
      expect(result.task?.title).toBe("Implement task memory indexing");
    }
  });

  it("persists resource-scoped working memory via update_context", async () => {
    const { executeTaskMutate } = await import("@/memory/task/task-mutate");
    const { getDb, workingMemory } = await import("@/testing/db");

    const resourceId = "resource-memory-test";
    const result = await executeTaskMutate({
      action: "update_context",
      content: "## Tech Stack\n- Runtime: Node.js\n- Tests: Vitest",
      scope: "resource",
      resourceId,
    });

    expect(result).toEqual({ success: true });

    const db = await getDb();
    const stored = await db
      .select()
      .from(workingMemory)
      .where(and(eq(workingMemory.resource_id, resourceId), eq(workingMemory.scope, "resource")))
      .get();

    expect(stored).toBeDefined();
    expect(stored?.content).toContain("Tech Stack");
    expect(stored?.content).toContain("Vitest");
  });

  it("updates existing working memory instead of creating duplicates", async () => {
    const { executeTaskMutate } = await import("@/memory/task/task-mutate");
    const { getDb, workingMemory } = await import("@/testing/db");

    const resourceId = "resource-memory-update";
    await executeTaskMutate({
      action: "update_context",
      content: "Version 1",
      scope: "resource",
      resourceId,
    });

    const result = await executeTaskMutate({
      action: "update_context",
      content: "Version 2",
      scope: "resource",
      resourceId,
    });

    expect(result).toEqual({ success: true });

    const db = await getDb();
    const records = await db
      .select()
      .from(workingMemory)
      .where(and(eq(workingMemory.resource_id, resourceId), eq(workingMemory.scope, "resource")))
      .all();

    expect(records).toHaveLength(1);
    expect(records[0]?.content).toBe("Version 2");
  });

  it("supports thread-scoped working memory via update_context", async () => {
    const { executeTaskMutate } = await import("@/memory/task/task-mutate");
    const { getDb, workingMemory } = await import("@/testing/db");

    const threadId = "thread-memory-scope";
    const result = await executeTaskMutate({
      action: "update_context",
      content: "Thread-specific context",
      scope: "thread",
      threadId,
    });

    expect(result).toEqual({ success: true });

    const db = await getDb();
    const stored = await db
      .select()
      .from(workingMemory)
      .where(and(eq(workingMemory.resource_id, threadId), eq(workingMemory.scope, "thread")))
      .get();

    expect(stored).toBeDefined();
    expect(stored?.content).toBe("Thread-specific context");
  });
});
