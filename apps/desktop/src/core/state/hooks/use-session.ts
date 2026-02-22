/**
 * useSession Hook
 *
 * Session persistence and management for chat conversations.
 * Stores session ID in localStorage per workspace for conversation continuity.
 *
 * Features:
 * - Automatic localStorage persistence
 * - Workspace-scoped session storage
 * - Session restore on page load
 * - Clear session functionality
 * - Comprehensive logging
 */
import { createLogger } from "@/core/shared/logger";
import { createEffect, createSignal, type Accessor } from "solid-js";

const logger = createLogger("desktop:session");

/**
 * Options for useSession hook
 */
export interface UseSessionOptions {
  /** Workspace directory path (reactive accessor) */
  workspace: Accessor<string>;

  /** Storage key prefix (default: "sakti-code-session") */
  storageKeyPrefix?: string;
}

/**
 * Result returned by useSession hook
 */
export interface UseSessionResult {
  /** Current session ID (reactive accessor) */
  sessionId: Accessor<string | null>;

  /** Set the session ID */
  setSessionId: (id: string | null) => void;

  /** Clear the session (removes from localStorage) */
  clearSession: () => void;

  /** Whether a session exists for current workspace */
  hasSession: Accessor<boolean>;
}

/**
 * Hook for managing session persistence
 *
 * @example
 * ```tsx
 * function Workspace() {
 *   const workspace = () => "/path/to/project";
 *
 *   const session = useSession({ workspace });
 *
 *   // Pass to useChat
 *   const chat = useChat({
 *     client,
 *     workspace,
 *     initialSessionId: session.sessionId() ?? undefined,
 *   });
 *
 *   // Sync session ID from chat responses
 *   createEffect(() => {
 *     const chatSessionId = chat.sessionId();
 *     if (chatSessionId && chatSessionId !== session.sessionId()) {
 *       session.setSessionId(chatSessionId);
 *     }
 *   });
 *
 *   return <div>Session: {session.sessionId()}</div>;
 * }
 * ```
 */
export function useSession(options: UseSessionOptions): UseSessionResult {
  const { workspace, storageKeyPrefix = "sakti-code-session" } = options;

  logger.debug("useSession hook initialized", { storageKeyPrefix });

  /**
   * Get storage key for current workspace
   */
  const getStorageKey = () => {
    const ws = workspace();
    if (!ws) {
      logger.debug("No workspace for session storage key");
      return null;
    }
    // Create a safe key from workspace path
    const safeKey = ws.replace(/[^a-zA-Z0-9]/g, "_");
    return `${storageKeyPrefix}:${safeKey}`;
  };

  /**
   * Load session from localStorage
   */
  const loadSession = (): string | null => {
    const key = getStorageKey();
    if (!key) return null;
    try {
      const sessionId = localStorage.getItem(key);
      if (sessionId) {
        logger.debug("Session loaded from storage", { key, sessionId });
      } else {
        logger.debug("No stored session found", { key });
      }
      return sessionId;
    } catch (e) {
      logger.error("Failed to load session from localStorage", e as Error, { key });
      return null;
    }
  };

  /**
   * Save session to localStorage
   */
  const saveSession = (id: string | null) => {
    const key = getStorageKey();
    if (!key) return;
    try {
      if (id) {
        localStorage.setItem(key, id);
        logger.debug("Session saved to storage", { key, sessionId: id });
      } else {
        localStorage.removeItem(key);
        logger.debug("Session removed from storage", { key });
      }
    } catch (e) {
      logger.error("Failed to save session to localStorage", e as Error, { key });
    }
  };

  // Initialize with stored session
  const initialSessionId = loadSession();
  logger.info("Session initialized", {
    hasSession: !!initialSessionId,
    sessionId: initialSessionId ?? undefined,
  });
  const [sessionId, setSessionIdInternal] = createSignal<string | null>(initialSessionId);

  /**
   * Persist to localStorage when session changes
   */
  createEffect(() => {
    const id = sessionId();
    saveSession(id);
  });

  /**
   * Reload session when workspace changes
   */
  createEffect(() => {
    // This effect runs when workspace() changes
    const ws = workspace();
    if (ws) {
      const storedId = loadSession();
      logger.info("Workspace changed, reloading session", {
        workspace: ws,
        sessionId: storedId ?? undefined,
      });
      setSessionIdInternal(storedId);
    }
  });

  /**
   * Set session ID (updates both signal and localStorage)
   */
  const setSessionId = (id: string | null) => {
    logger.info("Setting session ID", { sessionId: id ?? undefined });
    setSessionIdInternal(id);
    // Note: localStorage update happens via createEffect
  };

  /**
   * Clear session for current workspace
   */
  const clearSession = () => {
    logger.info("Clearing session");
    setSessionIdInternal(null);
    const key = getStorageKey();
    if (key) {
      try {
        localStorage.removeItem(key);
        logger.debug("Session cleared from storage", { key });
      } catch (e) {
        logger.error("Failed to clear session from localStorage", e as Error, { key });
      }
    }
  };

  /**
   * Check if session exists
   */
  const hasSession = () => !!sessionId();

  return {
    sessionId,
    setSessionId,
    clearSession,
    hasSession,
  };
}
