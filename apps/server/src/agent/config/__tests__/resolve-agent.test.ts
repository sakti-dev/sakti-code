import type { AgentDefinition } from "@sakti-code/agent";
import { describe, expect, it } from "vite-plus/test";
import { resolveAgentByName, resolveSessionAgentForKind } from "../resolve-agent.ts";

// Sample loaded-from-project agents for the override tests.
const PROJECT_AGENTS: AgentDefinition[] = [
  {
    name: "build",
    mode: "primary",
    description: "project override",
    systemPrompt: "PROJECT BUILD",
  },
  {
    name: "custom",
    mode: "primary",
    description: "custom project agent",
    systemPrompt: "PROJECT CUSTOM",
  },
];

describe("resolveSessionAgentForKind", () => {
  it("intake kind with no override → intake agent", () => {
    const { agent } = resolveSessionAgentForKind("intake", []);
    expect(agent.name).toBe("intake");
    expect(agent.activeToolNames).toContain("propose_session");
  });

  it("mission kind with no override → build agent (the default)", () => {
    const { agent } = resolveSessionAgentForKind("mission", []);
    expect(agent.name).toBe("build");
  });

  it("plan kind with no override → build agent (no per-kind mapping for plan)", () => {
    // kindToAgentName maps only intake; plan sessions use the default unless
    // overridden — keeping the door open for plan-specific behavior later.
    const { agent } = resolveSessionAgentForKind("plan", []);
    expect(agent.name).toBe("build");
  });

  it("per-session override wins over kind-based default", () => {
    const { agent } = resolveSessionAgentForKind("intake", [], "explore");
    expect(agent.name).toBe("explore");
  });

  it("per-session override to 'custom' (loaded from project) wins", () => {
    const { agent } = resolveSessionAgentForKind("mission", PROJECT_AGENTS, "custom");
    expect(agent.name).toBe("custom");
    expect(agent.systemPrompt).toBe("PROJECT CUSTOM");
  });

  it("unknown override falls back to build (default)", () => {
    const { agent } = resolveSessionAgentForKind("mission", [], "nonexistent");
    expect(agent.name).toBe("build");
  });
});

describe("resolveAgentByName", () => {
  it("project override wins over server default (same name)", () => {
    const resolved = resolveAgentByName("build", PROJECT_AGENTS);
    expect(resolved.systemPrompt).toBe("PROJECT BUILD");
  });

  it("server default used when no project override", () => {
    const resolved = resolveAgentByName("explore", []);
    expect(resolved.name).toBe("explore");
  });

  it("intake agent is resolvable", () => {
    const resolved = resolveAgentByName("intake", []);
    expect(resolved.name).toBe("intake");
    expect(resolved.activeToolNames).toContain("propose_session");
  });
});
