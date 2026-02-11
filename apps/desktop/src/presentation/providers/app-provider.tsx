/**
 * App Provider
 *
 * Root provider that wires SSE, SDK client, and domain stores.
 * Replaces GlobalSyncProvider with new architecture.
 *
 * Phase 2: Wire SSE & Data Flow (Core Functionality)
 *
 * @example
 * ```tsx
 * function App() {
 *   const config = { baseUrl: 'http://localhost:3000', token: 'xxx' };
 *   return (
 *     <AppProvider config={config}>
 *       <YourApp />
 *     </AppProvider>
 *   );
 * }
 * ```
 */

import { StoreProvider, useStores } from "@renderer/presentation/providers/store-provider";
import { Component, JSX, onCleanup, onMount } from "solid-js";
import { applyEventToStores } from "../../core/domain/event-router-adapter";
import { createSDKClient } from "../../infrastructure/api/sdk-client";
import { createSSEManager } from "../../infrastructure/events/sse-manager";
import { createLogger } from "../../lib/logger";
import { MessageProvider } from "../contexts/message-context";
import { PartProvider } from "../contexts/part-context";
import { SessionProvider } from "../contexts/session-context";
import { UIProvider } from "../contexts/ui-context";

interface AppConfig {
  baseUrl: string;
  token?: string;
}

export interface AppProviderProps {
  config: AppConfig;
  children: JSX.Element;
}

interface AppProviderRuntimeProps {
  sseManager: ReturnType<typeof createSSEManager>;
}

const logger = createLogger("desktop:providers:app-provider");

const AppProviderRuntime: Component<AppProviderRuntimeProps> = props => {
  const stores = useStores();
  const [, messageActions] = stores.message;
  const [, partActions] = stores.part;
  const [, sessionActions] = stores.session;

  onMount(() => {
    logger.info("Initializing app runtime");

    const unlisten = props.sseManager.onEvent((directory, event) => {
      logger.debug("SSE event received", {
        directory,
        type: event.type,
        eventId: event.eventId,
        sequence: event.sequence,
        sessionID: event.sessionID,
      });

      void Promise.resolve(
        applyEventToStores(event, messageActions, partActions, sessionActions)
      ).catch(error => {
        logger.error("Failed to apply SSE event", error as Error, {
          type: event.type,
          eventId: event.eventId,
          sequence: event.sequence,
          sessionID: event.sessionID,
        });
      });
    });

    props.sseManager.connect();
    logger.info("SSE manager connected");

    onCleanup(() => {
      logger.info("Disposing app runtime");
      unlisten();
      props.sseManager.disconnect();
    });
  });

  return null;
};

/**
 * AppProvider - Root provider with SSE and domain stores
 *
 * Responsibilities:
 * - Creates SSE manager for server events
 * - Creates SDK client for API calls
 * - Connects SSE events to domain stores via event router adapter
 * - Provides all domain contexts to children
 */
export const AppProvider: Component<AppProviderProps> = props => {
  const { baseUrl, token } = props.config;
  const { children } = props;

  logger.info("Creating app provider", { baseUrl });

  // Create SSE manager
  const sseManager = createSSEManager({ baseUrl, token });

  return (
    <StoreProvider>
      <AppProviderRuntime sseManager={sseManager} />
      <MessageProvider>
        <PartProvider>
          <SessionProvider>
            <UIProvider>{children}</UIProvider>
          </SessionProvider>
        </PartProvider>
      </MessageProvider>
    </StoreProvider>
  );
};

/**
 * Export SDK client getter for external use
 */
export function createAppProviderClient(config: AppConfig) {
  return createSDKClient({
    baseUrl: config.baseUrl,
    token: () => config.token ?? "",
  });
}
