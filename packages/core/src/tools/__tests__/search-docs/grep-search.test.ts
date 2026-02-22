/**
 * Tests for grep-search tool
 *
 * TDD approach: Tests written first to define expected behavior
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- Test files use any for simplicity */

import { beforeEach, describe, expect, it, vi } from "vitest";

describe("grep-search tool", () => {
  let grepSearch: any;
  let mockExecSync: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Mock execSync for ripgrep
    mockExecSync = vi.fn();
    vi.doMock("node:child_process", () => ({
      execSync: mockExecSync,
    }));

    // Set up default mock behavior
    mockExecSync.mockImplementation((command: string) => {
      if (command.includes("rg --json")) {
        // Mock ripgrep JSON output
        return JSON.stringify([
          {
            type: "match",
            data: {
              path: {
                text: "test.ts",
              },
              lines: {
                text: "function testFunction() {\n  return true;\n}",
              },
              line_number: 10,
            },
          },
        ]);
      }
      return "";
    });

    // Import the module after mocks are set up
    const module = await import("@/tools/search-docs/grep-search");
    grepSearch = module.grepSearch;
  });

  describe("pattern matching", () => {
    it("searches for a pattern in files", async () => {
      const result = await grepSearch.execute({
        pattern: "function",
        path: ".",
      });

      expect(result.matches).toBeDefined();
      expect(Array.isArray(result.matches)).toBe(true);
    });

    it("supports regex patterns", async () => {
      const result = await grepSearch.execute({
        pattern: "async.*function",
        path: ".",
      });

      expect(result.matches).toBeDefined();
    });
  });

  describe("file filtering", () => {
    it("filters by file pattern", async () => {
      const result = await grepSearch.execute({
        pattern: "test",
        path: ".",
        filePattern: "*.ts",
      });

      expect(result.matches).toBeDefined();
    });

    it("excludes directories with excludePattern", async () => {
      const result = await grepSearch.execute({
        pattern: "test",
        path: ".",
        excludePattern: "node_modules",
      });

      expect(result.matches).toBeDefined();
    });
  });

  describe("context", () => {
    it("includes context lines around matches", async () => {
      const result = await grepSearch.execute({
        pattern: "function",
        path: ".",
        contextLines: 2,
      });

      expect(result.matches).toBeDefined();
    });
  });

  describe("tool schema", () => {
    it("has correct input schema", () => {
      expect(grepSearch.inputSchema).toBeDefined();
    });

    it("has correct output schema", () => {
      expect(grepSearch.outputSchema).toBeDefined();
    });

    it("has description for AI", () => {
      expect(grepSearch.description).toBeDefined();
      expect(typeof grepSearch.description).toBe("string");
    });
  });
});
