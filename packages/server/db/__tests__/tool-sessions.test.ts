/**
 * Tests for tool session storage
 *
 * TDD approach: Tests written first to define expected behavior
 */

import { eq } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, taskSessions, toolSessions } from "../../db";

// Mock uuidv7 for consistent session ID
vi.mock("uuid", () => ({
  v7: vi.fn(),
}));

const uuidv7Mock = vi.mocked(uuidv7) as unknown as ReturnType<typeof vi.fn>;

describe("tool sessions", () => {
  let mockSessionId: string;
  let callCount: number;

  beforeAll(async () => {
    // Setup database schema
    const { setupTestDatabase } = await import("../../db/test-setup");
    await setupTestDatabase();
  });

  beforeEach(async () => {
    callCount = 0;
    vi.clearAllMocks();

    // Mock uuidv7 to return sequential IDs
    uuidv7Mock.mockImplementation(() => {
      const ids = [
        "01234567-89ab-cdef-0123-456789abcdef", // session ID
        "11111111-89ab-cdef-0123-456789abcdef", // tool session 1
        "22222222-89ab-cdef-0123-456789abcdef", // tool session 2
        "33333333-89ab-cdef-0123-456789abcdef", // tool session 3
        "44444444-89ab-cdef-0123-456789abcdef", // tool session 4
      ];
      return ids[callCount++] || `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`;
    });

    // Create a parent session first
    mockSessionId = "01234567-89ab-cdef-0123-456789abcdef";
    const { createTaskSessionWithId } = await import("../../db/task-sessions");
    await createTaskSessionWithId("local", mockSessionId);

    // Clean up tool sessions before each test
    await db.delete(toolSessions);
  });

  afterEach(async () => {
    // Clean up after each test
    await db.delete(toolSessions);
    await db.delete(taskSessions);
  });

  describe("getToolSession", () => {
    it("should create new tool session if not exists", async () => {
      const { getToolSession } = await import("../../db/tool-sessions");
      const toolSession = await getToolSession(mockSessionId, "test-tool");

      expect(toolSession.toolSessionId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
      expect(toolSession.sessionId).toBe(mockSessionId);
      expect(toolSession.toolName).toBe("test-tool");
      expect(toolSession.toolKey).toBe("");
      expect(toolSession.data).toBeNull();
      expect(toolSession.createdAt).toBeInstanceOf(Date);
      expect(toolSession.lastAccessed).toBeInstanceOf(Date);
    });

    it("should retrieve existing tool session", async () => {
      const { getToolSession } = await import("../../db/tool-sessions");
      const first = await getToolSession(mockSessionId, "test-tool", "key1");
      const second = await getToolSession(mockSessionId, "test-tool", "key1");

      expect(second.toolSessionId).toBe(first.toolSessionId);
    });

    it("should create separate sessions for different tool keys", async () => {
      const { getToolSession } = await import("../../db/tool-sessions");
      const first = await getToolSession(mockSessionId, "test-tool", "key1");
      const second = await getToolSession(mockSessionId, "test-tool", "key2");

      expect(first.toolSessionId).not.toBe(second.toolSessionId);
    });

    it("should create separate sessions for different tool names", async () => {
      const { getToolSession } = await import("../../db/tool-sessions");
      const first = await getToolSession(mockSessionId, "tool-a");
      const second = await getToolSession(mockSessionId, "tool-b");

      expect(first.toolSessionId).not.toBe(second.toolSessionId);
    });
  });

  describe("updateToolSession", () => {
    it("should update tool session data", async () => {
      const { getToolSession, updateToolSession } = await import("../../db/tool-sessions");
      const toolSession = await getToolSession(mockSessionId, "test-tool");

      const testData = { count: 42, name: "test" };
      await updateToolSession(toolSession.toolSessionId, testData);

      // Retrieve and verify
      const updated = await getToolSession(mockSessionId, "test-tool");
      expect(updated.data).toEqual(testData);
    });

    it("should replace existing data", async () => {
      const { getToolSession, updateToolSession } = await import("../../db/tool-sessions");
      const toolSession = await getToolSession(mockSessionId, "test-tool");

      await updateToolSession(toolSession.toolSessionId, { version: 1 });
      await updateToolSession(toolSession.toolSessionId, { version: 2 });

      const updated = await getToolSession(mockSessionId, "test-tool");
      expect(updated.data).toEqual({ version: 2 });
    });
  });

  describe("deleteToolSession", () => {
    it("should delete tool session", async () => {
      const { getToolSession, deleteToolSession } = await import("../../db/tool-sessions");
      const toolSession = await getToolSession(mockSessionId, "test-tool");

      await deleteToolSession(toolSession.toolSessionId);

      // Should create new session on next get
      const newSession = await getToolSession(mockSessionId, "test-tool");
      expect(newSession.toolSessionId).not.toBe(toolSession.toolSessionId);
    });

    it("should handle deleting non-existent session gracefully", async () => {
      const { deleteToolSession } = await import("../../db/tool-sessions");

      // Should not throw
      await expect(deleteToolSession("non-existent")).resolves.not.toThrow();
    });
  });

  describe("cascading deletes", () => {
    it("should delete tool sessions when parent session is deleted", async () => {
      const { getToolSession } = await import("../../db/tool-sessions");
      const toolSession = await getToolSession(mockSessionId, "test-tool");

      // Delete parent session
      const { deleteTaskSession } = await import("../../db/task-sessions");
      await deleteTaskSession(mockSessionId);

      // Tool session should be deleted due to CASCADE
      const result = await db
        .select()
        .from(toolSessions)
        .where(eq(toolSessions.tool_session_id, toolSession.toolSessionId))
        .get();

      expect(result).toBeUndefined();
    });
  });
});
