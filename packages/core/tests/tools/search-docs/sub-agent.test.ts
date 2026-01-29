/**
 * Tests for sub-agent
 *
 * Tests the Discovery & Research Agent (DRA) factory and manager:
 * - Code research agent creation
 * - Sub-agent session management
 * - Evidence extraction from tool calls
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- Test files use any for simplicity */

import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the AI SDK generateText function
const mockGenerateText = vi.fn();

vi.mock("ai", () => ({
  generateText: mockGenerateText,
}));

// Mock @ai-sdk/zai
vi.mock("@ai-sdk/zai", () => ({
  createZai: vi.fn(() => (modelId: string) => ({ modelId })),
}));

// Mock the tool factories
vi.mock("../../../src/tools/search-docs/ast-query", () => ({
  createAstQueryTool: vi.fn(() => ({
    description: "Mock AST query tool",
  })),
}));

vi.mock("../../../src/tools/search-docs/grep-search", () => ({
  createGrepSearchTool: vi.fn(() => ({
    description: "Mock grep search tool",
  })),
}));

vi.mock("../../../src/tools/search-docs/file-read", () => ({
  createFileReadTool: vi.fn(() => ({
    description: "Mock file read tool",
  })),
}));

describe("sub-agent", () => {
  let createCodeResearchAgent: any;
  let getSubAgentManager: any;
  let resetSubAgentManager: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Set up default mock behavior for generateText
    mockGenerateText.mockResolvedValue({
      text: "Based on the code analysis, the actor function in XState v4 is used for...",
      steps: [
        {
          stepType: "tools",
          toolCalls: [
            {
              toolName: "file_read",
              args: { path: "src/actor.ts" },
              result: {
                content: "export function actor() { /* implementation */ }",
              },
            },
            {
              toolName: "ast_query",
              args: { query: "actor" },
              result: {
                signature: "function actor(): void",
              },
            },
          ],
        },
      ],
      messages: [],
    });

    // Import the module after mocks are set up
    const module = await import("../../../src/tools/search-docs/sub-agent");
    createCodeResearchAgent = module.createCodeResearchAgent;
    getSubAgentManager = module.getSubAgentManager;
    resetSubAgentManager = module.resetSubAgentManager;
  });

  afterEach(() => {
    resetSubAgentManager?.();
  });

  describe("createCodeResearchAgent", () => {
    it("creates a code research agent for a repository", async () => {
      const mockRepo = {
        resourceKey: "test-repo-main",
        url: "https://github.com/test/repo",
        branch: "main",
        localPath: "/tmp/test-repo",
        clonedAt: Date.now(),
        lastUpdated: Date.now(),
        searchPaths: [],
        metadata: {},
      };

      const agent = await createCodeResearchAgent({
        repo: mockRepo,
        sessionId: "test-session-123",
      });

      expect(agent).toBeDefined();
      expect(typeof agent.run).toBe("function");
    });

    it("runs a research query and returns structured results", async () => {
      const mockRepo = {
        resourceKey: "test-repo-main",
        url: "https://github.com/test/repo",
        branch: "main",
        localPath: "/tmp/test-repo",
        clonedAt: Date.now(),
        lastUpdated: Date.now(),
        searchPaths: [],
        metadata: {},
      };

      const agent = await createCodeResearchAgent({
        repo: mockRepo,
        sessionId: "test-session-123",
      });

      const result = await agent.run("How does the actor function work?");

      expect(result.summary).toBeDefined();
      expect(typeof result.summary).toBe("string");
      expect(result.evidence).toBeDefined();
      expect(Array.isArray(result.evidence)).toBe(true);
    });

    it("extracts evidence from file_read tool calls", async () => {
      const mockRepo = {
        resourceKey: "test-repo-main",
        url: "https://github.com/test/repo",
        branch: "main",
        localPath: "/tmp/test-repo",
        clonedAt: Date.now(),
        lastUpdated: Date.now(),
        searchPaths: [],
        metadata: {},
      };

      const agent = await createCodeResearchAgent({
        repo: mockRepo,
        sessionId: "test-session-123",
      });

      const result = await agent.run("Show me the implementation");

      // Check that evidence was extracted from file_read calls
      const fileReadEvidence = result.evidence.filter(
        (e: { relevance: string }) => e.relevance === "Direct source"
      );

      expect(fileReadEvidence.length).toBeGreaterThan(0);
      expect(fileReadEvidence[0]).toHaveProperty("file");
      expect(fileReadEvidence[0]).toHaveProperty("excerpt");
    });
  });

  describe("SubAgentManager", () => {
    it("returns a singleton instance", () => {
      const manager1 = getSubAgentManager();
      const manager2 = getSubAgentManager();

      expect(manager1).toBe(manager2);
    });

    it("caches sub-agent instances per repository", async () => {
      const manager = getSubAgentManager();
      const mockRepo = {
        resourceKey: "cached-repo-main",
        url: "https://github.com/test/repo",
        branch: "main",
        localPath: "/tmp/test-repo",
        clonedAt: Date.now(),
        lastUpdated: Date.now(),
        searchPaths: [],
        metadata: {},
      };

      const agent1 = await manager.getOrCreate({
        repo: mockRepo,
        sessionId: "test-session",
      });

      const agent2 = await manager.getOrCreate({
        repo: mockRepo,
        sessionId: "test-session",
      });

      // Should return the same cached instance
      expect(agent1).toBe(agent2);
    });

    it("creates different agents for different repositories", async () => {
      const manager = getSubAgentManager();
      const mockRepo1 = {
        resourceKey: "repo-1-main",
        url: "https://github.com/test/repo1",
        branch: "main",
        localPath: "/tmp/repo1",
        clonedAt: Date.now(),
        lastUpdated: Date.now(),
        searchPaths: [],
        metadata: {},
      };

      const mockRepo2 = {
        resourceKey: "repo-2-main",
        url: "https://github.com/test/repo2",
        branch: "main",
        localPath: "/tmp/repo2",
        clonedAt: Date.now(),
        lastUpdated: Date.now(),
        searchPaths: [],
        metadata: {},
      };

      const agent1 = await manager.getOrCreate({
        repo: mockRepo1,
        sessionId: "test-session",
      });

      const agent2 = await manager.getOrCreate({
        repo: mockRepo2,
        sessionId: "test-session",
      });

      // Should return different instances
      expect(agent1).not.toBe(agent2);
    });

    it("clears all cached agents", async () => {
      const manager = getSubAgentManager();
      const mockRepo = {
        resourceKey: "clearable-repo-main",
        url: "https://github.com/test/repo",
        branch: "main",
        localPath: "/tmp/test-repo",
        clonedAt: Date.now(),
        lastUpdated: Date.now(),
        searchPaths: [],
        metadata: {},
      };

      await manager.getOrCreate({
        repo: mockRepo,
        sessionId: "test-session",
      });

      manager.clear();

      // After clearing, should create a new instance
      const agent = await manager.getOrCreate({
        repo: mockRepo,
        sessionId: "test-session",
      });

      expect(agent).toBeDefined();
    });
  });

  describe("integration: agent workflow", () => {
    it("demonstrates complete research workflow", async () => {
      const mockRepo = {
        resourceKey: "integration-test-repo",
        url: "https://github.com/xstate/xstate",
        branch: "v4.38.3",
        localPath: "/tmp/xstate",
        clonedAt: Date.now(),
        lastUpdated: Date.now(),
        searchPaths: [],
        metadata: { commit: "abc123" },
      };

      const agent = await createCodeResearchAgent({
        repo: mockRepo,
        sessionId: "integration-session",
      });

      const result = await agent.run("How to use actor in XState v4?");

      // Verify structured output
      expect(result.summary).toContain("actor");
      expect(result.evidence.length).toBeGreaterThan(0);
      expect(result.evidence[0].file).toBeDefined();
      expect(result.evidence[0].excerpt).toBeDefined();
    });
  });
});
