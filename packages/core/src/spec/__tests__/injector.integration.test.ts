/**
 * Tests for Spec Context Injection
 *
 * Phase 4 - Spec System Tests
 * Tests verify:
 * - injectSpecContext returns unchanged messages when no active spec
 * - Injects context after continuation hint
 * - Includes current task details
 * - Shows task index with status indicators
 */

import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Message } from "@/chat";

type TestMessage = Message & { metadata?: Record<string, unknown> };

describe("Spec Injector", () => {
  let injectSpecContext: typeof import("@/agent/spec-injector").injectSpecContext;
  let updateSessionSpec: typeof import("@/spec/helpers").updateSessionSpec;
  let updateCurrentTask: typeof import("@/spec/helpers").updateCurrentTask;
  let Instance: typeof import("@/instance").Instance;
  let taskStorage: import("@/memory/task/storage").TaskStorage;

  const testSessionId = `test-injector-session-${uuidv7()}`;
  const testWorkspaceDir = `/tmp/sakti-code-test-injector-${uuidv7()}`;
  const testHomeDir = `/tmp/sakti-code-test-home-${uuidv7()}`;
  const previousSaktiCodeHome = process.env.SAKTI_CODE_HOME;

  beforeEach(async () => {
    vi.resetModules();
    process.env.SAKTI_CODE_HOME = testHomeDir;

    const injector = await import("@/agent/spec-injector");
    injectSpecContext = injector.injectSpecContext;

    const helpers = await import("@/spec/helpers");
    updateSessionSpec = helpers.updateSessionSpec;
    updateCurrentTask = helpers.updateCurrentTask;

    const instanceModule = await import("@/instance");
    Instance = instanceModule.Instance;

    const { TaskStorage } = await import("@/memory/task/storage");
    taskStorage = new TaskStorage();

    const { getDb, sessions } = await import("@/testing/db");
    const { sql } = await import("drizzle-orm");
    const db = await getDb();

    await db.run(sql`DELETE FROM tool_sessions WHERE tool_name = 'spec'`);
    await db.run(sql`DELETE FROM task_dependencies`);
    await db.run(sql`DELETE FROM tasks`);

    await db
      .insert(sessions)
      .values({
        session_id: testSessionId,
        resource_id: "test",
        thread_id: testSessionId,
        title: "Test Session",
        created_at: new Date(),
        last_accessed: new Date(),
      })
      .onConflictDoNothing();
  });

  afterAll(async () => {
    if (previousSaktiCodeHome === undefined) {
      delete process.env.SAKTI_CODE_HOME;
    } else {
      process.env.SAKTI_CODE_HOME = previousSaktiCodeHome;
    }
    const { closeDb } = await import("@/testing/db");
    closeDb();
  });

  const createTextPart = (text: string) => ({
    id: `part-${uuidv7()}`,
    sessionID: testSessionId,
    messageID: `msg-${uuidv7()}`,
    type: "text" as const,
    text,
  });

  const createMessage = (
    role: "user" | "system" | "assistant",
    content: string,
    extra?: Record<string, unknown>
  ): TestMessage => ({
    info: { role, id: `msg-${uuidv7()}` },
    parts: [createTextPart(content)],
    ...extra,
  });

  describe("injectSpecContext", () => {
    it("should return unchanged messages when no active spec", async () => {
      await Instance.provide({
        directory: testWorkspaceDir,
        sessionID: testSessionId,
        messageID: "msg-1",
        async fn() {
          const messages = [createMessage("user", "Hello")];

          const result = await injectSpecContext(messages, testSessionId);
          expect(result).toBe(messages);
          expect(result.length).toBe(1);
        },
      });
    });

    it("should inject context after continuation hint", async () => {
      await Instance.provide({
        directory: testWorkspaceDir,
        sessionID: testSessionId,
        messageID: "msg-1",
        async fn() {
          await updateSessionSpec(testSessionId, "user-auth");

          const now = Date.now();
          await taskStorage.createTask({
            id: "spec-user-auth_T-001",
            title: "Implement login",
            description: "Create login page",
            status: "open",
            createdAt: now,
            updatedAt: now,
            metadata: { spec: { slug: "user-auth", taskId: "T-001", requirements: ["R-001"] } },
          });

          await updateCurrentTask(testSessionId, "T-001");

          const continuationMessage = createMessage("user", "Continue", {
            metadata: { type: "memory-continuation" },
          });

          const messages = [
            createMessage("system", "System"),
            continuationMessage,
            createMessage("user", "Hello"),
          ];

          const result = await injectSpecContext(messages, testSessionId);

          expect(result.length).toBe(4);
          expect((result[2] as { info: { role: string } }).info.role).toBe("system");
          expect((result[2] as { parts: Array<{ text: string }> }).parts[0].text).toContain(
            "Current Task"
          );
          expect((result[2] as { parts: Array<{ text: string }> }).parts[0].text).toContain(
            "T-001"
          );
        },
      });
    });

    it("should include task index with status indicators", async () => {
      await Instance.provide({
        directory: testWorkspaceDir,
        sessionID: testSessionId,
        messageID: "msg-1",
        async fn() {
          await updateSessionSpec(testSessionId, "user-auth");

          const now = Date.now();
          await taskStorage.createTask({
            id: "spec-user-auth_T-001",
            title: "Task 1",
            status: "closed",
            createdAt: now,
            updatedAt: now,
            metadata: { spec: { slug: "user-auth", taskId: "T-001" } },
          });

          await taskStorage.createTask({
            id: "spec-user-auth_T-002",
            title: "Task 2",
            status: "in_progress",
            createdAt: now,
            updatedAt: now,
            metadata: { spec: { slug: "user-auth", taskId: "T-002" } },
          });

          await taskStorage.createTask({
            id: "spec-user-auth_T-003",
            title: "Task 3",
            status: "open",
            createdAt: now,
            updatedAt: now,
            metadata: { spec: { slug: "user-auth", taskId: "T-003" } },
          });

          await updateCurrentTask(testSessionId, "T-002");

          const messages = [createMessage("user", "Hello")];

          const result = await injectSpecContext(messages, testSessionId);

          expect(result.length).toBe(2);
          expect((result[0] as { parts: Array<{ text: string }> }).parts[0].text).toContain(
            "✓ T-001"
          );
          expect((result[0] as { parts: Array<{ text: string }> }).parts[0].text).toContain(
            "→ T-002"
          );
          expect((result[0] as { parts: Array<{ text: string }> }).parts[0].text).toContain(
            "○ T-003"
          );
        },
      });
    });

    it("should only treat memory-continuation metadata as continuation hint", async () => {
      await Instance.provide({
        directory: testWorkspaceDir,
        sessionID: testSessionId,
        messageID: "msg-1",
        async fn() {
          await updateSessionSpec(testSessionId, "user-auth");

          const now = Date.now();
          await taskStorage.createTask({
            id: "spec-user-auth_T-001",
            title: "Task 1",
            status: "open",
            createdAt: now,
            updatedAt: now,
            metadata: { spec: { slug: "user-auth", taskId: "T-001" } },
          });

          await updateCurrentTask(testSessionId, "T-001");

          const nonContinuationMessage = createMessage("user", "Not continuation", {
            metadata: { type: "custom-tag" },
          });

          const messages = [
            createMessage("system", "System"),
            nonContinuationMessage,
            createMessage("user", "Hello"),
          ];

          const result = await injectSpecContext(messages, testSessionId);

          expect(result.length).toBe(4);
          expect((result[1] as { info: { role: string } }).info.role).toBe("system");
          expect((result[1] as { parts: Array<{ text: string }> }).parts[0].text).toContain(
            "Current Task"
          );
        },
      });
    });

    it("should inject at beginning when no continuation hint", async () => {
      await Instance.provide({
        directory: testWorkspaceDir,
        sessionID: testSessionId,
        messageID: "msg-1",
        async fn() {
          await updateSessionSpec(testSessionId, "user-auth");

          const now = Date.now();
          await taskStorage.createTask({
            id: "spec-user-auth_T-001",
            title: "Task 1",
            status: "open",
            createdAt: now,
            updatedAt: now,
            metadata: { spec: { slug: "user-auth", taskId: "T-001" } },
          });

          await updateCurrentTask(testSessionId, "T-001");

          const messages = [createMessage("system", "System"), createMessage("user", "Hello")];

          const result = await injectSpecContext(messages, testSessionId);

          expect(result.length).toBe(3);
          expect((result[1] as { info: { role: string } }).info.role).toBe("system");
          expect((result[1] as { parts: Array<{ text: string }> }).parts[0].text).toContain(
            "Current Task"
          );
        },
      });
    });
  });
});
