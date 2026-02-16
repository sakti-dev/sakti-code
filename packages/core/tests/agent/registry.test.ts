/**
 * Tests for Agent Registry
 *
 * Tests for the centralized agent configuration registry.
 * Validates agent lookup, defaults, and tool resolution.
 */

import { describe, expect, it, vi } from "vitest";
import {
  AGENT_REGISTRY,
  getAgent,
  getDefaultAgent,
  listAgents,
  loadModel,
  resolveTools,
} from "../../src/agent/registry";

// Mock model provider functions
vi.mock("../../src/agent/workflow/model-provider", () => ({
  getBuildModel: vi.fn(() => ({ model: "glm-4.7" })),
  getExploreModel: vi.fn(() => ({ model: "glm-4.7-flashx" })),
  getPlanModel: vi.fn(() => ({ model: "glm-4.7" })),
}));

describe("agent/registry", () => {
  describe("AGENT_REGISTRY", () => {
    it("should have build agent configured", () => {
      expect(AGENT_REGISTRY).toHaveProperty("build");
      const buildAgent = AGENT_REGISTRY.build;

      expect(buildAgent.name).toBe("build");
      expect(buildAgent.mode).toBe("primary");
      expect(buildAgent.model).toBe("glm-4.7");
      expect(buildAgent.maxIterations).toBe(50);
      expect(buildAgent.tools).toContain("read");
      expect(buildAgent.tools).toContain("write");
      expect(buildAgent.tools).toContain("bash");
      expect(buildAgent.tools).toContain("task-query");
      expect(buildAgent.tools).toContain("task-mutate");
      expect(buildAgent.tools).toContain("memory-search");
      expect(buildAgent.systemPrompt).toBeTruthy();
      expect(buildAgent.systemPrompt.length).toBeGreaterThan(0);
    });

    it("should have explore agent configured", () => {
      expect(AGENT_REGISTRY).toHaveProperty("explore");
      const exploreAgent = AGENT_REGISTRY.explore;

      expect(exploreAgent.name).toBe("explore");
      expect(exploreAgent.mode).toBe("subagent");
      expect(exploreAgent.hidden).toBe(true);
      expect(exploreAgent.model).toBe("glm-4.7-flashx");
      expect(exploreAgent.maxIterations).toBe(30);
      expect(exploreAgent.tools).toContain("read");
      expect(exploreAgent.tools).toContain("grep");
      // Explore agent should NOT have write tools
      expect(exploreAgent.tools).not.toContain("write");
      expect(exploreAgent.tools).not.toContain("bash");
    });

    it("should have plan agent configured", () => {
      expect(AGENT_REGISTRY).toHaveProperty("plan");
      const planAgent = AGENT_REGISTRY.plan;

      expect(planAgent.name).toBe("plan");
      expect(planAgent.mode).toBe("subagent");
      expect(planAgent.hidden).toBe(true);
      expect(planAgent.model).toBe("glm-4.7");
      expect(planAgent.maxIterations).toBe(100);
      expect(planAgent.tools).toContain("read");
      expect(planAgent.tools).toContain("grep");
      // Plan agent should NOT have write tools
      expect(planAgent.tools).not.toContain("write");
      expect(planAgent.tools).not.toContain("bash");
    });

    it("should have at least 3 agents configured", () => {
      const agentNames = Object.keys(AGENT_REGISTRY);
      expect(agentNames.length).toBeGreaterThanOrEqual(3);
      expect(agentNames).toContain("build");
      expect(agentNames).toContain("explore");
      expect(agentNames).toContain("plan");
    });
  });

  describe("getAgent(name)", () => {
    it("should return build agent config by default", () => {
      const agent = getAgent("build");

      expect(agent.name).toBe("build");
      expect(agent.mode).toBe("primary");
      expect(agent.model).toBe("glm-4.7");
    });

    it("should return explore agent config for subagents", () => {
      const agent = getAgent("explore");

      expect(agent.name).toBe("explore");
      expect(agent.mode).toBe("subagent");
      expect(agent.hidden).toBe(true);
    });

    it("should return plan agent config when requested", () => {
      const agent = getAgent("plan");

      expect(agent.name).toBe("plan");
      expect(agent.mode).toBe("subagent");
      expect(agent.maxIterations).toBe(100);
    });

    it("should throw for unknown agent types", () => {
      expect(() => getAgent("unknown")).toThrow("Unknown agent: unknown");
    });

    it("should include available agents in error message", () => {
      try {
        getAgent("nonexistent");
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain("build");
        expect((error as Error).message).toContain("explore");
        expect((error as Error).message).toContain("plan");
      }
    });
  });

  describe("listAgents()", () => {
    it("should return all non-hidden agents", () => {
      const agents = listAgents();

      // Should include build (not hidden)
      expect(agents.some(a => a.name === "build")).toBe(true);

      // Should NOT include explore (hidden)
      expect(agents.some(a => a.name === "explore")).toBe(false);

      // Should NOT include plan (hidden)
      expect(agents.some(a => a.name === "plan")).toBe(false);
    });

    it("should return array of agent configs", () => {
      const agents = listAgents();

      expect(Array.isArray(agents)).toBe(true);
      expect(agents.length).toBeGreaterThan(0);

      const firstAgent = agents[0];
      expect(firstAgent).toHaveProperty("name");
      expect(firstAgent).toHaveProperty("mode");
      expect(firstAgent).toHaveProperty("model");
      expect(firstAgent).toHaveProperty("tools");
      expect(firstAgent).toHaveProperty("systemPrompt");
    });

    it("should include agent metadata", () => {
      const agents = listAgents();
      const buildAgent = agents.find(a => a.name === "build");

      expect(buildAgent).toBeDefined();
      expect(buildAgent?.mode).toBe("primary");
      expect(buildAgent?.model).toBeTruthy();
      expect(buildAgent?.maxIterations).toBeGreaterThan(0);
    });
  });

  describe("getDefaultAgent()", () => {
    it("should return 'build' as default", () => {
      expect(getDefaultAgent()).toBe("build");
    });

    it("should return a valid agent name", () => {
      const defaultAgent = getDefaultAgent();
      expect(() => getAgent(defaultAgent)).not.toThrow();
    });
  });

  describe("loadModel(modelName)", () => {
    it("should load glm-4.7 model", () => {
      const model = loadModel("glm-4.7");
      expect(model).toBeDefined();
    });

    it("should load glm-4.7-flash model", () => {
      const model = loadModel("glm-4.7-flash");
      expect(model).toBeDefined();
    });

    it("should load glm-4.7-flashx model", () => {
      const model = loadModel("glm-4.7-flashx");
      expect(model).toBeDefined();
    });

    it("should throw for unknown model", () => {
      expect(() => loadModel("unknown-model")).toThrow("Unknown model: unknown-model");
    });

    it("should include available models in error message", () => {
      try {
        loadModel("gpt-5");
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain("glm-4.7");
      }
    });
  });

  describe("resolveTools(toolNames)", () => {
    it("should resolve tool names to tool implementations", () => {
      const tools = resolveTools(["read", "write", "grep"]);

      expect(tools).toBeDefined();
      expect(typeof tools).toBe("object");
      expect(tools).toHaveProperty("read");
      expect(tools).toHaveProperty("write");
      expect(tools).toHaveProperty("grep");
    });

    it("should handle empty tool list", () => {
      const tools = resolveTools([]);
      expect(tools).toEqual({});
    });

    it("should resolve all valid tool names", () => {
      const toolNames: Array<"read" | "write" | "bash" | "grep"> = [
        "read",
        "write",
        "bash",
        "grep",
      ];
      const tools = resolveTools(toolNames);

      Object.keys(tools).forEach(key => {
        expect(toolNames).toContain(key as (typeof toolNames)[number]);
      });
    });

    it("should return tools that can be used with AI SDK", () => {
      const tools = resolveTools(["read", "grep"]);

      // Each tool should have the expected structure for AI SDK
      Object.values(tools).forEach(tool => {
        expect(tool).toBeDefined();
        expect(typeof tool).toBe("object");
      });
    });
  });
});
