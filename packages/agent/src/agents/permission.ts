import { homedir } from "node:os";

export type PermissionAction = "allow" | "deny" | "ask";

export interface PermissionRule {
  action: PermissionAction;
  pattern: string;
  permission: string;
}

export type PermissionRuleset = PermissionRule[];

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

  return new RegExp(`^${escaped}$`, process.platform === "win32" ? "si" : "s").test(normalized);
}

export function evaluate(
  permission: string,
  pattern: string,
  ...rulesets: PermissionRuleset[]
): PermissionRule {
  return (
    rulesets
      .flat()
      .findLast((rule) => match(permission, rule.permission) && match(pattern, rule.pattern)) ?? {
      action: "ask",
      permission,
      pattern: "*",
    }
  );
}

function expand(pattern: string): string {
  if (pattern.startsWith("~/") || pattern === "~") {
    return homedir() + pattern.slice(1);
  }
  if (pattern.startsWith("$HOME/")) {
    return homedir() + pattern.slice(5);
  }
  if (pattern.startsWith("$HOME")) {
    return homedir() + pattern.slice(5);
  }
  return pattern;
}

export type PermissionConfig = Record<string, PermissionAction | Record<string, PermissionAction>>;

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

export function merge(...rulesets: PermissionRuleset[]): PermissionRuleset {
  return rulesets.flat();
}

export function disabled(tools: string[], ruleset: PermissionRuleset): Set<string> {
  return new Set(
    tools.filter((tool) => {
      const rule = ruleset.findLast((r) => match(tool, r.permission));
      return rule?.pattern === "*" && rule.action === "deny";
    }),
  );
}
