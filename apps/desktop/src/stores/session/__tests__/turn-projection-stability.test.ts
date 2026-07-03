import { describe, expect, it } from "vite-plus/test";
import type { MessagePart, UIMessage } from "../../types.ts";
import { buildChatTurns, type ChatTurn } from "../turn-projection.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMessage(overrides: Partial<UIMessage> = {}): UIMessage {
  return {
    id: crypto.randomUUID(),
    role: "user",
    content: "",
    parts: [],
    isStreaming: false,
    timestamp: Date.now(),
    ...overrides,
  };
}

function makeUser(content: string): UIMessage {
  return makeMessage({ role: "user", content });
}

function makeTextAssistant(text: string): UIMessage {
  return makeMessage({
    role: "assistant",
    content: text,
    parts: [{ type: "text", text }],
  });
}

function makeThinkingAssistant(thinking: string, text: string): UIMessage {
  return makeMessage({
    role: "assistant",
    content: text,
    parts: [
      { type: "thinking", text: thinking },
      { type: "text", text },
    ],
  });
}

function makeStreamingAssistant(parts: MessagePart[] = []): UIMessage {
  return makeMessage({
    role: "assistant",
    content: "",
    isStreaming: true,
    parts,
  });
}

function makeToolAssistant(
  toolName: string,
  toolCallId: string,
  result: string,
  text: string,
): UIMessage {
  return makeMessage({
    role: "assistant",
    content: text,
    parts: [
      {
        type: "tool_call",
        toolName,
        toolCallId,
        input: {},
        status: "done",
        result,
      },
      { type: "text", text },
    ],
  });
}

function build(messages: UIMessage[], streamingPhase = "idle"): ChatTurn[] {
  const order = messages.map((m) => m.id);
  const record: Record<string, UIMessage> = {};
  for (const m of messages) record[m.id] = m;
  return buildChatTurns(order, record, streamingPhase);
}

// ---------------------------------------------------------------------------
// Thinking split correctness
// ---------------------------------------------------------------------------

