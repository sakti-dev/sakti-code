import { describe, expect, it } from "vite-plus/test";
import { type ReplayEntry, ReplayRunner } from "../replay-runner.ts";

interface FakeWs {
  send: (d: unknown) => void;
  sent: unknown[];
}

function makeFakeWs(): FakeWs {
  const sent: unknown[] = [];
  return { sent, send: (d: unknown) => sent.push(d) };
}

const minimalEntries: ReplayEntry[] = [
  {
    type: "message",
    id: "e1",
    parentId: null,
    timestamp: "2024-01-01T00:00:00Z",
    message: {
      role: "user",
      content: [{ type: "text", text: "hello" }],
      timestamp: 1000,
    },
  },
  {
    type: "message",
    id: "e2",
    parentId: "e1",
    timestamp: "2024-01-01T00:00:01Z",
    message: {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "Let me think" },
        { type: "text", text: "Hi there" },
      ],
      provider: "faux",
      model: "faux-1",
      api: "faux",
      usage: {
        input: 1,
        output: 1,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: 1001,
    },
  },
];

const entriesWithTools: ReplayEntry[] = [
  {
    type: "message",
    id: "e1",
    parentId: null,
    timestamp: "2024-01-01T00:00:00Z",
    message: {
      role: "user",
      content: [{ type: "text", text: "list files" }],
      timestamp: 1000,
    },
  },
  {
    type: "message",
    id: "e2",
    parentId: "e1",
    timestamp: "2024-01-01T00:00:01Z",
    message: {
      role: "assistant",
      content: [
        { type: "text", text: "Running ls" },
        {
          type: "toolCall",
          id: "call-1",
          name: "bash",
          arguments: { command: "ls" },
        },
      ],
      provider: "faux",
      model: "faux-1",
      api: "faux",
      usage: {
        input: 1,
        output: 1,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "toolUse",
      timestamp: 1001,
    },
  },
  {
    type: "message",
    id: "e3",
    parentId: "e2",
    timestamp: "2024-01-01T00:00:02Z",
    message: {
      role: "toolResult",
      toolCallId: "call-1",
      toolName: "bash",
      content: [{ type: "text", text: "file1\nfile2" }],
      details: {},
      isError: false,
      timestamp: 1002,
    },
  },
  {
    type: "message",
    id: "e4",
    parentId: "e3",
    timestamp: "2024-01-01T00:00:03Z",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "Done" }],
      provider: "faux",
      model: "faux-1",
      api: "faux",
      usage: {
        input: 1,
        output: 1,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: 1003,
    },
  },
];

function eventTypes(ws: FakeWs): string[] {
  return ws.sent
    .filter((f) => (f as { type?: string }).type === "event")
    .map((f) => (f as { event?: { type?: string } }).event?.type)
    .filter((t): t is string => t !== undefined);
}

describe("ReplayRunner", () => {
  it("emits agent_start first and agent_end last", async () => {
    const ws = makeFakeWs();
    const runner = new ReplayRunner(minimalEntries, ws, "sess-1", {
      wordDelayMs: 0,
      toolDelayMs: 0,
    });
    await runner.run();

    const types = eventTypes(ws);
    expect(types[0]).toBe("agent_start");
    expect(types.at(-1)).toBe("agent_end");
  });

  it("emits message_start for user messages", async () => {
    const ws = makeFakeWs();
    const runner = new ReplayRunner(minimalEntries, ws, "sess-1", {
      wordDelayMs: 0,
      toolDelayMs: 0,
    });
    await runner.run();

    const userStarts = ws.sent.filter(
      (f) =>
        (f as { type?: string }).type === "event" &&
        (f as { event?: { type?: string; message?: { role?: string } } }).event?.message?.role ===
          "user",
    );
    expect(userStarts.length).toBeGreaterThan(0);
  });

  it("streams thinking_delta then text_delta for assistant messages", async () => {
    const ws = makeFakeWs();
    const runner = new ReplayRunner(minimalEntries, ws, "sess-1", {
      wordDelayMs: 0,
      toolDelayMs: 0,
    });
    await runner.run();

    const deltas = ws.sent
      .filter((f) => (f as { event?: { type?: string } }).event?.type === "message_update")
      .map((f) => (f as { event?: { delta?: { kind?: string } } }).event?.delta?.kind);

    const firstDelta = deltas[0];
    const lastDelta = deltas.at(-1);
    expect(firstDelta).toBe("thinking");
    expect(lastDelta).toBe("text");
  });

  it("emits tool_execution_start and tool_execution_end", async () => {
    const ws = makeFakeWs();
    const runner = new ReplayRunner(entriesWithTools, ws, "sess-1", {
      wordDelayMs: 0,
      toolDelayMs: 0,
    });
    await runner.run();

    const types = eventTypes(ws);
    expect(types).toContain("tool_execution_start");
    expect(types).toContain("tool_execution_end");
  });

  it("passes details through tool_execution_end", async () => {
    const ws = makeFakeWs();
    const runner = new ReplayRunner(entriesWithTools, ws, "sess-1", {
      wordDelayMs: 0,
      toolDelayMs: 0,
    });
    await runner.run();

    const endEvent = ws.sent.find(
      (f) => (f as { event?: { type?: string } }).event?.type === "tool_execution_end",
    ) as { event?: { result?: { details?: unknown } } } | undefined;
    expect(endEvent?.event?.result).toBeDefined();
    expect((endEvent!.event!.result as { details?: unknown }).details).toBeDefined();
  });

  it("can be aborted mid-run", async () => {
    const ws = makeFakeWs();
    const runner = new ReplayRunner(entriesWithTools, ws, "sess-1", {
      wordDelayMs: 10,
      toolDelayMs: 10,
    });

    const runPromise = runner.run();
    runner.abort();
    await runPromise;

    const types = eventTypes(ws);
    expect(types).toContain("agent_start");
    expect(types.at(-1)).toBe("agent_end");
  });

  it("can pause and resume", async () => {
    const ws = makeFakeWs();
    const runner = new ReplayRunner(minimalEntries, ws, "sess-1", {
      wordDelayMs: 5,
      toolDelayMs: 0,
    });

    const runPromise = runner.run();
    runner.pause();

    await new Promise((r) => setTimeout(r, 50));

    const typesBeforeResume = eventTypes(ws).length;

    runner.resume();
    await runPromise;

    const typesAfterResume = eventTypes(ws).length;
    expect(typesAfterResume).toBeGreaterThan(typesBeforeResume);
  });

  it("emits turn_start and turn_end", async () => {
    const ws = makeFakeWs();
    const runner = new ReplayRunner(entriesWithTools, ws, "sess-1", {
      wordDelayMs: 0,
      toolDelayMs: 0,
    });
    await runner.run();

    const types = eventTypes(ws);
    expect(types).toContain("turn_start");
    expect(types).toContain("turn_end");
  });
});
