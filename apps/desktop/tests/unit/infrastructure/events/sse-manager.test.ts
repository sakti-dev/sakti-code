import type { ServerEvent } from "@sakti-code/shared/event-types";
import { createRoot } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  onEvent: undefined as ((event: ServerEvent) => void) | undefined,
  connect: vi.fn(),
  disconnect: vi.fn(),
}));

vi.mock("@/core/services/sse/event-source", () => ({
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
    const { createSSEManager } = await import("@/core/services/sse/sse-manager");

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

  it("preserves all sequential status events in a batch window", async () => {
    const { createSSEManager } = await import("@/core/services/sse/sse-manager");

    await createRoot(async dispose => {
      const manager = createSSEManager({ baseUrl: "http://localhost:3000" });
      const seen: Array<{ sequence?: number; status?: string }> = [];
      const unlisten = manager.onEvent((_directory, event) => {
        const status = (event.properties as { status?: { type?: string } })?.status?.type;
        seen.push({ sequence: event.sequence, status });
      });

      manager.connect();

      const base = {
        type: "session.status" as const,
        directory: "/repo",
        sessionID: "019c4da0-fc0b-713c-984e-b2aca339c9dd",
      };

      state.onEvent?.({
        ...base,
        properties: {
          sessionID: base.sessionID,
          status: { type: "busy" as const },
        },
        eventId: "019c4da0-fc0b-713c-984e-b2aca339c9e0",
        sequence: 10,
        timestamp: 1700000000010,
      });
      state.onEvent?.({
        ...base,
        properties: {
          sessionID: base.sessionID,
          status: { type: "busy" as const },
        },
        eventId: "019c4da0-fc0b-713c-984e-b2aca339c9e1",
        sequence: 11,
        timestamp: 1700000000011,
      });
      state.onEvent?.({
        ...base,
        properties: {
          sessionID: base.sessionID,
          status: { type: "idle" as const },
        },
        eventId: "019c4da0-fc0b-713c-984e-b2aca339c9e2",
        sequence: 12,
        timestamp: 1700000000012,
      });

      vi.runAllTimers();

      expect(seen.map(item => item.sequence)).toEqual([10, 11, 12]);
      expect(seen.map(item => item.status)).toEqual(["busy", "busy", "idle"]);

      unlisten();
      dispose();
    });
  });
});
