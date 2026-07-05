import { evaluate, fromConfig, merge, type PermissionRuleset } from "@sakti-code/agent";
import { describe, expect, it } from "vite-plus/test";
import { resolveServerAgent, SERVER_AGENTS } from "../server-agents.ts";

function decision(ruleset: PermissionRuleset, permission: string, pattern: string) {
  return evaluate(permission, pattern, ruleset).action;
}

describe("server agents", () => {
  it("exposes build, explore, spec, general, intake", () => {
    expect(SERVER_AGENTS.map((a) => a.name).sort()).toEqual([
      "build",
      "explore",
      "general",
      "intake",
      "spec",
    ]);
  });

  it("build is allow-all but asks on reads of .env (except .env.example) and external dirs", () => {
    const build = resolveServerAgent("build");
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

  it("explore is read-only: denies edit/write but allows read/grep/glob/bash", () => {
    const explore = resolveServerAgent("explore");
    expect(explore).toBeDefined();
    const rs = explore!.permission!;
    expect(decision(rs, "edit", "src/a.ts")).toBe("deny");
    expect(decision(rs, "read", "src/a.ts")).toBe("allow");
    expect(decision(rs, "grep", "foo")).toBe("allow");
    expect(decision(rs, "glob", "**/*.ts")).toBe("allow");
    expect(decision(rs, "bash", "ls")).toBe("allow");
  });

  it("explore denies external_directory access (bash outside cwd blocked)", () => {
    const explore = resolveServerAgent("explore");
    const rs = explore!.permission!;
    expect(decision(rs, "external_directory", "/etc/passwd")).toBe("deny");
  });

  it("spec denies all edits but keeps reads", () => {
    const spec = resolveServerAgent("spec");
    expect(spec).toBeDefined();
    const rs = spec!.permission!;
    expect(decision(rs, "edit", "src/a.ts")).toBe("deny");
    expect(decision(rs, "read", "src/a.ts")).toBe("allow");
  });

  it("server rulesets merge cleanly with a session grant (later wins)", () => {
    const build = resolveServerAgent("build")!.permission!;
    const sessionGrant = fromConfig({ read: { "*.env": "allow" } });
    const merged = merge(build, sessionGrant);
    // session grant lifts the build .env denial
    expect(decision(merged, "read", "secret.env")).toBe("allow");
  });

  it("includes intake as a first-class agent with its own permission ruleset and tool list", () => {
    const intake = resolveServerAgent("intake");
    expect(intake).toBeDefined();
    expect(intake!.permission).toBeDefined();
    expect(intake!.activeToolNames).toContain("ask");
    expect(intake!.activeToolNames).toContain("read");

    const build = resolveServerAgent("build")!;
    // Intake has a distinct ruleset from build (not inheriting).
    expect(intake!.permission).not.toBe(build.permission);
    // Both intake and build carry ask (the SDD gate tool).
    expect(build.activeToolNames).toContain("ask");
  });

  it("intake ruleset asks before destructive bash ops but allows research ops", () => {
    const intake = resolveServerAgent("intake");
    const rs = intake!.permission!;
    expect(decision(rs, "bash", "rm -rf /tmp/x")).toBe("ask");
    expect(decision(rs, "bash", "git push origin main")).toBe("ask");
    expect(decision(rs, "bash", "git reset --hard HEAD~3")).toBe("ask");
    // Research ops still allowed.
    expect(decision(rs, "read", "src/a.ts")).toBe("allow");
    expect(decision(rs, "edit", "docs/plan.md")).toBe("allow");
    expect(decision(rs, "bash", "ls -la")).toBe("allow");
  });
});
