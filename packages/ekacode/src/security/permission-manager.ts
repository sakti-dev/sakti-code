/**
 * Permission Manager - Event-based approval system
 */

import { createLogger } from "@ekacode/logger";
import type { PermissionRequest, PermissionResponse } from "@ekacode/shared";
import { EventEmitter } from "events";

const logger = createLogger("ekacode");

export class PermissionManager extends EventEmitter {
  private static instance: PermissionManager;
  private pendingRequests = new Map<
    string,
    {
      request: PermissionRequest;
      resolve: (approved: boolean) => void;
      timeout: NodeJS.Timeout;
    }
  >();
  private approvals = new Map<string, Set<string>>();

  private constructor() {
    super();
  }

  static getInstance(): PermissionManager {
    if (!this.instance) {
      this.instance = new PermissionManager();
    }
    return this.instance;
  }

  async requestApproval(request: PermissionRequest): Promise<boolean> {
    const cacheKey = `${request.sessionID}:${request.permission}`;

    // Check cached approvals for "always" patterns
    if (this.approvals.has(cacheKey)) {
      const alwaysApproved = request.always.some(pattern =>
        this.matchesPattern(pattern, request.patterns)
      );
      if (alwaysApproved) {
        logger.debug("Auto-approved by always pattern", {
          module: "permissions",
          sessionID: request.sessionID,
          permission: request.permission,
        });
        return true;
      }
    }

    // Check if any pattern is already approved
    const approvedPatterns = this.approvals.get(cacheKey);
    if (approvedPatterns) {
      for (const pattern of request.patterns) {
        if (approvedPatterns.has(pattern)) {
          logger.debug("Auto-approved by cached pattern", {
            module: "permissions",
            sessionID: request.sessionID,
            permission: request.permission,
            pattern,
          });
          return true;
        }
      }
    }

    logger.info("Requesting user approval", {
      module: "permissions",
      sessionID: request.sessionID,
      permission: request.permission,
      patterns: request.patterns,
    });

    // Emit approval request event
    this.emit("permission:request", request);

    // Wait for response (with timeout)
    return new Promise(resolve => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(request.id);
        logger.warn("Permission request timed out", {
          module: "permissions",
          permissionId: request.id,
        });
        resolve(false); // Deny on timeout
      }, 30000); // 30 second timeout

      this.pendingRequests.set(request.id, {
        request,
        resolve,
        timeout,
      });
    });
  }

  handleResponse(response: PermissionResponse): void {
    const pending = this.pendingRequests.get(response.id);
    if (!pending) return;

    clearTimeout(pending.timeout);
    this.pendingRequests.delete(response.id);

    logger.info(`Permission ${response.approved ? "approved" : "denied"}`, {
      module: "permissions",
      permissionId: response.id,
      approved: response.approved,
      patterns: response.patterns,
    });

    if (response.approved && response.patterns) {
      // Cache approval
      const cacheKey = `${pending.request.sessionID}:${pending.request.permission}`;
      if (!this.approvals.has(cacheKey)) {
        this.approvals.set(cacheKey, new Set());
      }
      response.patterns.forEach(p => this.approvals.get(cacheKey)!.add(p));
    }

    pending.resolve(response.approved);
  }

  approvePattern(sessionID: string, permission: string, pattern: string): void {
    const cacheKey = `${sessionID}:${permission}`;
    if (!this.approvals.has(cacheKey)) {
      this.approvals.set(cacheKey, new Set());
    }
    this.approvals.get(cacheKey)!.add(pattern);

    logger.debug("Pattern approved for session", {
      module: "permissions",
      sessionID,
      permission,
      pattern,
    });
  }

  clearSession(sessionID: string): void {
    for (const [key] of this.approvals) {
      if (key.startsWith(`${sessionID}:`)) {
        this.approvals.delete(key);
      }
    }

    logger.info("Session approvals cleared", {
      module: "permissions",
      sessionID,
    });
  }

  getPendingRequests(): PermissionRequest[] {
    return Array.from(this.pendingRequests.values()).map(v => v.request);
  }

  private matchesPattern(pattern: string, targets: string[]): boolean {
    // Simple glob matching - can be enhanced
    const regex = new RegExp("^" + pattern.replace(/\*/g, ".*").replace(/\?/g, ".") + "$");
    return targets.some(t => regex.test(t));
  }
}
