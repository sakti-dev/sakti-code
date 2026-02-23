import { render } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
  connect: vi.fn(),
  disconnect: vi.fn(),
  applyEventToStores: vi.fn(),
  eventCallback: null as
    | ((directory: string, event: { type: string; properties: Record<string, unknown> }) => void)
    | null,
}));

vi.mock("@/core/services/sse/sse-manager", () => ({
  createSSEManager: () => ({
    connect: mockState.connect,
    disconnect: mockState.disconnect,
    onEvent: (
      callback: (
        directory: string,
        event: { type: string; properties: Record<string, unknown> }
      ) => void
    ) => {
      mockState.eventCallback = callback;
      return () => {
        mockState.eventCallback = null;
      };
    },
  }),
}));

vi.mock("@/core/chat/domain/event-router-adapter", () => ({
  applyEventToStores: mockState.applyEventToStores,
}));

import { AppProvider } from "@/core/state/providers/app-provider";

function mountApp() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const { unmount: dispose } = render(() => (
    <AppProvider config={{ baseUrl: "http://localhost:3000", token: "" }}>
      <div>child</div>
    </AppProvider>
  ));

  return {
    dispose: () => {
      dispose();
      container.remove();
    },
  };
}

afterEach(() => {
  mockState.eventCallback = null;
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

describe("AppProvider", () => {
  it("connects SSE on mount, ingests events into stores, and disconnects on cleanup", async () => {
    const app = mountApp();
    await Promise.resolve();

    expect(mockState.connect).toHaveBeenCalledTimes(1);
    expect(mockState.eventCallback).toBeTypeOf("function");

    const event = {
      type: "session.status",
      properties: {
        sessionID: "s1",
        status: { type: "busy" },
      },
    };
    mockState.eventCallback!("repo", event);

    expect(mockState.applyEventToStores).toHaveBeenCalledTimes(1);
    expect(mockState.applyEventToStores).toHaveBeenCalledWith(
      event,
      expect.objectContaining({ upsert: expect.any(Function) }),
      expect.objectContaining({ upsert: expect.any(Function) }),
      expect.objectContaining({ upsert: expect.any(Function), setStatus: expect.any(Function) }),
      expect.objectContaining({ add: expect.any(Function), resolve: expect.any(Function) }),
      expect.objectContaining({ add: expect.any(Function), answer: expect.any(Function) })
    );

    app.dispose();
    expect(mockState.disconnect).toHaveBeenCalledTimes(1);
  });
});
