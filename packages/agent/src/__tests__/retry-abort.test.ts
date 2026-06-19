import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { AgentEvent, AgentMessage, SessionStore } from "../types";

vi.mock("@earendil-works/pi-ai", async () => {
  const actual = await vi.importActual("@earendil-works/pi-ai");
  return { ...actual, streamSimple: vi.fn() as any };
});

const { streamSimple: _streamSimple } = await import("@earendil-works/pi-ai");
const streamSimple = _streamSimple as any;
const { createAgentLoop } = await import("../loop");

class MockEventStream<T> implements AsyncIterable<T> {
  private events: T[] = [];
  private _result?: any;
  push(event: T) { this.events.push(event); }
  setResult(r: any) { this._result = r; }
  result() { return this._result; }
  end() { /* no-op for mock */ }
  async *[Symbol.asyncIterator]() {
    for (const e of this.events) yield e;
  }
}

function createMockStore(): SessionStore {
  const messages: Map<string, AgentMessage[]> = new Map();
  return {
    loadMessages: vi.fn(async (id) => messages.get(id) ?? []),
    appendMessage: vi.fn(async (id, msg) => {
      const list = messages.get(id) ?? [];
      list.push(msg);
      messages.set(id, list);
    }),
    replaceMessages: vi.fn(async (id, msgs) => { messages.set(id, [...msgs]); }),
  };
}

const testModel = {
  id: "test", name: "Test", api: "openai-completions" as const, provider: "openai",
  baseUrl: "", reasoning: false, input: ["text"] as ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 200000, maxTokens: 4096,
};

const basePartial: any = {
  role: "assistant", content: [],
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  api: "openai-completions", provider: "openai", model: "test",
};

function textStream(text: string) {
  const s = new MockEventStream();
  const now = Date.now();
  s.push({ type: "start", partial: { ...basePartial, stopReason: "stop", timestamp: now } });
  s.push({ type: "text_start", contentIndex: 0, partial: {} as any });
  s.push({ type: "text_delta", contentIndex: 0, delta: text, partial: {} as any });
  s.push({ type: "text_end", contentIndex: 0, content: text, partial: {} as any });
  s.push({ type: "done", reason: "stop", message: { ...basePartial, content: [{ type: "text", text }], stopReason: "stop", timestamp: now } });
  return s;
}

describe("Agent retry", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("429 error → retries → second attempt succeeds → yields retry event", async () => {
    const store = createMockStore();
    let callCount = 0;
    vi.mocked(streamSimple).mockImplementation(() => {
      callCount++;
      if (callCount === 1) throw Object.assign(new Error("429 Rate limited"), { statusCode: 429 });
      return textStream("OK after retry");
    });

    const loop = createAgentLoop({ sessionId: "s1", model: testModel, tools: [], store });
    const events: AgentEvent[] = [];
    const promise = (async () => { for await (const e of loop.prompt("hi")) events.push(e); })();

    await vi.advanceTimersByTimeAsync(5000);
    await promise;

    expect(events.some((e) => e.type === "retry")).toBe(true);
    expect(events.some((e) => e.type === "agent_end")).toBe(true);
    expect(callCount).toBe(2);
  });

  it("max retries exceeded → yields error event and stops", async () => {
    const store = createMockStore();
    vi.mocked(streamSimple).mockImplementation(() => {
      throw Object.assign(new Error("503 Service Unavailable"), { statusCode: 503 });
    });

    const loop = createAgentLoop({ sessionId: "s1", model: testModel, tools: [], store, maxRetries: 2 });
    const events: AgentEvent[] = [];
    const promise = (async () => { for await (const e of loop.prompt("hi")) events.push(e); })();

    await vi.advanceTimersByTimeAsync(30000);
    await promise;

    expect(events.filter((e) => e.type === "retry").length).toBe(2);
    expect(events.some((e) => e.type === "error")).toBe(true);
  });
});

describe("Agent abort", () => {
  it("abort during LLM streaming → agent stops and yields agent_end", async () => {
    const store = createMockStore();
    const stream = new MockEventStream();
    const now = Date.now();
    stream.push({ type: "start", partial: { ...basePartial, stopReason: "stop", timestamp: now } });

    vi.mocked(streamSimple).mockReturnValue(stream);

    const loop = createAgentLoop({ sessionId: "s1", model: testModel, tools: [], store });
    const ac = new AbortController();

    const events: AgentEvent[] = [];
    const promise = (async () => { for await (const e of loop.prompt("hi", ac.signal)) events.push(e); })();

    ac.abort();
    stream.push({ type: "error", reason: "aborted" as any, error: { ...basePartial, stopReason: "aborted", errorMessage: "aborted", timestamp: now } });
    stream.end();

    await promise;
    expect(events.some((e) => e.type === "agent_end")).toBe(true);
  });
});
