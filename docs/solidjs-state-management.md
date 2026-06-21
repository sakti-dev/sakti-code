# SolidJS State Management Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the reactive state management layer for the SolidJS frontend — multi-store architecture with WS streaming, REST integration, and fine-grained reactivity.

**Architecture:** Domain-scoped stores: a singleton server store (projects, sessions, settings), lazily-created per-session message stores (WS-streamed), per-terminal stores, and UI signals. A single WebSocket multiplexes events from all sessions. Types are imported from `@sakti-code/agent` and `@sakti-code/server` — zero type duplication.

**Tech Stack:** SolidJS 1.9 (`createStore`, `createSignal`, `createMemo`, `batch`, `createContext`), `@elysiajs/eden` treaty client, `bun:test`

---

## Key Design Decisions

### Types: import, never duplicate
- `AgentHarnessEvent`, `AgentMessage`, `AgentEvent` from `@sakti-code/agent`
- `AssistantMessageEvent`, `TextContent`, `ImageContent` from `@earendil-works/pi-ai/base`
- `WsIn`, `WsOut` from `@sakti-code/server/ws` (new export — Task 1)
- UI-specific types (`UIMessage`, `StreamState`) defined locally, composed from the above

### Stores: domain-scoped, not one mega-store
| Store | Scope | Frequency | Lifecycle |
|-------|-------|-----------|-----------|
| `serverStore` | App | Low (REST) | App lifetime |
| `sessionStore[sessionId]` | Per session | High (WS tokens) | Created on open, disposable |
| `terminalStore[terminalId]` | Per terminal | High (WS data) | Created on open, disposable |
| UI signals | App | Low (user) | App lifetime |

### Messages: normalized maps, not arrays
- `messages: Record<messageId, UIMessage>` — O(1) path updates
- `messageOrder: string[]` — insertion order, separate from entity data
- Token streaming: `setStore("messages", msgId, "content", fn)` — only that text node re-renders

### Token batching: microtask queue
Accumulate `text_delta` events in a buffer, flush on next microtask. Collapses rapid tokens into one store write per flush cycle.

### AgentHarnessEvent → store mapping
The WS sends `AgentHarnessEvent` frames. The reducer maps them:
- `agent_start` → phase = "thinking"
- `message_start` (role=assistant) → create placeholder UIMessage
- `message_update` with `assistantMessageEvent.type === "text_delta"` → batch delta
- `tool_execution_start` → add tool call part, phase = "tool_running"
- `tool_execution_end` → mark tool done with result
- `agent_end` → phase = "idle"
- User `message_start` → skip (already inserted optimistically)

---

## Task 1: Server — Export WS frame types

**Files:**
- Modify: `apps/server/src/agent/ws-handler.ts` (add WelcomeFrame, PushFrame types, update WsOut)
- Modify: `apps/server/package.json` (add `"./ws"` export)
- Test: `apps/server/src/agent/__tests__/ws-types.test.ts`

**Step 1: Write the failing test**

Create `apps/server/src/agent/__tests__/ws-types.test.ts`:

```typescript
import { describe, expect, it } from "bun:test";
import type { WsIn, WsOut } from "../ws-handler.ts";

describe("WS frame types", () => {
  it("WsIn accepts prompt message", () => {
    const msg: WsIn = { type: "prompt", sessionId: "s1", message: "hello" };
    expect(msg.type).toBe("prompt");
  });

  it("WsOut includes event, error, welcome, and push frames", () => {
    const frames: WsOut[] = [
      { type: "event", sessionId: "s1", event: { type: "agent_start" } as never },
      { type: "error", sessionId: "s1", error: "boom" },
      { type: "welcome", version: "1.0.0", cwd: "/tmp" },
      { type: "push", channel: "terminal.data", data: { terminalId: "t1", data: "ls" } },
    ];
    expect(frames).toHaveLength(4);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
bun test apps/server/src/agent/__tests__/ws-types.test.ts
```
Expected: FAIL — `welcome` and `push` don't exist on `WsOut` type.

**Step 3: Add missing types to ws-handler.ts**

Add these interfaces after the existing `ErrorFrame` interface in `apps/server/src/agent/ws-handler.ts`:

```typescript
export interface WelcomeFrame {
  cwd: string;
  type: "welcome";
  version: string;
}

export interface PushFrame {
  channel: "terminal.data" | "terminal.exit";
  data:
    | { terminalId: string; data: string }
    | { terminalId: string; exitCode: number; signal?: number | string };
  type: "push";
}
```

Replace the `WsOut` type:

```typescript
export type WsOut = EventFrame | ErrorFrame | WelcomeFrame | PushFrame;
```

**Step 4: Add export to server package.json**

In `apps/server/package.json`, update the `exports` field:

```json
"exports": {
  ".": {
    "types": "./src/app.ts",
    "default": "./src/app.ts"
  },
  "./ws": {
    "types": "./src/agent/ws-handler.ts",
    "default": "./src/agent/ws-handler.ts"
  }
}
```

**Step 5: Run test to verify it passes**

```bash
bun test apps/server/src/agent/__tests__/ws-types.test.ts
```
Expected: PASS

**Step 6: Commit**

```bash
git add apps/server/src/agent/ws-handler.ts apps/server/package.json apps/server/src/agent/__tests__/ws-types.test.ts
git commit -m "feat(server): export WS frame types for frontend consumption"
```

---

## Task 2: Frontend — Dependencies and test setup

**Files:**
- Modify: `apps/app/package.json` (add deps, test script)
- Create: `apps/app/src/stores/` directory

**Step 1: Update package.json**

In `apps/app/package.json`, add to `dependencies`:

```json
"@sakti-code/agent": "workspace:*",
"@earendil-works/pi-ai": "*"
```

Add to `scripts`:

```json
"test": "bun test",
"typecheck": "tsc --noEmit"
```

**Step 2: Install**

```bash
cd apps/app && bun install
```

**Step 3: Verify type imports work**

Create a temporary test `apps/app/src/stores/__tests__/import-check.test.ts`:

```typescript
import { describe, expect, it } from "bun:test";
import type { AgentHarnessEvent, AgentMessage } from "@sakti-code/agent";
import type { WsIn, WsOut } from "@sakti-code/server/ws";
import type { AssistantMessageEvent } from "@earendil-works/pi-ai/base";

describe("type imports", () => {
  it("can reference agent types", () => {
    const event: AgentHarnessEvent = { type: "agent_start" };
    expect(event.type).toBe("agent_start");
  });

  it("can reference WS types", () => {
    const msg: WsIn = { type: "abort", sessionId: "s1" };
    expect(msg.type).toBe("abort");
  });

  it("can reference pi-ai types", () => {
    const evt: AssistantMessageEvent = {
      type: "text_delta",
      contentIndex: 0,
      delta: "hi",
      partial: { role: "assistant", content: "hi", timestamp: 0 },
    };
    expect(evt.type).toBe("text_delta");
  });
});
```

**Step 4: Run test**

```bash
bun test apps/app/src/stores/__tests__/import-check.test.ts
```
Expected: PASS

**Step 5: Commit**

```bash
git add apps/app/package.json apps/app/src/stores/__tests__/import-check.test.ts
git commit -m "feat(app): add @sakti-code/agent dep, test setup, verify type imports"
```

---

## Task 3: Frontend — Define UI types

**Files:**
- Create: `apps/app/src/stores/types.ts`
- Test: `apps/app/src/stores/__tests__/types.test.ts`

**Step 1: Write types.ts**

Create `apps/app/src/stores/types.ts`:

