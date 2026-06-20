/**
 * Memory benchmark for the agent loop.
 *
 * Measures real heap cost (deltas cancel fixed vitest overhead):
 *   1. One prompt, cold store (empty history)
 *   2. One prompt with a large pre-seeded history (100 messages)
 *   3. Two concurrent prompts on different sessions
 *   4. Retention: does history stay pinned after the prompt ends?
 *      (Pi pins it in a Map for process lifetime; ours should release it.)
 *
 * Run with GC exposed for accurate "retained" numbers:
 *   bun vitest run packages/agent/src/__tests__/mem-bench.test.ts --expose-gc
 * (without --expose-gc, test 4 shows transient+retained; still directional.)
 */
import { describe, expect, it, vi } from "vitest";
import type { AgentMessage, SessionStore } from "../types";
import { MockEventStream } from "./helpers";

// Mock streamSimple before importing the loop — same pattern as loop.test.ts.
vi.mock("@earendil-works/pi-ai", async () => {
  const actual = await vi.importActual("@earendil-works/pi-ai");
  return { ...actual, streamSimple: vi.fn() as unknown };
});

const { streamSimple: _streamSimple } = await import("@earendil-works/pi-ai");
const streamSimple = _streamSimple as ReturnType<typeof vi.fn>;
const { createAgentLoop } = await import("../loop");

// ── Mock stream (no network) ──

function textStream(text: string) {
  const s = new MockEventStream();
  const now = Date.now();
  const usage = {
    input: 10,
    output: text.length,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 10 + text.length,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
  s.push({
    type: "done",
    message: {
      role: "assistant",
      content: [{ type: "text", text }],
      usage,
      stopReason: "stop",
      api: "openai-completions",
      provider: "openai",
      model: "test",
      timestamp: now,
    },
  });
  return s;
}

const model = {
  id: "test-model",
  name: "Test",
  api: "openai-completions" as const,
  provider: "openai",
  baseUrl: "https://api.openai.com",
  reasoning: false,
  input: ["text"] as ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 200_000,
  maxTokens: 4096,
};

// ── In-memory store (mirrors SqliteSessionStore's no-cache shape) ──

function createStore(): SessionStore {
  const messages = new Map<string, AgentMessage[]>();
  return {
    loadMessages: async (id) => messages.get(id) ?? [],
    appendMessage: async (id, msg) => {
      const list = messages.get(id) ?? [];
      list.push(msg);
      messages.set(id, list);
    },
    replaceMessages: async (id, msgs) => {
      messages.set(id, [...msgs]);
    },
  };
}

function seedHistory(n: number): AgentMessage[] {
  const out: AgentMessage[] = [];
  const filler = "x".repeat(1024);
  for (let i = 0; i < n; i++) {
    if (i % 2 === 0) {
      out.push({ role: "user", content: `user ${i}: ${filler}`, timestamp: i });
    } else {
      out.push({
        role: "assistant",
        content: [{ type: "text", text: `assistant ${i}: ${filler}` }],
        usage: {
          input: 10,
          output: 1024,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 1034,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        timestamp: i,
      });
    }
  }
  return out;
}

// ── Helpers ──

const kb = (bytes: number) => `${Math.round(bytes / 1024)} KB`;

function snapshot(label: string) {
  if (globalThis.gc) {
    globalThis.gc();
  }
  const u = process.memoryUsage();
  console.log(`  ${label.padEnd(48)} heap=${kb(u.heapUsed)} rss=${kb(u.rss)}`);
  return u;
}

async function drain(gen: AsyncIterable<unknown>) {
  for await (const _ of gen) {
  }
}

// Skipped by default — this is a measurement tool, not an assertion.
// Run on demand when you want memory numbers (e.g. after adding custom tools):
//   bun mem
// (sets RUN_MEM_BENCH=1, which enables the suite below)
const describeMem =
  process.env.RUN_MEM_BENCH === "1" ? describe : describe.skip;
describeMem("agent loop memory profile", () => {
  it("[1] one prompt, empty history", async () => {
    const store = createStore();
    const loop = createAgentLoop({ sessionId: "s1", model, tools: [], store });
    streamSimple.mockImplementation(() => textStream("ok"));
    const before = process.memoryUsage();
    await drain(loop.prompt("hello"));
    const after = snapshot("[1] one prompt, empty history");
    console.log(`      delta heap: ${kb(after.heapUsed - before.heapUsed)}\n`);
    expect(true).toBe(true);
  });

  it("[2] one prompt, 100-msg history (~100KB seeded)", async () => {
    const store = createStore();
    await store.replaceMessages("s2", seedHistory(100));
    const loop = createAgentLoop({ sessionId: "s2", model, tools: [], store });
    streamSimple.mockImplementation(() => textStream("ok"));
    const before = process.memoryUsage();
    await drain(loop.prompt("next"));
    const after = snapshot("[2] one prompt, 100-msg history");
    console.log(`      delta heap: ${kb(after.heapUsed - before.heapUsed)}\n`);
    expect(true).toBe(true);
  });

  it("[2b] one prompt, 1000-msg history (~1MB seeded) — scaling check", async () => {
    const store = createStore();
    await store.replaceMessages("s2b", seedHistory(1000));
    const loop = createAgentLoop({ sessionId: "s2b", model, tools: [], store });
    streamSimple.mockImplementation(() => textStream("ok"));
    const before = process.memoryUsage();
    await drain(loop.prompt("next"));
    const after = snapshot("[2b] one prompt, 1000-msg history");
    console.log(
      `      delta heap: ${kb(after.heapUsed - before.heapUsed)} (vs [2]'s 100-msg)\n`
    );
    expect(true).toBe(true);
  });

  it("[3] two concurrent prompts (different sessions)", async () => {
    const loopA = createAgentLoop({
      sessionId: "a",
      model,
      tools: [],
      store: createStore(),
    });
    const loopB = createAgentLoop({
      sessionId: "b",
      model,
      tools: [],
      store: createStore(),
    });
    streamSimple.mockImplementation(() => textStream("ok"));
    const before = process.memoryUsage();
    await Promise.all([drain(loopA.prompt("a")), drain(loopB.prompt("b"))]);
    const after = snapshot("[3] two concurrent prompts");
    console.log(`      delta heap: ${kb(after.heapUsed - before.heapUsed)}\n`);
    expect(true).toBe(true);
  });

  it("[4] retention — history released after prompt ends?", async () => {
    const store = createStore();
    await store.replaceMessages("s4", seedHistory(200)); // ~200KB
    const loop = createAgentLoop({ sessionId: "s4", model, tools: [], store });
    streamSimple.mockImplementation(() => textStream("ok"));
    const before = snapshot("[4] before prompt (200-msg seeded)");
    await drain(loop.prompt("go"));
    const after = snapshot("[4] after prompt ends");
    const retained = after.heapUsed - before.heapUsed;
    console.log(
      `      retained delta: ${kb(retained)} (lower = more released; with --expose-gc this is the real footprint)\n`
    );
    expect(true).toBe(true);
  });
});
