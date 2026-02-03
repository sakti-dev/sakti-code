/**
 * usePermissions Hook
 *
 * SSE-based permission handling for tool execution.
 * Connects to the server's /api/events endpoint and handles permission:request events.
 *
 * Features:
 * - SSE connection with auto-reconnect
 * - Session-filtered permission requests
 * - Approve/deny methods with API calls
 * - Connection status tracking
 */
import { createEffect, createSignal, onCleanup, type Accessor } from "solid-js";
import type { EkacodeApiClient } from "../lib/api-client";
import type { PermissionRequestData } from "../types/ui-message";

/**
 * Options for usePermissions hook
 */
export interface UsePermissionsOptions {
  /** API client instance */
  client: EkacodeApiClient;

  /** Workspace directory (reactive accessor) */
  workspace: Accessor<string>;

  /** Session ID for filtering requests (reactive accessor) */
  sessionId: Accessor<string | null>;

  /** Called when a new permission request arrives */
  onRequest?: (request: PermissionRequestData) => void;
}

/**
 * Result returned by usePermissions hook
 */
export interface UsePermissionsResult {
  /** All pending permission requests */
  pending: Accessor<PermissionRequestData[]>;

  /** Current (first) permission request to display */
  currentRequest: Accessor<PermissionRequestData | null>;

  /** Approve a permission request */
  approve: (id: string, patterns?: string[]) => Promise<void>;

  /** Deny a permission request */
  deny: (id: string) => Promise<void>;

  /** Whether SSE connection is active */
  isConnected: Accessor<boolean>;
}

/**
 * Hook for handling permission requests via SSE
 *
 * @example
 * ```tsx
 * function Workspace() {
 *   const [sessionId, setSessionId] = createSignal<string | null>(null);
 *
 *   const permissions = usePermissions({
 *     client,
 *     workspace: () => "/path/to/project",
 *     sessionId,
 *   });
 *
 *   return (
 *     <Show when={permissions.currentRequest()}>
 *       {(request) => (
 *         <PermissionDialog
 *           request={request()}
 *           onApprove={(id) => permissions.approve(id)}
 *           onDeny={(id) => permissions.deny(id)}
 *         />
 *       )}
 *     </Show>
 *   );
 * }
 * ```
 */
export function usePermissions(options: UsePermissionsOptions): UsePermissionsResult {
  const { client, workspace, sessionId, onRequest } = options;

  const [pending, setPending] = createSignal<PermissionRequestData[]>([]);
  const [isConnected, setIsConnected] = createSignal(false);

  let eventSource: EventSource | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Connect to SSE endpoint
   */
  const connect = () => {
    const ws = workspace();
    if (!ws) return;

    // Clean up existing connection
    disconnect();

    try {
      eventSource = client.connectToEvents(ws, sessionId() ?? undefined);

      eventSource.onopen = () => {
        setIsConnected(true);
      };

      // Handle permission request events
      eventSource.addEventListener("permission:request", event => {
        try {
          const request = JSON.parse(event.data) as PermissionRequestData;

          // Filter by session if we have one
          const sid = sessionId();
          if (!sid || request.sessionID === sid) {
            setPending(prev => [...prev, request]);
            onRequest?.(request);
          }
        } catch (e) {
          console.error("Failed to parse permission request:", e);
        }
      });

      // Handle permission update events (resolved elsewhere)
      eventSource.addEventListener("permission:update", event => {
        try {
          const data = JSON.parse(event.data) as { id: string; resolved: boolean };
          if (data.resolved) {
            setPending(prev => prev.filter(p => p.id !== data.id));
          }
        } catch (e) {
          console.error("Failed to parse permission update:", e);
        }
      });

      eventSource.onerror = () => {
        setIsConnected(false);

        // Auto-reconnect after delay
        if (!reconnectTimer) {
          reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            connect();
          }, 3000);
        }
      };
    } catch (e) {
      console.error("Failed to connect to events:", e);
      setIsConnected(false);
    }
  };

  /**
   * Disconnect from SSE
   */
  const disconnect = () => {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
    setIsConnected(false);
  };

  // Connect when workspace changes
  createEffect(() => {
    const ws = workspace();
    if (ws) {
      connect();
    } else {
      disconnect();
    }
  });

  // Cleanup on unmount
  onCleanup(() => {
    disconnect();
  });

  /**
   * Approve a permission request
   */
  const approve = async (id: string, patterns?: string[]): Promise<void> => {
    try {
      await client.approvePermission(id, true, patterns);
      // Remove from pending immediately (optimistic)
      setPending(prev => prev.filter(p => p.id !== id));
    } catch (e) {
      console.error("Failed to approve permission:", e);
      throw e;
    }
  };

  /**
   * Deny a permission request
   */
  const deny = async (id: string): Promise<void> => {
    try {
      await client.approvePermission(id, false);
      // Remove from pending immediately (optimistic)
      setPending(prev => prev.filter(p => p.id !== id));
    } catch (e) {
      console.error("Failed to deny permission:", e);
      throw e;
    }
  };

  /**
   * Get current (first) request
   */
  const currentRequest = () => pending()[0] ?? null;

  return {
    pending,
    currentRequest,
    approve,
    deny,
    isConnected,
  };
}
