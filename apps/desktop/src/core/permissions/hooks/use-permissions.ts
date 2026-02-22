import type { PermissionRequestData } from "@/core/chat/types/ui-message";
import type { SaktiCodeApiClient } from "@/core/services/api/api-client";
import { createLogger } from "@/core/shared/logger";
import { usePermissionStore } from "@/state/providers";
import { createMemo, createSignal, type Accessor } from "solid-js";

const logger = createLogger("desktop:permissions");

export interface UsePermissionsOptions {
  client: SaktiCodeApiClient;
  workspace: Accessor<string>;
  sessionId: Accessor<string | null>;
  onRequest?: (request: PermissionRequestData) => void;
}

export interface UsePermissionsResult {
  pending: Accessor<PermissionRequestData[]>;
  currentRequest: Accessor<PermissionRequestData | null>;
  approve: (id: string, patterns?: string[]) => Promise<void>;
  deny: (id: string) => Promise<void>;
  isConnected: Accessor<boolean>;
}

function toPermissionRequestData(request: {
  id: string;
  sessionID: string;
  toolName: string;
  args: Record<string, unknown>;
  description?: string;
  timestamp: number;
}): PermissionRequestData {
  return {
    id: request.id,
    sessionID: request.sessionID,
    toolName: request.toolName,
    args: request.args,
    description: request.description,
    timestamp: new Date(request.timestamp).toISOString(),
  };
}

export function usePermissions(options: UsePermissionsOptions): UsePermissionsResult {
  const { client, sessionId } = options;
  const [permissionState, permissionActions] = usePermissionStore();
  const [isConnected] = createSignal(true);

  const pending = createMemo<PermissionRequestData[]>(() => {
    const currentSessionId = sessionId();
    const pendingIds = permissionState.pendingOrder;
    const mapped: PermissionRequestData[] = [];

    for (const requestId of pendingIds) {
      const request = permissionState.byId[requestId];
      if (!request) continue;
      if (currentSessionId && request.sessionID !== currentSessionId) continue;
      mapped.push(toPermissionRequestData(request));
    }

    return mapped;
  });

  const currentRequest = createMemo<PermissionRequestData | null>(() => pending()[0] ?? null);

  const approve = async (id: string, patterns?: string[]): Promise<void> => {
    logger.info("Approving permission", { id, patterns });
    try {
      await client.approvePermission(id, true, patterns);
      permissionActions.approve(id);
    } catch (error) {
      logger.error("Failed to approve permission", error as Error, { id });
      throw error;
    }
  };

  const deny = async (id: string): Promise<void> => {
    logger.info("Denying permission", { id });
    try {
      await client.approvePermission(id, false);
      permissionActions.deny(id);
    } catch (error) {
      logger.error("Failed to deny permission", error as Error, { id });
      throw error;
    }
  };

  return {
    pending,
    currentRequest,
    approve,
    deny,
    isConnected,
  };
}
