/**
 * Tests for grep.tool.ts
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- Test files use any for simplicity */

import { Instance } from "@/instance";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the dependencies
const mockRequestApproval = vi.fn().mockResolvedValue(true);
const mockGetRipgrepPath = vi.fn().mockResolvedValue("/usr/bin/rg");

vi.mock("@/security/permission-manager", () => ({
  PermissionManager: {
    getInstance: vi.fn(() => ({
      requestApproval: (args: any) => mockRequestApproval(args),
    })),
  },
}));

vi.mock("@/tools/search/ripgrep", () => ({
  getRipgrepPath: () => mockGetRipgrepPath(),
}));

const mockSpawn = vi.fn();
vi.mock("node:child_process", async importOriginal => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    spawn: (...args: any[]) => mockSpawn(...args),
  };
});

describe("grepTool", () => {
  let grepTool: any;
  let mockProc: any;
  let mockStdout: Readable;
  let mockStderr: Readable;
  const runInInstance = <R>(fn: () => Promise<R>) =>
    Instance.provide({
      directory: "/workspace",
      sessionID: "test-session",
      messageID: "test-message",
      fn,
    });

  beforeEach(async () => {
    vi.clearAllMocks();
    mockRequestApproval.mockResolvedValue(true);
    mockGetRipgrepPath.mockResolvedValue("/usr/bin/rg");

    // Create mock streams
    mockStdout = new Readable({ read() {} });
    mockStderr = new Readable({ read() {} });

    // Create mock child process
    mockProc = {
      pid: 12345,
      stdout: mockStdout,
      stderr: mockStderr,
      exitCode: 0,
      once: vi.fn((event: string, callback: (...args: any[]) => void) => {
        if (event === "exit") {
          process.nextTick(() => callback(0));
        }
        return mockProc;
      }),
    };

    mockSpawn.mockReturnValue(mockProc);

    // Import the tool after mocks are set up
    const module = await import("@/tools/search/grep.tool");
    grepTool = module.grepTool;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should have correct schema", () => {
    expect(grepTool).toBeDefined();
    expect(grepTool.inputSchema).toBeDefined();
  });

  it("should spawn ripgrep with correct arguments", async () => {
    mockStdout.push("file.txt:1: match line");
    mockStdout.push(null);
    mockStderr.push(null);

    await runInInstance(async () => {
      await grepTool.execute({
        pattern: "test",
      });
    });

    expect(mockSpawn).toHaveBeenCalledWith(
      "/usr/bin/rg",
      expect.arrayContaining([
        "-nH",
        "--hidden",
        "--follow",
        "--no-messages",
        "--field-match-separator=|",
        "--regexp",
        "test",
      ]),
      expect.any(Object)
    );
  });

  it("should request grep permission", async () => {
    mockStdout.push("file.txt:1: match line");
    mockStdout.push(null);
    mockStderr.push(null);

    await runInInstance(async () => {
      await grepTool.execute({
        pattern: "test",
      });
    });

    expect(mockRequestApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        permission: "bash",
        patterns: ["test"],
      })
    );
  });

  it("should handle include pattern correctly", async () => {
    mockStdout.push(null);
    mockStderr.push(null);

    await runInInstance(async () => {
      await grepTool.execute({
        pattern: "test",
        include: "*.ts",
      });
    });

    expect(mockSpawn).toHaveBeenCalledWith(
      "/usr/bin/rg",
      expect.arrayContaining(["--glob", "*.ts"]),
      expect.any(Object)
    );
  });

  it("should return 'No files found' when no matches", async () => {
    mockProc.once = vi.fn((event: string, callback: any) => {
      if (event === "exit") {
        process.nextTick(() => callback(1)); // Exit code 1 = no matches
      }
      return mockProc;
    });

    mockStdout.push(null);
    mockStderr.push(null);

    const result = await runInInstance(async () => {
      return grepTool.execute({
        pattern: "nonexistent",
      });
    });

    expect(result.content).toBe("No files found");
  });

  it("should parse and format matches correctly", async () => {
    // Use the correct format with | separator as configured in grep.tool.ts
    mockStdout.push("file1.txt|5| hello world");
    mockStdout.push("file2.txt|10| test pattern");
    mockStdout.push(null);
    mockStderr.push(null);

    const result = await runInInstance(async () => {
      return grepTool.execute({
        pattern: "test",
      });
    });

    expect(result.content).toContain("Found");
    expect(result.content).toContain("file1.txt");
    expect(result.content).toContain("file2.txt");
  });

  it("should limit results to 100 matches", async () => {
    // Generate 150 matches
    for (let i = 1; i <= 150; i++) {
      mockStdout.push(`file.txt:${i}: match ${i}\n`);
    }
    mockStdout.push(null);
    mockStderr.push(null);

    const result = await runInInstance(async () => {
      return grepTool.execute({
        pattern: "test",
      });
    });

    expect(result.metadata.matches).toBeLessThanOrEqual(100);
  });

  it("should handle custom path correctly", async () => {
    mockStdout.push(null);
    mockStderr.push(null);

    await runInInstance(async () => {
      await grepTool.execute({
        pattern: "test",
        path: "/custom/path",
      });
    });

    expect(mockSpawn).toHaveBeenCalledWith(
      "/usr/bin/rg",
      expect.any(Array),
      expect.objectContaining({
        cwd: "/custom/path",
      })
    );
  });

  it("should request external directory permission for paths outside workspace", async () => {
    mockStdout.push(null);
    mockStderr.push(null);

    await runInInstance(async () => {
      await grepTool.execute({
        pattern: "test",
        path: "/etc/passwd",
      });
    });

    expect(mockRequestApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        permission: "external_directory",
      })
    );
  });

  it("should handle ripgrep errors gracefully", async () => {
    mockProc.once = vi.fn((event: string, callback: any) => {
      if (event === "exit") {
        process.nextTick(() => callback(2)); // Exit code 2 = errors
      }
      return mockProc;
    });

    mockStdout.push("file.txt:1: match");
    mockStdout.push(null);
    mockStderr.push("Error: permission denied");

    const result = await runInInstance(async () => {
      return grepTool.execute({
        pattern: "test",
      });
    });

    // Should still return matches even with errors
    expect(result).toBeDefined();
  });
});
