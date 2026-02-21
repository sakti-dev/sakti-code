/**
 * WorkspaceProvider - Context provider for workspace state
 *
 * Provides centralized state management for the workspace view including:
 * - Workspace path and project info
 * - API client instance
 * - Session list management
 *
 * This provider should wrap the entire workspace view.
 *
 * Part of Phase 5: Hooks Refactor - Chat and permissions are now
 * provided by ChatProvider instead of WorkspaceProvider.
 */
import type { WorkspaceState } from "@/core/chat/types";
import { EkacodeApiClient, type SessionInfo } from "@/core/services/api/api-client";
import { createLogger } from "@/core/shared/logger";
import { useSession } from "@/core/state/hooks/use-session";
import { useNavigate, useParams } from "@solidjs/router";
import {
  createContext,
  createEffect,
  createMemo,
  createSignal,
  onMount,
  useContext,
  type Accessor,
  type JSX,
  type ParentComponent,
} from "solid-js";

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

  // Note: Chat functionality is now provided by ChatProvider
  // Note: Permissions functionality is now provided by separate context
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
  const logger = createLogger("desktop:workspace-provider");
  const params = useParams<{ id: string }>();
  const navigate = useNavigate();

  // ---- Workspace State ----
  const [workspaceState, setWorkspaceState] = createSignal<WorkspaceState | null>(null);
  const [_isLoadingWorkspace, setIsLoadingWorkspace] = createSignal(true);
  const [_workspaceError, setWorkspaceError] = createSignal<string | null>(null);

  // Fetch workspace from API on mount
  onMount(async () => {
    // Get client first
    let client: EkacodeApiClient | null = null;
    let config: Awaited<ReturnType<typeof window.ekacodeAPI.server.getConfig>>;
    try {
      config = await window.ekacodeAPI.server.getConfig();
      client = new EkacodeApiClient(config);
    } catch (error) {
      console.error("Failed to load API config:", error);
      setWorkspaceError("Failed to initialize API");
      setIsLoadingWorkspace(false);
      return;
    }

    // Fetch workspace details
    try {
      const workspace = await client.getWorkspace(params.id);
      if (workspace) {
        setWorkspaceState({
          path: workspace.path,
          projectId: workspace.id,
          name: workspace.name,
        });
      } else {
        navigate("/");
      }
    } catch (error: unknown) {
      console.error("Failed to load workspace:", error);
      if (error instanceof Response && error.status === 404) {
        navigate("/");
      } else {
        setWorkspaceError("Failed to load workspace");
      }
    } finally {
      setIsLoadingWorkspace(false);
    }

    setClient(client);
  });

  const workspace = createMemo(() => workspaceState()?.path ?? "");
  const projectId = createMemo(() => workspaceState()?.projectId ?? params.id);
  const projectName = createMemo(() => workspaceState()?.name ?? "Project");

  // ---- API Client ----
  const [client, setClient] = createSignal<EkacodeApiClient | null>(null);
  const isClientReady = createMemo(() => client() !== null);

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
      const list = await c.listSessions(params.id);
      setServerSessions(list);

      // Auto-restore latest session if no active session
      if (list.length > 0 && !activeSessionId()) {
        const latestSession = list[0]; // Sessions are sorted by most recent
        setActiveSessionId(latestSession.sessionId);
        logger.info("Auto-restored latest session", { sessionId: latestSession.sessionId });
      }
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
  };

  return (
    <WorkspaceContext.Provider value={contextValue}>{props.children}</WorkspaceContext.Provider>
  );
};

export default WorkspaceProvider;
