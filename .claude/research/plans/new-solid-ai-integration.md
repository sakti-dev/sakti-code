# Solid.js Integration Plan: Vercel AI SDK

**Version**: 2.0.0
**Status**: Implementation Plan
**Updated**: 2025-01-28

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Technology Stack](#technology-stack)
3. [Critical Design Principles](#critical-design-principles)
4. [The AI SDK Data Stream Protocol](#the-ai-sdk-data-stream-protocol)
5. [Implementation Phases](#implementation-phases)
6. [File Structure](#file-structure)
7. [Testing Strategy](#testing-strategy)
8. [Deployment Considerations](#deployment-considerations)

---

## Architecture Overview

This plan integrates **Solid.js** with **Vercel AI SDK** using the **native UIMessage stream protocol**. The architecture follows AI SDK best practices for maximum compatibility and performance.

### System Components

```
┌─────────────────────────────────────────────────────────────────┐
│                        Solid.js UI Layer                         │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ MessageList  │  │ ToolStatus   │  │ InputArea    │          │
│  │  Renders     │  │  Component   │  │  Component   │          │
│  │  parts[]     │  │              │  │              │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
├─────────────────────────────────────────────────────────────────┤
│                      useChat() Hook                              │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  - createStore for O(1) updates                          │  │
│  │  - produce() for streaming deltas                        │  │
│  │  - reconcile() for history sync                          │  │
│  │  - Parses UIMessage stream protocol                      │  │
│  └──────────────────────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────────────────┤
│                   Server: UIMessage Stream                      │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  - createUIMessageStream()                              │  │
│  │  - writer.write() custom data parts                     │  │
│  │  - writer.merge() model output                          │  │
│  │  - toUIMessageStreamResponse()                          │  │
│  └──────────────────────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────────────────┤
│                   Vercel AI SDK                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  - streamText() with tool streaming                      │  │
│  │  - tool() definitions                                    │  │
│  │  - Provider adapters (OpenAI, Anthropic, etc.)           │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Technology Stack

| Component        | Technology    | Version | Purpose                                        |
| ---------------- | ------------- | ------- | ---------------------------------------------- |
| **UI Framework** | Solid.js      | ^1.9.0  | Reactive UI with fine-grained reactivity       |
| **AI SDK**       | Vercel AI SDK | ^6.0.54 | LLM abstraction with UIMessage stream protocol |
| **Type Safety**  | TypeScript    | ^5.6.0  | End-to-end type safety                         |
| **Validation**   | Zod           | ^3.24.0 | Schema validation for tool inputs/outputs      |
| **HTTP Client**  | Native Fetch  | -       | SSE streaming from server                      |
| **Sanitization** | DOMPurify     | ^3.0.0  | XSS prevention in Markdown rendering           |

---

## Critical Design Principles

### 1. Use AI SDK's Native Protocol (No Custom SSE Events)

**❌ DON'T** - Create custom event types:

```typescript
// WRONG - Reinventing the wheel
event: state;
event: tool - call - delta;
event: custom - event;
```

**✅ DO** - Use AI SDK's UIMessage stream:

```typescript
// Server: Write custom data as data-* parts
writer.write({
  type: "data-rlm-state",
  id: "rlm",
  data: { phase: "analyzing", step: "scanning" },
});

// Merge model output (includes tools automatically)
writer.merge(result.toUIMessageStream());
```

**Why**: The AI SDK already standardizes:

- `text-delta` - Text chunks
- `tool-input-start/delta/end` - Tool streaming
- `tool-call/result` - Tool lifecycle
- Custom `data-*` parts - Your custom state

### 2. Use createStore + produce for High-Frequency Updates

**❌ DON'T** - Use signals for message arrays:

```typescript
// PERFORMANCE DISASTER - O(N) on every token
const [messages, setMessages] = createSignal<UIMessage[]>([]);

setMessages(prev => [...prev, newChunk]); // Full array scan
```

**Why this fails**: At 50-100 tokens/second, this triggers 50-100 full array reconciliations per second. Solid's `<For>` must re-scan the entire list each time, causing main-thread blocking.

**✅ DO** - Use store with produce for O(1) updates:

```typescript
// OPTIMAL - O(1) per token
const [store, setStore] = createStore<{
  messages: UIMessage[];
  status: "idle" | "streaming" | "error";
  error: Error | null;
}>({
  messages: [],
  status: "idle",
  error: null,
});

// Update only the specific message being streamed
setStore(
  "messages",
  m => m.id === currentMessageId,
  produce(message => {
    // Find the text part and append delta
    const textPart = message.parts.find(p => p.type === "text");
    if (textPart && textPart.type === "text") {
      textPart.text += delta;
    }
  })
);
```

### 3. Render message.parts, Not message.content

**❌ DON'T** - Render top-level content:

```typescript
// WRONG - Misses tools, sources, custom data
<div>{message.content}</div>
```

**✅ DO** - Render parts array:

```typescript
// CORRECT - Handles all message types
<For each={message.parts}>
  {part => (
    <Switch fallback={<div>Unknown part type</div>}>
      <Match when={part.type === 'text'}>
        <TextPart part={part} />
      </Match>
      <Match when={part.type === 'tool-call'}>
        <ToolCallPart part={part} />
      </Match>
      <Match when={part.type === 'tool-result'}>
        <ToolResultPart part={part} />
      </Match>
      <Match when={part.type === 'data-rlm-state'}>
        <RLMStatePart part={part} />
      </Match>
    </Switch>
  )}
</For>
```

**Why**: The `parts` array contains:

- Text parts
- Tool call/result parts
- Custom data parts (XState state, progress)
- Reasoning parts
- Source parts

### 4. Sanitize Symbols Only at Network Boundary

**❌ DON'T** - Clone on every update:

```typescript
// EXPENSIVE - Unnecessary overhead
pushMessage(message: UIMessage) {
  this.#setStore("messages", idx, structuredClone(message))
}
```

**✅ DO** - Sanitize only when sending to server:

```typescript
// EFFICIENT - Sanitize at boundary only
async sendMessage(text: string) {
  const messages = unwrap(this.store.messages) // Remove proxies

  await fetch('/api/chat', {
    body: JSON.stringify({ messages })
  })
}
```

**Why**: `structuredClone` is expensive. Use Solid's `unwrap()` to remove proxies only when crossing the network boundary.

### 5. Fix Solid Primitive Usage

**❌ DON'T** - React-thinking in Solid:

```typescript
// WRONG - Solid has no dependency arrays
const client = createMemo(() => new ChatClient(), [apiUrl]);
client().sendMessage(); // Double function call
```

**✅ DO** - Idiomatic Solid:

```typescript
// CORRECT - Instantiate once
const client = new ChatClient({ apiUrl });
// OR make apiUrl reactive if needed
```

---

## The AI SDK Data Stream Protocol

Understanding the protocol is critical for correct implementation.

### Stream Part Types

| Type               | Identifier | Purpose             | Update Frequency       |
| ------------------ | ---------- | ------------------- | ---------------------- |
| `text-delta`       | `0:{text}` | Text chunk          | Very high (50-100/sec) |
| `tool-input-start` | `b:{json}` | Tool call begins    | Low                    |
| `tool-input-delta` | `b:{json}` | Tool args streaming | Medium                 |
| `tool-input-end`   | `b:{json}` | Tool args complete  | Low                    |
| `tool-call`        | `{json}`   | Tool execution      | Low                    |
| `tool-result`      | `{json}`   | Tool output         | Low                    |
| `data-*`           | `8:{json}` | Custom data         | Variable               |
| `finish`           | `d:{json}` | Turn complete       | Once                   |

### Server-Side Implementation

```typescript
// src/app/api/chat/route.ts
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  streamText,
  convertToModelMessages,
  type UIMessage,
} from "ai";

// Extend UIMessage for custom data types
type MyUIMessage = UIMessage<
  never,
  {
    "data-rlm-state": {
      value: unknown;
      phase?: string;
      step?: string;
      progress?: number;
    };
  }
>;

export async function POST(req: Request) {
  const { messages, goal }: { messages: MyUIMessage[]; goal: string } = await req.json();

  const stream = createUIMessageStream<MyUIMessage>({
    execute: async ({ writer }) => {
      // 1. Write custom state updates (e.g., XState snapshots)
      writer.write({
        type: "data-rlm-state",
        id: "rlm", // Stable ID = same part updates
        transient: true, // Don't persist to history
        data: {
          value: "analyzing",
          phase: "scan",
          step: "reading",
          progress: 0.25,
        },
      });

      // 2. Run model with tools
      const result = streamText({
        model: "anthropic/claude-sonnet-4.5",
        messages: await convertToModelMessages(messages),
        tools: {
          // Define tools with execute() for server-side execution
          searchDatabase: tool({
            description: "Search the database",
            parameters: z.object({
              query: z.string(),
            }),
            execute: async ({ query }) => {
              // Server-side execution
              return await db.search(query);
            },
          }),

          // Client-side tools omit execute()
          requestApproval: tool({
            description: "Request user approval",
            parameters: z.object({
              action: z.string(),
              reason: z.string(),
            }),
            // No execute() = client-side tool
          }),
        },
      });

      // 3. Merge model output (includes tool streaming)
      writer.merge(result.toUIMessageStream());

      // 4. Wait for completion
      await result.finished;
    },
  });

  // Sets header: x-vercel-ai-ui-message-stream: v1
  return createUIMessageStreamResponse({ stream });
}
```

### Critical Server Implementation Details

**1. Always use the helper response constructors:**

```typescript
// CORRECT
return createUIMessageStreamResponse({ stream });
// OR
return result.toDataStreamResponse();

// WRONG - Client won't parse correctly
return new Response(stream);
```

**2. Set the header if implementing custom streaming:**

```typescript
return new Response(stream, {
  headers: {
    "x-vercel-ai-ui-message-stream": "v1",
  },
});
```

**3. Use stable IDs for updateable data parts:**

```typescript
// CORRECT - Same part gets updated
writer.write({
  type: "data-rlm-state",
  id: "rlm", // Stable ID
  data: { progress: 0.5 },
});

writer.write({
  type: "data-rlm-state",
  id: "rlm", // Same ID = update
  data: { progress: 0.75 },
});
```

**4. Mark frequent updates as transient:**

```typescript
// PROGRESS UPDATES - Don't persist to history
writer.write({
  type: "data-rlm-state",
  id: "rlm",
  transient: true, // Not saved to chat history
  data: { progress: 0.5 },
});
```

---

## Implementation Phases

### Phase 1: Type Definitions

**File**: `src/types/ui-message.ts`

Define the extended UIMessage type with custom data parts.

```typescript
// src/types/ui-message.ts
import type { UIMessage } from "ai";

/**
 * Extended UI message with custom data parts
 */
export type ChatUIMessage = UIMessage<
  never, // No reasoning parts needed
  {
    "data-rlm-state": RLMStateData;
    "data-progress": ProgressData;
  }
>;

/**
 * RLM (Recursive Language Model) state from backend orchestrator
 */
export interface RLMStateData {
  value: unknown; // XState machine value
  phase?: string; // Current phase (analyze, design, build)
  step?: string; // Current step within phase
  progress?: number; // 0-1 progress indicator
}

/**
 * Progress updates for long-running operations
 */
export interface ProgressData {
  operation: string;
  current: number;
  total: number;
  message?: string;
}

/**
 * Chat state for Solid store
 */
export interface ChatState {
  messages: ChatUIMessage[];
  status: "idle" | "connecting" | "streaming" | "processing" | "done" | "error";
  error: Error | null;
  rlmState: RLMStateData | null; // Extracted for easy access
}
```

---

### Phase 2: Solid Store with produce and reconcile

**File**: `src/lib/chat/store.ts`

**Purpose**: High-performance state management using Solid stores.

```typescript
// src/lib/chat/store.ts
import { createStore, produce, reconcile, unwrap } from "solid-js/store";
import type { ChatUIMessage, ChatState, RLMStateData } from "../../types/ui-message";

/**
 * Create a chat store with optimized update patterns
 */
export function createChatStore(initialMessages: ChatUIMessage[] = []) {
  const [store, setStore] = createStore<ChatState>({
    messages: initialMessages,
    status: "idle",
    error: null,
    rlmState: null,
  });

  return {
    get: () => store,

    /**
     * Add a new message to the store
     * Uses structuredClone to break reference to incoming data
     */
    addMessage(message: ChatUIMessage) {
      setStore("messages", messages => [...messages, structuredClone(message)]);
    },

    /**
     * Update a specific message using produce for O(1) updates
     * Critical for streaming - doesn't trigger list reconciliation
     */
    updateMessage(messageId: string, updater: (message: ChatUIMessage) => void) {
      setStore("messages", m => m.id === messageId, produce(updater));
    },

    /**
     * Append text delta to a message's text part
     * O(1) operation - only updates the specific text part
     */
    appendTextDelta(messageId: string, delta: string) {
      setStore(
        "messages",
        m => m.id === messageId,
        produce(message => {
          const textPart = message.parts.find(p => p.type === "text");
          if (textPart && textPart.type === "text") {
            textPart.text += delta;
          }
        })
      );
    },

    /**
     * Update tool call state (for tool streaming)
     */
    updateToolCall(
      messageId: string,
      toolCallId: string,
      toolCallId: string,
      updater: (toolCall: ToolCallPart) => void
    ) {
      setStore(
        "messages",
        m => m.id === messageId,
        produce(message => {
          const toolCallPart = message.parts.find(
            p => p.type === "tool-call" && p.toolCallId === toolCallId
          );
          if (toolCallPart && toolCallPart.type === "tool-call") {
            updater(toolCallPart);
          }
        })
      );
    },

    /**
     * Update or add a data part
     * Uses stable ID for updates
     */
    updateDataPart(partType: string, partId: string, data: Record<string, unknown>) {
      setStore(
        "messages",
        m => m.parts.some(p => p.type === partType && p.id === partId),
        produce(message => {
          const existingPart = message.parts.find(p => p.type === partType && p.id === partId);
          if (existingPart && existingPart.type === "data") {
            // Update existing
            existingPart.data = data;
          } else {
            // Add new
            message.parts.push({
              type: "data",
              id: partId,
              data,
            });
          }
        })
      );
    },

    /**
     * Replace all messages (for history load/regenerate)
     * Uses reconcile for efficient diff-based update
     */
    setMessages(messages: ChatUIMessage[]) {
      setStore("messages", reconcile(messages, { key: "id" }));
    },

    /**
     * Set connection status
     */
    setStatus(status: ChatState["status"]) {
      setStore("status", status);
    },

    /**
     * Set error
     */
    setError(error: Error | null) {
      setStore("error", error);
    },

    /**
     * Update RLM state (extracted from data parts)
     */
    setRLMState(state: RLMStateData | null) {
      setStore("rlmState", state);
    },

    /**
     * Get messages ready for network transmission
     * Removes Solid proxies using unwrap
     */
    getMessagesForNetwork(): ChatUIMessage[] {
      return unwrap(store.messages);
    },
  };
}
```

---

### Phase 3: UIMessage Stream Parser

**File**: `src/lib/chat/stream-parser.ts`

**Purpose**: Parse AI SDK's UIMessage stream protocol.

```typescript
// src/lib/chat/stream-parser.ts
import type { ChatUIMessage, RLMStateData } from "../../types/ui-message";

export interface StreamCallbacks {
  onTextDelta: (messageId: string, delta: string) => void;
  onToolCallStart: (toolCall: ToolCallPart) => void;
  onToolCallDelta: (toolCallId: string, delta: string) => void;
  onToolCallEnd: (toolCallId: string) => void;
  onToolResult: (toolResult: ToolResultPart) => void;
  onDataPart: (type: string, id: string, data: unknown) => void;
  onError: (error: Error) => void;
  onComplete: () => void;
}

/**
 * Parse AI SDK UIMessage stream from SSE
 */
export async function parseUIMessageStream(
  response: Response,
  callbacks: StreamCallbacks
): Promise<void> {
  if (!response.body) {
    throw new Error("Response body is null");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      callbacks.onComplete();
      break;
    }

    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim() || !line.startsWith("data: ")) {
        continue;
      }

      const data = line.slice(6).trim();

      if (data === "[DONE]") {
        callbacks.onComplete();
        continue;
      }

      try {
        const part = JSON.parse(data);
        handleStreamPart(part, callbacks);
      } catch (e) {
        console.error("Failed to parse stream part:", data, e);
      }
    }
  }
}

/**
 * Handle individual stream parts
 */
function handleStreamPart(part: Record<string, unknown>, callbacks: StreamCallbacks): void {
  switch (part.type) {
    case "text-delta":
      callbacks.onTextDelta(part.messageId as string, part.text as string);
      break;

    case "tool-input-start":
      callbacks.onToolCallStart({
        type: "tool-call",
        toolCallId: part.toolCallId as string,
        toolName: part.toolName as string,
        args: {},
      });
      break;

    case "tool-input-delta":
      callbacks.onToolCallDelta(part.toolCallId as string, part.delta as string);
      break;

    case "tool-input-end":
      callbacks.onToolCallEnd(part.toolCallId as string);
      break;

    case "tool-call":
      callbacks.onToolCallStart(part as unknown as ToolCallPart);
      break;

    case "tool-result":
      callbacks.onToolResult(part as unknown as ToolResultPart);
      break;

    case "data-rlm-state":
      callbacks.onDataPart("data-rlm-state", part.id as string, part.data);
      break;

    case "error":
      callbacks.onError(new Error(part.error as string));
      break;

    case "finish":
      callbacks.onComplete();
      break;

    default:
      // Handle other data-* parts
      if (part.type?.startsWith("data-")) {
        callbacks.onDataPart(part.type, part.id as string, part.data);
      }
  }
}
```

---

### Phase 4: useChat Hook (Corrected)

**File**: `src/hooks/use-chat.ts`

**Purpose**: Main hook with correct Solid primitives.

```typescript
// src/hooks/use-chat.ts
import { createEffect, onCleanup, type Accessor } from "solid-js";
import { createChatStore } from "../lib/chat/store";
import { parseUIMessageStream } from "../lib/chat/stream-parser";
import type { ChatUIMessage, ChatState } from "../types/ui-message";

interface UseChatOptions {
  apiUrl?: string;
  initialMessages?: ChatUIMessage[];
  onError?: (error: Error) => void;
  onFinish?: (message: ChatUIMessage) => void;
}

interface UseChatResult {
  // Direct store access (reactive)
  store: ChatState;

  // Computed accessors (memoized)
  status: Accessor<ChatState["status"]>;
  error: Accessor<Error | null>;
  isLoading: Accessor<boolean>;
  canSend: Accessor<boolean>;

  // Actions
  setInput: (input: string) => void;
  sendMessage: (message: string) => void;
  stop: () => void;
  addToolResult: (toolCallId: string, result: unknown) => void;
}

/**
 * Main chat hook with correct Solid primitives
 */
export function useChat(options: UseChatOptions = {}): UseChatResult {
  const { apiUrl = "/api/chat", initialMessages = [], onError, onFinish } = options;

  const chatStore = createChatStore(initialMessages);
  let abortController: AbortController | null = null;

  // Track current streaming message
  let currentMessageId: string | null = null;
  let currentToolArgs: Map<string, string> = new Map();

  // Send message to server
  const sendMessage = async (text: string) => {
    // Stop any existing connection
    stop();

    // Add user message
    const userMessage: ChatUIMessage = {
      id: `msg_${Date.now()}`,
      role: "user",
      parts: [{ type: "text", text }],
    };
    chatStore.addMessage(userMessage);

    // Create assistant message for streaming
    currentMessageId = `msg_${Date.now() + 1}`;
    const assistantMessage: ChatUIMessage = {
      id: currentMessageId,
      role: "assistant",
      parts: [{ type: "text", text: "" }],
    };
    chatStore.addMessage(assistantMessage);
    chatStore.setStatus("connecting");

    try {
      abortController = new AbortController();

      const response = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: chatStore.getMessagesForNetwork(),
          goal: text,
        }),
        signal: abortController.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      chatStore.setStatus("streaming");

      await parseUIMessageStream(response, {
        onTextDelta: (messageId, delta) => {
          chatStore.appendTextDelta(messageId, delta);
        },

        onToolCallStart: toolCall => {
          // Add tool call part to message
          chatStore.updateMessage(
            currentMessageId!,
            produce(message => {
              message.parts.push(toolCall);
            })
          );
        },

        onToolCallDelta: (toolCallId, delta) => {
          // Accumulate tool args
          const current = currentToolArgs.get(toolCallId) ?? "";
          currentToolArgs.set(toolCallId, current + delta);
        },

        onToolCallEnd: toolCallId => {
          // Parse accumulated args
          const argsText = currentToolArgs.get(toolCallId) ?? "{}";
          try {
            const args = JSON.parse(argsText);
            chatStore.updateToolCall(
              currentMessageId!,
              toolCallId,
              produce(tc => {
                if (tc.type === "tool-call") {
                  tc.args = args;
                }
              })
            );
          } catch {
            // Args not complete yet
          }
        },

        onToolResult: toolResult => {
          chatStore.updateMessage(
            currentMessageId!,
            produce(message => {
              message.parts.push(toolResult);
            })
          );
        },

        onDataPart: (type, id, data) => {
          // Handle custom data parts
          if (type === "data-rlm-state") {
            chatStore.setRLMState(data as RLMStateData);
          }
          chatStore.updateDataPart(type, id, data as Record<string, unknown>);
        },

        onError: error => {
          chatStore.setStatus("error");
          chatStore.setError(error);
          onError?.(error);
        },

        onComplete: () => {
          chatStore.setStatus("done");
          const store = chatStore.get();
          const lastMessage = store.messages[store.messages.length - 1];
          if (lastMessage) {
            onFinish?.(lastMessage);
          }
        },
      });
    } catch (error) {
      chatStore.setStatus("error");
      chatStore.setError(error as Error);
      onError?.(error as Error);
    } finally {
      abortController = null;
      currentMessageId = null;
      currentToolArgs.clear();
    }
  };

  // Stop current generation
  const stop = () => {
    abortController?.abort();
    abortController = null;
    chatStore.setStatus("idle");
  };

  // Add tool result (for client-side tools)
  const addToolResult = async (toolCallId: string, result: unknown) => {
    // Send result back to server
    await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "tool-result",
        toolCallId,
        result,
      }),
    });
  };

  // Computed accessors
  const status = () => chatStore.get().status;
  const error = () => chatStore.get().error;
  const isLoading = () => {
    const s = status();
    return s === "connecting" || s === "streaming" || s === "processing";
  };
  const canSend = () => {
    const s = status();
    return s === "idle" || s === "done" || s === "error";
  };

  return {
    store: chatStore.get(),
    status,
    error,
    isLoading,
    canSend,
    setInput: () => {}, // TODO: implement input tracking
    sendMessage,
    stop,
    addToolResult,
  };
}
```

---

### Phase 5: Message Components (Parts-Based Rendering)

**File**: `src/components/message-parts.tsx`

**Purpose**: Render individual message parts correctly.

```typescript
// src/components/message-parts.tsx
import { For, Show, Switch, Match } from 'solid-js'
import type { MessagePart } from 'ai'

