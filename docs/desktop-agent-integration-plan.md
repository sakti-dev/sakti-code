# Desktop-Agent Integration via Hono Server

Comprehensive plan for integrating the SolidJS desktop UI (`apps/desktop`) with the AI agent system (`packages/core`) through the Hono REST API server (`packages/server`).

**Based on research from:** `.claude/research/plans/new-solid-ai-integration.md`

## Background

The ekacode project has a three-tier architecture:

1. **Electron App** (Desktop) - SolidJS renderer process for UI
2. **Hono REST API** (Server) - HTTP endpoints for chat, events, permissions
3. **Core Logic** (Core) - AI agents, workflow engine, tools, and session management

Currently, the desktop UI has mock implementations in `workspace-view/index.tsx` that need to be replaced with real API integration using **Vercel AI SDK's native UIMessage stream protocol**.

## Critical Design Principles

### 1. Use AI SDK's Native Protocol (No Custom SSE Events)

**❌ DON'T** - Create custom event types:

```typescript
event: state;
event: tool - call - delta;
event: custom - event;
```

**✅ DO** - Use AI SDK's UIMessage stream:

```typescript
writer.write({
  type: "data-rlm-state",
  id: "rlm",
  data: { phase: "analyzing", step: "scanning" },
});
writer.merge(result.toUIMessageStream());
```

### 2. Use createStore + produce for High-Frequency Updates

**❌ DON'T** - Use signals for message arrays:

```typescript
const [messages, setMessages] = createSignal<UIMessage[]>([]);
setMessages(prev => [...prev, newChunk]); // O(N) on every token
```

**✅ DO** - Use store with produce for O(1) updates:

```typescript
setStore(
  "messages",
  m => m.id === currentMessageId,
  produce(message => {
    const textPart = message.parts.find(p => p.type === "text");
    if (textPart?.type === "text") {
      textPart.text += delta;
    }
  })
);
```

### 3. Render message.parts, Not message.content

**❌ DON'T** - Render top-level content:

```typescript
<div>{message.content}</div>
```

**✅ DO** - Render parts array:

```typescript
<For each={message.parts}>
  {part => (
    <Switch>
      <Match when={part.type === 'text'}><TextPart part={part} /></Match>
      <Match when={part.type === 'tool-call'}><ToolCallPart part={part} /></Match>
      <Match when={part.type === 'tool-result'}><ToolResultPart part={part} /></Match>
    </Switch>
  )}
</For>
```

### 4. Sanitize at Network Boundary Only

Use Solid's `unwrap()` to remove proxies when sending to server:

```typescript
const messages = unwrap(this.store.messages);
await fetch("/api/chat", { body: JSON.stringify({ messages }) });
```

---

## Implementation Phases

### Phase 1: Type Definitions & API Client

#### [NEW] `apps/desktop/src/types/ui-message.ts`

- Extended UIMessage type with custom data parts
- RLMStateData, ProgressData, PermissionRequestData interfaces
- ChatState interface for Solid store

#### [NEW] `apps/desktop/src/lib/api-client.ts`

- EkacodeApiClient class
- chat() method returning Response for streaming
- approvePermission() method
- connectToEvents() for SSE

---

### Phase 2: Solid Store & Stream Parser

#### [NEW] `apps/desktop/src/lib/chat/store.ts`

- createChatStore() with createStore
- O(1) appendTextDelta using produce()
- addToolCall, updateToolCall, addToolResult methods
- setMessages using reconcile() for history
- getMessagesForNetwork using unwrap()

#### [NEW] `apps/desktop/src/lib/chat/stream-parser.ts`

- parseUIMessageStream() function
- Handle text-delta, tool-input-start/delta/end, tool-call, tool-result
- Handle data-\* parts for RLM state
- Handle error and finish events

---

### Phase 3: useChat Hook

#### [NEW] `apps/desktop/src/hooks/use-chat.ts`

- Initialize store with createChatStore
- sendMessage with streaming and AbortController
- Handle X-Session-ID header
- Computed accessors: status, error, isLoading, canSend
- stop() and clearMessages() methods
- onCleanup for abort on unmount

---

### Phase 4: Message Components

