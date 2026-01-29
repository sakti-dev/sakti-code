/**
 * IPC Handlers Tests
 * Unit tests for IPC handler functions
 */

import { dialog, ipcMain, shell } from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock Electron APIs
vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn(),
  },
  dialog: {
    showOpenDialog: vi.fn(),
    showSaveDialog: vi.fn(),
  },
  shell: {
    openExternal: vi.fn(),
    showItemInFolder: vi.fn(),
  },
}));

// Mock logger
vi.mock("@ekacode/shared/logger", () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

// Mock PermissionManager to prevent database initialization
vi.mock("@ekacode/core", () => ({
  PermissionManager: class MockPermissionManager {
    static getInstance() {
      return new MockPermissionManager();
    }
    handleResponse() {
      // Mock implementation
    }
  },
}));

describe("IPC Handlers", () => {
  const mockServerConfig = {
    port: 4096,
    token: "test-token-123",
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("setupIPCHandlers", () => {
    it("should register get-server-config handler", async () => {
      const { setupIPCHandlers } = await import("./ipc");
      const handleMock = vi.mocked(ipcMain.handle);

      setupIPCHandlers(mockServerConfig);

      expect(handleMock).toHaveBeenCalledWith("get-server-config", expect.any(Function));
    });

    it("should return server config from get-server-config handler", async () => {
      const { setupIPCHandlers } = await import("./ipc");
      const handleMock = vi.mocked(ipcMain.handle);

      setupIPCHandlers(mockServerConfig);

      // Get the handler function
      const handlerCall = handleMock.mock.calls.find(call => call[0] === "get-server-config");
      expect(handlerCall).toBeDefined();

      const handler = handlerCall![1];
      const result = await handler(null!, null);

      expect(result).toEqual({
        baseUrl: "http://127.0.0.1:4096",
        token: "test-token-123",
      });
    });

    it("should register dialog:openDirectory handler", async () => {
      const { setupIPCHandlers } = await import("./ipc");
      const handleMock = vi.mocked(ipcMain.handle);

      setupIPCHandlers(mockServerConfig);

      expect(handleMock).toHaveBeenCalledWith("dialog:openDirectory", expect.any(Function));
    });

    it("should register dialog:openFile handler", async () => {
      const { setupIPCHandlers } = await import("./ipc");
      const handleMock = vi.mocked(ipcMain.handle);

      setupIPCHandlers(mockServerConfig);

      expect(handleMock).toHaveBeenCalledWith("dialog:openFile", expect.any(Function));
    });

    it("should register dialog:saveFile handler", async () => {
      const { setupIPCHandlers } = await import("./ipc");
      const handleMock = vi.mocked(ipcMain.handle);

      setupIPCHandlers(mockServerConfig);

      expect(handleMock).toHaveBeenCalledWith("dialog:saveFile", expect.any(Function));
    });

    it("should register shell:openExternal handler", async () => {
      const { setupIPCHandlers } = await import("./ipc");
      const handleMock = vi.mocked(ipcMain.handle);

      setupIPCHandlers(mockServerConfig);

      expect(handleMock).toHaveBeenCalledWith("shell:openExternal", expect.any(Function));
    });

    it("should register shell:showItemInFolder handler", async () => {
      const { setupIPCHandlers } = await import("./ipc");
      const handleMock = vi.mocked(ipcMain.handle);

      setupIPCHandlers(mockServerConfig);

      expect(handleMock).toHaveBeenCalledWith("shell:showItemInFolder", expect.any(Function));
    });

    it("should register app:getVersion handler", async () => {
      const { setupIPCHandlers } = await import("./ipc");
      const handleMock = vi.mocked(ipcMain.handle);

      setupIPCHandlers(mockServerConfig);

      expect(handleMock).toHaveBeenCalledWith("app:getVersion", expect.any(Function));
    });

    it("should register app:getPlatform handler", async () => {
      const { setupIPCHandlers } = await import("./ipc");
      const handleMock = vi.mocked(ipcMain.handle);

      setupIPCHandlers(mockServerConfig);

      expect(handleMock).toHaveBeenCalledWith("app:getPlatform", expect.any(Function));
    });
  });

  describe("dialog handlers", () => {
    it("should return null when dialog is cancelled", async () => {
      const mockDialog = vi.mocked(dialog);
      mockDialog.showOpenDialog.mockResolvedValue({
        canceled: true,
        filePaths: [],
      });

      const { setupIPCHandlers } = await import("./ipc");
      const handleMock = vi.mocked(ipcMain.handle);

      setupIPCHandlers(mockServerConfig);

      const handlerCall = handleMock.mock.calls.find(call => call[0] === "dialog:openDirectory");
      const handler = handlerCall![1];
      const result = await handler(null!, null);

      expect(result).toBeNull();
    });

    it("should return selected directory path", async () => {
      const mockDialog = vi.mocked(dialog);
      const testPath = "/home/user/test-project";
      mockDialog.showOpenDialog.mockResolvedValue({
        canceled: false,
        filePaths: [testPath],
      });

      const { setupIPCHandlers } = await import("./ipc");
      const handleMock = vi.mocked(ipcMain.handle);

      setupIPCHandlers(mockServerConfig);

      const handlerCall = handleMock.mock.calls.find(call => call[0] === "dialog:openDirectory");
      const handler = handlerCall![1];
      const result = await handler(null!, null);

      expect(result).toBe(testPath);
    });
  });

  describe("shell handlers", () => {
    it("should call shell.openExternal with valid HTTPS URL", async () => {
      const mockShell = vi.mocked(shell);
      mockShell.openExternal.mockResolvedValue(undefined);

      const { setupIPCHandlers } = await import("./ipc");
      const handleMock = vi.mocked(ipcMain.handle);

      setupIPCHandlers(mockServerConfig);

      const handlerCall = handleMock.mock.calls.find(call => call[0] === "shell:openExternal");
      const handler = handlerCall![1];
      const testUrl = "https://example.com";

      await handler(null!, testUrl);

      expect(mockShell.openExternal).toHaveBeenCalledWith(testUrl);
    });

    it("should call shell.openExternal with valid HTTP URL", async () => {
      const mockShell = vi.mocked(shell);
      mockShell.openExternal.mockResolvedValue(undefined);

      const { setupIPCHandlers } = await import("./ipc");
      const handleMock = vi.mocked(ipcMain.handle);

      setupIPCHandlers(mockServerConfig);

      const handlerCall = handleMock.mock.calls.find(call => call[0] === "shell:openExternal");
      const handler = handlerCall![1];
      const testUrl = "http://example.com";

      await handler(null!, testUrl);

      expect(mockShell.openExternal).toHaveBeenCalledWith(testUrl);
    });

    it("should call shell.openExternal with mailto URL", async () => {
      const mockShell = vi.mocked(shell);
      mockShell.openExternal.mockResolvedValue(undefined);

      const { setupIPCHandlers } = await import("./ipc");
      const handleMock = vi.mocked(ipcMain.handle);

      setupIPCHandlers(mockServerConfig);

      const handlerCall = handleMock.mock.calls.find(call => call[0] === "shell:openExternal");
      const handler = handlerCall![1];
      const testUrl = "mailto:user@example.com";

      await handler(null!, testUrl);

      expect(mockShell.openExternal).toHaveBeenCalledWith(testUrl);
    });

    it("should throw error for disallowed file: protocol", async () => {
      const mockShell = vi.mocked(shell);
      mockShell.openExternal.mockResolvedValue(undefined);

      const { setupIPCHandlers } = await import("./ipc");
      const handleMock = vi.mocked(ipcMain.handle);

      setupIPCHandlers(mockServerConfig);

      const handlerCall = handleMock.mock.calls.find(call => call[0] === "shell:openExternal");
      const handler = handlerCall![1];
      const testUrl = "file:///etc/passwd";

      await expect(handler(null!, testUrl)).rejects.toThrow("URL protocol not allowed");
      expect(mockShell.openExternal).not.toHaveBeenCalled();
    });

    it("should throw error for disallowed javascript: protocol", async () => {
      const mockShell = vi.mocked(shell);
      mockShell.openExternal.mockResolvedValue(undefined);

      const { setupIPCHandlers } = await import("./ipc");
      const handleMock = vi.mocked(ipcMain.handle);

      setupIPCHandlers(mockServerConfig);

      const handlerCall = handleMock.mock.calls.find(call => call[0] === "shell:openExternal");
      const handler = handlerCall![1];
      const testUrl = "javascript:alert('xss')";

      await expect(handler(null!, testUrl)).rejects.toThrow("URL protocol not allowed");
      expect(mockShell.openExternal).not.toHaveBeenCalled();
    });

    it("should throw error for malformed URL", async () => {
      const mockShell = vi.mocked(shell);
      mockShell.openExternal.mockResolvedValue(undefined);

      const { setupIPCHandlers } = await import("./ipc");
      const handleMock = vi.mocked(ipcMain.handle);

      setupIPCHandlers(mockServerConfig);

      const handlerCall = handleMock.mock.calls.find(call => call[0] === "shell:openExternal");
      const handler = handlerCall![1];
      const testUrl = "not-a-valid-url";

      await expect(handler(null!, testUrl)).rejects.toThrow();
      expect(mockShell.openExternal).not.toHaveBeenCalled();
    });

    it("should call shell.showItemInFolder with path", async () => {
      const mockShell = vi.mocked(shell);
      mockShell.showItemInFolder.mockReturnValue(undefined);

      const { setupIPCHandlers } = await import("./ipc");
      const handleMock = vi.mocked(ipcMain.handle);

      setupIPCHandlers(mockServerConfig);

      const handlerCall = handleMock.mock.calls.find(call => call[0] === "shell:showItemInFolder");
      const handler = handlerCall![1];
      const testPath = "/home/user/test.txt";

      await handler(null!, testPath);

      expect(mockShell.showItemInFolder).toHaveBeenCalledWith(testPath);
    });
  });

  describe("app handlers", () => {
    it("should return version from package.json", async () => {
      const { setupIPCHandlers } = await import("./ipc");
      const handleMock = vi.mocked(ipcMain.handle);

      setupIPCHandlers(mockServerConfig);

      const handlerCall = handleMock.mock.calls.find(call => call[0] === "app:getVersion");
      const handler = handlerCall![1];
      const result = await handler(null!, null);

      expect(typeof result).toBe("string");
    });

    it("should return platform", async () => {
      const { setupIPCHandlers } = await import("./ipc");
      const handleMock = vi.mocked(ipcMain.handle);

      setupIPCHandlers(mockServerConfig);

      const handlerCall = handleMock.mock.calls.find(call => call[0] === "app:getPlatform");
      const handler = handlerCall![1];
      const result = await handler(null!, null);

      expect(result).toBe(process.platform);
    });
  });

  describe("event handlers", () => {
    it("should register permission:response event", async () => {
      const { setupIPCHandlers } = await import("./ipc");
      const onMock = vi.mocked(ipcMain.on);

      setupIPCHandlers(mockServerConfig);

      expect(onMock).toHaveBeenCalledWith("permission:response", expect.any(Function));
    });

    it("should register fs:watch-start event", async () => {
      const { setupIPCHandlers } = await import("./ipc");
      const onMock = vi.mocked(ipcMain.on);

      setupIPCHandlers(mockServerConfig);

      expect(onMock).toHaveBeenCalledWith("fs:watch-start", expect.any(Function));
    });

    it("should register fs:watch-stop event", async () => {
      const { setupIPCHandlers } = await import("./ipc");
      const onMock = vi.mocked(ipcMain.on);

      setupIPCHandlers(mockServerConfig);

      expect(onMock).toHaveBeenCalledWith("fs:watch-stop", expect.any(Function));
    });
  });
});
