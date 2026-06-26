/**
 * Permission engine — ported from opencode (`packages/core/src/util/wildcard.ts`
 * for {@link match}, and `packages/opencode/src/permission/index.ts` for
 * {@link evaluate}, {@link fromConfig}, {@link merge}, {@link disabled}).
 * Plain TS, no Effect.
 *
 * A rule says: for tool `permission` (e.g. "read", "bash") operating on `pattern`
 * (e.g. a file path or command string), take `action` ("allow" | "deny" | "ask").
 * A ruleset is a flat list of rules; later rules win (findLast). Used to gate
 * every tool call centrally from the agent loop.
 */

import { homedir } from "node:os";

/** Action a permission rule can take. `ask` is interactive (deferred to Phase 4). */
export type PermissionAction = "allow" | "deny" | "ask";

/** A single permission rule. */
export interface PermissionRule {
  /** What to do when this rule matches. */
  action: PermissionAction;
  /** Argument pattern (glob), e.g. a file path or command string. */
  pattern: string;
  /** Tool or category name (glob), e.g. "read", "bash", "*". */
  permission: string;
}

/** A flat list of permission rules; later rules win on conflict. */
export type PermissionRuleset = PermissionRule[];

/**
 * Glob match, ported verbatim from opencode's `Wildcard.match`. Supports `*`
 * and `?`, normalizes backslashes, and a trailing `<pattern> *` matches the
 * pattern with or without trailing args. Case-insensitive on Windows only.
 */
export function match(input: string, pattern: string): boolean {
  const normalized = input.replaceAll("\\", "/");
  let escaped = pattern
    .replaceAll("\\", "/")
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");

  if (escaped.endsWith(" .*")) {
    escaped = `${escaped.slice(0, -3)}( .*)?`;
  }

  return new RegExp(
    `^${escaped}$`,
    process.platform === "win32" ? "si" : "s"
  ).test(normalized);
}

/**
 * Find the effective rule for a given `permission` operating on `pattern`.
 * Flattens all `rulesets` and returns the LAST rule whose permission and pattern
 * both match; defaults to `{ action: "ask", permission, pattern: "*" }` when
 * nothing matches. Ported verbatim from opencode's `evaluate`.
 */
export function evaluate(
  permission: string,
  pattern: string,
  ...rulesets: PermissionRuleset[]
): PermissionRule {
  return (
    rulesets
      .flat()
      .findLast(
        (rule) =>
          match(permission, rule.permission) && match(pattern, rule.pattern)
      ) ?? {
      action: "ask",
      permission,
      pattern: "*",
    }
  );
}

/** Expand `~` / `$HOME` prefixes to the user's home directory. Ported verbatim. */
function expand(pattern: string): string {
  if (pattern.startsWith("~/")) {
    return homedir() + pattern.slice(1);
  }
  if (pattern === "~") {
    return homedir();
  }
  if (pattern.startsWith("$HOME/")) {
    return homedir() + pattern.slice(5);
  }
  if (pattern.startsWith("$HOME")) {
    return homedir() + pattern.slice(5);
  }
  return pattern;
}

/**
 * Nested permission config tree as users write it (e.g. in agent markdown
 * frontmatter): `{ "*": "allow", read: { "*.env": "ask", "*": "allow" } }`.
 * A string value means "all args" (pattern `*`); a nested object maps arg
 * patterns to actions.
 */
export type PermissionConfig = Record<
  string,
  PermissionAction | Record<string, PermissionAction>
>;

/**
 * Flatten a nested {@link PermissionConfig} tree into a {@link PermissionRuleset}.
 * Ported verbatim from opencode's `fromConfig`; expands `~`/`$HOME` in patterns.
 */
export function fromConfig(permission: PermissionConfig): PermissionRuleset {
  const ruleset: PermissionRuleset = [];
  for (const [key, value] of Object.entries(permission)) {
    if (typeof value === "string") {
      ruleset.push({ permission: key, action: value, pattern: "*" });
      continue;
    }
    for (const [pattern, action] of Object.entries(value)) {
      ruleset.push({ permission: key, pattern: expand(pattern), action });
    }
  }
  return ruleset;
}

/**
 * Concatenate rulesets into one flat list. Conflict resolution is "later wins"
 * via {@link evaluate}'s `findLast`, so call order encodes precedence. Ported
 * verbatim from opencode's `merge`.
 */
export function merge(...rulesets: PermissionRuleset[]): PermissionRuleset {
  return rulesets.flat();
}

/**
 * Set of tool names whose whole-permission rule (pattern `*`) is `deny` — i.e.
 * tools that should be excluded entirely from the tool list presented to the
 * model. Ported verbatim from opencode's `disabled`.
 */
export function disabled(
  tools: string[],
  ruleset: PermissionRuleset
): Set<string> {
  return new Set(
    tools.filter((tool) => {
      const rule = ruleset.findLast((r) => match(tool, r.permission));
      return rule?.pattern === "*" && rule.action === "deny";
    })
  );
}
