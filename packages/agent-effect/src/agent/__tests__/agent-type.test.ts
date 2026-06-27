import { describe, expect, it } from "vitest";
import type { AgentDefinition, AgentMode } from "../../harness-types";

describe("AgentDefinition type", () => {
  it("supports exactly the primary/subagent/all modes", () => {
    const modes: AgentMode[] = ["primary", "subagent", "all"];
    expect(modes).toHaveLength(3);
  });

  it("builds a minimal agent with only required fields", () => {
    const agent: AgentDefinition = {
      name: "build",
      mode: "primary",
      systemPrompt: "You are a helpful assistant.",
    };
    expect(agent.name).toBe("build");
  });

  it("accepts the optional fields", () => {
    const agent: AgentDefinition = {
      name: "explore",
      mode: "subagent",
      hidden: true,
      description: "codebase explorer",
      systemPrompt: "explore",
      activeToolNames: ["read", "grep"],
    };
    expect(agent.hidden).toBe(true);
    expect(agent.activeToolNames).toEqual(["read", "grep"]);
  });
});
