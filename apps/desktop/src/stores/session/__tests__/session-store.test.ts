import { createRenderEffect, createRoot } from "solid-js";
import { describe, expect, it } from "vitest";
import type { UIMessage } from "../../types.ts";
import { createSessionStore } from "../session-store.ts";

function makeMessage(overrides: Partial<UIMessage> = {}): UIMessage {
  return {
    id: `msg-${Math.random().toString(36).slice(2)}`,
    role: "assistant",
    content: "",
    parts: [],
    isStreaming: false,
    timestamp: Date.now(),
    ...overrides,
  };
}

describe("session store — addMessage", () => {
  it("inserts into messages map and order", () => {
    const session = createSessionStore();
    session.actions.addMessage(makeMessage({ id: "m1", content: "hello" }));

    expect(session.store.messages.m1).toBeDefined();
    expect(session.store.messages.m1!.content).toBe("hello");
    expect(session.store.messageOrder).toEqual(["m1"]);
  });

  it("preserves insertion order for multiple messages", () => {
    const session = createSessionStore();
    session.actions.addMessage(makeMessage({ id: "m1" }));
    session.actions.addMessage(makeMessage({ id: "m2" }));
    session.actions.addMessage(makeMessage({ id: "m3" }));

    expect(session.store.messageOrder).toEqual(["m1", "m2", "m3"]);
  });
});

describe("session store — appendToken", () => {
  it("appends to content", () => {
    const session = createSessionStore();
    session.actions.addMessage(makeMessage({ id: "m1", content: "Hel" }));

    session.actions.appendToken("m1", "lo");
    expect(session.store.messages.m1!.content).toBe("Hello");

    session.actions.appendToken("m1", " World");
    expect(session.store.messages.m1!.content).toBe("Hello World");
  });

  it("increments tokenCount", () => {
    const session = createSessionStore();
    session.actions.addMessage(makeMessage({ id: "m1" }));

    session.actions.appendToken("m1", "a");
    session.actions.appendToken("m1", "b");
    expect(session.store.streaming.tokenCount).toBe(2);
  });

  it("creates a text part when none exists", () => {
    const session = createSessionStore();
    session.actions.addMessage(makeMessage({ id: "m1", parts: [] }));

    session.actions.appendToken("m1", "Hello");

    expect(session.store.messages.m1!.parts).toHaveLength(1);
    expect(session.store.messages.m1!.parts[0]).toMatchObject({
      type: "text",
      text: "Hello",
    });
  });

  it("appends to existing last text part", () => {
    const session = createSessionStore();
    session.actions.addMessage({
      id: "m1",
      parts: [{ type: "text", text: "Hel" }],
    } as Partial<UIMessage> as UIMessage);

    session.actions.appendToken("m1", "lo");

    expect(session.store.messages.m1!.parts).toHaveLength(1);
    expect(session.store.messages.m1!.parts[0]).toMatchObject({
      type: "text",
      text: "Hello",
    });
  });

  it("creates new text part when last part is a tool call", () => {
    const session = createSessionStore();
    session.actions.addMessage(makeMessage({ id: "m1", parts: [] }));
    session.actions.addToolCall("m1", "tc1", "bash", {});

    session.actions.appendToken("m1", "done");

    expect(session.store.messages.m1!.parts).toHaveLength(2);
    expect(session.store.messages.m1!.parts[1]).toMatchObject({
      type: "text",
      text: "done",
    });
  });
});

describe("session store — appendThinkingToken", () => {
  it("creates a thinking part if none exists", () => {
    const session = createSessionStore();
    session.actions.addMessage({
      id: "msg-1",
      role: "assistant",
      content: "",
      parts: [],
      isStreaming: true,
      timestamp: Date.now(),
    });

    session.actions.appendThinkingToken("msg-1", "I should ");

    expect(session.store.messages["msg-1"]!.parts).toEqual([
      { type: "thinking", text: "I should " },
    ]);
  });

  it("appends to existing thinking part", () => {
    const session = createSessionStore();
    session.actions.addMessage({
      id: "msg-1",
      role: "assistant",
      content: "",
      parts: [{ type: "thinking", text: "I should " }],
      isStreaming: true,
      timestamp: Date.now(),
    });

    session.actions.appendThinkingToken("msg-1", "consider ");

    expect(session.store.messages["msg-1"]!.parts).toEqual([
      { type: "thinking", text: "I should consider " },
    ]);
  });

  it("creates new thinking part when last part is text", () => {
    const session = createSessionStore();
    session.actions.addMessage({
      id: "msg-1",
      role: "assistant",
      content: "Hello",
      parts: [{ type: "text", text: "Hello" }],
      isStreaming: true,
      timestamp: Date.now(),
    });

    session.actions.appendThinkingToken("msg-1", "Wait ");

    expect(session.store.messages["msg-1"]!.parts).toHaveLength(2);
    expect(session.store.messages["msg-1"]!.parts[1]).toEqual({
      type: "thinking",
      text: "Wait ",
    });
  });
});