```typescript
import type { AgentMessage } from "@sakti-code/agent";

/**
 * A single content part within a UI message.
 * Text is accumulated from streaming deltas.
 * Tool calls track their execution lifecycle.
 */
export type MessagePart =
  | { type: "text"; text: string }
  | {
      type: "tool_call";
      toolCallId: string;
      toolName: string;
      input: unknown;
      status: "running" | "done" | "error";
      result?: string;
    }
  | { type: "thinking"; text: string };

/**
 * Frontend representation of a chat message.
 * Built from AgentHarnessEvents during streaming,
 * or from AgentMessage[] on initial REST load.
 */
export interface UIMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  parts: MessagePart[];
  isStreaming: boolean;
  timestamp: number;
  error?: string;
  usage?: { input: number; output: number; cost: number };
}

/**
 * Streaming state for a session.
 */
export interface StreamState {
  phase: "idle" | "thinking" | "writing" | "tool_running" | "error";
  startedAt: number;
  tokenCount: number;
  currentMessageId: string | null;
  currentToolName: string | null;
}

export const idleStreamState: StreamState = {
  phase: "idle",
  startedAt: 0,
  tokenCount: 0,
  currentMessageId: null,
  currentToolName: null,
};

/**
 * Convert an AgentMessage (from REST `/messages` or agent_end) into UIMessage(s).
 */
export function agentMessageToUI(msg: AgentMessage): UIMessage {
  const timestamp =
    typeof msg.timestamp === "number" ? msg.timestamp : Date.now();

  if (msg.role === "user" || msg.role === "assistant") {
    const content =
      typeof msg.content === "string"
        ? msg.content
        : Array.isArray(msg.content)
          ? msg.content
              .filter(
                (c): c is { type: "text"; text: string } => c.type === "text",
              )
              .map((c) => c.text)
              .join("")
          : "";

    const usage =
      msg.role === "assistant" && "usage" in msg && msg.usage
        ? {
            input: msg.usage.input,
            output: msg.usage.output,
            cost: msg.usage.cost.total,
          }
        : undefined;

    return {
      id: crypto.randomUUID(),
      role: msg.role,
      content,
      parts: [{ type: "text", text: content }],
      isStreaming: false,
      timestamp,
      ...(usage !== undefined ? { usage } : {}),
    };
  }

  return {
    id: crypto.randomUUID(),
    role: "system",
    content: "",
    parts: [],
    isStreaming: false,
    timestamp,
  };
}
```

**Step 2: Write the test**

Create `apps/app/src/stores/__tests__/types.test.ts`:

```typescript
import { describe, expect, it } from "bun:test";
import { agentMessageToUI, idleStreamState } from "../types.ts";
import type { AgentMessage } from "@sakti-code/agent";

describe("agentMessageToUI", () => {
  it("converts a user text message", () => {
    const msg = {
      role: "user",
      content: "hello world",
      timestamp: 1000,
    } as AgentMessage;

    const ui = agentMessageToUI(msg);
    expect(ui.role).toBe("user");
    expect(ui.content).toBe("hello world");
    expect(ui.parts).toHaveLength(1);
    expect(ui.parts[0]).toEqual({ type: "text", text: "hello world" });
    expect(ui.isStreaming).toBe(false);
  });

  it("converts an assistant message with usage", () => {
    const msg = {
      role: "assistant",
      content: "hi there",
      timestamp: 2000,
      usage: {
        input: 100,
        output: 50,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 150,
        cost: { input: 0.001, output: 0.002, cacheRead: 0, cacheWrite: 0, total: 0.003 },
      },
    } as unknown as AgentMessage;

    const ui = agentMessageToUI(msg);
    expect(ui.role).toBe("assistant");
    expect(ui.usage).toEqual({ input: 100, output: 50, cost: 0.003 });
  });

  it("converts assistant message with array content", () => {
    const msg = {
      role: "assistant",
      content: [
        { type: "text", text: "part1 " },
        { type: "text", text: "part2" },
      ],
      timestamp: 3000,
    } as unknown as AgentMessage;

    const ui = agentMessageToUI(msg);
    expect(ui.content).toBe("part1 part2");
  });
});

describe("idleStreamState", () => {
  it("starts idle with zero tokens", () => {
    expect(idleStreamState.phase).toBe("idle");
    expect(idleStreamState.tokenCount).toBe(0);
    expect(idleStreamState.currentMessageId).toBeNull();
  });
});
```

**Step 3: Run test to verify it passes**

```bash
bun test apps/app/src/stores/__tests__/types.test.ts
```
Expected: PASS

**Step 4: Commit**

```bash
git add apps/app/src/stores/types.ts apps/app/src/stores/__tests__/types.test.ts
git commit -m "feat(app): define UI message types with agent-to-UI conversion"
```

---

## Task 4: Frontend — Token batcher

**Files:**
- Create: `apps/app/src/stores/token-batcher.ts`
- Test: `apps/app/src/stores/__tests__/token-batcher.test.ts`

**Step 1: Write the failing test**

```typescript
import { createRoot } from "solid-js";
import { describe, expect, it } from "bun:test";
import { createTokenBatcher } from "../token-batcher.ts";

describe("token batcher", () => {
  it("accumulates deltas and flushes on microtask", async () => {
    await new Promise<void>((resolve) =>
      createRoot(async (dispose) => {
        const flushed: { id: string; text: string }[] = [];
        const batcher = createTokenBatcher((id, text) => {
          flushed.push({ id, text });
        });

        batcher.append("msg1", "Hello");
        batcher.append("msg1", " ");
        batcher.append("msg1", "World");
        batcher.append("msg2", "Other");

        expect(flushed).toHaveLength(0);

        await Promise.resolve();

        expect(flushed).toEqual([
          { id: "msg1", text: "Hello World" },
          { id: "msg2", text: "Other" },
        ]);

        dispose();
        resolve();
      }),
    );
  });

  it("does not flush when empty", async () => {
    await new Promise<void>((resolve) =>
      createRoot(async (dispose) => {
        const flushed: string[] = [];
        const batcher = createTokenBatcher((_, text) => flushed.push(text));

        batcher.append("msg1", "token");
        await Promise.resolve();

        expect(flushed).toEqual(["token"]);

        await Promise.resolve();
        expect(flushed).toEqual(["token"]);

        dispose();
        resolve();
      }),
    );
  });
});
```

**Step 2: Run test to verify it fails**

```bash
bun test apps/app/src/stores/__tests__/token-batcher.test.ts
```
Expected: FAIL — `createTokenBatcher` not found.

**Step 3: Implement token-batcher.ts**

```typescript
/**
 * Batches high-frequency text deltas by message ID.
 * Flushes accumulated text on the next microtask,
 * collapsing N append calls into one callback per message.
 */
export function createTokenBatcher(
  onFlush: (messageId: string, accumulatedText: string),
): {
  append: (messageId: string, delta: string) => void;
  dispose: () => void;
} {
  const buffer = new Map<string, string>();
  let scheduled = false;

  function flush(): void {
    scheduled = false;
    for (const [id, text] of buffer) {
      onFlush(id, text);
    }
    buffer.clear();
  }

  return {
    append(messageId: string, delta: string): void {
      buffer.set(messageId, (buffer.get(messageId) ?? "") + delta);
      if (!scheduled) {
        scheduled = true;
        queueMicrotask(flush);
      }
    },
    dispose(): void {
      buffer.clear();
      scheduled = false;
    },
  };
}
```

**Step 4: Run test to verify it passes**

```bash
bun test apps/app/src/stores/__tests__/token-batcher.test.ts
```
Expected: PASS

**Step 5: Commit**

```bash
git add apps/app/src/stores/token-batcher.ts apps/app/src/stores/__tests__/token-batcher.test.ts
git commit -m "feat(app): add microtask-based token batcher for streaming deltas"
```

---

## Task 5: Frontend — Session store factory

**Files:**
- Create: `apps/app/src/stores/session-store.ts`
- Test: `apps/app/src/stores/__tests__/session-store.test.ts`

**Step 1: Write the failing test**

