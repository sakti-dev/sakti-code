/**
 * Tests for write tool LSP diagnostics integration
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { Instance } from "@/instance";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockTouchFile = vi.fn();
const mockGetDiagnostics = vi.fn(() => ({}));

vi.mock("@/lsp", () => ({
  LSP: {
    touchFile: mockTouchFile,
    getDiagnostics: mockGetDiagnostics,
  },
}));

vi.mock("node:fs/promises", () => ({
  default: {
    access: vi.fn().mockRejectedValue(new Error("ENOENT")),
    readFile: vi.fn().mockRejectedValue(new Error("ENOENT")),
    writeFile: vi.fn().mockResolvedValue(undefined),
    mkdir: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("@/security/permission-manager", () => ({
  PermissionManager: {
    getInstance: vi.fn(() => ({
      requestApproval: vi.fn().mockResolvedValue(true),
    })),
  },
}));

// Import after mocks are set up
const { writeTool } = await import("@/tools/filesystem/write");

describe("writeTool - LSP diagnostics integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should return diagnostics in output after write", async () => {
    mockGetDiagnostics.mockReturnValue({
      "/workspace/new.ts": [
        {
          severity: 1,
          message: "Error: unused variable",
          range: { start: { line: 0, character: 5 }, end: { line: 0, character: 10 } },
        },
      ],
    });

    await Instance.provide({
      directory: "/workspace",
      sessionID: "test-session",
      async fn() {
        const result = await (writeTool as any).execute(
          { filePath: "/workspace/new.ts", content: "const x = 1" },
          {}
        );

        expect(result.diagnostics).toBeDefined();
        expect(result.diagnostics?.["/workspace/new.ts"]).toHaveLength(1);
      },
    });
  });

  it("should call LSP.touchFile after write", async () => {
    mockGetDiagnostics.mockReturnValue({});

    await Instance.provide({
      directory: "/workspace",
      sessionID: "test-session",
      async fn() {
        await (writeTool as any).execute(
          { filePath: "/workspace/new.ts", content: "const x = 1" },
          {}
        );

        expect(mockTouchFile).toHaveBeenCalledWith("/workspace/new.ts", true);
      },
    });
  });
});
