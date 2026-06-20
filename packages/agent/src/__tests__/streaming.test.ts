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

async function drainGenerator(gen: AsyncGenerator<any, any>) {
  let result: IteratorResult<any, any> | undefined;
  while (true) {
    result = await gen.next();
    if (result.done) {
      return result.value;
    }
  }
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

describe("streaming: whole-message preservation (pi-ai source-of-truth)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("done handler preserves stopReason, api, provider, model from pi-ai message", async () => {
    const s = new MockEventStream();
    const now = Date.now();
    const fullMessage: any = {
      role: "assistant",
      content: [{ type: "text", text: "hello" }],
      usage: {
        input: 20,
        output: 10,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 30,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      api: "anthropic",
      provider: "anthropic",
      model: "claude-4-sonnet",
      responseModel: "claude-4-sonnet-20250514",
      responseId: "resp_abc",
      timestamp: now,
    };
    s.push({ type: "start", partial: fullMessage });
    s.push({ type: "text_start", contentIndex: 0, partial: {} as any });
    s.push({
      type: "text_delta",
      contentIndex: 0,
      delta: "hello",
      partial: {} as any,
    });
    s.push({
      type: "text_end",
      contentIndex: 0,
      content: "hello",
      partial: {} as any,
    });
    s.push({ type: "done", reason: "stop", message: fullMessage });

    vi.mocked(streamSimple).mockReturnValue(s);
    const gen = streamLLMResponse(
      nonReasoningModel,
      [],
      [],
      undefined,
      0,
      1000,
      "s1"
    );
    const result = await drainGenerator(gen);

    expect(result.ok).toBe(true);
    const msg = result.finalAssistant as any;
    expect(msg.stopReason).toBe("stop");
    expect(msg.api).toBe("anthropic");
    expect(msg.provider).toBe("anthropic");
    expect(msg.model).toBe("claude-4-sonnet");
    expect(msg.responseModel).toBe("claude-4-sonnet-20250514");
    expect(msg.responseId).toBe("resp_abc");
  });

  it("error handler preserves the full pi-ai error message verbatim (not null)", async () => {
    const s = new MockEventStream();
    const now = Date.now();
    const errorMessage: any = {
      role: "assistant",
      content: [{ type: "text", text: "billing exceeded" }],
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "error",
      errorMessage: "billing exceeded",
      api: "anthropic",
      provider: "anthropic",
      model: "claude-4-sonnet",
      timestamp: now,
    };
    s.push({ type: "error", reason: "error", error: errorMessage });

    vi.mocked(streamSimple).mockReturnValue(s);
    const gen = streamLLMResponse(
      nonReasoningModel,
      [],
      [],
      undefined,
      0,
      1000,
      "s1"
    );
    const result = await drainGenerator(gen);

    expect(result.ok).toBe(false);
    const msg = result.finalAssistant as any;
    expect(msg).not.toBeNull();
    expect(msg.stopReason).toBe("error");
    expect(msg.errorMessage).toBe("billing exceeded");
    expect(msg.api).toBe("anthropic");
  });
});
