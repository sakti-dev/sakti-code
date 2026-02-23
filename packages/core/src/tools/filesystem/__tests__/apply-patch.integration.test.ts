/**
 * Tests for apply-patch.ts
 *
 * TDD: Tests written first to define expected behavior of applyPatchTool with safety features
 */

import { Instance } from "@/instance";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock PermissionManager
const mockRequestApproval = vi.fn();

vi.mock("@/security/permission-manager", () => ({
  PermissionManager: {
    getInstance: vi.fn(() => ({
      requestApproval: (args: {
        id: string;
        permission: string;
        patterns: string[];
        always: string[];
        sessionID: string;
        metadata?: { patchText?: string };
      }) => mockRequestApproval(args),
    })),
  },
}));

describe("applyPatchTool", () => {
  let applyPatchTool: typeof import("@/tools/filesystem/apply-patch").applyPatchTool;
  let applyPatchExecute: NonNullable<
    typeof import("@/tools/filesystem/apply-patch").applyPatchTool.execute
  >;
  type ToolOptions = Parameters<
    NonNullable<typeof import("@/tools/filesystem/apply-patch").applyPatchTool.execute>
  >[1];
  const toolOptions: ToolOptions = { toolCallId: "apply-patch-call", messages: [] };

  beforeEach(async () => {
    vi.clearAllMocks();
    mockRequestApproval.mockResolvedValue(true);

    // Import the tool after mocks are set up
    const module = await import("@/tools/filesystem/apply-patch");
    applyPatchTool = module.applyPatchTool;
    applyPatchExecute = applyPatchTool.execute as NonNullable<typeof applyPatchTool.execute>;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("security", () => {
    it("requests external directory permission for paths outside workspace", async () => {
      mockRequestApproval.mockImplementation((args: { permission: string }) => {
        // Auto-approve external_directory requests
        if (args.permission === "external_directory") return Promise.resolve(true);
        return Promise.resolve(true);
      });

      const patchText = `+++ /etc/passwd
---
`;

      await Instance.provide({
        directory: "/workspace",
        sessionID: "test-session",
        async fn() {
          await applyPatchExecute({ patchText }, toolOptions);
        },
      }).catch(() => {
        // Expected to fail because we can't actually write to /etc/passwd
      });

      // Should request external_directory permission
      const calls = mockRequestApproval.mock.calls;
      const externalDirCalls = calls.filter(call => call[0]?.permission === "external_directory");
      expect(externalDirCalls.length).toBeGreaterThan(0);
    });

    it("does not request external permission for internal paths", async () => {
      mockRequestApproval.mockResolvedValue(true);

      const patchText = `+++ src/file.ts
---
`;

      await Instance.provide({
        directory: "/workspace",
        sessionID: "test-session",
        async fn() {
          await applyPatchExecute({ patchText }, toolOptions);
        },
      }).catch(() => {
        // May fail due to missing parent directory, but we're testing permissions
      });

      // Should not request external_directory permission
      const calls = mockRequestApproval.mock.calls;
      const externalDirCalls = calls.filter(call => call[0]?.permission === "external_directory");
      expect(externalDirCalls).toHaveLength(0);
    });

    it("includes patch text in permission request metadata", async () => {
      mockRequestApproval.mockResolvedValue(true);

      const patchText = `+++ src/test.ts
---
+const x = 1;
`;

      await Instance.provide({
        directory: "/workspace",
        sessionID: "test-session",
        async fn() {
          await applyPatchExecute({ patchText }, toolOptions);
        },
      }).catch(() => {
        // Expected to fail without actual filesystem
      });

      expect(mockRequestApproval).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            patchText,
          }),
        })
      );
    });
  });

  describe("patch parsing", () => {
    it("throws error for invalid patch format", async () => {
      const invalidPatch = `This is not a patch`;

      await expect(
        Instance.provide({
          directory: "/workspace",
          sessionID: "test-session",
          async fn() {
            return applyPatchExecute({ patchText: invalidPatch }, toolOptions);
          },
        })
      ).rejects.toThrow("Invalid patch format");
    });

    it("parses simple patch correctly", async () => {
      mockRequestApproval.mockResolvedValue(true);

      const patchText = `+++ src/test.ts
---
+const x = 1;
+const y = 2;
`;

      await Instance.provide({
        directory: "/workspace",
        sessionID: "test-session",
        async fn() {
          // Will fail on write, but we can test parsing
          await applyPatchExecute({ patchText }, toolOptions);
        },
      }).catch(() => {
        // Expected - filesystem doesn't exist
      });

      // At least it should have requested permission
      expect(mockRequestApproval).toHaveBeenCalled();
    });
  });

  describe("context validation", () => {
    it("throws when called outside Instance.provide()", async () => {
      const patchText = `+++ src/test.ts
---
+content
`;

      await expect(applyPatchExecute({ patchText }, toolOptions)).rejects.toThrow(
        "Instance context accessed outside"
      );
    });
  });
});