interface MessagePartsProps {
  parts: MessagePart[]
}

export function MessageParts(props: MessagePartsProps) {
  return (
    <For each={props.parts}>
      {(part) => (
        <Switch fallback={<UnknownPart part={part} />}>
          <Match when={part.type === 'text'}>
            <TextPart part={part} />
          </Match>
          <Match when={part.type === 'tool-call'}>
            <ToolCallPart part={part} />
          </Match>
          <Match when={part.type === 'tool-result'}>
            <ToolResultPart part={part} />
          </Match>
          <Match when={part.type === 'data'}>
            <DataPart part={part} />
          </Match>
        </Switch>
      )}
    </For>
  )
}

function TextPart(props: { part: { type: 'text'; text: string } }) {
  return (
    <div class="text-part">
      {props.part.text}
    </div>
  )
}

function ToolCallPart(props: { part: { type: 'tool-call'; toolName: string; args?: Record<string, unknown> } }) {
  return (
    <div class="tool-call border-l-4 border-blue-500 pl-4 my-2">
      <div class="flex items-center gap-2">
        <span class="font-mono text-sm font-semibold">
          {props.part.toolName}
        </span>
        <Show when={props.part.args}>
          <pre class="text-xs bg-gray-100 dark:bg-gray-800 p-2 rounded">
            {JSON.stringify(props.part.args, null, 2)}
          </pre>
        </Show>
      </div>
    </div>
  )
}

