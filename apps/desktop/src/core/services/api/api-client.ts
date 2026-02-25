/**
 * SaktiCode API Client
 *
 * Typed API client for communicating with the Hono server from the desktop renderer.
 * Uses the server config from preload (window.saktiCodeAPI.server.getConfig())
 *
 * Features:
 * - Type-safe methods for all API endpoints
 * - Streaming response support for chat
 * - Basic Auth with token from main process
 * - SSE connection for real-time events
 * - Comprehensive logging for all operations
 */

import type { ChatUIMessage } from "@/core/chat/types/ui-message";
import { createLogger } from "@/core/shared/logger";
import { createProviderClient, type ProviderClient } from "./provider-client";

const logger = createLogger("desktop:api");

/**
 * API client configuration
 */
export interface ApiClientConfig {
  /** Base URL of the Hono server (e.g., http://127.0.0.1:3000) */
  baseUrl: string;
  /** Authentication token from the server */
  token: string;
}

/**
 * Chat request options
 */
export interface ChatOptions {
  /** Session ID for conversation continuity */
  sessionId?: string;
  /** User message ID (used as assistant parentID on server) */
  messageId?: string;
  /** Retry an existing failed assistant message without creating a new user turn */
  retryOfAssistantMessageId?: string;
  /** Workspace directory path */
  workspace: string;
  /** Selected provider id from app state */
  providerId?: string;
  /** Selected model id from app state */
  modelId?: string;
  /** Runtime mode for chat/tool behavior */
  runtimeMode?: "intake" | "plan" | "build";
  /** Abort signal for request cancellation */
  signal?: AbortSignal;
}

/**
 * Permission approval response
 */
export interface PermissionResponse {
  success: boolean;
  error?: string;
}

/**
 * Question reply response
 */
export interface QuestionResponse {
  success: boolean;
  error?: string;
}

/**
 * Pending permission request from server
 */
export interface PendingPermission {
  id: string;
  toolName: string;
  args: Record<string, unknown>;
  sessionID: string;
  timestamp: string;
}

/**
 * Pending question request from server
 */
export interface PendingQuestion {
  id: string;
  sessionID: string;
  questions: unknown[];
  tool?: { messageID: string; callID: string };
}

/**
 * Session status from server
 */
export interface SessionStatus {
  sessionId: string;
  status: "active" | "idle" | "completed" | "failed";
  phase?: string;
  lastActivity?: string;
  hasIncompleteWork?: boolean;
}

export type TaskSessionStatus =
  | "researching"
  | "specifying"
  | "implementing"
  | "completed"
  | "failed";

export type TaskSessionSpecType = "comprehensive" | "quick" | null;
export type TaskSessionKind = "intake" | "task";

export interface TaskSessionInfo {
  taskSessionId: string;
  resourceId: string;
  threadId: string;
  workspaceId: string | null;
  title: string | null;
  status: TaskSessionStatus;
  specType: TaskSessionSpecType;
  sessionKind: TaskSessionKind;
  runtimeMode?: "intake" | "plan" | "build" | null;
  createdAt: string;
  lastAccessed: string;
  lastActivityAt: string;
}

export interface CreateTaskSessionPayload {
  resourceId: string;
  workspaceId?: string;
  sessionKind?: TaskSessionKind;
}

export interface UpdateTaskSessionPayload {
  status?: TaskSessionStatus;
  specType?: TaskSessionSpecType;
  title?: string;
}

export interface ProjectKeypointInfo {
  id: string;
  workspaceId: string;
  taskSessionId: string;
  taskTitle: string;
  milestone: "started" | "completed";
  completedAt: string;
  summary: string;
  artifacts: string[];
  createdAt: string;
}

export interface CreateProjectKeypointPayload {
  workspaceId: string;
  taskSessionId: string;
  taskTitle: string;
  milestone: "started" | "completed";
  summary: string;
  artifacts?: string[];
}

/**
 * Workspace info from server
 */
export interface Workspace {
  id: string;
  path: string;
  name: string;
  status: "active" | "archived";
  baseBranch: string | null;
  repoPath: string | null;
  isMerged: boolean;
  archivedAt: string | null;
  createdAt: string;
  lastOpenedAt: string;
}

/**
 * Archive workspace options
 */
export interface ArchiveWorkspaceOptions {
  baseBranch?: string;
  repoPath?: string;
  isMerged?: boolean;
}

/**
 * API Client for SaktiCode Desktop
 *
 * Provides typed methods for all Hono server endpoints.
 * Handles authentication and streaming responses.
 */
export class SaktiCodeApiClient {
  private config: ApiClientConfig;
  private providerClient?: ProviderClient;

