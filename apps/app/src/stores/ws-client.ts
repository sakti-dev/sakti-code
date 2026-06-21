import type { AgentHarnessEvent } from "@sakti-code/agent";
import type { WsIn, WsOut } from "@sakti-code/server/ws";
import { dispatchEvent } from "./event-reducer.ts";
import { getServerStore } from "./server-store.ts";
import { getSessionStore } from "./session-registry.ts";
import { getTerminalStore } from "./terminal-registry.ts";
import { createTokenBatcher } from "./token-batcher.ts";

const RECONNECT_DELAY_MS = 2000;

export interface WsClient {
  disconnect: () => void;
  send: (msg: WsIn) => void;
}

export function createWsClient(
  url: string,
  WebSocketCtor: typeof WebSocket = WebSocket
): WsClient {
  const server = getServerStore();
  let ws: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let shouldReconnect = true;

  const batchers = new Map<string, ReturnType<typeof createTokenBatcher>>();

  function getBatcher(sessionId: string) {
    let b = batchers.get(sessionId);
    if (!b) {
      const session = getSessionStore(sessionId);
      b = createTokenBatcher((msgId, text) => {
        session.actions.appendToken(msgId, text);
      });
      batchers.set(sessionId, b);
    }
    return b;
  }

  function handleFrame(data: WsOut): void {
    switch (data.type) {
      case "welcome":
        server.actions.setConnectionStatus("open");
        break;

      case "event": {
        const session = getSessionStore(data.sessionId);
        const batcher = getBatcher(data.sessionId);
        dispatchEvent(
          session.actions,
          batcher,
          data.event as AgentHarnessEvent
        );
        break;
      }

      case "error": {
        const session = getSessionStore(data.sessionId);
        const msgId = session.store.streaming.currentMessageId;
        if (msgId) {
          session.actions.setError(msgId, data.error);
        }
        break;
      }

      case "push": {
        if (data.channel === "terminal.data") {
          const d = data.data as { terminalId: string; data: string };
          getTerminalStore(d.terminalId).appendData(d.data);
        } else if (data.channel === "terminal.exit") {
          const d = data.data as { terminalId: string; exitCode: number };
          getTerminalStore(d.terminalId).setExit(d.exitCode);
        }
        break;
      }
    }
  }

  function connect(): void {
    server.actions.setConnectionStatus("connecting");
    ws = new WebSocketCtor(url);

    ws.onopen = () => {
      server.actions.setConnectionStatus("open");
    };

    ws.onmessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data) as WsOut;
        handleFrame(data);
      } catch {
        // ignore malformed frames
      }
    };

    ws.onclose = () => {
      server.actions.setConnectionStatus("closed");
      ws = null;
      if (shouldReconnect) {
        reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
      }
    };
  }

  connect();

  return {
    send(msg: WsIn) {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg));
      }
    },
    disconnect() {
      shouldReconnect = false;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }
      ws?.close();
    },
  };
}
