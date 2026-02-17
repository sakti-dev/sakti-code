/**
 * Mode Approval Adapter
 *
 * Provides helper to request mode switch approval via the permission system.
 */

import type { PermissionRequest } from "@ekacode/shared";
import { v7 as uuidv7 } from "uuid";
import { PermissionManager } from "../security/permission-manager";
import { evaluatePermission } from "../security/permission-rules";
import type { RuntimeMode } from "../spec/helpers";

export interface ModeSwitchApprovalRequest {
  sessionId: string;
  fromMode: RuntimeMode;
  toMode: RuntimeMode;
  reason?: string;
}

export async function requestModeSwitchApproval(
  request: ModeSwitchApprovalRequest
): Promise<boolean> {
  const { sessionId, fromMode, toMode, reason } = request;
  const permissionMgr = PermissionManager.getInstance();
  const rules = permissionMgr.getRules();

  const pattern = `${fromMode}->${toMode}`;
  const action = evaluatePermission("mode_switch", pattern, rules);

  if (action === "allow") {
    return true;
  }

  if (action === "deny") {
    return false;
  }

  const requestId = uuidv7();
  const permissionRequest: PermissionRequest = {
    id: requestId,
    permission: "mode_switch",
    patterns: [pattern],
    always: [],
    sessionID: sessionId,
    metadata: {
      fromMode,
      toMode,
      reason,
    },
  };

  return permissionMgr.requestApproval(permissionRequest);
}
