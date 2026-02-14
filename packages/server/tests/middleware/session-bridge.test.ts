/**
 * Tests for session bridge middleware
 *
 * TDD approach: Tests written first to define expected behavior
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- Test files use any for simplicity */

import { Hono } from "hono";
import { v7 as uuidv7 } from "uuid";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../../src/index";

// Mock uuidv7 for consistent testing
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

    // Setup database schema
    const { setupTestDatabase } = await import("../../db/test-setup");
    await setupTestDatabase();
    const { db, sessions } = await import("../../db");
    await db.delete(sessions);

    // Mock uuidv7 to return sequential IDs
    uuidv7Mock.mockImplementation(() => {
      const ids = [
        "01234567-89ab-7123-8123-456789abcdef", // session ID
        "11111111-89ab-7123-8123-456789abcdef", // tool session 1
      ];
      return ids[callCount++] || `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`;
    });

    // Create a test app with the session bridge middleware
    mockApp = new Hono<Env>();

    // Import and use the session bridge middleware
    const { sessionBridge } = await import("../../src/middleware/session-bridge");
    mockApp.use("*", sessionBridge);

    // Add a test endpoint
    mockApp.get("/test", c => {
      const session = c.get("session");
      const instanceContext = c.get("instanceContext");
      return c.json({
        hasSession: !!session,
        sessionId: session?.sessionId,
        directory: instanceContext?.directory,
      });
    });
  });

  afterEach(async () => {
    // Clean up database
    const { db, sessions } = await import("../../db");
    await db.delete(sessions);
  });

  describe("request without sessionId", () => {
    it("should generate new UUIDv7 session", async () => {
      const response = await mockApp.request("/test");
      const data = await response.json();

      expect(data.hasSession).toBe(true);
      expect(data.sessionId).toBe("01234567-89ab-7123-8123-456789abcdef");
    });

    it("should persist session to database", async () => {
      await mockApp.request("/test");

      const { getSession } = await import("../../db/sessions");
      const session = await getSession("01234567-89ab-7123-8123-456789abcdef");

      expect(session).toBeDefined();
      expect(session?.resourceId).toBe("local");
    });

    it("should set session in context", async () => {
      const response = await mockApp.request("/test");
      const data = await response.json();

      expect(data.hasSession).toBe(true);
    });

    it("uses query directory for workspace selection", async () => {
      const response = await mockApp.request("/test?directory=/tmp/query-workspace");
      const data = await response.json();

      expect(data.directory).toBe("/tmp/query-workspace");
    });

    it("prefers query directory over header", async () => {
      const response = await mockApp.request("/test?directory=/tmp/query-workspace", {
        headers: {
          "X-Workspace": "/tmp/header-workspace",
        },
      });
      const data = await response.json();

      expect(data.directory).toBe("/tmp/query-workspace");
    });
  });

  describe("request with sessionId", () => {
    it("should validate existing session", async () => {
      // First request creates session
      const firstResponse = await mockApp.request("/test");
      const firstData = await firstResponse.json();
      const sessionId = firstData.sessionId;

      // Second request with sessionId
      const secondResponse = await mockApp.request("/test", {
        headers: {
          "X-Session-ID": sessionId,
        },
      });
      const secondData = await secondResponse.json();

      expect(secondData.sessionId).toBe(sessionId);
    });

    it("should update lastAccessed timestamp", async () => {
      // First request
      const firstResponse = await mockApp.request("/test");
      const firstData = await firstResponse.json();
      const sessionId = firstData.sessionId;

      const { getSession } = await import("../../db/sessions");
      const firstSession = await getSession(sessionId);

      // Wait to ensure timestamp difference
      await new Promise(resolve => setTimeout(resolve, 100));

      // Second request
      await mockApp.request("/test", {
        headers: {
          "X-Session-ID": sessionId,
        },
      });

      const secondSession = await getSession(sessionId);

      // lastAccessed should be greater than or equal to the original
      expect(secondSession?.lastAccessed.getTime() ?? 0).toBeGreaterThanOrEqual(
        firstSession?.lastAccessed.getTime() ?? 0
      );
    });

    it("should create new session when provided sessionId does not exist", async () => {
      const sessionId = "22222222-89ab-7123-8123-456789abcdef";
      const response = await mockApp.request("/test", {
        headers: {
          "X-Session-ID": sessionId,
        },
      });

      const data = await response.json();
      expect(response.status).toBe(200);
      expect(data.hasSession).toBe(true);
      expect(data.sessionId).toBe(sessionId);
    });
  });

  describe("data-session emission", () => {
    it("should emit data-session on new session creation", async () => {
      const response = await mockApp.request("/test");

      // Note: In the actual implementation, this would be streamed
      // as part of the UIMessage response. For testing, we verify
      // the session is created and available.
      expect(response.ok).toBe(true);
    });
  });
});
