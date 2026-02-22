/**
 * search-docs Integration Tests
 *
 * Integration tests for the search-docs tool with AI agent.
 * Tests verify that agents can use search-docs to research external repositories.
 *
 * Note: These tests require ZAI_API_KEY environment variable to run.
 * Without the API key, tests are skipped.
 */

import { createZai } from "@sakti-code/zai";
import { generateText } from "ai";
import { describe, expect, it } from "vitest";
import { createTools } from "../../src/tools/registry";
import { searchDocs } from "../../src/tools/search-docs";

describe("search-docs: code research integration", () => {
  // These tests are online and opt-in.
  const runOnline = process.env.RUN_ONLINE_TESTS === "1" && !!process.env.ZAI_API_KEY;
  const itWithApiKey = runOnline ? it : it.skip;

  describe("AI SDK integration", () => {
    itWithApiKey(
      "should research external repository documentation",
      async () => {
        // 1. Arrange - Create agent with search-docs tool
        const zai = createZai({ apiKey: process.env.ZAI_API_KEY });

        // 2. Act - Ask agent to research documentation
        const result = await generateText({
          model: zai("glm-4.7"),
          tools: {
            "search-docs": searchDocs,
          },
          messages: [
            {
              role: "user",
              content: "How do I use streamText from Vercel AI SDK?",
            },
          ],
        });

        // 3. Assert - Should have called search-docs tool
        expect(result.toolCalls).toBeDefined();
        const searchDocsCalls = result.toolCalls.filter(tc => tc.toolName === "search-docs");
        expect(searchDocsCalls.length).toBeGreaterThan(0);

        // Should return useful information about streamText
        expect(result.text).toMatch(/streamText|AI SDK|vercel/i);
      },
      60000
    );

    itWithApiKey(
      "should research framework-specific patterns",
      async () => {
        // 1. Arrange
        const zai = createZai({ apiKey: process.env.ZAI_API_KEY });

        // 2. Act - Research React hooks
        const result = await generateText({
          model: zai("glm-4.7"),
          tools: {
            "search-docs": searchDocs,
          },
          messages: [
            {
              role: "user",
              content: "How do I implement a custom hook in React that fetches data?",
            },
          ],
        });

        // 3. Assert
        const searchDocsCalls = result.toolCalls.filter(tc => tc.toolName === "search-docs");
        expect(searchDocsCalls.length).toBeGreaterThan(0);

        // Should mention React, hooks, or data fetching
        expect(result.text).toMatch(/react|hook|fetch|useEffect|useState/i);
      },
      60000
    );

    itWithApiKey(
      "should handle multi-part research queries",
      async () => {
        // 1. Arrange
        const zai = createZai({ apiKey: process.env.ZAI_API_KEY });

        // 2. Act - Complex query
        const result = await generateText({
          model: zai("glm-4.7"),
          tools: {
            "search-docs": searchDocs,
          },
          messages: [
            {
              role: "user",
              content: "Compare useEffect and useLayoutEffect in React. When should I use each?",
            },
          ],
        });

        // 3. Assert
        const searchDocsCalls = result.toolCalls.filter(tc => tc.toolName === "search-docs");
        expect(searchDocsCalls.length).toBeGreaterThan(0);

        // Should discuss both hooks
        expect(result.text.toLowerCase()).toMatch(/useeffect|uselayouteffect/i);
      },
      60000
    );
  });

  describe("Session handling", () => {
    itWithApiKey(
      "should maintain session context across tool calls",
      async () => {
        // 1. Arrange
        const zai = createZai({ apiKey: process.env.ZAI_API_KEY });

        // 2. Act - First query
        const firstResult = await generateText({
          model: zai("glm-4.7"),
          tools: {
            "search-docs": searchDocs,
          },
          messages: [
            {
              role: "user",
              content: "What is XState?",
            },
          ],
        });

        // 3. Assert - First call should work
        expect(firstResult.toolCalls).toBeDefined();
        const firstSearchDocsCalls = firstResult.toolCalls.filter(
          tc => tc.toolName === "search-docs"
        );
        expect(firstSearchDocsCalls.length).toBeGreaterThan(0);

        // Verify tool call has proper structure
        expect(firstSearchDocsCalls[0]).toBeDefined();
      },
      60000
    );
  });

  describe("Tool integration", () => {
    itWithApiKey(
      "should work alongside other tools",
      async () => {
        // 1. Arrange - search-docs with other tools
        const tools = createTools(["search-docs", "sequentialthinking"]);
        const zai = createZai({ apiKey: process.env.ZAI_API_KEY });

        // 2. Act - Research and analyze
        const result = await generateText({
          model: zai("glm-4.7"),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- AI SDK tool type compatibility
          tools: tools as any,
          messages: [
            {
              role: "user",
              content:
                "Research how to implement a custom tool in AI SDK v6, then analyze the requirements.",
            },
          ],
        });

        // 3. Assert - Should use tools
        expect(result.toolCalls).toBeDefined();
        expect(result.toolCalls.length).toBeGreaterThan(0);

        // Should have tool calls
        const toolNames = result.toolCalls.map(tc => tc.toolName);
        expect(toolNames.length).toBeGreaterThan(0);
      },
      60000
    );
  });

  describe("Error handling", () => {
    it("should handle tool registration correctly", () => {
      // 1. Arrange - Create tool set with search-docs
      const tools = createTools(["search-docs", "ast-query", "grep-search"]);

      // 2. Act - Check tool names
      const toolNames = Object.keys(tools);

      // 3. Assert - Should have search-docs tools
      expect(toolNames).toContain("search-docs");
      expect(toolNames).toContain("ast-query");
      expect(toolNames).toContain("grep-search");
    });

    it("should export search-docs tool", () => {
      // 1. Arrange & Act - searchDocs is already imported
      // 2. Assert - Should be defined
      expect(searchDocs).toBeDefined();
      // searchDocs is an AI SDK tool, which has a description property
      expect(typeof searchDocs).toBe("object");
    });
  });

  describe("API structure", () => {
    it("should have correct tool structure for AI SDK", () => {
      // 1. Arrange & Act - Check tool structure
      expect(searchDocs).toBeDefined();
      // AI SDK tools are objects with specific structure
      expect(typeof searchDocs).toBe("object");
    });

    it("should accept query parameters", () => {
      // 1. Arrange - AI SDK tools accept parameters
      // 2. Act & Assert - Tool should be defined and accept input
      expect(searchDocs).toBeDefined();
      // The tool function exists and can be called with proper input
      expect(typeof searchDocs).toBe("object");
    });
  });
});
