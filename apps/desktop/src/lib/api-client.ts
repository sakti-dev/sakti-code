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
 */

import type { ChatUIMessage } from "../types/ui-message";

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

  constructor(config: ApiClientConfig) {
    this.config = config;
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
   * // Parse stream using stream-parser.ts
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

    return fetch(url.toString(), {
      method: "POST",
      headers,
      body: JSON.stringify({
        messages,
        stream: true,
      }),
      signal: options.signal,
    });
  }

  /**
   * Get session status
   *
   * @param sessionId - Session ID to check
   * @returns Session status including phase and incomplete work flag
   */
  async getSessionStatus(sessionId: string): Promise<SessionStatus | null> {
    const url = `${this.config.baseUrl}/api/session/${sessionId}/status`;

    const response = await fetch(url, {
      method: "GET",
      headers: this.commonHeaders(),
    });

    if (!response.ok) {
      if (response.status === 404) {
        return null;
      }
      throw new Error(`Failed to get session status: ${response.statusText}`);
    }

    return response.json();
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
    const response = await fetch(`${this.config.baseUrl}/api/sessions`, {
      method: "GET",
      headers: this.commonHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Failed to list sessions: ${response.statusText}`);
    }

    const data = await response.json();
    return data.sessions || [];
  }

  /**
   * Get a specific session
   *
   * @param sessionId - Session ID to retrieve
   * @returns Session info or null if not found
   */
  async getSession(sessionId: string): Promise<SessionInfo | null> {
    const response = await fetch(`${this.config.baseUrl}/api/sessions/${sessionId}`, {
      method: "GET",
      headers: this.commonHeaders(),
    });

    if (!response.ok) {
      if (response.status === 404) {
        return null;
      }
      throw new Error(`Failed to get session: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Delete a session
   *
   * @param sessionId - Session ID to delete
   */
  async deleteSession(sessionId: string): Promise<void> {
    const response = await fetch(`${this.config.baseUrl}/api/sessions/${sessionId}`, {
      method: "DELETE",
      headers: this.commonHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Failed to delete session: ${response.statusText}`);
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
    const response = await fetch(`${this.config.baseUrl}/api/permissions/approve`, {
      method: "POST",
      headers: this.commonHeaders(),
      body: JSON.stringify({ id, approved, patterns }),
    });

    if (!response.ok) {
      const error = await response.text();
      return { success: false, error };
    }

    return { success: true };
  }

  /**
   * Get pending permission requests
   *
   * Used for initial load - normally use SSE for real-time updates
   */
  async getPendingPermissions(): Promise<PendingPermission[]> {
    const response = await fetch(`${this.config.baseUrl}/api/permissions/pending`, {
      method: "GET",
      headers: this.commonHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Failed to get pending permissions: ${response.statusText}`);
    }

    const data = await response.json();
    return data.pending || [];
  }

  /**
   * Clear all session-specific permission approvals
   *
   * @param sessionId - Session ID to clear approvals for
   */
  async clearSessionApprovals(sessionId: string): Promise<void> {
    await fetch(`${this.config.baseUrl}/api/permissions/session/${sessionId}/clear`, {
      method: "POST",
      headers: this.commonHeaders(),
    });
  }

  // ============================================================
  // Events API (SSE)
  // ============================================================

  /**
   * Connect to Server-Sent Events for real-time updates
   *
   * Events include:
   * - permission:request - When a tool needs approval
   * - permission:update - When a permission is resolved
   * - session:status - Session status changes
   *
   * @param workspace - Workspace directory
   * @param sessionId - Optional session ID to filter events
   * @returns EventSource instance
   *
   * @example
   * ```ts
   * const eventSource = client.connectToEvents("/path/to/project");
   * eventSource.addEventListener("permission:request", (e) => {
   *   const request = JSON.parse(e.data);
   *   // Show permission dialog
   * });
   * ```
   */
  connectToEvents(workspace: string, sessionId?: string): EventSource {
    const url = new URL(`${this.config.baseUrl}/api/events`);
    url.searchParams.set("directory", workspace);
    if (sessionId) {
      url.searchParams.set("sessionId", sessionId);
    }
    return new EventSource(url.toString());
  }

  /**
   * Connect to permission-specific SSE endpoint
   *
   * @param workspace - Workspace directory
   * @param sessionId - Session ID (required for filtering)
   * @returns EventSource instance
   */
  connectToPermissionEvents(workspace: string, sessionId: string): EventSource {
    const url = new URL(`${this.config.baseUrl}/api/events/permissions`);
    url.searchParams.set("directory", workspace);
    url.searchParams.set("sessionId", sessionId);
    return new EventSource(url.toString());
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

    return response.json();
  }

  /**
   * Get file content
   *
   * @param workspace - Workspace directory
   * @param filePath - Relative file path
   */
  async getFileContent(workspace: string, filePath: string): Promise<string> {
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
    return data.content;
  }

  // ============================================================
  // Health API
  // ============================================================

  /**
   * Check server health
   */
  async checkHealth(): Promise<{ status: string; uptime: number }> {
    const response = await fetch(`${this.config.baseUrl}/api/health`, {
      method: "GET",
    });

    if (!response.ok) {
      throw new Error("Server health check failed");
    }

    return response.json();
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
  // Get config from preload script
  const config = await window.ekacodeAPI.server.getConfig();
  return new EkacodeApiClient(config);
}