#### [NEW] `apps/desktop/src/components/message-parts.tsx`

- MessageParts component with <For> and <Switch>
- TextPart, ToolCallPart, ToolResultPart components
- UnknownPart fallback

#### [MODIFY] `apps/desktop/src/views/workspace-view/chat-area/message-list.tsx`

- Import and use MessageParts component
- Pass message.parts instead of message.content

#### [MODIFY] `apps/desktop/src/views/workspace-view/index.tsx`

- Initialize API client from preload
- Use useChat hook
- Connect sendMessage handler

---

### Phase 5: Permission System

#### [NEW] `apps/desktop/src/hooks/use-permissions.ts`

- Connect to SSE endpoint
- Handle permission:request events
- approve() and deny() methods
- Auto-reconnect on disconnect

#### [NEW] `apps/desktop/src/components/permission-dialog.tsx`

- Modal dialog for permission requests
- Show tool name and arguments
- Allow/Deny buttons

---

### Phase 6: Session Management

#### [NEW] `apps/desktop/src/hooks/use-session.ts`

- Store session ID in localStorage per workspace
- Sync with useChat hook
- Handle restore on page load

---

### Phase 7: Server Enhancements

#### [MODIFY] `packages/server/src/routes/chat.ts`

- Add data-rlm-state parts to stream
- Send phase, progress, activeAgents updates
- Mark status updates as transient
- Add data-session part on new session

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                          Desktop UI (SolidJS)                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │
│  │ MessageList  │  │ ToolStatus   │  │ InputArea    │              │
│  │ <For parts>  │  │  Component   │  │  Component   │              │
│  └──────────────┘  └──────────────┘  └──────────────┘              │
├─────────────────────────────────────────────────────────────────────┤
│                      useChat() Hook                                  │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  - createStore for O(1) updates                              │  │
│  │  - produce() for streaming deltas                            │  │
│  │  - reconcile() for history sync                              │  │
│  │  - Parses UIMessage stream protocol                          │  │
│  └──────────────────────────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────────────────────┤
│                   Hono Server: UIMessage Stream                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  - createUIMessageStream()                                   │  │
│  │  - writer.write(data-rlm-state)                              │  │
│  │  - writer.merge(result.toUIMessageStream())                  │  │
│  │  - createUIMessageStreamResponse()                           │  │
│  └──────────────────────────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────────────────────┤
│                   Core: Workflow Engine                             │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  - SessionManager / SessionController                         │  │
│  │  - WorkflowEngine (explore → plan → build)                   │  │
│  │  - Tool execution with streaming                              │  │
│  │  - PermissionManager (SSE events)                            │  │
│  └──────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Stream Part Types Reference

| Type               | Purpose             | Update Frequency       |
| ------------------ | ------------------- | ---------------------- |
| `text-delta`       | Text chunk          | Very high (50-100/sec) |
| `tool-input-start` | Tool call begins    | Low                    |
| `tool-input-delta` | Tool args streaming | Medium                 |
| `tool-input-end`   | Tool args complete  | Low                    |
| `tool-call`        | Tool execution      | Low                    |
| `tool-result`      | Tool output         | Low                    |
| `data-*`           | Custom data         | Variable               |
| `finish`           | Turn complete       | Once                   |

---

## Implementation Order

1. **Phase 1**: Type Definitions & API Client (2 files)
2. **Phase 2**: Store & Stream Parser (2 files)
3. **Phase 3**: useChat Hook (1 file)
4. **Phase 4**: Message Components (3 files)
5. **Phase 5**: Permission System (2 files)
6. **Phase 6**: Session Management (1 file)
7. **Phase 7**: Server Enhancements (1 file)

---

## Dependencies

**No new npm dependencies required.**

---

## Key References

- [Vercel AI SDK: Stream Protocol](https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol)
- [Vercel AI SDK: Streaming Custom Data](https://ai-sdk.dev/docs/ai-sdk-ui/streaming-data)
- [Solid.js: Store Reactive Updates](https://www.solidjs.com/docs/latest/api#store)
- [Solid.js: produce](https://www.solidjs.com/docs/latest/api#produce)
- [Solid.js: reconcile](https://www.solidjs.com/docs/latest/api#reconcile)