  constructor(config: ApiClientConfig) {
    this.config = config;
    logger.info("API client initialized", { baseUrl: config.baseUrl });
  }

  /**
   * Create Basic Auth header value
   */
  private authHeader(): string {
    // Server expects Basic Auth with admin:token
    return `Basic ${btoa(`admin:${this.config.token}`)}`;
  }

  /**
   * Common headers for all requests
   */
  private commonHeaders(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Authorization: this.authHeader(),
    };
  }

  getProviderClient(): ProviderClient {
    if (!this.providerClient) {
      this.providerClient = createProviderClient({
        fetcher: (path, init) =>
          fetch(`${this.config.baseUrl}${path}`, {
            ...init,
            headers: {
              ...this.commonHeaders(),
              ...(init?.headers ? Object.fromEntries(new Headers(init.headers).entries()) : {}),
            },
          }),
      });
    }

    return this.providerClient;
  }

  // ============================================================
  // Chat API
  // ============================================================

  /**
   * Send a chat message and receive streaming response
   *
   * Returns the raw Response object for streaming via ReadableStream.
   * The response follows the AI SDK UIMessage stream protocol.
   *
   * @param messages - All messages in the conversation (for context)
   * @param options - Chat options including workspace and session
   * @returns Response object with streaming body
   *
   * @example
   * ```ts
   * const response = await client.chat(messages, { workspace: "/path/to/project" });
   * const reader = response.body!.getReader();
   * // Consume response body while SSE events update UI state
   * ```
   */
  async chat(messages: ChatUIMessage[], options: ChatOptions): Promise<Response> {
    const headers: Record<string, string> = {
      ...this.commonHeaders(),
    };

    // Include session ID for conversation continuity
    if (options.sessionId) {
      headers["X-Task-Session-ID"] = options.sessionId;
    }

    // Build URL with workspace as query param
    const url = new URL(`${this.config.baseUrl}/api/chat`);
    url.searchParams.set("directory", options.workspace);

    // Get the latest user message (server manages conversation history via session)
    // Note: use-chat adds assistant placeholder before calling API, so find last user message
    const lastUserMessage = messages.filter(m => m.role === "user").pop();
    if (!lastUserMessage) {
      throw new Error("No user message found in messages array");
    }

    // Extract text from message parts to send as simple string
    const messageText = lastUserMessage.parts
      .filter(part => part.type === "text")
      .map(part => (part as { text: string }).text)
      .join("");

    logger.info("Sending chat request", {
      messageCount: messages.length,
      messageLength: messageText.length,
      workspace: options.workspace,
      sessionId: options.sessionId,
    });

    try {
      const response = await fetch(url.toString(), {
        method: "POST",
        headers,
        body: JSON.stringify({
          message: messageText,
          messageId: options.messageId,
          retryOfAssistantMessageId: options.retryOfAssistantMessageId,
          providerId: options.providerId,
          modelId: options.modelId,
          runtimeMode: options.runtimeMode,
          stream: true,
        }),
        signal: options.signal,
      });

      logger.debug("Chat response received", {
        status: response.status,
        ok: response.ok,
        sessionId: response.headers.get("X-Task-Session-ID") ?? undefined,
      });

      return response;
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        logger.debug("Chat request aborted", {
          workspace: options.workspace,
          sessionId: options.sessionId,
        });
      } else {
        logger.error("Chat request failed", error as Error, {
          workspace: options.workspace,
          sessionId: options.sessionId,
        });
      }
      throw error;
    }
  }

  /**
   * Get session status
   *
   * @param sessionId - Session ID to check
   * @returns Session status including phase and incomplete work flag
   */
  async getSessionStatus(sessionId: string): Promise<SessionStatus | null> {
    const url = `${this.config.baseUrl}/api/session/${sessionId}/status`;

    logger.debug("Fetching session status", { sessionId });

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: this.commonHeaders(),
      });

      if (!response.ok) {
        if (response.status === 404) {
          logger.debug("Session not found", { sessionId });
          return null;
        }
        throw new Error(`Failed to get session status: ${response.statusText}`);
      }

      const status = await response.json();
      logger.debug("Session status retrieved", { sessionId, status });
      return status;
    } catch (error) {
      logger.error("Failed to get session status", error as Error, { sessionId });
      throw error;
    }
  }

  // ============================================================
  // Task Sessions API
  // ============================================================

  /**
   * List all task sessions
   *
   * @returns Array of task session info objects
   */
  async listTaskSessions(
    workspaceId?: string,
    kind: TaskSessionKind = "task"
  ): Promise<TaskSessionInfo[]> {
    logger.debug("Listing task sessions", { workspaceId, kind });

    try {
      const url = new URL(`${this.config.baseUrl}/api/task-sessions`);
      if (workspaceId) {
        url.searchParams.set("workspaceId", workspaceId);
      }
      url.searchParams.set("kind", kind);

      const response = await fetch(url.toString(), {
        method: "GET",
        headers: this.commonHeaders(),
      });

      if (!response.ok) {
        throw new Error(`Failed to list task sessions: ${response.statusText}`);
      }

      const data = await response.json();
      const taskSessions = data.taskSessions || [];
      logger.debug("Task sessions retrieved", { count: taskSessions.length, kind });
      return taskSessions;
    } catch (error) {
      logger.error("Failed to list task sessions", error as Error, { workspaceId, kind });
      throw error;
    }
  }

  /**
   * Get a specific task session
   *
   * @param taskSessionId - Task session ID to retrieve
   * @returns Task session info or null if not found
   */
  async getTaskSession(taskSessionId: string): Promise<TaskSessionInfo | null> {
    logger.debug("Fetching task session", { taskSessionId });

    try {
      const response = await fetch(`${this.config.baseUrl}/api/task-sessions/${taskSessionId}`, {
        method: "GET",
        headers: this.commonHeaders(),
      });

      if (!response.ok) {
        if (response.status === 404) {
          logger.debug("Task session not found", { taskSessionId });
          return null;
        }
        throw new Error(`Failed to get task session: ${response.statusText}`);
      }

      const taskSession = await response.json();
      logger.debug("Task session retrieved", { taskSessionId });
      return taskSession;
    } catch (error) {
      logger.error("Failed to get task session", error as Error, { taskSessionId });
      throw error;
    }
  }

  /**
   * Create a task session
   *
   * @param payload - Task session creation payload
   * @returns Created task session
   */
  async createTaskSession(payload: CreateTaskSessionPayload): Promise<TaskSessionInfo> {
    logger.info("Creating task session", {
      resourceId: payload.resourceId,
      workspaceId: payload.workspaceId,
      sessionKind: payload.sessionKind,
    });

    try {
      const response = await fetch(`${this.config.baseUrl}/api/task-sessions`, {
        method: "POST",
        headers: this.commonHeaders(),
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`Failed to create task session: ${response.statusText}`);
      }

      const data = await response.json();
      logger.info("Task session created", { taskSessionId: data.taskSession?.taskSessionId });
      return data.taskSession;
    } catch (error) {
      logger.error("Failed to create task session", error as Error, {
        resourceId: payload.resourceId,
        workspaceId: payload.workspaceId,
        sessionKind: payload.sessionKind,
      });
      throw error;
    }
  }

  /**
   * Update a task session
   *
   * @param taskSessionId - Task session ID to update
   * @param patch - Partial task session fields to update
   * @returns Updated task session
   */
  async updateTaskSession(
    taskSessionId: string,
    patch: UpdateTaskSessionPayload
  ): Promise<TaskSessionInfo> {
    logger.info("Updating task session", { taskSessionId, patch });

    try {
      const response = await fetch(`${this.config.baseUrl}/api/task-sessions/${taskSessionId}`, {
        method: "PATCH",
        headers: this.commonHeaders(),
        body: JSON.stringify(patch),
      });

      if (!response.ok) {
        throw new Error(`Failed to update task session: ${response.statusText}`);
      }

      const data = await response.json();
      logger.info("Task session updated", { taskSessionId });
      return data.taskSession;
    } catch (error) {
      logger.error("Failed to update task session", error as Error, { taskSessionId, patch });
      throw error;
    }
  }

  /**
   * Delete a task session
   *
   * @param taskSessionId - Task session ID to delete
   */
  async deleteTaskSession(taskSessionId: string): Promise<void> {
    logger.info("Deleting task session", { taskSessionId });

    try {
      const response = await fetch(`${this.config.baseUrl}/api/task-sessions/${taskSessionId}`, {
        method: "DELETE",
        headers: this.commonHeaders(),
      });

      if (!response.ok) {
        throw new Error(`Failed to delete task session: ${response.statusText}`);
      }

      logger.info("Task session deleted", { taskSessionId });
    } catch (error) {
      logger.error("Failed to delete task session", error as Error, { taskSessionId });
      throw error;
    }
  }

  /**
   * Get latest task session for workspace
   *
   * @param workspaceId - Workspace ID
   * @returns Task session or null if not found
   */
  async getLatestTaskSession(
    workspaceId: string,
    kind: TaskSessionKind = "task"
  ): Promise<TaskSessionInfo | null> {
    logger.debug("Fetching latest task session for workspace", { workspaceId, kind });

    try {
      const response = await fetch(
        `${this.config.baseUrl}/api/task-sessions/latest?workspaceId=${workspaceId}&kind=${kind}`,
        {
          method: "GET",
          headers: this.commonHeaders(),
        }
      );

      if (!response.ok) {
        if (response.status === 404) {
          logger.debug("No task session found for workspace", { workspaceId, kind });
          return null;
        }
        throw new Error(`Failed to get latest task session: ${response.statusText}`);
      }

      const data = await response.json();
      logger.debug("Latest task session retrieved", { workspaceId, kind });
      return data.taskSession;
    } catch (error) {
      logger.error("Failed to get latest task session", error as Error, { workspaceId, kind });
      throw error;
    }
  }

  // ============================================================
  // Project Keypoints API
  // ============================================================

  async listProjectKeypoints(workspaceId: string): Promise<ProjectKeypointInfo[]> {
    logger.debug("Listing project keypoints", { workspaceId });

    try {
      const response = await fetch(
        `${this.config.baseUrl}/api/project-keypoints?workspaceId=${workspaceId}`,
        {
          method: "GET",
          headers: this.commonHeaders(),
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to list project keypoints: ${response.statusText}`);
      }

      const data = await response.json();
      return data.keypoints ?? [];
    } catch (error) {
      logger.error("Failed to list project keypoints", error as Error, { workspaceId });
      throw error;
    }
  }

  async createProjectKeypoint(payload: CreateProjectKeypointPayload): Promise<ProjectKeypointInfo> {
    logger.info("Creating project keypoint", {
      workspaceId: payload.workspaceId,
      taskSessionId: payload.taskSessionId,
      milestone: payload.milestone,
    });

    try {
      const response = await fetch(`${this.config.baseUrl}/api/project-keypoints`, {
        method: "POST",
        headers: this.commonHeaders(),
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`Failed to create project keypoint: ${response.statusText}`);
      }

      const data = await response.json();
      return data.keypoint;
    } catch (error) {
      logger.error("Failed to create project keypoint", error as Error, payload);
      throw error;
    }
  }

  // ============================================================
  // Workspaces API
  // ============================================================

  /**
   * List active workspaces
   *
   * @returns Array of workspace objects
   */
  async getWorkspaces(): Promise<Workspace[]> {
    logger.debug("Listing active workspaces");

    try {
      const response = await fetch(`${this.config.baseUrl}/api/workspaces`, {
        method: "GET",
        headers: this.commonHeaders(),
      });

      if (!response.ok) {
        throw new Error(`Failed to list workspaces: ${response.statusText}`);
      }

      const data = await response.json();
      const workspaces = data.workspaces || [];
      logger.debug("Workspaces retrieved", { count: workspaces.length });
      return workspaces;
    } catch (error) {
      logger.error("Failed to list workspaces", error as Error);
      throw error;
    }
  }

  /**
   * List archived workspaces
   *
   * @returns Array of archived workspace objects
   */
  async getArchivedWorkspaces(): Promise<Workspace[]> {
    logger.debug("Listing archived workspaces");

    try {
      const response = await fetch(`${this.config.baseUrl}/api/workspaces/archived`, {
        method: "GET",
        headers: this.commonHeaders(),
      });

      if (!response.ok) {
        throw new Error(`Failed to list archived workspaces: ${response.statusText}`);
      }

      const data = await response.json();
      const workspaces = data.workspaces || [];
      logger.debug("Archived workspaces retrieved", { count: workspaces.length });
      return workspaces;
    } catch (error) {
      logger.error("Failed to list archived workspaces", error as Error);
      throw error;
    }
  }

  /**
   * Get workspace by ID
   *
   * @param id - Workspace ID
   * @returns Workspace or null if not found
   */
  async getWorkspace(id: string): Promise<Workspace | null> {
    logger.debug("Fetching workspace", { id });

    try {
      const response = await fetch(`${this.config.baseUrl}/api/workspaces/${id}`, {
        method: "GET",
        headers: this.commonHeaders(),
      });

      if (!response.ok) {
        if (response.status === 404) {
          logger.debug("Workspace not found", { id });
          return null;
        }
        throw new Error(`Failed to get workspace: ${response.statusText}`);
      }

      const data = await response.json();
      logger.debug("Workspace retrieved", { id });
      return data.workspace;
    } catch (error) {
      logger.error("Failed to get workspace", error as Error, { id });
      throw error;
    }
  }

  /**
   * Get workspace by path
   *
   * @param path - Workspace path
   * @returns Workspace or null if not found
   */
  async getWorkspaceByPath(path: string): Promise<Workspace | null> {
    logger.debug("Fetching workspace by path", { path });

    try {
      const response = await fetch(
        `${this.config.baseUrl}/api/workspaces/by-path?path=${encodeURIComponent(path)}`,
        {
          method: "GET",
          headers: this.commonHeaders(),
        }
      );

      if (!response.ok) {
        if (response.status === 404) {
          logger.debug("Workspace not found by path", { path });
          return null;
        }
        throw new Error(`Failed to get workspace by path: ${response.statusText}`);
      }

      const data = await response.json();
      logger.debug("Workspace retrieved by path", { path });
      return data.workspace;
    } catch (error) {
      logger.error("Failed to get workspace by path", error as Error, { path });
      throw error;
    }
  }

  /**
   * Create a new workspace
   *
   * @param path - Workspace path
   * @param name - Optional workspace name
   * @returns Created workspace
   */
  async createWorkspace(path: string, name?: string): Promise<Workspace> {
    logger.info("Creating workspace", { path, name });

    try {
      const response = await fetch(`${this.config.baseUrl}/api/workspaces`, {
        method: "POST",
        headers: { ...this.commonHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ path, name }),
      });

      if (!response.ok) {
        throw new Error(`Failed to create workspace: ${response.statusText}`);
      }

      const data = await response.json();
      logger.info("Workspace created", { id: data.workspace.id });
      return data.workspace;
    } catch (error) {
      logger.error("Failed to create workspace", error as Error, { path });
      throw error;
    }
  }

  /**
   * Archive a workspace
   *
   * @param id - Workspace ID
   * @param options - Optional archive metadata
   */
  async archiveWorkspace(id: string, options?: ArchiveWorkspaceOptions): Promise<Workspace> {
    logger.info("Archiving workspace", { id });

    try {
      const response = await fetch(`${this.config.baseUrl}/api/workspaces/${id}/archive`, {
        method: "PUT",
        headers: { ...this.commonHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(options || {}),
      });

      if (!response.ok) {
        throw new Error(`Failed to archive workspace: ${response.statusText}`);
      }

      const data = await response.json();
      logger.info("Workspace archived", { id });
      return data.workspace;
    } catch (error) {
      logger.error("Failed to archive workspace", error as Error, { id });
      throw error;
    }
  }

  /**
   * Restore an archived workspace
   *
   * @param id - Workspace ID
   */
  async restoreWorkspace(id: string): Promise<Workspace> {
    logger.info("Restoring workspace", { id });

    try {
      const response = await fetch(`${this.config.baseUrl}/api/workspaces/${id}/restore`, {
        method: "PUT",
        headers: this.commonHeaders(),
      });

      if (!response.ok) {
        throw new Error(`Failed to restore workspace: ${response.statusText}`);
      }

      const data = await response.json();
      logger.info("Workspace restored", { id });
      return data.workspace;
    } catch (error) {
      logger.error("Failed to restore workspace", error as Error, { id });
      throw error;
    }
  }

  /**
   * Touch a workspace (update last_opened_at)
   *
   * @param id - Workspace ID
   */
  async touchWorkspace(id: string): Promise<Workspace> {
    logger.debug("Touching workspace", { id });

    try {
      const response = await fetch(`${this.config.baseUrl}/api/workspaces/${id}/touch`, {
        method: "PUT",
        headers: this.commonHeaders(),
      });

      if (!response.ok) {
        throw new Error(`Failed to touch workspace: ${response.statusText}`);
      }

      const data = await response.json();
      logger.debug("Workspace touched", { id });
      return data.workspace;
    } catch (error) {
      logger.error("Failed to touch workspace", error as Error, { id });
      throw error;
    }
  }

  /**
   * Delete a workspace
   *
   * @param id - Workspace ID
   */
  async deleteWorkspace(id: string): Promise<void> {
    logger.info("Deleting workspace", { id });

    try {
      const response = await fetch(`${this.config.baseUrl}/api/workspaces/${id}`, {
        method: "DELETE",
        headers: this.commonHeaders(),
      });

      if (!response.ok) {
        throw new Error(`Failed to delete workspace: ${response.statusText}`);
      }

      logger.info("Workspace deleted", { id });
    } catch (error) {
      logger.error("Failed to delete workspace", error as Error, { id });
      throw error;
    }
  }

  // ============================================================
  // Permissions API
  // ============================================================

  /**
   * Approve or deny a permission request
   *
   * @param id - Permission request ID
   * @param approved - Whether to approve (true) or deny (false)
   * @param patterns - Optional glob patterns to always allow for this session
   */
  async approvePermission(
    id: string,
    approved: boolean,
    patterns?: string[]
  ): Promise<PermissionResponse> {
    logger.info("Submitting permission decision", { id, approved, patterns });

    try {
      const response = await fetch(`${this.config.baseUrl}/api/permissions/approve`, {
        method: "POST",
        headers: this.commonHeaders(),
        body: JSON.stringify({ id, approved, patterns }),
      });

      if (!response.ok) {
        const error = await response.text();
        logger.warn("Permission approval failed", { id, error });
        return { success: false, error };
      }

      logger.info("Permission decision recorded", { id, approved });
      return { success: true };
    } catch (error) {
      logger.error("Failed to submit permission decision", error as Error, { id, approved });
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Get pending permission requests
   *
   * Used for initial load - normally use SSE for real-time updates
   */
  async getPendingPermissions(): Promise<PendingPermission[]> {
    logger.debug("Fetching pending permissions");

    try {
      const response = await fetch(`${this.config.baseUrl}/api/permissions/pending`, {
        method: "GET",
        headers: this.commonHeaders(),
      });

      if (!response.ok) {
        throw new Error(`Failed to get pending permissions: ${response.statusText}`);
      }

      const data = await response.json();
      const pending = data.pending || [];
      logger.debug("Pending permissions retrieved", { count: pending.length });
      return pending;
    } catch (error) {
      logger.error("Failed to fetch pending permissions", error as Error);
      throw error;
    }
  }

  /**
   * Clear all session-specific permission approvals
   *
   * @param sessionId - Session ID to clear approvals for
   */
  async clearSessionApprovals(sessionId: string): Promise<void> {
    logger.info("Clearing session approvals", { sessionId });

    try {
      await fetch(`${this.config.baseUrl}/api/permissions/session/${sessionId}/clear`, {
        method: "POST",
        headers: this.commonHeaders(),
      });

      logger.info("Session approvals cleared", { sessionId });
    } catch (error) {
      logger.error("Failed to clear session approvals", error as Error, { sessionId });
      throw error;
    }
  }

  // ============================================================
  // Questions API
  // ============================================================

  /**
   * Reply to a pending question request
   */
  async replyQuestion(id: string, reply: unknown): Promise<QuestionResponse> {
    logger.info("Submitting question reply", { id });

    try {
      const response = await fetch(`${this.config.baseUrl}/api/questions/reply`, {
        method: "POST",
        headers: this.commonHeaders(),
        body: JSON.stringify({ id, reply }),
      });

      if (!response.ok) {
        const error = await response.text();
        logger.warn("Question reply failed", { id, error });
        return { success: false, error };
      }

      logger.info("Question reply recorded", { id });
      return { success: true };
    } catch (error) {
      logger.error("Failed to submit question reply", error as Error, { id });
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Reject a pending question request
   */
  async rejectQuestion(id: string, reason?: string): Promise<QuestionResponse> {
    logger.info("Submitting question rejection", { id, reason });

    try {
      const response = await fetch(`${this.config.baseUrl}/api/questions/reject`, {
        method: "POST",
        headers: this.commonHeaders(),
        body: JSON.stringify({ id, reason }),
      });

      if (!response.ok) {
        const error = await response.text();
        logger.warn("Question rejection failed", { id, error });
        return { success: false, error };
      }

      logger.info("Question rejection recorded", { id });
      return { success: true };
    } catch (error) {
      logger.error("Failed to submit question rejection", error as Error, { id });
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Get pending question requests
   */
  async getPendingQuestions(): Promise<PendingQuestion[]> {
    logger.debug("Fetching pending questions");

    try {
      const response = await fetch(`${this.config.baseUrl}/api/questions/pending`, {
        method: "GET",
        headers: this.commonHeaders(),
      });

      if (!response.ok) {
        throw new Error(`Failed to get pending questions: ${response.statusText}`);
      }

      const data = await response.json();
      const pending = (data.pending || []) as PendingQuestion[];
      logger.debug("Pending questions retrieved", { count: pending.length });
      return pending;
    } catch (error) {
      logger.error("Failed to fetch pending questions", error as Error);
      throw error;
    }
  }

  // ============================================================
  // Events API (SSE)
  // ============================================================

  /**
   * Connect to Server-Sent Events for real-time updates
   *
   * Events include:
   * - permission.asked - When a tool needs approval
   * - permission.replied - When a permission is resolved
   * - session.status - Session status changes
   *
   * @param workspace - Workspace directory
   * @param sessionId - Optional session ID to filter events
   * @returns EventSource instance
   *
   * @example
   * ```ts
   * const eventSource = client.connectToEvents("/path/to/project");
   * eventSource.addEventListener("message", (e) => {
   *   const event = JSON.parse(e.data);
   *   // Handle { type, properties }
   * });
   * ```
   */
  connectToEvents(workspace: string, sessionId?: string): EventSource {
    const url = new URL(`${this.config.baseUrl}/event`);
    url.searchParams.set("directory", workspace);
    url.searchParams.set("token", this.config.token);
    if (sessionId) {
      url.searchParams.set("sessionId", sessionId);
    }

    logger.info("Connecting to event stream", { workspace, sessionId });
    const eventSource = new EventSource(url.toString());

    eventSource.addEventListener("open", () => {
      logger.info("Event stream connected", { workspace, sessionId });
    });

    eventSource.addEventListener("error", () => {
      logger.warn("Event stream error", { workspace, sessionId });
    });

    return eventSource;
  }

  // ============================================================
  // Workspace API
  // ============================================================

  /**
   * Get workspace files (file tree)
   *
   * @param workspace - Workspace directory path
   * @param options - Optional filtering options
   */
  async getWorkspaceFiles(
    workspace: string,
    options?: { depth?: number; include?: string[] }
  ): Promise<unknown> {
    logger.debug("Fetching workspace files", { workspace, options });

    try {
      const url = new URL(`${this.config.baseUrl}/api/workspace/files`);
      url.searchParams.set("directory", workspace);
      if (options?.depth) {
        url.searchParams.set("depth", options.depth.toString());
      }
      if (options?.include) {
        url.searchParams.set("include", options.include.join(","));
      }

      const response = await fetch(url.toString(), {
        method: "GET",
        headers: this.commonHeaders(),
      });

      if (!response.ok) {
        throw new Error(`Failed to get workspace files: ${response.statusText}`);
      }

      const result = await response.json();
      logger.debug("Workspace files retrieved", { workspace });
      return result;
    } catch (error) {
      logger.error("Failed to fetch workspace files", error as Error, { workspace });
      throw error;
    }
  }

  /**
   * Get file content
   *
   * @param workspace - Workspace directory
   * @param filePath - Relative file path
   */
  async getFileContent(workspace: string, filePath: string): Promise<string> {
    logger.debug("Fetching file content", { workspace, filePath });

    try {
      const url = new URL(`${this.config.baseUrl}/api/workspace/file`);
      url.searchParams.set("directory", workspace);
      url.searchParams.set("path", filePath);

      const response = await fetch(url.toString(), {
        method: "GET",
        headers: this.commonHeaders(),
      });

      if (!response.ok) {
        throw new Error(`Failed to get file content: ${response.statusText}`);
      }

      const data = await response.json();
      logger.debug("File content retrieved", { workspace, filePath });
      return data.content;
    } catch (error) {
      logger.error("Failed to fetch file content", error as Error, { workspace, filePath });
      throw error;
    }
  }

  /**
   * Search files in project index
   *
   * @param directory - Workspace directory path
   * @param query - Search query
   * @param limit - Max results (default 20)
   */
  async searchFiles(params: { directory: string; query: string; limit?: number }): Promise<{
    files: Array<{ path: string; name: string; score: number; type: "file" | "directory" }>;
    query: string;
    directory: string;
    count: number;
  }> {
    logger.debug("Searching files", params);

    try {
      const searchParams = new URLSearchParams({
        directory: params.directory,
        query: params.query,
      });
      if (params.limit) {
        searchParams.set("limit", params.limit.toString());
      }

      const response = await fetch(`${this.config.baseUrl}/api/files/search?${searchParams}`, {
        method: "GET",
        headers: this.commonHeaders(),
      });

      if (!response.ok) {
        throw new Error(`Failed to search files: ${response.statusText}`);
      }

      const result = await response.json();
      logger.debug("Files searched", { query: params.query, count: result.count });
      return result;
    } catch (error) {
      logger.error("Failed to search files", error as Error, params);
      throw error;
    }
  }

  // ============================================================
  // VCS API
  // ============================================================

  /**
   * List remote branches from a git repository URL
   *
   * @param url - The repository URL (e.g., https://github.com/user/repo)
   * @returns Array of branch names
   */
  async listRemoteBranches(url: string): Promise<string[]> {
    logger.debug("Listing remote branches", { url });

    try {
      const response = await fetch(`${this.config.baseUrl}/api/vcs/remote-branches`, {
        method: "POST",
        headers: this.commonHeaders(),
        body: JSON.stringify({ url }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to list remote branches");
      }

      const result = await response.json();
      logger.debug("Remote branches fetched", { count: result.branches.length });
      return result.branches;
    } catch (error) {
      logger.error("Failed to list remote branches", error as Error, { url });
      throw error;
    }
  }

  /**
   * List local branches from a git repository
   *
   * @param path - Path to the git repository
   * @returns Array of branch names
   */
  async listLocalBranches(path: string): Promise<string[]> {
    logger.debug("Listing local branches", { path });

    try {
      const response = await fetch(`${this.config.baseUrl}/api/vcs/branches`, {
        method: "POST",
        headers: this.commonHeaders(),
        body: JSON.stringify({ path }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to list branches");
      }

      const result = await response.json();
      logger.debug("Local branches fetched", { count: result.branches.length });
      return result.branches;
    } catch (error) {
      logger.error("Failed to list local branches", error as Error, { path });
      throw error;
    }
  }

  /**
   * Clone a git repository
   *
   * @param options - Clone options
   * @returns Path to cloned repository
   */
  async clone(options: { url: string; targetDir: string; branch: string }): Promise<string> {
    logger.debug("Cloning repository", { url: options.url, targetDir: options.targetDir });

    try {
      const response = await fetch(`${this.config.baseUrl}/api/vcs/clone`, {
        method: "POST",
        headers: this.commonHeaders(),
        body: JSON.stringify(options),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to clone repository");
      }

      const result = await response.json();
      logger.debug("Repository cloned", { path: result.path });
      return result.path;
    } catch (error) {
      logger.error("Failed to clone repository", error as Error, { url: options.url });
      throw error;
    }
  }

  /**
   * Create a git worktree
   *
   * @param options - Worktree options
   * @returns Path to created worktree
   */
  async createWorktree(options: {
    repoPath: string;
    worktreeName: string;
    branch: string;
    worktreesDir: string;
    createBranch?: boolean;
  }): Promise<string> {
    logger.debug("Creating worktree", { worktreeName: options.worktreeName });

    try {
      const response = await fetch(`${this.config.baseUrl}/api/vcs/worktree`, {
        method: "POST",
        headers: this.commonHeaders(),
        body: JSON.stringify(options),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to create worktree");
      }

      const result = await response.json();
      logger.debug("Worktree created", { worktreePath: result.worktreePath });
      return result.worktreePath;
    } catch (error) {
      logger.error("Failed to create worktree", error as Error, {
        worktreeName: options.worktreeName,
      });
      throw error;
    }
  }

  /**
   * Check if worktree name exists
   *
   * @param name - Worktree name to check
   * @param worktreesDir - Worktrees directory path
   * @returns True if name exists, false otherwise
   */
  async checkWorktreeExists(name: string, worktreesDir: string): Promise<boolean> {
    logger.debug("Checking worktree exists", { name });

    try {
      const params = new URLSearchParams({ name, worktreesDir });
      const response = await fetch(`${this.config.baseUrl}/api/vcs/worktree/exists?${params}`, {
        method: "GET",
        headers: this.commonHeaders(),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to check worktree exists");
      }

      const result = await response.json();
      logger.debug("Worktree exists check", { name, exists: result.exists });
      return result.exists;
    } catch (error) {
      logger.error("Failed to check worktree exists", error as Error, { name });
      throw error;
    }
  }

  /**
   * Get workspaces directory path
   *
   * @returns Path to workspaces directory
   */
  async getWorkspacesDir(): Promise<string> {
    logger.debug("Getting workspaces directory");

    try {
      const response = await fetch(`${this.config.baseUrl}/api/vcs/workspaces-dir`, {
        method: "GET",
        headers: this.commonHeaders(),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to get workspaces directory");
      }

      const result = await response.json();
      logger.debug("Workspaces directory", { path: result.path });
      return result.path;
    } catch (error) {
      logger.error("Failed to get workspaces directory", error as Error);
      throw error;
    }
  }

  // ============================================================
  // Health API
  // ============================================================

  /**
   * Check server health
   */
  async checkHealth(): Promise<{ status: string; uptime: number }> {
    logger.debug("Checking server health");

    try {
      const response = await fetch(`${this.config.baseUrl}/api/health`, {
        method: "GET",
      });

      if (!response.ok) {
        throw new Error("Server health check failed");
      }

      const health = await response.json();
      logger.debug("Server health check passed", { status: health.status, uptime: health.uptime });
      return health;
    } catch (error) {
      logger.error("Server health check failed", error as Error);
      throw error;
    }
  }
}

/**
 * Create API client from preload config
 *
 * Convenience function for use in components/hooks
 *
 * @example
 * ```ts
 * const client = await createApiClient();
 * const response = await client.chat(messages, options);
 * ```
 */
export async function createApiClient(): Promise<SaktiCodeApiClient> {
  logger.debug("Creating API client from preload config");

  try {
    // Get config from preload script
    const config = await window.saktiCodeAPI.server.getConfig();
    const client = new SaktiCodeApiClient(config);
    logger.info("API client created successfully");
    return client;
  } catch (error) {
    logger.error("Failed to create API client", error as Error);
    throw error;
  }
}
