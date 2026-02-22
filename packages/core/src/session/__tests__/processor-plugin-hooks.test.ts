import { Instance } from "@/instance";
import { clearCorePluginHooks, setCorePluginHooks } from "@/plugin/hooks";
import { AgentProcessor } from "@/session/processor";
import { beforeEach, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => ({
  captured: {
    providerRuntimeHeaders: {} as Record<string, string>,
  },
  streamTextMock: vi.fn(),
}));

vi.mock("ai", () => ({
  streamText: testState.streamTextMock,
  tool: vi.fn(definition => definition),
}));

vi.mock("@/agent/workflow/model-provider", () => ({
  getBuildModel: vi.fn(() => ({ id: "build-model" })),
  getExploreModel: vi.fn(() => ({ id: "explore-model" })),
  getPlanModel: vi.fn(() => ({ id: "plan-model" })),
  getModelByReference: vi.fn(() => {
    testState.captured.providerRuntimeHeaders = Instance.context.providerRuntime?.headers ?? {};
    return { id: "ref-model" };
  }),
}));

function createStream() {
  return {
    fullStream: (async function* () {
      yield { type: "text-delta", text: "ok" };
      yield { type: "finish", finishReason: "stop" };
    })(),
    response: Promise.resolve({
      messages: [{ role: "assistant", content: "ok" }],
    }),
  };
}

describe("session/processor plugin hooks", () => {
  beforeEach(() => {
    clearCorePluginHooks();
    testState.captured.providerRuntimeHeaders = {};
    testState.streamTextMock.mockReset();
    testState.streamTextMock.mockImplementation(() => createStream());
  });

  it("applies chat params, chat headers, and tool definition hooks", async () => {
    setCorePluginHooks({
      "chat.params": async (_input, output) => {
        output.temperature = 0.11;
        output.topP = 0.92;
        output.options.maxRetries = 2;
      },
      "chat.headers": async (_input, output) => {
        output.headers["x-plugin"] = "enabled";
      },
      "tool.definition": async ({ toolID }, output) => {
        if (toolID === "dummy") {
          output.description = "Hooked dummy tool";
          output.parameters = { type: "object", properties: { prompt: { type: "string" } } };
        }
      },
    });

    const processor = new AgentProcessor(
      {
        id: "agent-build",
        type: "build",
        model: "openai/gpt-4o-mini",
        systemPrompt: "test",
        tools: {
          dummy: {
            description: "Original dummy tool",
            inputSchema: { type: "object", properties: {} },
            execute: async () => ({ ok: true }),
          },
        },
        maxIterations: 1,
      },
      () => {}
    );

    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        Instance.context.providerRuntime = {
          providerId: "openai",
          modelId: "openai/gpt-4o-mini",
        };
        await processor.run({ task: "hello" });
      },
    });

    expect(testState.streamTextMock).toHaveBeenCalledTimes(1);
    const input = testState.streamTextMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(input.temperature).toBe(0.11);
    expect(input.topP).toBe(0.92);
    expect(input.maxRetries).toBe(2);

    const tools = input.tools as Record<string, Record<string, unknown>>;
    expect(tools.dummy?.description).toBe("Hooked dummy tool");
    expect(tools.dummy?.inputSchema).toEqual({
      type: "object",
      properties: { prompt: { type: "string" } },
    });

    expect(testState.captured.providerRuntimeHeaders).toEqual({
      "x-plugin": "enabled",
    });
  });
});
