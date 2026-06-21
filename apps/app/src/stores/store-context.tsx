import { treaty } from "@elysiajs/eden";
import type { App } from "@sakti-code/server";
import {
  createContext,
  onCleanup,
  type ParentComponent,
  useContext,
} from "solid-js";
import { type Actions, createActions } from "./actions.ts";
import { getServerStore, type ServerStore } from "./server-store.ts";
import { getSessionStore } from "./session-registry.ts";
import { createWsClient, type WsClient } from "./ws-client.ts";

const api = treaty<App>("http://localhost:3001");
const WS_URL = "ws://localhost:3001/ws";

interface StoreContextValue {
  actions: Actions;
  api: typeof api;
  getSession: typeof getSessionStore;
  server: ServerStore;
  ws: WsClient;
}

const StoreContext = createContext<StoreContextValue>();

export const StoreProvider: ParentComponent = (props) => {
  const server = getServerStore();
  const ws = createWsClient(WS_URL);
  const actions = createActions(api, ws);

  onCleanup(() => {
    ws.disconnect();
  });

  return (
    <StoreContext.Provider
      value={{ server, ws, actions, api, getSession: getSessionStore }}
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