```typescript
import { createRoot } from "solid-js";
import { describe, expect, it } from "bun:test";
import { createSessionStore } from "../session-store.ts";
import type { UIMessage } from "../types.ts";

function makeMessage(overrides: Partial<UIMessage> = {}): UIMessage {
  return {
    id: crypto.randomUUID(),
    role: "assistant",
    content: "",
    parts: [],
    isStreaming: false,
    timestamp: Date.now(),
    ...overrides,
  };
}

describe("session store", () => {
  it("addMessage inserts into messages map and order", () =>
    createRoot((dispose) => {
      const session = createSessionStore("s1");

      const msg = makeMessage({ id: "m1", content: "hello" });
      session.actions.addMessage(msg);

      expect(session.store.messages.m1).toBeDefined();
      expect(session.store.messages.m1.content).toBe("hello");
      expect(session.store.messageOrder).toEqual(["m1"]);

      dispose();
    }));

  it("appendToken updates message content via path", () =>
    createRoot((dispose) => {
      const session = createSessionStore("s1");
      session.actions.addMessage(makeMessage({ id: "m1", content: "Hel" }));

      session.actions.appendToken("m1", "lo");
      expect(session.store.messages.m1.content).toBe("Hello");

      session.actions.appendToken("m1", " World");
      expect(session.store.messages.m1.content).toBe("Hello World");

      dispose();
    }));

  it("setPhase updates streaming state", () =>
    createRoot((dispose) => {
      const session = createSessionStore("s1");

      session.actions.setPhase("thinking");
      expect(session.store.streaming.phase).toBe("thinking");

      session.actions.setPhase("writing");
      expect(session.store.streaming.phase).toBe("writing");

      dispose();
    }));

  it("setCurrentMessage tracks the active streaming message", () =>
    createRoot((dispose) => {
      const session = createSessionStore("s1");

      session.actions.setCurrentMessage("m1");
      expect(session.store.streaming.currentMessageId).toBe("m1");

      session.actions.clearCurrentMessage();
      expect(session.store.streaming.currentMessageId).toBeNull();

      dispose();
    }));

  it("addToolCall adds a tool_call part and sets current tool", () =>
    createRoot((dispose) => {
      const session = createSessionStore("s1");
      session.actions.addMessage(
        makeMessage({ id: "m1", role: "assistant" }),
      );

      session.actions.addToolCall("m1", "tc1", "bash", { command: "ls" });

      expect(session.store.messages.m1.parts).toHaveLength(1);
      expect(session.store.messages.m1.parts[0]).toEqual({
        type: "tool_call",
        toolCallId: "tc1",
        toolName: "bash",
        input: { command: "ls" },
        status: "running",
      });
      expect(session.store.streaming.currentToolName).toBe("bash");

      dispose();
    }));

  it("completeToolCall marks the part done with result", () =>
    createRoot((dispose) => {
      const session = createSessionStore("s1");
      session.actions.addMessage(makeMessage({ id: "m1" }));
      session.actions.addToolCall("m1", "tc1", "bash", { command: "ls" });

      session.actions.completeToolCall("m1", "tc1", "file1\nfile2");

      const part = session.store.messages.m1.parts[0];
      expect(part).toMatchObject({
        type: "tool_call",
        status: "done",
        result: "file1\nfile2",
      });
      expect(session.store.streaming.currentToolName).toBeNull();

      dispose();
    }));

  it("setError sets error on message and phase to error", () =>
    createRoot((dispose) => {
      const session = createSessionStore("s1");
      session.actions.addMessage(makeMessage({ id: "m1" }));
      session.actions.setCurrentMessage("m1");

      session.actions.setError("m1", "Something broke");

      expect(session.store.messages.m1.error).toBe("Something broke");
      expect(session.store.streaming.phase).toBe("error");

      dispose();
    }));

  it("loadMessages replaces entire message set", () =>
    createRoot((dispose) => {
      const session = createSessionStore("s1");
      const msgs = [
        makeMessage({ id: "m1", content: "first" }),
        makeMessage({ id: "m2", content: "second" }),
      ];

      session.actions.loadMessages(msgs);

      expect(Object.keys(session.store.messages)).toHaveLength(2);
      expect(session.store.messageOrder).toEqual(["m1", "m2"]);

      dispose();
    }));

  it("reset clears everything back to idle", () =>
    createRoot((dispose) => {
      const session = createSessionStore("s1");
      session.actions.addMessage(makeMessage({ id: "m1" }));
      session.actions.setPhase("writing");

      session.actions.reset();

      expect(Object.keys(session.store.messages)).toHaveLength(0);
      expect(session.store.messageOrder).toEqual([]);
      expect(session.store.streaming.phase).toBe("idle");

      dispose();
    }));
});
```

**Step 2: Run test to verify it fails**

```bash
bun test apps/app/src/stores/__tests__/session-store.test.ts
```
Expected: FAIL — `createSessionStore` not found.

**Step 3: Implement session-store.ts**

```typescript
import { createStore, produce } from "solid-js/store";
import { idleStreamState, type MessagePart, type StreamState, type UIMessage } from "./types.ts";

export interface SessionStoreData {
  messages: Record<string, UIMessage>;
  messageOrder: string[];
  streaming: StreamState;
}

export interface SessionActions {
  addMessage: (msg: UIMessage) => void;
  loadMessages: (msgs: UIMessage[]) => void;
  appendToken: (msgId: string, delta: string) => void;
  setContent: (msgId: string, content: string) => void;
  setPhase: (phase: StreamState["phase"]) => void;
  setCurrentMessage: (msgId: string) => void;
  clearCurrentMessage: () => void;
  setCurrentTool: (toolName: string) => void;
  clearCurrentTool: () => void;
  addToolCall: (
    msgId: string,
    toolCallId: string,
    toolName: string,
    input: unknown,
  ) => void;
  completeToolCall: (
    msgId: string,
    toolCallId: string,
    result: string,
    isError?: boolean,
  ) => void;
  setError: (msgId: string, error: string) => void;
  finalizeMessage: (msgId: string) => void;
  reset: () => void;
}

export interface SessionStore {
  store: SessionStoreData;
  actions: SessionActions;
}

export function createSessionStore(sessionId: string): SessionStore {
  const [store, setStore] = createStore<SessionStoreData>({
    messages: {},
    messageOrder: [],
    streaming: { ...idleStreamState },
  });

  void sessionId;

  const actions: SessionActions = {
    addMessage(msg) {
      setStore("messages", msg.id, msg);
      setStore("messageOrder", (prev) => [...prev, msg.id]);
    },

    loadMessages(msgs) {
      setStore("messages", {});
      setStore("messageOrder", []);
      for (const msg of msgs) {
        setStore("messages", msg.id, msg);
      }
      setStore(
        "messageOrder",
        msgs.map((m) => m.id),
      );
    },

    appendToken(msgId, delta) {
      setStore("messages", msgId, "content", (prev) => prev + delta);
      setStore("streaming", "tokenCount", (n) => n + 1);
    },

    setContent(msgId, content) {
      setStore("messages", msgId, "content", content);
    },

    setPhase(phase) {
      setStore("streaming", "phase", phase);
    },

    setCurrentMessage(msgId) {
      setStore("streaming", "currentMessageId", msgId);
    },

    clearCurrentMessage() {
      setStore("streaming", "currentMessageId", null);
    },

    setCurrentTool(toolName) {
      setStore("streaming", "currentToolName", toolName);
    },

    clearCurrentTool() {
      setStore("streaming", "currentToolName", null);
    },

    addToolCall(msgId, toolCallId, toolName, input) {
      const part: MessagePart = {
        type: "tool_call",
        toolCallId,
        toolName,
        input,
        status: "running",
      };
      setStore(
        "messages",
        msgId,
        "parts",
        produce((parts: MessagePart[]) => [...parts, part]),
      );
      setStore("streaming", "currentToolName", toolName);
      setStore("streaming", "phase", "tool_running");
    },

    completeToolCall(msgId, toolCallId, result, isError = false) {
      setStore(
        "messages",
        msgId,
        "parts",
        produce((parts: MessagePart[]) =>
          parts.map((p) =>
            p.type === "tool_call" && p.toolCallId === toolCallId
              ? { ...p, status: isError ? "error" as const : "done" as const, result }
              : p,
          ),
        ),
      );
      setStore("streaming", "currentToolName", null);
    },

    setError(msgId, error) {
      setStore("messages", msgId, "error", error);
      setStore("streaming", "phase", "error");
    },

    finalizeMessage(msgId) {
      setStore("messages", msgId, "isStreaming", false);
    },

    reset() {
      setStore("messages", {});
      setStore("messageOrder", []);
      setStore("streaming", { ...idleStreamState });
    },
  };

  return { store, actions };
}
```

**Step 4: Run test to verify it passes**

```bash
bun test apps/app/src/stores/__tests__/session-store.test.ts
```
Expected: PASS

**Step 5: Commit**

```bash
git add apps/app/src/stores/session-store.ts apps/app/src/stores/__tests__/session-store.test.ts
git commit -m "feat(app): add per-session store factory with normalized message map"
```

---

## Task 6: Frontend — Session store registry

**Files:**
- Create: `apps/app/src/stores/session-registry.ts`
- Test: `apps/app/src/stores/__tests__/session-registry.test.ts`

**Step 1: Write the failing test**

