/**
 * Tests for session manager
 *
 * These tests validate the multi-session management with
 * persistence and lifecycle handling.
 */

import { SessionManager } from "@/session/manager";
import { SessionConfig } from "@/session/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

describe("session/manager", () => {
  let mockManager: SessionManager;
  let mockCheckpointDir: string;

  beforeEach(() => {
    mockCheckpointDir = "/tmp/test-checkpoints";

    // Create mock db
    const mockDb: ConstructorParameters<typeof SessionManager>[0] = {
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockResolvedValue(undefined),
      }),
      query: {
        sessions: {
          findMany: vi.fn().mockResolvedValue([]),
          findFirst: vi.fn().mockResolvedValue(undefined),
        },
      },
    };

    // Create manager with mock db
    mockManager = new SessionManager(mockDb, mockCheckpointDir);
  });

  describe("constructor", () => {
    it("should create manager with db and checkpoint dir", () => {
      expect(mockManager).toBeDefined();
    });
  });

  describe("initialize", () => {
    it("should initialize and load sessions from db", async () => {
      await mockManager.initialize();

      expect(mockManager.getSessionCount()).toBe(0);
    });
  });

  describe("createSession", () => {
    it("should create a new session", async () => {
      const config: SessionConfig = {
        resourceId: "local",
        task: "Test task",
        workspace: "/test/workspace",
      };

      const sessionId = await mockManager.createSession(config);

      expect(sessionId).toBeDefined();
      expect(typeof sessionId).toBe("string");
    });

    it("should increment session count after creation", async () => {
      const config: SessionConfig = {
        resourceId: "local",
        task: "Test task",
        workspace: "/test/workspace",
      };

      await mockManager.createSession(config);

      expect(mockManager.getSessionCount()).toBe(1);
    });
  });

  describe("getSession", () => {
    it("should return undefined for non-existent session", async () => {
      const session = await mockManager.getSession("non-existent");

      expect(session).toBeUndefined();
    });
  });

  describe("getActiveSessions", () => {
    it("should return empty array initially", () => {
      const active = mockManager.getActiveSessions();

      expect(active).toEqual([]);
    });

    it("should return sessions with incomplete work", async () => {
      const config: SessionConfig = {
        resourceId: "local",
        task: "Test task",
        workspace: "/test/workspace",
      };

      await mockManager.createSession(config);

      // Sessions start in idle phase with no incomplete work
      const active = mockManager.getActiveSessions();
      expect(active.length).toBe(0);
    });

    it("should include running sessions in active sessions", async () => {
      const config: SessionConfig = {
        resourceId: "local",
        task: "Test task",
        workspace: "/test/workspace",
      };

      const sessionId = await mockManager.createSession(config);
      const session = await mockManager.getSession(sessionId);
      expect(session).toBeDefined();

      (session as unknown as { currentPhase: string }).currentPhase = "running";

      const active = mockManager.getActiveSessions();
      expect(active.length).toBe(1);
      expect(active[0]?.sessionId).toBe(sessionId);
    });
  });

  describe("getSessionCount", () => {
    it("should return 0 initially", () => {
      expect(mockManager.getSessionCount()).toBe(0);
    });
  });
});