describe("session store — wasLastUserMessage", () => {
  it("returns true when last message is user with matching content", () => {
    const session = createSessionStore();
    session.actions.addMessage({
      id: "msg-1",
      role: "user",
      content: "hello world",
      parts: [{ type: "text", text: "hello world" }],
      isStreaming: false,
      timestamp: Date.now(),
    });

    expect(session.actions.wasLastUserMessage("hello world")).toBe(true);
  });

  it("returns false when last message is assistant", () => {
    const session = createSessionStore();
    session.actions.addMessage({
      id: "msg-1",
      role: "assistant",
      content: "hi",
      parts: [{ type: "text", text: "hi" }],
      isStreaming: false,
      timestamp: Date.now(),
    });

    expect(session.actions.wasLastUserMessage("hi")).toBe(false);
  });

  it("returns false when last user message has different content", () => {
    const session = createSessionStore();
    session.actions.addMessage({
      id: "msg-1",
      role: "user",
      content: "hello",
      parts: [{ type: "text", text: "hello" }],
      isStreaming: false,
      timestamp: Date.now(),
    });

    expect(session.actions.wasLastUserMessage("goodbye")).toBe(false);
  });

  it("returns false when store is empty", () => {
    const session = createSessionStore();
    expect(session.actions.wasLastUserMessage("anything")).toBe(false);
  });
});

describe("session store — setContent", () => {
  it("replaces entire content", () => {
    const session = createSessionStore();
    session.actions.addMessage(makeMessage({ id: "m1", content: "old" }));

    session.actions.setContent("m1", "new content");
    expect(session.store.messages.m1!.content).toBe("new content");
  });
});

describe("session store — setPhase", () => {
  it("updates streaming phase", () => {
    const session = createSessionStore();
    session.actions.setPhase("thinking");
    expect(session.store.streaming.phase).toBe("thinking");

    session.actions.setPhase("writing");
    expect(session.store.streaming.phase).toBe("writing");

    session.actions.setPhase("error");
    expect(session.store.streaming.phase).toBe("error");
  });
});

describe("session store — currentMessage tracking", () => {
  it("setCurrentMessage and clearCurrentMessage", () => {
    const session = createSessionStore();
    session.actions.setCurrentMessage("m1");
    expect(session.store.streaming.currentMessageId).toBe("m1");

    session.actions.clearCurrentMessage();
    expect(session.store.streaming.currentMessageId).toBeNull();
  });

  it("getCurrentMessageId returns current value", () => {
    const session = createSessionStore();
    expect(session.actions.getCurrentMessageId()).toBeNull();

    session.actions.setCurrentMessage("m1");
    expect(session.actions.getCurrentMessageId()).toBe("m1");
  });
});

describe("session store — currentTool tracking", () => {
  it("setCurrentTool and clearCurrentTool", () => {
    const session = createSessionStore();
    session.actions.setCurrentTool("bash");
    expect(session.store.streaming.currentToolName).toBe("bash");

    session.actions.clearCurrentTool();
    expect(session.store.streaming.currentToolName).toBeNull();
  });
});

describe("session store — addToolCall", () => {
  it("adds a tool_call part and sets current tool", () => {
    const session = createSessionStore();
    session.actions.addMessage(makeMessage({ id: "m1" }));

    session.actions.addToolCall("m1", "tc1", "bash", { command: "ls" });

    expect(session.store.messages.m1!.parts).toHaveLength(1);
    expect(session.store.messages.m1!.parts[0]).toEqual({
      type: "tool_call",
      toolCallId: "tc1",
      toolName: "bash",
      input: { command: "ls" },
      status: "running",
    });
    expect(session.store.streaming.currentToolName).toBe("bash");
    expect(session.store.streaming.phase).toBe("tool_running");
  });

  it("adds multiple tool calls to same message", () => {
    const session = createSessionStore();
    session.actions.addMessage(makeMessage({ id: "m1" }));

    session.actions.addToolCall("m1", "tc1", "read", {});
    session.actions.addToolCall("m1", "tc2", "write", {});

    expect(session.store.messages.m1!.parts).toHaveLength(2);
  });
});

