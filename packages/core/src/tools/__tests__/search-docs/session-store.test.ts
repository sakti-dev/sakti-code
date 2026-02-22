/**
 * Tests for search-docs session store
 *
 * TDD approach: Tests written first to define expected behavior
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- Test files use any for simplicity */

import { beforeEach, describe, expect, it, vi } from "vitest";

describe("search-docs session store", () => {
  let sessionStore: any;
  let clearAllSessions: () => void;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Import the module after mocks are set up
    const module = await import("@/tools/search-docs/session-store");
    sessionStore = module.sessionStore;
    clearAllSessions = module.clearAllSessions;

    // Clear all sessions before each test for isolation
    clearAllSessions();
  });

  describe("session lifecycle", () => {
    it("creates new session when sessionId not provided", () => {
      const session = sessionStore.getOrCreateSession();

      expect(session.id).toBeDefined();
      expect(session.createdAt).toBeLessThanOrEqual(Date.now());
      expect(session.lastAccessed).toBeLessThanOrEqual(Date.now());
      expect(session.repos).toBeInstanceOf(Map);
      expect(session.subAgentIdsByRepo).toBeInstanceOf(Map);
    });

    it("returns existing session when sessionId provided", () => {
      const first = sessionStore.getOrCreateSession();
      const second = sessionStore.getOrCreateSession(first.id);

      expect(second.id).toBe(first.id);
      expect(second.createdAt).toBe(first.createdAt);
    });

    it("updates lastAccessed on session retrieval", async () => {
      const session = sessionStore.getOrCreateSession();
      const originalAccessTime = session.lastAccessed;

      // Wait a bit to ensure timestamp difference
      await new Promise(resolve => setTimeout(resolve, 10));

      sessionStore.touchSession(session.id);

      // getOrCreateSession also updates lastAccessed, so use it to retrieve
      const retrieved = sessionStore.getOrCreateSession(session.id);
      expect(retrieved.lastAccessed).toBeGreaterThan(originalAccessTime);
    });

    it("deletes session when requested", () => {
      const session = sessionStore.getOrCreateSession();
      expect(sessionStore.hasSession(session.id)).toBe(true);

      sessionStore.deleteSession(session.id);
      expect(sessionStore.hasSession(session.id)).toBe(false);
    });

    it("clears all sessions", () => {
      sessionStore.getOrCreateSession();
      sessionStore.getOrCreateSession();
      sessionStore.getOrCreateSession();

      expect(sessionStore.getSessionCount()).toBe(3);

      clearAllSessions();
      expect(sessionStore.getSessionCount()).toBe(0);
    });
  });

  describe("repo management", () => {
    it("stores cloned repo metadata", () => {
      const session = sessionStore.getOrCreateSession();

      const repo = {
        resourceKey: "https://github.com/vercel/ai#main",
        url: "https://github.com/vercel/ai",
        branch: "main",
        localPath: "/tmp/repos/vercel-ai-main",
        clonedAt: Date.now(),
        lastUpdated: Date.now(),
        searchPaths: ["packages/ai"],
        metadata: { commit: "abc123" },
      };

      sessionStore.addRepo(session.id, repo);

      const retrieved = sessionStore.getRepo(session.id, repo.resourceKey);
      expect(retrieved).toEqual(repo);
    });

    it("returns existing repo without duplicating", () => {
      const session = sessionStore.getOrCreateSession();

      const repo = {
        resourceKey: "test-repo",
        url: "https://github.com/test/repo",
        branch: "main",
        localPath: "/tmp/test",
        clonedAt: Date.now(),
        lastUpdated: Date.now(),
        searchPaths: [],
        metadata: {},
      };

      sessionStore.addRepo(session.id, repo);
      const retrieved = sessionStore.getRepo(session.id, "test-repo");

      expect(retrieved).toEqual(repo);
    });

    it("returns undefined for non-existent repo", () => {
      const session = sessionStore.getOrCreateSession();
      const repo = sessionStore.getRepo(session.id, "non-existent");
      expect(repo).toBeUndefined();
    });
  });

  describe("sub-agent management", () => {
    it("stores sub-agent ID per repo", () => {
      const session = sessionStore.getOrCreateSession();
      const resourceKey = "test-repo";
      const subAgentId = "agent-123";

      sessionStore.setSubAgent(session.id, resourceKey, subAgentId);

      const retrieved = sessionStore.getSubAgent(session.id, resourceKey);
      expect(retrieved).toBe(subAgentId);
    });

    it("returns undefined for non-existent sub-agent", () => {
      const session = sessionStore.getOrCreateSession();
      const agentId = sessionStore.getSubAgent(session.id, "non-existent");
      expect(agentId).toBeUndefined();
    });
  });

  describe("TTL cleanup", () => {
    it("removes expired sessions based on TTL", () => {
      const session = sessionStore.getOrCreateSession();

      // Manually set createdAt to past TTL
      const oldSession = sessionStore.getSession(session.id);
      if (oldSession) {
        oldSession.createdAt = Date.now() - 31 * 60 * 1000; // 31 minutes ago
      }

      sessionStore.cleanupExpired();

      expect(sessionStore.hasSession(session.id)).toBe(false);
    });

    it("keeps active sessions within TTL", () => {
      const session = sessionStore.getOrCreateSession();

      sessionStore.cleanupExpired();

      expect(sessionStore.hasSession(session.id)).toBe(true);
    });
  });

  describe("LRU eviction", () => {
    it("evicts least recently used session when at capacity", async () => {
      // Set max sessions to 3 for testing
      sessionStore.setMaxSessions(3);

      const session1 = sessionStore.getOrCreateSession();
      await new Promise(resolve => setTimeout(resolve, 10));

      const session2 = sessionStore.getOrCreateSession();
      await new Promise(resolve => setTimeout(resolve, 10));

      const session3 = sessionStore.getOrCreateSession();
      await new Promise(resolve => setTimeout(resolve, 10));

      // Access session1 and session2 to make them more recent
      sessionStore.touchSession(session1.id);
      await new Promise(resolve => setTimeout(resolve, 10));

      sessionStore.touchSession(session2.id);
      // Don't touch session3 - it's the least recently used

      // Add 4th session - should evict session3
      const session4 = sessionStore.getOrCreateSession();

      expect(sessionStore.hasSession(session1.id)).toBe(true);
      expect(sessionStore.hasSession(session2.id)).toBe(true);
      expect(sessionStore.hasSession(session3.id)).toBe(false); // Evicted
      expect(sessionStore.hasSession(session4.id)).toBe(true);
    });
  });
});
