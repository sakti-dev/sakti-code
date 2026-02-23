/**
 * Build agent memory tools integration tests.
 *
 * Verifies build toolset resolves memory tools and can execute them.
 */

import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { AGENT_REGISTRY, resolveTools } from "../../src/agent/registry";

const testHomeDir = `/tmp/sakti-code-test-build-memory-${Date.now()}`;
const previousSaktiCodeHome = process.env.SAKTI_CODE_HOME;

describe("build memory tools integration", () => {
  beforeEach(async () => {
    process.env.SAKTI_CODE_HOME = testHomeDir;
    const { closeDb, getDb } = await import("@sakti-code/core/testing/db");
    closeDb();
    const db = await getDb();

    await db.run(sql`DELETE FROM task_messages`);
    await db.run(sql`DELETE FROM task_dependencies`);
    await db.run(sql`DELETE FROM tasks`);
    await db.run(sql`DELETE FROM messages`);
    await db.run(sql`DELETE FROM threads`);
    await db.run(sql`DELETE FROM working_memory`);
  });

  afterAll(async () => {
    if (previousSaktiCodeHome === undefined) {
      delete process.env.SAKTI_CODE_HOME;
    } else {
      process.env.SAKTI_CODE_HOME = previousSaktiCodeHome;
    }
    const { closeDb } = await import("@sakti-code/core/testing/db");
    closeDb();
  });

  it("resolves and executes task-query, task-mutate, and memory-search from build toolset", async () => {
    const { getDb, threads } = await import("@sakti-code/core/testing/db");
    const db = await getDb();
    const tools = resolveTools(AGENT_REGISTRY.build.tools) as Record<
      string,
      { execute?: (input: unknown) => Promise<unknown> }
    >;

    expect(tools["task-query"]?.execute).toBeTypeOf("function");
    expect(tools["task-mutate"]?.execute).toBeTypeOf("function");
    expect(tools["memory-search"]?.execute).toBeTypeOf("function");

    const threadId = "build-memory-tools-thread";
    const resourceId = "build-memory-tools-resource";
    const now = Date.now();
    await db.insert(threads).values({
      id: threadId,
      resource_id: resourceId,
      title: "Build Memory Tools Thread",
      created_at: new Date(now),
      updated_at: new Date(now),
    });

    const mutateCreate = (await tools["task-mutate"]!.execute!({
      action: "create",
      title: "Implement memory-driven title updates",
    })) as { success: boolean };
    expect(mutateCreate.success).toBe(true);

    await db.run(sql`
      INSERT INTO messages (id, thread_id, resource_id, role, raw_content, search_text, injection_text, created_at, message_index)
      VALUES ('memory-search-msg', ${threadId}, ${resourceId}, 'assistant', 'raw', 'build memory sentinel token', 'injection', ${now}, 0)
    `);

    const queryList = (await tools["task-query"]!.execute!({
      action: "list",
      status: "open",
      limit: 5,
    })) as { success: boolean; tasks?: unknown[] };
    expect(queryList.success).toBe(true);
    expect(Array.isArray(queryList.tasks)).toBe(true);
    expect((queryList.tasks ?? []).length).toBeGreaterThan(0);

    const memorySearch = (await tools["memory-search"]!.execute!({
      query: "sentinel",
      threadId,
      limit: 5,
    })) as { success: boolean; results?: unknown[] };
    expect(memorySearch.success).toBe(true);
    expect((memorySearch.results ?? []).length).toBeGreaterThan(0);
  });
});