describe("session store — completeToolCall", () => {
  it("marks tool done with result", () => {
    const session = createSessionStore();
    session.actions.addMessage(makeMessage({ id: "m1" }));
    session.actions.addToolCall("m1", "tc1", "bash", {});

    session.actions.completeToolCall("m1", "tc1", "file1\nfile2");

    expect(session.store.messages.m1!.parts[0]).toMatchObject({
      type: "tool_call",
      status: "done",
      result: "file1\nfile2",
    });
    expect(session.store.streaming.currentToolName).toBeNull();
  });

  it("marks tool error with isError=true", () => {
    const session = createSessionStore();
    session.actions.addMessage(makeMessage({ id: "m1" }));
    session.actions.addToolCall("m1", "tc1", "bash", {});

    session.actions.completeToolCall("m1", "tc1", "failed", true);

    expect(session.store.messages.m1!.parts[0]).toMatchObject({
      status: "error",
      result: "failed",
    });
  });
});

describe("session store — completeToolCall with details", () => {
  it("stores details when provided", () => {
    const session = createSessionStore();
    session.actions.addMessage({
      id: "msg-1",
      role: "assistant",
      content: "",
      parts: [
        {
          type: "tool_call",
          toolCallId: "call-1",
          toolName: "edit",
          input: { path: "/test.ts" },
          status: "running",
        },
      ],
      isStreaming: true,
      timestamp: Date.now(),
    });

    const diff = "--- old\n+++ new";
    session.actions.completeToolCall(
      "msg-1",
      "call-1",
      "Edited /test.ts",
      false,
      diff
    );

    const part = session.store.messages["msg-1"]!.parts[0]!;
    expect(part.type).toBe("tool_call");
    expect((part as { details?: unknown }).details).toBe(diff);
  });

  it("works without details (backward compatible)", () => {
    const session = createSessionStore();
    session.actions.addMessage({
      id: "msg-1",
      role: "assistant",
      content: "",
      parts: [
        {
          type: "tool_call",
          toolCallId: "call-1",
          toolName: "bash",
          input: { command: "ls" },
          status: "running",
        },
      ],
      isStreaming: true,
      timestamp: Date.now(),
    });

    session.actions.completeToolCall("msg-1", "call-1", "output", false);

    const part = session.store.messages["msg-1"]!.parts[0]!;
    expect(part.type).toBe("tool_call");
    expect((part as { details?: unknown }).details).toBeUndefined();
  });
});

describe("session store — setError", () => {
  it("sets error on message and phase to error", () => {
    const session = createSessionStore();
    session.actions.addMessage(makeMessage({ id: "m1" }));

    session.actions.setError("m1", "Something broke");

    expect(session.store.messages.m1!.error).toBe("Something broke");
    expect(session.store.streaming.phase).toBe("error");
  });
});

describe("session store — finalizeMessage", () => {
  it("sets isStreaming to false", () => {
    const session = createSessionStore();
    session.actions.addMessage(makeMessage({ id: "m1", isStreaming: true }));

    session.actions.finalizeMessage("m1");

    expect(session.store.messages.m1!.isStreaming).toBe(false);
  });
});

describe("session store — loadMessages", () => {
  it("replaces entire message set", () => {
    const session = createSessionStore();
    session.actions.addMessage(makeMessage({ id: "old" }));

    session.actions.loadMessages([
      makeMessage({ id: "m1", content: "first" }),
      makeMessage({ id: "m2", content: "second" }),
    ]);

    expect(Object.keys(session.store.messages)).toHaveLength(2);
    expect(session.store.messageOrder).toEqual(["m1", "m2"]);
    expect(session.store.messages.old).toBeUndefined();
  });
});

describe("session store — reset", () => {
  it("clears everything back to idle", () => {
    const session = createSessionStore();
    session.actions.addMessage(makeMessage({ id: "m1" }));
    session.actions.setPhase("writing");
    session.actions.setCurrentMessage("m1");
    session.actions.setCurrentTool("bash");

    session.actions.reset();

    expect(Object.keys(session.store.messages)).toHaveLength(0);
    expect(session.store.messageOrder).toEqual([]);
    expect(session.store.streaming.phase).toBe("idle");
    expect(session.store.streaming.currentMessageId).toBeNull();
    expect(session.store.streaming.currentToolName).toBeNull();
  });
});

describe("session store — reactivity", () => {
  it("store updates are visible in createRenderEffect", async () => {
    const captured: string[] = [];
    let dispose: () => void = () => {};
    createRoot((d) => {
      dispose = d;
      const session = createSessionStore();

      // createRenderEffect runs its initial computation synchronously.
      // SolidJS batches subsequent signal updates onto a microtask.
      createRenderEffect(() => {
        captured.push(session.store.streaming.phase);
      });

      session.actions.setPhase("thinking");
      session.actions.setPhase("writing");
    });
    await Promise.resolve(); // flush batched updates before disposing
    dispose();

    // Initial run captures "idle". SolidJS coalesces the two synchronous
    // setPhase calls into one batched update, so only the final value
    // ("writing") is observed — the intermediate "thinking" is dropped.
    // The point of this test is to confirm the store is reactive.
    expect(captured).toContain("idle");
    expect(captured).toContain("writing");
  });
});