function ToolResultPart(props: { part: { type: 'tool-result'; toolName: string; result?: unknown; error?: string } }) {
  return (
    <div class="tool-result border-l-4 border-green-500 pl-4 my-2">
      <Show when={props.part.error}>
        <div class="text-red-500 text-sm">
          {props.part.error}
        </div>
      </Show>
      <Show when={props.part.result}>
        <pre class="text-xs bg-green-50 dark:bg-green-900/20 p-2 rounded">
          {JSON.stringify(props.part.result, null, 2)}
        </pre>
      </Show>
    </div>
  )
}

function DataPart(props: { part: { type: 'data'; id: string; data: unknown } }) {
  const data = () => props.part.data as Record<string, unknown>

  return (
    <Show when={data().progress !== undefined}>
      <div class="data-part my-2">
        <div class="flex items-center gap-2">
          <div class="flex-1 bg-gray-200 dark:bg-gray-700 rounded-full h-2">
            <div
              class="bg-blue-500 h-2 rounded-full transition-all"
              style={{ width: `${(data().progress as number) * 100}%` }}
            />
          </div>
          <span class="text-xs text-gray-500">
            {Math.round((data().progress as number) * 100)}%
          </span>
        </div>
        <Show when={data().message}>
          <div class="text-xs text-gray-500 mt-1">
            {data().message as string}
          </div>
        </Show>
      </div>
    </Show>
  )
}

