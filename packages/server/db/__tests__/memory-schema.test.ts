/**
 * Tests for Phase 1 Memory System database schema
 *
 * Tests verify the schema structure for:
 * - threads: conversation threads
 * - messages: chat messages with FTS5 support
 * - tasks: task entities
 * - task_dependencies: task blocking relationships
 * - task_messages: junction table for task-message links
 * - messages_fts: FTS5 virtual table for BM25 search
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "../index";

describe("Memory System Schema", () => {
  beforeAll(async () => {
    const db = await getDb();
    await db.run(sql`PRAGMA foreign_keys = ON`);
  });

  afterAll(() => {
    closeDb();
  });

  describe("threads table", () => {
    it("should exist and have correct columns", async () => {
      const db = await getDb();
      const result = await db.all(sql`
        PRAGMA table_info(threads)
      `);

      const columns = result.map((col: any) => col.name);

      expect(columns).toContain("id");
      expect(columns).toContain("resource_id");
      expect(columns).toContain("title");
      expect(columns).toContain("metadata");
      expect(columns).toContain("created_at");
      expect(columns).toContain("updated_at");
    });

    it("should have id as primary key", async () => {
      const db = await getDb();
      const result = await db.all(sql`PRAGMA table_info(threads)`);
      const idColumn = result.find((col: any) => col.name === "id") as { pk: number } | undefined;

      expect(idColumn).toBeDefined();
      expect(idColumn?.pk).toBe(1);
    });

    it("should allow inserting a thread", async () => {
      const db = await getDb();
      const threadId = `test-thread-${Date.now()}`;

      await db.run(sql`
        INSERT INTO threads (id, resource_id, title, created_at, updated_at)
        VALUES (${threadId}, 'test-resource', 'Test Thread', ${Date.now()}, ${Date.now()})
      `);

      const result = await db.get(sql`
        SELECT * FROM threads WHERE id = ${threadId}
      `);

      expect(result).toBeDefined();
      expect((result as any)?.resource_id).toBe("test-resource");

      await db.run(sql`DELETE FROM threads WHERE id = ${threadId}`);
    });
  });

  describe("messages table", () => {
    it("should exist and have correct columns for three-storage model", async () => {
      const db = await getDb();
      const result = await db.all(sql`PRAGMA table_info(messages)`);

      const columns = result.map((col: any) => col.name);

      expect(columns).toContain("id");
      expect(columns).toContain("thread_id");
      expect(columns).toContain("resource_id");
      expect(columns).toContain("role");
      expect(columns).toContain("raw_content");
      expect(columns).toContain("search_text");
      expect(columns).toContain("injection_text");
      expect(columns).toContain("task_id");
      expect(columns).toContain("created_at");
      expect(columns).toContain("message_index");
    });

    it("should have id as primary key", async () => {
      const db = await getDb();
      const result = await db.all(sql`PRAGMA table_info(messages)`);
      const idColumn = result.find((col: any) => col.name === "id") as { pk: number } | undefined;

      expect(idColumn).toBeDefined();
      expect(idColumn?.pk).toBe(1);
    });

    it("should allow inserting a message with three-storage fields", async () => {
      const db = await getDb();
      const threadId = `test-msg-thread-${Date.now()}`;
      const messageId = `test-msg-${Date.now()}`;
      const now = Date.now();

      await db.run(sql`
        INSERT INTO threads (id, resource_id, title, created_at, updated_at)
        VALUES (${threadId}, 'test-resource', 'Test Thread', ${now}, ${now})
      `);

      await db.run(sql`
        INSERT INTO messages (id, thread_id, resource_id, role, raw_content, search_text, injection_text, created_at, message_index)
        VALUES (${messageId}, ${threadId}, 'test-resource', 'user', 'raw content', 'search content', 'injection content', ${now}, 0)
      `);

      const result = await db.get(sql`SELECT * FROM messages WHERE id = ${messageId}`);

      expect(result).toBeDefined();
      expect((result as any)?.raw_content).toBe("raw content");
      expect((result as any)?.search_text).toBe("search content");
      expect((result as any)?.injection_text).toBe("injection content");

      await db.run(sql`DELETE FROM messages WHERE id = ${messageId}`);
      await db.run(sql`DELETE FROM threads WHERE id = ${threadId}`);
    });
  });

  describe("tasks table", () => {
    it("should exist and have correct columns", async () => {
      const db = await getDb();
      const result = await db.all(sql`PRAGMA table_info(tasks)`);

      const columns = result.map((col: any) => col.name);

      expect(columns).toContain("id");
      expect(columns).toContain("title");
      expect(columns).toContain("description");
      expect(columns).toContain("status");
      expect(columns).toContain("priority");
      expect(columns).toContain("type");
      expect(columns).toContain("assignee");
      expect(columns).toContain("session_id");
      expect(columns).toContain("created_at");
      expect(columns).toContain("updated_at");
      expect(columns).toContain("closed_at");
      expect(columns).toContain("close_reason");
      expect(columns).toContain("summary");
      expect(columns).toContain("compaction_level");
    });

    it("should have id as primary key", async () => {
      const db = await getDb();
      const result = await db.all(sql`PRAGMA table_info(tasks)`);
      const idColumn = result.find((col: any) => col.name === "id") as { pk: number } | undefined;

      expect(idColumn).toBeDefined();
      expect(idColumn?.pk).toBe(1);
    });

    it("should have default status of 'open'", async () => {
      const db = await getDb();
      const taskId = `test-task-${Date.now()}`;
      const now = Date.now();

      await db.run(sql`
        INSERT INTO tasks (id, title, created_at, updated_at)
        VALUES (${taskId}, 'Test Task', ${now}, ${now})
      `);

      const result = await db.get(sql`SELECT * FROM tasks WHERE id = ${taskId}`);

      expect(result).toBeDefined();
      expect((result as any)?.status).toBe("open");

      await db.run(sql`DELETE FROM tasks WHERE id = ${taskId}`);
    });

    it("should have default priority of 2", async () => {
      const db = await getDb();
      const taskId = `test-task-priority-${Date.now()}`;
      const now = Date.now();

      await db.run(sql`
        INSERT INTO tasks (id, title, created_at, updated_at)
        VALUES (${taskId}, 'Test Task', ${now}, ${now})
      `);

      const result = await db.get(sql`SELECT * FROM tasks WHERE id = ${taskId}`);

      expect(result).toBeDefined();
      expect((result as any)?.priority).toBe(2);

      await db.run(sql`DELETE FROM tasks WHERE id = ${taskId}`);
    });

    it("should have default type of 'task'", async () => {
      const db = await getDb();
      const taskId = `test-task-type-${Date.now()}`;
      const now = Date.now();

      await db.run(sql`
        INSERT INTO tasks (id, title, created_at, updated_at)
        VALUES (${taskId}, 'Test Task', ${now}, ${now})
      `);

      const result = await db.get(sql`SELECT * FROM tasks WHERE id = ${taskId}`);

      expect(result).toBeDefined();
      expect((result as any)?.type).toBe("task");

      await db.run(sql`DELETE FROM tasks WHERE id = ${taskId}`);
    });
  });

  describe("task_dependencies table", () => {
    it("should exist and have correct columns", async () => {
      const db = await getDb();
      const result = await db.all(sql`PRAGMA table_info(task_dependencies)`);

      const columns = result.map((col: any) => col.name);

      expect(columns).toContain("task_id");
      expect(columns).toContain("depends_on_id");
      expect(columns).toContain("type");
      expect(columns).toContain("created_at");
    });

    it("should allow inserting a dependency", async () => {
      const db = await getDb();
      const now = Date.now();
      const taskId1 = `test-dep-task1-${Date.now()}`;
      const taskId2 = `test-dep-task2-${Date.now()}`;

      await db.run(sql`
        INSERT INTO tasks (id, title, created_at, updated_at)
        VALUES (${taskId1}, 'Task 1', ${now}, ${now})
      `);

      await db.run(sql`
        INSERT INTO tasks (id, title, created_at, updated_at)
        VALUES (${taskId2}, 'Task 2', ${now}, ${now})
      `);

      await db.run(sql`
        INSERT INTO task_dependencies (task_id, depends_on_id, type, created_at)
        VALUES (${taskId2}, ${taskId1}, 'blocks', ${now})
      `);

      const result = await db.get(sql`
        SELECT * FROM task_dependencies WHERE task_id = ${taskId2} AND depends_on_id = ${taskId1}
      `);

      expect(result).toBeDefined();
      expect((result as any)?.type).toBe("blocks");

      await db.run(sql`DELETE FROM task_dependencies WHERE task_id = ${taskId2}`);
      await db.run(sql`DELETE FROM tasks WHERE id IN (${taskId1}, ${taskId2})`);
    });
  });

  describe("task_messages table", () => {
    it("should exist and have correct columns", async () => {
      const db = await getDb();
      const result = await db.all(sql`PRAGMA table_info(task_messages)`);

      const columns = result.map((col: any) => col.name);

      expect(columns).toContain("task_id");
      expect(columns).toContain("message_id");
      expect(columns).toContain("relation_type");
      expect(columns).toContain("created_at");
    });

    it("should allow linking a message to a task", async () => {
      const db = await getDb();
      const now = Date.now();
      const threadId = `test-tm-thread-${Date.now()}`;
      const taskId = `test-tm-task-${Date.now()}`;
      const messageId = `test-tm-msg-${Date.now()}`;

      await db.run(sql`
        INSERT INTO threads (id, resource_id, title, created_at, updated_at)
        VALUES (${threadId}, 'test-resource', 'Test Thread', ${now}, ${now})
      `);

      await db.run(sql`
        INSERT INTO tasks (id, title, created_at, updated_at)
        VALUES (${taskId}, 'Test Task', ${now}, ${now})
      `);

      await db.run(sql`
        INSERT INTO messages (id, thread_id, resource_id, role, raw_content, search_text, injection_text, created_at, message_index)
        VALUES (${messageId}, ${threadId}, 'test-resource', 'assistant', 'content', 'content', 'content', ${now}, 0)
      `);

      await db.run(sql`
        INSERT INTO task_messages (task_id, message_id, relation_type, created_at)
        VALUES (${taskId}, ${messageId}, 'output', ${now})
      `);

      const result = await db.get(sql`
        SELECT * FROM task_messages WHERE task_id = ${taskId} AND message_id = ${messageId}
      `);

      expect(result).toBeDefined();
      expect((result as any)?.relation_type).toBe("output");

      await db.run(sql`DELETE FROM task_messages WHERE task_id = ${taskId}`);
      await db.run(sql`DELETE FROM messages WHERE id = ${messageId}`);
      await db.run(sql`DELETE FROM tasks WHERE id = ${taskId}`);
      await db.run(sql`DELETE FROM threads WHERE id = ${threadId}`);
    });
  });

  describe("messages_fts virtual table", () => {
    it("should exist as FTS5 virtual table", async () => {
      const db = await getDb();
      const result = await db.all(sql`
        SELECT name, type FROM sqlite_master WHERE name = 'messages_fts'
      `);

      expect(result.length).toBeGreaterThan(0);
    });

    it("should index search_text from messages table", async () => {
      const db = await getDb();
      const now = Date.now();
      const threadId = `test-fts-thread-${Date.now()}`;
      const messageId = `test-fts-msg-${Date.now()}`;
      const uniqueText = `unique_search_term_${Date.now()}`;

      await db.run(sql`
        INSERT INTO threads (id, resource_id, title, created_at, updated_at)
        VALUES (${threadId}, 'test-resource', 'Test Thread', ${now}, ${now})
      `);

      await db.run(sql`
        INSERT INTO messages (id, thread_id, resource_id, role, raw_content, search_text, injection_text, created_at, message_index)
        VALUES (${messageId}, ${threadId}, 'test-resource', 'user', 'raw', ${uniqueText}, 'injection', ${now}, 0)
      `);

      const result = await db.all(sql`
        SELECT * FROM messages_fts WHERE messages_fts MATCH ${uniqueText}
      `);

      expect(result.length).toBeGreaterThan(0);

      await db.run(sql`DELETE FROM messages WHERE id = ${messageId}`);
      await db.run(sql`DELETE FROM threads WHERE id = ${threadId}`);
    });

    it("should support BM25 ranking", async () => {
      const db = await getDb();
      const now = Date.now();
      const threadId = `test-bm25-thread-${Date.now()}`;

      await db.run(sql`
        INSERT INTO threads (id, resource_id, title, created_at, updated_at)
        VALUES (${threadId}, 'test-resource', 'Test Thread', ${now}, ${now})
      `);

      const searchPhrase = "bm25_test_query_" + Date.now();
      const messageId1 = `test-bm25-msg1-${Date.now()}`;
      const messageId2 = `test-bm25-msg2-${Date.now()}`;

      await db.run(sql`
        INSERT INTO messages (id, thread_id, resource_id, role, raw_content, search_text, injection_text, created_at, message_index)
        VALUES (${messageId1}, ${threadId}, 'test-resource', 'user', 'raw', ${searchPhrase}, 'injection', ${now}, 0)
      `);

      await db.run(sql`
        INSERT INTO messages (id, thread_id, resource_id, role, raw_content, search_text, injection_text, created_at, message_index)
        VALUES (${messageId2}, ${threadId}, 'test-resource', 'user', 'raw', ${searchPhrase + " extra words"}, 'injection', ${now}, 1)
      `);

      const result = await db.all(sql`
        SELECT m.id, bm25(messages_fts) as rank
        FROM messages_fts fts
        JOIN messages m ON m.rowid = fts.rowid
        WHERE messages_fts MATCH ${searchPhrase}
        ORDER BY rank ASC
      `);

      expect(result.length).toBe(2);

      await db.run(sql`DELETE FROM messages WHERE id IN (${messageId1}, ${messageId2})`);
      await db.run(sql`DELETE FROM threads WHERE id = ${threadId}`);
    });

    it("should keep FTS index in sync on update and delete", async () => {
      const db = await getDb();
      const now = Date.now();
      const threadId = `test-fts-sync-thread-${Date.now()}`;
      const messageId = `test-fts-sync-msg-${Date.now()}`;
      const initialText = `fts_sync_initial_${Date.now()}`;
      const updatedText = `fts_sync_updated_${Date.now()}`;

      await db.run(sql`
        INSERT INTO threads (id, resource_id, title, created_at, updated_at)
        VALUES (${threadId}, 'test-resource', 'FTS Sync Thread', ${now}, ${now})
      `);

      await db.run(sql`
        INSERT INTO messages (id, thread_id, resource_id, role, raw_content, search_text, injection_text, created_at, message_index)
        VALUES (${messageId}, ${threadId}, 'test-resource', 'user', 'raw', ${initialText}, 'inj', ${now}, 0)
      `);

      const initialMatch = await db.all(sql`
        SELECT rowid FROM messages_fts WHERE messages_fts MATCH ${initialText}
      `);
      expect(initialMatch.length).toBeGreaterThan(0);

      await db.run(sql`
        UPDATE messages
        SET search_text = ${updatedText}
        WHERE id = ${messageId}
      `);

      const oldMatchAfterUpdate = await db.all(sql`
        SELECT rowid FROM messages_fts WHERE messages_fts MATCH ${initialText}
      `);
      const newMatchAfterUpdate = await db.all(sql`
        SELECT rowid FROM messages_fts WHERE messages_fts MATCH ${updatedText}
      `);
      expect(oldMatchAfterUpdate.length).toBe(0);
      expect(newMatchAfterUpdate.length).toBeGreaterThan(0);

      await db.run(sql`DELETE FROM messages WHERE id = ${messageId}`);
      const matchAfterDelete = await db.all(sql`
        SELECT rowid FROM messages_fts WHERE messages_fts MATCH ${updatedText}
      `);
      expect(matchAfterDelete.length).toBe(0);

      await db.run(sql`DELETE FROM threads WHERE id = ${threadId}`);
    });
  });

  describe("tasks_fts virtual table", () => {
    it("should exist with correct columns", async () => {
      const db = await getDb();
      const result = await db.all(sql`
        SELECT name, type FROM sqlite_master WHERE name = 'tasks_fts'
      `);

      expect(result.length).toBe(1);
      expect((result[0] as any)?.type).toBe("table");
    });

    it("should index new tasks automatically via trigger", async () => {
      const db = await getDb();
      const now = Date.now();
      const taskId = `test-task-fts-${now}`;
      const uniqueText = `uniquelogin${now}`;

      await db.run(sql`
        INSERT INTO tasks (id, title, description, status, priority, type, created_at, updated_at)
        VALUES (${taskId}, ${uniqueText}, 'Implement login feature', 'open', 2, 'feature', ${now}, ${now})
      `);

      const match = await db.all(sql`
        SELECT rowid FROM tasks_fts WHERE tasks_fts MATCH ${uniqueText}
      `);

      expect(match.length).toBeGreaterThan(0);

      await db.run(sql`DELETE FROM tasks WHERE id = ${taskId}`);
    });

    it("should support code identifier tokenization with underscores", async () => {
      const db = await getDb();
      const now = Date.now();
      const taskId = `test-task-underscore-${now}`;
      const codeIdentifier = `refresh_token_handler`;

      await db.run(sql`
        INSERT INTO tasks (id, title, description, status, priority, type, created_at, updated_at)
        VALUES (${taskId}, 'Token handler', ${codeIdentifier}, 'open', 2, 'feature', ${now}, ${now})
      `);

      const match = await db.all(sql`
        SELECT rowid FROM tasks_fts WHERE tasks_fts MATCH ${codeIdentifier}
      `);

      expect(match.length).toBeGreaterThan(0);

      await db.run(sql`DELETE FROM tasks WHERE id = ${taskId}`);
    });

    it("should support BM25 ranking", async () => {
      const db = await getDb();
      const now = Date.now();

      const taskId1 = `test-task-bm25-1-${now}`;
      const taskId2 = `test-task-bm25-2-${now}`;

      await db.run(sql`
        INSERT INTO tasks (id, title, description, status, priority, type, created_at, updated_at)
        VALUES (${taskId1}, 'Auth implementation', 'Create login and register', 'open', 2, 'feature', ${now}, ${now})
      `);

      await db.run(sql`
        INSERT INTO tasks (id, title, description, status, priority, type, created_at, updated_at)
        VALUES (${taskId2}, 'Database schema', 'User table with login fields', 'open', 2, 'feature', ${now}, ${now})
      `);

      const results = await db.all(sql`
        SELECT t.id, bm25(tasks_fts) as rank
        FROM tasks_fts fts
        JOIN tasks t ON t.rowid = fts.rowid
        WHERE tasks_fts MATCH 'login'
        ORDER BY rank ASC
        LIMIT 5
      `);

      expect(results.length).toBeGreaterThanOrEqual(1);

      await db.run(sql`DELETE FROM tasks WHERE id = ${taskId1}`);
      await db.run(sql`DELETE FROM tasks WHERE id = ${taskId2}`);
    });

    it("should backfill existing tasks on migration", async () => {
      const db = await getDb();
      const now = Date.now();
      const uniqueText = `legacytask${now}`;

      await db.run(sql`
        INSERT INTO tasks (id, title, description, status, priority, type, created_at, updated_at)
        VALUES (${uniqueText}, ${uniqueText}, 'Legacy task description', 'open', 2, 'task', ${now}, ${now})
      `);

      const match = await db.all(sql`
        SELECT rowid FROM tasks_fts WHERE tasks_fts MATCH ${uniqueText}
      `);

      expect(match.length).toBeGreaterThan(0);

      await db.run(sql`DELETE FROM tasks WHERE id = ${uniqueText}`);
    });
  });
});
