import { describe, expect, it } from "vitest";
import {
  BUILTIN_AGENTS,
  resolveBuiltinAgent,
} from "../../agents/builtin-agents";
import {
  evaluate,
  fromConfig,
  merge,
  type PermissionRuleset,
} from "../../agents/permission";

function decision(
  ruleset: PermissionRuleset,
  permission: string,
  pattern: string
) {
  return evaluate(permission, pattern, ruleset).action;
}

describe("builtin agents", () => {
  it("exposes build, explore, plan, general", () => {
    expect(BUILTIN_AGENTS.map((a) => a.name).sort()).toEqual([
      "build",
      "explore",
      "general",
      "plan",
    ]);
  });

  it("build is allow-all but asks on reads of .env (except .env.example) and external dirs", () => {
    const build = resolveBuiltinAgent("build");
    expect(build).toBeDefined();
    const rs = build!.permission!;
    expect(decision(rs, "read", "secret.env")).toBe("ask");
    expect(decision(rs, "read", "config/.env.local")).toBe("ask");
    expect(decision(rs, "read", "config/.env.example")).toBe("allow");
    expect(decision(rs, "read", "src/a.ts")).toBe("allow");
    expect(decision(rs, "edit", "src/a.ts")).toBe("allow");
    expect(decision(rs, "bash", "ls -la")).toBe("allow");
    expect(decision(rs, "external_directory", "/etc/passwd")).toBe("ask");
  });

  it("explore is read-only: denies edit/write but allows read/grep/glob/list/bash", () => {
    const explore = resolveBuiltinAgent("explore");
    expect(explore).toBeDefined();
    const rs = explore!.permission!;
    expect(decision(rs, "edit", "src/a.ts")).toBe("deny");
    expect(decision(rs, "read", "src/a.ts")).toBe("allow");
    expect(decision(rs, "grep", "foo")).toBe("allow");
    expect(decision(rs, "glob", "**/*.ts")).toBe("allow");
    expect(decision(rs, "list", "src")).toBe("allow");
    expect(decision(rs, "bash", "ls")).toBe("allow");
  });

  it("explore denies external_directory access (bash outside cwd blocked)", () => {
    const explore = resolveBuiltinAgent("explore");
    const rs = explore!.permission!;
    expect(decision(rs, "external_directory", "/etc/passwd")).toBe("deny");
  });

  it("plan denies all edits but keeps reads", () => {
    const plan = resolveBuiltinAgent("plan");
    expect(plan).toBeDefined();
    const rs = plan!.permission!;
    expect(decision(rs, "edit", "src/a.ts")).toBe("deny");
    expect(decision(rs, "read", "src/a.ts")).toBe("allow");
  });

  it("builtin rulesets merge cleanly with a session grant (later wins)", () => {
    const build = resolveBuiltinAgent("build")!.permission!;
    const sessionGrant = fromConfig({ read: { "*.env": "allow" } });
    const merged = merge(build, sessionGrant);
    // session grant lifts the build .env denial
    expect(decision(merged, "read", "secret.env")).toBe("allow");
  });
});