```typescript
import { createRoot } from "solid-js";
import { describe, expect, it } from "bun:test";
import { getSessionStore, disposeSessionStore, hasSessionStore } from "../session-registry.ts";

describe("session registry", () => {
  it("creates store lazily on first access", () =>
    createRoot((dispose) => {
      expect(hasSessionStore("s1")).toBe(false);
      const store1 = getSessionStore("s1");
      expect(hasSessionStore("s1")).toBe(true);

      const store2 = getSessionStore("s1");
      expect(store2).toBe(store1);

      dispose();
      disposeSessionStore("s1");
    }));

  it("disposes store and allows re-creation", () =>
    createRoot((dispose) => {
      const store1 = getSessionStore("s2");
      disposeSessionStore("s2");
      expect(hasSessionStore("s2")).toBe(false);

      const store2 = getSessionStore("s2");
      expect(store2).not.toBe(store1);

      dispose();
      disposeSessionStore("s2");
    }));
});
```

**Step 2: Run test to verify it fails**

```bash
bun test apps/app/src/stores/__tests__/session-registry.test.ts
```
Expected: FAIL — module not found.

**Step 3: Implement session-registry.ts**

```typescript
import type { SessionStore } from "./session-store.ts";
import { createSessionStore } from "./session-store.ts";

const registry = new Map<string, SessionStore>();

export function getSessionStore(sessionId: string): SessionStore {
  let store = registry.get(sessionId);
  if (!store) {
    store = createSessionStore(sessionId);
    registry.set(sessionId, store);
  }
  return store;
}

export function hasSessionStore(sessionId: string): boolean {
  return registry.has(sessionId);
}

export function disposeSessionStore(sessionId: string): void {
  registry.delete(sessionId);
}
```

**Step 4: Run test to verify it passes**

```bash
bun test apps/app/src/stores/__tests__/session-registry.test.ts
```
Expected: PASS

**Step 5: Commit**

```bash
git add apps/app/src/stores/session-registry.ts apps/app/src/stores/__tests__/session-registry.test.ts
git commit -m "feat(app): add session store registry for lazy create/dispose"
```

---

## Task 7: Frontend — Event reducer

**Files:**
- Create: `apps/app/src/stores/event-reducer.ts`
- Test: `apps/app/src/stores/__tests__/event-reducer.test.ts`

**Step 1: Write the failing test**

```typescript
import { createRoot } from "solid-js";
import { describe, expect, it } from "bun:test";
import { createSessionStore } from "../session-store.ts";
import { createTokenBatcher } from "../token-batcher.ts";
import { dispatchEvent } from "../event-reducer.ts";
import type { AgentHarnessEvent } from "@sakti-code/agent";

function setup() {
  return createRoot((dispose) => {
    const session = createSessionStore("s1");
    const batcher = createTokenBatcher((msgId, text) => {
      session.actions.appendToken(msgId, text);
    });
    return { session, batcher, dispose };
  });
}

describe("event reducer", () => {
  it("agent_start sets phase to thinking", () => {
    const { session, batcher, dispose } = setup();
    dispatchEvent(session.actions, batcher, {
      type: "agent_start",
    } as AgentHarnessEvent);

    expect(session.store.streaming.phase).toBe("thinking");
    dispose();
  });

  it("message_start for assistant creates a streaming message", () => {
    const { session, batcher, dispose } = setup();
    dispatchEvent(session.actions, batcher, {
      type: "message_start",
      message: {
        role: "assistant",
        content: "",
        timestamp: Date.now(),
      },
    } as AgentHarnessEvent);

    expect(session.store.messageOrder).toHaveLength(1);
    const msgId = session.store.messageOrder[0]!;
    expect(session.store.messages[msgId].role).toBe("assistant");
    expect(session.store.messages[msgId].isStreaming).toBe(true);
    expect(session.store.streaming.currentMessageId).toBe(msgId);
    expect(session.store.streaming.phase).toBe("writing");
    dispose();
  });

  it("message_start for user is skipped (optimistic insert)", () => {
    const { session, batcher, dispose } = setup();
    dispatchEvent(session.actions, batcher, {
      type: "message_start",
      message: { role: "user", content: "hello", timestamp: Date.now() },
    } as AgentHarnessEvent);

    expect(session.store.messageOrder).toHaveLength(0);
    dispose();
  });

  it("message_update with text_delta batches the delta", async () => {
    const { session, batcher, dispose } = setup();

    dispatchEvent(session.actions, batcher, {
      type: "message_start",
      message: { role: "assistant", content: "", timestamp: Date.now() },
    } as AgentHarnessEvent);
    const msgId = session.store.streaming.currentMessageId!;

    dispatchEvent(session.actions, batcher, {
      type: "message_update",
      message: { role: "assistant", content: "Hello", timestamp: Date.now() },
      assistantMessageEvent: {
        type: "text_delta",
        contentIndex: 0,
        delta: "Hello",
        partial: { role: "assistant", content: "Hello", timestamp: Date.now() },
      },
    } as AgentHarnessEvent);

    await Promise.resolve();

    expect(session.store.messages[msgId].content).toBe("Hello");
    dispose();
  });

  it("tool_execution_start adds a tool call part", () => {
    const { session, batcher, dispose } = setup();

    dispatchEvent(session.actions, batcher, {
      type: "message_start",
      message: { role: "assistant", content: "Let me check", timestamp: Date.now() },
    } as AgentHarnessEvent);
    const msgId = session.store.streaming.currentMessageId!;

    dispatchEvent(session.actions, batcher, {
      type: "tool_execution_start",
      toolCallId: "tc1",
      toolName: "bash",
      args: { command: "ls" },
    } as AgentHarnessEvent);

    expect(session.store.messages[msgId].parts).toHaveLength(1);
    expect(session.store.messages[msgId].parts[0]).toMatchObject({
      type: "tool_call",
      toolName: "bash",
      status: "running",
    });
    expect(session.store.streaming.phase).toBe("tool_running");
    dispose();
  });

  it("tool_execution_end completes the tool call", () => {
    const { session, batcher, dispose } = setup();

    dispatchEvent(session.actions, batcher, {
      type: "message_start",
      message: { role: "assistant", content: "", timestamp: Date.now() },
    } as AgentHarnessEvent);
    const msgId = session.store.streaming.currentMessageId!;

    dispatchEvent(session.actions, batcher, {
      type: "tool_execution_start",
      toolCallId: "tc1",
      toolName: "bash",
      args: { command: "ls" },
    } as AgentHarnessEvent);

    dispatchEvent(session.actions, batcher, {
      type: "tool_execution_end",
      toolCallId: "tc1",
      toolName: "bash",
      result: { content: [{ type: "text", text: "file1\nfile2" }] },
      isError: false,
    } as AgentHarnessEvent);

    const part = session.store.messages[msgId].parts[0];
    expect(part).toMatchObject({ type: "tool_call", status: "done" });
    dispose();
  });

  it("agent_end sets phase to idle", () => {
    const { session, batcher, dispose } = setup();
    dispatchEvent(session.actions, batcher, {
      type: "agent_start",
    } as AgentHarnessEvent);
    dispatchEvent(session.actions, batcher, {
      type: "agent_end",
      messages: [],
    } as AgentHarnessEvent);

    expect(session.store.streaming.phase).toBe("idle");
    dispose();
  });
});
```

**Step 2: Run test to verify it fails**

```bash
bun test apps/app/src/stores/__tests__/event-reducer.test.ts
```
Expected: FAIL — `dispatchEvent` not found.

**Step 3: Implement event-reducer.ts**

