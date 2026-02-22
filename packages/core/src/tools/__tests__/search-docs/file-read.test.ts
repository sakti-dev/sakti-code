/**
 * Tests for file-read tool
 *
 * TDD approach: Tests written first to define expected behavior
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- Test files use any for simplicity */

import { beforeEach, describe, expect, it, vi } from "vitest";

describe("file-read tool", () => {
  let fileRead: any;
  let mockReadFileSync: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Mock readFileSync
    mockReadFileSync = vi.fn();
    vi.doMock("node:fs", () => ({
      readFileSync: mockReadFileSync,
    }));

    // Set up default mock behavior
    mockReadFileSync.mockReturnValue("line1\nline2\nline3\nline4\nline5");

    // Import the module after mocks are set up
    const module = await import("@/tools/search-docs/file-read");
    fileRead = module.fileRead;
  });

  describe("reading files", () => {
    it("reads full file contents", async () => {
      const result = await fileRead.execute({
        path: "test.ts",
      });

      expect(result.content).toBeDefined();
      expect(result.lineCount).toBe(5);
      expect(result.content).toContain("line1");
      expect(result.content).toContain("line5");
    });

    it("supports line ranges", async () => {
      const result = await fileRead.execute({
        path: "test.ts",
        startLine: 2,
        endLine: 3,
      });

      expect(result.content).toBe("line2\nline3");
      expect(result.lineCount).toBe(2);
    });

    it("handles startLine only", async () => {
      const result = await fileRead.execute({
        path: "test.ts",
        startLine: 3,
      });

      expect(result.content).toBe("line3\nline4\nline5");
      expect(result.lineCount).toBe(3);
    });

    it("handles endLine only", async () => {
      const result = await fileRead.execute({
        path: "test.ts",
        endLine: 2,
      });

      expect(result.content).toBe("line1\nline2");
      expect(result.lineCount).toBe(2);
    });
  });

  describe("tool schema", () => {
    it("has correct input schema", () => {
      expect(fileRead.inputSchema).toBeDefined();
    });

    it("has correct output schema", () => {
      expect(fileRead.outputSchema).toBeDefined();
    });

    it("has description for AI", () => {
      expect(fileRead.description).toBeDefined();
      expect(typeof fileRead.description).toBe("string");
    });
  });
});
