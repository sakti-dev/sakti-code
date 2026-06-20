import { describe, expect, it, vi } from "vitest";
import type {
  AgentEvent,
  AgentMessage,
  AgentTool,
  SessionStore,
} from "../types";
import { collectEvents, MockEventStream } from "./helpers";

vi.mock("@earendil-works/pi-ai", () => ({
  streamSimple: vi.fn(),
}));

const { streamSimple: _streamSimple } = await import("@earendil-works/pi-ai");
const streamSimple = _streamSimple as ReturnType<typeof vi.fn>;
const { createAgentLoop } = await import("../loop");

// ── Store mock ──

function createMockStore(): SessionStore {
  const messages = new Map<string, AgentMessage[]>();
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

// ── Fixtures ──

const testModel = {
  id: "test",
  name: "Test",
  api: "openai-completions" as const,
  provider: "openai",
  baseUrl: "",
  reasoning: false,
  input: ["text"] as ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 200_000,
  maxTokens: 4096,
};

const basePartial = {
  role: "assistant",
  content: [],
  usage: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
  api: "openai-completions",
  provider: "openai",
  model: "test",
};

function textStream(text: string) {
  const s = new MockEventStream();
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

function toolCallStream(
  toolName: string,
  args: Record<string, unknown>,
  id = "tc_1"
) {
  const s = new MockEventStream();
  const now = Date.now();
  s.push({
    type: "start",
    partial: { ...basePartial, stopReason: "toolUse", timestamp: now },
  });
  s.push({ type: "toolcall_start", contentIndex: 0, partial: {} });
  s.push({
    type: "toolcall_delta",
    contentIndex: 0,
    delta: JSON.stringify(args),
    partial: {},
  });
  s.push({
    type: "toolcall_end",
    contentIndex: 0,
    toolCall: { type: "toolCall", id, name: toolName, arguments: args },
    partial: {},
  });
  s.push({
    type: "done",
    reason: "toolUse",
    message: {
      ...basePartial,
      stopReason: "toolUse",
      timestamp: now,
      content: [{ type: "toolCall", id, name: toolName, arguments: args }],
    },
  });
  return s;
}

// A stream that yields a partial text_delta then blocks until release() is called.
// After release it emits a normal "done" event (yielded as a regular event, then the
// iterator terminates) so consumeStream captures the final assistant message.
function blockingTextStream(onDone: () => void) {
  let released = false;
  let release: () => void = () => {};
  const ready = new Promise<void>((r) => {
    release = () => {
      released = true;
      r();
    };
  });
  const now = Date.now();
  const stream = {
    [Symbol.asyncIterator]() {
      const prefix = [
        {
          type: "start",
          partial: { ...basePartial, stopReason: "stop", timestamp: now },
        },
        {
          type: "text_delta",
          contentIndex: 0,
          delta: "partial output",
          partial: {},
        },
      ];
      const tail = {
        type: "done",
        reason: "stop",
        message: {
          ...basePartial,
          content: [{ type: "text", text: "partial output" }],
          stopReason: "stop",
          timestamp: now,
        },
      };
      let i = 0;
      let yieldedTail = false;
      return {
        async next() {
          if (i < prefix.length) {
            return { done: false, value: prefix[i++] };
          }
          if (!released) {
            await ready;
          }
          if (!yieldedTail) {
            yieldedTail = true;
            onDone();
            return { done: false, value: tail };
          }
          return { done: true, value: undefined };
        },
      };
    },
    release,
  };
  return stream;
}

async function collect(gen: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  return collectEvents(gen);
}

describe("steer signal wiring (C4)", () => {
  it("C4a: steer during LLM streaming does NOT abort the stream; the steer becomes a new user message", async () => {
    const store = createMockStore();
    let streamedMessage = "";
    const blocking = blockingTextStream(() => {
      streamedMessage = "completed";
    });
    streamSimple.mockImplementation(() => blocking);

    const loop = createAgentLoop({
      sessionId: "s1",
      model: testModel,
      tools: [],
      store,
    });

    const events: AgentEvent[] = [];
    const promise = (async () => {
      for await (const e of loop.prompt("hi")) {
        events.push(e);
      }
    })();

    // Wait until the stream is mid-flight (the text_delta has been consumed).
    await new Promise((r) => setTimeout(r, 30));
    loop.steer("change course"); // mid-stream steer
    await new Promise((r) => setTimeout(r, 10));
    // Stream must NOT have been aborted — it hasn't released yet.
    expect(streamedMessage).toBe("");

    blocking.release(); // let the stream complete naturally
    await promise;

    const types = events.map((e) => e.type);
    // The first turn must NOT have errored (no "Stream ended without assistant message").
    expect(types).not.toContain("error");
    expect(streamedMessage).toBe("completed");
    // The steer text is persisted as a user message.
    const msgs = await store.loadMessages("s1");
    expect(
      msgs.some((m) => m.role === "user" && m.content === "change course")
    ).toBe(true);
  });

  it("C4b: steer during tool execution ABORTS the running tool", async () => {
    const store = createMockStore();
    let aborted = false;
    let finished = false;
    const slowTool: AgentTool = {
      name: "slow",
      description: "d",
      parameters: { type: "object", properties: {} },
      execute: async (_id, _args, signal) => {
        await new Promise<void>((resolve) => {
          const t = setTimeout(() => {
            finished = true;
            resolve();
          }, 500);
          signal?.addEventListener("abort", () => {
            aborted = true;
            clearTimeout(t);
            resolve();
          });
        });
        return { content: finished ? "done" : "partial", terminate: false };
      },
    };

    let call = 0;
    streamSimple.mockImplementation(() => {
      call++;
      return call === 1 ? toolCallStream("slow", {}) : textStream("ok");
    });

    const loop = createAgentLoop({
      sessionId: "s1",
      model: testModel,
      tools: [slowTool],
      store,
    });
    const promise = (async () => {
      for await (const _e of loop.prompt("go")) {
        // consume
      }
    })();

    // Tool is now running.
    await new Promise((r) => setTimeout(r, 40));
    loop.steer("stop the tool");
    await promise;

    expect(aborted).toBe(true);
    expect(finished).toBe(false);
  });

  it("C4c: a steer-aborted tool's accumulated partial output is appended as the tool result", async () => {
    const store = createMockStore();
    const slowTool: AgentTool = {
      name: "streamy",
      description: "d",
      parameters: { type: "object", properties: {} },
      execute: async (_id, _args, signal, onUpdate) => {
        // Emit partial output, then block until aborted.
        onUpdate("partial-1 ");
        onUpdate("partial-2");
        await new Promise<void>((resolve) => {
          signal?.addEventListener("abort", () => resolve());
        });
        throw new Error("should not reach: aborted");
      },
    };

    let call = 0;
    streamSimple.mockImplementation(() => {
      call++;
      return call === 1 ? toolCallStream("streamy", {}) : textStream("ok");
    });

    const loop = createAgentLoop({
      sessionId: "s1",
      model: testModel,
      tools: [slowTool],
      store,
    });
    const promise = (async () => {
      for await (const _e of loop.prompt("go")) {
        // consume
      }
    })();
    await new Promise((r) => setTimeout(r, 40));
    loop.steer("stop");
    await promise;

    const toolMsgs = (await store.loadMessages("s1")).filter(
      (m) => m.role === "tool"
    );
    expect(toolMsgs.length).toBe(1);
    // The partial output accumulated before the abort is preserved.
    expect(toolMsgs[0].content[0].text).toBe("partial-1 partial-2");
  });
});

describe("steer queue, follow-up, and no-op contracts", () => {
  it("steer queue is bounded at 10; the 11th is dropped", async () => {
    const store = createMockStore();
    streamSimple.mockImplementation(() => textStream("ok"));

    const loop = createAgentLoop({
      sessionId: "s1",
      model: testModel,
      tools: [],
      store,
    });

    // Enqueue 11 steers while the prompt runs.
    const promise = (async () => {
      const out: AgentEvent[] = [];
      for await (const e of loop.prompt("hi")) {
        out.push(e);
      }
      return out;
    })();
    await new Promise((r) => setTimeout(r, 5));
    for (let i = 0; i < 11; i++) {
      loop.steer(`m${i}`);
    }
    await promise;

    const users = (await store.loadMessages("s1")).filter(
      (m) => m.role === "user"
    );
    const steerUsers = users.filter((m) => m.content !== "hi");
    // Queue cap is 10; only 10 steers can ever be injected.
    expect(steerUsers.length).toBeLessThanOrEqual(10);
  });

  it("followUp is processed after the current turn and keeps the loop alive", async () => {
    const store = createMockStore();
    let call = 0;
    const firstBlocked = blockingTextStream(() => {});
    streamSimple.mockImplementation(() => {
      call++;
      return call === 1 ? firstBlocked : textStream("second");
    });

    const loop = createAgentLoop({
      sessionId: "s1",
      model: testModel,
      tools: [],
      store,
    });
    const promise = (async () => {
      for await (const _e of loop.prompt("hi")) {
        // consume
      }
    })();
    // First turn is mid-stream (blocked) — enqueue the follow-up now.
    await new Promise((r) => setTimeout(r, 20));
    loop.followUp("again");
    firstBlocked.release();
    await promise;

    const users = (await store.loadMessages("s1"))
      .filter((m) => m.role === "user")
      .map((m) => m.content);
    expect(users).toContain("hi");
    expect(users).toContain("again");
    expect(call).toBe(2); // initial turn + one follow-up turn
  });

  it("S1: steer/followUp on a finished loop is a no-op (drops, does not throw)", async () => {
    const store = createMockStore();
    streamSimple.mockImplementation(() => textStream("done"));

    const loop = createAgentLoop({
      sessionId: "s1",
      model: testModel,
      tools: [],
      store,
    });
    await collect(loop.prompt("hi"));

    const before = (await store.loadMessages("s1")).length;
    expect(() => {
      loop.steer("late");
      loop.followUp("late2");
    }).not.toThrow();
    // Nothing new persisted after completion.
    expect((await store.loadMessages("s1")).length).toBe(before);
  });
});

describe("config overrides (S3)", () => {
  it("autoRetry: false disables the retry loop on a retryable error", async () => {
    const store = createMockStore();
    streamSimple.mockImplementation(() => {
      throw Object.assign(new Error("429 Rate limited"), { statusCode: 429 });
    });

    const loop = createAgentLoop({
      sessionId: "s1",
      model: testModel,
      tools: [],
      store,
      autoRetry: false,
    });
    const events = await collect(loop.prompt("hi"));

    expect(events.filter((e) => e.type === "retry")).toHaveLength(0);
    expect(events.some((e) => e.type === "error")).toBe(true);
  });

  it("steeringMode one-at-a-time drains at most one steer before the next turn", async () => {
    const store = createMockStore();
    const blocked = blockingTextStream(() => {});
    let call = 0;
    streamSimple.mockImplementation(() => {
      call++;
      return call === 1 ? blocked : textStream("ok");
    });

    const loop = createAgentLoop({
      sessionId: "s1",
      model: testModel,
      tools: [],
      store,
      steeringMode: "one-at-a-time",
    });
    const promise = (async () => {
      for await (const _e of loop.prompt("hi")) {
        // consume
      }
    })();
    await new Promise((r) => setTimeout(r, 15));
    loop.steer("first");
    loop.steer("second");
    blocked.release();
    await promise;

    const steers = (await store.loadMessages("s1"))
      .filter((m) => m.role === "user" && m.content !== "hi")
      .map((m) => m.content);
    // one-at-a-time: only the first steer is processed before the next turn starts.
    expect(steers[0]).toBe("first");
    expect(steers).toContain("second");
  });

  it("W2: followUpMode one-at-a-time processes exactly one follow-up then stops", async () => {
    const store = createMockStore();
    const blocked = blockingTextStream(() => {});
    let call = 0;
    streamSimple.mockImplementation(() => {
      call++;
      return call === 1 ? blocked : textStream("ok");
    });

    const loop = createAgentLoop({
      sessionId: "s1",
      model: testModel,
      tools: [],
      store,
      followUpMode: "one-at-a-time",
    });
    const promise = (async () => {
      for await (const _e of loop.prompt("hi")) {
        // consume
      }
    })();
    // First turn is blocked; queue two follow-ups.
    await new Promise((r) => setTimeout(r, 15));
    loop.followUp("first-fu");
    loop.followUp("second-fu");
    blocked.release();
    await promise;

    const followUps = (await store.loadMessages("s1"))
      .filter((m) => m.role === "user" && m.content !== "hi")
      .map((m) => m.content);
    // one-at-a-time: only the first follow-up runs in this prompt lifecycle.
    expect(followUps).toEqual(["first-fu"]);
    expect(call).toBe(2); // initial turn + exactly one follow-up turn
  });
});
