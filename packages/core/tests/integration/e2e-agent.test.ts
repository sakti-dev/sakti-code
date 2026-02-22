/**
 * E2E Agent Integration Tests
 *
 * End-to-end tests for AI agent with tools using the AI SDK.
 * Tests verify that agents can use tools to complete coding tasks.
 *
 * Note: These tests require ZAI_API_KEY environment variable to run.
 * Without the API key, tests are skipped.
 */

import { createZai } from "@sakti-code/zai";
import { generateText } from "ai";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Instance } from "../../src/instance";
import { createTools } from "../../src/tools/registry";

// Track test workspace for cleanup
const testWorkspaceDirs: string[] = [];

describe("E2E: Agent with tools", () => {
  afterEach(async () => {
    // Clean up all test workspaces
    for (const testWorkspaceDir of testWorkspaceDirs) {
      try {
        await fs.rm(testWorkspaceDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
    testWorkspaceDirs.length = 0;
  });

  // These tests are online and opt-in.
  const runOnline = process.env.RUN_ONLINE_TESTS === "1" && !!process.env.ZAI_API_KEY;
  const itWithApiKey = runOnline ? it : it.skip;

  describe("Tool-based coding tasks", () => {
    itWithApiKey(
      "should complete a simple file writing task",
      async () => {
        // Create a temporary workspace for this test
        const testWorkspaceDir = path.join(os.tmpdir(), `sakti-code-e2e-test-${Date.now()}`);
        await fs.mkdir(testWorkspaceDir, { recursive: true });
        testWorkspaceDirs.push(testWorkspaceDir);

        // Execute test within Instance context
        await Instance.provide({
          directory: testWorkspaceDir,
          fn: async () => {
            // 1. Arrange - Create agent with tools
            const zai = createZai({ apiKey: process.env.ZAI_API_KEY });
            const tools = createTools(["read", "write", "bash"]);

            // 2. Act - Generate text with tool use
            const result = await generateText({
              model: zai("glm-4.7"),
              // eslint-disable-next-line @typescript-eslint/no-explicit-any -- AI SDK tool type compatibility
              tools: tools as any, // Type assertion for AI SDK compatibility
              messages: [
                {
                  role: "system",
                  content: "You are a coding assistant. Make code changes as requested.",
                },
                {
                  role: "user",
                  content: "Create a file named test.txt with content 'Hello, World!'",
                },
              ],
            });

            // 3. Assert - Verify tool was called and file was created
            expect(result.toolCalls).toBeDefined();
            expect(result.toolCalls.length).toBeGreaterThan(0);

            // Should have called write tool
            const writeCalls = result.toolCalls.filter(tc => tc.toolName === "write");
            expect(writeCalls.length).toBeGreaterThan(0);

            // Verify file exists in workspace
            const testFilePath = path.join(testWorkspaceDir, "test.txt");
            const fileExists = await fs
              .access(testFilePath)
              .then(() => true)
              .catch(() => false);
            expect(fileExists).toBe(true);

            // Verify file content
            if (fileExists) {
              const content = await fs.readFile(testFilePath, "utf-8");
              expect(content).toContain("Hello");
            }
          },
        });
      },
      30000
    );

    itWithApiKey(
      "should read and report file contents",
      async () => {
        const testWorkspaceDir = path.join(os.tmpdir(), `sakti-code-e2e-test-${Date.now()}`);
        await fs.mkdir(testWorkspaceDir, { recursive: true });
        testWorkspaceDirs.push(testWorkspaceDir);

        await Instance.provide({
          directory: testWorkspaceDir,
          fn: async () => {
            // 1. Arrange - Create a test file
            const testFilePath = path.join(testWorkspaceDir, "README.md");
            await fs.writeFile(testFilePath, "# Test Project\n\nThis is a test project.", "utf-8");

            const zai = createZai({ apiKey: process.env.ZAI_API_KEY });
            const tools = createTools(["read", "ls"]);

            // 2. Act - Ask agent to read the file
            const result = await generateText({
              model: zai("glm-4.7"),
              // eslint-disable-next-line @typescript-eslint/no-explicit-any -- AI SDK tool type compatibility
              tools: tools as any,
              messages: [
                {
                  role: "system",
                  content: "You are a coding assistant. Read files and report their contents.",
                },
                {
                  role: "user",
                  content:
                    "What files are in this directory? Read README.md and tell me what it says.",
                },
              ],
            });

            // 3. Assert
            expect(result.toolCalls).toBeDefined();
            const readCalls = result.toolCalls.filter(tc => tc.toolName === "read");
            expect(readCalls.length).toBeGreaterThan(0);

            // Should mention the file or content
            expect(result.text).toMatch(/README|Test Project|test/i);
          },
        });
      },
      30000
    );

    itWithApiKey(
      "should use bash tool for file operations",
      async () => {
        const testWorkspaceDir = path.join(os.tmpdir(), `sakti-code-e2e-test-${Date.now()}`);
        await fs.mkdir(testWorkspaceDir, { recursive: true });
        testWorkspaceDirs.push(testWorkspaceDir);

        await Instance.provide({
          directory: testWorkspaceDir,
          fn: async () => {
            // 1. Arrange
            const zai = createZai({ apiKey: process.env.ZAI_API_KEY });
            const tools = createTools(["bash", "read"]);

            // 2. Act - Ask agent to create a file using bash
            const result = await generateText({
              model: zai("glm-4.7"),
              // eslint-disable-next-line @typescript-eslint/no-explicit-any -- AI SDK tool type compatibility
              tools: tools as any,
              messages: [
                {
                  role: "system",
                  content: "You are a coding assistant. Use bash commands when appropriate.",
                },
                {
                  role: "user",
                  content: "Use bash to create a file called bash-test.txt with some content",
                },
              ],
            });

            // 3. Assert
            expect(result.toolCalls).toBeDefined();
            const bashCalls = result.toolCalls.filter(tc => tc.toolName === "bash");
            expect(bashCalls.length).toBeGreaterThan(0);

            // Verify file was created
            const bashTestPath = path.join(testWorkspaceDir, "bash-test.txt");
            const fileExists = await fs
              .access(bashTestPath)
              .then(() => true)
              .catch(() => false);
            expect(fileExists).toBe(true);
          },
        });
      },
      30000
    );
  });

  describe("Multi-tool coordination", () => {
    itWithApiKey(
      "should coordinate multiple tools to complete a task",
      async () => {
        const testWorkspaceDir = path.join(os.tmpdir(), `sakti-code-e2e-test-${Date.now()}`);
        await fs.mkdir(testWorkspaceDir, { recursive: true });
        testWorkspaceDirs.push(testWorkspaceDir);

        await Instance.provide({
          directory: testWorkspaceDir,
          fn: async () => {
            // 1. Arrange - Create multiple tools
            const zai = createZai({ apiKey: process.env.ZAI_API_KEY });
            const tools = createTools(["read", "write", "edit", "bash", "glob"]);

            // 2. Act - Ask agent to perform a complex task
            const result = await generateText({
              model: zai("glm-4.7"),
              // eslint-disable-next-line @typescript-eslint/no-explicit-any -- AI SDK tool type compatibility
              tools: tools as any,
              messages: [
                {
                  role: "system",
                  content: "You are a coding assistant. Use appropriate tools to complete tasks.",
                },
                {
                  role: "user",
                  content:
                    "Create a simple TypeScript function that adds two numbers. Save it to math.ts",
                },
              ],
            });

            // 3. Assert - Should use multiple tools
            expect(result.toolCalls).toBeDefined();
            expect(result.toolCalls.length).toBeGreaterThan(0);

            // Verify math.ts was created
            const mathPath = path.join(testWorkspaceDir, "math.ts");
            const fileExists = await fs
              .access(mathPath)
              .then(() => true)
              .catch(() => false);
            expect(fileExists).toBe(true);
          },
        });
      },
      30000
    );
  });

  describe("Error handling", () => {
    itWithApiKey(
      "should handle non-existent file read gracefully",
      async () => {
        const testWorkspaceDir = path.join(os.tmpdir(), `sakti-code-e2e-test-${Date.now()}`);
        await fs.mkdir(testWorkspaceDir, { recursive: true });
        testWorkspaceDirs.push(testWorkspaceDir);

        await Instance.provide({
          directory: testWorkspaceDir,
          fn: async () => {
            // 1. Arrange
            const zai = createZai({ apiKey: process.env.ZAI_API_KEY });
            const tools = createTools(["read"]);

            // 2. Act - Try to read non-existent file
            const result = await generateText({
              model: zai("glm-4.7"),
              // eslint-disable-next-line @typescript-eslint/no-explicit-any -- AI SDK tool type compatibility
              tools: tools as any,
              messages: [
                {
                  role: "user",
                  content: "Read the file does-not-exist.txt",
                },
              ],
            });

            // 3. Assert - Should complete without throwing
            expect(result).toBeDefined();
            expect(result.text).toBeDefined();
            // Should mention the error or file not found
            expect(
              result.text.toLowerCase().includes("not found") ||
                result.text.toLowerCase().includes("error") ||
                result.text.toLowerCase().includes("does not exist")
            ).toBe(true);
          },
        });
      },
      30000
    );
  });

  describe("Tool availability", () => {
    it("should provide all expected tools from registry", () => {
      // 1. Arrange - Get all tools
      const allTools = createTools([
        "read",
        "write",
        "edit",
        "multiedit",
        "apply_patch",
        "ls",
        "glob",
        "bash",
        "grep",
        "webfetch",
        "sequentialthinking",
        "search-docs",
        "ast-query",
        "grep-search",
        "file-read-docs",
      ]);

      // 2. Act - Check tool names
      const toolNames = Object.keys(allTools);

      // 3. Assert - Should have all tools
      const expectedTools = [
        "read",
        "write",
        "edit",
        "multiedit",
        "apply_patch",
        "ls",
        "glob",
        "bash",
        "grep",
        "webfetch",
        "sequentialthinking",
        "search-docs",
        "ast-query",
        "grep-search",
        "file-read-docs",
      ];

      expectedTools.forEach(toolName => {
        expect(toolNames).toContain(toolName);
      });
    });

    it("should create subset of tools", () => {
      // 1. Arrange - Create specific tool set
      const specificTools = createTools(["read", "write", "bash"]);

      // 2. Act - Check tool names
      const toolNames = Object.keys(specificTools);

      // 3. Assert - Should only have requested tools
      expect(toolNames).toHaveLength(3);
      expect(toolNames).toContain("read");
      expect(toolNames).toContain("write");
      expect(toolNames).toContain("bash");
    });
  });
});
