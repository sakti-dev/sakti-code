/**
 * Tests for search-docs main tool
 *
 * Tests the complete DRA workflow orchestration:
 * - Query parsing (package, version, question)
 * - Session management (create, resume, clear)
 * - Repository caching
 * - Sub-agent delegation
 * - Structured output
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- Test files use any for simplicity */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClonedRepo } from "@/tools/search-docs/session-store";

// Mock uuid
vi.mock("uuid", () => ({
  v7: vi.fn(() => "test-uuid-v7"),
}));

// Mock the sub-agent manager
const mockSubAgentRun = vi.fn();

vi.mock("@/tools/search-docs/sub-agent", () => ({
  getSubAgentManager: vi.fn(() => ({
    getOrCreate: vi.fn(async () => ({
      run: mockSubAgentRun,
    })),
  })),
}));

// Mock git manager
type MockCloneResult = {
  success: boolean;
  path?: string;
  commit?: string;
  error?: {
    code: string;
    message: string;
    hint?: string;
  };
};

const mockCloneResult: MockCloneResult = {
  success: true,
  path: "/tmp/cloned-repo",
  commit: "abc123def456",
};

vi.mock("@/tools/search-docs/git-manager", () => ({
  getGitManager: vi.fn(() => ({
    buildResourceKey: vi.fn(() => "test-resource-key"),
    clone: vi.fn(async () => mockCloneResult),
    fetchTags: vi.fn(async () => ["v4.38.3", "v4.37.1", "v3.0.0"]),
    resolveVersion: vi.fn((version: string) => version || "main"),
    validateUrl: vi.fn(() => true),
  })),
}));

// Mock session store
const mockSessionStore: any = {
  getOrCreateSession: vi.fn(),
  deleteSession: vi.fn(),
  getRepo: vi.fn(() => undefined as ClonedRepo | undefined), // Default: not cached
  addRepo: vi.fn(),
};

vi.mock("@/tools/search-docs/session-store", () => ({
  getSessionStore: vi.fn(() => mockSessionStore),
}));

