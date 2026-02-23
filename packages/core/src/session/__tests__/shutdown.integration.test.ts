/**
 * Tests for shutdown handler
 *
 * These tests validate graceful shutdown handling with checkpoint saving.
 */

import { ShutdownHandler } from "@/session/shutdown";
import type { SessionManager } from "@/session/manager";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock process methods
const originalProcess = global.process;
const mockListeners = new Map<string, (...args: unknown[]) => void>();

describe("session/shutdown", () => {
  let mockSessionManager: Pick<SessionManager, "getActiveSessions">;
  let shutdownHandler: ShutdownHandler;

  beforeEach(() => {
    mockSessionManager = {
      getActiveSessions: vi.fn(() => []),
    };

    // Mock process methods
    global.process = {
      ...originalProcess,
      on: vi.fn((event, listener) => {
        mockListeners.set(event, listener as (...args: unknown[]) => void);
        return originalProcess;
      }),
      removeListener: vi.fn(event => {
        mockListeners.delete(event);
        return originalProcess;
      }),
      exit: vi.fn(),
    } as unknown as NodeJS.Process;
  });

  afterEach(() => {
    // Clean up handlers
    if (shutdownHandler) {
      // Don't actually call process.on during cleanup
    }
    global.process = originalProcess;
    mockListeners.clear();
  });

  describe("constructor", () => {
    it("should create shutdown handler with session manager", () => {
      shutdownHandler = new ShutdownHandler(mockSessionManager as SessionManager);

      expect(shutdownHandler).toBeDefined();
    });

    it("should register signal handlers", () => {
      shutdownHandler = new ShutdownHandler(mockSessionManager as SessionManager);

      expect(mockListeners.has("SIGTERM")).toBe(true);
      expect(mockListeners.has("SIGINT")).toBe(true);
    });
  });

  describe("handleShutdown", () => {
    it("should call getActiveSessions during shutdown", async () => {
      shutdownHandler = new ShutdownHandler(mockSessionManager as SessionManager);

      // Trigger SIGTERM
      const listener = mockListeners.get("SIGTERM");
      if (listener) {
        await (listener as () => Promise<void>)();
      }

      expect(mockSessionManager.getActiveSessions).toHaveBeenCalled();
    });
  });

  describe("process error handling", () => {
    it("should register uncaughtException handler", () => {
      shutdownHandler = new ShutdownHandler(mockSessionManager as any); // eslint-disable-line @typescript-eslint/no-explicit-any

      expect(mockListeners.has("uncaughtException")).toBe(true);
    });

    it("should register unhandledRejection handler", () => {
      shutdownHandler = new ShutdownHandler(mockSessionManager as any); // eslint-disable-line @typescript-eslint/no-explicit-any

      expect(mockListeners.has("unhandledRejection")).toBe(true);
    });
  });
});
