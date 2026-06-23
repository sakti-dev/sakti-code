import {
  createContext,
  onCleanup,
  type ParentComponent,
  useContext,
} from "solid-js";
import { api, type Client } from "~/lib/api";
import { type Actions, createActions } from "./actions.ts";
import { createServerStore, type ServerStore } from "./server-store.ts";
import { SessionRegistry } from "./session-registry.ts";
import { TerminalRegistry } from "./terminal-registry.ts";
import { createWsClient, type WsClient } from "./ws-client.ts";

const API_URL = window.location.origin;
console.log("[store] API_URL:", API_URL);

export interface StoreContextValue {
  actions: Actions;
  api: Client;
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

  const client = api(API_URL);
  const ws = createWsClient(client, {
    serverStore: server,
    sessionRegistry: sessions,
    terminalRegistry: terminals,
  });
  const actions = createActions(client, ws, {
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
      value={{ server, ws, actions, sessions, terminals, api: client }}
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