describe("search-docs", () => {
  let createSearchDocsTool: any;
  let searchDocs: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Set up default mock for sub-agent research result
    // Dynamic response based on query
    mockSubAgentRun.mockImplementation((query: string) => {
      if (query.includes("invoke")) {
        return Promise.resolve({
          summary: "In XState v4, invoke callbacks are used for async services...",
          evidence: [
            {
              file: "packages/core/src/invoke.ts",
              excerpt: "export function invoke() { /* implementation */ }",
              relevance: "Direct source",
            },
          ],
        });
      }
      return Promise.resolve({
        summary:
          "In XState v4, the actor function is used to spawn and communicate with state machine actors...",
        evidence: [
          {
            file: "packages/core/src/actor.ts",
            excerpt: "export function actor(...) { /* implementation */ }",
            relevance: "Direct source",
          },
          {
            file: "packages/core/src/types.ts",
            excerpt: "interface Actor { ... }",
            relevance: "Type definition",
          },
        ],
      });
    });

    // Import the module after mocks are set up
    const module = await import("@/tools/search-docs/search-docs");
    createSearchDocsTool = module.createSearchDocsTool;
    searchDocs = module.searchDocs;
  });

  describe("createSearchDocsTool", () => {
    it("creates a tool with proper structure", () => {
      const tool = createSearchDocsTool();

      expect(tool).toBeDefined();
      expect(tool.description).toBeDefined();
      expect(tool.execute).toBeDefined();
      expect(typeof tool.execute).toBe("function");
    });

    it("accepts initial sessionId option", () => {
      const tool = createSearchDocsTool({ sessionId: "initial-session-id" });

      expect(tool).toBeDefined();
    });
  });

  describe("query parsing", () => {
    it("parses package name from query", async () => {
      const tool = createSearchDocsTool();

      const result = await tool.execute({
        query: "xstate actor usage",
      });

      // Should successfully identify and process the package
      expect(result).toHaveProperty("sessionId");
      expect(result).toHaveProperty("findings");
    });

    it("parses version from query", async () => {
      const tool = createSearchDocsTool();

      const result = await tool.execute({
        query: "xstate v4 actor usage",
      });

      expect(result.metadata.branch).toBeDefined();
    });

    it("handles scoped package names", async () => {
      const tool = createSearchDocsTool();

      const result = await tool.execute({
        query: "@ai-sdk/zai how to use generateText",
      });

      expect(result).toHaveProperty("findings");
    });
  });

  describe("session management", () => {
    it("creates a new session when no sessionId provided", async () => {
      const tool = createSearchDocsTool();

      const result = await tool.execute({
        query: "xstate actor",
      });

      expect(result.sessionId).toBeDefined();
      expect(mockSessionStore.getOrCreateSession).toHaveBeenCalled();
    });

    it("reuses existing session when sessionId provided", async () => {
      const tool = createSearchDocsTool();
      const existingSessionId = "existing-session-123";

      const result = await tool.execute({
        query: "xstate actor",
        sessionId: existingSessionId,
      });

      expect(result.sessionId).toBe(existingSessionId);
    });

    it("clears session when clearSession flag is set", async () => {
      const tool = createSearchDocsTool();
      const existingSessionId = "existing-session-123";

      await tool.execute({
        query: "xstate actor",
        sessionId: existingSessionId,
        clearSession: true,
      });

      expect(mockSessionStore.deleteSession).toHaveBeenCalledWith(existingSessionId);
    });
  });

  describe("repository caching", () => {
    it("clones repository on first query", async () => {
      // Mock that repo is not cached
      mockSessionStore.getRepo.mockReturnValue(undefined);

      const tool = createSearchDocsTool();

      const result = await tool.execute({
        query: "xstate actor",
      });

      expect(result.cached).toBe(false);
      expect(mockSessionStore.addRepo).toHaveBeenCalled();
    });

    it("reuses cached repository for subsequent queries", async () => {
      // Mock that repo is already cached
      const cachedRepo = {
        resourceKey: "cached-repo",
        url: "https://github.com/statelyai/xstate",
        branch: "v4.38.3",
        localPath: "/tmp/cached-xstate",
        clonedAt: Date.now() - 10000, // 10 seconds ago
        lastUpdated: Date.now(),
        searchPaths: [],
        metadata: { commit: "abc123" },
      };

      mockSessionStore.getRepo.mockReturnValue(cachedRepo);

      const tool = createSearchDocsTool();

      const result = await tool.execute({
        query: "xstate actor",
        sessionId: "cached-session",
      });

      expect(result.cached).toBe(true);
      // Should not call addRepo again
      expect(mockSessionStore.addRepo).not.toHaveBeenCalled();
    });
  });

  describe("sub-agent delegation", () => {
    it("delegates research to sub-agent", async () => {
      mockSessionStore.getRepo.mockReturnValue(undefined);

      const tool = createSearchDocsTool();

      await tool.execute({
        query: "xstate v4 how to use actor",
      });

      expect(mockSubAgentRun).toHaveBeenCalledWith("how to use actor");
    });

    it("passes extracted question to sub-agent", async () => {
      mockSessionStore.getRepo.mockReturnValue(undefined);

      const tool = createSearchDocsTool();

      await tool.execute({
        query: "React hooks useState types",
      });

      const callArgs = mockSubAgentRun.mock.calls[0][0];
      expect(callArgs).toContain("hooks");
      expect(callArgs).toContain("useState");
    });
  });

  describe("structured output", () => {
    it("returns sessionId in output", async () => {
      mockSessionStore.getRepo.mockReturnValue(undefined);

      const tool = createSearchDocsTool();

      const result = await tool.execute({
        query: "xstate actor",
      });

      expect(result.sessionId).toBeDefined();
      expect(typeof result.sessionId).toBe("string");
    });

    it("returns AI-generated findings", async () => {
      mockSessionStore.getRepo.mockReturnValue(undefined);

      const tool = createSearchDocsTool();

      const result = await tool.execute({
        query: "xstate actor",
      });

      expect(result.findings).toBeDefined();
      expect(typeof result.findings).toBe("string");
      expect(result.findings.length).toBeGreaterThan(0);
    });

    it("returns supporting evidence", async () => {
      mockSessionStore.getRepo.mockReturnValue(undefined);

      const tool = createSearchDocsTool();

      const result = await tool.execute({
        query: "xstate actor",
      });

      expect(result.evidence).toBeDefined();
      expect(Array.isArray(result.evidence)).toBe(true);
      expect(result.evidence.length).toBeGreaterThan(0);

      const firstEvidence = result.evidence[0];
      expect(firstEvidence.file).toBeDefined();
      expect(firstEvidence.excerpt).toBeDefined();
      expect(firstEvidence.relevance).toBeDefined();
    });

    it("returns metadata about repository", async () => {
      mockSessionStore.getRepo.mockReturnValue(undefined);

      const tool = createSearchDocsTool();

      const result = await tool.execute({
        query: "xstate v4.38.3 actor",
      });

      expect(result.metadata).toBeDefined();
      expect(result.metadata.repository).toBeDefined();
      expect(result.metadata.branch).toBeDefined();
      expect(result.metadata.commit).toBeDefined();
    });
  });

  describe("error handling", () => {
    it("throws error when package name cannot be identified", async () => {
      const tool = createSearchDocsTool();

      // Use a query that results in an empty package name
      // The parseQuery regex pattern requires at least some alphanumeric chars
      await expect(
        tool.execute({
          query: "   ", // Only whitespace - no package
        })
      ).rejects.toThrow("Could not identify package name");
    });

    it("throws error when clone fails", async () => {
      // Mock clone failure
      mockCloneResult.success = false;
      mockCloneResult.error = {
        code: "CLONE_FAILED",
        message: "Repository not found",
        hint: "Check the URL",
      };

      const tool = createSearchDocsTool();

      await expect(
        tool.execute({
          query: "nonexistent-repo-xyz-123 usage",
        })
      ).rejects.toThrow("Failed to clone repository");

      // Reset for other tests
      mockCloneResult.success = true;
      delete mockCloneResult.error;
    });
  });

  describe("integration: complete workflow", () => {
    it("demonstrates end-to-end research workflow", async () => {
      mockSessionStore.getRepo.mockReturnValue(undefined);

      const tool = createSearchDocsTool();

      // First query - clones repo
      const result1 = await tool.execute({
        query: "xstate v4 how to use actor",
      });

      expect(result1.sessionId).toBeDefined();
      expect(result1.findings).toContain("actor");
      expect(result1.evidence.length).toBeGreaterThan(0);
      expect(result1.cached).toBe(false);

      // Follow-up query - reuses session
      const result2 = await tool.execute({
        query: "xstate what about invoke callbacks",
        sessionId: result1.sessionId,
      });

      expect(result2.sessionId).toBe(result1.sessionId);
      expect(result2.findings).toContain("invoke");
    });
  });

  describe("default export", () => {
    it("exports default searchDocs tool instance", () => {
      expect(searchDocs).toBeDefined();
      expect(searchDocs.description).toBeDefined();
      expect(searchDocs.execute).toBeDefined();
    });
  });
});
