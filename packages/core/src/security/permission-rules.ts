/**
 * Permission Rules - Rule-based permission evaluation
 * Based on OpenCode's permission/next.ts pattern
 */

import type { PermissionAction, PermissionRule, PermissionType } from "@ekacode/shared";
import { createLogger } from "@ekacode/shared/logger";

const logger = createLogger("ekacode");

/**
 * Convert glob pattern to regex
 * Supports: *, **, ?, character classes [a-z]
 */
export function globToRegex(glob: string): RegExp {
  const regexString =
    "^" +
    glob
      // Escape special regex chars first (except *, ?, [, ])
      .replace(/[.+^${}()|\\]/g, "\\$&")
      // Handle character classes [abc]
      .replace(/\[([^\]]+)\]/g, "[$1]")
      // Replace ** with .* (matches anything including /)
      .replace(/\*\*/g, ".*")
      // Replace * with .* (matches anything) - must be after escaping!
      .replace(/\*/g, ".*")
      // Replace ? with .
      .replace(/\?/g, ".") +
    "$";
  return new RegExp(regexString);
}

/**
 * Test if a string matches a glob pattern
 */
export function matchesGlob(pattern: string, str: string): boolean {
  const regex = globToRegex(pattern);
  const matches = regex.test(str);
  console.log(
    `[matchesGlob] Pattern "${pattern}" vs string "${str}": ${matches} (regex: ${regex.source})`
  );
  return matches;
}

/**
 * Find the last (most recent) matching rule
 * Later rules override earlier ones
 */
export function findMatchingRule(
  permission: PermissionType,
  pattern: string,
  rules: PermissionRule[]
): PermissionRule | undefined {
  // Find rules that match both permission type and pattern
  const matchingRules = rules.filter(
    rule => rule.permission === permission && matchesGlob(rule.pattern, pattern)
  );

  // Return the last matching rule (most recent)
  return matchingRules.length > 0 ? matchingRules[matchingRules.length - 1] : undefined;
}

/**
 * Evaluate a permission request against rules
 * Returns the action to take: "allow", "deny", or "ask"
 */
export function evaluatePermission(
  permission: PermissionType,
  pattern: string,
  rules: PermissionRule[]
): PermissionAction {
  console.log(
    `[evaluatePermission] Checking ${permission}:${pattern} against ${rules.length} rules`
  );

  const match = findMatchingRule(permission, pattern, rules);

  if (!match) {
    // Default to "ask" if no rule matches
    console.log(
      `[evaluatePermission] No matching rule for ${permission}:${pattern}, defaulting to ask`
    );
    logger.debug("No matching rule, defaulting to ask", {
      module: "permissions",
      permission,
      pattern,
    });
    return "ask";
  }

  console.log(`[evaluatePermission] Matched rule for ${permission}:${pattern} => ${match.action}`);
  logger.debug("Permission evaluated", {
    module: "permissions",
    permission,
    pattern,
    action: match.action,
    rule: match,
  });

  return match.action;
}

/**
 * Check if any pattern in a list is allowed by rules
 * Returns true if all patterns are allowed, false if any are denied
 * Throws if any pattern requires "ask" (should be handled by caller)
 */
export function evaluatePatterns(
  permission: PermissionType,
  patterns: string[],
  rules: PermissionRule[]
): { action: PermissionAction; deniedPatterns: string[]; askPatterns: string[] } {
  const deniedPatterns: string[] = [];
  const askPatterns: string[] = [];

  for (const pattern of patterns) {
    const action = evaluatePermission(permission, pattern, rules);
    if (action === "deny") {
      deniedPatterns.push(pattern);
    } else if (action === "ask") {
      askPatterns.push(pattern);
    }
  }

  // If any pattern is denied, overall action is deny
  if (deniedPatterns.length > 0) {
    return { action: "deny", deniedPatterns, askPatterns };
  }

  // If any pattern requires ask, overall action is ask
  if (askPatterns.length > 0) {
    return { action: "ask", deniedPatterns, askPatterns };
  }

  // All patterns allowed
  return { action: "allow", deniedPatterns, askPatterns };
}

/**
 * Create default permission rules
 * Similar to OpenCode's sensible defaults
 */
export function createDefaultRules(): PermissionRule[] {
  return [
    // Read operations - generally safe
    { permission: "read", pattern: "*", action: "allow" },

    // Edit operations - require approval by default
    { permission: "edit", pattern: "*", action: "ask" },

    // Bash commands - safe commands auto-allowed
    { permission: "bash", pattern: "git*", action: "allow" },
    { permission: "bash", pattern: "npm*", action: "allow" },
    { permission: "bash", pattern: "pnpm*", action: "allow" },
    { permission: "bash", pattern: "yarn*", action: "allow" },
    { permission: "bash", pattern: "bun*", action: "allow" },
    { permission: "bash", pattern: "ls", action: "allow" },
    { permission: "bash", pattern: "cat", action: "allow" },
    { permission: "bash", pattern: "echo", action: "allow" },
    { permission: "bash", pattern: "pwd", action: "allow" },
    { permission: "bash", pattern: "*", action: "ask" },

    // External directory access - always require approval
    { permission: "external_directory", pattern: "*", action: "ask" },

    // Mode switching - always require approval
    { permission: "mode_switch", pattern: "*", action: "ask" },

    // Skill loading - generally safe but can be scoped
    { permission: "skill", pattern: "*", action: "allow" },
  ];
}

/**
 * Parse rules from config format
 * Config format: { permission: action | { pattern: action } }
 */
export interface PermissionConfig {
  [permission: string]: PermissionAction | Record<string, PermissionAction>;
}

export function parseConfigRules(config: PermissionConfig): PermissionRule[] {
  const rules: PermissionRule[] = [];

  for (const [permission, value] of Object.entries(config)) {
    if (typeof value === "string") {
      // Simple format: { "bash": "ask" }
      rules.push({
        permission: permission as PermissionType,
        pattern: "*",
        action: value,
      });
    } else {
      // Pattern format: { "bash": { "git*": "allow", "*": "ask" } }
      for (const [pattern, action] of Object.entries(value)) {
        rules.push({
          permission: permission as PermissionType,
          pattern,
          action,
        });
      }
    }
  }

  return rules;
}

/**
 * Format rules for config output
 */
export function formatConfigRules(rules: PermissionRule[]): PermissionConfig {
  const config: PermissionConfig = {};

  for (const rule of rules) {
    if (!config[rule.permission]) {
      config[rule.permission] = {};
    }

    const value = config[rule.permission];
    if (typeof value === "string") {
      // Convert simple string to object format
      config[rule.permission] = { "*": value };
    }

    (config[rule.permission] as Record<string, PermissionAction>)[rule.pattern] = rule.action;
  }

  return config;
}

/**
 * Expand path patterns (~/, $HOME)
 */
export function expandPath(pattern: string, homeDir?: string): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const os = require("os");
  const home = homeDir || os.homedir();

  if (pattern.startsWith("~/")) {
    return home + pattern.slice(1);
  }
  if (pattern === "~") {
    return home;
  }
  if (pattern.startsWith("$HOME/")) {
    return home + pattern.slice(6);
  }
  if (pattern.startsWith("$HOME")) {
    return home + pattern.slice(5);
  }

  return pattern;
}
