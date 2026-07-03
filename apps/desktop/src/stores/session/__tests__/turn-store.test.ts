import { describe, expect, it } from "vite-plus/test";
import type { MessagePart, Turn, UIMessage } from "../../types.ts";
import { createSessionStore } from "../session-store.ts";

function makeUserMsg(text: string): UIMessage {
  return {
    content: text,
    id: `u-${Math.random().toString(36).slice(2)}`,
    isStreaming: false,
    parts: [{ type: "text", text }],
    role: "user",
    timestamp: Date.now(),
  };
}

function makeAssistantMsg(id: string): UIMessage {
  return {
    content: "",
    id,
    isStreaming: true,
    parts: [],
    role: "assistant",
    timestamp: Date.now(),
  };
}

describe("turn store — startTurn", () => {
  it("creates a new turn with user message", () => {
    const { store, actions } = createSessionStore();
    actions.startTurn(makeUserMsg("hello"));
    expect(store.turns).toHaveLength(1);
    expect(store.turns[0]!.userMessage?.content).toBe("hello");
    expect(store.turns[0]!.messages).toEqual([]);
    expect(store.turns[0]!.working).toBe(true);
  });

  it("creates a turn without user message (null)", () => {
    const { store, actions } = createSessionStore();
    actions.startTurn(null);
    expect(store.turns).toHaveLength(1);
    expect(store.turns[0]!.userMessage).toBeNull();
  });
});

describe("turn store — addAssistantMessage", () => {
  it("appends assistant message to the last turn", () => {
    const { store, actions } = createSessionStore();
    actions.startTurn(makeUserMsg("hi"));
    actions.addAssistantMessage(makeAssistantMsg("a1"));
    expect(store.turns[0]!.messages).toHaveLength(1);
    expect(store.turns[0]!.messages[0]!.id).toBe("a1");
    expect(store.turns[0]!.messages[0]!.isStreaming).toBe(true);
  });

  it("sets streaming.currentMessageId", () => {
    const { store, actions } = createSessionStore();
    actions.startTurn(makeUserMsg("hi"));
    actions.addAssistantMessage(makeAssistantMsg("a1"));
    expect(store.streaming.currentMessageId).toBe("a1");
  });
});

describe("turn store — appendTextToken", () => {
  it("creates text part if none exists", () => {
    const { store, actions } = createSessionStore();
    actions.startTurn(makeUserMsg("hi"));
    actions.addAssistantMessage(makeAssistantMsg("a1"));
    actions.appendTextToken("a1", "Hello");
    const part = store.turns[0]!.messages[0]!.parts[0]!;
    expect(part.type).toBe("text");
    expect(part).toMatchObject({ type: "text", text: "Hello" });
    expect(store.turns[0]!.messages[0]!.content).toBe("Hello");
  });

  it("appends to existing text part (path-based)", () => {
    const { store, actions } = createSessionStore();
    actions.startTurn(makeUserMsg("hi"));
    actions.addAssistantMessage(makeAssistantMsg("a1"));
    actions.appendTextToken("a1", "Hello");
    actions.appendTextToken("a1", " World");
    expect(store.turns[0]!.messages[0]!.parts[0]).toMatchObject({
      type: "text",
      text: "Hello World",
    });
    expect(store.turns[0]!.messages[0]!.content).toBe("Hello World");
  });

  it("increments tokenCount", () => {
    const { store, actions } = createSessionStore();
    actions.startTurn(makeUserMsg("hi"));
    actions.addAssistantMessage(makeAssistantMsg("a1"));
    actions.appendTextToken("a1", "x");
    actions.appendTextToken("a1", "y");
    expect(store.streaming.tokenCount).toBe(2);
  });
});

describe("turn store — appendThinkingToken", () => {
  it("creates thinking part", () => {
    const { store, actions } = createSessionStore();
    actions.startTurn(makeUserMsg("hi"));
    actions.addAssistantMessage(makeAssistantMsg("a1"));
    actions.appendThinkingToken("a1", "hmm");
    expect(store.turns[0]!.messages[0]!.parts[0]).toMatchObject({
      type: "thinking",
      text: "hmm",
    });
  });

  it("appends to existing thinking part", () => {
    const { store, actions } = createSessionStore();
    actions.startTurn(makeUserMsg("hi"));
    actions.addAssistantMessage(makeAssistantMsg("a1"));
    actions.appendThinkingToken("a1", "hmm");
    actions.appendThinkingToken("a1", " more");
    expect(store.turns[0]!.messages[0]!.parts[0]).toMatchObject({
      type: "thinking",
      text: "hmm more",
    });
  });
});

