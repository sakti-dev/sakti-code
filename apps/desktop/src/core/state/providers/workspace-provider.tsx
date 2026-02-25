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
import {
  SaktiCodeApiClient,
  type TaskSessionInfo,
  type TaskSessionKind,
  type TaskSessionStatus,
} from "@/core/services/api/api-client";
import { useSession } from "@/core/state/hooks/use-session";
import { useNavigate, useParams } from "@solidjs/router";
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

// ============================================================
// Types
// ============================================================

/**
 * Session with UI-specific properties
 */
export interface UISession {
  /** Stable id used by existing list/card components */
  id: string;
  taskSessionId: string;
  resourceId: string;
  threadId: string;
  workspaceId: string | null;
  /** Display title (derived from first message or default) */
  title: string;
  taskStatus: TaskSessionStatus;
  specType: TaskSessionInfo["specType"];
  sessionKind: TaskSessionInfo["sessionKind"];
  createdAt: string;
  lastAccessed: string;
  lastActivityAt: string;
  /** Whether session is pinned */
  isPinned?: boolean;
  /** Status for UI rendering */
  status: "active" | "archived";
}

interface TaskSessionUpdatedEventPayload {
  taskSessionId: string;
  workspaceId: string | null;
  status: TaskSessionStatus;
  specType: TaskSessionInfo["specType"];
  sessionKind: TaskSessionInfo["sessionKind"];
  title: string | null;
  lastActivityAt: string;
  mutation: "created" | "updated" | "deleted";
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
  client: Accessor<SaktiCodeApiClient | null>;
  isClientReady: Accessor<boolean>;

  // Task sessions
  taskSessions: Accessor<UISession[]>;
  activeTaskSessionId: Accessor<string | null>;
  setActiveTaskSessionId: (id: string | null) => void;
  createTaskSession: (kind?: TaskSessionKind) => Promise<string>;
  deleteTaskSession: (id: string) => Promise<void>;
  refreshTaskSessions: () => Promise<void>;
  isLoadingTaskSessions: Accessor<boolean>;

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
  const params = useParams<{ id: string }>();
  const navigate = useNavigate();

  // ---- Workspace State ----
  const [workspaceState, setWorkspaceState] = createSignal<WorkspaceState | null>(null);
  const [_isLoadingWorkspace, setIsLoadingWorkspace] = createSignal(true);
  const [_workspaceError, setWorkspaceError] = createSignal<string | null>(null);

  // Fetch workspace from API on mount
  onMount(async () => {
    // Get client first
    let client: SaktiCodeApiClient | null = null;
    let config: Awaited<ReturnType<typeof window.saktiCodeAPI.server.getConfig>>;
    try {
      config = await window.saktiCodeAPI.server.getConfig();
      client = new SaktiCodeApiClient(config);
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
  const [client, setClient] = createSignal<SaktiCodeApiClient | null>(null);
  const isClientReady = createMemo(() => client() !== null);

  // ---- Task Sessions ----
  const [serverTaskSessions, setServerTaskSessions] = createSignal<TaskSessionInfo[]>([]);
  const [isLoadingTaskSessions, setIsLoadingTaskSessions] = createSignal(false);

  // Transform server task sessions to UI sessions
  const taskSessions = createMemo<UISession[]>(() => {
    return serverTaskSessions().map((session, index) => ({
      ...session,
      id: session.taskSessionId,
      title: session.title ?? `Task Session ${index + 1}`,
      taskStatus: session.status,
      status: "active" as const,
    }));
  });

  // Session management via useSession hook
  const sessionHook = useSession({
    workspace,
    storageKeyPrefix: "sakti-code-task-session",
  });

  const activeTaskSessionId = sessionHook.sessionId;
  const setActiveTaskSessionId = sessionHook.setSessionId;

  /**
   * Fetch task sessions from server
   */
  const refreshTaskSessions = async () => {
    const c = client();
    if (!c) return;

    setIsLoadingTaskSessions(true);
    try {
      const list = await c.listTaskSessions(params.id, "task");
      setServerTaskSessions(list);
    } catch (error) {
      console.error("Failed to fetch task sessions:", error);
    } finally {
      setIsLoadingTaskSessions(false);
    }
  };

  // Load task sessions when client is ready
  createEffect(() => {
    if (isClientReady()) {
      refreshTaskSessions();
    }
  });

  onMount(() => {
    const handler = (event: Event) => {
      const customEvent = event as CustomEvent<TaskSessionUpdatedEventPayload>;
      const payload = customEvent.detail;
      if (!payload || payload.workspaceId !== params.id || payload.sessionKind !== "task") {
        return;
      }

      if (payload.mutation === "deleted") {
        setServerTaskSessions(prev =>
          prev.filter(session => session.taskSessionId !== payload.taskSessionId)
        );
        if (activeTaskSessionId() === payload.taskSessionId) {
          setActiveTaskSessionId(null);
        }
        return;
      }

      setServerTaskSessions(prev => {
        const existing = prev.find(session => session.taskSessionId === payload.taskSessionId);
        const nowIso = new Date().toISOString();
        const candidate: TaskSessionInfo = {
          taskSessionId: payload.taskSessionId,
          resourceId: existing?.resourceId ?? "",
          threadId: existing?.threadId ?? payload.taskSessionId,
          workspaceId: payload.workspaceId,
          title: payload.title,
          status: payload.status,
          specType: payload.specType,
          sessionKind: payload.sessionKind,
          runtimeMode: existing?.runtimeMode ?? null,
          createdAt: existing?.createdAt ?? nowIso,
          lastAccessed: existing?.lastAccessed ?? nowIso,
          lastActivityAt: payload.lastActivityAt,
        };

        const merged = existing
          ? prev.map(session =>
              session.taskSessionId === payload.taskSessionId ? candidate : session
            )
          : [candidate, ...prev];

        return merged.sort(
          (a, b) => new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime()
        );
      });
    };

    window.addEventListener("sakti-code:task-session.updated", handler as EventListener);
    onCleanup(() => {
      window.removeEventListener("sakti-code:task-session.updated", handler as EventListener);
    });
  });

  /**
   * Create a new task session
   * Returns the new task session ID
   */
  const createTaskSession = async (kind: TaskSessionKind = "task"): Promise<string> => {
    const c = client();
    if (!c) return "";

    const created = await c.createTaskSession({
      resourceId: workspace() || params.id,
      workspaceId: params.id,
      sessionKind: kind,
    });

    setActiveTaskSessionId(created.taskSessionId);
    await refreshTaskSessions();
    return created.taskSessionId;
  };

  /**
   * Delete a task session
   */
  const deleteTaskSession = async (id: string): Promise<void> => {
    const c = client();
    if (!c) return;

    try {
      await c.deleteTaskSession(id);
      // Refresh the list
      await refreshTaskSessions();
      // If deleted task session was active, clear it
      if (activeTaskSessionId() === id) {
        setActiveTaskSessionId(null);
      }
    } catch (error) {
      console.error("Failed to delete task session:", error);
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

    // Task sessions
    taskSessions,
    activeTaskSessionId,
    setActiveTaskSessionId,
    createTaskSession,
    deleteTaskSession,
    refreshTaskSessions,
    isLoadingTaskSessions,
  };

  return (
    <WorkspaceContext.Provider value={contextValue}>{props.children}</WorkspaceContext.Provider>
  );
};

export default WorkspaceProvider;
