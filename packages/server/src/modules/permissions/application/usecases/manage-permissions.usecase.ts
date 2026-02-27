import { PermissionManager } from "@sakti-code/core/server";
import { PermissionReplied, publish } from "../../../../bus";

export interface ApprovePermissionInput {
  id: string;
  approved: boolean;
  patterns?: string[];
}

export async function approvePermissionUsecase(input: ApprovePermissionInput): Promise<void> {
  const permissionManager = PermissionManager.getInstance();
  const pending = permissionManager.getPendingRequests();
  const match = pending.find(request => request.id === input.id);

  permissionManager.handleResponse({
    id: input.id,
    approved: input.approved,
    patterns: input.patterns,
  });

  if (match) {
    await publish(PermissionReplied, {
      sessionID: match.sessionID,
      requestID: input.id,
      reply:
        input.approved && input.patterns && input.patterns.length > 0
          ? "always"
          : input.approved
            ? "once"
            : "reject",
    });
  }
}

export function listPendingPermissionsUsecase() {
  const permissionManager = PermissionManager.getInstance();
  return permissionManager.getPendingRequests();
}

export function clearSessionPermissionsUsecase(sessionID: string): void {
  const permissionManager = PermissionManager.getInstance();
  permissionManager.clearSession(sessionID);
}
