/**
 * SDK Client Utility
 *
 * Extracted from GlobalSDKProvider for use as a standalone utility.
 * Provides typed API client for server communication.
 *
 * Part of Phase 6: Cleanup & Optimization
 */

import type { Accessor } from "solid-js";

export interface SessionInfo {
  sessionId: string;
  resourceId: string;
  threadId?: string;
  workspaceId?: string | null;
  status?: "researching" | "specifying" | "implementing" | "completed" | "failed";
  specType?: "comprehensive" | "quick" | null;
  sessionKind?: "intake" | "task";
  createdAt: string;
  lastAccessed: string;
}

export interface SessionMessagesResponse {
  sessionID: string;
  messages: unknown[];
  hasMore: boolean;
  total?: number;
}

export interface SessionMessagesOptions {
  sessionID: string;
  limit?: number;
  offset?: number;
  signal?: AbortSignal;
}

export interface SDKClient {
  /** Base URL for API requests */
  baseUrl: string;
  /** Session-related API methods */
  session: {
    /** List all sessions */
    list(): Promise<SessionInfo[]>;
    /** Get specific session details */
    get(sessionID: string): Promise<SessionInfo>;
    /** Get messages for a session with pagination */
    messages(options: SessionMessagesOptions): Promise<SessionMessagesResponse>;
  };
  /** Generic fetch method with authentication */
  fetch(path: string, init?: RequestInit): Promise<Response>;
}

export interface CreateSDKClientOptions {
  /** Base URL for the API server */
  baseUrl: string;
  /** Accessor function that provides the current auth token */
  token: Accessor<string>;
  /** Optional custom fetch implementation */
  fetchFn?: typeof fetch;
}

/**
 * Create an SDK client for API communication
 *
 * @example
 * ```tsx
 * const [token, setToken] = createSignal('my-token');
 * const client = createSDKClient('http://localhost:3000', token);
 *
 * // List sessions
 * const sessions = await client.session.list();
 *
 * // Get messages
 * const messages = await client.session.messages({
 *   sessionID: 'session-1',
 *   limit: 50,
 * });
 * ```
 */
export function createSDKClient(options: CreateSDKClientOptions): SDKClient;
export function createSDKClient(
  baseUrl: string,
  token: Accessor<string>,
  fetchFn?: typeof fetch
): SDKClient;
export function createSDKClient(
  baseUrlOrOptions: string | CreateSDKClientOptions,
  token?: Accessor<string>,
  fetchFn: typeof fetch = fetch
): SDKClient {
  // Handle both overload signatures
  let baseUrl: string;
  let tokenAccessor: Accessor<string>;

  if (typeof baseUrlOrOptions === "string") {
    baseUrl = baseUrlOrOptions;
    tokenAccessor = token!;
  } else {
    baseUrl = baseUrlOrOptions.baseUrl;
    tokenAccessor = baseUrlOrOptions.token;
    fetchFn = baseUrlOrOptions.fetchFn || fetch;
  }

  const url = baseUrl.replace(/\/$/, "");

  /**
   * Internal request helper with authentication
   */
  async function request<T>(path: string, options?: RequestInit): Promise<T> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    // Merge existing headers if provided
    if (options?.headers) {
      const existingHeaders = new Headers(options.headers);
      existingHeaders.forEach((value, key) => {
        headers[key] = value;
      });
    }

    const currentToken = tokenAccessor();
    if (currentToken) {
      headers["Authorization"] = `Basic ${btoa(`admin:${currentToken}`)}`;
    }

    const response = await fetchFn(`${url}${path}`, {
      ...options,
      headers,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return response.json();
  }

  return {
    baseUrl,
    session: {
      async list(): Promise<SessionInfo[]> {
        const result = await request<{
          taskSessions: Array<{
            taskSessionId: string;
            resourceId: string;
            threadId: string;
            workspaceId: string | null;
            status: "researching" | "specifying" | "implementing" | "completed" | "failed";
            specType: "comprehensive" | "quick" | null;
            sessionKind: "intake" | "task";
            createdAt: string;
            lastAccessed: string;
          }>;
        }>("/api/task-sessions?kind=task");

        return (result.taskSessions || []).map(session => ({
          sessionId: session.taskSessionId,
          resourceId: session.resourceId,
          threadId: session.threadId,
          workspaceId: session.workspaceId,
          status: session.status,
          specType: session.specType,
          sessionKind: session.sessionKind,
          createdAt: session.createdAt,
          lastAccessed: session.lastAccessed,
        }));
      },

      async get(sessionID: string): Promise<SessionInfo> {
        const taskSession = await request<{
          taskSessionId: string;
          resourceId: string;
          threadId: string;
          workspaceId: string | null;
          status: "researching" | "specifying" | "implementing" | "completed" | "failed";
          specType: "comprehensive" | "quick" | null;
          sessionKind: "intake" | "task";
          createdAt: string;
          lastAccessed: string;
        }>(`/api/task-sessions/${sessionID}`);

        return {
          sessionId: taskSession.taskSessionId,
          resourceId: taskSession.resourceId,
          threadId: taskSession.threadId,
          workspaceId: taskSession.workspaceId,
          status: taskSession.status,
          specType: taskSession.specType,
          sessionKind: taskSession.sessionKind,
          createdAt: taskSession.createdAt,
          lastAccessed: taskSession.lastAccessed,
        };
      },

      async messages(options: SessionMessagesOptions): Promise<SessionMessagesResponse> {
        const params = new URLSearchParams();
        if (options.limit) params.set("limit", String(options.limit));
        if (options.offset) params.set("offset", String(options.offset));
        const queryString = params.toString() ? `?${params}` : "";

        return request<SessionMessagesResponse>(
          `/api/chat/${options.sessionID}/messages${queryString}`,
          { signal: options.signal }
        );
      },
    },

    fetch: async (path: string, init?: RequestInit): Promise<Response> => {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };

      // Merge existing headers
      if (init?.headers) {
        const existingHeaders = new Headers(init.headers);
        existingHeaders.forEach((value, key) => {
          headers[key] = value;
        });
      }

      const currentToken = tokenAccessor();
      if (currentToken) {
        headers["Authorization"] = `Basic ${btoa(`admin:${currentToken}`)}`;
      }

      return fetchFn(`${url}${path}`, { ...init, headers });
    },
  };
}
