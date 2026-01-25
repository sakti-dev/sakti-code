/**
 * Tests for kill-tree.ts
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- Test files use any for simplicity */

import { spawn } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { killTree } from "./kill-tree";

// Mock child_process spawn
vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

describe("killTree", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("on Windows", () => {
    beforeEach(() => {
      vi.stubEnv("NODE_ENV", "test");
      Object.defineProperty(process, "platform", {
        value: "win32",
      });
    });

    it("should spawn taskkill with correct arguments", async () => {
      const mockProc = {
        once: vi.fn((event, callback) => {
          if (event === "exit" || event === "error") {
            // Simulate immediate callback
            setTimeout(() => callback(), 0);
          }
          return mockProc;
        }),
      };

      vi.mocked(spawn).mockReturnValue(mockProc as any);

      const mockChildProc = {
        pid: 1234,
      } as any;

      await killTree(mockChildProc);

      expect(spawn).toHaveBeenCalledWith("taskkill", ["/pid", "1234", "/f", "/t"], {
        stdio: "ignore",
      });
    });

    it("should handle spawn errors gracefully", async () => {
      const mockProc = {
        once: vi.fn((event, callback) => {
          if (event === "error") {
            setTimeout(() => callback(), 0);
          }
          return mockProc;
        }),
      };

      vi.mocked(spawn).mockReturnValue(mockProc as any);

      const mockChildProc = {
        pid: 1234,
      } as any;

      // Should not throw
      await expect(killTree(mockChildProc)).resolves.toBeUndefined();
    });
  });

  describe("on Unix", () => {
    beforeEach(() => {
      Object.defineProperty(process, "platform", {
        value: "linux",
      });
    });

    it("should use process.kill with negative pid for process group", async () => {
      const mockKill = vi.fn();
      const originalProcessKill = process.kill;
      process.kill = mockKill as any;

      const mockChildProc = {
        pid: 1234,
        kill: vi.fn(),
      } as any;

      // Mock process.kill to not actually kill anything
      mockKill.mockImplementation(() => {
        throw new Error("Process not found");
      });

      await killTree(mockChildProc);

      // Should try to kill the process group first
      expect(mockKill).toHaveBeenCalledWith(-1234, "SIGTERM");

      process.kill = originalProcessKill;
    });

    it("should handle already exited processes", async () => {
      const mockChildProc = {
        pid: null,
      } as any;

      await killTree(mockChildProc);

      // Should return immediately without errors
      expect(spawn).not.toHaveBeenCalled();
    });

    it("should respect exited callback", async () => {
      const mockChildProc = {
        pid: 1234,
      } as any;

      const exitedFn = vi.fn(() => true);

      await killTree(mockChildProc, { exited: exitedFn });

      // Should not attempt to kill if already exited
      expect(spawn).not.toHaveBeenCalled();
    });
  });

  describe("edge cases", () => {
    it("should handle undefined pid", async () => {
      const mockChildProc = {
        pid: undefined,
      } as any;

      await killTree(mockChildProc);

      // Should return immediately
      expect(spawn).not.toHaveBeenCalled();
    });

    it("should handle zero pid", async () => {
      const mockChildProc = {
        pid: 0,
      } as any;

      await killTree(mockChildProc);

      // Should return immediately
      expect(spawn).not.toHaveBeenCalled();
    });
  });
});
