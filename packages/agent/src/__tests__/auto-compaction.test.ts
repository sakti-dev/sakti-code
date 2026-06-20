import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentEvent, AgentMessage, SessionStore } from "../types";
import { collectEvents, MockEventStream } from "./helpers";

// Both the main loop stream and the summarization call come from pi-ai.
vi.mock("@earendil-works/pi-ai", () => ({
  streamSimple: vi.fn(),
  completeSimple: vi.fn(),
}));

const { streamSimple, completeSimple } = await import("@earendil-works/pi-ai");
const streamSimpleMock = streamSimple as ReturnType<typeof vi.fn>;
const completeSimpleMock = completeSimple as ReturnType<typeof vi.fn>;
const { createAgentLoop } = await import("../loop");

// ── Minimal async-iterable stream fixture ──

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

function textStream(text: string) {
  const s = new MockEventStream<any>();
  const now = Date.now();
  s.push({
    type: "start",
    partial: { ...basePartial, stopReason: "stop", timestamp: now },
  });
  s.push({ type: "text_start", contentIndex: 0, partial: {} });
  s.push({ type: "text_delta", contentIndex: 0, delta: text, partial: {} });
  s.push({ type: "text_end", contentIndex: 0, content: text, partial: {} });
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

// ── Test fixtures ──

// Tiny context window so the threshold trips on a small preloaded context.
const testModel = {
  id: "test",
  name: "Test",
  api: "openai-completions" as const,
  provider: "openai",
  baseUrl: "",
  reasoning: false,
  input: ["text"] as ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 1000,
  maxTokens: 4096,
};

// Summary returned by the mocked summarization call.
const SUMMARY_RESPONSE = {
  stopReason: "stop",
  content: [{ type: "text", text: "## Goal\nfix bug\n\n## Progress\n- done" }],
  usage: {
    input: 5,
    output: 5,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 10,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
  timestamp: Date.now(),
};

function createStore(preloaded: AgentMessage[] = []): SessionStore {
  const messages = new Map<string, AgentMessage[]>([["s1", [...preloaded]]]);
  return {
    loadMessages: vi.fn(async (id: string) => messages.get(id) ?? []),
    appendMessage: vi.fn(async (id: string, msg: AgentMessage) => {
      const list = messages.get(id) ?? [];
      list.push(msg);
      messages.set(id, list);
    }),
    replaceMessages: vi.fn(async (id: string, msgs: AgentMessage[]) => {
      messages.set(id, [...msgs]);
    }),
  };
}

/** A preloaded history ending in an assistant message carrying a large real
 *  usage.totalTokens (the proven pi pattern: the threshold keys off this). */
function largeHistory(): AgentMessage[] {
  const big = (n: number): AgentMessage => ({
    role: "user",
    content: `message ${n}: ${"x".repeat(400)}`,
    timestamp: n,
  });
  return [
    big(1),
    big(2),
    big(3),
    big(4),
    big(5),
    {
      role: "assistant",
      content: [{ type: "text", text: "ok" }],
      timestamp: 6,
      usage: {
        // Real provider-reported prompt size — well above contextWindow - reserve.
        input: 850,
        output: 50,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 900,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
    },
  ];
}

describe("auto-compaction in the agent loop", () => {
  // Reset the shared module-level mocks between tests so call-count
  // assertions reflect only the current test (prevents order-dependent,
  // accidentally-green tests).
  beforeEach(() => {
    streamSimpleMock.mockClear();
    completeSimpleMock.mockClear();
  });

  it("triggers when context exceeds the window, replaces messages, emits events (2.1)", async () => {
    const store = createStore(largeHistory());
    streamSimpleMock.mockImplementation(() => textStream("done!"));
    completeSimpleMock.mockResolvedValue(SUMMARY_RESPONSE);

    const loop = createAgentLoop({
      sessionId: "s1",
      model: testModel,
      tools: [],
      store,
      autoCompaction: true,
      apiKey: "test-key",
      reserveTokens: 200,
      keepRecentTokens: 50,
    });
    const events = await collectEvents(loop.prompt("continue"));

    const types = events.map((e) => e.type);
    const startIdx = types.indexOf("compaction_start");
    const endIdx = types.indexOf("compaction_end");
    const turnStartIdx = types.indexOf("turn_start");

    expect(startIdx).toBeGreaterThanOrEqual(0);
    expect(endIdx).toBeGreaterThan(startIdx);
    // Compaction runs at the top of the turn, before turn_start.
    expect(turnStartIdx).toBeGreaterThan(endIdx);

    // The compacted message list was persisted.
    expect(store.replaceMessages).toHaveBeenCalledTimes(1);

    const endEvent = events[endIdx] as Extract<
      AgentEvent,
      { type: "compaction_end" }
    >;
    expect(endEvent.tokensBefore).toBeGreaterThan(endEvent.tokensAfter);
  });

  it("does NOT trigger when autoCompaction is on but context is within budget (scenario 2)", async () => {
    // autoCompaction is ENABLED and a key is present, but the context is tiny —
    // shouldCompact returns false, so no compaction runs. This is the positive
    // gate path (distinct from 'autoCompaction omitted'): a bug that always
    // fired compaction when enabled would pass the default-off test but fail here.
    const store = createStore([{ role: "user", content: "hi", timestamp: 1 }]);
    streamSimpleMock.mockImplementation(() => textStream("done!"));
    completeSimpleMock.mockResolvedValue(SUMMARY_RESPONSE);

    const loop = createAgentLoop({
      sessionId: "s1",
      model: testModel,
      tools: [],
      store,
      autoCompaction: true,
      apiKey: "test-key",
      reserveTokens: 200,
      keepRecentTokens: 50,
    });
    const events = await collectEvents(loop.prompt("continue"));

    expect(events.some((e) => e.type === "compaction_start")).toBe(false);
    expect(events.some((e) => e.type === "compaction_end")).toBe(false);
    expect(completeSimpleMock).not.toHaveBeenCalled();
    expect(store.replaceMessages).not.toHaveBeenCalled();
    // The loop still runs a normal turn.
    expect(events.some((e) => e.type === "turn_start")).toBe(true);
  });

  it("does NOT trigger when autoCompaction is omitted (default off) (2.2)", async () => {
    const store = createStore(largeHistory());
    streamSimpleMock.mockImplementation(() => textStream("done!"));
    completeSimpleMock.mockResolvedValue(SUMMARY_RESPONSE);

    const loop = createAgentLoop({
      sessionId: "s1",
      model: testModel,
      tools: [],
      store,
      // autoCompaction intentionally omitted
      apiKey: "test-key",
      reserveTokens: 200,
      keepRecentTokens: 50,
    });
    const events = await collectEvents(loop.prompt("continue"));

    expect(events.some((e) => e.type === "compaction_start")).toBe(false);
    expect(events.some((e) => e.type === "compaction_end")).toBe(false);
    expect(store.replaceMessages).not.toHaveBeenCalled();
  });

  it("skips gracefully (no events, no throw) when apiKey is absent (2.3)", async () => {
    const store = createStore(largeHistory());
    streamSimpleMock.mockImplementation(() => textStream("done!"));
    completeSimpleMock.mockResolvedValue(SUMMARY_RESPONSE);

    const loop = createAgentLoop({
      sessionId: "s1",
      model: testModel,
      tools: [],
      store,
      autoCompaction: true,
      // apiKey intentionally omitted
      reserveTokens: 200,
      keepRecentTokens: 50,
    });

    // Must not throw.
    const events = await collectEvents(loop.prompt("continue"));

    expect(events.some((e) => e.type === "compaction_start")).toBe(false);
    expect(events.some((e) => e.type === "compaction_end")).toBe(false);
    expect(store.replaceMessages).not.toHaveBeenCalled();
    // The loop still completes normally.
    expect(events.some((e) => e.type === "agent_end")).toBe(true);
  });

  it("summarization failure keeps messages unchanged, no error event (2.4)", async () => {
    const store = createStore(largeHistory());
    streamSimpleMock.mockImplementation(() => textStream("done!"));
    // Summarization call fails.
    completeSimpleMock.mockResolvedValue({
      ...SUMMARY_RESPONSE,
      stopReason: "error",
    });

    const loop = createAgentLoop({
      sessionId: "s1",
      model: testModel,
      tools: [],
      store,
      autoCompaction: true,
      apiKey: "test-key",
      reserveTokens: 200,
      keepRecentTokens: 50,
    });
    const events = await collectEvents(loop.prompt("continue"));

    // Loop continues and ends normally.
    expect(events.some((e) => e.type === "agent_end")).toBe(true);
    // No error event for the summarization failure.
    expect(events.some((e) => e.type === "error")).toBe(false);
    // Messages were NOT replaced (compactMessages returned them unchanged).
    expect(store.replaceMessages).not.toHaveBeenCalled();
  });
});
