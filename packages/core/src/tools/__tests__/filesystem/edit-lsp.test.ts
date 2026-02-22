/**
 * Tests for edit tool LSP diagnostics integration
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
    readFile: vi.fn().mockResolvedValue("const x = 1;"),
    writeFile: vi.fn().mockResolvedValue(undefined),
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
const { editTool } = await import("@/tools/filesystem/edit");

describe("editTool - LSP diagnostics integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should return diagnostics in output after edit", async () => {
    mockGetDiagnostics.mockReturnValue({
      "/workspace/test.ts": [
        {
          severity: 1,
          message: "Error: missing semicolon",
          range: { start: { line: 1, character: 10 }, end: { line: 1, character: 10 } },
        },
      ],
    });

    await Instance.provide({
      directory: "/workspace",
      sessionID: "test-session",
      async fn() {
        const result = await (editTool as any).execute(
          { filePath: "/workspace/test.ts", oldString: "const x = 1", newString: "const x = 2" },
          {}
        );

        expect(result.diagnostics).toBeDefined();
        expect(result.diagnostics["/workspace/test.ts"]).toHaveLength(1);
      },
    });
  });

  it("should call LSP.touchFile after edit", async () => {
    mockGetDiagnostics.mockReturnValue({});

    await Instance.provide({
      directory: "/workspace",
      sessionID: "test-session",
      async fn() {
        await (editTool as any).execute(
          { filePath: "/workspace/test.ts", oldString: "const x = 1", newString: "const x = 2" },
          {}
        );

        expect(mockTouchFile).toHaveBeenCalledWith("/workspace/test.ts", true);
      },
    });
  });
});
