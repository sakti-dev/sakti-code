import { type AgentDefinition, fromConfig } from "@sakti-code/agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  getPermissionChannel,
  resetPermissionChannelsForTesting,
} from "../../lib/permission-channel.ts";
import { resolveServerAgent } from "../config/index.ts";
import {
  buildPermissionEvaluator,
  clearRunsForTesting,
  registerRun,
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
  it("build ruleset asks on .env reads and allows everything else", () => {
    const build = resolveServerAgent("build")!;
    const decide = buildPermissionEvaluator(build.permission!);
    expect(decide("read", "secret.env")).toBe("ask");
    expect(decide("read", "src/a.ts")).toBe("allow");
    expect(decide("edit", "src/a.ts")).toBe("allow");
  });

  it("explore ruleset denies edits but allows reads/search/bash", () => {
    const explore = resolveServerAgent("explore")!;
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
    expect(ctx.repos.settings.set).toHaveBeenCalledWith("session:sess-1:agent", "explore");
  });

  it("returns false for an unknown session", async () => {
    const ctx = createMockCtx();
    const ok = await switchAgentForSession(ctx, "no-such-session", "explore");
    expect(ok).toBe(false);
    expect(ctx.repos.settings.set).not.toHaveBeenCalled();
  });

  it("merges live permission grants when re-binding the evaluator mid-run", async () => {
    // An "always" grant accrued earlier in the session must still be honored
    // after a mid-run agent switch — the evaluator must consult the channel,
    // not just the agent's static ruleset.
    resetPermissionChannelsForTesting();
    const ctx = createMockCtx();
    const sessionId = "sess-1";

    // Seed a grant: explore denies `edit`, but a prior "always" allowed it.
    const channel = getPermissionChannel(sessionId);
    channel.setSink(() => undefined);
    const seeded = channel.ask({
      sessionId,
      permission: "edit",
      patterns: ["x.ts"],
      always: ["x.ts"],
      toolName: "edit",
      toolCallId: "c-seed",
    });
    channel.reply(channel.listPending()[0]!.id, "always");
    await seeded;

    let captured: ((permission: string, pattern: string) => string) | undefined;
    const fakeHarness = {
      setPermissionEvaluator: vi.fn((fn) => {
        captured = fn;
      }),
      switchAgent: vi.fn(async () => undefined),
    };
    registerRun(sessionId, fakeHarness as any, () => undefined);

    await switchAgentForSession(ctx, sessionId, "explore");

    // explore ruleset denies `edit`; the grant should override it to "allow".
    expect(captured).toBeDefined();
    expect(captured!("edit", "x.ts")).toBe("allow");
    expect(captured!("edit", "other.ts")).toBe("deny");
  });
});
