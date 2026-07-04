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
    expect(store.turns[0]!.intermediates).toEqual([]);
    expect(store.turns[0]!.summary).toBeNull();
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
  it("sets summary to the new assistant message", () => {
    const { store, actions } = createSessionStore();
    actions.startTurn(makeUserMsg("hi"));
    actions.addAssistantMessage(makeAssistantMsg("a1"));
    expect(store.turns[0]!.summary!.id).toBe("a1");
    expect(store.turns[0]!.summary!.isStreaming).toBe(true);
    expect(store.turns[0]!.intermediates).toEqual([]);
  });

  it("sets streaming.currentMessageId", () => {
    const { store, actions } = createSessionStore();
    actions.startTurn(makeUserMsg("hi"));
    actions.addAssistantMessage(makeAssistantMsg("a1"));
    expect(store.streaming.currentMessageId).toBe("a1");
  });

  it("demotes previous summary to intermediates when new message arrives", () => {
    const { store, actions } = createSessionStore();
    actions.startTurn(makeUserMsg("hi"));
    actions.addAssistantMessage(makeAssistantMsg("a1"));
    actions.finalizeMessage("a1");
    actions.addAssistantMessage(makeAssistantMsg("a2"));

    expect(store.turns[0]!.intermediates).toHaveLength(1);
    expect(store.turns[0]!.intermediates[0]!.id).toBe("a1");
    expect(store.turns[0]!.summary!.id).toBe("a2");
  });
});

