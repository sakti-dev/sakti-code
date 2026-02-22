import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockNotifyOpen = vi.fn(async () => {});
const mockWaitForDiagnostics = vi.fn(async () => {});
const mockShutdown = vi.fn(async () => {});
const mockCreateClient = vi.fn(async () => ({
  serverId: "typescript",
  root: "/repo",
  connection: {} as never,
  diagnostics: new Map<string, Array<{ message: string }>>(),
  notifyOpen: mockNotifyOpen,
  waitForDiagnostics: mockWaitForDiagnostics,
  shutdown: mockShutdown,
}));

const mockServer = {
  id: "typescript",
  name: "TypeScript Language Server",
  extensions: [".ts"],
  rootPatterns: ["package.json"],
  spawn: vi.fn(async () => ({
    process: {
      kill: vi.fn(),
    },
    initializationOptions: {},
  })),
};

const mockDetectServer = vi.fn(async () => mockServer);
const mockFindRoot = vi.fn(async () => "/repo");
const mockGetServer = vi.fn(() => mockServer);

vi.mock("@/lsp/client", () => ({
  LSPClient: {
    create: mockCreateClient,
  },
}));

vi.mock("@/lsp/server", () => ({
  LSPServerRegistry: {
    detectServer: mockDetectServer,
    findRoot: mockFindRoot,
    getServer: mockGetServer,
  },
}));

const { LSP } = await import("@/lsp");

describe("LSP integration", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await LSP.shutdown();
  });

  afterEach(async () => {
    await LSP.shutdown();
  });

  it("tracks active clients for files in active roots", async () => {
    await LSP.touchFile("/repo/src/main.ts");

    expect(mockNotifyOpen).toHaveBeenCalledWith("/repo/src/main.ts");
    expect(LSP.hasActiveClient("/repo/src/main.ts")).toBe(true);
    expect(LSP.hasActiveClient("/another/project/main.ts")).toBe(false);
  });

  it("waits for diagnostics when requested", async () => {
    await LSP.touchFile("/repo/src/main.ts", true);
    expect(mockWaitForDiagnostics).toHaveBeenCalledWith("/repo/src/main.ts");
  });
});