function UnknownPart(props: { part: MessagePart }) {
  return (
    <div class="unknown-part text-xs text-gray-400">
      Unknown part type: {props.part.type}
    </div>
  )
}
```

---

### Phase 6: Message List Component

**File**: `src/components/message-list.tsx`

```typescript
// src/components/message-list.tsx
import { For, Show } from 'solid-js'
import type { ChatUIMessage } from '../types/ui-message'
import { MessageParts } from './message-parts'

interface MessageListProps {
  messages: ChatUIMessage[]
}

export function MessageList(props: MessageListProps) {
  return (
    <div class="message-list space-y-4">
      <For each={props.messages}>
        {(message) => (
          <MessageBubble message={message} />
        )}
      </For>
    </div>
  )
}

function MessageBubble(props: { message: ChatUIMessage }) {
  const isUser = () => props.message.role === 'user'

  return (
    <div
      class={`message ${
        isUser()
          ? 'bg-blue-500 text-white ml-auto max-w-[80%]'
          : 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100 mr-auto max-w-[80%]'
      } rounded-lg px-4 py-2`}
    >
      <MessageParts parts={props.message.parts} />

      <Show when={props.message.createdAt}>
        <div class="message-meta text-xs opacity-50 mt-1">
          {new Date(props.message.createdAt ?? Date.now()).toLocaleTimeString()}
        </div>
      </Show>
    </div>
  )
}
```

---

### Phase 7: Complete Chat Component

**File**: `src/components/chat.tsx`

```typescript
// src/components/chat.tsx
import { Show, createEffect } from 'solid-js'
import { useChat } from '../hooks/use-chat'
import { MessageList } from './message-list'
import type { ChatUIMessage } from '../types/ui-message'

