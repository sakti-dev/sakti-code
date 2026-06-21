import type { AgentHarnessEvent } from "@sakti-code/agent";
import { dispatchEvent } from "./event-reducer.ts";
import type { ServerActions, ServerStoreData } from "./server-store.ts";
import type { SessionRegistry } from "./session-registry.ts";
import type { TerminalRegistry } from "./terminal-registry.ts";
import { createTokenBatcher } from "./token-batcher.ts";

const RECONNECT_DELAY_MS = 2000;

export interface WsClient {
  disconnect: () => void;
  send: (msg: WsInMessage) => void;
}

export interface WsClientDeps {
  serverStore: { store: ServerStoreData; actions: ServerActions };
  sessionRegistry: SessionRegistry;
  terminalRegistry: TerminalRegistry;
}

/**
 * Minimal treaty client shape — only the .ws.subscribe() path.
 * This lets tests inject a mock without constructing a full treaty client.
 */
export interface WsSubscribeApi {
  ws: {
    subscribe: () => EdenWSLike;
  };
}

/**
 * Minimal EdenWS interface — the subset of EdenWS methods we use.
 * EdenWS has more methods, but we only need these.
 */
export interface EdenWSLike {
  close: () => void;
  on: (
    type: "open" | "message" | "close" | "error",
    listener: (event: { data?: unknown }) => void
  ) => void;
  send: (data: unknown) => void;
  ws: { readyState: number };
}

/** Inbound message type (client to server) */
type WsInMessage =
  | { type: "prompt"; sessionId: string; message: string }
  | { type: "abort"; sessionId: string }
  | { type: "steer"; sessionId: string; message: string }
  | { type: "followUp"; sessionId: string; message: string };

export function createWsClient(
  api: WsSubscribeApi,
  deps: WsClientDeps
): WsClient {
  const { serverStore: server, sessionRegistry, terminalRegistry } = deps;
  let conn: EdenWSLike | null = null;
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

  function handleFrame(data: unknown): void {
    const frame = data as {
      type: string;
      sessionId?: string;
      error?: string;
      channel?: string;
      data?: unknown;
      event?: unknown;
    };

    switch (frame.type) {
      case "welcome":
        server.actions.setConnectionStatus("open");
        break;

      case "event": {
        if (!frame.sessionId || frame.event === undefined) {
          break;
        }
        const session = sessionRegistry.get(frame.sessionId);
        const batcher = getBatcher(frame.sessionId);
        dispatchEvent(
          session.actions,
          batcher,
          frame.event as AgentHarnessEvent
        );
        break;
      }

      case "error": {
        if (!(frame.sessionId && frame.error)) {
          break;
        }
        const session = sessionRegistry.get(frame.sessionId);
        const msgId = session.store.streaming.currentMessageId;
        if (msgId) {
          session.actions.setError(msgId, frame.error);
        }
        break;
      }

      case "push": {
        if (frame.channel === "terminal.data") {
          const d = frame.data as { terminalId: string; data: string };
          terminalRegistry.get(d.terminalId).appendData(d.data);
        } else if (frame.channel === "terminal.exit") {
          const d = frame.data as { terminalId: string; exitCode: number };
          terminalRegistry.get(d.terminalId).setExit(d.exitCode);
        }
        break;
      }
    }
  }

  function connect(): void {
    server.actions.setConnectionStatus("connecting");
    conn = api.ws.subscribe();

    conn.on("open", () => {
      server.actions.setConnectionStatus("open");
    });

    conn.on("message", (event) => {
      handleFrame(event.data);
    });

    conn.on("close", () => {
      server.actions.setConnectionStatus("closed");
      conn = null;
      if (shouldReconnect) {
        reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
      }
    });
  }

  connect();

  return {
    send(msg: WsInMessage) {
      if (conn && conn.ws.readyState === 1) {
        conn.send(msg);
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
