import { evaluate, fromConfig, merge, type PermissionRuleset } from "@sakti-code/agent";
import { describe, expect, it } from "vite-plus/test";
import { BASE_PROMPT } from "../prompts.ts";
import { resolveServerAgent, SERVER_AGENTS } from "../server-agents.ts";

function decision(ruleset: PermissionRuleset, permission: string, pattern: string) {
  return evaluate(permission, pattern, ruleset).action;
}

describe("server agents", () => {
  it("exposes build, explore, general, plan, verify", () => {
    expect(SERVER_AGENTS.map((a) => a.name).sort()).toEqual([
      "build",
      "explore",
      "general",
      "plan",
      "verify",
    ]);
  });

  it("phase agents (build/verify/plan) share the stable BASE_PROMPT — no role sections", () => {
    // The system prompt is stable across phases so the prompt cache survives
    // the build↔verify agent swaps. Phase guidance rides <instruction> blocks,
    // not the system prompt.
    for (const name of ["build", "verify", "plan"]) {
      const agent = resolveServerAgent(name);
      expect(agent).toBeDefined();
      expect(agent?.systemPrompt).toBe(BASE_PROMPT);
    }
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

  it("server rulesets merge cleanly with a session grant (later wins)", () => {
    const build = resolveServerAgent("build")!.permission!;
    const sessionGrant = fromConfig({ read: { "*.env": "allow" } });
    const merged = merge(build, sessionGrant);
    // session grant lifts the build .env denial
    expect(decision(merged, "read", "secret.env")).toBe("allow");
  });

  it("includes plan as a first-class agent with its own permission ruleset and tool list", () => {
    const plan = resolveServerAgent("plan");
    expect(plan).toBeDefined();
    expect(plan!.permission).toBeDefined();
    expect(plan!.activeToolNames).toContain("ask");
    expect(plan!.activeToolNames).toContain("read");

    const build = resolveServerAgent("build")!;
    // Plan has a distinct ruleset from build (not inheriting).
    expect(plan!.permission).not.toBe(build.permission);
    // Both plan and build carry ask (the SDD gate tool).
    expect(build.activeToolNames).toContain("ask");
  });

  it("plan ruleset asks before destructive bash ops but allows research ops", () => {
    const plan = resolveServerAgent("plan");
    const rs = plan!.permission!;
    expect(decision(rs, "bash", "rm -rf /tmp/x")).toBe("ask");
    expect(decision(rs, "bash", "git push origin main")).toBe("ask");
    expect(decision(rs, "bash", "git reset --hard HEAD~3")).toBe("ask");
    // Research ops still allowed.
    expect(decision(rs, "read", "src/a.ts")).toBe("allow");
    expect(decision(rs, "edit", "docs/plan.md")).toBe("allow");
    expect(decision(rs, "bash", "ls -la")).toBe("allow");
  });
});

describe("verify agent", () => {
  it("is registered as a primary agent", () => {
    const agent = resolveServerAgent("verify");
    expect(agent).toBeDefined();
    expect(agent?.mode).toBe("primary");
  });

  it("declares read/grep/find/bash/webfetch/websearch/ask tools (no write/edit)", () => {
    const agent = resolveServerAgent("verify")!;
    expect(agent.activeToolNames).toEqual([
      "read",
      "grep",
      "find",
      "bash",
      "webfetch",
      "websearch",
      "ask",
    ]);
  });

  it("denies edit and write permissions structurally", () => {
    const agent = resolveServerAgent("verify")!;
    const rs = agent.permission!;
    expect(decision(rs, "edit", "/any/path.ts")).toBe("deny");
    expect(decision(rs, "write", "/any/path.ts")).toBe("deny");
  });

  it("allows read, grep, find, bash", () => {
    const agent = resolveServerAgent("verify")!;
    const rs = agent.permission!;
    expect(decision(rs, "read", "/any/path.ts")).toBe("allow");
    expect(decision(rs, "grep", "pattern")).toBe("allow");
    expect(decision(rs, "find", "pattern")).toBe("allow");
    expect(decision(rs, "bash", "ls")).toBe("allow");
  });
});

describe("spec agent removal", () => {
  it("does not register a 'spec' agent", () => {
    const agent = resolveServerAgent("spec");
    expect(agent).toBeUndefined();
  });

  it("SERVER_AGENTS contains exactly build, explore, general, plan, verify", () => {
    const names = SERVER_AGENTS.map((a) => a.name).sort();
    expect(names).toEqual(["build", "explore", "general", "plan", "verify"]);
  });
});