describe("turn store — addToolCall", () => {
  it("adds tool_call part and sets phase", () => {
    const { store, actions } = createSessionStore();
    actions.startTurn(makeUserMsg("hi"));
    actions.addAssistantMessage(makeAssistantMsg("a1"));
    actions.appendTextToken("a1", "thinking...");
    actions.addToolCall("a1", "tc1", "read", { path: "/foo" });
    const parts = store.turns[0]!.messages[0]!.parts;
    expect(parts.at(-1)).toMatchObject({
      type: "tool_call",
      toolName: "read",
      status: "running",
    });
    expect(store.streaming.phase).toBe("tool_running");
    expect(store.streaming.currentToolName).toBe("read");
  });
});

describe("turn store — completeToolCall", () => {
  it("completes the tool_call part with result", () => {
    const { store, actions } = createSessionStore();
    actions.startTurn(makeUserMsg("hi"));
    actions.addAssistantMessage(makeAssistantMsg("a1"));
    actions.addToolCall("a1", "tc1", "read", { path: "/foo" });
    actions.completeToolCall("a1", "tc1", "file content", false);
    const tc = store.turns[0]!.messages[0]!.parts.find(
      (p): p is Extract<MessagePart, { type: "tool_call" }> => p.type === "tool_call",
    );
    expect(tc?.status).toBe("done");
    expect(tc?.result).toBe("file content");
  });
});

describe("turn store — finalizeMessage", () => {
  it("sets isStreaming=false on message", () => {
    const { store, actions } = createSessionStore();
    actions.startTurn(makeUserMsg("hi"));
    actions.addAssistantMessage(makeAssistantMsg("a1"));
    actions.finalizeMessage("a1");
    expect(store.turns[0]!.messages[0]!.isStreaming).toBe(false);
  });

  it("stores usage data", () => {
    const { store, actions } = createSessionStore();
    actions.startTurn(makeUserMsg("hi"));
    actions.addAssistantMessage(makeAssistantMsg("a1"));
    const usage = { cost: 0.001, input: 100, output: 50 };
    actions.finalizeMessage("a1", usage);
    expect(store.turns[0]!.messages[0]!.usage).toEqual(usage);
  });
});

describe("turn store — finalizeTurn", () => {
  it("sets endedAt and working=false", () => {
    const { store, actions } = createSessionStore();
    actions.startTurn(makeUserMsg("hi"));
    actions.finalizeTurn(12345);
    expect(store.turns[0]!.endedAt).toBe(12345);
    expect(store.turns[0]!.working).toBe(false);
  });
});

describe("turn store — compaction (the bug fix)", () => {
  it("addCompactionMarker adds compaction part to message after turn ended", () => {
    const { store, actions } = createSessionStore();
    actions.startTurn(makeUserMsg("hi"));
    actions.addAssistantMessage(makeAssistantMsg("a1"));
    actions.appendTextToken("a1", "answer");
    actions.finalizeMessage("a1");
    actions.finalizeTurn(9999);

    // Compaction arrives after turn ended
    actions.addCompactionMarker("a1");
    const parts = store.turns[0]!.messages[0]!.parts;
    expect(parts.some((p) => p.type === "compaction")).toBe(true);
  });

  it("appendCompactionToken appends delta to compaction part", () => {
    const { store, actions } = createSessionStore();
    actions.startTurn(makeUserMsg("hi"));
    actions.addAssistantMessage(makeAssistantMsg("a1"));
    actions.finalizeMessage("a1");
    actions.addCompactionMarker("a1");
    actions.appendCompactionToken("a1", "Sum");
    actions.appendCompactionToken("a1", "mary");
    const cp = store.turns[0]!.messages[0]!.parts.find((p) => p.type === "compaction");
    expect(cp).toMatchObject({ type: "compaction", text: "Summary" });
  });

  it("updateCompactionMarker marks complete with tokensBefore", () => {
    const { store, actions } = createSessionStore();
    actions.startTurn(makeUserMsg("hi"));
    actions.addAssistantMessage(makeAssistantMsg("a1"));
    actions.finalizeMessage("a1");
    actions.addCompactionMarker("a1");
    actions.updateCompactionMarker("a1", {
      status: "complete",
      tokensBefore: 50000,
      endedAt: Date.now(),
    });
    const cp = store.turns[0]!.messages[0]!.parts.find((p) => p.type === "compaction");
    expect(cp).toMatchObject({ type: "compaction", status: "complete", tokensBefore: 50000 });
  });
});

