import { describe, expect, it, mock, vi } from "bun:test";

const streamSimpleMock = vi.fn();
const getModelMock = vi.fn(() => ({
  id: "test-model",
  name: "Test",
  api: "openai-completions",
  provider: "openai",
  baseUrl: "https://api.openai.com",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 200_000,
  maxTokens: 4096,
}));

mock.module("@earendil-works/pi-ai/base", () => ({
  getModel: getModelMock,
}));

mock.module("@earendil-works/pi-ai", () => ({
  streamSimple: streamSimpleMock,
  getModel: getModelMock,
  getEnvApiKey: vi.fn(() => "test-key"),
}));

import { createMockStore, createMultiSessionCtx } from "./helpers.ts";

import "@earendil-works/pi-ai";
import "@earendil-works/pi-ai/base";

const { handleMessage } = await import("../ws-handler.ts");

describe("Multi-session e2e", () => {
  it("two concurrent sessions produce frames with correct sessionId and no cross-contamination", async () => {
    const ctx = createMultiSessionCtx({
      "sess-a": "proj-1",
      "sess-b": "proj-2",
    });
    const storeA = createMockStore();
    const storeB = createMockStore();

    getModelMock.mockReturnValue({
      id: "test-model",
      name: "Test",
      api: "openai-completions",
      provider: "openai",
      baseUrl: "https://api.openai.com",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 200_000,
      maxTokens: 4096,
    });
    streamSimpleMock.mockImplementation(() => {
      const stream: AsyncIterable<any> = (async function* () {
        yield {
          type: "start",
          partial: {
            role: "assistant",
            content: [],
            usage: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 0,
              cost: {
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
                total: 0,
              },
            },
            stopReason: "stop",
            api: "openai-completions",
            provider: "openai",
            model: "test",
            timestamp: Date.now(),
          },
        };
        yield { type: "text_start", contentIndex: 0, partial: {} };
        yield {
          type: "text_delta",
          contentIndex: 0,
          delta: "response",
          partial: {},
        };
        yield {
          type: "text_end",
          contentIndex: 0,
          content: "response",
          partial: {},
        };
        yield {
          type: "done",
          reason: "stop",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "response" }],
            usage: {
              input: 10,
              output: 8,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 18,
              cost: {
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
                total: 0,
              },
            },
            stopReason: "stop",
            api: "openai-completions",
            provider: "openai",
            model: "test",
            timestamp: Date.now(),
          },
        };
      })();
      return stream;
    });

    const framesA: any[] = [];
    const framesB: any[] = [];
    const wsA = { send: (d: string) => framesA.push(JSON.parse(d)) };
    const wsB = { send: (d: string) => framesB.push(JSON.parse(d)) };

    handleMessage(ctx, storeA, wsA, {
      type: "prompt",
      sessionId: "sess-a",
      message: "Hello from A",
    });
    handleMessage(ctx, storeB, wsB, {
      type: "prompt",
      sessionId: "sess-b",
      message: "Hello from B",
    });

    await new Promise((r) => setTimeout(r, 200));

    expect(framesA.every((f: any) => f.sessionId === "sess-a")).toBe(true);
    expect(framesB.every((f: any) => f.sessionId === "sess-b")).toBe(true);

    const framesBySessionA = framesA.filter(
      (f: any) => f.sessionId === "sess-a"
    );
    const framesBySessionB = framesB.filter(
      (f: any) => f.sessionId === "sess-b"
    );

    expect(framesBySessionA.length).toBeGreaterThan(0);
    expect(framesBySessionB.length).toBeGreaterThan(0);
  });
});
