import type { ServerEvent } from "@ekacode/shared/event-types";
import { createRoot } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  onEvent: undefined as ((event: ServerEvent) => void) | undefined,
  connect: vi.fn(),
  disconnect: vi.fn(),
}));

vi.mock("../../../../src/infrastructure/events/event-source", () => ({
  createEventSource: (config: { onEvent?: (event: ServerEvent) => void }) => {
    state.onEvent = config.onEvent;
    return {
      connect: state.connect,
      disconnect: state.disconnect,
      isConnected: () => true,
      getStatus: () => "connected" as const,
      getMetrics: () => ({
        connectionAttempts: 1,
        successfulConnections: 1,
        totalEventsReceived: 0,
        totalErrors: 0,
        currentReconnectDelay: 0,
      }),
    };
  },
}));

describe("SSE manager", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    state.onEvent = undefined;
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("preserves event integrity metadata from SSE payload", async () => {
    const { createSSEManager } = await import("../../../../src/infrastructure/events/sse-manager");

    await createRoot(async dispose => {
      const manager = createSSEManager({ baseUrl: "http://localhost:3000" });
      const seen: Array<{ directory: string; event: ServerEvent }> = [];
      const unlisten = manager.onEvent((directory, event) => seen.push({ directory, event }));

      manager.connect();

      const sourceEvent: ServerEvent = {
        type: "session.status",
        properties: {
          sessionID: "019c4da0-fc0b-713c-984e-b2aca339c9dd",
          status: { type: "busy" },
        },
        directory: "/repo",
        eventId: "019c4da0-fc0b-713c-984e-b2aca339c9de",
        sequence: 42,
        timestamp: 1700000000000,
        sessionID: "019c4da0-fc0b-713c-984e-b2aca339c9dd",
      };

      state.onEvent?.(sourceEvent);
      vi.runAllTimers();

      expect(seen).toHaveLength(1);
      expect(seen[0].directory).toBe("/repo");
      expect(seen[0].event).toMatchObject(sourceEvent);

      unlisten();
      dispose();
    });
  });
});
