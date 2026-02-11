/**
 * Session Context
 *
 * Provides session state and operations for the session domain.
 * Wraps SessionStore with typed API for convenient access.
 *
 * Part of Phase 4: Component Refactor with Domain Contexts
 */

import type { SessionStatusPayload } from "@ekacode/shared/event-types";
import { useSessionStore } from "@renderer/presentation/providers/store-provider";
import { Component, createContext, JSX, useContext } from "solid-js";
import {
  getActiveSessions,
  getByDirectory,
  getById,
  getStatus,
} from "../../core/domain/session/session-queries";
import type { SessionInfo } from "../../core/stores/session-store";

interface SessionContextValue {
  // Queries
  getByDirectory: (directory: string) => SessionInfo[];
  getById: (sessionId: string) => SessionInfo | undefined;
  getStatus: (sessionId: string) => ReturnType<typeof getStatus>;
  getActiveSessions: (directory: string) => SessionInfo[];

  // Commands
  setStatus: (sessionId: string, status: SessionStatusPayload["status"]) => void;
  pin: (directory: string) => void;
  unpin: (directory: string) => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export const SessionProvider: Component<{ children: JSX.Element }> = props => {
  const [sessionState, sessionActions] = useSessionStore();

  const value: SessionContextValue = {
    getByDirectory: (directory: string) => getByDirectory(sessionState, directory),
    getById: (sessionId: string) => getById(sessionState, sessionId),
    getStatus: (sessionId: string) => getStatus(sessionState, sessionId),
    getActiveSessions: (directory: string) => getActiveSessions(sessionState, directory),
    setStatus: sessionActions.setStatus,
    pin: (directory: string) => {
      // TODO: Integrate with LRU system
      console.warn("[SessionContext] pin not implemented yet", directory);
    },
    unpin: (directory: string) => {
      // TODO: Integrate with LRU system
      console.warn("[SessionContext] unpin not implemented yet", directory);
    },
  };

  return <SessionContext.Provider value={value}>{props.children}</SessionContext.Provider>;
};

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error("useSession must be used within SessionProvider");
  }
  return context;
}