describe("buildChatTurns — thinking split", () => {
  it("splits thinking+text into two assistant messages", () => {
    const turns = build([makeUser("hi"), makeThinkingAssistant("Let me think", "Hello!")]);

    expect(turns[0]!.assistantMessages).toHaveLength(2);
  });

  it("does not split text-only assistant message", () => {
    const turns = build([makeUser("hi"), makeTextAssistant("Hello!")]);

    expect(turns[0]!.assistantMessages).toHaveLength(1);
  });

  it("does not split thinking-only assistant message (no text)", () => {
    const msg = makeMessage({
      role: "assistant",
      content: "",
      parts: [{ type: "thinking", text: "Just thinking, no answer" }],
    });
    const turns = build([makeUser("hi"), msg]);

    expect(turns[0]!.assistantMessages).toHaveLength(1);
  });

  it("thinking split message has #thinking id suffix", () => {
    const assistant = makeThinkingAssistant("thought", "answer");
    const turns = build([makeUser("hi"), assistant]);

    const thinkingMsg = turns[0]!.assistantMessages[0]!;
    expect(thinkingMsg.id).toBe(`${assistant.id}#thinking`);
  });

  it("non-thinking split message keeps original id", () => {
    const assistant = makeThinkingAssistant("thought", "answer");
    const turns = build([makeUser("hi"), assistant]);

    const textMsg = turns[0]!.assistantMessages[1]!;
    expect(textMsg.id).toBe(assistant.id);
  });

  it("thinking split message has empty content", () => {
    const turns = build([makeUser("hi"), makeThinkingAssistant("thought", "answer")]);

    const thinkingMsg = turns[0]!.assistantMessages[0]!;
    expect(thinkingMsg.content).toBe("");
  });

  it("thinking split message contains only thinking parts", () => {
    const turns = build([makeUser("hi"), makeThinkingAssistant("thought", "answer")]);

    const thinkingMsg = turns[0]!.assistantMessages[0]!;
    expect(thinkingMsg.parts.every((p) => p.type === "thinking")).toBe(true);
    expect(thinkingMsg.parts).toHaveLength(1);
  });

  it("non-thinking split message contains only non-thinking parts", () => {
    const turns = build([makeUser("hi"), makeThinkingAssistant("thought", "answer")]);

    const textMsg = turns[0]!.assistantMessages[1]!;
    expect(textMsg.parts.every((p) => p.type !== "thinking")).toBe(true);
    expect(textMsg.parts).toHaveLength(1);
    expect(textMsg.parts[0]!.type).toBe("text");
  });

  it("preserves tool_call + text in non-thinking split when thinking present", () => {
    const assistant = makeMessage({
      role: "assistant",
      content: "done",
      parts: [
        { type: "thinking", text: "planning" },
        { type: "tool_call", toolName: "read", toolCallId: "tc1", input: {}, status: "done" },
        { type: "text", text: "done" },
      ],
    });
    const turns = build([makeUser("hi"), assistant]);

    expect(turns[0]!.assistantMessages).toHaveLength(2);
    const [, nonThinking] = turns[0]!.assistantMessages;
    expect(nonThinking!.parts).toHaveLength(2);
    expect(nonThinking!.parts[0]!.type).toBe("tool_call");
    expect(nonThinking!.parts[1]!.type).toBe("text");
  });

  it("handles multiple thinking parts", () => {
    const assistant = makeMessage({
      role: "assistant",
      content: "answer",
      parts: [
        { type: "thinking", text: "thought 1" },
        { type: "thinking", text: "thought 2" },
        { type: "text", text: "answer" },
      ],
    });
    const turns = build([makeUser("hi"), assistant]);

    expect(turns[0]!.assistantMessages).toHaveLength(2);
    const [thinkingMsg] = turns[0]!.assistantMessages;
    expect(thinkingMsg!.parts).toHaveLength(2);
    expect(thinkingMsg!.parts.every((p) => p.type === "thinking")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Streaming behavior
// ---------------------------------------------------------------------------

describe("buildChatTurns — streaming messages are not split", () => {
  it("streaming message with thinking+text is pushed as-is (one message)", () => {
    const streaming = makeStreamingAssistant([
      { type: "thinking", text: "thinking live" },
      { type: "text", text: "text live" },
    ]);
    const turns = build([makeUser("hi"), streaming], "writing");

    // Not split — streaming messages are pushed directly
    expect(turns[0]!.assistantMessages).toHaveLength(1);
  });

  it("streaming message preserves original reference (not cloned)", () => {
    const streaming = makeStreamingAssistant([{ type: "thinking", text: "thinking live" }]);
    const turns = build([makeUser("hi"), streaming], "writing");

    expect(turns[0]!.assistantMessages[0]).toBe(streaming);
  });

  it("streaming message with only thinking is pushed as-is", () => {
    const streaming = makeStreamingAssistant([{ type: "thinking", text: "just thinking" }]);
    const turns = build([makeUser("hi"), streaming], "thinking");

    expect(turns[0]!.assistantMessages).toHaveLength(1);
    expect(turns[0]!.assistantMessages[0]).toBe(streaming);
  });
});

// ---------------------------------------------------------------------------
// THE CORE: referential stability across recompute
// ---------------------------------------------------------------------------

describe("buildChatTurns — referential stability (no re-render on recompute)", () => {
  it("text-only message: same reference across two calls", () => {
    const assistant = makeTextAssistant("hello");
    const messages = [makeUser("hi"), assistant];

    const t1 = build(messages);
    const t2 = build(messages);

    expect(t2[0]!.assistantMessages[0]).toBe(t1[0]!.assistantMessages[0]);
  });

  it("thinking split: same split object references across two calls", () => {
    const assistant = makeThinkingAssistant("thought", "answer");
    const messages = [makeUser("hi"), assistant];

    const t1 = build(messages);
    const t2 = build(messages);

    // Both split messages must be the exact same objects
    expect(t2[0]!.assistantMessages[0]).toBe(t1[0]!.assistantMessages[0]);
    expect(t2[0]!.assistantMessages[1]).toBe(t1[0]!.assistantMessages[1]);
  });

  it("thinking-only message: same reference across two calls", () => {
    const assistant = makeMessage({
      role: "assistant",
      content: "",
      parts: [{ type: "thinking", text: "only thinking" }],
    });
    const messages = [makeUser("hi"), assistant];

    const t1 = build(messages);
    const t2 = build(messages);

    expect(t2[0]!.assistantMessages[0]).toBe(t1[0]!.assistantMessages[0]);
  });

  it("user message: same reference across two calls", () => {
    const user = makeUser("hi");
    const messages = [user, makeTextAssistant("hello")];

    const t1 = build(messages);
    const t2 = build(messages);

    expect(t2[0]!.userMessage).toBe(t1[0]!.userMessage);
  });

  it("tool_call message: same reference across two calls", () => {
    const assistant = makeToolAssistant("read", "tc1", "file content", "done");
    const messages = [makeUser("hi"), assistant];

    const t1 = build(messages);
    const t2 = build(messages);

    expect(t2[0]!.assistantMessages[0]).toBe(t1[0]!.assistantMessages[0]);
  });

  it("three consecutive calls return identical references", () => {
    const assistant = makeThinkingAssistant("thought", "answer");
    const messages = [makeUser("hi"), assistant];

    const t1 = build(messages);
    const t2 = build(messages);
    const t3 = build(messages);

    for (const turn of [t2, t3]) {
      expect(turn[0]!.assistantMessages[0]).toBe(t1[0]!.assistantMessages[0]);
      expect(turn[0]!.assistantMessages[1]).toBe(t1[0]!.assistantMessages[1]);
    }
  });
});

// ---------------------------------------------------------------------------
// Multi-turn stability: adding messages doesn't disturb existing turns
// ---------------------------------------------------------------------------

describe("buildChatTurns — multi-turn stability", () => {
  it("adding a new turn does not change existing turn's message references", () => {
    const u1 = makeUser("q1");
    const a1 = makeThinkingAssistant("thought1", "answer1");
    const initial = [u1, a1];

    const t1 = build(initial);

    // Simulate a second turn arriving
    const u2 = makeUser("q2");
    const a2 = makeTextAssistant("answer2");
    const expanded = [...initial, u2, a2];

    const t2 = build(expanded);

    // Turn 0 messages must be the same objects
    expect(t2[0]!.assistantMessages[0]).toBe(t1[0]!.assistantMessages[0]);
    expect(t2[0]!.assistantMessages[1]).toBe(t1[0]!.assistantMessages[1]);
    // Turn 1 exists
    expect(t2).toHaveLength(2);
  });

  it("streaming a new turn does not change completed turn's split references", () => {
    // Completed turn 1 with thinking
    const u1 = makeUser("q1");
    const a1 = makeThinkingAssistant("thought1", "answer1");
    const completed = [u1, a1];

    const t1 = build(completed);

    // Turn 2 starts streaming
    const u2 = makeUser("q2");
    const a2streaming = makeStreamingAssistant([{ type: "thinking", text: "..." }]);
    const withStream = [...completed, u2, a2streaming];

    // Multiple tokens arrive — each triggers a recompute
    const t2 = build(withStream, "thinking");
    const t3 = build(withStream, "writing");

    // Turn 0 (completed) split references must be stable
    for (const turns of [t2, t3]) {
      expect(turns[0]!.assistantMessages[0]).toBe(t1[0]!.assistantMessages[0]);
      expect(turns[0]!.assistantMessages[1]).toBe(t1[0]!.assistantMessages[1]);
    }
  });

  it("all assistant messages across multiple turns are referentially stable", () => {
    const u1 = makeUser("q1");
    const a1 = makeToolAssistant("read", "tc1", "content1", "result1");
    const u2 = makeUser("q2");
    const a2 = makeThinkingAssistant("thought2", "answer2");
    const u3 = makeUser("q3");
    const a3 = makeTextAssistant("answer3");
    const messages = [u1, a1, u2, a2, u3, a3];

    const t1 = build(messages);
    const t2 = build(messages);

    for (let i = 0; i < t1.length; i++) {
      for (let j = 0; j < t1[i]!.assistantMessages.length; j++) {
        expect(t2[i]!.assistantMessages[j]).toBe(t1[i]!.assistantMessages[j]);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Cache correctness: different objects → different splits
// ---------------------------------------------------------------------------

describe("buildChatTurns — cache isolation", () => {
  it("two different message objects with same content produce different split references", () => {
    const msg1 = makeThinkingAssistant("same thought", "same answer");
    const msg2 = makeThinkingAssistant("same thought", "same answer");

    const t1 = build([makeUser("hi"), msg1]);
    const t2 = build([makeUser("hi"), msg2]);

    // Different source objects → different split objects (no false cache hit)
    expect(t2[0]!.assistantMessages[0]).not.toBe(t1[0]!.assistantMessages[0]);
    expect(t2[0]!.assistantMessages[1]).not.toBe(t1[0]!.assistantMessages[1]);
  });

  it("same message object reused across different message sets produces same split", () => {
    const shared = makeThinkingAssistant("shared thought", "shared answer");

    const t1 = build([makeUser("q1"), shared]);
    const t2 = build([makeUser("q2"), shared]);

    // Same source → same cached split, even in different turn contexts
    expect(t2[0]!.assistantMessages[0]).toBe(t1[0]!.assistantMessages[0]);
    expect(t2[0]!.assistantMessages[1]).toBe(t1[0]!.assistantMessages[1]);
  });
});

// ---------------------------------------------------------------------------
// Collapsibility after split
// ---------------------------------------------------------------------------

describe("buildChatTurns — collapsibility after thinking split", () => {
  it("thinking+text message produces collapsible turn (2 assistant messages)", () => {
    const turns = build([makeUser("hi"), makeThinkingAssistant("thought", "answer")]);

    // canCollapse checks assistantMessages.length > 1
    expect(turns[0]!.assistantMessages.length).toBeGreaterThan(1);
  });

  it("text-only message produces non-collapsible turn (1 assistant message)", () => {
    const turns = build([makeUser("hi"), makeTextAssistant("answer")]);

    expect(turns[0]!.assistantMessages).toHaveLength(1);
  });

  it("intermediateMessages (slice 0,-1) contains thinking message", () => {
    const turns = build([makeUser("hi"), makeThinkingAssistant("thought", "answer")]);
    const intermediates = turns[0]!.assistantMessages.slice(0, -1);

    expect(intermediates).toHaveLength(1);
    expect(intermediates[0]!.parts.every((p) => p.type === "thinking")).toBe(true);
  });

  it("summaryMessage (last) is the text-only message", () => {
    const turns = build([makeUser("hi"), makeThinkingAssistant("thought", "answer")]);
    const summary = turns[0]!.assistantMessages.at(-1)!;

    expect(summary.parts.every((p) => p.type !== "thinking")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Error and usage preservation through split
// ---------------------------------------------------------------------------

describe("buildChatTurns — split preserves metadata", () => {
  it("thinking split message preserves error from original", () => {
    const assistant = makeMessage({
      role: "assistant",
      content: "partial answer",
      error: "stream interrupted",
      parts: [
        { type: "thinking", text: "thought" },
        { type: "text", text: "partial answer" },
      ],
    });
    const turns = build([makeUser("hi"), assistant]);

    expect(turns[0]!.error).toBe("stream interrupted");
    // Both split messages carry the error field
    for (const msg of turns[0]!.assistantMessages) {
      expect(msg.error).toBe("stream interrupted");
    }
  });

  it("thinking split message preserves usage from original", () => {
    const usage = { cost: 0.001, input: 100, output: 50, reasoningTokens: 30 };
    const assistant = makeMessage({
      role: "assistant",
      content: "answer",
      usage,
      parts: [
        { type: "thinking", text: "thought" },
        { type: "text", text: "answer" },
      ],
    });
    const turns = build([makeUser("hi"), assistant]);

    for (const msg of turns[0]!.assistantMessages) {
      expect(msg.usage).toEqual(usage);
    }
  });

  it("thinking split message preserves timestamp from original", () => {
    const ts = 1700000000000;
    const assistant = makeMessage({
      role: "assistant",
      content: "answer",
      timestamp: ts,
      parts: [
        { type: "thinking", text: "thought" },
        { type: "text", text: "answer" },
      ],
    });
    const turns = build([makeUser("hi"), assistant]);

    for (const msg of turns[0]!.assistantMessages) {
      expect(msg.timestamp).toBe(ts);
    }
  });
});
