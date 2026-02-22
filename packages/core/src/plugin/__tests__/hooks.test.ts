import {
  applyToolDefinitionHook,
  clearCorePluginHooks,
  resolveHookModel,
  setCorePluginHooks,
  triggerChatHeadersHook,
  triggerChatParamsHook,
} from "@/plugin/hooks";
import { describe, expect, it } from "vitest";

describe("plugin/hooks", () => {
  it("resolves model/provider using runtime values when available", () => {
    const resolved = resolveHookModel({
      configuredModelID: "openai/gpt-4o",
      agentType: "build",
      runtimeProviderID: "openrouter",
      runtimeModelID: "openrouter/deepseek/chat",
    });

    expect(resolved).toEqual({
      providerID: "openrouter",
      modelID: "openrouter/deepseek/chat",
    });
  });

  it("applies chat params and chat headers hook mutations", async () => {
    setCorePluginHooks({
      "chat.params": async (_input, output) => {
        output.temperature = 0.15;
        output.options["x-provider"] = "openrouter";
      },
      "chat.headers": async (_input, output) => {
        output.headers["x-test"] = "1";
      },
    });

    const params = await triggerChatParamsHook(
      {
        sessionID: "s1",
        agent: "build",
        model: { providerID: "openrouter", modelID: "deepseek/chat" },
        provider: { id: "openrouter" },
        message: { role: "user", content: "hello" },
      },
      { temperature: 0.8, topP: undefined, topK: undefined, options: {} }
    );
    const headers = await triggerChatHeadersHook(
      {
        sessionID: "s1",
        agent: "build",
        model: { providerID: "openrouter", modelID: "deepseek/chat" },
        provider: { id: "openrouter" },
        message: { role: "user", content: "hello" },
      },
      { headers: {} }
    );

    expect(params.temperature).toBe(0.15);
    expect(params.options["x-provider"]).toBe("openrouter");
    expect(headers.headers).toEqual({ "x-test": "1" });
    clearCorePluginHooks();
  });

  it("applies tool.definition hook to description and parameters", async () => {
    setCorePluginHooks({
      "tool.definition": async ({ toolID }, output) => {
        if (toolID === "dummy") {
          output.description = "Hooked tool";
          output.parameters = { type: "object", properties: { q: { type: "string" } } };
        }
      },
    });

    const tools = await applyToolDefinitionHook({
      tools: {
        dummy: {
          description: "Original",
          inputSchema: { type: "object", properties: {} },
          execute: async () => ({}),
        },
      },
    });

    const dummy = tools["dummy"] as { description: string; inputSchema: unknown };
    expect(dummy.description).toBe("Hooked tool");
    expect(dummy.inputSchema).toEqual({
      type: "object",
      properties: { q: { type: "string" } },
    });
    clearCorePluginHooks();
  });
});
