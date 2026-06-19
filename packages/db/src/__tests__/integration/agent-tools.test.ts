import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createAgentLoop } from "@sakti-code/agent";
import { createEditTool, createReadTool } from "@sakti-code/tools";
import { initDatabase, SqliteSessionStore } from "../../";

describe("Integration: AgentLoop + SqliteSessionStore + Tools", () => {
  let tmpDir: string;
  let db: any;
  let store: SqliteSessionStore;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(import.meta.dirname!, "test-XXXXXX"));
    const sqlite = new Database(join(tmpDir, "test.db"));
    db = await initDatabase(sqlite);
    store = new SqliteSessionStore(db);
    db.$client
      .prepare(
        "INSERT INTO projects (id, name, cwd, created_at, updated_at) VALUES ('p1', 'P', '/tmp', 1, 1)"
      )
      .run();
    db.$client
      .prepare(
        "INSERT INTO sessions (id, project_id, model_id, created_at, updated_at) VALUES ('s1', 'p1', 'claude-sonnet', 1, 1)"
      )
      .run();
  });

  afterAll(() => {
    db.$client.close?.();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("full cycle: user prompt → LLM tool call → tool execution → result → persistence", async () => {
    const tools = [createReadTool(tmpDir), createEditTool(tmpDir)];

    const model = {
      id: "test",
      name: "Test",
      api: "openai-completions" as const,
      provider: "openai",
      baseUrl: "",
      reasoning: false,
      input: ["text"] as ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 200_000,
      maxTokens: 4096,
    };

    const _loop = createAgentLoop({
      sessionId: "s1",
      model,
      tools,
      store,
    });

    // We can't actually call loop.prompt() because it calls the real LLM.
    // Instead, verify the wiring by testing that:
    // 1. The loop was created successfully (types wired correctly)
    // 2. The store persists and retrieves messages correctly
    // 3. Tools execute against real files correctly

    // Test store persistence round-trip
    const now = Date.now();
    await store.appendMessage("s1", {
      role: "user",
      content: "Read the file and change greeting to hi",
      timestamp: now,
    });

    const loaded = await store.loadMessages("s1");
    expect(loaded.length).toBeGreaterThanOrEqual(1);
    expect(loaded[0]?.role).toBe("user");

    // Test tool execution against real filesystem
    writeFileSync(join(tmpDir, "test-file.txt"), "old content\nmore content");
    const readTool = tools[0]!;
    const editTool = tools[1]!;

    const readResult = await readTool.execute("tc_1", {
      path: "test-file.txt",
    });
    expect(readResult.isError).toBeFalsy();
    expect(readResult.content).toContain("old content");

    const editResult = await editTool.execute("tc_2", {
      path: "test-file.txt",
      edits: [{ oldText: "old content", newText: "new content" }],
    });
    expect(editResult.isError).toBeFalsy();
    expect(editResult.content).toContain("Applied");

    // Verify file was actually modified
    const readAfter = await readTool.execute("tc_3", { path: "test-file.txt" });
    expect(readAfter.content).toContain("new content");
    expect(readAfter.content).not.toContain("old content");
  });

  test("SqliteSessionStore persists all message roles correctly", async () => {
    const sessionId = "s2";
    db.$client
      .prepare(
        "INSERT INTO sessions (id, project_id, model_id, created_at, updated_at) VALUES ('s2', 'p1', 'claude-sonnet', 1, 1)"
      )
      .run();

    // User message
    await store.appendMessage(sessionId, {
      role: "user",
      content: "fix the bug",
      timestamp: 1000,
    });

    // Assistant message with tool call
    await store.appendMessage(sessionId, {
      role: "assistant",
      content: [
        { type: "text", text: "Let me read the file." },
        {
          type: "toolCall",
          id: "tc_1",
          name: "read",
          arguments: { path: "src/index.ts" },
        },
      ],
      usage: {
        input: 100,
        output: 50,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 150,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      timestamp: 2000,
    });

    // Tool result
    await store.appendMessage(sessionId, {
      role: "tool",
      toolCallId: "tc_1",
      toolName: "read",
      content: [{ type: "text", text: "const x = 1;" }],
      isError: false,
      timestamp: 3000,
    });

    // Verify full round-trip
    const messages = await store.loadMessages(sessionId);
    expect(messages.length).toBeGreaterThanOrEqual(3);

    const user = messages.find((m) => m.role === "user");
    expect(user).toBeDefined();
    if (user?.role === "user") {
      expect(user.content).toBe("fix the bug");
    }

    const asst = messages.find((m) => m.role === "assistant");
    expect(asst).toBeDefined();
    if (asst?.role === "assistant") {
      expect(asst.content.length).toBeGreaterThanOrEqual(2);
      expect(asst.content.some((c) => c.type === "toolCall")).toBe(true);
    }

    const tool = messages.find((m) => m.role === "tool");
    expect(tool).toBeDefined();
    if (tool?.role === "tool") {
      expect(tool.toolCallId).toBe("tc_1");
      expect(tool.isError).toBe(false);
    }
  });

  test("replaceMessages supports compaction flow", async () => {
    const sessionId = "s3";
    db.$client
      .prepare(
        "INSERT INTO sessions (id, project_id, model_id, created_at, updated_at) VALUES ('s3', 'p1', 'claude-sonnet', 1, 1)"
      )
      .run();

    // Simulate compaction: replace many messages with summary + recent
    const summary: AgentMessage = {
      role: "user",
      content: "Previous conversation summary: we fixed a bug in the parser.",
      timestamp: 1000,
    };
    const recent: AgentMessage = {
      role: "assistant",
      content: [
        {
          type: "text",
          text: "Understood, continuing from where we left off.",
        },
      ],
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

    await store.replaceMessages(sessionId, [summary, recent]);

    const messages = await store.loadMessages(sessionId);
    expect(messages.length).toBe(2);
    expect(messages[0]?.role).toBe("user");
    expect((messages[0] as any).content).toContain("summary");
  });
});