describe("turn store — appendTextToken", () => {
  it("creates text part if none exists", () => {
    const { store, actions } = createSessionStore();
    actions.startTurn(makeUserMsg("hi"));
    actions.addAssistantMessage(makeAssistantMsg("a1"));
    actions.appendTextToken("a1", "Hello");
    const part = store.turns[0]!.summary!.parts[0]!;
    expect(part.type).toBe("text");
    expect(part).toMatchObject({ type: "text", text: "Hello" });
    expect(store.turns[0]!.summary!.content).toBe("Hello");
  });

  it("appends to existing text part (path-based)", () => {
    const { store, actions } = createSessionStore();
    actions.startTurn(makeUserMsg("hi"));
    actions.addAssistantMessage(makeAssistantMsg("a1"));
    actions.appendTextToken("a1", "Hello");
    actions.appendTextToken("a1", " World");
    expect(store.turns[0]!.summary!.parts[0]).toMatchObject({
      type: "text",
      text: "Hello World",
    });
    expect(store.turns[0]!.summary!.content).toBe("Hello World");
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
    expect(store.turns[0]!.summary!.parts[0]).toMatchObject({
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
    expect(store.turns[0]!.summary!.parts[0]).toMatchObject({
      type: "thinking",
      text: "hmm more",
    });
  });
});

describe("turn store — thinking endedAt on text transition", () => {
  it("sets endedAt on thinking part when text arrives", () => {
    const { store, actions } = createSessionStore();
    actions.startTurn(makeUserMsg("hi"));
    actions.addAssistantMessage(makeAssistantMsg("a1"));
    actions.appendThinkingToken("a1", "hmm");
    // Text arrives — thinking should be finalized
    actions.appendTextToken("a1", "answer");

    const parts = store.turns[0]!.summary!.parts;
    expect(parts[0]).toMatchObject({ type: "thinking", text: "hmm" });
    expect(parts[0]).toHaveProperty("endedAt");
    expect((parts[0] as { endedAt?: number }).endedAt).toBeTypeOf("number");
    expect(parts[1]).toMatchObject({ type: "text", text: "answer" });
  });
});

describe("turn store — addToolCall", () => {
  it("adds tool_call part and sets phase", () => {
    const { store, actions } = createSessionStore();
    actions.startTurn(makeUserMsg("hi"));
    actions.addAssistantMessage(makeAssistantMsg("a1"));
    actions.appendTextToken("a1", "thinking...");
    actions.addToolCall("a1", "tc1", "read", { path: "/foo" });
    const parts = store.turns[0]!.summary!.parts;
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
    const tc = store.turns[0]!.summary!.parts.find(
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
    expect(store.turns[0]!.summary!.isStreaming).toBe(false);
  });

  it("stores usage data", () => {
    const { store, actions } = createSessionStore();
    actions.startTurn(makeUserMsg("hi"));
    actions.addAssistantMessage(makeAssistantMsg("a1"));
    const usage = { cost: 0.001, input: 100, output: 50 };
    actions.finalizeMessage("a1", usage);
    expect(store.turns[0]!.summary!.usage).toEqual(usage);
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

describe("turn store — loadTurns", () => {
  it("replaces all turns from REST hydration", () => {
    const { store, actions } = createSessionStore();
    const turns: Turn[] = [
      {
        endedAt: 2,
        error: null,
        id: "t1",
        intermediateCount: 3,
        intermediates: [],
        intermediatesLoaded: false,
        loadedMessageIds: [],
        summary: makeAssistantMsg("a1"),
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
        intermediates: [],
        intermediatesLoaded: false,
        loadedMessageIds: [],
        summary,
        startedAt: 1,
        turnId: "t1",
        userMessage: makeUserMsg("q1"),
        working: false,
      },
    ]);
    actions.loadIntermediates("t1", [makeAssistantMsg("int1"), makeAssistantMsg("int2")]);
    expect(store.turns[0]!.intermediates).toHaveLength(2);
    expect(store.turns[0]!.intermediates[0]!.id).toBe("int1");
    expect(store.turns[0]!.summary!.id).toBe("sum");
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
        intermediates: [makeAssistantMsg("int1"), makeAssistantMsg("int2")],
        intermediatesLoaded: true,
        loadedMessageIds: ["int1", "int2"],
        summary,
        startedAt: 1,
        turnId: "t1",
        userMessage: makeUserMsg("q1"),
        working: false,
      },
    ]);
    actions.evictIntermediates("t1");
    expect(store.turns[0]!.intermediates).toEqual([]);
    expect(store.turns[0]!.summary!.id).toBe("sum");
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

// Referential stability matters because the view renders messages with `<For>`,
// which reconciles by item reference. If a store mutation cloned/moved a message
// to a new object, `<For>` would treat it as a new item, remount its subtree
// (including the Markdown node) and replay its mount animation. These tests pin
// the invariant that streaming mutations keep message object identity stable.
describe("turn store — referential stability (prevents <For> remounts)", () => {
  it("demotion moves the previous summary object into intermediates (same reference)", () => {
    const { store, actions } = createSessionStore();
    actions.startTurn(makeUserMsg("hi"));
    actions.addAssistantMessage(makeAssistantMsg("a1"));
    const prevSummary = store.turns[0]!.summary;
    actions.addAssistantMessage(makeAssistantMsg("a2"));
    // The demoted message keeps its object identity — <For> keeps its node.
    expect(store.turns[0]!.intermediates[0]).toBe(prevSummary);
    // The new summary is a distinct object.
    expect(store.turns[0]!.summary).not.toBe(prevSummary);
  });

  it("appendTextToken mutates the summary in place (reference stable)", () => {
    const { store, actions } = createSessionStore();
    actions.startTurn(makeUserMsg("hi"));
    actions.addAssistantMessage(makeAssistantMsg("a1"));
    const before = store.turns[0]!.summary;
    actions.appendTextToken("a1", "Hello");
    actions.appendTextToken("a1", " World");
    expect(store.turns[0]!.summary).toBe(before);
  });

  it("appendThinkingToken keeps the summary reference stable", () => {
    const { store, actions } = createSessionStore();
    actions.startTurn(makeUserMsg("hi"));
    actions.addAssistantMessage(makeAssistantMsg("a1"));
    const before = store.turns[0]!.summary;
    actions.appendThinkingToken("a1", "hmm");
    actions.appendThinkingToken("a1", " more");
    expect(store.turns[0]!.summary).toBe(before);
  });

  it("addToolCall keeps the summary reference stable", () => {
    const { store, actions } = createSessionStore();
    actions.startTurn(makeUserMsg("hi"));
    actions.addAssistantMessage(makeAssistantMsg("a1"));
    const before = store.turns[0]!.summary;
    actions.addToolCall("a1", "tc1", "read", { path: "/foo" });
    expect(store.turns[0]!.summary).toBe(before);
  });

  it("completeToolCall keeps the summary reference stable", () => {
    const { store, actions } = createSessionStore();
    actions.startTurn(makeUserMsg("hi"));
    actions.addAssistantMessage(makeAssistantMsg("a1"));
    actions.addToolCall("a1", "tc1", "read", { path: "/foo" });
    const before = store.turns[0]!.summary;
    actions.completeToolCall("a1", "tc1", "result", false);
    expect(store.turns[0]!.summary).toBe(before);
  });

  it("finalizeMessage keeps the summary reference stable", () => {
    const { store, actions } = createSessionStore();
    actions.startTurn(makeUserMsg("hi"));
    actions.addAssistantMessage(makeAssistantMsg("a1"));
    const before = store.turns[0]!.summary;
    actions.finalizeMessage("a1", { cost: 0.001, input: 1, output: 1 });
    expect(store.turns[0]!.summary).toBe(before);
  });

  it("addOmMarker/updateOmMarker keep the summary reference stable", () => {
    const { store, actions } = createSessionStore();
    actions.startTurn(makeUserMsg("hi"));
    actions.addAssistantMessage(makeAssistantMsg("a1"));
    const before = store.turns[0]!.summary;
    actions.addOmMarker("a1", {
      cycleId: "c1",
      operationType: "observation",
      status: "loading",
    });
    actions.updateOmMarker("a1", "c1", { status: "complete" });
    expect(store.turns[0]!.summary).toBe(before);
  });

  it("the combined [intermediates..., summary] array reuses the same item references", () => {
    const { store, actions } = createSessionStore();
    actions.startTurn(makeUserMsg("hi"));
    actions.addAssistantMessage(makeAssistantMsg("a1"));
    actions.finalizeMessage("a1");
    actions.addAssistantMessage(makeAssistantMsg("a2"));
    const t = store.turns[0]!;
    // This is the spread the view builds to feed <For>; spread must not clone.
    const combined = [...t.intermediates, ...(t.summary ? [t.summary] : [])];
    expect(combined).toHaveLength(2);
    expect(combined[0]).toBe(t.intermediates[0]);
    expect(combined[1]).toBe(t.summary);
  });

  it("appendTextToken keeps the text part reference stable across tokens", () => {
    const { store, actions } = createSessionStore();
    actions.startTurn(makeUserMsg("hi"));
    actions.addAssistantMessage(makeAssistantMsg("a1"));
    actions.appendTextToken("a1", "Hello");
    const textPart = store.turns[0]!.summary!.parts[0]!;
    actions.appendTextToken("a1", " World");
    actions.appendTextToken("a1", "!");
    // Same part object — the timeline step keyed by this part won't remount.
    expect(store.turns[0]!.summary!.parts[0]).toBe(textPart);
    expect((store.turns[0]!.summary!.parts[0] as { text: string }).text).toBe("Hello World!");
  });

  it("appendThinkingToken keeps the thinking part reference stable across tokens", () => {
    const { store, actions } = createSessionStore();
    actions.startTurn(makeUserMsg("hi"));
    actions.addAssistantMessage(makeAssistantMsg("a1"));
    actions.appendThinkingToken("a1", "hmm");
    const thinkingPart = store.turns[0]!.summary!.parts[0]!;
    actions.appendThinkingToken("a1", " more");
    actions.appendThinkingToken("a1", " thoughts");
    // Same part object — ThinkingStep won't remount (no Markdown animation replay).
    expect(store.turns[0]!.summary!.parts[0]).toBe(thinkingPart);
    expect((store.turns[0]!.summary!.parts[0] as { text: string }).text).toBe("hmm more thoughts");
  });

  it("addToolCall keeps earlier parts' references stable when a tool is appended", () => {
    const { store, actions } = createSessionStore();
    actions.startTurn(makeUserMsg("hi"));
    actions.addAssistantMessage(makeAssistantMsg("a1"));
    actions.appendThinkingToken("a1", "hmm");
    actions.appendTextToken("a1", "let me");
    const thinkingPart = store.turns[0]!.summary!.parts[0]!;
    const textPart = store.turns[0]!.summary!.parts[1]!;
    actions.addToolCall("a1", "tc1", "read", { path: "/foo" });
    // Earlier parts keep their identity after a tool call is appended.
    expect(store.turns[0]!.summary!.parts[0]).toBe(thinkingPart);
    expect(store.turns[0]!.summary!.parts[1]).toBe(textPart);
    expect(store.turns[0]!.summary!.parts).toHaveLength(3);
  });

  it("completeToolCall keeps the tool_call part reference stable on completion", () => {
    const { store, actions } = createSessionStore();
    actions.startTurn(makeUserMsg("hi"));
    actions.addAssistantMessage(makeAssistantMsg("a1"));
    actions.addToolCall("a1", "tc1", "read", { path: "/foo" });
    const toolPart = store.turns[0]!.summary!.parts[0]!;
    actions.completeToolCall("a1", "tc1", "file content", false);
    // Same part object — the ToolSummaryRow keyed by this part won't remount
    // when the tool transitions running → done.
    expect(store.turns[0]!.summary!.parts[0]).toBe(toolPart);
    const p = store.turns[0]!.summary!.parts[0] as Extract<MessagePart, { type: "tool_call" }>;
    expect(p.status).toBe("done");
    expect(p.result).toBe("file content");
  });

  it("completeToolCall keeps part reference stable with error + details", () => {
    const { store, actions } = createSessionStore();
    actions.startTurn(makeUserMsg("hi"));
    actions.addAssistantMessage(makeAssistantMsg("a1"));
    actions.addToolCall("a1", "tc1", "bash", { command: "ls" });
    const toolPart = store.turns[0]!.summary!.parts[0]!;
    actions.completeToolCall("a1", "tc1", "boom", true, { exitCode: 1 });
    expect(store.turns[0]!.summary!.parts[0]).toBe(toolPart);
    const p = store.turns[0]!.summary!.parts[0] as Extract<MessagePart, { type: "tool_call" }>;
    expect(p.status).toBe("error");
    expect(p.details).toEqual({ exitCode: 1 });
  });

  it("finalizeMessage keeps the trailing text part reference stable", () => {
    const { store, actions } = createSessionStore();
    actions.startTurn(makeUserMsg("hi"));
    actions.addAssistantMessage(makeAssistantMsg("a1"));
    actions.appendTextToken("a1", "the answer");
    const textPart = store.turns[0]!.summary!.parts[0]!;
    actions.finalizeMessage("a1", { cost: 0, input: 1, output: 1 });
    // Same part object — Markdown won't remount (no animation replay) when the
    // message finalizes.
    expect(store.turns[0]!.summary!.parts[0]).toBe(textPart);
    expect(store.turns[0]!.summary!.parts[0]).toMatchObject({
      type: "text",
      text: "the answer",
    });
  });

  it("finalizeMessage sets endedAt on a trailing thinking part in place", () => {
    const { store, actions } = createSessionStore();
    actions.startTurn(makeUserMsg("hi"));
    actions.addAssistantMessage(makeAssistantMsg("a1"));
    actions.appendThinkingToken("a1", "hmm");
    const thinkingPart = store.turns[0]!.summary!.parts[0]!;
    actions.finalizeMessage("a1");
    expect(store.turns[0]!.summary!.parts[0]).toBe(thinkingPart);
    expect((store.turns[0]!.summary!.parts[0] as { endedAt?: number }).endedAt).toBeTypeOf(
      "number",
    );
  });
});
