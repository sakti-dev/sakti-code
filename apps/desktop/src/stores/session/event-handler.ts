import type { AgentHarnessEvent } from "@sakti-code/agent";
import type { SessionActions, SessionStoreData } from "./session-store.ts";
import type { TokenBatcher } from "./token-batcher.ts";
import { registerCompactionHandlers } from "./handlers/compaction-events.ts";
import { registerLifecycleHandlers } from "./handlers/lifecycle-events.ts";
import { registerMessageHandlers } from "./handlers/message-events.ts";
import { registerOmHandlers } from "./handlers/om-events.ts";
import { registerRetryHandlers } from "./handlers/retry-events.ts";
import { registerToolHandlers } from "./handlers/tool-events.ts";

export interface HandlerContext {
  actions: SessionActions;
  batcher: TokenBatcher;
  store: SessionStoreData;
}

export type EventHandler<E = AgentHarnessEvent> = (event: E, ctx: HandlerContext) => void;

const handlers = new Map<string, EventHandler>();

export function registerHandler<T extends AgentHarnessEvent["type"]>(
  type: T,
  handler: EventHandler<Extract<AgentHarnessEvent, { type: T }>>,
): void {
  handlers.set(type, handler as EventHandler);
}

export function dispatchEvent(event: AgentHarnessEvent, ctx: HandlerContext): void {
  const handler = handlers.get(event.type);
  if (handler) {
    handler(event, ctx);
  }
}

let initialized = false;

export function ensureHandlersRegistered(): void {
  if (initialized) {
    return;
  }
  initialized = true;
  registerLifecycleHandlers();
  registerMessageHandlers();
  registerToolHandlers();
  registerCompactionHandlers();
  registerOmHandlers();
  registerRetryHandlers();
}

export function resetHandlerRegistry(): void {
  handlers.clear();
  initialized = false;
}
