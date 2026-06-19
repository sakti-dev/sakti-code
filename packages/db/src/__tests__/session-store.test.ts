import { describe, expect, test, afterAll, beforeAll } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { initDatabase } from "../init";
import { SqliteSessionStore } from "../session-store";
import type { AgentMessage } from "@sakti-code/agent";

describe("SqliteSessionStore", () => {
  let db: any;
  let tmpDir: string;
  let store: SqliteSessionStore;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(import.meta.dirname!, "test-XXXXXX"));
    const sqlite = new Database(join(tmpDir, "test.db"));
    db = await initDatabase(sqlite);
    store = new SqliteSessionStore(db);
    db.$client.prepare("INSERT INTO projects (id, name, cwd, created_at, updated_at) VALUES ('p1', 'P', '/tmp', 1, 1)").run();
    db.$client.prepare("INSERT INTO sessions (id, project_id, model_id, created_at, updated_at) VALUES ('s1', 'p1', 'm1', 1, 1)").run();
    db.$client.prepare("INSERT INTO sessions (id, project_id, model_id, created_at, updated_at) VALUES ('s2', 'p1', 'm1', 1, 1)").run();
  });

  afterAll(() => {
    db.$client.close?.();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("loadMessages returns empty for new session", async () => {
    expect(await store.loadMessages("s1")).toEqual([]);
  });

  test("appendMessage persists and loadMessages retrieves in order", async () => {
    const userMsg: AgentMessage = { role: "user", content: "hello", timestamp: 1000 };
    await store.appendMessage("s1", userMsg);

    const asstMsg: AgentMessage = {
      role: "assistant",
      content: [{ type: "text", text: "hi there" }],
      usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
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
    expect(loaded[0]!.role).toBe("user");
    expect((loaded[0] as any).content).toBe("hello");
    expect(loaded[1]!.role).toBe("assistant");
    expect(loaded[2]!.role).toBe("tool");
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
      usage: { input: 5, output: 3, cacheRead: 0, cacheWrite: 0, totalTokens: 8, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      timestamp: 5000,
    };
    await store.replaceMessages("s1", [replacement, recent]);

    const loaded = await store.loadMessages("s1");
    expect(loaded.length).toBe(2);
    expect((loaded[0] as any).content).toBe("summary of previous conversation");
  });

  test("sessions don't interfere with each other", async () => {
    await store.appendMessage("s2", { role: "user", content: "other session", timestamp: 1000 });
    expect((await store.loadMessages("s1")).length).toBe(2); // still the replacement
    expect((await store.loadMessages("s2")).length).toBe(1);
  });
});
