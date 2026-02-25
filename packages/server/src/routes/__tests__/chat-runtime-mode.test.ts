import { and, eq } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../runtime", () => {
  const controllers = new Map<
    string,
    {
      sessionId: string;
      processMessage: () => Promise<{ status: "completed"; finalContent: string }>;
      getStatus: () => { sessionId: string; phase: "completed" };
      hasIncompleteWork: () => boolean;
    }
  >();
  let lastRequestedSessionId: string | null = null;

  const ensureController = (sessionId: string) => {
    const existing = controllers.get(sessionId);
    if (existing) return existing;

    const controller = {
      sessionId,
      async processMessage() {
        return {
          status: "completed" as const,
          finalContent: "ok",
        };
      },
      getStatus: () => ({
        sessionId,
        phase: "completed" as const,
      }),
      hasIncompleteWork: () => false,
    };

    controllers.set(sessionId, controller);
    return controller;
  };

  return {
    getSessionManager: () => ({
      async getSession(sessionId: string) {
        lastRequestedSessionId = sessionId;
        return controllers.get(sessionId);
      },
      async createSession() {
        if (lastRequestedSessionId) {
          ensureController(lastRequestedSessionId);
        }
      },
    }),
  };
});

describe("Chat runtimeMode route behavior", () => {
  let testSessionId: string;

  beforeEach(async () => {
    const { setupTestDatabase } = await import("../../../db/test-setup");
    await setupTestDatabase();

    const { db, taskSessions, toolSessions } = await import("../../../db");
    await db.delete(toolSessions);
    await db.delete(taskSessions);

    testSessionId = uuidv7();
    await db.insert(taskSessions).values({
      session_id: testSessionId,
      thread_id: testSessionId,
      resource_id: "/tmp/chat",
      title: "Runtime Session",
      workspace_id: null,
      created_at: new Date(),
      last_accessed: new Date(),
      last_activity_at: new Date(),
      status: "researching",
      session_kind: "task",
      spec_type: null,
    });
  });

  afterEach(async () => {
    const { db, taskSessions, toolSessions } = await import("../../../db");
    await db.delete(toolSessions);
    await db.delete(taskSessions);
  });

  it("returns 400 for invalid runtimeMode", async () => {
    const chatRouter = (await import("../chat")).default;

    const response = await chatRouter.request("http://localhost/api/chat?directory=/tmp/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Task-Session-ID": testSessionId,
      },
      body: JSON.stringify({
        message: "hello",
        runtimeMode: "invalid",
        stream: false,
      }),
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("Invalid runtimeMode");
  });

  it("persists runtimeMode when provided", async () => {
    const chatRouter = (await import("../chat")).default;

    const response = await chatRouter.request("http://localhost/api/chat?directory=/tmp/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Task-Session-ID": testSessionId,
      },
      body: JSON.stringify({
        message: "hello",
        runtimeMode: "plan",
        stream: false,
      }),
    });

    expect(response.status).toBe(200);

    const { db, toolSessions } = await import("../../../db");
    const record = await db
      .select()
      .from(toolSessions)
      .where(
        and(
          eq(toolSessions.session_id, testSessionId),
          eq(toolSessions.tool_name, "spec"),
          eq(toolSessions.tool_key, "runtimeMode")
        )
      )
      .get();

    expect(record).toBeTruthy();
    const payload = record?.data as { mode?: unknown } | null;
    expect(payload?.mode).toBe("plan");
  });

  it("returns X-Task-Session-ID and auto-creates intake session for runtimeMode=intake", async () => {
    const chatRouter = (await import("../chat")).default;

    const response = await chatRouter.request("http://localhost/api/chat?directory=/tmp/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: "research this repo",
        runtimeMode: "intake",
        stream: false,
      }),
    });

    expect(response.status).toBe(200);

    const sessionId = response.headers.get("X-Task-Session-ID");
    expect(sessionId).toBeTruthy();

    const { db, taskSessions } = await import("../../../db");
    const created = await db
      .select()
      .from(taskSessions)
      .where(eq(taskSessions.session_id, sessionId!))
      .get();

    expect(created).toBeTruthy();
    expect(created?.session_kind).toBe("intake");
  });
});
