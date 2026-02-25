/**
 * Tests for session bridge middleware
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- Test files use any for simplicity */

import { Hono } from "hono";
import { v7 as uuidv7 } from "uuid";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../../index";

vi.mock("uuid", () => ({
  v7: vi.fn(),
}));

const uuidv7Mock = vi.mocked(uuidv7) as unknown as ReturnType<typeof vi.fn>;

describe("session bridge middleware", () => {
  let mockApp: Hono<any>;
  let callCount: number;

  beforeEach(async () => {
    callCount = 0;
    vi.clearAllMocks();

    const { setupTestDatabase } = await import("../../../db/test-setup");
    await setupTestDatabase();
    const { db, taskSessions } = await import("../../../db");
    await db.delete(taskSessions);

    uuidv7Mock.mockImplementation(() => {
      const ids = [
        "01234567-89ab-7123-8123-456789abcdef",
        "11111111-89ab-7123-8123-456789abcdef",
      ];
      return ids[callCount++] || `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`;
    });

    mockApp = new Hono<Env>();

    const { sessionBridge } = await import("../session-bridge");
    mockApp.use("*", sessionBridge);

    mockApp.get("/test", c => {
      const session = c.get("session");
      const instanceContext = c.get("instanceContext");
      return c.json({
        hasSession: !!session,
        taskSessionId: session?.taskSessionId,
        directory: instanceContext?.directory,
      });
    });
  });

  afterEach(async () => {
    const { db, taskSessions } = await import("../../../db");
    await db.delete(taskSessions);
  });

  it("auto-creates a task session when X-Task-Session-ID is missing", async () => {
    const response = await mockApp.request("/test");
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.hasSession).toBe(true);
    expect(data.taskSessionId).toBe("01234567-89ab-7123-8123-456789abcdef");
  });

  it("rejects legacy X-Session-ID header without X-Task-Session-ID", async () => {
    const response = await mockApp.request("/test", {
      headers: {
        "X-Session-ID": "01234567-89ab-7123-8123-456789abcdef",
      },
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("LEGACY_SESSION_HEADER_NOT_SUPPORTED");
  });

  it("accepts request with existing task session", async () => {
    const sessionId = "01234567-89ab-7123-8123-456789abcdef";
    const { createTaskSessionWithId } = await import("../../../db/task-sessions");
    await createTaskSessionWithId("local", sessionId);

    const response = await mockApp.request("/test", {
      headers: {
        "X-Task-Session-ID": sessionId,
      },
    });

    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.hasSession).toBe(true);
    expect(data.taskSessionId).toBe(sessionId);
  });

  it("creates task session when provided X-Task-Session-ID does not exist", async () => {
    const response = await mockApp.request("/test", {
      headers: {
        "X-Task-Session-ID": "22222222-89ab-7123-8123-456789abcdef",
      },
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.taskSessionId).toBe("22222222-89ab-7123-8123-456789abcdef");
  });

  it("updates lastAccessed timestamp for existing task session", async () => {
    const sessionId = "01234567-89ab-7123-8123-456789abcdef";
    const { createTaskSessionWithId, getTaskSession } = await import("../../../db/task-sessions");
    await createTaskSessionWithId("local", sessionId);

    const firstSession = await getTaskSession(sessionId);
    await new Promise(resolve => setTimeout(resolve, 50));

    await mockApp.request("/test", {
      headers: {
        "X-Task-Session-ID": sessionId,
      },
    });

    const secondSession = await getTaskSession(sessionId);
    expect(secondSession?.lastAccessed.getTime() ?? 0).toBeGreaterThanOrEqual(
      firstSession?.lastAccessed.getTime() ?? 0
    );
  });
});