interface ChatProps {
  apiUrl?: string
  initialMessages?: ChatUIMessage[]
  onError?: (error: Error) => void
  onFinish?: (message: ChatUIMessage) => void
}

export function Chat(props: ChatProps) {
  const chat = useChat({
    apiUrl: props.apiUrl,
    initialMessages: props.initialMessages,
    onError: props.onError,
    onFinish: props.onFinish,
  })

  let inputRef: HTMLInputElement | undefined
  let messagesEndRef: HTMLDivElement | undefined

  // Auto-scroll to bottom on new messages
  createEffect(() => {
    chat.store.messages // Track changes
    messagesEndRef?.scrollIntoView({ behavior: 'smooth' })
  })

  const handleSubmit = (e: Event) => {
    e.preventDefault()
    const text = inputRef?.value ?? ''
    if (text.trim() && chat.canSend()) {
      chat.sendMessage(text)
      if (inputRef) {
        inputRef.value = ''
      }
    }
  }

  return (
    <div class="chat-container flex flex-col h-screen">
      {/* Messages */}
      <div class="messages flex-1 overflow-y-auto p-4">
        <MessageList messages={chat.store.messages} />
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form
        onSubmit={handleSubmit}
        class="input-area p-4 border-t border-gray-200 dark:border-gray-700"
      >
        <div class="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            placeholder="Type a message..."
            disabled={!chat.canSend()}
            class="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />

          <Show when={chat.isLoading()}>
            <button
              type="button"
              onClick={chat.stop}
              class="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 disabled:opacity-50"
            >
              Stop
            </button>
          </Show>

          <Show when={!chat.isLoading()}>
            <button
              type="submit"
              disabled={!chat.canSend()}
              class="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50"
            >
              Send
            </button>
          </Show>
        </div>

        {/* Status indicator */}
        <Show when={chat.store.rlmState}>
          <div class="mt-2 text-xs text-gray-500">
            Phase: {chat.store.rlmState?.phase} | Step: {chat.store.rlmState?.step}
          </div>
        </Show>

        {/* Error */}
        <Show when={chat.error()}>
          <div class="mt-2 text-sm text-red-500">
            {chat.error()?.message}
          </div>
        </Show>
      </form>
    </div>
  )
}
```

---

## File Structure

```
src/
├── types/
│   └── ui-message.ts                 # Extended UIMessage types
├── lib/
│   └── chat/
│       ├── store.ts                  # createStore + produce/reconcile
│       └── stream-parser.ts          # UIMessage protocol parser
├── hooks/
│   └── use-chat.ts                   # Main useChat hook (corrected)
├── components/
│   ├── chat.tsx                      # Main chat component
│   ├── message-list.tsx              # Message list container
│   └── message-parts.tsx             # Part-based rendering
└── app/
    └── api/
        └── chat/
            └── route.ts              # Server: createUIMessageStream
