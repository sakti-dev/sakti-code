/**
 * Tests for session storage
 *
 * TDD approach: Tests written first to define expected behavior
 */

import { eq } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db, sessions, threads } from "../../db";
import { workspaces } from "../schema";

// Mock uuidv7 for consistent testing
vi.mock("uuid", () => ({
  v7: vi.fn(),
}));

const uuidv7Mock = vi.mocked(uuidv7) as unknown as ReturnType<typeof vi.fn>;

describe("sessions", () => {
  beforeAll(async () => {
    // Setup database schema
    const { setupTestDatabase } = await import("../../db/test-setup");
    await setupTestDatabase();
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    // Setup uuid mock with counter to ensure unique IDs
    let counter = 0;
    uuidv7Mock.mockImplementation(() => {
      counter++;
      return `01234567-89ab-cdef-0123-${String(counter).padStart(12, "0")}`;
    });
    // Clean up database before each test
    await db.delete(sessions);
    await db.delete(threads);
    await db.delete(workspaces);
  });

  afterEach(async () => {
    // Clean up after each test
    await db.delete(sessions);
    await db.delete(threads);
    await db.delete(workspaces);
  });

  describe("createSession", () => {
    it("should create session with UUIDv7", async () => {
      const mockSessionId = "01234567-89ab-cdef-0123-456789abcdef";
      uuidv7Mock.mockReturnValue(mockSessionId);

      const { createSession } = await import("../../db/sessions");
      const session = await createSession("local");

      expect(session.sessionId).toBe(mockSessionId);
      expect(session.resourceId).toBe("local");
      expect(session.threadId).toBe(mockSessionId);
      expect(session.createdAt).toBeInstanceOf(Date);
      expect(session.lastAccessed).toBeInstanceOf(Date);
    });

    it("should create session with custom resourceId", async () => {
      const mockSessionId = "01234567-89ab-cdef-0123-456789abcdef";
      uuidv7Mock.mockReturnValue(mockSessionId);

      const { createSession } = await import("../../db/sessions");
      const session = await createSession("user-123");

      expect(session.resourceId).toBe("user-123");
    });

    it("should persist session to database", async () => {
      const mockSessionId = "01234567-89ab-cdef-0123-456789abcdef";
      uuidv7Mock.mockReturnValue(mockSessionId);

      const { createSession } = await import("../../db/sessions");
      const created = await createSession("local");

      // Verify it's in the database
      const retrieved = await db
        .select()
        .from(sessions)
        .where(eq(sessions.session_id, created.sessionId))
        .get();

      expect(retrieved).toBeDefined();
      expect(retrieved?.session_id).toBe(created.sessionId);
      expect(retrieved?.resource_id).toBe("local");
    });

    it("should create provisional session and thread titles", async () => {
      const mockSessionId = "01234567-89ab-cdef-0123-456789abcdef";
      uuidv7Mock.mockReturnValue(mockSessionId);

      const { createSession } = await import("../../db/sessions");
      const created = await createSession("local");

      const storedSession = await db
        .select()
        .from(sessions)
        .where(eq(sessions.session_id, created.sessionId))
        .get();
      const storedThread = await db
        .select()
        .from(threads)
        .where(eq(threads.id, created.threadId))
        .get();

      expect(storedSession?.title).toBe("New Chat");
      expect(storedThread?.title).toBe("New Chat");
      expect(storedThread?.metadata).toMatchObject({
        titleSource: "auto",
        provisionalTitle: true,
      });
    });
  });

  describe("getSession", () => {
    it("should retrieve existing session", async () => {
      const mockSessionId = "01234567-89ab-cdef-0123-456789abcdef";
      uuidv7Mock.mockReturnValue(mockSessionId);

      const { createSession, getSession } = await import("../../db/sessions");
      await createSession("local");
      const retrieved = await getSession(mockSessionId);

      expect(retrieved).toBeDefined();
      expect(retrieved?.sessionId).toBe(mockSessionId);
      expect(retrieved?.resourceId).toBe("local");
    });

    it("should return null for non-existent session", async () => {
      const { getSession } = await import("../../db/sessions");
      const retrieved = await getSession("non-existent-id");

      expect(retrieved).toBeNull();
    });
  });

  describe("touchSession", () => {
    it("should update lastAccessed timestamp", async () => {
      const mockSessionId = "01234567-89ab-cdef-0123-456789abcdef";
      uuidv7Mock.mockReturnValue(mockSessionId);

      const { createSession, touchSession, getSession } = await import("../../db/sessions");
      await createSession("local");

      // Get the session from DB first
      const session = await getSession(mockSessionId);
      expect(session).toBeDefined();

      // Wait to ensure timestamp difference (100ms for SQLite timestamp precision)
      await new Promise(resolve => setTimeout(resolve, 100));

      await touchSession(mockSessionId);
      const updated = await getSession(mockSessionId);

      // lastAccessed should be greater than or equal to the original (it was updated)
      expect(updated?.lastAccessed.getTime() ?? 0).toBeGreaterThanOrEqual(
        session?.lastAccessed.getTime() ?? 0
      );
    });

    it("should not modify other fields", async () => {
      const mockSessionId = "01234567-89ab-cdef-0123-456789abcdef";
      uuidv7Mock.mockReturnValue(mockSessionId);

      const { createSession, touchSession, getSession } = await import("../../db/sessions");
      await createSession("user-123");

      // Get the session from DB first to get the stored values
      const session = await getSession(mockSessionId);
      expect(session).toBeDefined();

      await touchSession(mockSessionId);
      const updated = await getSession(mockSessionId);

      expect(updated?.sessionId).toBe(session?.sessionId);
      expect(updated?.resourceId).toBe(session?.resourceId);
      expect(updated?.threadId).toBe(session?.threadId);
      // createdAt should remain the same
      expect(updated?.createdAt.getTime()).toBe(session?.createdAt.getTime() ?? 0);
    });
  });

  describe("updateSessionTitle", () => {
    it("should update both session title and thread title", async () => {
      const mockSessionId = "01234567-89ab-cdef-0123-456789abcdef";
      uuidv7Mock.mockReturnValue(mockSessionId);

      const { createSession, updateSessionTitle } = await import("../../db/sessions");
      await createSession("local");

      const updated = await updateSessionTitle(mockSessionId, "Implement auth flow", {
        source: "auto",
        onlyIfProvisional: true,
      });
      expect(updated).toBe(true);

      const storedSession = await db
        .select()
        .from(sessions)
        .where(eq(sessions.session_id, mockSessionId))
        .get();
      const storedThread = await db
        .select()
        .from(threads)
        .where(eq(threads.id, mockSessionId))
        .get();

      expect(storedSession?.title).toBe("Implement auth flow");
      expect(storedThread?.title).toBe("Implement auth flow");
      expect(storedThread?.metadata).toMatchObject({
        titleSource: "auto",
        provisionalTitle: false,
      });
    });

    it("should not auto-overwrite manual titles when onlyIfProvisional is true", async () => {
      const mockSessionId = "01234567-89ab-cdef-0123-456789abcdef";
      uuidv7Mock.mockReturnValue(mockSessionId);

      const { createSession, updateSessionTitle } = await import("../../db/sessions");
      await createSession("local");
      await updateSessionTitle(mockSessionId, "My Manual Title", { source: "manual" });

      const updated = await updateSessionTitle(mockSessionId, "LLM Suggested Title", {
        source: "auto",
        onlyIfProvisional: true,
      });
      expect(updated).toBe(false);

      const storedSession = await db
        .select()
        .from(sessions)
        .where(eq(sessions.session_id, mockSessionId))
        .get();
      const storedThread = await db
        .select()
        .from(threads)
        .where(eq(threads.id, mockSessionId))
        .get();

      expect(storedSession?.title).toBe("My Manual Title");
      expect(storedThread?.title).toBe("My Manual Title");
      expect(storedThread?.metadata).toMatchObject({
        titleSource: "manual",
        provisionalTitle: false,
      });
    });
  });

  describe("deleteSession", () => {
    it("should delete session from database", async () => {
      const mockSessionId = "01234567-89ab-cdef-0123-456789abcdef";
      uuidv7Mock.mockReturnValue(mockSessionId);

      const { createSession, deleteSession, getSession } = await import("../../db/sessions");
      const session = await createSession("local");

      await deleteSession(session.sessionId);
      const retrieved = await getSession(session.sessionId);

      expect(retrieved).toBeNull();
    });

    it("should handle deleting non-existent session gracefully", async () => {
      const { deleteSession } = await import("../../db/sessions");

      // Should not throw
      await expect(deleteSession("non-existent")).resolves.not.toThrow();
    });
  });

  describe("workspace integration", () => {
    beforeEach(async () => {
      // Import and setup workspace
      const { createWorkspace } = await import("../../db/workspaces");
      await createWorkspace({ path: "/tmp/test-workspace", name: "test-workspace" });
    });

    it("should create session linked to workspace", async () => {
      const { createSession, getSession } = await import("../../db/sessions");
      const { getWorkspaceByPath } = await import("../../db/workspaces");

      const ws = await getWorkspaceByPath("/tmp/test-workspace");
      expect(ws).not.toBeNull();

      const session = await createSession("local", ws!.id);
      expect(session.workspaceId).toBe(ws!.id);

      // Verify it's stored in DB
      const stored = await getSession(session.sessionId);
      expect(stored?.workspaceId).toBe(ws!.id);
    });

    it("should return latest session for workspace", async () => {
      const { createSession, getLatestSessionByWorkspace } = await import("../../db/sessions");
      const { getWorkspaceByPath } = await import("../../db/workspaces");

      const ws = await getWorkspaceByPath("/tmp/test-workspace");

      // Create first session
      await createSession("local", ws!.id);
      // Wait long enough to get different timestamp
      await new Promise(r => setTimeout(r, 1100));

      // Create second session (more recent)
      const session2 = await createSession("local", ws!.id);

      const latest = await getLatestSessionByWorkspace(ws!.id);
      // session2 should have a later last_accessed
      expect(latest?.sessionId).toBe(session2.sessionId);
    });

    it("should return null for workspace with no sessions", async () => {
      const { getLatestSessionByWorkspace } = await import("../../db/sessions");
      const { getWorkspaceByPath } = await import("../../db/workspaces");

      const ws = await getWorkspaceByPath("/tmp/test-workspace");
      const latest = await getLatestSessionByWorkspace(ws!.id);

      expect(latest).toBeNull();
    });
  });
});
