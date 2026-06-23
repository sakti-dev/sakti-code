import type { AgentHarnessEvent } from "@sakti-code/agent";
import type { WsIn, WsOut } from "@sakti-code/server/ws";
import { dispatchEvent } from "./event-reducer.ts";
import type { ServerActions, ServerStoreData } from "./server-store.ts";
import type { SessionRegistry } from "./session-registry.ts";
import type { TerminalRegistry } from "./terminal-registry.ts";
import { createTokenBatcher } from "./token-batcher.ts";
import { setIsStreaming } from "./ui-signals.ts";

const RECONNECT_DELAY_MS = 2000;

export interface WsClient {
  disconnect: () => void;
  send: (msg: WsIn) => void;
}

export interface WsClientDeps {
  serverStore: { store: ServerStoreData; actions: ServerActions };
  sessionRegistry: SessionRegistry;
  terminalRegistry: TerminalRegistry;
}

/**
 * Minimal Hono client shape — only the .ws.$ws() path.
 * This lets tests inject a mock without constructing a full hc client.
 */
export interface WsConnectable {
  ws: {
    $ws: () => WebSocket;
  };
}

export function createWsClient(
  api: WsConnectable,
  deps: WsClientDeps
): WsClient {
  const { serverStore: server, sessionRegistry, terminalRegistry } = deps;
  let conn: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let shouldReconnect = true;

  const batchers = new Map<string, ReturnType<typeof createTokenBatcher>>();

  function getBatcher(sessionId: string) {
    let b = batchers.get(sessionId);
    if (!b) {
      const session = sessionRegistry.get(sessionId);
      b = createTokenBatcher((msgId, text) => {
        session.actions.appendToken(msgId, text);
      });
      batchers.set(sessionId, b);
    }
    return b;
  }

  function updateStreamingState(evt: AgentHarnessEvent): void {
    if (evt.type === "agent_start") {
      setIsStreaming(true);
    } else if (evt.type === "agent_end" || evt.type === "abort") {
      setIsStreaming(false);
    }
  }

  function handleFrame(data: WsOut): void {
    switch (data.type) {
      case "welcome":
        server.actions.setConnectionStatus("open");
        break;

      case "event": {
        if (!data.sessionId || data.event === undefined) {
          break;
        }
        const evt = data.event as AgentHarnessEvent;
        updateStreamingState(evt);
        const batcher = getBatcher(data.sessionId);
        dispatchEvent(
          sessionRegistry.get(data.sessionId).actions,
          batcher,
          evt
        );
        break;
      }

      case "error": {
        if (!(data.sessionId && data.error)) {
          break;
        }
        const session = sessionRegistry.get(data.sessionId);
        const msgId = session.store.streaming.currentMessageId;
        if (msgId) {
          session.actions.setError(msgId, data.error);
        }
        break;
      }

      case "push": {
        if (data.channel === "terminal.data") {
          const d = data.data as { terminalId: string; data: string };
          terminalRegistry.get(d.terminalId).appendData(d.data);
        } else if (data.channel === "terminal.exit") {
          const d = data.data as { terminalId: string; exitCode: number };
          terminalRegistry.get(d.terminalId).setExit(d.exitCode);
        }
        break;
      }
    }
  }

  function connect(): void {
    console.log("[ws] connecting...");
    server.actions.setConnectionStatus("connecting");
    conn = api.ws.$ws();

    conn.addEventListener("open", () => {
      console.log("[ws] connected");
      server.actions.setConnectionStatus("open");
    });

    conn.addEventListener("message", (event) => {
      const frame = JSON.parse((event as MessageEvent).data as string) as WsOut;
      handleFrame(frame);
    });

    conn.addEventListener("close", () => {
      console.log("[ws] closed");
      server.actions.setConnectionStatus("closed");
      conn = null;
      if (shouldReconnect) {
        reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
      }
    });
  }

  connect();

  return {
    send(msg: WsIn) {
      if (conn && conn.readyState === 1) {
        conn.send(JSON.stringify(msg));
      }
    },
    disconnect() {
      shouldReconnect = false;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }
      conn?.close();
    },
  };
}
