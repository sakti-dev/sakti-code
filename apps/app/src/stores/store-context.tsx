import { treaty } from "@elysiajs/eden";
import type { App } from "@sakti-code/server";
import {
  createContext,
  onCleanup,
  type ParentComponent,
  useContext,
} from "solid-js";
import { type Actions, createActions } from "./actions.ts";
import { createServerStore, type ServerStore } from "./server-store.ts";
import { SessionRegistry } from "./session-registry.ts";
import { TerminalRegistry } from "./terminal-registry.ts";
import { createWsClient, type WsClient } from "./ws-client.ts";

const API_URL = "http://localhost:3001";

export interface StoreContextValue {
  actions: Actions;
  api: ReturnType<typeof treaty<App>>;
  server: ServerStore;
  sessions: SessionRegistry;
  terminals: TerminalRegistry;
  ws: WsClient;
}

const StoreContext = createContext<StoreContextValue>();

export const StoreProvider: ParentComponent = (props) => {
  const server = createServerStore();
  const sessions = new SessionRegistry();
  const terminals = new TerminalRegistry();

  const api = treaty<App>(API_URL);
  const ws = createWsClient(api, {
    serverStore: server,
    sessionRegistry: sessions,
    terminalRegistry: terminals,
  });
  const actions = createActions(api, ws, {
    serverStore: server,
    sessionRegistry: sessions,
  });

  onCleanup(() => {
    ws.disconnect();
    sessions.disposeAll();
    terminals.disposeAll();
  });

  return (
    <StoreContext.Provider
      value={{ server, ws, actions, sessions, terminals, api }}
    >
      {props.children}
    </StoreContext.Provider>
  );
};

export function useStore(): StoreContextValue {
  const ctx = useContext(StoreContext);
  if (!ctx) {
    throw new Error("useStore must be used within StoreProvider");
  }
  return ctx;
}
