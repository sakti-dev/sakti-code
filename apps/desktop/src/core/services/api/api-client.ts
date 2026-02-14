/**
 * Ekacode API Client
 *
 * Typed API client for communicating with the Hono server from the desktop renderer.
 * Uses the server config from preload (window.ekacodeAPI.server.getConfig())
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
 * Session status from server
 */
export interface SessionStatus {
  sessionId: string;
  status: "active" | "idle" | "completed" | "failed";
  phase?: string;
  lastActivity?: string;
  hasIncompleteWork?: boolean;
}

/**
 * Session info from server list endpoint
 */
export interface SessionInfo {
  sessionId: string;
  resourceId: string;
  threadId: string;
  createdAt: string;
  lastAccessed: string;
}

/**
 * API Client for Ekacode Desktop
 *
 * Provides typed methods for all Hono server endpoints.
 * Handles authentication and streaming responses.
 */
export class EkacodeApiClient {
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
      headers["X-Session-ID"] = options.sessionId;
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
          providerId: localStorage.getItem("ekacode:selected-provider") || undefined,
          modelId: localStorage.getItem("ekacode:selected-model") || undefined,
          stream: true,
        }),
        signal: options.signal,
      });

      logger.debug("Chat response received", {
        status: response.status,
        ok: response.ok,
        sessionId: response.headers.get("X-Session-ID") ?? undefined,
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
  // Sessions API
  // ============================================================

  /**
   * Session info from server
   */
  /**
   * List all sessions
   *
   * @returns Array of session info objects
   */
  async listSessions(): Promise<SessionInfo[]> {
    logger.debug("Listing all sessions");

    try {
      const response = await fetch(`${this.config.baseUrl}/api/sessions`, {
        method: "GET",
        headers: this.commonHeaders(),
      });

      if (!response.ok) {
        throw new Error(`Failed to list sessions: ${response.statusText}`);
      }

      const data = await response.json();
      const sessions = data.sessions || [];
      logger.debug("Sessions retrieved", { count: sessions.length });
      return sessions;
    } catch (error) {
      logger.error("Failed to list sessions", error as Error);
      throw error;
    }
  }

  /**
   * Get a specific session
   *
   * @param sessionId - Session ID to retrieve
   * @returns Session info or null if not found
   */
  async getSession(sessionId: string): Promise<SessionInfo | null> {
    logger.debug("Fetching session", { sessionId });

    try {
      const response = await fetch(`${this.config.baseUrl}/api/sessions/${sessionId}`, {
        method: "GET",
        headers: this.commonHeaders(),
      });

      if (!response.ok) {
        if (response.status === 404) {
          logger.debug("Session not found", { sessionId });
          return null;
        }
        throw new Error(`Failed to get session: ${response.statusText}`);
      }

      const session = await response.json();
      logger.debug("Session retrieved", { sessionId });
      return session;
    } catch (error) {
      logger.error("Failed to get session", error as Error, { sessionId });
      throw error;
    }
  }

  /**
   * Delete a session
   *
   * @param sessionId - Session ID to delete
   */
  async deleteSession(sessionId: string): Promise<void> {
    logger.info("Deleting session", { sessionId });

    try {
      const response = await fetch(`${this.config.baseUrl}/api/sessions/${sessionId}`, {
        method: "DELETE",
        headers: this.commonHeaders(),
      });

      if (!response.ok) {
        throw new Error(`Failed to delete session: ${response.statusText}`);
      }

      logger.info("Session deleted", { sessionId });
    } catch (error) {
      logger.error("Failed to delete session", error as Error, { sessionId });
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
export async function createApiClient(): Promise<EkacodeApiClient> {
  logger.debug("Creating API client from preload config");

  try {
    // Get config from preload script
    const config = await window.ekacodeAPI.server.getConfig();
    const client = new EkacodeApiClient(config);
    logger.info("API client created successfully");
    return client;
  } catch (error) {
    logger.error("Failed to create API client", error as Error);
    throw error;
  }
}
