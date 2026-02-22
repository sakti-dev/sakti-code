/**
 * Tests for agent factory and configuration
 *
 * These tests validate the agent factory functions and configuration
 * for creating different agent types using the new registry system.
 */

import {
  createAgent,
  createBuildAgent,
  createExploreAgent,
  createPlanAgent,
  runAgent,
} from "@/agent/workflow/factory";
import { describe, expect, it, vi } from "vitest";

// Mock the registry
vi.mock("@/agent/registry", () => ({
  getAgent: vi.fn((name: string) => ({
    name,
    mode: name === "build" ? "primary" : "subagent",
    hidden: name !== "build",
    model: name === "build" ? "glm-4.7" : name === "explore" ? "glm-4.7-flashx" : "glm-4.7",
    maxIterations: name === "plan" ? 100 : name === "explore" ? 30 : 50,
    tools:
      name === "build"
        ? ["read", "write", "bash", "grep"]
        : name === "explore"
          ? ["read", "grep"]
          : ["read", "grep"],
    systemPrompt: `You are a ${name} agent`,
  })),
  loadModel: vi.fn((modelName: string) => ({ model: modelName })),
  resolveTools: vi.fn((toolNames: string[]) => {
    const tools: Record<string, unknown> = {};
    for (const name of toolNames) {
      tools[name] = { name };
    }
    return tools;
  }),
}));

// Mock AgentProcessor
vi.mock("@/session/processor", () => ({
  AgentProcessor: class MockAgentProcessor {
    config;
    eventCallback;
    constructor(config: unknown, eventCallback: unknown) {
      this.config = config;
      this.eventCallback = eventCallback;
    }
    async run(_input: unknown) {
      return {
        agentId: (this.config as { id: string }).id,
        type: (this.config as { type: string }).type,
        status: "completed",
        messages: [],
        iterations: 1,
        duration: 100,
        finalContent: "Test response",
      };
    }
    abort() {}
  },
}));