```typescript
import type { AgentHarnessEvent, AgentMessage } from "@sakti-code/agent";
import type { SessionActions } from "./session-store.ts";
import type { TokenBatcher } from "./token-batcher.ts";

function extractTextContent(msg: AgentMessage): string {
  if (typeof msg.content === "string") {
    return msg.content;
  }
  if (Array.isArray(msg.content)) {
    return msg.content
      .filter((c): c is { type: "text"; text: string } => c.type === "text")
      .map((c) => c.text)
      .join("");
  }
  return "";
}

export function dispatchEvent(
  actions: SessionActions,
  batcher: TokenBatcher,
  event: AgentHarnessEvent,
): void {
  switch (event.type) {
    case "agent_start":
      actions.setPhase("thinking");
      break;

    case "message_start": {
      if (event.message.role === "user") {
        break;
      }
      if (event.message.role === "assistant") {
        const msgId = crypto.randomUUID();
        const text = extractTextContent(event.message);
        actions.addMessage({
          id: msgId,
          role: "assistant",
          content: text,
          parts: text ? [{ type: "text", text }] : [],
          isStreaming: true,
          timestamp: Date.now(),
        });
        actions.setCurrentMessage(msgId);
        actions.setPhase("writing");
      }
      break;
    }

    case "message_update": {
      const msgId = actions.getCurrentMessageId?.();
      if (!msgId) break;

      const ame = event.assistantMessageEvent;
      if (ame.type === "text_delta") {
        batcher.append(msgId, ame.delta);
      }
      break;
    }

    case "message_end": {
      const msgId = actions.getCurrentMessageId?.();
      if (msgId) {
        actions.finalizeMessage(msgId);
        actions.clearCurrentMessage();
      }
      break;
    }

    case "tool_execution_start": {
      const msgId = actions.getCurrentMessageId?.();
      if (msgId) {
        actions.addToolCall(
          msgId,
          event.toolCallId,
          event.toolName,
          event.args,
        );
      }
      break;
    }

    case "tool_execution_end": {
      const msgId = actions.getCurrentMessageId?.();
      if (msgId) {
        const resultText =
          typeof event.result === "object" && event.result !== null
            ? JSON.stringify(event.result)
            : String(event.result);
        actions.completeToolCall(msgId, event.toolCallId, resultText, event.isError);
      }
      break;
    }

    case "turn_end":
      actions.setPhase("idle");
      break;

    case "turn_start":
      actions.setPhase("thinking");
      break;

    case "agent_end":
      actions.setPhase("idle");
      actions.clearCurrentMessage();
      actions.clearCurrentTool();
      break;

    case "abort":
      actions.setPhase("idle");
      actions.clearCurrentMessage();
      actions.clearCurrentTool();
      break;
  }
}
```

**Important:** The reducer needs `getCurrentMessageId` on the actions interface. Add it to `SessionActions` in `session-store.ts`:

Add to the `SessionActions` interface:

```typescript
getCurrentMessageId: () => string | null;
```

Add to the actions implementation:

```typescript
getCurrentMessageId() {
  return store.streaming.currentMessageId;
},
```

**Step 4: Run test to verify it passes**

```bash
bun test apps/app/src/stores/__tests__/event-reducer.test.ts
```
Expected: PASS

**Step 5: Commit**

```bash
git add apps/app/src/stores/event-reducer.ts apps/app/src/stores/__tests__/event-reducer.test.ts apps/app/src/stores/session-store.ts
git commit -m "feat(app): add event reducer mapping AgentHarnessEvents to store mutations"
```

---

## Task 8: Frontend — Terminal store factory

**Files:**
- Create: `apps/app/src/stores/terminal-store.ts`
- Test: `apps/app/src/stores/__tests__/terminal-store.test.ts`

**Step 1: Write the failing test**

```typescript
import { createRoot } from "solid-js";
import { describe, expect, it } from "bun:test";
import { createTerminalStore } from "../terminal-store.ts";

describe("terminal store", () => {
  it("appendData accumulates buffer", () =>
    createRoot((dispose) => {
      const term = createTerminalStore("t1");
      expect(term.store.buffer).toBe("");

      term.appendData("hello ");
      term.appendData("world");
      expect(term.store.buffer).toBe("hello world");

      dispose();
    }));

  it("setExit marks the terminal as exited", () =>
    createRoot((dispose) => {
      const term = createTerminalStore("t1");
      expect(term.store.exitCode).toBeNull();

      term.setExit(0);
      expect(term.store.exitCode).toBe(0);

      dispose();
    }));
});
```

**Step 2: Run test, verify fail, implement, verify pass**

Create `apps/app/src/stores/terminal-store.ts`:

```typescript
import { createStore } from "solid-js/store";

export interface TerminalStoreData {
  buffer: string;
  exitCode: number | null;
  cols: number;
  rows: number;
}

export interface TerminalStore {
  store: TerminalStoreData;
  appendData: (data: string) => void;
  setExit: (code: number) => void;
  resize: (cols: number, rows: number) => void;
  reset: () => void;
}

export function createTerminalStore(terminalId: string): TerminalStore {
  void terminalId;
  const [store, setStore] = createStore<TerminalStoreData>({
    buffer: "",
    exitCode: null,
    cols: 80,
    rows: 24,
  });

  return {
    store,
    appendData(data) {
      setStore("buffer", (prev) => prev + data);
    },
    setExit(code) {
      setStore("exitCode", code);
    },
    resize(cols, rows) {
      setStore("cols", cols);
      setStore("rows", rows);
    },
    reset() {
      setStore("buffer", "");
      setStore("exitCode", null);
    },
  };
}
```

Terminal registry (same pattern as session registry):

```typescript
// terminal-registry.ts
import { createTerminalStore, type TerminalStore } from "./terminal-store.ts";

const registry = new Map<string, TerminalStore>();

export function getTerminalStore(terminalId: string): TerminalStore {
  let store = registry.get(terminalId);
  if (!store) {
    store = createTerminalStore(terminalId);
    registry.set(terminalId, store);
  }
  return store;
}

export function disposeTerminalStore(terminalId: string): void {
  registry.delete(terminalId);
}
```

Run: `bun test apps/app/src/stores/__tests__/terminal-store.test.ts` → PASS

**Step 3: Commit**

```bash
git add apps/app/src/stores/terminal-store.ts apps/app/src/stores/terminal-registry.ts apps/app/src/stores/__tests__/terminal-store.test.ts
git commit -m "feat(app): add terminal store factory and registry"
```

---

## Task 9: Frontend — Server store

**Files:**
- Create: `apps/app/src/stores/server-store.ts`
- Test: `apps/app/src/stores/__tests__/server-store.test.ts`

**Step 1: Write the failing test**

```typescript
import { createRoot } from "solid-js";
import { describe, expect, it } from "bun:test";
import { createServerStore } from "../server-store.ts";

describe("server store", () => {
  it("setProjects populates projects and order", () =>
    createRoot((dispose) => {
      const { store, actions } = createServerStore();

      actions.setProjects([
        { id: "p1", name: "Project 1", cwd: "/tmp/p1", createdAt: 1, updatedAt: 1 },
        { id: "p2", name: "Project 2", cwd: "/tmp/p2", createdAt: 2, updatedAt: 2 },
      ]);

      expect(Object.keys(store.projects)).toHaveLength(2);
      expect(store.projects.p1.name).toBe("Project 1");
      expect(store.projectOrder).toEqual(["p1", "p2"]);

      dispose();
    }));

  it("setActiveProject updates activeProjectId", () =>
    createRoot((dispose) => {
      const { store, actions } = createServerStore();
      actions.setActiveProject("p1");
      expect(store.activeProjectId).toBe("p1");
      dispose();
    }));

  it("setSessions populates sessions for a project", () =>
    createRoot((dispose) => {
      const { store, actions } = createServerStore();

      actions.setSessions([
        { id: "s1", projectId: "p1", title: "Session 1", modelId: "gpt-4", thinkingLevel: "off", createdAt: 1, updatedAt: 1 },
      ]);

      expect(store.sessions.s1).toBeDefined();
      expect(store.sessions.s1.title).toBe("Session 1");

      dispose();
    }));

  it("setConnectionStatus updates connection", () =>
    createRoot((dispose) => {
      const { store, actions } = createServerStore();
      actions.setConnectionStatus("open");
      expect(store.connection.status).toBe("open");
      dispose();
    }));

  it("addSession adds a single session", () =>
    createRoot((dispose) => {
      const { store, actions } = createServerStore();
      actions.addSession({
        id: "s1", projectId: "p1", title: null, modelId: "gpt-4",
        thinkingLevel: "off", createdAt: 1, updatedAt: 1,
      });
      expect(store.sessions.s1).toBeDefined();
      dispose();
    }));

  it("setActiveSession updates activeSessionId", () =>
    createRoot((dispose) => {
      const { store, actions } = createServerStore();
      actions.setActiveSession("s1");
      expect(store.activeSessionId).toBe("s1");
      dispose();
    }));
});
```

**Step 2: Run test, verify fail, implement, verify pass**

Create `apps/app/src/stores/server-store.ts`:

