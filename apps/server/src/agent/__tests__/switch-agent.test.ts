import { type AgentDefinition, fromConfig } from "@sakti-code/agent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveBuiltinAgent } from "../builtin-agents.ts";
import {
  buildPermissionEvaluator,
  clearRunsForTesting,
  resolveAgentByName,
  switchAgentForSession,
} from "../runner.ts";
import { createMockCtx } from "./helpers.ts";

describe("resolveAgentByName", () => {
  it("defaults to build when the name is unknown", () => {
    const agent = resolveAgentByName("does-not-exist", []);
    expect(agent.name).toBe("build");
  });

  it("resolves builtin explore by name", () => {
    expect(resolveAgentByName("explore", []).name).toBe("explore");
  });

  it("a user-defined agent overrides the builtin of the same name", () => {
    const custom: AgentDefinition = {
      name: "build",
      mode: "primary",
      description: "my build",
      systemPrompt: "custom",
      permission: fromConfig({ "*": "deny" }),
    };
    expect(resolveAgentByName("build", [custom])).toBe(custom);
  });

  it("resolves a user-defined agent not present in builtins", () => {
    const triage: AgentDefinition = {
      name: "triage",
      mode: "all",
      systemPrompt: "triage prompt",
    };
    expect(resolveAgentByName("triage", [triage]).name).toBe("triage");
  });
});

describe("buildPermissionEvaluator", () => {
  it("build ruleset denies .env reads and allows everything else", () => {
    const build = resolveBuiltinAgent("build")!;
    const decide = buildPermissionEvaluator(build.permission!);
    expect(decide("read", "secret.env")).toBe("deny");
    expect(decide("read", "src/a.ts")).toBe("allow");
    expect(decide("edit", "src/a.ts")).toBe("allow");
  });

  it("explore ruleset denies edits but allows reads/search/bash", () => {
    const explore = resolveBuiltinAgent("explore")!;
    const decide = buildPermissionEvaluator(explore.permission!);
    expect(decide("edit", "src/a.ts")).toBe("deny");
    expect(decide("read", "src/a.ts")).toBe("allow");
    expect(decide("grep", "foo")).toBe("allow");
    expect(decide("bash", "ls")).toBe("allow");
  });
});

describe("switchAgentForSession", () => {
  beforeEach(() => {
    clearRunsForTesting();
  });
  afterEach(() => {
    clearRunsForTesting();
  });

  it("persists the agent selection and returns true when no run is active", async () => {
    const ctx = createMockCtx();
    const ok = await switchAgentForSession(ctx, "sess-1", "explore");
    expect(ok).toBe(true);
    expect(ctx.repos.settings.set).toHaveBeenCalledWith(
      "session:sess-1:agent",
      "explore"
    );
  });

  it("returns false for an unknown session", async () => {
    const ctx = createMockCtx();
    const ok = await switchAgentForSession(ctx, "no-such-session", "explore");
    expect(ok).toBe(false);
    expect(ctx.repos.settings.set).not.toHaveBeenCalled();
  });
});
