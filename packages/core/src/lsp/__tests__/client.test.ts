import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockReadFile = vi.fn(async () => "const x = 1;");
const notificationHandlers = new Map<string, (params: unknown) => void>();
const mockSendNotification = vi.fn(async () => {});
const mockSendRequest = vi.fn(async (method: string) => {
  if (method === "initialize") {
    return {};
  }
  if (method === "shutdown") {
    return {};
  }
  return {};
});
const mockEnd = vi.fn();
const mockDispose = vi.fn();

vi.mock("node:fs/promises", () => ({
  default: {
    readFile: mockReadFile,
  },
}));

vi.mock("vscode-jsonrpc/node", () => ({
  StreamMessageReader: vi.fn(),
  StreamMessageWriter: vi.fn(),
  createMessageConnection: vi.fn(() => ({
    onNotification: vi.fn((method: string, handler: (params: unknown) => void) => {
      notificationHandlers.set(method, handler);
    }),
    onRequest: vi.fn(),
    listen: vi.fn(),
    sendRequest: mockSendRequest,
    sendNotification: mockSendNotification,
    end: mockEnd,
    dispose: mockDispose,
  })),
}));

const { LSPClient } = await import("@/lsp/client");

describe("LSPClient", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    notificationHandlers.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("waitForDiagnostics resolves after publishDiagnostics notification", async () => {
    const kill = vi.fn();
    const client = await LSPClient.create({
      serverId: "typescript",
      root: "/repo",
      handle: {
        process: {
          pid: 123,
          stdout: {} as never,
          stdin: {} as never,
          kill,
        } as never,
      },
    });

    const filePath = "/repo/src/main.ts";
    const promise = client.waitForDiagnostics(filePath);

    setTimeout(() => {
      const handler = notificationHandlers.get("textDocument/publishDiagnostics");
      if (!handler) {
        throw new Error("publishDiagnostics handler not registered");
      }
      handler({
        uri: "file:///repo/src/main.ts",
        diagnostics: [
          {
            message: "error",
            severity: 1,
            range: {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 1 },
            },
          },
        ],
      });
    }, 50);

    await vi.advanceTimersByTimeAsync(300);
    await expect(promise).resolves.toBeUndefined();
  });

  it("waitForDiagnostics resolves after timeout when diagnostics never arrive", async () => {
    const client = await LSPClient.create({
      serverId: "typescript",
      root: "/repo",
      handle: {
        process: {
          pid: 123,
          stdout: {} as never,
          stdin: {} as never,
          kill: vi.fn(),
        } as never,
      },
    });

    const promise = client.waitForDiagnostics("/repo/src/no-diagnostics.ts");
    await vi.advanceTimersByTimeAsync(3_200);
    await expect(promise).resolves.toBeUndefined();
  });
});
