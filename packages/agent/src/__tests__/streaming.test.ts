import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@earendil-works/pi-ai", () => ({
  streamSimple: vi.fn(),
  completeSimple: vi.fn(),
}));

const { streamSimple: _streamSimple } = await import("@earendil-works/pi-ai");
const streamSimple = _streamSimple as any;
const { streamLLMResponse } = await import("../loop/streaming");

class MockEventStream<T> implements AsyncIterable<T> {
  private readonly events: T[] = [];
  push(event: T) {
    this.events.push(event);
  }
  async *[Symbol.asyncIterator]() {
    for (const e of this.events) {
      yield e;
    }
  }
}

const reasoningModel = {
  id: "o3",
  name: "o3",
  api: "openai-completions" as const,
  provider: "openai",
  baseUrl: "",
  reasoning: true,
  input: ["text"] as ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 200_000,
  maxTokens: 4096,
};

const nonReasoningModel = {
  id: "gpt-4o",
  name: "gpt-4o",
  api: "openai-completions" as const,
  provider: "openai",
  baseUrl: "",
  reasoning: false,
  input: ["text"] as ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 200_000,
  maxTokens: 4096,
};

function textStream(text: string) {
  const s = new MockEventStream();
  const now = Date.now();
  const basePartial: any = {
    role: "assistant",
    content: [],
    usage: {
      input: 10,
      output: 5,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 15,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    api: "openai-completions",
    provider: "openai",
    model: "test",
  };
  s.push({
    type: "start",
    partial: { ...basePartial, stopReason: "stop", timestamp: now },
  });
  s.push({ type: "text_start", contentIndex: 0, partial: {} as any });
  s.push({
    type: "text_delta",
    contentIndex: 0,
    delta: text,
    partial: {} as any,
  });
  s.push({
    type: "text_end",
    contentIndex: 0,
    content: text,
    partial: {} as any,
  });
  s.push({
    type: "done",
    reason: "stop",
    message: {
      ...basePartial,
      content: [{ type: "text", text }],
      stopReason: "stop",
      timestamp: now,
    },
  });
  return s;
}

async function collectEvents(gen: AsyncIterable<any>) {
  const events: any[] = [];
  for await (const e of gen) {
    events.push(e);
  }
  return events;
}

describe("streaming: reasoning option", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  it("passes reasoning:'high' to streamSimple for a reasoning-capable model with thinkingLevel:'high'", async () => {
    vi.mocked(streamSimple).mockReturnValue(textStream("ok"));

    const gen = streamLLMResponse(
      reasoningModel,
      [],
      [],
      undefined,
      0,
      1000,
      "s1",
      "high"
    );
    await collectEvents(gen);

    expect(streamSimple).toHaveBeenCalledOnce();
    const opts = streamSimple.mock.calls[0][2]; // third arg = stream options
    expect(opts.reasoning).toBe("high");
    expect(opts.thinkingLevel).toBeUndefined();
  });

  it("does NOT pass reasoning for a non-reasoning model even with thinkingLevel:'high'", async () => {
    vi.mocked(streamSimple).mockReturnValue(textStream("ok"));

    const gen = streamLLMResponse(
      nonReasoningModel,
      [],
      [],
      undefined,
      0,
      1000,
      "s1",
      "high"
    );
    await collectEvents(gen);

    expect(streamSimple).toHaveBeenCalledOnce();
    const opts = streamSimple.mock.calls[0][2];
    expect(opts.reasoning).toBeUndefined();
    expect(opts.thinkingLevel).toBeUndefined();
  });

  it("does NOT pass reasoning when thinkingLevel is 'off'", async () => {
    vi.mocked(streamSimple).mockReturnValue(textStream("ok"));

    const gen = streamLLMResponse(
      reasoningModel,
      [],
      [],
      undefined,
      0,
      1000,
      "s1",
      "off"
    );
    await collectEvents(gen);

    expect(streamSimple).toHaveBeenCalledOnce();
    const opts = streamSimple.mock.calls[0][2];
    expect(opts.reasoning).toBeUndefined();
  });

  it("does NOT pass reasoning when thinkingLevel is undefined", async () => {
    vi.mocked(streamSimple).mockReturnValue(textStream("ok"));

    const gen = streamLLMResponse(
      reasoningModel,
      [],
      [],
      undefined,
      0,
      1000,
      "s1",
      undefined
    );
    await collectEvents(gen);

    expect(streamSimple).toHaveBeenCalledOnce();
    const opts = streamSimple.mock.calls[0][2];
    expect(opts.reasoning).toBeUndefined();
  });
});