```

---

## Testing Strategy

### Unit Tests

```typescript
// src/lib/chat/__tests__/store.test.ts
import { describe, it, expect } from "vitest";
import { createChatStore } from "../store";
import type { ChatUIMessage } from "../../../types/ui-message";

describe("createChatStore", () => {
  it("should handle high-frequency updates efficiently", () => {
    const store = createChatStore();

    const message: ChatUIMessage = {
      id: "msg_1",
      role: "assistant",
      parts: [{ type: "text", text: "" }],
    };

    store.addMessage(message);

    // Simulate 100 text deltas
    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      store.appendTextDelta("msg_1", "token ");
    }
    const duration = performance.now() - start;

    // Should be very fast (< 10ms for 100 updates)
    expect(duration).toBeLessThan(10);

    const finalMessage = store.get().messages[0];
    const textPart = finalMessage.parts.find(p => p.type === "text");
    expect(textPart?.text).toBe("token ".repeat(100));
  });

  it("should reconcile history efficiently", () => {
    const store = createChatStore();

    const newMessages: ChatUIMessage[] = Array.from({ length: 100 }, (_, i) => ({
      id: `msg_${i}`,
      role: "user" as const,
      parts: [{ type: "text", text: `Message ${i}` }],
    }));

    const start = performance.now();
    store.setMessages(newMessages);
    const duration = performance.now() - start;

    // Should be fast even for 100 messages
    expect(duration).toBeLessThan(50);
    expect(store.get().messages).toHaveLength(100);
  });
});
```

---

## Deployment Considerations

### Environment Variables

```bash
// .env.local
OPENAI_API_KEY=sk-xxx
ANTHROPIC_API_KEY=sk-xxx
GOOGLE_GENERATIVE_AI_API_KEY=xxx
```

### Security: XSS Prevention

```typescript
// src/lib/markdown.ts
import DOMPurify from "dompurify";
import { marked } from "marked";

export function renderMarkdown(text: string): string {
  const html = marked(text);
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ["p", "br", "strong", "em", "code", "pre", "a"],
    ALLOWED_ATTR: ["href", "class"],
  });
}
```

---

## References

- [Vercel AI SDK: Stream Protocol](https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol)
- [Vercel AI SDK: Streaming Custom Data](https://ai-sdk.dev/docs/ai-sdk-ui/streaming-data)
- [Vercel AI SDK: Reading UIMessage Streams](https://ai-sdk.dev/docs/ai-sdk-ui/reading-ui-message-streams)
- [Vercel AI SDK: Chatbot Tool Usage](https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-tool-usage)
- [Solid.js: Store Reactive Updates](https://www.solidjs.com/docs/latest/api#store)
- [Solid.js: reconcile](https://www.solidjs.com/docs/latest/api#reconcile)
