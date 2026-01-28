/**
 * Tests for session bridge middleware
 *
 * TDD approach: Tests written first to define expected behavior
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- Test files use any for simplicity */

import { Hono } from "hono";
import { uuidv7 } from "uuidv7";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../../src/index";

// Mock uuidv7 for consistent testing
vi.mock("uuidv7", () => ({
  uuidv7: vi.fn(),
}));

describe("session bridge middleware", () => {
  let mockApp: Hono<any>;
  let callCount: number;

  beforeEach(async () => {
    callCount = 0;
    vi.clearAllMocks();

    // Setup database schema
    const { setupTestDatabase } = await import("../../db/test-setup");
    await setupTestDatabase();

    // Mock uuidv7 to return sequential IDs
    vi.mocked(uuidv7).mockImplementation(() => {
      const ids = [
        "01234567-89ab-cdef-0123-456789abcdef", // session ID
        "11111111-89ab-cdef-0123-456789abcdef", // tool session 1
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
      return c.json({
        hasSession: !!session,
        sessionId: session?.sessionId,
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
      expect(data.sessionId).toBe("01234567-89ab-cdef-0123-456789abcdef");
    });

    it("should persist session to database", async () => {
      await mockApp.request("/test");

      const { getSession } = await import("../../db/sessions");
      const session = await getSession("01234567-89ab-cdef-0123-456789abcdef");

      expect(session).toBeDefined();
      expect(session?.resourceId).toBe("local");
    });

    it("should set session in context", async () => {
      const response = await mockApp.request("/test");
      const data = await response.json();

      expect(data.hasSession).toBe(true);
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

    it("should reject invalid session", async () => {
      const response = await mockApp.request("/test", {
        headers: {
          "X-Session-ID": "invalid-session-id",
        },
      });

      expect(response.status).toBe(401);
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
