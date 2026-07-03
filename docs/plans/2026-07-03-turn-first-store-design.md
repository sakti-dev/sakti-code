# Turn-First Store Redesign

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Eliminate `buildChatTurns` and the `splitCache` bug by making turns a first-class concept in the store. WS events and REST hydration populate turns directly — no derivation, no projection, no virtual messages.

**Architecture:** The store holds `Turn[]` as its primary structure. Each turn contains `userMessage` + `messages: UIMessage[]` (assistant messages with `MessagePart[]`). An event-handler registry maps `AgentHarnessEvent` types to typed mutations on the store. Token streaming uses path-based `setStore` calls for zero-array-churn fine-grained updates. Components read turns directly from the store — no memo/projection layer.

**Tech Stack:** SolidJS `createStore` with nested proxies, path-based `setStore` for fine-grained reactivity, vitest TDD.

---

## Problem Statement

### The `splitCache` Bug

`turn-projection.ts` caches thinking-splits keyed by `UIMessage` proxy. When parts are added to a completed message (compaction marker, OM marker), the cache returns stale data that doesn't include the new part. The compaction marker exists in the store but never appears in the UI.

**Root cause:** The cache assumes completed messages are immutable. They aren't — compaction/OM events mutate parts after completion.

### Architectural Issues

1. **Turns are derived, not stored.** `buildChatTurns` groups flat messages into turns on every recompute. This is wasted work — the turn structure is known at insertion time.
2. **The thinking split creates virtual messages** that need referential stability management (WeakMap cache). The cache is the source of the bug.
3. **Part mutation patterns are inconsistent** — `produce()` in-place, array spread, `.map()`. Different patterns produce different reactivity granularities.
4. **The 316-line switch in `event-reducer.ts`** has no clear extension point. Adding a new part type requires touching 5 files with no single declaration of its lifecycle.

## Design

### Store Structure

```typescript
interface SessionStoreData {
  turns: Turn[];
  streaming: StreamState;
  permission: PermissionPending | null;
  proposedSession: ProposedSession | null;
  retry: RetryState | null;
  omStatus: OmWindowState | null;
}

interface Turn {
  id: string;
  userMessage: UIMessage | null;
  messages: UIMessage[];
  startedAt: number | null;
  endedAt: number | null;
  working: boolean;
  error: string | null;
  // Lazy loading (null turnId = live turn, never persisted)
  turnId: string | null;
  intermediateCount: number;
  intermediatesLoaded: boolean;
  loadedMessageIds: string[];
}
```

**What's removed:** `messageOrder`, `messages: Record<...>`, `turnTimings`, `turns: Record<string, TurnMeta>`.

### Event Handler Registry

```typescript
// event-handler.ts
interface HandlerContext {
  store: SessionStoreData;
  setStore: SetStoreFunction<SessionStoreData>;
  batcher: TokenBatcher;
}

type EventHandler<E> = (event: E, ctx: HandlerContext) => void;

// Registration
function registerHandler<E extends AgentHarnessEvent>(
  type: E["type"],
  handler: EventHandler<E>,
): void;

// Dispatch
function dispatchEvent(event: AgentHarnessEvent, ctx: HandlerContext): void;
```

Domain-specific handler files register their own handlers:

- `handlers/lifecycle-events.ts` — agent_start/end, turn_start/end, abort
- `handlers/message-events.ts` — message_start/update/end
- `handlers/tool-events.ts` — tool_execution_start/end
- `handlers/compaction-events.ts` — compaction_start/delta/end
- `handlers/om-events.ts` — om_start/end/failed/activation/status
- `handlers/retry-events.ts` — auto_retry_start/end

**Adding a new part type = 3 steps:**

1. Add to `MessagePart` union in `types.ts`
2. Register event handlers in `handlers/X-events.ts`
3. Register component in `register-parts.ts`

### Part Mutation Strategy

Token streaming (high-frequency) uses **path-based updates** — updates a single property, no array change:

```typescript
setStore("turns", tIdx, "messages", mIdx, "parts", pIdx, "text", (prev) => prev + delta);
```

Part additions (low-frequency) use array spread:

```typescript
setStore("turns", tIdx, "messages", mIdx, "parts", (prev) => [...prev, newPart]);
```

A message-location cache (`Map<string, {turnIdx, msgIdx}>`) provides O(1) lookup for operations that target by message ID (compaction, OM markers).

### Thinking Display

No virtual messages. Each `MessageContent` component renders parts with `<Index>`. Thinking parts render in an inline collapsible (`<details>` or Solid `<Show>`). The turn-level accordion collapses intermediate _messages_ (agent-loop iterations), not thinking parts.

### REST Hydration

`/chat` response maps directly to `Turn[]`:

```typescript
function hydrateTurns(dtos: ChatTurnDTO[]): Turn[] { ... }
```

Intermediate loading inserts into `turn.messages` — scoped to the turn, not a global flat list. Eviction filters `turn.messages` — no global cleanup.

### Data Flow (New)

```
WS Events → event-handler registry → store.turns[turnIdx].messages[msgIdx].parts[partIdx]
                                         ↓
Solid Store (turns are first-class)
                                         ↓
Virtualizer reads () => store.turns directly
                                         ↓
SessionTurn → MessageContent → Part components
```

### Files

| File                                                    | Action                                          |
| ------------------------------------------------------- | ----------------------------------------------- |
| `stores/types.ts`                                       | **Rewrite** — `Turn` type, remove flat concepts |
| `stores/session/session-store.ts`                       | **Rewrite** — turn-first structure              |
| `stores/session/event-handler.ts`                       | **Create** — registry + dispatch                |
| `stores/session/handlers/*.ts`                          | **Create** — domain-specific handler files      |
| `stores/session/hydrate-chat.ts`                        | **Update** — produce `Turn[]`                   |
| `stores/session/hydrate-messages.ts`                    | **Update** — legacy `/messages` path            |
| `stores/session/hydrate-helpers.ts`                     | **Keep** — conversion helpers unchanged         |
| `stores/session/token-batcher.ts`                       | **Keep** — unchanged                            |
| `stores/session/session-registry.ts`                    | **Keep** — unchanged                            |
| `stores/session/usage-stats.ts`                         | **Update** — aggregate from `turn[].messages`   |
| `stores/session/turn-projection.ts`                     | **Delete**                                      |
| `stores/session/event-reducer.ts`                       | **Delete**                                      |
| `stores/server/ws-client.ts`                            | **Update** — use new dispatch                   |
| `stores/server/actions.ts`                              | **Update** — load functions                     |
| `components/chat-area/task-chat-view.tsx`               | **Update** — read turns directly                |
| `components/chat-area/timeline/session-turn.tsx`        | **Update** — thinking inline                    |
| `components/chat-area/timeline/estimate-turn-height.ts` | **Update** — use `Turn`                         |
| `components/chat-area/timeline/message-timeline.tsx`    | **Minor update** — `Turn` type                  |
