/**
 * Tests for agent types
 *
 * These tests validate the type definitions for the new opencode-style
 * agent architecture, replacing the XState-based actors.
 */

import {
  AgentConfig,
  AgentEvent,
  AgentInput,
  AgentResult,
  AgentType,
} from "@/agent/workflow/types";
import { describe, expect, it } from "vitest";

describe("agent/types", () => {
  describe("AgentType", () => {
    it("should accept valid agent types", () => {
      expect(AgentType.parse("explore")).toBe("explore");
      expect(AgentType.parse("plan")).toBe("plan");
      expect(AgentType.parse("build")).toBe("build");
    });

    it("should reject invalid agent types", () => {
      expect(() => AgentType.parse("invalid")).toThrow();
    });
  });

  describe("AgentConfig", () => {
    const validConfig = {
      id: "test-agent",
      type: "explore" as const,
      model: "glm-4.7",
      systemPrompt: "You are a test agent",
      tools: {}, // Changed from [] to {} - tools must be an object with named keys
      maxIterations: 50,
    };

    it("should accept valid agent config", () => {
      const result = AgentConfig.safeParse(validConfig);
      expect(result.success).toBe(true);
    });

    it("should accept config without optional fields", () => {
      const minimalConfig = {
        id: "test-agent",
        type: "explore" as const,
        model: "glm-4.7",
        systemPrompt: "You are a test agent",
        tools: {}, // Changed from [] to {} - tools must be an object with named keys
      };
      const result = AgentConfig.safeParse(minimalConfig);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.maxIterations).toBe(50); // default
      }
    });

    it("should reject config without required fields", () => {
      const incompleteConfig = {
        id: "test-agent",
        type: "explore" as const,
      };
      const result = AgentConfig.safeParse(incompleteConfig);
      expect(result.success).toBe(false);
    });
  });

  describe("AgentResult", () => {
    const validResult = {
      agentId: "test-agent",
      type: "explore" as const,
      status: "completed" as const,
      messages: [],
      iterations: 5,
      duration: 1000,
    };

    it("should accept valid agent result with completed status", () => {
      const result = AgentResult.safeParse(validResult);
      expect(result.success).toBe(true);
    });

    it("should accept valid agent result with failed status", () => {
      const failedResult = {
        ...validResult,
        status: "failed" as const,
        error: "Something went wrong",
      };
      const result = AgentResult.safeParse(failedResult);
      expect(result.success).toBe(true);
    });

    it("should accept valid agent result with stopped status", () => {
      const stoppedResult = {
        ...validResult,
        status: "stopped" as const,
      };
      const result = AgentResult.safeParse(stoppedResult);
      expect(result.success).toBe(true);
    });

    it("should accept result with finalContent", () => {
      const resultWithContent = {
        ...validResult,
        finalContent: "Task completed successfully",
      };
      const result = AgentResult.safeParse(resultWithContent);
      expect(result.success).toBe(true);
    });
  });

  describe("AgentInput", () => {
    const validInput = {
      task: "Test task",
    };

    it("should accept valid agent input", () => {
      const result = AgentInput.safeParse(validInput);
      expect(result.success).toBe(true);
    });

    it("should accept input with context", () => {
      const inputWithContext = {
        ...validInput,
        context: { key: "value" },
      };
      const result = AgentInput.safeParse(inputWithContext);
      expect(result.success).toBe(true);
    });

    it("should accept input with previousResults", () => {
      const inputWithResults = {
        ...validInput,
        previousResults: [
          {
            agentId: "agent-1",
            type: "explore" as const,
            status: "completed" as const,
            messages: [],
            iterations: 1,
            duration: 100,
          },
        ],
      };
      const result = AgentInput.safeParse(inputWithResults);
      expect(result.success).toBe(true);
    });
  });

  describe("AgentEvent", () => {
    it("should accept text event", () => {
      const textEvent = {
        type: "text" as const,
        text: "Sample text",
        agentId: "test-agent",
      };
      const result = AgentEvent.safeParse(textEvent);
      expect(result.success).toBe(true);
    });

    it("should accept tool-call event", () => {
      const toolCallEvent = {
        type: "tool-call" as const,
        toolCallId: "call-123",
        toolName: "read",
        args: { path: "/test" },
        agentId: "test-agent",
      };
      const result = AgentEvent.safeParse(toolCallEvent);
      expect(result.success).toBe(true);
    });

    it("should accept tool-result event", () => {
      const toolResultEvent = {
        type: "tool-result" as const,
        toolCallId: "call-123",
        toolName: "read",
        result: "content",
        agentId: "test-agent",
      };
      const result = AgentEvent.safeParse(toolResultEvent);
      expect(result.success).toBe(true);
    });

    it("should accept finish event", () => {
      const finishEvent = {
        type: "finish" as const,
        finishReason: "stop",
        agentId: "test-agent",
      };
      const result = AgentEvent.safeParse(finishEvent);
      expect(result.success).toBe(true);
    });

    it("should accept error event", () => {
      const errorEvent = {
        type: "error" as const,
        error: "Test error",
        agentId: "test-agent",
      };
      const result = AgentEvent.safeParse(errorEvent);
      expect(result.success).toBe(true);
    });

    it("should reject event without agentId", () => {
      const invalidEvent = {
        type: "text" as const,
        text: "Sample text",
      };
      const result = AgentEvent.safeParse(invalidEvent);
      expect(result.success).toBe(false);
    });
  });
});
