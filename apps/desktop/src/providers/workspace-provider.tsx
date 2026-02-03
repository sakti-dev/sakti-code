/**
 * WorkspaceProvider - Context provider for workspace state
 *
 * Provides centralized state management for the workspace view including:
 * - Workspace path and project info
 * - API client instance
 * - Session list management
 * - Chat integration via useChat hook
 * - Permission handling
 *
 * This provider should wrap the entire workspace view.
 */
import { useParams } from "@solidjs/router";
import {
  createContext,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  useContext,
  type Accessor,
  type JSX,
  type ParentComponent,
} from "solid-js";
import { useChat, type UseChatResult } from "../hooks/use-chat";
import { usePermissions, type UsePermissionsResult } from "../hooks/use-permissions";
import { useSession } from "../hooks/use-session";
import { EkacodeApiClient, type SessionInfo } from "../lib/api-client";
import type { WorkspaceState } from "../types";

// ============================================================
// Types
// ============================================================

/**
 * Session with UI-specific properties
 */
export interface UISession extends SessionInfo {
  /** Display title (derived from first message or default) */
  title: string;
  /** Whether session is pinned */
  isPinned?: boolean;
  /** Status for UI rendering */
  status: "active" | "archived";
}

/**
 * Workspace context value
 */
export interface WorkspaceContextValue {
  // Workspace info
  workspace: Accessor<string>;
  projectId: Accessor<string>;
  projectName: Accessor<string>;

  // API client
  client: Accessor<EkacodeApiClient | null>;
  isClientReady: Accessor<boolean>;

  // Sessions
  sessions: Accessor<UISession[]>;
  activeSessionId: Accessor<string | null>;
  setActiveSessionId: (id: string | null) => void;
  createSession: () => Promise<string>;
  deleteSession: (id: string) => Promise<void>;
  refreshSessions: () => Promise<void>;
  isLoadingSessions: Accessor<boolean>;

  // Chat (active session)
  chat: Accessor<UseChatResult | null>;

  // Permissions
  permissions: Accessor<UsePermissionsResult | null>;
}

// ============================================================
// Context
// ============================================================

const WorkspaceContext = createContext<WorkspaceContextValue>();

/**
 * Hook to access workspace context
 *
 * @throws Error if used outside WorkspaceProvider
 */
export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) {
    throw new Error("useWorkspace must be used within a WorkspaceProvider");
  }
  return ctx;
}

// ============================================================
// Provider Component
// ============================================================

interface WorkspaceProviderProps {
  children: JSX.Element;
}

/**
 * WorkspaceProvider - Provides workspace state to children
 */
export const WorkspaceProvider: ParentComponent<WorkspaceProviderProps> = props => {
  const params = useParams<{ id: string }>();

  // ---- Workspace State ----
  const [workspaceState, setWorkspaceState] = createSignal<WorkspaceState | null>(null);

  // Load workspace state from sessionStorage
  onMount(() => {
    const stored = sessionStorage.getItem(`workspace:${params.id}`);
    if (stored) {
      try {
        setWorkspaceState(JSON.parse(stored));
      } catch {
        console.error("Failed to parse workspace state");
      }
    }
  });

  const workspace = createMemo(() => workspaceState()?.path ?? "");
  const projectId = createMemo(() => workspaceState()?.projectId ?? params.id);
  const projectName = createMemo(() => workspaceState()?.name ?? "Project");

  // ---- API Client ----
  const [client, setClient] = createSignal<EkacodeApiClient | null>(null);
  const isClientReady = createMemo(() => client() !== null);

  onMount(async () => {
    try {
      const config = await window.ekacodeAPI.server.getConfig();
      setClient(new EkacodeApiClient(config));
    } catch (error) {
      console.error("Failed to initialize API client:", error);
    }
  });

  // ---- Sessions ----
  const [serverSessions, setServerSessions] = createSignal<SessionInfo[]>([]);
  const [isLoadingSessions, setIsLoadingSessions] = createSignal(false);

  // Transform server sessions to UI sessions
  const sessions = createMemo<UISession[]>(() => {
    return serverSessions().map((session, index) => ({
      ...session,
      title: `Session ${index + 1}`, // TODO: Store/fetch title from first message
      status: "active" as const,
    }));
  });

  // Session management via useSession hook
  const sessionHook = useSession({
    workspace,
  });

  const activeSessionId = sessionHook.sessionId;
  const setActiveSessionId = sessionHook.setSessionId;

  /**
   * Fetch sessions from server
   */
  const refreshSessions = async () => {
    const c = client();
    if (!c) return;

    setIsLoadingSessions(true);
    try {
      const list = await c.listSessions();
      setServerSessions(list);
    } catch (error) {
      console.error("Failed to fetch sessions:", error);
    } finally {
      setIsLoadingSessions(false);
    }
  };

  // Load sessions when client is ready
  createEffect(() => {
    if (isClientReady()) {
      refreshSessions();
    }
  });

  /**
   * Create a new session
   * Returns the new session ID
   */
  const createSession = async (): Promise<string> => {
    // Clear the current session to force server to create new one
    setActiveSessionId(null);

    // The next chat message will create a new session
    // For now, just return a temporary ID
    const tempId = `temp-${Date.now()}`;
    return tempId;
  };

  /**
   * Delete a session
   */
  const deleteSession = async (id: string): Promise<void> => {
    const c = client();
    if (!c) return;

    try {
      await c.deleteSession(id);
      // Refresh the list
      await refreshSessions();
      // If deleted session was active, clear it
      if (activeSessionId() === id) {
        setActiveSessionId(null);
      }
    } catch (error) {
      console.error("Failed to delete session:", error);
    }
  };

  // ---- Chat Hook ----
  const chatResult = createMemo<UseChatResult | null>(() => {
    const c = client();
    const ws = workspace();

    if (!c || !ws) return null;

    return useChat({
      client: c,
      workspace: () => ws,
      initialSessionId: activeSessionId() ?? undefined,
      onSessionIdReceived: (id: string) => {
        // Sync session ID from server response
        if (id !== activeSessionId()) {
          setActiveSessionId(id);
          // Refresh sessions to include new one
          refreshSessions();
        }
      },
    });
  });

  // ---- Permissions Hook ----
  const permissionsResult = createMemo<UsePermissionsResult | null>(() => {
    const c = client();
    const ws = workspace();

    if (!c || !ws) return null;

    return usePermissions({
      client: c,
      workspace: () => ws,
      sessionId: activeSessionId,
    });
  });

  // ---- Cleanup ----
  onCleanup(() => {
    // Any cleanup logic
  });

  // ---- Context Value ----
  const contextValue: WorkspaceContextValue = {
    // Workspace
    workspace,
    projectId,
    projectName,

    // Client
    client,
    isClientReady,

    // Sessions
    sessions,
    activeSessionId,
    setActiveSessionId,
    createSession,
    deleteSession,
    refreshSessions,
    isLoadingSessions,

    // Chat
    chat: chatResult,

    // Permissions
    permissions: permissionsResult,
  };

  return (
    <WorkspaceContext.Provider value={contextValue}>{props.children}</WorkspaceContext.Provider>
  );
};

export default WorkspaceProvider;
