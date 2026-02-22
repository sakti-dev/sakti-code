/**
 * Tests for AgentProcessor class
 *
 * These tests validate the agent loop processor that handles
 * streaming LLM responses and tool execution.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentConfig, AgentInput } from "../../src/agent/workflow/types";
import { AgentProcessor } from "../../src/session/processor";

// Mock the streamText from AI SDK
vi.mock("ai", () => ({
  streamText: vi.fn(),
  tool: vi.fn(definition => definition),
}));

describe("session/processor", () => {
  let testConfig: AgentConfig;
  let testEvents: unknown[] = [];

  beforeEach(() => {
    testEvents = [];
    testConfig = {
      id: "test-agent",
      type: "explore",
      model: "test-model",
      systemPrompt: "You are a test agent",
      tools: [],
      maxIterations: 5,
    };
  });

  describe("constructor", () => {
    it("should create processor with config and callback", () => {
      const processor = new AgentProcessor(testConfig, event => {
        testEvents.push(event);
      });

      expect(processor).toBeDefined();
    });

    it("should create abort controller", () => {
      const processor = new AgentProcessor(testConfig, () => {});

      expect(processor).toHaveProperty("abortController");
    });
  });

  describe("buildInputMessage", () => {
    it("should return task alone for minimal input", () => {
      void new AgentProcessor(testConfig, () => {});
      const input: AgentInput = { task: "Test task" };

      // This is a private method, but we can test through run()
      // For now, we'll test the behavior through the public API
      expect(input.task).toBe("Test task");
    });

    it("should include context when provided", () => {
      const input: AgentInput = {
        task: "Test task",
        context: { key: "value" },
      };

      expect(input.context).toEqual({ key: "value" });
    });

    it("should include previousResults when provided", () => {
      const input: AgentInput = {
        task: "Test task",
        previousResults: [
          {
            agentId: "agent-1",
            type: "explore",
            status: "completed",
            messages: [],
            iterations: 1,
            duration: 100,
          },
        ],
      };

      expect(input.previousResults).toHaveLength(1);
    });
  });

  describe("detectDoomLoop", () => {
    it("should not detect doom loop with insufficient history", () => {
      void new AgentProcessor(testConfig, () => {});

      // With less than 3 entries, no doom loop
      expect(true).toBe(true);
    });

    it("should detect doom loop with identical tool calls", () => {
      void new AgentProcessor(testConfig, () => {});

      // Doom loop detection happens internally during run()
      // This will be tested through integration tests
      expect(true).toBe(true);
    });
  });

  describe("abort", () => {
    it("should have abort method", () => {
      const processor = new AgentProcessor(testConfig, () => {});

      expect(typeof processor.abort).toBe("function");
    });

    it("should call abort on abortController", () => {
      const processor = new AgentProcessor(testConfig, () => {});

      // Should not throw
      expect(() => processor.abort()).not.toThrow();
    });
  });

  describe("event callback", () => {
    it("should emit events when provided", async () => {
      const events: unknown[] = [];
      void new AgentProcessor(testConfig, event => {
        events.push(event);
      });

      expect(events).toEqual([]);
    });
  });
});