```typescript
import { createStore } from "solid-js/store";

export interface Project {
  id: string;
  name: string;
  cwd: string;
  createdAt: number;
  updatedAt: number;
}

export interface SessionMeta {
  id: string;
  projectId: string;
  title: string | null;
  modelId: string;
  thinkingLevel: string;
  createdAt: number;
  updatedAt: number;
}

export interface ServerStoreData {
  connection: {
    status: "connecting" | "open" | "closed";
  };
  projects: Record<string, Project>;
  projectOrder: string[];
  activeProjectId: string | null;
  sessions: Record<string, SessionMeta>;
  sessionOrder: string[];
  activeSessionId: string | null;
}

export interface ServerActions {
  setConnectionStatus: (status: ServerStoreData["connection"]["status"]) => void;
  setProjects: (projects: Project[]) => void;
  setActiveProject: (projectId: string) => void;
  setSessions: (sessions: SessionMeta[]) => void;
  addSession: (session: SessionMeta) => void;
  setActiveSession: (sessionId: string) => void;
  updateSession: (sessionId: string, patch: Partial<SessionMeta>) => void;
  removeSession: (sessionId: string) => void;
}

export interface ServerStore {
  store: ServerStoreData;
  actions: ServerActions;
}

export function createServerStore(): ServerStore {
  const [store, setStore] = createStore<ServerStoreData>({
    connection: { status: "connecting" },
    projects: {},
    projectOrder: [],
    activeProjectId: null,
    sessions: {},
    sessionOrder: [],
    activeSessionId: null,
  });

  const actions: ServerActions = {
    setConnectionStatus(status) {
      setStore("connection", "status", status);
    },

    setProjects(projects) {
      setStore("projects", {});
      for (const p of projects) {
        setStore("projects", p.id, p);
      }
      setStore("projectOrder", projects.map((p) => p.id));
    },

    setActiveProject(projectId) {
      setStore("activeProjectId", projectId);
    },

    setSessions(sessions) {
      setStore("sessions", {});
      for (const s of sessions) {
        setStore("sessions", s.id, s);
      }
      setStore("sessionOrder", sessions.map((s) => s.id));
    },

    addSession(session) {
      setStore("sessions", session.id, session);
      setStore("sessionOrder", (prev) => [...prev, session.id]);
    },

    setActiveSession(sessionId) {
      setStore("activeSessionId", sessionId);
    },

    updateSession(sessionId, patch) {
      setStore("sessions", sessionId, (prev) => ({ ...prev, ...patch }));
    },

    removeSession(sessionId) {
      setStore("sessions", (prev) => {
        const next = { ...prev };
        delete next[sessionId];
        return next;
      });
      setStore("sessionOrder", (prev) => prev.filter((id) => id !== sessionId));
    },
  };

  return { store, actions };
}

let singleton: ServerStore | null = null;

export function getServerStore(): ServerStore {
  if (!singleton) {
    singleton = createServerStore();
  }
  return singleton;
}
```

Run: `bun test apps/app/src/stores/__tests__/server-store.test.ts` → PASS

**Step 3: Commit**

```bash
git add apps/app/src/stores/server-store.ts apps/app/src/stores/__tests__/server-store.test.ts
git commit -m "feat(app): add top-level server store for projects, sessions, connection"
```

---

## Task 10: Frontend — WS client

**Files:**
- Create: `apps/app/src/stores/ws-client.ts`
- Test: `apps/app/src/stores/__tests__/ws-client.test.ts`

**Step 1: Write the failing test**

```typescript
import { createRoot } from "solid-js";
import { describe, expect, it, mock } from "bun:test";
import { createWsClient } from "../ws-client.ts";
import { getServerStore } from "../server-store.ts";
import { getSessionStore, disposeSessionStore } from "../session-registry.ts";

// Minimal mock WebSocket
class MockWebSocket {
  static instances: MockWebSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  sent: string[] = [];
  readyState = 0;

  constructor(public url: string) {
    MockWebSocket.instances.push(this);
    setTimeout(() => {
      this.readyState = 1;
      this.onopen?.();
    }, 0);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = 3;
    this.onclose?.();
  }

  emit(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }
}

describe("WS client", () => {
  it("sends welcome frame and sets connection to open", async () => {
    MockWebSocket.instances = [];

    await new Promise<void>((resolve) =>
      createRoot(async (dispose) => {
        const server = getServerStore();
        const ws = createWsClient("ws://test", MockWebSocket as never);

        await new Promise((r) => setTimeout(r, 10));

        expect(MockWebSocket.instances).toHaveLength(1);
        const mockWs = MockWebSocket.instances[0]!;

        mockWs.emit({ type: "welcome", version: "1.0.0", cwd: "/tmp" });
        expect(server.store.connection.status).toBe("open");

        ws.disconnect();
        dispose();
        resolve();
      }),
    );
  });

  it("dispatches event frames to session store", async () => {
    MockWebSocket.instances = [];

    await new Promise<void>((resolve) =>
      createRoot(async (dispose) => {
        const ws = createWsClient("ws://test", MockWebSocket as never);

        await new Promise((r) => setTimeout(r, 10));
        const mockWs = MockWebSocket.instances[0]!;

        mockWs.emit({
          type: "event",
          sessionId: "s-test",
          event: { type: "agent_start" },
        });

        const session = getSessionStore("s-test");
        expect(session.store.streaming.phase).toBe("thinking");

        disposeSessionStore("s-test");
        ws.disconnect();
        dispose();
        resolve();
      }),
    );
  });

  it("sendPrompt sends a prompt frame", async () => {
    MockWebSocket.instances = [];

    await new Promise<void>((resolve) =>
      createRoot(async (dispose) => {
        const ws = createWsClient("ws://test", MockWebSocket as never);

        await new Promise((r) => setTimeout(r, 10));
        const mockWs = MockWebSocket.instances[0]!;

        ws.send({ type: "prompt", sessionId: "s1", message: "hello" });

        expect(mockWs.sent).toHaveLength(1);
        const parsed = JSON.parse(mockWs.sent[0]!);
        expect(parsed).toEqual({ type: "prompt", sessionId: "s1", message: "hello" });

        ws.disconnect();
        dispose();
        resolve();
      }),
    );
  });
});
```

**Step 2: Run test, verify fail, implement, verify pass**

Create `apps/app/src/stores/ws-client.ts`:

```typescript
import type { WsIn, WsOut } from "@sakti-code/server/ws";
import type { AgentHarnessEvent } from "@sakti-code/agent";
import { getServerStore } from "./server-store.ts";
import { getSessionStore } from "./session-registry.ts";
import { getTerminalStore } from "./terminal-registry.ts";
import { dispatchEvent } from "./event-reducer.ts";
import { createTokenBatcher } from "./token-batcher.ts";

const RECONNECT_DELAY_MS = 2000;

export interface WsClient {
  send: (msg: WsIn) => void;
  disconnect: () => void;
}

export function createWsClient(
  url: string,
  WebSocketCtor: typeof WebSocket = WebSocket,
): WsClient {
  const server = getServerStore();
  let ws: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let shouldReconnect = true;

  const batchers = new Map<string, ReturnType<typeof createTokenBatcher>>();

  function getBatcher(sessionId: string) {
    let b = batchers.get(sessionId);
    if (!b) {
      const session = getSessionStore(sessionId);
      b = createTokenBatcher((msgId, text) => {
        session.actions.appendToken(msgId, text);
      });
      batchers.set(sessionId, b);
    }
    return b;
  }

  function handleFrame(data: WsOut): void {
    switch (data.type) {
      case "welcome":
        server.actions.setConnectionStatus("open");
        break;

      case "event": {
        const session = getSessionStore(data.sessionId);
        const batcher = getBatcher(data.sessionId);
        dispatchEvent(session.actions, batcher, data.event as AgentHarnessEvent);
        break;
      }

      case "error": {
        const session = getSessionStore(data.sessionId);
        const msgId = session.store.streaming.currentMessageId;
        if (msgId) {
          session.actions.setError(msgId, data.error);
        }
        break;
      }

      case "push": {
        if (data.channel === "terminal.data") {
          const d = data.data as { terminalId: string; data: string };
          getTerminalStore(d.terminalId).appendData(d.data);
        } else if (data.channel === "terminal.exit") {
          const d = data.data as { terminalId: string; exitCode: number };
          getTerminalStore(d.terminalId).setExit(d.exitCode);
        }
        break;
      }
    }
  }

  function connect(): void {
    server.actions.setConnectionStatus("connecting");
    ws = new WebSocketCtor(url);

    ws.onopen = () => {
      server.actions.setConnectionStatus("open");
    };

    ws.onmessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data) as WsOut;
        handleFrame(data);
      } catch {
        // ignore malformed frames
      }
    };

    ws.onclose = () => {
      server.actions.setConnectionStatus("closed");
      ws = null;
      if (shouldReconnect) {
        reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
      }
    };
  }

  connect();

  return {
    send(msg: WsIn) {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg));
      }
    },
    disconnect() {
      shouldReconnect = false;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }
      ws?.close();
    },
  };
}
```

