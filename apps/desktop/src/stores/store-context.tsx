import {
  createContext,
  onCleanup,
  type ParentComponent,
  useContext,
} from "solid-js";
import { api, type Client } from "~/lib/api";
import { type Actions, createActions } from "./server/actions.ts";
import { createServerStore, type ServerStore } from "./server/server-store.ts";
import { createWsClient, type WsClient } from "./server/ws-client.ts";
import { SessionRegistry } from "./session/session-registry.ts";
import { TerminalRegistry } from "./terminal/terminal-registry.ts";

const API_URL = window.location.origin;

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
