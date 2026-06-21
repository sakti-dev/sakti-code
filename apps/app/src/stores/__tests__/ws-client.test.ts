import { describe, expect, it } from "vitest";
import { getServerStore } from "../server-store.ts";
import { disposeSessionStore, getSessionStore } from "../session-registry.ts";
import { createWsClient } from "../ws-client.ts";

// Minimal mock WebSocket
class MockWebSocket {
  static instances: MockWebSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  sent: string[] = [];
  readyState = 0;

  constructor(_url: string) {
    MockWebSocket.instances.push(this);
    setTimeout(() => {
      this.readyState = 1;
      this.onopen?.();
    }, 0);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = 3;
    this.onclose?.();
  }

  emit(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }
}

describe("WS client", () => {
  it("sends welcome frame and sets connection to open", async () => {
    MockWebSocket.instances = [];

    await new Promise<void>((resolve) => {
      const server = getServerStore();
      const ws = createWsClient("ws://test", MockWebSocket as never);

      setTimeout(() => {
        expect(MockWebSocket.instances).toHaveLength(1);
        const mockWs = MockWebSocket.instances[0]!;

        mockWs.emit({ type: "welcome", version: "1.0.0", cwd: "/tmp" });
        expect(server.store.connection.status).toBe("open");

        ws.disconnect();
        resolve();
      }, 10);
    });
  });

  it("dispatches event frames to session store", async () => {
    MockWebSocket.instances = [];

    await new Promise<void>((resolve) => {
      const ws = createWsClient("ws://test", MockWebSocket as never);

      setTimeout(() => {
        const mockWs = MockWebSocket.instances[0]!;

        mockWs.emit({
          type: "event",
          sessionId: "s-test",
          event: { type: "agent_start" },
        });

        const session = getSessionStore("s-test");
        expect(session.store.streaming.phase).toBe("thinking");

        disposeSessionStore("s-test");
        ws.disconnect();
        resolve();
      }, 10);
    });
  });

  it("sendPrompt sends a prompt frame", async () => {
    MockWebSocket.instances = [];

    await new Promise<void>((resolve) => {
      const ws = createWsClient("ws://test", MockWebSocket as never);

      setTimeout(() => {
        const mockWs = MockWebSocket.instances[0]!;

        ws.send({ type: "prompt", sessionId: "s1", message: "hello" });

        expect(mockWs.sent).toHaveLength(1);
        const parsed = JSON.parse(mockWs.sent[0]!);
        expect(parsed).toEqual({
          type: "prompt",
          sessionId: "s1",
          message: "hello",
        });

        ws.disconnect();
        resolve();
      }, 10);
    });
  });
});