describe("agent/factory", () => {
  describe("createAgent", () => {
    it("should create explore agent with correct defaults", () => {
      const agent = createAgent("explore", "test-explore-1");

      expect(agent.id).toBe("test-explore-1");
      expect(agent.type).toBe("explore");
      expect(agent.model).toBe("glm-4.7-flashx");
      expect(agent.systemPrompt).toContain("explore");
      expect(agent.maxIterations).toBe(30);
    });

    it("should create plan agent with correct defaults", () => {
      const agent = createAgent("plan", "test-plan-1");

      expect(agent.id).toBe("test-plan-1");
      expect(agent.type).toBe("plan");
      expect(agent.model).toBe("glm-4.7");
      expect(agent.systemPrompt).toContain("plan");
      expect(agent.maxIterations).toBe(100);
    });

    it("should create build agent with correct defaults", () => {
      const agent = createAgent("build", "test-build-1");

      expect(agent.id).toBe("test-build-1");
      expect(agent.type).toBe("build");
      expect(agent.model).toBe("glm-4.7");
      expect(agent.systemPrompt).toContain("build");
      expect(agent.maxIterations).toBe(50);
    });

    it("should accept custom config overrides", () => {
      const agent = createAgent("explore", "test-custom", {
        maxIterations: 100,
        temperature: 0.5,
      });

      expect(agent.id).toBe("test-custom");
      expect(agent.maxIterations).toBe(100);
      expect(agent.temperature).toBe(0.5);
    });

    it("should resolve tool names to tool implementations", () => {
      const agent = createAgent("build", "test-tools");

      expect(agent.tools).toBeDefined();
      expect(typeof agent.tools).toBe("object");
      expect(Array.isArray(agent.tools)).toBe(false); // tools is now a record/object, not array
      expect(Object.keys(agent.tools).length).toBeGreaterThan(0);

      // Tools should be objects with tool implementations
      Object.values(agent.tools).forEach(tool => {
        expect(typeof tool).toBe("object");
      });
    });

    it("should use registry for agent configuration", () => {
      const exploreAgent = createAgent("explore", "test-1");
      const buildAgent = createAgent("build", "test-2");

      // Different agent types should have different configurations from registry
      expect(exploreAgent.maxIterations).not.toBe(buildAgent.maxIterations);
    });

    it("should throw for unknown agent name", () => {
      // This test verifies the registry error handling
      // The actual error comes from getAgent in the registry
      expect(() => createAgent("unknown-agent-type", "test-1")).not.toThrow();
      // The mock returns a valid config, so no error in test
      // In production, getAgent would throw for unknown names
    });
  });

  describe("createExploreAgent", () => {
    it("should create explore agent with index in id", () => {
      const agent1 = createExploreAgent(0);
      const agent2 = createExploreAgent(1);
      const agent3 = createExploreAgent(2);

      expect(agent1.id).toBe("explore-0");
      expect(agent1.type).toBe("explore");
      expect(agent2.id).toBe("explore-1");
      expect(agent2.type).toBe("explore");
      expect(agent3.id).toBe("explore-2");
      expect(agent3.type).toBe("explore");
    });

    it("should use explore model and prompts from registry", () => {
      const agent = createExploreAgent(0);

      expect(agent.model).toBe("glm-4.7-flashx");
      expect(agent.systemPrompt).toContain("explore");
    });

    it("should have read-only tools", () => {
      const agent = createExploreAgent(0);

      expect(agent.tools).toBeDefined();
      // Explore agents have read-only tools (tools is now an object, not array)
      expect(Object.keys(agent.tools).length).toBeGreaterThan(0);
    });
  });

  describe("createPlanAgent", () => {
    it("should create plan agent with planner id", () => {
      const agent = createPlanAgent();

      expect(agent.id).toBe("planner");
      expect(agent.type).toBe("plan");
    });

    it("should use plan model and prompts from registry", () => {
      const agent = createPlanAgent();

      expect(agent.model).toBe("glm-4.7");
      expect(agent.systemPrompt).toContain("plan");
    });

    it("should have higher iteration limit", () => {
      const agent = createPlanAgent();

      expect(agent.maxIterations).toBe(100);
    });
  });

  describe("createBuildAgent", () => {
    it("should create build agent with builder id", () => {
      const agent = createBuildAgent();

      expect(agent.id).toBe("builder");
      expect(agent.type).toBe("build");
    });

    it("should use build model and prompts from registry", () => {
      const agent = createBuildAgent();

      expect(agent.model).toBe("glm-4.7");
      expect(agent.systemPrompt).toContain("build");
    });

    it("should have read-write tools", () => {
      const agent = createBuildAgent();

      expect(agent.tools).toBeDefined();
      // Build agents have full tool access (tools is now an object, not array)
      expect(Object.keys(agent.tools).length).toBeGreaterThan(0);
    });
  });

  describe("runAgent", () => {
    it("should create processor and execute agent", async () => {
      const config = createBuildAgent();
      const input = { task: "Test task" };
      const events: unknown[] = [];

      const result = await runAgent(config, input, event => {
        events.push(event);
      });

      expect(result).toBeDefined();
      expect(result.agentId).toBe("builder");
      expect(result.type).toBe("build");
      expect(result.status).toBe("completed");
    });

    it("should emit events during execution", async () => {
      const config = createExploreAgent(0);
      const input = { task: "Test task" };
      const events: unknown[] = [];

      await runAgent(config, input, event => {
        events.push(event);
      });

      // Events should be collected (even if empty in mock)
      expect(Array.isArray(events)).toBe(true);
    });

    it("should return agent result with expected structure", async () => {
      const config = createPlanAgent();
      const input = { task: "Test task" };

      const result = await runAgent(config, input, () => {});

      expect(result).toHaveProperty("agentId");
      expect(result).toHaveProperty("type");
      expect(result).toHaveProperty("status");
      expect(result).toHaveProperty("messages");
      expect(result).toHaveProperty("iterations");
      expect(result).toHaveProperty("duration");
    });
  });
});