Run: `bun test apps/app/src/stores/__tests__/ws-client.test.ts` → PASS

**Step 3: Commit**

```bash
git add apps/app/src/stores/ws-client.ts apps/app/src/stores/__tests__/ws-client.test.ts
git commit -m "feat(app): add WS client with reconnect, frame dispatch, session routing"
```

---

## Task 11: Frontend — REST and agent actions

**Files:**
- Create: `apps/app/src/stores/actions.ts`
- Test: `apps/app/src/stores/__tests__/actions.test.ts`

**Step 1: Write the failing test**

```typescript
import { createRoot } from "solid-js";
import { describe, expect, it, mock } from "bun:test";
import { createActions } from "../actions.ts";
import { getServerStore } from "../server-store.ts";
import { getSessionStore, disposeSessionStore } from "../session-registry.ts";
import type { WsClient } from "../ws-client.ts";

function makeMockWs(): WsClient {
  return {
    send: mock(() => {}),
    disconnect: mock(() => {}),
  };
}

describe("actions", () => {
  it("loadProjects fetches and populates store", async () => {
    await new Promise<void>((resolve) =>
      createRoot(async (dispose) => {
        const server = getServerStore();
        const mockApi = {
          projects: {
            get: mock(() =>
              Promise.resolve({
                data: [
                  { id: "p1", name: "Proj", cwd: "/tmp", createdAt: 1, updatedAt: 1 },
                ],
                error: null,
              }),
            ),
          },
        };
        const actions = createActions(mockApi as never, makeMockWs());

        await actions.loadProjects();

        expect(server.store.projects.p1).toBeDefined();
        expect(server.store.projectOrder).toEqual(["p1"]);

        dispose();
        resolve();
      }),
    );
  });

  it("loadSessions fetches sessions for a project", async () => {
    await new Promise<void>((resolve) =>
      createRoot(async (dispose) => {
        const server = getServerStore();
        const mockApi = {
          sessions: {
            get: mock(() =>
              Promise.resolve({
                data: [
                  { id: "s1", projectId: "p1", title: "Sess", modelId: "gpt-4", thinkingLevel: "off", createdAt: 1, updatedAt: 1 },
                ],
                error: null,
              }),
            ),
          },
        };
        const actions = createActions(mockApi as never, makeMockWs());

        await actions.loadSessions("p1");

        expect(server.store.sessions.s1).toBeDefined();

        dispose();
        resolve();
      }),
    );
  });

  it("sendPrompt inserts user message optimistically and sends via WS", async () => {
    await new Promise<void>((resolve) =>
      createRoot(async (dispose) => {
        const ws = makeMockWs();
        const mockApi = {} as never;
        const actions = createActions(mockApi, ws);

        actions.sendPrompt("s1", "hello world");

        const session = getSessionStore("s1");
        expect(session.store.messageOrder).toHaveLength(1);
        expect(session.store.messages[session.store.messageOrder[0]!].role).toBe("user");
        expect(session.store.messages[session.store.messageOrder[0]!].content).toBe("hello world");

        expect(ws.send).toHaveBeenCalledWith({
          type: "prompt",
          sessionId: "s1",
          message: "hello world",
        });

        disposeSessionStore("s1");
        dispose();
        resolve();
      }),
    );
  });

  it("abortRun sends abort via WS", async () => {
    await new Promise<void>((resolve) =>
      createRoot(async (dispose) => {
        const ws = makeMockWs();
        const actions = createActions({} as never, ws);

        actions.abortRun("s1");

        expect(ws.send).toHaveBeenCalledWith({
          type: "abort",
          sessionId: "s1",
        });

        dispose();
        resolve();
      }),
    );
  });
});
```

**Step 2: Run test, verify fail, implement, verify pass**

Create `apps/app/src/stores/actions.ts`:

```typescript
import type { App } from "@sakti-code/server";
import type { WsClient } from "./ws-client.ts";
import { getServerStore, type Project, type SessionMeta } from "./server-store.ts";
import { getSessionStore } from "./session-registry.ts";
import { agentMessageToUI, type UIMessage } from "./types.ts";
import type { AgentMessage } from "@sakti-code/agent";

type ApiClient = ReturnType<typeof import("@elysiajs/eden").treaty<App>>;

export interface Actions {
  loadProjects: () => Promise<void>;
  loadSessions: (projectId: string) => Promise<void>;
  createSession: (projectId: string, modelId: string, title?: string) => Promise<SessionMeta | undefined>;
  loadMessages: (sessionId: string) => Promise<void>;
  sendPrompt: (sessionId: string, text: string) => void;
  abortRun: (sessionId: string) => void;
  steerRun: (sessionId: string, text: string) => void;
  followUpRun: (sessionId: string, text: string) => void;
}

export function createActions(api: ApiClient, ws: WsClient): Actions {
  const server = getServerStore();

  return {
    async loadProjects() {
      const { data, error } = await api.projects.get();
      if (error || !data) return;
      server.actions.setProjects(data as Project[]);
      if (data.length > 0 && !server.store.activeProjectId) {
        const first = data[0] as Project;
        server.actions.setActiveProject(first.id);
      }
    },

    async loadSessions(projectId) {
      const { data, error } = await api.sessions.get({ query: { projectId } });
      if (error || !data) return;
      server.actions.setSessions(data as SessionMeta[]);
    },

    async createSession(projectId, modelId, title) {
      const { data, error } = await api.sessions.post({
        body: {
          projectId,
          modelId,
          ...(title !== undefined ? { title } : {}),
        },
      });
      if (error || !data) return;
      const session = data as SessionMeta;
      server.actions.addSession(session);
      return session;
    },

    async loadMessages(sessionId) {
      const { data, error } = await api.sessions({ id: sessionId }).messages.get();
      if (error || !data) return;
      const messages = data as AgentMessage[];
      const uiMessages = messages.map(agentMessageToUI);
      const session = getSessionStore(sessionId);
      session.actions.loadMessages(uiMessages);
    },

    sendPrompt(sessionId, text) {
      const session = getSessionStore(sessionId);

      const userMsg: UIMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: text,
        parts: [{ type: "text", text }],
        isStreaming: false,
        timestamp: Date.now(),
      };
      session.actions.addMessage(userMsg);
      session.actions.setPhase("thinking");

      ws.send({ type: "prompt", sessionId, message: text });
    },

    abortRun(sessionId) {
      ws.send({ type: "abort", sessionId });
    },

    steerRun(sessionId, text) {
      ws.send({ type: "steer", sessionId, message: text });
    },

    followUpRun(sessionId, text) {
      ws.send({ type: "followUp", sessionId, message: text });
    },
  };
}
```

Run: `bun test apps/app/src/stores/__tests__/actions.test.ts` → PASS

**Step 3: Commit**

```bash
git add apps/app/src/stores/actions.ts apps/app/src/stores/__tests__/actions.test.ts
git commit -m "feat(app): add REST and agent actions with optimistic prompt insertion"
```

---

## Task 12: Frontend — Context provider and UI signals

**Files:**
- Create: `apps/app/src/stores/store-context.tsx`
- Create: `apps/app/src/stores/ui-signals.ts`

**Step 1: Create UI signals**

Create `apps/app/src/stores/ui-signals.ts`:

```typescript
import { createSignal } from "solid-js";

export const [sidebarOpen, setSidebarOpen] = createSignal(true);
export const [activeView, setActiveView] = createSignal<"chat" | "terminal" | "git">("chat");
```

**Step 2: Create context provider**

Create `apps/app/src/stores/store-context.tsx`:

