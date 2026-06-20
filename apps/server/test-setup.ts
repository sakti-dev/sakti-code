// Global test setup — preloaded before any test file runs.
// Provides a base mock for @earendil-works/pi-ai so that all route tests
// share a consistent mock without module-cache race conditions.
// Individual tests override specific functions via mockImplementation.

import { mock } from "bun:test";

mock.module("@earendil-works/pi-ai", () => ({
  // env-api-keys
  getEnvApiKey: mock(() => "test-key"),

  // models
  getModel: mock(() => ({
    id: "test-model",
    name: "Test",
    api: "openai-completions",
    provider: "openai",
    input: ["text"],
    contextWindow: 200_000,
    maxTokens: 4096,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    reasoning: false,
    baseUrl: "",
  })),
  getModels: mock((_provider: string) => []),
  getProviders: mock(() => []),

  // stream
  completeSimple: mock(async () => ({
    stopReason: "stop",
    content: [{ type: "text", text: "Mock summary" }],
    usage: {
      input: 100,
      output: 50,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 150,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    timestamp: Date.now(),
  })),
  streamSimple: mock(() => {
    throw new Error(
      "streamSimple not mocked — override with mockImplementation"
    );
  }),
  complete: mock(() => {
    throw new Error("complete not mocked — override with mockImplementation");
  }),
  stream: mock(() => {
    throw new Error("stream not mocked — override with mockImplementation");
  }),

  // catch-all for any other pi-ai exports
}));
