import type { Model, StreamRequest } from "@sakti-code/llm";
import { describe, expect, it } from "vitest";
import { buildHarnessStreamRequest } from "../build-stream-request.ts";

const model: Model = {
  api: "ai-sdk",
  baseUrl: "https://example.com",
  contextWindow: 200_000,
  cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
  id: "test-model",
  input: ["text"],
  maxTokens: 8192,
  name: "Test",
  provider: "testprov",
  reasoning: false,
};

function loopRequest(over: Partial<StreamRequest> = {}): StreamRequest {
  return {
    model,
    messages: [],
    maxOutputTokens: 8192,
    ...over,
  } as StreamRequest;
}

describe("buildHarnessStreamRequest", () => {
  it("injects the harness sessionId (not the loop's)", () => {
    const req = buildHarnessStreamRequest(loopRequest(), {
      sessionId: "sess-harness",
    });
    expect(req.sessionId).toBe("sess-harness");
  });

  it("forwards maxOutputTokens from the loop request (regression: was dropped)", () => {
    const req = buildHarnessStreamRequest(
      loopRequest({ maxOutputTokens: 4096 }),
      {
        sessionId: "s",
      }
    );
    expect(req.maxOutputTokens).toBe(4096);
  });

  it("forwards toolChoice from the loop request (regression: was dropped)", () => {
    const req = buildHarnessStreamRequest(loopRequest({ toolChoice: "none" }), {
      sessionId: "s",
    });
    expect(req.toolChoice).toBe("none");
  });

  it("forwards temperature and topP when set", () => {
    const req = buildHarnessStreamRequest(
      loopRequest({ temperature: 0.7, topP: 0.9 }),
      { sessionId: "s" }
    );
    expect(req.temperature).toBe(0.7);
    expect(req.topP).toBe(0.9);
  });

  it("resolves apiKey from opts (auth wins over loop request)", () => {
    const req = buildHarnessStreamRequest(loopRequest({ apiKey: "loop-key" }), {
      sessionId: "s",
      apiKey: "auth-key",
    });
    expect(req.apiKey).toBe("auth-key");
  });

  it("falls back to loop request apiKey when opts has none", () => {
    const req = buildHarnessStreamRequest(loopRequest({ apiKey: "loop-key" }), {
      sessionId: "s",
    });
    expect(req.apiKey).toBe("loop-key");
  });

  it("uses resolved headers from opts (hook-merged)", () => {
    const headers = { "x-session": "s", "x-auth": "1" };
    const req = buildHarnessStreamRequest(loopRequest(), {
      sessionId: "s",
      headers,
    });
    expect(req.headers).toEqual(headers);
  });

  it("forwards system, tools, thinkingLevel, abortSignal, baseURL", () => {
    const controller = new AbortController();
    const req = buildHarnessStreamRequest(
      loopRequest({
        baseURL: "https://override.example.com",
        system: "be brief",
        thinkingLevel: "high",
        tools: { search: { description: "d", parameters: {} } },
        abortSignal: controller.signal,
      }),
      { sessionId: "s" }
    );
    expect(req.baseURL).toBe("https://override.example.com");
    expect(req.system).toBe("be brief");
    expect(req.thinkingLevel).toBe("high");
    expect(req.tools).toBeDefined();
    expect(req.abortSignal).toBe(controller.signal);
  });

  it("does not drop maxOutputTokens even when set to a falsy-but-valid value", () => {
    const req = buildHarnessStreamRequest(loopRequest({ maxOutputTokens: 0 }), {
      sessionId: "s",
    });
    expect(req.maxOutputTokens).toBeUndefined();
  });
});
