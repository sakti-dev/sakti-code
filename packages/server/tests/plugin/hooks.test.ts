/**
 * Tests for Plugin Hooks
 *
 * TDD: Test plugin hook system
 */

import { applyToolDefinitionHook, resolveHookModel, type AgentType } from "@sakti-code/core";
import {
  clearCorePluginHooks,
  setCorePluginHooks,
  triggerChatHeadersHook,
  triggerChatParamsHook,
} from "@sakti-code/core/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

describe("Plugin Hooks", () => {
  beforeEach(() => {
    clearCorePluginHooks();
  });

  describe("setCorePluginHooks / clearCorePluginHooks", () => {
    it("should set and clear hooks", () => {
      const hooks = {
        "chat.params": vi.fn(),
      };

      setCorePluginHooks(hooks);

      clearCorePluginHooks();
    });
  });

  describe("triggerChatParamsHook", () => {
    it("should return output unchanged when no hook", async () => {
      const input = {
        sessionID: "s1",
        agent: "test-agent",
        model: { providerID: "openai", modelID: "gpt-4" },
        provider: { id: "openai" },
        message: { role: "user" as const, content: "hello" },
      };

      const output = { options: {} };
      const result = await triggerChatParamsHook(input, output);

      expect(result).toBe(output);
    });

    it("should call hook when set", async () => {
      const hook = vi.fn();
      setCorePluginHooks({ "chat.params": hook });

      const input = {
        sessionID: "s1",
        agent: "test-agent",
        model: { providerID: "openai", modelID: "gpt-4" },
        provider: { id: "openai" },
        message: { role: "user" as const, content: "hello" },
      };

      const output = { options: {} };
      await triggerChatParamsHook(input, output);

      expect(hook).toHaveBeenCalledWith(input, output);
    });
  });

  describe("triggerChatHeadersHook", () => {
    it("should return output unchanged when no hook", async () => {
      const input = {
        sessionID: "s1",
        agent: "test-agent",
        model: { providerID: "openai", modelID: "gpt-4" },
        provider: { id: "openai" },
        message: { role: "user" as const, content: "hello" },
      };

      const output = { headers: {} };
      const result = await triggerChatHeadersHook(input, output);

      expect(result).toBe(output);
    });

    it("should call hook when set", async () => {
      const hook = vi.fn();
      setCorePluginHooks({ "chat.headers": hook });

      const input = {
        sessionID: "s1",
        agent: "test-agent",
        model: { providerID: "openai", modelID: "gpt-4" },
        provider: { id: "openai" },
        message: { role: "user" as const, content: "hello" },
      };

      const output = { headers: {} };
      await triggerChatHeadersHook(input, output);

      expect(hook).toHaveBeenCalledWith(input, output);
    });
  });

  describe("resolveHookModel", () => {
    it("should use runtime model when provided", () => {
      const result = resolveHookModel({
        configuredModelID: "gpt-4",
        agentType: "build" as AgentType,
        runtimeProviderID: "anthropic",
        runtimeModelID: "claude-3",
      });

      expect(result.providerID).toBe("anthropic");
      expect(result.modelID).toBe("claude-3");
    });

    it("should parse provider/model from configured ID", () => {
      const result = resolveHookModel({
        configuredModelID: "openai/gpt-4",
        agentType: "build" as AgentType,
      });

      expect(result.providerID).toBe("openai");
      expect(result.modelID).toBe("gpt-4");
    });

    it("should fallback for plan agent type", () => {
      const result = resolveHookModel({
        configuredModelID: "gpt-4",
        agentType: "plan" as AgentType,
      });

      expect(result.providerID).toBe("zai-coding-plan");
    });

    it("should fallback for build agent type", () => {
      const result = resolveHookModel({
        configuredModelID: "gpt-4",
        agentType: "build" as AgentType,
      });

      expect(result.providerID).toBe("zai-coding-plan");
    });

    it("should fallback for explore agent type", () => {
      const result = resolveHookModel({
        configuredModelID: "gpt-4",
        agentType: "explore" as AgentType,
      });

      expect(result.providerID).toBe("zai-coding-plan");
    });

    it("should use zai for other agent types", () => {
      const result = resolveHookModel({
        configuredModelID: "gpt-4",
        agentType: "hybrid" as AgentType,
      });

      expect(result.providerID).toBe("zai");
    });

    it("should handle model ID with slash in fallback", () => {
      const result = resolveHookModel({
        configuredModelID: "openai/gpt-4",
        agentType: "plan" as AgentType,
      });

      expect(result.providerID).toBe("openai");
      expect(result.modelID).toBe("gpt-4");
    });
  });

  describe("applyToolDefinitionHook", () => {
    it("should return tools unchanged when no hook", async () => {
      const tools = {
        myTool: {
          description: "A test tool",
          inputSchema: { type: "object" },
        },
      };

      const result = await applyToolDefinitionHook({ tools });

      expect(result).toEqual(tools);
    });

    it("should call hook for each tool", async () => {
      const hook = vi.fn();
      setCorePluginHooks({ "tool.definition": hook });

      const tools = {
        tool1: {
          description: "Tool 1",
          inputSchema: { type: "object" },
        },
        tool2: {
          description: "Tool 2",
          inputSchema: { type: "string" },
        },
      };

      await applyToolDefinitionHook({ tools });

      expect(hook).toHaveBeenCalledTimes(2);
    });

    it("should modify tools based on hook output", async () => {
      const hook = vi.fn(({ toolID }, output) => {
        if (toolID === "myTool") {
          output.description = "Modified description";
        }
      });
      setCorePluginHooks({ "tool.definition": hook });

      const tools = {
        myTool: {
          description: "Original description",
          inputSchema: { type: "object" },
        },
      };

      const result = await applyToolDefinitionHook({ tools });

      expect((result.myTool as { description?: string }).description).toBe("Modified description");
    });

    it("should handle tools without proper structure", async () => {
      const hook = vi.fn();
      setCorePluginHooks({ "tool.definition": hook });

      const tools = {
        simpleTool: "not an object" as unknown,
      };

      const result = await applyToolDefinitionHook({ tools: tools as Record<string, unknown> });

      expect(result.simpleTool).toBe("not an object");
    });
  });
});