```typescript
import { createContext, useContext, onCleanup, type ParentComponent } from "solid-js";
import { treaty } from "@elysiajs/eden";
import type { App } from "@sakti-code/server";
import { createWsClient, type WsClient } from "./ws-client.ts";
import { createActions, type Actions } from "./actions.ts";
import { getServerStore, type ServerStore } from "./server-store.ts";
import { getSessionStore } from "./session-registry.ts";

const api = treaty<App>("http://localhost:3001");
const WS_URL = "ws://localhost:3001/ws";

interface StoreContextValue {
  server: ServerStore;
  ws: WsClient;
  actions: Actions;
  api: typeof api;
  getSession: typeof getSessionStore;
}

const StoreContext = createContext<StoreContextValue>();

export const StoreProvider: ParentComponent = (props) => {
  const server = getServerStore();
  const ws = createWsClient(WS_URL);
  const actions = createActions(api, ws);

  onCleanup(() => {
    ws.disconnect();
  });

  return (
    <StoreContext.Provider value={{ server, ws, actions, api, getSession: getSessionStore }}>
      {props.children}
    </StoreContext.Provider>
  );
};

export function useStore(): StoreContextValue {
  const ctx = useContext(StoreContext);
  if (!ctx) {
    throw new Error("useStore must be used within StoreProvider");
  }
  return ctx;
}
```

**Step 3: Commit**

```bash
git add apps/app/src/stores/store-context.tsx apps/app/src/stores/ui-signals.ts
git commit -m "feat(app): add StoreProvider context wiring all stores and actions"
```

---

## Task 13: Frontend — Minimal smoke view

**Files:**
- Modify: `apps/app/src/mainview/app.tsx` (replace counter demo with minimal chat)
- Modify: `apps/app/src/mainview/main.tsx` (wrap in StoreProvider)
- Modify: `apps/app/src/mainview/app.css` (basic chat styling)

**Step 1: Update main.tsx**

```typescript
import "./app.css";
import { render } from "solid-js/web";
import App from "./app.tsx";
import { StoreProvider } from "../stores/store-context.tsx";

render(
  () => (
    <StoreProvider>
      <App />
    </StoreProvider>
  ),
  document.getElementById("app") ?? undefined,
);
```

**Step 2: Replace app.tsx with minimal chat view**

```typescript
import { createEffect, For, Show, createMemo } from "solid-js";
import { useStore } from "../stores/store-context.tsx";
import { createSignal } from "solid-js";

export default function App() {
  const { server, actions, getSession } = useStore();
  const [input, setInput] = createSignal("");

  const activeSessionId = () => server.store.activeSessionId;
  const session = createMemo(() => {
    const id = activeSessionId();
    if (!id) return null;
    return getSession(id);
  });

  createEffect(() => {
    actions.loadProjects();
  });

  const handleSubmit = (e: Event) => {
    e.preventDefault();
    const text = input().trim();
    const sid = activeSessionId();
    if (!text || !sid) return;
    actions.sendPrompt(sid, text);
    setInput("");
  };

  return (
    <main class="app">
      <aside class="sidebar">
        <h2>Sessions</h2>
        <For each={server.store.sessionOrder}>
          {(id) => (
            <button
              class="session-item"
              classList={{ active: id === activeSessionId() }}
              onClick={() => {
                server.actions.setActiveSession(id);
                actions.loadMessages(id);
              }}
            >
              {server.store.sessions[id]?.title ?? "Untitled"}
            </button>
          )}
        </For>
      </aside>

      <section class="chat">
        <Show when={session()} fallback={<p>Select a session</p>}>
          {(s) => (
            <>
              <div class="messages">
                <For each={s().store.messageOrder}>
                  {(msgId) => {
                    const msg = () => s().store.messages[msgId];
                    return (
                      <div class="message" data-role={msg()?.role}>
                        <span class="role">{msg()?.role}</span>
                        <pre class="content">{msg()?.content}</pre>
                        <Show when={msg()?.error}>
                          <span class="error">{msg()?.error}</span>
                        </Show>
                      </div>
                    );
                  }}
                </For>
              </div>
              <Show when={s().store.streaming.phase !== "idle"}>
                <div class="streaming-indicator">
                  {s().store.streaming.phase}
                  {s().store.streaming.currentToolName
                    ? `: ${s().store.streaming.currentToolName}`
                    : ""}
                </div>
              </Show>
              <form class="input-bar" onSubmit={handleSubmit}>
                <input
                  type="text"
                  value={input()}
                  onInput={(e) => setInput(e.currentTarget.value)}
                  placeholder="Send a message..."
                />
                <button type="submit">Send</button>
              </form>
            </>
          )}
        </Show>
      </section>
    </main>
  );
}
```

**Step 3: Add minimal CSS**

Replace `apps/app/src/mainview/app.css` with:

```css
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: system-ui, sans-serif; font-size: 14px; }
.app { display: flex; height: 100vh; }
.sidebar { width: 240px; border-right: 1px solid #333; padding: 8px; overflow-y: auto; }
.sidebar h2 { font-size: 12px; text-transform: uppercase; color: #888; margin-bottom: 8px; }
.session-item { display: block; width: 100%; text-align: left; padding: 8px; margin-bottom: 4px; background: none; border: none; border-radius: 4px; cursor: pointer; color: inherit; }
.session-item:hover { background: #1a1a2e; }
.session-item.active { background: #2a2a4e; }
.chat { flex: 1; display: flex; flex-direction: column; }
.messages { flex: 1; overflow-y: auto; padding: 16px; }
.message { margin-bottom: 16px; }
.message[data-role="user"] .role { color: #4af; }
.message[data-role="assistant"] .role { color: #fa4; }
.message .role { font-size: 11px; text-transform: uppercase; font-weight: bold; }
.message .content { margin-top: 4px; white-space: pre-wrap; word-break: break-word; font-family: inherit; }
.message .error { color: #f44; display: block; margin-top: 4px; }
.streaming-indicator { padding: 8px 16px; color: #888; font-style: italic; }
.input-bar { display: flex; padding: 8px; border-top: 1px solid #333; }
.input-bar input { flex: 1; padding: 8px; background: #1a1a2e; border: 1px solid #333; border-radius: 4px; color: inherit; }
.input-bar button { padding: 8px 16px; margin-left: 8px; background: #4a6; border: none; border-radius: 4px; cursor: pointer; color: #000; font-weight: bold; }
```

**Step 4: Verify it builds**

```bash
cd apps/app && bun run build
```
Expected: builds without errors.

**Step 5: Verify end-to-end**

Start the server in one terminal:
```bash
bun dev:server
```

Start the app in another:
```bash
cd apps/app && bun run dev
```

Expected: sidebar shows sessions, selecting one loads messages, typing a prompt and hitting Send shows the user message immediately and assistant tokens stream in.

**Step 6: Commit**

```bash
git add apps/app/src/mainview/
git commit -m "feat(app): minimal chat view with session sidebar and live streaming"
```

---

## Verification

After all tasks:

```bash
# Run all frontend tests
cd apps/app && bun test

# Typecheck frontend
cd apps/app && bun run typecheck

# Run server tests (verify WS type exports didn't break anything)
bun test

# Full workspace typecheck
bun typecheck
```

All should pass clean.

## File tree summary

```
apps/app/src/
├── stores/
│   ├── types.ts                      # UIMessage, StreamState, agentMessageToUI
│   ├── token-batcher.ts              # Microtask delta accumulator
│   ├── session-store.ts              # Per-session createStore factory
│   ├── session-registry.ts           # Map<sessionId, SessionStore>
│   ├── event-reducer.ts              # AgentHarnessEvent → store mutations
│   ├── terminal-store.ts             # Per-terminal createStore factory
│   ├── terminal-registry.ts          # Map<terminalId, TerminalStore>
│   ├── server-store.ts               # Top-level projects/sessions/settings
│   ├── ws-client.ts                  # WS connection, reconnect, frame dispatch
│   ├── actions.ts                    # REST + agent actions
│   ├── store-context.tsx             # SolidJS context provider
│   ├── ui-signals.ts                 # Sidebar, active view signals
│   └── __tests__/
│       ├── types.test.ts
│       ├── token-batcher.test.ts
│       ├── session-store.test.ts
│       ├── session-registry.test.ts
│       ├── event-reducer.test.ts
│       ├── terminal-store.test.ts
│       ├── server-store.test.ts
│       ├── ws-client.test.ts
│       └── actions.test.ts
├── lib/
│   └── api.ts                        # Eden treaty client (exists)
└── mainview/
    ├── app.tsx                       # Minimal chat view
    ├── app.css                       # Chat styling
    └── main.tsx                      # Entry, wraps in StoreProvider
```
