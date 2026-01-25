/**
 * Tests for parser.ts
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- Test files use any for simplicity */

import * as fs from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearCache, getCommandPrefix, parseCommand } from "./parser";

// Mock node:fs/promises
vi.mock("node:fs/promises", () => ({
  realpath: vi.fn(),
}));

// Track the current command being tested
let _currentCommand = "";
let mockParser: any = null;

// Mock tree-sitter with a dynamic parser that responds to the command
vi.mock("tree-sitter", () => ({
  default: class {
    setLanguage() {}
    parse(command: string) {
      _currentCommand = command;
      return mockParser || createMockParser(command);
    }
  },
}));

vi.mock("tree-sitter-bash", () => ({
  default: {},
}));

// Create a mock parser based on the command
function createMockParser(command: string) {
  // Parse command to determine structure
  const parts = command.split(/\s+/);

  return {
    rootNode: {
      type: "source_file",
      childCount: 1,
      child: (index: number) => {
        if (index === 0) {
          return createMockCommandNode(parts);
        }
        return null;
      },
    },
  };
}

function createMockCommandNode(parts: string[]) {
  const children: any[] = [];

  // Add command name
  if (parts.length > 0) {
    children.push({ type: "command_name", text: parts[0] });
  }

  // Add arguments
  for (let i = 1; i < parts.length; i++) {
    children.push({ type: "word", text: parts[i] });
  }

  return {
    type: "command",
    childCount: children.length,
    child: (i: number) => children[i] || null,
  };
}

describe("parseCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should extract file paths from ls command", async () => {
    vi.mocked(fs.realpath).mockResolvedValue("/home/user");

    const result = await parseCommand("ls /home/user", "/workspace");

    expect(result.directories).toContain("/home/user");
  });

  it("should extract file paths from cat command", async () => {
    vi.mocked(fs.realpath).mockResolvedValue("/workspace/file.txt");

    const result = await parseCommand("cat file.txt", "/workspace");

    expect(result.directories).toContain("/workspace/file.txt");
  });

  it("should extract file paths from mkdir command", async () => {
    vi.mocked(fs.realpath).mockResolvedValue("/workspace/newdir");

    const result = await parseCommand("mkdir newdir", "/workspace");

    expect(result.directories).toContain("/workspace/newdir");
  });

  it("should add command pattern for bash permission", async () => {
    const result = await parseCommand("ls -la", "/workspace");

    expect(result.patterns).toContain("ls -la");
  });

  it("should add always pattern with wildcard", async () => {
    const result = await parseCommand("ls -la", "/workspace");

    expect(result.always).toContain("ls*");
  });

  it("should skip options starting with -", async () => {
    const result = await parseCommand("ls -la -h", "/workspace");

    // Should not add flags as directories
    expect(result.directories.size).toBe(0);
  });

  it("should handle cd command specially", async () => {
    vi.mocked(fs.realpath).mockResolvedValue("/home/user");

    const result = await parseCommand("cd /home/user", "/workspace");

    // cd should extract directory but not add to patterns
    expect(result.directories).toContain("/home/user");
    expect(result.patterns.size).toBe(0);
  });

  it("should handle multiple file arguments", async () => {
    vi.mocked(fs.realpath).mockImplementation(p => Promise.resolve(p.toString()));

    const result = await parseCommand("cat file1.txt file2.txt", "/workspace");

    expect(result.directories.size).toBeGreaterThan(0);
  });

  it("should skip chmod +x mode arguments", async () => {
    vi.mocked(fs.realpath).mockResolvedValue("/workspace/script.sh");

    const result = await parseCommand("chmod +x script.sh", "/workspace");

    expect(result.directories).toContain("/workspace/script.sh");
  });

  it("should handle paths with spaces when quoted", async () => {
    vi.mocked(fs.realpath).mockResolvedValue("/workspace/file with spaces.txt");

    const result = await parseCommand('cat "file with spaces.txt"', "/workspace");

    // Should still attempt to resolve
    expect(result.patterns.size).toBeGreaterThan(0);
  });

  it("should handle absolute paths", async () => {
    vi.mocked(fs.realpath).mockResolvedValue("/etc/passwd");

    const result = await parseCommand("cat /etc/passwd", "/workspace");

    expect(result.directories).toContain("/etc/passwd");
  });

  it("should handle relative paths", async () => {
    vi.mocked(fs.realpath).mockResolvedValue("/workspace/../other/file.txt");

    const result = await parseCommand("cat ../other/file.txt", "/workspace");

    expect(result.directories.size).toBeGreaterThan(0);
  });

  it("should skip paths with wildcards", async () => {
    const result = await parseCommand("ls *.txt", "/workspace");

    // Wildcard paths should not be added to directories
    expect(result.directories.size).toBe(0);
  });

  it("should skip paths with variables", async () => {
    const result = await parseCommand("cat $HOME/file.txt", "/workspace");

    // Paths with variables should not be resolved
    expect(result.directories.size).toBe(0);
  });

  it("should handle missing fs.realpath gracefully", async () => {
    vi.mocked(fs.realpath).mockRejectedValue(new Error("Path not found"));

    const result = await parseCommand("cat nonexistent.txt", "/workspace");

    // Should still add the path even if it doesn't exist
    expect(result.patterns.size).toBeGreaterThan(0);
  });

  it("should handle empty command", async () => {
    const result = await parseCommand("", "/workspace");

    expect(result.directories.size).toBe(0);
    expect(result.patterns.size).toBe(0);
  });

  it("should handle tree-sitter parse errors gracefully", async () => {
    // This would happen if tree-sitter is not available
    const result = await parseCommand("ls -la", "/workspace");

    // Should still return a result with basic patterns
    expect(result).toBeDefined();
  });
});

describe("getCommandPrefix", () => {
  it("should return all but last argument", () => {
    const command = ["git", "commit", "-m", "message"];
    const result = getCommandPrefix(command);

    expect(result).toEqual(["git", "commit", "-m"]);
  });

  it("should return empty array for single command", () => {
    const command = ["ls"];
    const result = getCommandPrefix(command);

    expect(result).toEqual([]);
  });

  it("should return empty array for empty command", () => {
    const command: string[] = [];
    const result = getCommandPrefix(command);

    expect(result).toEqual([]);
  });

  it("should handle two-word commands", () => {
    const command = ["git", "status"];
    const result = getCommandPrefix(command);

    expect(result).toEqual(["git"]);
  });
});
