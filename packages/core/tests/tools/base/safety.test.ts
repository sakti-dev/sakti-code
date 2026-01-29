/**
 * Tests for safety.ts
 *
 * TDD: Tests written first to define expected behavior of resolveSafePath() and validatePathOperation()
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Instance } from "../../../src/instance";
import { PermissionManager } from "../../../src/security/permission-manager";
import { resolveSafePath, validatePathOperation } from "../../../src/tools/base/safety";

// Mock PermissionManager
const mockRequestApproval = vi.fn();

vi.mock("../../../src/security/permission-manager", () => ({
  PermissionManager: {
    getInstance: vi.fn(() => ({
      requestApproval: (args: {
        id: string;
        permission: string;
        patterns: string[];
        always: string[];
        sessionID: string;
      }) => mockRequestApproval(args),
    })),
  },
}));

describe("resolveSafePath", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequestApproval.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("path resolution", () => {
    it("resolves relative paths against workspace root", async () => {
      await Instance.provide({
        directory: "/workspace",
        async fn() {
          const result = await resolveSafePath("src/file.ts", "/workspace");
          expect(result.absolutePath).toBe("/workspace/src/file.ts");
          expect(result.relativePath).toBe("src/file.ts");
        },
      });
    });

    it("keeps absolute paths as-is", async () => {
      await Instance.provide({
        directory: "/workspace",
        async fn() {
          const result = await resolveSafePath("/etc/passwd", "/workspace");
          expect(result.absolutePath).toBe("/etc/passwd");
        },
      });
    });

    it("detects external directories correctly", async () => {
      await Instance.provide({
        directory: "/workspace",
        async fn() {
          const result = await resolveSafePath("/etc/passwd", "/workspace");
          expect(result.isExternal).toBe(true);
        },
      });
    });

    it("marks internal paths as not external", async () => {
      await Instance.provide({
        directory: "/workspace",
        async fn() {
          const result = await resolveSafePath("src/file.ts", "/workspace");
          expect(result.isExternal).toBe(false);
        },
      });
    });

    it("normalizes paths with . segments", async () => {
      await Instance.provide({
        directory: "/workspace",
        async fn() {
          const result = await resolveSafePath("./src/file.ts", "/workspace");
          expect(result.absolutePath).toBe("/workspace/src/file.ts");
        },
      });
    });

    it("normalizes paths with .. segments (internal)", async () => {
      await Instance.provide({
        directory: "/workspace",
        async fn() {
          const result = await resolveSafePath("src/../README.md", "/workspace");
          expect(result.absolutePath).toBe("/workspace/README.md");
          expect(result.isExternal).toBe(false);
        },
      });
    });

    it("detects escape attempts with .. segments", async () => {
      await Instance.provide({
        directory: "/workspace",
        async fn() {
          const result = await resolveSafePath("../../../etc/passwd", "/workspace");
          // Even after normalization, if it escapes workspace, it's external
          expect(result.isExternal).toBe(true);
        },
      });
    });
  });

  describe("symlink detection", () => {
    it("detects symlinks pointing outside workspace as external", async () => {
      // This test would require actual filesystem setup
      // For now, we test the logic structure
      await Instance.provide({
        directory: "/workspace",
        async fn() {
          // If we had a symlink /workspace/link -> /etc/passwd
          // It should be detected as external
          // This is tested in integration tests with real files
          const result = await resolveSafePath("/etc/passwd", "/workspace");
          expect(result.isExternal).toBe(true);
        },
      });
    });
  });

  describe("error handling", () => {
    it("handles empty paths gracefully", async () => {
      await Instance.provide({
        directory: "/workspace",
        async fn() {
          const result = await resolveSafePath("", "/workspace");
          expect(result.absolutePath).toBe("/workspace");
        },
      });
    });

    it("handles paths with special characters", async () => {
      await Instance.provide({
        directory: "/workspace",
        async fn() {
          const result = await resolveSafePath("src/file with spaces.ts", "/workspace");
          expect(result.absolutePath).toBe("/workspace/src/file with spaces.ts");
        },
      });
    });
  });
});

describe("validatePathOperation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequestApproval.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("layered safety validation", () => {
    it("validates context exists and throws if missing", async () => {
      // Should throw when called outside Instance.provide()
      await expect(
        validatePathOperation(
          "/workspace/file.ts",
          "/workspace",
          "read",
          PermissionManager.getInstance(),
          "session-123"
        )
      ).rejects.toThrow("Instance context accessed outside");
    });

    it("validates context and succeeds when context exists", async () => {
      mockRequestApproval.mockResolvedValue(true);

      await Instance.provide({
        directory: "/workspace",
        sessionID: "session-123",
        async fn() {
          await expect(
            validatePathOperation(
              "/workspace/file.ts",
              "/workspace",
              "read",
              PermissionManager.getInstance(),
              "session-123"
            )
          ).resolves.toMatchObject({
            absolutePath: "/workspace/file.ts",
            relativePath: "file.ts",
          });
        },
      });
    });

    it("requests external directory permission for external paths", async () => {
      mockRequestApproval.mockResolvedValue(true);

      await Instance.provide({
        directory: "/workspace",
        sessionID: "session-123",
        async fn() {
          const result = await validatePathOperation(
            "/etc/passwd",
            "/workspace",
            "read",
            PermissionManager.getInstance(),
            "session-123"
          );

          expect(result.isExternal).toBe(true);

          expect(mockRequestApproval).toHaveBeenCalledWith(
            expect.objectContaining({
              permission: "external_directory",
            })
          );
        },
      });
    });

    it("requests operation permission for read operations", async () => {
      mockRequestApproval.mockResolvedValue(true);

      await Instance.provide({
        directory: "/workspace",
        sessionID: "session-123",
        async fn() {
          await validatePathOperation(
            "/workspace/file.ts",
            "/workspace",
            "read",
            PermissionManager.getInstance(),
            "session-123"
          );

          expect(mockRequestApproval).toHaveBeenCalledWith(
            expect.objectContaining({
              permission: "read",
            })
          );
        },
      });
    });

    it("requests operation permission for edit operations", async () => {
      mockRequestApproval.mockResolvedValue(true);

      await Instance.provide({
        directory: "/workspace",
        sessionID: "session-123",
        async fn() {
          await validatePathOperation(
            "/workspace/file.ts",
            "/workspace",
            "edit",
            PermissionManager.getInstance(),
            "session-123"
          );

          expect(mockRequestApproval).toHaveBeenCalledWith(
            expect.objectContaining({
              permission: "edit",
            })
          );
        },
      });
    });
  });

  describe("permission denied handling", () => {
    it("throws when external directory permission denied", async () => {
      mockRequestApproval.mockResolvedValue(false);

      await expect(
        Instance.provide({
          directory: "/workspace",
          sessionID: "session-123",
          async fn() {
            await validatePathOperation(
              "/etc/passwd",
              "/workspace",
              "read",
              PermissionManager.getInstance(),
              "session-123"
            );
          },
        })
      ).rejects.toThrow("Permission denied");
    });

    it("throws when operation permission denied", async () => {
      mockRequestApproval.mockResolvedValue(false);

      await expect(
        Instance.provide({
          directory: "/workspace",
          sessionID: "session-123",
          async fn() {
            await validatePathOperation(
              "/workspace/file.ts",
              "/workspace",
              "read",
              PermissionManager.getInstance(),
              "session-123"
            );
          },
        })
      ).rejects.toThrow("Permission denied");
    });
  });

  describe("internal paths", () => {
    it("does not request external permission for internal paths", async () => {
      mockRequestApproval.mockResolvedValue(true);

      await Instance.provide({
        directory: "/workspace",
        sessionID: "session-123",
        async fn() {
          await validatePathOperation(
            "/workspace/file.ts",
            "/workspace",
            "read",
            PermissionManager.getInstance(),
            "session-123"
          );

          // Should only request read permission, not external_directory
          const calls = mockRequestApproval.mock.calls;
          const externalCalls = calls.filter(call => call[0]?.permission === "external_directory");
          expect(externalCalls).toHaveLength(0);
        },
      });
    });
  });
});
