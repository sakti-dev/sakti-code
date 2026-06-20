import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { AgentMessage } from "@sakti-code/agent";
import { initDatabase } from "../init";
import { SessionRepo } from "../repos/index";
import { SqliteSessionStore } from "../session-store";

describe("SqliteSessionStore", () => {
  let db: any;
  let tmpDir: string;
  let store: SqliteSessionStore;
  let _sessionRepo: SessionRepo;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(import.meta.dirname!, "test-XXXXXX"));
    const sqlite = new Database(join(tmpDir, "test.db"));
    db = await initDatabase(sqlite);
    store = new SqliteSessionStore(db);
    _sessionRepo = new SessionRepo(db);
    db.$client
      .prepare(
        "INSERT INTO projects (id, name, cwd, created_at, updated_at) VALUES ('p1', 'P', '/tmp', 1, 1)"
      )
      .run();
    db.$client
      .prepare(
        "INSERT INTO sessions (id, project_id, model_id, created_at, updated_at) VALUES ('s1', 'p1', 'm1', 1, 1)"
      )
      .run();
    db.$client
      .prepare(
        "INSERT INTO sessions (id, project_id, model_id, created_at, updated_at) VALUES ('s2', 'p1', 'm1', 1, 1)"
      )
      .run();
  });

  afterAll(() => {
    db.$client.close?.();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("loadMessages returns empty for new session", async () => {
    expect(await store.loadMessages("s1")).toEqual([]);
  });

  test("appendMessage persists and loadMessages retrieves in order", async () => {
    const userMsg: AgentMessage = {
      role: "user",
      content: "hello",
      timestamp: 1000,
    };
    await store.appendMessage("s1", userMsg);

    const asstMsg: AgentMessage = {
      role: "assistant",
      content: [{ type: "text", text: "hi there" }],
      usage: {
        input: 10,
        output: 5,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 15,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      timestamp: 2000,
    };
    await store.appendMessage("s1", asstMsg);

    const toolMsg: AgentMessage = {
      role: "tool",
      toolCallId: "tc_1",
      toolName: "bash",
      content: [{ type: "text", text: "ok" }],
      isError: false,
      timestamp: 3000,
    };
    await store.appendMessage("s1", toolMsg);

    const loaded = await store.loadMessages("s1");
    expect(loaded.length).toBe(3);
    expect(loaded[0]?.role).toBe("user");
    expect((loaded[0] as any).content).toBe("hello");
    expect(loaded[1]?.role).toBe("assistant");
    expect(loaded[2]?.role).toBe("tool");
    expect((loaded[2] as any).toolCallId).toBe("tc_1");
  });

  test("replaceMessages atomically swaps all messages", async () => {
    const replacement: AgentMessage = {
      role: "user",
      content: "summary of previous conversation",
      timestamp: 4000,
    };
    const recent: AgentMessage = {
      role: "assistant",
      content: [{ type: "text", text: "ok" }],
      usage: {
        input: 5,
        output: 3,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 8,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      timestamp: 5000,
    };
    await store.replaceMessages("s1", [replacement, recent]);

    const loaded = await store.loadMessages("s1");
    expect(loaded.length).toBe(2);
    expect((loaded[0] as any).content).toBe("summary of previous conversation");
  });

  test("sessions don't interfere with each other", async () => {
    await store.appendMessage("s2", {
      role: "user",
      content: "other session",
      timestamp: 1000,
    });
    expect((await store.loadMessages("s1")).length).toBe(2); // still the replacement
    expect((await store.loadMessages("s2")).length).toBe(1);
  });

  test("round-trips stopReason and errorMessage on assistant messages", async () => {
    const errorMsg: AgentMessage = {
      role: "assistant",
      content: [{ type: "text", text: "billing exceeded" }],
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "error",
      errorMessage: "billing exceeded",
      timestamp: 6000,
    };
    await store.appendMessage("s1", errorMsg);

    const loaded = await store.loadMessages("s1");
    // s1 had 2 messages from earlier test (replacement), now +1 = 3
    const last = loaded.at(-1) as any;
    expect(last.role).toBe("assistant");
    expect(last.stopReason).toBe("error");
    expect(last.errorMessage).toBe("billing exceeded");
  });
});

describe("SessionRepo fork support", () => {
  let db: any;
  let tmpDir: string;
  let sessionRepo: SessionRepo;
  let _projectId: string;
  let parentSessionId: string;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(import.meta.dirname!, "fork-test-XXXXXX"));
    const sqlite = new Database(join(tmpDir, "test.db"));
    db = await initDatabase(sqlite);
    sessionRepo = new SessionRepo(db);
    // Create project directly
    db.$client
      .prepare(
        "INSERT INTO projects (id, name, cwd, created_at, updated_at) VALUES ('fp1', 'ForkTest', '/tmp', 1, 1)"
      )
      .run();
    _projectId = "fp1";
    // Create a parent session
    parentSessionId = (
      await sessionRepo.create("fp1", "gpt-4o", { title: "Original" })
    ).id;
  });

  afterAll(() => {
    db.$client.close?.();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("create with parentSessionId stores the reference", async () => {
    const child = await sessionRepo.create("fp1", "gpt-4o", {
      title: "Child",
      parentSessionId,
    });
    expect(child.parentSessionId).toBe(parentSessionId);
  });

  test("findForkedChildren returns all forked sessions", async () => {
    // Create 3 forked children
    const child1 = await sessionRepo.create("fp1", "gpt-4o", {
      title: "C1",
      parentSessionId,
    });
    const child2 = await sessionRepo.create("fp1", "gpt-4o", {
      title: "C2",
      parentSessionId,
    });
    const child3 = await sessionRepo.create("fp1", "gpt-4o", {
      title: "C3",
      parentSessionId,
    });

    const children = sessionRepo.findForkedChildren(parentSessionId);
    expect(children.length).toBeGreaterThanOrEqual(3);
    expect(children.some((c) => c.id === child1.id)).toBe(true);
    expect(children.some((c) => c.id === child2.id)).toBe(true);
    expect(children.some((c) => c.id === child3.id)).toBe(true);
  });
});

describe("SqliteSessionStore.fork", () => {
  let db: any;
  let tmpDir: string;
  let store: SqliteSessionStore;
  let sessionRepo: SessionRepo;
  let projectId: string;
  let sourceSessionId: string;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(import.meta.dirname!, "fork-store-XXXXXX"));
    const sqlite = new Database(join(tmpDir, "test.db"));
    db = await initDatabase(sqlite);
    store = new SqliteSessionStore(db);
    sessionRepo = new SessionRepo(db);
    db.$client
      .prepare(
        "INSERT INTO projects (id, name, cwd, created_at, updated_at) VALUES ('fsp1', 'ForkStoreTest', '/tmp', 1, 1)"
      )
      .run();
    projectId = "fsp1";

    // Create source session with messages
    sourceSessionId = (
      await sessionRepo.create(projectId, "gpt-4o", { title: "Source" })
    ).id;
    await db.$client
      .prepare(
        "INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)"
      )
      .run(crypto.randomUUID(), sourceSessionId, "user", "Message 1", 1000);
    await db.$client
      .prepare(
        "INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)"
      )
      .run(crypto.randomUUID(), sourceSessionId, "assistant", "Reply 1", 2000);
    await db.$client
      .prepare(
        "INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)"
      )
      .run(crypto.randomUUID(), sourceSessionId, "user", "Message 2", 3000);
    await db.$client
      .prepare(
        "INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)"
      )
      .run(crypto.randomUUID(), sourceSessionId, "assistant", "Reply 2", 4000);
  });

  afterAll(() => {
    db.$client.close?.();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("fork without index copies all messages", async () => {
    const result = await store.fork(sourceSessionId);
    expect(result.sessionId).toBeDefined();

    const forkedSession = sessionRepo.findById(result.sessionId);
    expect(forkedSession).toBeDefined();
    expect(forkedSession?.parentSessionId).toBe(sourceSessionId);
    expect(forkedSession?.title).toBe("Fork of Source");

    const forkedMsgs = await store.loadMessages(result.sessionId);
    expect(forkedMsgs.length).toBe(4);
    expect(forkedMsgs[0]?.role).toBe("user");
    expect((forkedMsgs[0] as any).content).toBe("Message 1");
    expect(forkedMsgs[3]?.role).toBe("assistant");
    // Assistant messages have content as array of content blocks
    expect(Array.isArray((forkedMsgs[3] as any).content)).toBe(true);
  });

  test("fork at index copies messages up to that point", async () => {
    const result = await store.fork(sourceSessionId, 1); // first 2 messages (indices 0, 1)
    const forkedMsgs = await store.loadMessages(result.sessionId);
    expect(forkedMsgs.length).toBe(2);
    expect(forkedMsgs[0]?.role).toBe("user");
    expect((forkedMsgs[0] as any).content).toBe("Message 1");
    expect(forkedMsgs[1]?.role).toBe("assistant");
  });

  test("fork unknown session throws", async () => {
    expect(store.fork("nonexistent")).rejects.toThrow("Session not found");
  });
});