describe("turn store — loadTurns", () => {
  it("replaces all turns from REST hydration", () => {
    const { store, actions } = createSessionStore();
    const turns: Turn[] = [
      {
        endedAt: 2,
        error: null,
        id: "t1",
        intermediateCount: 3,
        intermediatesLoaded: false,
        loadedMessageIds: [],
        messages: [makeAssistantMsg("a1")],
        startedAt: 1,
        turnId: "t1",
        userMessage: makeUserMsg("q1"),
        working: false,
      },
    ];
    actions.loadTurns(turns);
    expect(store.turns).toHaveLength(1);
    expect(store.turns[0]!.id).toBe("t1");
    expect(store.turns[0]!.userMessage?.content).toBe("q1");
  });
});

describe("turn store — loadIntermediates", () => {
  it("inserts intermediate messages before summary in the right turn", () => {
    const { store, actions } = createSessionStore();
    const summary: UIMessage = {
      ...makeAssistantMsg("sum"),
      content: "final answer",
      isStreaming: false,
      parts: [{ type: "text", text: "final answer" }],
    };
    actions.loadTurns([
      {
        endedAt: 2,
        error: null,
        id: "t1",
        intermediateCount: 2,
        intermediatesLoaded: false,
        loadedMessageIds: [],
        messages: [summary],
        startedAt: 1,
        turnId: "t1",
        userMessage: makeUserMsg("q1"),
        working: false,
      },
    ]);
    actions.loadIntermediates("t1", [makeAssistantMsg("int1"), makeAssistantMsg("int2")]);
    expect(store.turns[0]!.messages).toHaveLength(3);
    expect(store.turns[0]!.messages[0]!.id).toBe("int1");
    expect(store.turns[0]!.messages[2]!.id).toBe("sum");
    expect(store.turns[0]!.intermediatesLoaded).toBe(true);
    expect(store.turns[0]!.loadedMessageIds).toEqual(["int1", "int2"]);
  });
});

describe("turn store — evictIntermediates", () => {
  it("removes intermediate messages, keeps summary", () => {
    const { store, actions } = createSessionStore();
    const summary: UIMessage = {
      ...makeAssistantMsg("sum"),
      content: "final",
      isStreaming: false,
    };
    actions.loadTurns([
      {
        endedAt: 2,
        error: null,
        id: "t1",
        intermediateCount: 2,
        intermediatesLoaded: true,
        loadedMessageIds: ["int1", "int2"],
        messages: [makeAssistantMsg("int1"), makeAssistantMsg("int2"), summary],
        startedAt: 1,
        turnId: "t1",
        userMessage: makeUserMsg("q1"),
        working: false,
      },
    ]);
    actions.evictIntermediates("t1");
    expect(store.turns[0]!.messages).toHaveLength(1);
    expect(store.turns[0]!.messages[0]!.id).toBe("sum");
    expect(store.turns[0]!.intermediatesLoaded).toBe(false);
    expect(store.turns[0]!.loadedMessageIds).toEqual([]);
  });
});

describe("turn store — getLastAssistantMessageId", () => {
  it("finds last assistant message across turns", () => {
    const { actions } = createSessionStore();
    actions.startTurn(makeUserMsg("q1"));
    actions.addAssistantMessage(makeAssistantMsg("a1"));
    actions.finalizeMessage("a1");
    actions.finalizeTurn(100);
    actions.startTurn(makeUserMsg("q2"));
    actions.addAssistantMessage(makeAssistantMsg("a2"));

    expect(actions.getLastAssistantMessageId()).toBe("a2");
  });

  it("returns null when no assistant messages exist", () => {
    const { actions } = createSessionStore();
    expect(actions.getLastAssistantMessageId()).toBeNull();
  });
});

describe("turn store — reset", () => {
  it("clears all turns and streaming state", () => {
    const { store, actions } = createSessionStore();
    actions.startTurn(makeUserMsg("hi"));
    actions.addAssistantMessage(makeAssistantMsg("a1"));
    actions.reset();
    expect(store.turns).toEqual([]);
    expect(store.streaming.phase).toBe("idle");
  });
});

describe("turn store — wasLastUserMessage", () => {
  it("returns true when last turn's user message matches", () => {
    const { actions } = createSessionStore();
    actions.startTurn(makeUserMsg("hello"));
    expect(actions.wasLastUserMessage("hello")).toBe(true);
  });

  it("returns false when text differs", () => {
    const { actions } = createSessionStore();
    actions.startTurn(makeUserMsg("hello"));
    expect(actions.wasLastUserMessage("world")).toBe(false);
  });

  it("returns false when no turns exist", () => {
    const { actions } = createSessionStore();
    expect(actions.wasLastUserMessage("hello")).toBe(false);
  });
});
