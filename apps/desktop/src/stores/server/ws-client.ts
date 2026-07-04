import type { AgentHarnessEvent } from "@sakti-code/agent";
import type { WsIn, WsOut } from "@sakti-code/server/ws";
import { createLogger } from "~/lib/utils";
import {
  dispatchEvent,
  ensureHandlersRegistered,
  type HandlerContext,
} from "../session/event-handler.ts";
import type { SessionRegistry } from "../session/session-registry.ts";
import { createTokenBatcher } from "../session/token-batcher.ts";
import type { TerminalRegistry } from "../terminal/terminal-registry.ts";
import { setIsStreaming, setLastError } from "../workspace/ui-signals.ts";
import type { ServerActions, ServerStoreData } from "./server-store.ts";

ensureHandlersRegistered();

const log = createLogger({ module: "ws-client" });

const INITIAL_RECONNECT_MS = 1000;
const MAX_RECONNECT_MS = 30_000;

export interface WsClient {
  disconnect: () => void;
  send: (msg: WsIn) => void;
}

export interface WsClientDeps {
  serverStore: { store: ServerStoreData; actions: ServerActions };
  sessionRegistry: SessionRegistry;
  terminalRegistry: TerminalRegistry;
}

export interface WsConnectable {
  ws: {
    $ws: () => WebSocket;
  };
}

export function createWsClient(api: WsConnectable, deps: WsClientDeps): WsClient {
  const { serverStore: server, sessionRegistry, terminalRegistry } = deps;
  let conn: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let shouldReconnect = true;
  let reconnectAttempts = 0;

  const batchers = new Map<string, ReturnType<typeof createTokenBatcher>>();

  function getBatcher(sessionId: string) {
    let b = batchers.get(sessionId);
    if (!b) {
      const session = sessionRegistry.get(sessionId);
      const batch = globalThis.localStorage?.getItem("sakti:token-batch") !== "off";
      b = createTokenBatcher(
        (msgId, text) => {
          session.actions.appendTextToken(msgId, text);
        },
        { batch },
      );
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
        log.debug("ws event", {
          sessionId: data.sessionId,
          eventType: evt.type,
        });
        updateStreamingState(evt);
        const session = sessionRegistry.get(data.sessionId);
        const batcher = getBatcher(data.sessionId);
        const ctx: HandlerContext = {
          actions: session.actions,
          batcher,
          store: session.store,
        };
        dispatchEvent(evt, ctx);
        break;
      }

      case "error": {
        if (!(data.sessionId && data.error)) {
          break;
        }
        log.error("ws error", new Error(data.error), {
          sessionId: data.sessionId,
        });
        const session = sessionRegistry.get(data.sessionId);
        const msgId = session.store.streaming.currentMessageId;
        if (msgId) {
          session.actions.setError(msgId, data.error);
        }
        session.actions.finalizeTurn(Date.now());
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

      case "permission.asked": {
        sessionRegistry.get(data.sessionId).actions.setPermission({
          id: data.id,
          permission: data.permission,
          patterns: data.patterns,
          toolName: data.toolName,
          toolCallId: data.toolCallId,
        });
        break;
      }

      case "permission.replied": {
        sessionRegistry.get(data.sessionId).actions.setPermission(null);
        break;
      }
    }
  }

  function scheduleReconnect(): void {
    const delay = Math.min(INITIAL_RECONNECT_MS * 2 ** reconnectAttempts, MAX_RECONNECT_MS);
    reconnectAttempts++;
    reconnectTimer = setTimeout(connect, delay);
  }

  function connect(): void {
    server.actions.setConnectionStatus("connecting");
    conn = api.ws.$ws();

    conn.addEventListener("open", () => {
      reconnectAttempts = 0;
      server.actions.setConnectionStatus("open");
      log.info("ws connected");
    });

    conn.addEventListener("message", (event) => {
      let frame: WsOut;
      try {
        frame = JSON.parse((event as MessageEvent).data as string) as WsOut;
      } catch {
        return;
      }
      handleFrame(frame);
    });

    conn.addEventListener("error", () => {
      log.error("ws error");
      setLastError("WebSocket connection error");
    });

    conn.addEventListener("close", () => {
      server.actions.setConnectionStatus("closed");
      log.warn("ws disconnected");
      conn = null;
      if (shouldReconnect) {
        scheduleReconnect();
      }
    });
  }

  connect();

  return {
    send(msg: WsIn) {
      const sessionMeta = server.store.sessions[msg.sessionId];
      log.debug("ws outgoing", {
        type: msg.type,
        sessionId: msg.sessionId,
        ...("message" in msg ? { messageLength: msg.message.length } : {}),
        ...(sessionMeta?.modelId ? { modelId: sessionMeta.modelId } : {}),
        ...(sessionMeta?.profileId ? { profileId: sessionMeta.profileId } : {}),
        ...(sessionMeta?.thinkingLevel ? { thinkingLevel: sessionMeta.thinkingLevel } : {}),
      });
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
      for (const batcher of batchers.values()) {
        batcher.dispose();
      }
      batchers.clear();
    },
  };
}
