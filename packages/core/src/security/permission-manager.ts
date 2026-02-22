/**
 * Permission Manager - Event-based approval system with rule-based evaluation
 * Based on OpenCode's permission system with enhancements
 */

import type { PermissionRequest, PermissionResponse, PermissionRule } from "@sakti-code/shared";
import { createLogger } from "@sakti-code/shared/logger";
import { EventEmitter } from "events";
import { evaluatePatterns, matchesGlob } from "./permission-rules";

const logger = createLogger("sakti-code");

/**
 * Error types for permission rejection
 */
export class PermissionDeniedError extends Error {
  constructor(
    public readonly permission: string,
    public readonly patterns: string[],
    public readonly rules: PermissionRule[],
    message?: string
  ) {
    super(
      message ||
        `Permission denied by rule. Rules that prevent this action: ${JSON.stringify(rules)}`
    );
    this.name = "PermissionDeniedError";
  }
}

export class PermissionRejectedError extends Error {
  constructor(
    public readonly permissionId: string,
    public readonly sessionID: string,
    message?: string
  ) {
    super(message || "The user rejected this permission request.");
    this.name = "PermissionRejectedError";
  }
}

export class PermissionTimeoutError extends Error {
  constructor(public readonly permissionId: string) {
    super("Permission request timed out after 30 seconds.");
    this.name = "PermissionTimeoutError";
  }
}

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
  private rules: PermissionRule[] = [];

  private constructor() {
    super();
  }

  static getInstance(): PermissionManager {
    if (!this.instance) {
      this.instance = new PermissionManager();
    }
    return this.instance;
  }

  /**
   * Set permission rules
   */
  setRules(rules: PermissionRule[]): void {
    this.rules = rules;
    logger.info("Permission rules updated", {
      module: "permissions",
      count: rules.length,
    });
  }

  /**
   * Get current permission rules
   */
  getRules(): PermissionRule[] {
    return [...this.rules];
  }

  /**
   * Add a single permission rule
   */
  addRule(rule: PermissionRule): void {
    this.rules.push(rule);
    logger.info("Permission rule added", {
      module: "permissions",
      rule,
    });
  }

  /**
   * Clear all permission rules
   */
  clearRules(): void {
    this.rules = [];
    logger.info("Permission rules cleared", {
      module: "permissions",
    });
  }

  async requestApproval(request: PermissionRequest): Promise<boolean> {
    const cacheKey = `${request.sessionID}:${request.permission}`;

    // 1. Evaluate against rules first
    const evaluation = evaluatePatterns(request.permission, request.patterns, this.rules);

    if (evaluation.action === "deny") {
      // Auto-deny by rule
      logger.warn("Permission denied by rule", {
        module: "permissions",
        permission: request.permission,
        patterns: evaluation.deniedPatterns,
      });
      throw new PermissionDeniedError(
        request.permission,
        evaluation.deniedPatterns,
        this.rules.filter(r => evaluation.deniedPatterns.some(p => matchesGlob(r.pattern, p)))
      );
    }

    if (evaluation.action === "allow") {
      // Auto-allow by rule
      logger.debug("Permission auto-allowed by rule", {
        module: "permissions",
        permission: request.permission,
        patterns: request.patterns,
      });
      return true;
    }

    // 2. Check cached approvals for "always" patterns
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

    // 3. Check if any pattern is already approved
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

    // 4. Request user approval
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

  /**
   * Get activity log of recent permission requests (for UI)
   */
  getActivityLog(): Array<{
    request: PermissionRequest;
    status: "pending" | "approved" | "denied" | "timeout";
    timestamp: number;
  }> {
    // This could be expanded to track history
    return [];
  }

  private matchesPattern(pattern: string, targets: string[]): boolean {
    // Use the improved glob matching from permission-rules
    return targets.some(t => matchesGlob(pattern, t));
  }
}
