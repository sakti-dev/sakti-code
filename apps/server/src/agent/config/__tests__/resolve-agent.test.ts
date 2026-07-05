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
  it("plan kind with no override → plan agent", () => {
    const { agent } = resolveSessionAgentForKind("plan", []);
    expect(agent.name).toBe("plan");
    expect(agent.activeToolNames).toContain("ask");
  });

  it("mission kind with no override → build agent (the default)", () => {
    const { agent } = resolveSessionAgentForKind("mission", []);
    expect(agent.name).toBe("build");
  });

  it("mission kind with no override → build agent (no per-kind mapping for plan)", () => {
    // kindToAgentName maps only plan; mission sessions use the default unless
    // overridden.
    const { agent } = resolveSessionAgentForKind("mission", []);
    expect(agent.name).toBe("build");
  });

  it("per-session override wins over kind-based default", () => {
    const { agent } = resolveSessionAgentForKind("plan", [], "explore");
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

describe("resolveSessionAgentForKind — status-based (SDD lifecycle)", () => {
  it("mission + status='specifying' → spec agent (structurally edit-denied)", () => {
    const { agent } = resolveSessionAgentForKind("mission", [], undefined, "specifying");
    expect(agent.name).toBe("spec");
  });

  it("mission + status='building' → build agent", () => {
    const { agent } = resolveSessionAgentForKind("mission", [], undefined, "building");
    expect(agent.name).toBe("build");
  });

  it("mission + status='review' → build agent (inert fallback)", () => {
    const { agent } = resolveSessionAgentForKind("mission", [], undefined, "review");
    expect(agent.name).toBe("build");
  });

  it("mission + status='merged' → build agent (inert fallback)", () => {
    const { agent } = resolveSessionAgentForKind("mission", [], undefined, "merged");
    expect(agent.name).toBe("build");
  });

  it("mission without status → build agent (backward compatible)", () => {
    const { agent } = resolveSessionAgentForKind("mission", []);
    expect(agent.name).toBe("build");
  });

  it("plan kind ignores status (always plan)", () => {
    const { agent } = resolveSessionAgentForKind("plan", [], undefined, "specifying");
    expect(agent.name).toBe("plan");
  });

  it("per-session override wins over status-based routing", () => {
    const { agent } = resolveSessionAgentForKind("mission", [], "explore", "specifying");
    expect(agent.name).toBe("explore");
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

  it("plan agent is resolvable", () => {
    const resolved = resolveAgentByName("plan", []);
    expect(resolved.name).toBe("plan");
    expect(resolved.activeToolNames).toContain("ask");
  });
});
