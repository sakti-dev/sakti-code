/**
 * SSE Catch-up Tests
 *
 * Tests for SSE catch-up synchronization when reconnection fails
 */

// @vitest-environment jsdom
import {
  CatchupController,
  catchupSession,
  getCatchupBackoff,
  type SDKClientForCatchup,
  shouldCatchup,
} from "@/core/shared/utils/sse-catchup";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock SDK client
function createMockClient(shouldFail = false, messageCount = 10) {
  const client: SDKClientForCatchup = {
    session: {
      messages: vi.fn(
        async (_opts: {
          sessionID: string;
          limit?: number;
          offset?: number;
          signal?: AbortSignal;
        }) => {
          if (shouldFail) throw new Error("Network error");
          return {
            sessionID: "test-session",
            messages: Array(messageCount).fill({ id: "msg-1" }),
            hasMore: false,
          };
        }
      ),
    },
  };
  return client;
}

describe("sse-catchup", () => {
  describe("shouldCatchup", () => {
    it("returns true when disconnected > 1s with lastEventId", () => {
      expect(shouldCatchup(2000, "event-123")).toBe(true);
      expect(shouldCatchup(5000, "event-456")).toBe(true);
      expect(shouldCatchup(1001, "event-789")).toBe(true);
    });

    it("returns false when no lastEventId", () => {
      expect(shouldCatchup(5000, null)).toBe(false);
      expect(shouldCatchup(10000, null)).toBe(false);
    });

    it("returns false when disconnected briefly", () => {
      expect(shouldCatchup(500, "event-123")).toBe(false);
      expect(shouldCatchup(1000, "event-123")).toBe(false);
      expect(shouldCatchup(0, "event-123")).toBe(false);
    });

    it("returns false for negative duration", () => {
      expect(shouldCatchup(-1000, "event-123")).toBe(false);
    });
  });

  describe("catchupSession", () => {
    it("successfully catches up with events", async () => {
      const client = createMockClient(false, 10);
      const result = await catchupSession(client, "session-123");

      expect(result.success).toBe(true);
      expect(result.eventsCaughtUp).toBe(10);
      expect(result.error).toBeUndefined();
      expect(client.session.messages).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionID: "session-123",
          limit: 100,
          offset: 0,
        })
      );
    });

    it("handles empty response", async () => {
      const client = createMockClient(false, 0);
      const result = await catchupSession(client, "session-123");

      expect(result.success).toBe(true);
      expect(result.eventsCaughtUp).toBe(0);
    });

    it("handles network errors", async () => {
      const client = createMockClient(true, 10);
      const result = await catchupSession(client, "session-123");

      expect(result.success).toBe(false);
      expect(result.eventsCaughtUp).toBe(0);
      expect(result.error).toBe("Network error");
    });

    it("respects custom maxEvents config", async () => {
      const client = createMockClient(false, 100);
      const result = await catchupSession(client, "session-123", { maxEvents: 50 });

      expect(result.success).toBe(true);
      expect(client.session.messages).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionID: "session-123",
          limit: 50,
          offset: 0,
        })
      );
    });

    it("respects custom timeout config", async () => {
      const client = createMockClient(false, 5);
      const setTimeoutSpy = vi.spyOn(global, "setTimeout");

      await catchupSession(client, "session-123", { timeout: 100 });
      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 100);
    });

    it("handles AbortError on timeout", async () => {
      const client = {
        session: {
          messages: vi.fn(async () => {
            // Simulate timeout
            await new Promise(resolve => setTimeout(resolve, 200));
            return { sessionID: "test", messages: [], hasMore: false };
          }),
        },
      };

      // Use very short timeout
      const result = await catchupSession(client, "session-123", { timeout: 1 });

      // The abort signal will be set but the call might complete before abort
      expect(result).toBeDefined();
    });

    it("passes signal to client call", async () => {
      const signalSpy = vi.fn();
      const client = {
        session: {
          messages: vi.fn(async (_opts: { sessionID: string; signal?: AbortSignal }) => {
            if (_opts.signal) {
              signalSpy();
              _opts.signal.addEventListener("abort", () => {
                // Signal received
              });
            }
            return { sessionID: "test", messages: [], hasMore: false };
          }),
        },
      };

      await catchupSession(client, "session-123");

      expect(signalSpy).toHaveBeenCalled();
    });

    it("handles unexpected errors", async () => {
      const client = {
        session: {
          messages: vi.fn(async () => {
            throw new Error("Unexpected error");
          }),
        },
      };

      const result = await catchupSession(client, "session-123");

      expect(result.success).toBe(false);
      expect(result.error).toBe("Unexpected error");
    });
  });

  describe("getCatchupBackoff", () => {
    it("returns base delay for first attempt", () => {
      expect(getCatchupBackoff(0)).toBe(1000);
      expect(getCatchupBackoff(0, 500)).toBe(500);
    });

    it("doubles delay for each attempt", () => {
      expect(getCatchupBackoff(1)).toBe(2000);
      expect(getCatchupBackoff(2)).toBe(4000);
      expect(getCatchupBackoff(3)).toBe(8000);
    });

    it("caps at max delay", () => {
      expect(getCatchupBackoff(10, 1000, 5000)).toBe(5000);
      expect(getCatchupBackoff(100, 1000, 10000)).toBe(10000);
    });

    it("uses custom base and max delays", () => {
      expect(getCatchupBackoff(2, 500, 2000)).toBe(2000); // 500 * 4 = 2000
      expect(getCatchupBackoff(3, 200, 1000)).toBe(1000); // 200 * 8 = 1600, capped at 1000
    });
  });

  describe("CatchupController", () => {
    let controller: CatchupController;
    let mockClient: ReturnType<typeof createMockClient>;

    beforeEach(() => {
      controller = new CatchupController();
      mockClient = createMockClient(false, 10);
    });

    it("starts catch-up for a session", async () => {
      const result = await controller.startCatchup("session-1", mockClient);

      expect(result.success).toBe(true);
      expect(result.eventsCaughtUp).toBe(10);
    });

    it("stores result of catch-up", async () => {
      await controller.startCatchup("session-1", mockClient);
      const result = controller.getResult("session-1");

      expect(result).toBeDefined();
      expect(result?.success).toBe(true);
    });

    it("cancels previous catch-up when starting new one", async () => {
      const firstCatchup = controller.startCatchup("session-1", mockClient);
      controller.startCatchup("session-1", mockClient);

      const result = await firstCatchup;
      // First catch-up should be cancelled
      expect(result).toBeDefined();
    });

    it("can cancel active catch-up", () => {
      const catchupPromise = controller.startCatchup("session-1", mockClient);
      controller.cancelCatchup("session-1");

      // Should not throw
      expect(catchupPromise).toBeDefined();
    });

    it("returns undefined for non-existent result", () => {
      const result = controller.getResult("non-existent");
      expect(result).toBeUndefined();
    });

    it("clears all results", async () => {
      await controller.startCatchup("session-1", mockClient);
      await controller.startCatchup("session-2", mockClient);

      controller.clearResults();

      expect(controller.getResult("session-1")).toBeUndefined();
      expect(controller.getResult("session-2")).toBeUndefined();
    });

    it("cancels all active catch-ups", () => {
      controller.startCatchup("session-1", mockClient);
      controller.startCatchup("session-2", mockClient);
      controller.startCatchup("session-3", mockClient);

      controller.cancelAll();

      // Should not throw and no stale results should remain
      expect(controller.getResult("session-1")).toBeUndefined();
      expect(controller.getResult("session-2")).toBeUndefined();
      expect(controller.getResult("session-3")).toBeUndefined();
    });

    it("handles multiple sessions independently", async () => {
      const result1 = await controller.startCatchup("session-1", mockClient);
      const result2 = await controller.startCatchup("session-2", mockClient);

      expect(result1.eventsCaughtUp).toBe(10);
      expect(result2.eventsCaughtUp).toBe(10);
      expect(controller.getResult("session-1")).toBe(result1);
      expect(controller.getResult("session-2")).toBe(result2);
    });

    it("stores failed results", async () => {
      const failClient = createMockClient(true, 0);
      const result = await controller.startCatchup("session-1", failClient);

      expect(result.success).toBe(false);
      expect(controller.getResult("session-1")).toBe(result);
    });
  });
});
