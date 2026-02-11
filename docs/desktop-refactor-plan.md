# Desktop App Refactor Plan

> **Status:** Draft | **Version:** 2.3 (Implementation Review + Timer Guidance) | **Last Updated:** 2026-02-08
>
> **Key Updates in v2.3:**
>
> - Added timer usage policy: use `@solid-primitives/timer` for UI/component timers, keep infrastructure reconnect/coalescing timers imperative
> - Clarified applicability in library recommendations with concrete current-code examples (`session-turn.tsx` vs `global-sdk-provider.tsx`)
>
> **Key Updates in v2.2:**
>
> - Corrected section 4.10 status table to match actual code (`global-sdk-provider`, `global-sync-provider`, `sync-provider`)
> - Reclassified event bus and persistence items from "missing" to "partially implemented"
> - Added dependency-first execution order (stabilize streaming -> type contracts -> domain boundaries -> UI decomposition)
> - Implemented runtime SSE hardening in current code: bounded coalescing queue + reconnect backoff + `lastEventId` resume hint
>
> **Key Updates in v2.1:**
>
> - Fixed store state examples to use `Record<string, true>` instead of `Set` (consistency with anti-pattern #12)
> - Added section 4.10 "Current Implementation Status" documenting patterns already correctly in place
> - Validated current `session-turn.tsx` and `sync-provider.tsx` implementations against best practices
>
> **Key Updates in v2.0:**
>
> - Fixed all `produce`/`reconcile` usage examples with correct SolidJS API patterns
> - Added `@solid-primitives/*` library recommendations throughout
> - Added comprehensive SolidJS idioms section (components as setup functions, props reactivity)
> - Corrected anti-patterns section with newly identified issues
> - Added 7 new research delta tasks (R8-R14) based on expert recommendations
> - Removed module-level singleton eventBus export (SSR-safety violation)

## Executive Summary

This document outlines a comprehensive refactor plan for the ekacode desktop application to address critical architectural issues in state management, performance, component design, and code organization. The current codebase suffers from provider sprawl, performance bottlenecks, and mixed concerns that make it difficult to maintain and extend.

### Key Problems Identified

| Category             | Critical Issues                                     | Impact                             |
| -------------------- | --------------------------------------------------- | ---------------------------------- |
| **State Management** | 4 provider layers with overlapping responsibilities | Confusing data flow, hard to debug |
| **Performance**      | Unnecessary re-renders, missing memoization         | Choppy animations, sluggish UI     |
| **Streaming**        | Complex event routing, potential memory leaks       | Unreliable real-time updates       |
| **Components**       | 500+ line files, mixed concerns                     | Hard to test and maintain          |

### Refactor Goals

1. **Separate Concerns** - Each module has a single, well-defined responsibility
2. **Improve Performance** - Smooth animations, minimal re-renders
3. **Simplify Architecture** - Clear data flow, easy to understand
4. **Enable Testing** - Testable components with clear boundaries
5. **Prepare for Scale** - Architecture that grows with features

### Research-Validated Decisions (Authoritative)

These decisions supersede conflicting examples in older snippets below:

1. **No module-level singleton stores** - create stores per provider/request for SSR safety and test isolation.
2. **Keep normalized domain state** - `byId` + ordered ID arrays + secondary indexes for O(1) access.
3. **Use `reconcile` for remote ingest, `produce` for local transitions** - `reconcile` merges entire collections from API; `produce(draft => ...)` for local mutations (NOT `produce(state, draft => ...)`).
4. **Use typed event contracts** - event bus must be generic over an `EventMap` instead of `string + any`.
5. **SSE must include lifecycle rigor** - `onCleanup`, bounded queues, exponential backoff + jitter, and catch-up sync.
6. **Use `<For>` for keyed message IDs** - do not use `<Index>` for mutable/insertable message timelines.
7. **Cross-domain orchestration lives in coordinators** - domain stores stay decoupled.
8. **Persist selectively** - persist UI/session metadata with `@solid-primitives/storage`; hydrate heavy history from API/IndexedDB.
9. **Prefer smart-container + dumb-presentational split** - contexts in containers, serializable props in leaf UI.
10. **No hooks in factory functions** - Services/commands accept dependencies as parameters, not via `useX()` hooks.
11. **Use `Record<string, true>` instead of `Set`** - Stores must use plain objects for serializability and proper reactivity.
12. **Components are setup functions** - Components run once during initialization, not on every state change.
13. **Preserve props reactivity** - Access props directly (`props.name`), never destructure in component signature.
14. **Use `@solid-primitives/*` libraries** - Don't reinvent event bus, storage, scheduled, etc.
15. **Virtualize large lists** - Use `@tanstack/solid-virtual` for 500+ items.
16. **Use timer primitives selectively** - Prefer `@solid-primitives/timer` for UI/component timers; keep infra reconnect/coalescing timers explicit for deterministic lifecycle/state control.

---

## 1. Current Architecture Analysis

### 1.1 Provider Hierarchy (Current)

```
App
├── GlobalSDKProvider (289 lines)
│   ├── SSE connection management
│   ├── Event coalescing
│   └── SDK client exposure
│
├── GlobalSyncProvider (873 lines) ⚠️ TOO LARGE
│   ├── Directory store management
│   ├── Event routing
│   ├── Persistence (localStorage)
│   ├── LRU eviction
│   └── Session loading
│
├── SyncProvider (402 lines)
│   ├── Per-directory sync
│   ├── Message synchronization
│   ├── Optimistic updates
│   └── Pagination
│
└── WorkspaceProvider (262 lines)
    ├── Workspace state
    ├── Session list management
    ├── Chat hook integration
    └── Permission handling
```

**Problems:**

- ❌ 4 providers stacked on each other
- ❌ GlobalSyncProvider does 5+ different things
- ❌ Circular dependencies between providers
- ❌ State duplication (limit, complete, loading in multiple places)

### 1.2 Data Flow (Current)

```
Server SSE Event
    ↓
GlobalSDKProvider (coalesce events)
    ↓
GlobalSyncProvider (route by directory)
    ↓
SyncProvider (apply to store)
    ↓
useChat hook (project messages)
    ↓
Component render
```

**Problems:**

- ❌ Each layer adds transformation overhead
- ❌ Event coalescing uses non-reactive closures
- ❌ No clear error boundaries
- ❌ Hard to trace data flow

### 1.3 Performance Issues

| Issue                   | Location                          | Root Cause                        |
| ----------------------- | --------------------------------- | --------------------------------- |
| Choppy typing animation | `message-list.tsx:130-141`        | No CSS keyframe animation         |
| Unnecessary re-renders  | Multiple components               | Missing `createMemo` dependencies |
| Expensive lookups       | `session-turn.tsx:233-252`        | Linear scan instead of Map        |
| Memory leak risk        | `global-sdk-provider.tsx:177-207` | Unbounded event queue             |

### 1.4 SOLID Violations

| Principle                 | Violation                                        | Example                                               |
| ------------------------- | ------------------------------------------------ | ----------------------------------------------------- |
| **S**ingle Responsibility | GlobalSyncProvider has 5+ responsibilities       | Store + routing + persistence + eviction + loading    |
| **O**pen/Closed           | Hard-coded tool status switch                    | `computeStatusFromPart()` needs changes for new tools |
| **L**iskov Substitution   | `createSync()` not designed for extension        | Can't swap sync implementations                       |
| **I**nterface Segregation | `UseChatResult` has 10+ properties               | Consumers only use subset                             |
| **D**ependency Inversion  | `useChat` depends on concrete `EkacodeApiClient` | Can't swap API implementation                         |

---

## 2. Proposed New Architecture

### 2.1 Guiding Principles

1. **Domain-Driven Design** - Structure around business domains (Chat, Session, Event, UI)
2. **Reactive Core** - Leverage SolidJS fine-grained reactivity
3. **Explicit Data Flow** - Clear direction, no circular dependencies
4. **Composition Over Inheritance** - Composable utilities, not deep hierarchies
5. **Testability First** - Everything should be testable without rendering
6. **SSR-Safe Dependency Injection** - No request-shared mutable globals
7. **Stable Identity Over Rebuilds** - Preserve references via `reconcile` for large lists
8. **Reactive Derivation, Not State Sync** - Use memos/selectors instead of copying state via effects

### 2.2 New Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              APP ROOT                                   │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
        ┌───────────────────────────┼───────────────────────────┐
        ▼                           ▼                           ▼
┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐
│  EventSourceLayer │    │  CommandLayer    │    │   UILayer        │
│                   │    │                  │    │                  │
│ • SSE connection  │    │ • API client     │    │ • Component      │
│ • Event parsing   │◄───┤ • Commands       │◄───┤ • Hooks          │
│ • Event bus       │    │ • Optimistic UI  │    │ • State projection│
│ • Error handling  │    │                  │    │                  │
└──────────────────┘    └──────────────────┘    └──────────────────┘
        │                           │                           │
        └───────────────────────────┼───────────────────────────┘
                                    ▼
                      ┌──────────────────────────┐
                      │      Domain Store        │
                      │                          │
                      │ • messages               │
                      │ • parts                  │
                      │ • sessions               │
                      │ • ephemeral state        │
                      └──────────────────────────┘
```

### 2.3 Domain-Layered Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          PRESENTATION LAYER                             │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐           │
│  │  Components    │  │     Hooks      │  │  UI State      │           │
│  │                │  │                │  │                │           │
│  │ • MessageList  │  │ • useChat      │  │ • selection    │           │
│  │ • ChatInput    │  │ • useSession   │  │ • focus        │           │
│  │ • SessionView  │  │ • useMessages  │  │ • modals       │           │
│  └────────────────┘  └────────────────┘  └────────────────┘           │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                           APPLICATION LAYER                              │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐           │
│  │   Commands     │  │    Queries     │  │   Projections  │           │
│  │                │  │                │  │                │           │
│  │ • sendMessage  │  │ • getMessage   │  │ • chatReady    │           │
│  │ • stopStream   │  │ • getParts     │  │ • canSend      │           │
│  │ • retryMessage │  │ • getSession   │  │ • statusText   │           │
│  └────────────────┘  └────────────────┘  └────────────────┘           │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                             DOMAIN LAYER                                │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐           │
│  │    Stores      │  │ Event Handlers │  │   Services     │           │
│  │                │  │                │  │                │           │
│  │ • messageStore │  │ • onMessage    │  │ • streamParser │           │
│  │ • partStore    │  │ • onPart       │  │ • formatter    │           │
│  │ • sessionStore │  │ • onStatus     │  │ • validator    │           │
│  └────────────────┘  └────────────────┘  └────────────────┘           │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                          INFRASTRUCTURE LAYER                            │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐           │
│  │ EventSource    │  │   API Client   │  │  Persistence   │           │
│  │                │  │                │  │                │           │
│  │ • SSE connect  │  │ • HTTP client  │  │ • localStorage │           │
│  │ • Reconnect    │  │ • Fetch API    │  │ • IndexedDB    │           │
│  │ • Heartbeat    │  │ • Auth         │  │ • Cache        │           │
│  └────────────────┘  └────────────────┘  └────────────────┘           │
└─────────────────────────────────────────────────────────────────────────┘
```

### 2.4 New File Structure

```
apps/desktop/src/
├── core/                           # Domain + Application Layer
│   ├── domain/                     # Business logic, pure functions
│   │   ├── message/                # Message domain
│   │   │   ├── message-store.ts    # Store definition
│   │   │   ├── message-events.ts   # Event handlers
│   │   │   ├── message-queries.ts  # Query functions
│   │   │   └── types.ts            # Domain types
│   │   ├── part/                   # Part domain
│   │   │   ├── part-store.ts
│   │   │   ├── part-events.ts
│   │   │   └── types.ts
│   │   ├── session/                # Session domain
│   │   │   ├── session-store.ts
│   │   │   ├── session-events.ts
│   │   │   └── types.ts
│   │   └── chat/                   # Chat aggregate
│   │       ├── chat-commands.ts    # sendMessage, stop, etc.
│   │       ├── chat-projections.ts # Derived state
│   │       └── types.ts
│   │
│   ├── services/                   # Application services
│   │   ├── stream-parser.service.ts
│   │   ├── formatter.service.ts
│   │   └── validator.service.ts
│   │
│   └── stores/                     # Reactive stores (SolidJS stores)
│       ├── message-store.ts
│       ├── part-store.ts
│       ├── session-store.ts
│       └── index.ts                # Store aggregator
│
├── infrastructure/                 # Infrastructure Layer
│   ├── events/
│   │   ├── event-source.ts         # SSE connection management
│   │   ├── event-bus.ts            # Pub/sub event system
│   │   ├── event-coalescer.ts      # Event batching
│   │   └── types.ts
│   │
│   ├── api/
│   │   ├── api-client.ts           # HTTP client
│   │   ├── chat-api.ts             # Chat endpoints
│   │   └── types.ts
│   │
│   └── persistence/
│       ├── storage.adapter.ts      # Storage abstraction
│       ├── local-storage.ts        # localStorage impl
│       └── indexed-db.ts           # IndexedDB impl
│
├── presentation/                   # Presentation Layer
│   ├── components/
│   │   ├── chat/
│   │   │   ├── message-list.tsx
│   │   │   ├── message-bubble.tsx
│   │   │   ├── chat-input.tsx
│   │   │   └── typing-indicator.tsx
│   │   ├── session/
│   │   │   ├── session-turn.tsx
│   │   │   └── session-header.tsx
│   │   └── parts/
│   │       ├── text-part.tsx
│   │       ├── tool-call-part.tsx
│   │       └── part-registry.tsx   # Part component registry
│   │
│   ├── hooks/                      # Presentation logic hooks
│   │   ├── use-chat.ts             # Chat UI hook
│   │   ├── use-messages.ts         # Messages projection
│   │   ├── use-streaming.ts        # Streaming state
│   │   └── use-typing-indicator.ts # Typing animation
│   │
│   └── state/                      # UI-only state
│       ├── ui-store.ts             # Selection, focus, modals
│       └── constants.ts            # UI constants
│
├── providers/                      # Root providers (simplified)
│   ├── app-provider.tsx            # Single root provider
│   └── contexts.ts                 # Context exports
│
└── shared/                         # Shared utilities
    ├── utils/
    │   ├── binary-search.ts
    │   └── performance.ts
    └── types/                      # Shared types
```

### 2.5 Data Flow (New)

```
User Action (sendMessage)
    │
    ▼
Command Layer (chatCommands.sendMessage())
    │
    ├─→ Optimistic Update (UI Store)
    │       │
    │       ▼
    │   Component re-render
    │
    └─→ API Call (infrastructure/api/chat-api)
            │
            ▼
        Server Response (streaming)
            │
            ▼
    EventSourceLayer (SSE receives events)
            │
            ▼
    Event Bus (pub/sub to domain)
            │
            ▼
    Event Handlers (domain update stores)
            │
            ▼
    Stores update (fine-grained reactivity)
            │
            ▼
    Queries/Projections recalculate
            │
            ▼
    Components re-render (only affected parts)
```

### 2.6 Slice Boundaries and Dependency Rules

To avoid circular imports and accidental coupling, enforce Feature-Sliced boundaries:

- `app/` - app bootstrapping, root providers, routing.
- `pages/` - route composition only.
- `widgets/` - composed UI blocks (chat panel, session sidebar).
- `features/` - user scenarios (send message, retry, rename session).
- `entities/` - domain models/stores (`message`, `part`, `session`).
- `shared/` - reusable UI/utilities with no domain ownership.

Dependency rule: `app -> pages -> widgets -> features -> entities -> shared`. Reverse imports are disallowed.

### 2.7 Anti-Patterns to Explicitly Avoid

1. **Destructuring store state** (e.g., `const { byId } = state`) because it can detach reactive tracking.
2. **State mirroring via `createEffect`** between stores; use memoized derivations/selectors instead.
3. **Wrapping store fields in extra signals** (`createSignal` inside `createStore` state objects).
4. **Domain stores importing each other** directly; use coordinators for cross-domain workflows.
5. **Unbounded SSE buffers** or reconnect loops without jitter/cap/catch-up handling.
6. **Destructuring props in component signature** (e.g., `function MyComponent({ name, age }: Props)`) - breaks reactivity.
7. **Using hooks in factory functions** - Services/commands should accept dependencies as parameters, not call `useX()`.
8. **Using `Set`/`Map` inside stores** - Use `Record<string, true>` or `Record<string, T>` for serializability.
9. **Module-level event bus exports** - Creates SSR-unsafe singleton; use provider-scoped instances only.
10. **Incorrect `produce` usage** - `produce(state, draft => ...)` is wrong; use `produce(draft => ...)` only.
11. **Using `reconcile` for partial updates** - `reconcile` is for merging entire collections, not single object patches.
12. **Using `<Index>` for object-based mutable lists** - Use `<For>` for keyed items, `<Index>` only for primitive values.

---

## 3. Refactor Roadmap

### 3.0 Consolidated Task List (Ordered by Phase)

This is the execution checklist. The detailed phase tables below remain the source for file-level scope.

**Phase 0 - Streaming Stability (Immediate)**

- [x] P0.1 Add bounded SSE queue + reconnect backoff + `lastEventId` resume hint (`global-sdk-provider.tsx`)
- [ ] P0.2 Complete SSE catch-up fallback refetch flow (`R4`)
- [ ] P0.3 Introduce typed SSE payload guards as baseline for full event contracts (`R2`)

**Phase 1 - Foundation**

- [ ] P1.1 Complete tasks `1.1` to `1.6`
- [ ] P1.2 Replace remaining singleton-like store access with explicit provider-scoped factories (`R1`)
- [ ] P1.3 Consolidate event routing on typed `@solid-primitives/event-bus` wrappers (`R8`)

**Phase 2 - Event Streaming Refactor**

- [ ] P2.1 Complete tasks `2.1` to `2.5`
- [ ] P2.2 Add `@solid-primitives/scheduled` where it improves event coalescing ergonomics (`R14`)

**Phase 3 - State Management Migration**

- [ ] P3.1 Complete tasks `3.1` to `3.6`
- [ ] P3.2 Audit and fix `produce`/`reconcile` usage across stores (`R11`)
- [ ] P3.3 Replace store `Set`/`Map` state with `Record` shapes (`R12`)
- [ ] P3.4 Implement persistence tiers (`@solid-primitives/storage` for UI metadata + heavy history hydration path) (`R6`, `R9`)

**Phase 4 - Component Refactor**

- [ ] P4.1 Complete tasks `4.1` to `4.13`
- [ ] P4.2 Enforce keyed list rendering with `<For>` everywhere in chat timeline paths (`R5`)

**Phase 5 - Hooks Refactor**

- [ ] P5.1 Complete tasks `5.1` to `5.5`
- [ ] P5.2 Remove hook usage from service/factory construction paths (dependency injection only) (`R13`)

**Phase 6 - Cleanup and Scale Performance**

- [ ] P6.1 Complete tasks `6.1` to `6.5`
- [ ] P6.2 Ship chat list virtualization with `@tanstack/solid-virtual` (`R10`)
- [ ] P6.3 Add anti-pattern lint/doc guardrails (store destructuring/state-copy effects) (`R7`)
- [ ] P6.4 Add coordinators for cross-domain flows (delete cascade, retry orchestration) (`R3`)

### Phase 1: Foundation (Week 1-2)

**Goal:** Establish new architecture foundation without breaking existing features

| Task | Description                       | Files                                       | Priority |
| ---- | --------------------------------- | ------------------------------------------- | -------- |
| 1.1  | Create new directory structure    | `core/`, `infrastructure/`, `presentation/` | P0       |
| 1.2  | Set up domain stores with SolidJS | `core/stores/*`                             | P0       |
| 1.3  | Implement EventSource layer       | `infrastructure/events/event-source.ts`     | P0       |
| 1.4  | Implement Event Bus               | `infrastructure/events/event-bus.ts`        | P0       |
| 1.5  | Create Command layer              | `core/domain/chat/chat-commands.ts`         | P1       |
| 1.6  | Create Query layer                | `core/domain/*/queries.ts`                  | P1       |

**Exit Criteria:**

- ✅ New directories created
- ✅ EventSource connects and receives events
- ✅ Event bus can subscribe/publish
- ✅ Basic command/execute pattern works

### Phase 2: Event Streaming Refactor (Week 2-3)

**Goal:** Improve streaming reliability and performance

| Task | Description                             | Files                                      | Priority |
| ---- | --------------------------------------- | ------------------------------------------ | -------- |
| 2.1  | Implement reactive event coalescer      | `infrastructure/events/event-coalescer.ts` | P0       |
| 2.2  | Add event queue limits and monitoring   | Same as above                              | P0       |
| 2.3  | Implement stream parser service         | `core/services/stream-parser.service.ts`   | P0       |
| 2.4  | Add error boundaries for event handling | `infrastructure/events/event-source.ts`    | P1       |
| 2.5  | Add reconnection logic with backoff     | Same as 2.4                                | P1       |

**Exit Criteria:**

- ✅ Events batch with proper reactive signals
- ✅ Queue limits prevent memory leaks
- ✅ SSE reconnection works with exponential backoff
- ✅ Errors are caught and logged properly

### Phase 3: State Management Migration (Week 3-4)

**Goal:** Migrate from provider sprawl to domain stores

| Task | Description                                   | Files                          | Priority |
| ---- | --------------------------------------------- | ------------------------------ | -------- |
| 3.1  | Create MessageStore domain                    | `core/domain/message/*`        | P0       |
| 3.2  | Create PartStore domain                       | `core/domain/part/*`           | P0       |
| 3.3  | Create SessionStore domain                    | `core/domain/session/*`        | P0       |
| 3.4  | Implement event handlers for each domain      | `*/domain/*/*-events.ts`       | P0       |
| 3.5  | Add persistence layer with adapter pattern    | `infrastructure/persistence/*` | P1       |
| 3.6  | Migrate existing components to use new stores | Presentation components        | P1       |

**Exit Criteria:**

- ✅ All message data in MessageStore
- ✅ All part data in PartStore
- ✅ Session data in SessionStore
- ✅ Events update stores correctly
- ✅ Persistence works offline

### Phase 4: Component Refactor (Week 4-5)

**Goal:** Break down large components, improve performance, implement domain contexts

| Task | Description                                                  | Files                                               | Priority |
| ---- | ------------------------------------------------------------ | --------------------------------------------------- | -------- |
| 4.1  | Create domain contexts                                       | `presentation/contexts/*`                           | P0       |
| 4.2  | Implement MessageContext                                     | `presentation/contexts/message-context.tsx`         | P0       |
| 4.3  | Implement PartContext                                        | `presentation/contexts/part-context.tsx`            | P0       |
| 4.4  | Implement SessionContext                                     | `presentation/contexts/session-context.tsx`         | P0       |
| 4.5  | Implement UIContext                                          | `presentation/contexts/ui-context.tsx`              | P0       |
| 4.6  | Update provider tree with all contexts                       | `providers/app-provider.tsx`                        | P0       |
| 4.7  | Fix typing indicator animation                               | `presentation/components/chat/typing-indicator.tsx` | P0       |
| 4.8  | Break down SessionTurn (500+ lines)                          | `presentation/components/session/*`                 | P1       |
| 4.9  | Extract AssistantMessage logic                               | `presentation/components/assistant/*`               | P1       |
| 4.10 | Implement proper memoization                                 | All components                                      | P1       |
| 4.11 | Add part component registry                                  | `presentation/components/parts/part-registry.tsx`   | P1       |
| 4.12 | Migrate components to use domain contexts                    | All components                                      | P1       |
| 4.13 | Migrate `SessionTurn` UI timers to `@solid-primitives/timer` | `views/workspace-view/chat-area/session-turn.tsx`   | P1       |

**Exit Criteria:**

- ✅ All domain contexts created and functional
- ✅ Components use context instead of prop drilling
- ✅ Typing indicator animates smoothly
- ✅ No component > 200 lines
- ✅ All expensive computations memoized
- ✅ Part types easily extensible
- ✅ `SessionTurn` uses timer primitives for UI countdown/duration updates

### Phase 5: Hooks Refactor (Week 5-6)

**Goal:** Simplify hooks, make them composable

| Task | Description                               | Files                                 | Priority |
| ---- | ----------------------------------------- | ------------------------------------- | -------- |
| 5.1  | Refactor useChat to use commands          | `presentation/hooks/use-chat.ts`      | P0       |
| 5.2  | Create useMessages for message projection | `presentation/hooks/use-messages.ts`  | P0       |
| 5.3  | Create useStreaming for stream state      | `presentation/hooks/use-streaming.ts` | P0       |
| 5.4  | Remove WorkspaceHooksBridge anti-pattern  | `providers/app-provider.tsx`          | P1       |
| 5.5  | Add proper cleanup to all hooks           | All hooks                             | P1       |

**Exit Criteria:**

- ✅ Hooks use commands, not direct API calls
- ✅ Each hook has single responsibility
- ✅ No null-rendering side-effect components
- ✅ All hooks have proper cleanup

### Phase 6: Cleanup & Optimization (Week 6-7)

**Goal:** Remove old code, optimize performance

| Task | Description                              | Files                                           | Priority |
| ---- | ---------------------------------------- | ----------------------------------------------- | -------- |
| 6.1  | Remove old providers                     | `providers/global-*.tsx`                        | P1       |
| 6.2  | Consolidate duplicate utilities          | `shared/utils/*`                                | P1       |
| 6.3  | Add performance monitoring               | `shared/utils/performance.ts`                   | P2       |
| 6.4  | Optimize list rendering (virtualization) | `presentation/components/chat/message-list.tsx` | P2       |
| 6.5  | Update all imports                       | All files                                       | P1       |

**Exit Criteria:**

- ✅ Old providers removed
- ✅ No duplicate utilities
- ✅ Performance metrics available
- ✅ Long lists render smoothly

### Research Delta Tasks (Must Include)

| Task | Description                                                                                                        | Files                                           | Priority |
| ---- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------- | -------- |
| R1   | Replace singleton store exports with provider-scoped store factories                                               | `core/stores/*`, `providers/*`                  | P0       |
| R2   | Add typed event contracts (`EventMap`) for bus + SSE payload parsing                                               | `infrastructure/events/*`                       | P0       |
| R3   | Add coordinator layer for cross-domain operations (delete session cascade, retry flows)                            | `core/coordinators/*`                           | P0       |
| R4   | Implement SSE resume/catch-up (`Last-Event-ID` + fallback refetch)                                                 | `infrastructure/events/event-source.ts`         | P0       |
| R5   | Enforce `<For>` list rendering + message virtualization for 500+ rows                                              | `presentation/components/chat/message-list.tsx` | P0       |
| R6   | Introduce persistence tiers: tiny persisted UI state + IndexedDB/API rehydration for history                       | `infrastructure/persistence/*`                  | P1       |
| R7   | Add anti-pattern lint/doc checks (no store destructuring, no state-copy effects)                                   | `shared/eslint/*`, docs                         | P1       |
| R8   | Consolidate all event routing on `@solid-primitives/event-bus` with typed wrappers (`createEmitter`, `batchEmits`) | `infrastructure/events/event-bus.ts`            | P0       |
| R9   | Add `@solid-primitives/storage` with `makePersisted` for UI state persistence                                      | `infrastructure/persistence/*`                  | P0       |
| R10  | Implement `@tanstack/solid-virtual` for message list virtualization                                                | `presentation/components/chat/message-list.tsx` | P0       |
| R11  | Fix `produce`/`reconcile` usage throughout codebase (use correct API patterns)                                     | All store files                                 | P0       |
| R12  | Replace `Set`/`Map` in stores with `Record<string, true>` or `Record<string, T>`                                   | All store files                                 | P1       |
| R13  | Remove hooks from factory functions (use dependency injection instead)                                             | All service/command files                       | P0       |
| R14  | Add `@solid-primitives/scheduled` for event coalescing (debounce, throttle, schedule)                              | `infrastructure/events/*`                       | P1       |

### Refined Execution Order (Dependency-First)

1. **Stabilize streaming runtime first (P0)**  
   Complete SSE lifecycle guarantees in existing providers: bounded queue, reconnect backoff, resume/catch-up behavior.
2. **Lock event and payload contracts (P0)**  
   Introduce typed `EventMap` and parser validation before broader store/context migration.
3. **Decouple domain boundaries (P0/P1)**  
   Add coordinators and split `useSync` responsibilities after event contracts are stable.
4. **Refactor presentation paths (P1)**  
   Move to smart-container + dumb-view components and domain contexts.
5. **Apply performance scaling changes (P1/P2)**  
   Add virtualization and profiling once data flow contracts stop changing.

---

## 4. Detailed Implementation Guides

### 4.1 EventSource Layer Implementation

**File:** `infrastructure/events/event-source.ts`

```typescript
import { batch } from "solid-js";
import { makeSubject, share, pipe } from "wonka";
import { Observable } from "wonka";

export interface ServerEvent {
  type: string;
  properties: Record<string, unknown>;
}

export interface EventSourceConfig {
  url: string;
  token: () => string;
  reconnectDelay: { base: number; max: number; jitter: number };
  heartbeatInterval: number;
  maxBufferedEvents: number;
  onCatchup: (lastEventId: string | null) => Promise<void>;
}

export interface EventSourceConnection {
  events: Observable<ServerEvent>;
  status: Accessor<"connecting" | "connected" | "disconnected" | "error">;
  connect: () => void;
  disconnect: () => void;
  error: Accessor<Error | null>;
}

export function createEventSource(config: EventSourceConfig): EventSourceConnection {
  // Reactive state
  const [status, setStatus] = createSignal<"connecting" | "connected" | "disconnected" | "error">(
    "disconnected"
  );
  const [error, setError] = createSignal<Error | null>(null);

  // Event stream using wonka for better Rx-like operators
  const { source: eventSource, next: emitEvent } = makeSubject<ServerEvent>();

  let eventSourceInstance: EventSource | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectAttempts = 0;
  let lastEventId: string | null = null;
  const eventBuffer: ServerEvent[] = [];

  const connect = () => {
    if (eventSourceInstance) return;

    setStatus("connecting");
    setError(null);

    try {
      const url = new URL(config.url);
      const token = config.token();
      if (token) url.searchParams.set("token", token);

      if (lastEventId) url.searchParams.set("lastEventId", lastEventId);
      eventSourceInstance = new EventSource(url.toString());

      eventSourceInstance.onopen = () => {
        setStatus("connected");
        reconnectAttempts = 0;
        scheduleHeartbeat();
      };

      eventSourceInstance.onmessage = event => {
        try {
          if (event.lastEventId) lastEventId = event.lastEventId;
          const parsed = JSON.parse(event.data) as ServerEvent;
          eventBuffer.push(parsed);
          if (eventBuffer.length > config.maxBufferedEvents) eventBuffer.shift();

          batch(() => {
            while (eventBuffer.length > 0) emitEvent(eventBuffer.shift()!);
          });
        } catch (err) {
          console.error("Failed to parse SSE event:", err);
        }
      };

      eventSourceInstance.onerror = async () => {
        setStatus("error");
        setError(new Error("EventSource connection failed"));
        cleanup();
        await config.onCatchup(lastEventId);
        scheduleReconnect();
      };
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err : new Error("Unknown error"));
      scheduleReconnect();
    }
  };

  const disconnect = () => {
    cleanup();
    setStatus("disconnected");
  };

  const cleanup = () => {
    if (eventSourceInstance) {
      eventSourceInstance.close();
      eventSourceInstance = null;
    }
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (heartbeatTimer) {
      clearTimeout(heartbeatTimer);
      heartbeatTimer = null;
    }
  };

  const scheduleReconnect = () => {
    const backoff = Math.min(
      config.reconnectDelay.base * Math.pow(2, reconnectAttempts),
      config.reconnectDelay.max
    );
    const jitter = Math.floor(Math.random() * config.reconnectDelay.jitter);
    const delay = backoff + jitter;
    reconnectAttempts++;
    reconnectTimer = setTimeout(connect, delay);
  };

  const scheduleHeartbeat = () => {
    heartbeatTimer = setTimeout(() => {
      if (eventSourceInstance && eventSourceInstance.readyState === EventSource.OPEN) {
        // Send a ping or check connection health
        // EventSource doesn't support client->server messages, so we rely on server heartbeat
      }
    }, config.heartbeatInterval);
  };

  // Shared observable for multiple subscribers
  const events = pipe(eventSource, share);

  onCleanup(() => cleanup());

  return {
    events,
    status,
    connect,
    disconnect,
    error,
  };
}
```

### 4.2 Event Bus Implementation

**File:** `infrastructure/events/event-bus.ts`

```typescript
import { batch } from "solid-js";

export type EventMap = {
  "message.created": { messageId: string; sessionId: string };
  "message.updated": { messageId: string; completedAt?: number };
  "message.status": { messageId: string; sessionId: string; status: string };
  "stream.error": { reason: string; recoverable: boolean };
};

export type EventHandler<T> = (event: T) => void;

export interface EventBus<E extends Record<string, unknown>> {
  on: <K extends keyof E>(event: K, handler: EventHandler<E[K]>) => () => void;
  emit: <K extends keyof E>(event: K, data: E[K]) => void;
  once: <K extends keyof E>(event: K, handler: EventHandler<E[K]>) => () => void;
  clear: () => void;
}

export function createEventBus<E extends Record<string, unknown>>(): EventBus<E> {
  const handlers = new Map<keyof E, Set<EventHandler<unknown>>>();

  const on = <K extends keyof E>(event: K, handler: EventHandler<E[K]>): (() => void) => {
    if (!handlers.has(event)) {
      handlers.set(event, new Set());
    }
    handlers.get(event)!.add(handler as EventHandler<unknown>);

    // Return unsubscribe function
    return () => {
      const eventHandlers = handlers.get(event);
      if (eventHandlers) {
        eventHandlers.delete(handler as EventHandler<unknown>);
        if (eventHandlers.size === 0) {
          handlers.delete(event);
        }
      }
    };
  };

  const emit = <K extends keyof E>(event: K, data: E[K]): void => {
    const eventHandlers = handlers.get(event);
    if (eventHandlers && eventHandlers.size > 0) {
      batch(() => {
        for (const handler of eventHandlers) {
          try {
            (handler as EventHandler<E[K]>)(data);
          } catch (error) {
            console.error(`Error in event handler for "${String(event)}":`, error);
          }
        }
      });
    }
  };

  const once = <K extends keyof E>(event: K, handler: EventHandler<E[K]>): (() => void) => {
    const wrappedHandler: EventHandler<E[K]> = data => {
      handler(data);
      unsubscribe();
    };

    const unsubscribe = on(event, wrappedHandler);
    return unsubscribe;
  };

  const clear = (): void => {
    handlers.clear();
  };

  return { on, emit, once, clear };
}

// ⚠️ DO NOT export module-level singleton!
// This violates SSR-safety and test isolation rules.
// Instead, create the event bus in AppProvider and provide via context.

// RECOMMENDED: Use @solid-primitives/event-bus for production
// import { createEmitter, batchEmits } from "@solid-primitives/event-bus";
//
// const emitter = batchEmits(createEmitter<AppEvents>());
// const { on, emit, clear } = emitter;
```

### 4.3 Domain Store Implementation

**File:** `core/domain/message/message-store.ts`

```typescript
import { createContext, useContext } from "solid-js";
import { produce, reconcile, batch } from "solid-js/store";
import { createStore } from "solid-js/store";

// Domain types
export interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  sessionId: string;
  parentId?: string;
  createdAt: number;
  completedAt?: number;
  metadata: Record<string, unknown>;
}

export interface MessageState {
  byId: Record<string, Message>;
  bySession: Record<string, string[]>; // sessionID -> message IDs in order
  loadedSessions: Record<string, true>; // Use Record instead of Set for serializability
}

// Initial state
const initialState: MessageState = {
  byId: {},
  bySession: {},
  loadedSessions: {},
};

export interface MessageStore {
  // State accessors
  getState: () => MessageState;
  getMessage: (id: string) => Message | undefined;
  getMessages: (sessionId: string) => Message[];
  isSessionLoaded: (sessionId: string) => boolean;

  // Actions
  addMessage: (message: Message) => void;
  updateMessage: (id: string, updates: Partial<Message>) => void;
  deleteMessage: (id: string) => void;
  ingestRemoteMessages: (messages: Message[]) => void; // For API responses
  setSessionLoaded: (sessionId: string, loaded: boolean) => void;
  clearSession: (sessionId: string) => void;
}

export function createMessageStore(): MessageStore {
  const [state, setState] = createStore<MessageState>({
    byId: {},
    bySession: {},
    loadedSessions: {},
  });

  const getState = () => state;

  const getMessage = (id: string): Message | undefined => {
    return state.byId[id];
  };

  const getMessages = (sessionId: string): Message[] => {
    const ids = state.bySession[sessionId] || [];
    return ids.map(id => state.byId[id]).filter(Boolean);
  };

  const isSessionLoaded = (sessionId: string): boolean => {
    return sessionId in state.loadedSessions;
  };

  const addMessage = (message: Message) => {
    setState("byId", message.id, message);

    // Add to session order
    const sessionMessages = state.bySession[message.sessionId] || [];
    if (!sessionMessages.includes(message.id)) {
      setState("bySession", message.sessionId, [...sessionMessages, message.id]);
    }
  };

  // FIXED: Use produce() for partial updates, NOT reconcile
  // reconcile is for merging entire collections from API
  const updateMessage = (id: string, updates: Partial<Message>) => {
    setState(
      "byId",
      id,
      produce(msg => {
        if (!msg) return;
        Object.assign(msg, updates);
      })
    );
  };

  // FIXED: Use produce for local mutations - only pass the recipe function
  // setState provides the draft internally
  const deleteMessage = (id: string) => {
    const message = state.byId[id];
    if (!message) return;

    // Remove from byId using produce (correct pattern)
    setState(
      "byId",
      produce(draft => {
        delete draft[id];
      })
    );

    // Remove from session order
    setState(
      "bySession",
      message.sessionId,
      produce(list => {
        const index = list.indexOf(id);
        if (index > -1) list.splice(index, 1);
      })
    );
  };

  // NEW: Use reconcile for ingesting entire collections from API
  // This performs deep diff and applies only necessary granular updates
  const ingestRemoteMessages = (messages: Message[]) => {
    setState("byId", reconcile(Object.fromEntries(messages.map(m => [m.id, m]))));
  };

  const addMessages = (messages: Message[]) => {
    batch(() => {
      for (const message of messages) {
        addMessage(message);
      }
    });
  };

  // FIXED: Use Record<string, true> instead of Set for serializability
  const setSessionLoaded = (sessionId: string, loaded: boolean) => {
    if (loaded) {
      setState("loadedSessions", sessionId, true);
    } else {
      setState(
        "loadedSessions",
        produce(sessions => {
          delete sessions[sessionId];
        })
      );
    }
  };

  const clearSession = (sessionId: string) => {
    const messageIds = state.bySession[sessionId] || [];

    batch(() => {
      // Remove all messages - using produce correctly
      for (const id of messageIds) {
        setState(
          "byId",
          produce(draft => {
            delete draft[id];
          })
        );
      }

      // Clear session order
      setState("bySession", sessionId, []);
      // Clear loaded flag
      setState(
        "loadedSessions",
        produce(sessions => {
          delete sessions[sessionId];
        })
      );
    });
  };

  return {
    getState,
    getMessage,
    getMessages,
    isSessionLoaded,
    addMessage,
    updateMessage,
    deleteMessage,
    ingestRemoteMessages,
    setSessionLoaded,
    clearSession,
  };
}

// Provider-scoped accessor (SSR-safe)
const MessageStoreContext = createContext<MessageStore | null>(null);

export function useMessageStore(): MessageStore {
  const ctx = useContext(MessageStoreContext);
  if (!ctx) throw new Error("useMessageStore must be used within MessageStoreProvider");
  return ctx;
}
```

### 4.4 Chat Commands Implementation

**File:** `core/domain/chat/chat-commands.ts`

```typescript
// FIXED: No hooks in factory functions - use dependency injection
import type { MessageStore } from "../message/message-store";
import type { PartStore } from "../part/part-store";
import type { ApiClient } from "@/infrastructure/api/types";
import type { Message } from "../message/types";

export interface SendMessageCommand {
  text: string;
  sessionId: string;
  workspace: string;
  signal?: AbortSignal;
}

export interface ChatCommands {
  sendMessage: (command: SendMessageCommand) => Promise<void>;
  stopMessage: (messageId: string) => void;
  retryMessage: (messageId: string) => Promise<void>;
}

// FIXED: Accept stores as parameters, NOT via hooks
// This makes the function framework-agnostic and testable
export interface ChatCommandsDependencies {
  apiClient: ApiClient;
  messageStore: MessageStore;
  partStore: PartStore;
}

export function createChatCommands(deps: ChatCommandsDependencies): ChatCommands {
  const { apiClient, messageStore, partStore } = deps;
  const activeRequests = new Map<string, AbortController>();

  const sendMessage = async (command: SendMessageCommand): Promise<void> => {
    const { text, sessionId, workspace, signal } = command;

    // Create optimistic message
    const messageId = crypto.randomUUID();
    const userMessage: Message = {
      id: messageId,
      role: "user",
      sessionId,
      createdAt: Date.now(),
      metadata: { workspace },
    };

    // Add optimistically
    messageStore.addMessage(userMessage);

    // Set up abort controller
    const abortController = new AbortController();
    activeRequests.set(messageId, abortController);

    // Combine signals
    const combinedSignal = signal
      ? AbortSignal.any([signal, abortController.signal])
      : abortController.signal;

    try {
      // Initiate stream (the actual updates come via SSE)
      const response = await apiClient.chat.sendMessage(
        {
          message: text,
          sessionId,
          messageId,
          workspace,
          stream: true,
        },
        { signal: combinedSignal }
      );

      // Consume stream to completion (but don't parse - SSE handles that)
      const reader = response.body?.getReader();
      if (reader) {
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          // Decode but don't process - SSE events handle updates
          decoder.decode(value, { stream: true });
        }
      }

      // Mark as complete
      messageStore.updateMessage(messageId, {
        completedAt: Date.now(),
      });
    } catch (error) {
      // Handle error
      if ((error as Error).name !== "AbortError") {
        console.error("Failed to send message:", error);
        // Add error part
        partStore.addPart({
          id: crypto.randomUUID(),
          messageId,
          type: "error",
          content: {
            message: (error as Error).message,
          },
        });
      }
    } finally {
      activeRequests.delete(messageId);
    }
  };

  const stopMessage = (messageId: string): void => {
    const controller = activeRequests.get(messageId);
    if (controller) {
      controller.abort();
      activeRequests.delete(messageId);
    }
  };

  const retryMessage = async (messageId: string): Promise<void> => {
    const message = messageStore.getMessage(messageId);
    if (!message || message.role !== "user") {
      throw new Error("Can only retry user messages");
    }

    // Get the original text from parts
    const parts = partStore.getParts(messageId);
    const textPart = parts.find(p => p.type === "text");
    if (!textPart) {
      throw new Error("No text part found");
    }

    // Send new message with same content
    await sendMessage({
      text: textPart.content.text,
      sessionId: message.sessionId,
      workspace: message.metadata.workspace as string,
    });
  };

  return {
    sendMessage,
    stopMessage,
    retryMessage,
  };
}

// Context hook for components (still valid in presentation layer)
export function useChatCommands(): ChatCommands {
  // This will be provided by the app provider
  const context = useContext(ChatCommandsContext);
  if (!context) {
    throw new Error("useChatCommands must be used within ChatCommandsProvider");
  }
  return context;
}
```

### 4.5 Typing Indicator Fix

**File:** `presentation/components/chat/typing-indicator.tsx`

```typescript
import { Component } from 'solid-js';
import { cn } from '@/shared/utils/classnames';

export interface TypingIndicatorProps {
  class?: string;
}

export const TypingIndicator: Component<TypingIndicatorProps> = (props) => {
  return (
    <div
      class={cn(
        "mb-4 flex items-center gap-2 animate-fade-in-up",
        props.class
      )}
    >
      <div class="rounded-xl px-4 py-3 bg-card/30 border border-border/30">
        <div class="flex gap-1 items-center">
          <span
            class="typing-dot bg-primary/60 h-2 w-2 rounded-full"
            style="animation: typing-bounce 1.4s infinite ease-in-out both;"
          />
          <span
            class="typing-dot bg-primary/60 h-2 w-2 rounded-full"
            style="animation: typing-bounce 1.4s infinite ease-in-out both; animation-delay: 0.16s;"
          />
          <span
            class="typing-dot bg-primary/60 h-2 w-2 rounded-full"
            style="animation: typing-bounce 1.4s infinite ease-in-out both; animation-delay: 0.32s;"
          />
        </div>
      </div>
    </div>
  );
};

// Add this to your global CSS or component styles
const typingKeyframes = `
  @keyframes typing-bounce {
    0%, 80%, 100% {
      transform: scale(0.8);
      opacity: 0.5;
    }
    40% {
      transform: scale(1);
      opacity: 1;
    }
  }

  .typing-dot {
    display: inline-block;
  }

  @keyframes fade-in-up {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .animate-fade-in-up {
    animation: fade-in-up 0.2s ease-out forwards;
  }
`;
```

### 4.6 App Provider (Simplified)

**File:** `providers/app-provider.tsx`

```typescript
import { Component, createContext, JSX, useContext, onCleanup, onMount } from 'solid-js';
import { createEventSource } from '@/infrastructure/events/event-source';
import { createEventBus, EventBus, EventMap } from '@/infrastructure/events/event-bus';
import { createChatCommands, ChatCommands } from '@/core/domain/chat/chat-commands';
import { ApiClient, createApiClient } from '@/infrastructure/api/api-client';
import { createStoreScope, StoreScopeProvider } from '@/core/stores';

interface AppConfig {
  baseUrl: string;
  token: () => string;
  workspace: string;
}

interface AppContextValue {
  eventSource: ReturnType<typeof createEventSource>;
  eventBus: EventBus<EventMap>;
  commands: ChatCommands;
  apiClient: ApiClient;
}

const AppContext = createContext<AppContextValue | null>(null);

export const AppProvider: Component<{ config: AppConfig; children: JSX.Element }> = (props) => {
  const stores = createStoreScope(); // provider-scoped stores

  // Create infrastructure
  const apiClient = createApiClient({
    baseUrl: props.config.baseUrl,
    token: props.config.token,
  });

  const eventSource = createEventSource({
    url: `${props.config.baseUrl}/event`,
    token: props.config.token,
    reconnectDelay: { base: 1000, max: 30000, jitter: 500 },
    heartbeatInterval: 30000,
    maxBufferedEvents: 200,
    onCatchup: (lastEventId) => apiClient.chat.catchup({ workspace: props.config.workspace, lastEventId }),
  });

  const eventBus = createEventBus<EventMap>();

  // Create commands
  const commands = createChatCommands({ apiClient, stores });

  // Wire up event source to event bus
  eventSource.events.subscribe({
    next: (event) => {
      // Route events to appropriate handlers
      eventBus.emit(event.type as keyof EventMap, event.properties as EventMap[keyof EventMap]);
    },
    error: (err) => {
      console.error('EventSource error:', err);
    },
  });

  // Connect on mount
  onMount(() => {
    eventSource.connect();
  });

  // Disconnect on cleanup
  onCleanup(() => {
    eventSource.disconnect();
  });

  const contextValue: AppContextValue = {
    eventSource,
    eventBus,
    commands,
    apiClient,
  };

  return (
    <AppContext.Provider value={contextValue}>
      <StoreScopeProvider value={stores}>{props.children}</StoreScopeProvider>
    </AppContext.Provider>
  );
};

export function useApp(): AppContextValue {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within AppProvider');
  }
  return context;
}
```

### 4.7 Simplified useChat Hook

**File:** `presentation/hooks/use-chat.ts`

```typescript
import { createMemo, createSignal, onCleanup } from "solid-js";
import { useApp } from "@/providers/app-provider";
import { useMessageStore, usePartStore } from "@/core/stores";
import type { Message } from "@/core/domain/message/types";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  parts: Part[];
  createdAt: number;
  completedAt?: number;
}

export interface UseChatOptions {
  sessionId: () => string | null;
  workspace: () => string;
}

export interface UseChatResult {
  // State
  messages: () => ChatMessage[];
  status: () => "idle" | "connecting" | "streaming" | "done" | "error";
  error: () => Error | null;
  isLoading: () => boolean;
  canSend: () => boolean;

  // Actions
  sendMessage: (text: string) => Promise<void>;
  stop: () => void;
  retry: (messageId: string) => Promise<void>;
}

export function useChat(options: UseChatOptions): UseChatResult {
  const app = useApp();
  const messageStore = useMessageStore();
  const partStore = usePartStore();

  // Local UI state
  const [status, setStatus] = createSignal<"idle" | "connecting" | "streaming" | "done" | "error">(
    "idle"
  );
  const [error, setError] = createSignal<Error | null>(null);
  const [activeMessageId, setActiveMessageId] = createSignal<string | null>(null);

  // Memoized messages projection
  const messages = createMemo<ChatMessage[]>(() => {
    const sessionId = options.sessionId();
    if (!sessionId) return [];

    const rawMessages = messageStore.getMessages(sessionId);
    return rawMessages.map(
      (msg): ChatMessage => ({
        id: msg.id,
        role: msg.role,
        content: "", // Computed from parts
        parts: partStore.getParts(msg.id),
        createdAt: msg.createdAt,
        completedAt: msg.completedAt,
      })
    );
  });

  const isLoading = () => status() === "connecting" || status() === "streaming";
  const canSend = () => ["idle", "done", "error"].includes(status()) && !!options.sessionId();

  const sendMessage = async (text: string): Promise<void> => {
    const sessionId = options.sessionId();
    if (!sessionId) {
      setError(new Error("No active session"));
      setStatus("error");
      return;
    }

    setStatus("connecting");
    setError(null);

    try {
      setStatus("streaming");
      await app.commands.sendMessage({
        text,
        sessionId,
        workspace: options.workspace(),
      });
      setStatus("done");
    } catch (err) {
      setError(err as Error);
      setStatus("error");
    }
  };

  const stop = () => {
    const messageId = activeMessageId();
    if (messageId) {
      app.commands.stopMessage(messageId);
      setStatus("done");
    }
  };

  const retry = async (messageId: string): Promise<void> => {
    setStatus("connecting");
    setError(null);
    try {
      await app.commands.retryMessage(messageId);
      setStatus("streaming");
    } catch (err) {
      setError(err as Error);
      setStatus("error");
    }
  };

  // Listen for status changes from event bus
  const unsubscribe = app.eventBus.on("message.status", event => {
    if (event.sessionId === options.sessionId()) {
      setStatus(event.status as "idle" | "connecting" | "streaming" | "done" | "error");
      if (event.messageId) {
        setActiveMessageId(event.messageId);
      }
    }
  });

  onCleanup(unsubscribe);

  return {
    messages,
    status,
    error,
    isLoading,
    canSend,
    sendMessage,
    stop,
    retry,
  };
}
```

### 4.7.1 Research-Aligned Corrections (Supersedes Conflicting Snippets)

The following patterns are mandatory even where earlier examples differ.

#### A) Store Creation Pattern (No Singleton)

```typescript
// core/stores/message-store.ts
export const createMessageStore = () => {
  const [state, setState] = createStore<MessageStoreState>(initialMessageState);

  const ingestRemote = (messages: Message[]) => setState("byId", reconcile(indexById(messages)));

  const patchLocal = (id: string, recipe: (draft: Message) => void) =>
    setState("byId", id, produce(recipe));

  return { state, ingestRemote, patchLocal };
};
```

```typescript
// providers/message-provider.tsx
const MessageContext = createContext<ReturnType<typeof createMessageStore>>();
export function MessageProvider(props: ParentProps) {
  const store = createMessageStore(); // new instance per provider/request
  return <MessageContext.Provider value={store}>{props.children}</MessageContext.Provider>;
}
```

#### B) Typed Event Bus Contract

```typescript
type AppEvents = {
  "message.created": { messageId: string; sessionId: string };
  "message.updated": { messageId: string; completedAt?: number };
  "stream.error": { reason: string; recoverable: boolean };
};

interface EventBus<E extends Record<string, unknown>> {
  emit<K extends keyof E>(event: K, payload: E[K]): void;
  on<K extends keyof E>(event: K, handler: (payload: E[K]) => void): () => void;
}
```

#### C) SSE Lifecycle and Reconnect Requirements

```typescript
// infrastructure/events/event-source.ts
// Requirements:
// 1) close EventSource in onCleanup
// 2) batch all store updates from message bursts
// 3) exponential backoff + jitter
// 4) resume from lastEventId, else fallback full refetch
// delay = min(base * 2^attempt, max) + random(0..jitter)
```

#### D) Cross-Domain Coordinator Pattern

```typescript
// core/coordinators/conversation-coordinator.ts
export function createConversationCoordinator(deps: {
  sessions: SessionStore;
  messages: MessageStore;
  parts: PartStore;
}) {
  const deleteConversation = (sessionId: string) => {
    const ids = deps.messages.state.bySession[sessionId] ?? [];
    batch(() => {
      ids.forEach(id => deps.parts.clearByMessage(id));
      deps.messages.clearSession(sessionId);
      deps.sessions.delete(sessionId);
    });
  };

  return { deleteConversation };
}
```

---

### 4.7.2 SolidJS Idioms & Best Practices

This section covers fundamental SolidJS patterns that are critical for writing performant, maintainable code. These idioms are often misunderstood by developers coming from React or other frameworks.

#### A) Components Are Setup Functions, Not Render Functions

**The Mental Model Shift:**

In React, components are render functions that re-execute on every state change. In SolidJS, components run **once** during initialization to set up the reactive graph and return JSX.

```typescript
// ❌ React thinking - WRONG in SolidJS
function MyComponent() {
  // This runs EVERY time someState changes
  const derived = expensiveCalculation(someState());
  return <div>{derived}</div>;
}

// ✅ SolidJS thinking - CORRECT
function MyComponent() {
  // This runs ONCE during initialization
  const derived = createMemo(() => expensiveCalculation(someState()));
  // Only derived() will re-compute when someState changes
  return <div>{derived()}</div>;
}
```

**Key Implications:**

- Component body executes once, not on every state change
- Use `createMemo` for derived values that should update reactively
- Use `createEffect` only for side effects (API calls, DOM manipulation, third-party libs)
- Don't put expensive calculations directly in component body

#### B) Preserve Props Reactivity

**The Anti-Pattern: Destructuring Props**

```typescript
// ❌ WRONG - Destructuring breaks reactivity
interface Props {
  name: string;
  count: number;
}

function MyComponent({ name, count }: Props) {
  // name and count are static values, not reactive!
  return <div>{name}: {count}</div>;
}
```

**Why It Fails:**
When you destructure props in the function signature, SolidJS calls the reactive getters immediately, extracting static values and breaking the reactive connection.

**The Correct Pattern:**

```typescript
// ✅ CORRECT - Access props directly
interface Props {
  name: string;
  count: number;
}

function MyComponent(props: Props) {
  // Access props directly in tracking scope (JSX or createMemo)
  return (
    <div>
      {props.name}: {props.count}
    </div>
  );
}
```

**Using splitProps Utility:**

When you need to separate props for different purposes:

```typescript
import { splitProps } from "solid-js";

interface Props {
  name: string;
  age: number;
  class?: string;
  style?: string;
}

function MyComponent(props: Props) {
  const [local, others] = splitProps(props, ["name", "age"]);

  return (
    <div class={others.class} style={others.style}>
      {local.name}: {local.age}
    </div>
  );
}
```

#### C) Control Flow Components

**Use SolidJS Control Flow Primitives:**

```typescript
// ❌ Avoid inline ternary/&& for complex conditions
{condition ? <ComponentA /> : <ComponentB />}
{condition && <Component />}

// ✅ Use SolidJS components (compiler can optimize)
<Show when={condition()} fallback={<ComponentB />}>
  <ComponentA />
</Show>

<Show when={condition()}>
  <Component />
</Show>
```

**For Lists: Critical Distinction**

```typescript
// ✅ <For> - For object-based data with stable references
// Items are tracked by reference, NOT index
<For each={messages()} fallback={<div>No messages</div>}>
  {(message) => (
    <MessageBubble messageId={message.id} />
  )}
</For>

// ✅ <Index> - For primitive values where position matters
// Items are tracked by index position
<Index each={items()}>
  {(item, index) => (
    <div>{index()}: {item()}</div>
  )}
</Index>
```

**Rule of Thumb:**

- Use `<For>` for message lists, user lists, any object-based mutable data
- Use `<Index>` for strings, numbers, or when index position is meaningful

#### D) Path Syntax for O(1) Updates

**The Power of Path Syntax:**

```typescript
const [store, setStore] = createStore({
  users: {
    "user-1": { name: "Alice", address: { city: "NYC" } },
    "user-2": { name: "Bob", address: { city: "LA" } },
  },
});

// ✅ O(1) direct path update - only notifies observers of users.user-1.address.city
setStore("users", "user-1", "address", "city", "Mumbai");

// ❌ O(n) immutable pattern - clones entire object
setStore("users", {
  ...store.users,
  "user-1": {
    ...store.users["user-1"],
    address: {
      ...store.users["user-1"].address,
      city: "Mumbai",
    },
  },
});
```

**Advanced Path Syntax:**

```typescript
// Array operations
setStore(
  "items",
  produce(items => {
    items.push({ id: 1, name: "New" }); // Works with produce
  })
);

// Range operations
setStore("list", { from: 5, to: 10, by: 2 }, value => value * 2);

// Filter function
setStore(
  "users",
  produce(users => {
    delete users["user-1"];
  })
);
```

#### E) Normalized State Pattern

**Structure:**

```typescript
interface NormalizedState<T> {
  byId: Record<string, T>; // O(1) lookup by ID
  allIds: string[]; // Ordered list for rendering
  // Additional indexes as needed
  byCategory: Record<string, string[]>; // O(1) filter by category
}
```

**Benefits:**

- O(1) entity lookups instead of O(n) array searches
- Single source of truth - no data duplication
- Easy to add/remove entities without complex array operations
- Components can subscribe to specific IDs

#### F) Memoization Strategy

**When to Use createMemo:**

```typescript
// ✅ Use for expensive derived computations
const sortedMessages = createMemo(() => messages().sort((a, b) => b.createdAt - a.createdAt));

// ✅ Use for filtering
const userMessages = createMemo(() => messages().filter(m => m.userId === currentUserId()));

// ✅ Use for complex conditions
const canSendMessage = createMemo(() => hasPermission() && isConnected() && !isSending());

// ❌ Don't use for simple transformations
const displayName = () => `${user().firstName} ${user().lastName}`;
```

#### G) Batch Updates for Performance

```typescript
import { batch } from "solid-js";

// Without batch: 3 re-renders
addItem(item);
updateCount();
setStatus("ready");

// With batch: 1 re-render
batch(() => {
  addItem(item);
  updateCount();
  setStatus("ready");
});
```

**When to Batch:**

- Multiple store updates in sequence
- Responding to events that trigger multiple state changes
- Processing API responses that update multiple entities

---

## 4.8 Domain Context Pattern: Dumb Components

**Important refinement:** Contexts are consumed by smart/container components and hooks. Presentational components should remain dumb and receive plain props whenever possible.

**Problem:** Components receive too many props, making them hard to understand and refactor.

```typescript
// ❌ BEFORE: Prop drilling nightmare
<MessageBubble
  message={props.message}
  parts={props.parts}
  sessionId={props.sessionId}
  workspace={props.workspace}
  isGenerating={props.isGenerating}
  canRetry={props.canRetry}
  onRetry={props.onRetry}
  onDelete={props.onDelete}
  onCopy={props.onCopy}
  sync={props.sync}
  status={props.status}
/>

// 10+ props passed down through multiple layers!
```

**Solution:** Domain Contexts - Components consume state from well-organized contexts.

```typescript
// ✅ AFTER: Clean, simple component
<MessageBubble messageId={message.id} />
//                     ^^^^ Only the identifier needed!
```

### 4.8.1 What Are Domain Contexts?

Domain contexts are **organized by business domain**, not by component tree. Each domain provides the state and operations that components in that domain need.

```
┌─────────────────────────────────────────────────────────────────┐
│                     DOMAIN CONTEXTS                             │
├─────────────────────────────────────────────────────────────────┤
│  MessageContext  │  PartContext  │  SessionContext  │  UIContext │
│                  │              │                 │            │
│  • messages      │  • parts     │  • sessions     │  • focus   │
│  • getStatus     │  • getByMsg  │  • active       │  • modal   │
│  • retry         │  • update    │  • create       │  • panel   │
│  • delete        │              │                 │            │
└──────────────────┴──────────────┴─────────────────┴────────────┘
```

### 4.8.2 Context Design by Domain

**File:** `presentation/contexts/message-context.tsx`

```typescript
import { createContext, useContext, Accessor, JSX, Component } from 'solid-js';
import { useMessageStore } from '@/core/stores';
import type { Message } from '@/core/domain/message/types';

// ==================== CONTEXT DEFINITION ====================

interface MessageContextValue {
  // Read operations
  getMessage: (id: string) => Message | undefined;
  getMessages: (sessionId: string) => Message[];
  getStatus: (id: string) => MessageStatus;

  // Write operations
  retry: (id: string) => Promise<void>;
  delete: (id: string) => void;
  copy: (id: string) => void;
}

const MessageContext = createContext<MessageContextValue | null>(null);

// ==================== PROVIDER COMPONENT ====================

export const MessageProvider: Component<{ children: JSX.Element }> = (props) => {
  const messageStore = useMessageStore();
  const app = useApp();

  // Status computation
  const getStatus = (id: string): MessageStatus => {
    const message = messageStore.getMessage(id);
    if (!message) return 'unknown';
    if (!message.completedAt) return 'pending';
    // Add more status logic as needed
    return 'complete';
  };

  // Operations
  const retry = async (id: string) => {
    await app.commands.retryMessage(id);
  };

  const deleteMsg = (id: string) => {
    messageStore.deleteMessage(id);
  };

  const copy = (id: string) => {
    const message = messageStore.getMessage(id);
    if (message) {
      navigator.clipboard.writeText(/* extract text */);
    }
  };

  const value: MessageContextValue = {
    getMessage: messageStore.getMessage,
    getMessages: messageStore.getMessages,
    getStatus,
    retry,
    delete: deleteMsg,
    copy,
  };

  return (
    <MessageContext.Provider value={value}>
      {props.children}
    </MessageContext.Provider>
  );
};

// ==================== HOOK FOR CONSUMING ====================

export function useMessage(): MessageContextValue {
  const context = useContext(MessageContext);
  if (!context) {
    throw new Error('useMessage must be used within MessageProvider');
  }
  return context;
}

// ==================== CONVENIENCE HOOKS ====================

// Hook for a single message
export function useMessageById(messageId: Accessor<string>) {
  const message = useMessage();
  const store = useMessageStore();

  const data = createMemo(() => {
    return store.getMessage(messageId());
  });

  const status = createMemo(() => {
    return message.getStatus(messageId());
  });

  return {
    get message() { return data(); },
    get status() { return status(); },
    retry: () => message.retry(messageId()),
    delete: () => message.delete(messageId()),
    copy: () => message.copy(messageId()),
  };
}

// Hook for all messages in a session
export function useSessionMessages(sessionId: Accessor<string>) {
  const message = useMessage();
  const store = useMessageStore();

  const messages = createMemo(() => {
    return store.getMessages(sessionId());
  });

  return {
    get messages() { return messages(); },
    retry: (id: string) => message.retry(id),
    delete: (id: string) => message.delete(id),
  };
}
```

### 4.8.3 All Domain Contexts

**File:** `presentation/contexts/index.ts` (Barrel exports)

```typescript
// Message Domain
export { MessageProvider, useMessage, useMessageById, useSessionMessages } from "./message-context";

// Part Domain
export { PartProvider, usePart, usePartByMessageId } from "./part-context";

// Session Domain
export { SessionProvider, useSession, useActiveSession } from "./session-context";

// UI Domain (ephemeral state)
export { UIProvider, useUI, useFocus, useModal } from "./ui-context";
```

### 4.8.4 Before & After: Component Transformation

#### BEFORE: Props Hell

```typescript
// File: components/message-bubble.tsx
interface MessageBubbleProps {
  message: Message;
  parts: Part[];
  sessionId: string;
  workspace: string;
  isGenerating: boolean;
  canRetry: boolean;
  onRetry: (id: string) => void;
  onDelete: (id: string) => void;
  onCopy: (id: string) => void;
  sync: SyncProvider;
  status: MessageStatus;
}

export const MessageBubble: Component<MessageBubbleProps> = (props) => {
  // 10+ props to handle!
  const status = () => props.status;
  const canRetry = () => props.canRetry && props.message.role === 'user';

  const handleRetry = () => {
    props.onRetry(props.message.id);
  };

  const handleDelete = () => {
    props.onDelete(props.message.id);
  };

  const parts = () => {
    const storeParts = props.sync.data.part[props.message.id];
    return storeParts ?? props.parts;
  };

  return (
    <div>
      {/* rendering logic */}
      <Show when={canRetry()}>
        <button onClick={handleRetry}>Retry</button>
      </Show>
    </div>
  );
};
```

#### AFTER: Clean & Simple

```typescript
// File: components/message-bubble.tsx
interface MessageBubbleProps {
  messageId: string;  // ← Only ONE prop!
}

export const MessageBubble: Component<MessageBubbleProps> = (props) => {
  // Consume from domain contexts
  const message = useMessageById(() => props.messageId);
  const parts = usePartsByMessageId(() => props.messageId);
  const ui = useUI();  // For UI-specific state

  // All data comes from contexts!
  const canRetry = () => message.status === 'failed' && message.message?.role === 'user';

  const handleRetry = () => {
    message.retry();  // No need to pass ID!
  };

  return (
    <div class={cn('message-bubble', ui.focusedId() === props.messageId && 'focused')}>
      {/* rendering logic */}
      <Show when={canRetry()}>
        <button onClick={handleRetry}>Retry</button>
      </Show>
    </div>
  );
};
```

### 4.8.5 When to Use Props vs Context

| Use Props When                                 | Use Context When                               |
| ---------------------------------------------- | ---------------------------------------------- |
| **Configuration** (variant, size, theme)       | **Domain Data** (messages, parts, sessions)    |
| **One-off behavior** (onClick, onChange)       | **Shared operations** (retry, delete, copy)    |
| **Pure presentation** (class names, styles)    | **State from stores** (status, loading, error) |
| **Component-specific** (this component only)   | **Cross-component** (used by many components)  |
| **Primitive values** (string, number, boolean) | **Complex objects** (message, part, session)   |

### 4.8.6 Domain Context Catalog

#### MessageContext

```typescript
// What it provides:
- getMessage(id): Message | undefined
- getMessages(sessionId): Message[]
- getStatus(id): MessageStatus
- retry(id): Promise<void>
- delete(id): void
- copy(id): void

// Used by:
- MessageBubble
- MessageList
- SessionTurn
- ChatArea
```

#### PartContext

```typescript
// What it provides:
- getParts(messageId): Part[]
- getPart(id): Part | undefined
- updateText(partId, text): void
- isStreaming(messageId): boolean

// Used by:
- MessageBubble
- Part components
- ToolCallPart
- TextPart
```

#### SessionContext

```typescript
// What it provides:
- getActiveSession(): Session | undefined
- getSession(id): Session | undefined
- getAllSessions(): Session[]
- setActive(id): void
- createSession(): Promise<string>

// Used by:
- SessionList
- SessionHeader
- ChatArea
- Sidebar
```

#### UIContext

```typescript
// What it provides:
- focusedId: Accessor<string | null>
- setFocusedId(id): void
- openPanels: Accessor<string[]>
- togglePanel(id): void
- isModalOpen: Accessor<boolean>
- openModal(): void
- closeModal(): void

// Used by:
- All interactive components
- Modal system
- Panel system
- Keyboard shortcuts
```

### 4.8.7 Provider Tree (Simplified)

```typescript
// File: providers/app-provider.tsx
export const AppProvider: Component<{ children: JSX.Element }> = (props) => {
  return (
    <AppRootProvider>        {/* Infrastructure (EventSource, API) */}
      <MessageProvider>      {/* Message domain */}
        <PartProvider>       {/* Part domain */}
          <SessionProvider>  {/* Session domain */}
            <UIProvider>     {/* UI ephemeral state */}
              {props.children}
            </UIProvider>
          </SessionProvider>
        </PartProvider>
      </MessageProvider>
    </AppRootProvider>
  );
};
```

### 4.8.8 Component Examples with Domain Contexts

#### TypingIndicator - Zero Props

```typescript
// components/chat/typing-indicator.tsx
export const TypingIndicator: Component = () => {
  const chat = useChat();  // Hook provides all needed state

  return (
    <Show when={chat.isStreaming()}>
      <div class="typing-indicator">
        <span class="dot" />
        <span class="dot" />
        <span class="dot" />
      </div>
    </Show>
  );
};
```

#### MessageList - Only Needs Session

```typescript
// components/chat/message-list.tsx
interface MessageListProps {
  sessionId: string;  // ← Only needs to know WHICH session
}

export const MessageList: Component<MessageListProps> = (props) => {
  const messages = useSessionMessages(() => props.sessionId);
  const ui = useUI();

  return (
    <div class="message-list">
      <For each={messages.messages()}>
        {(message) => (
          <MessageBubble
            messageId={message.id}
            class={ui.focusedId() === message.id ? 'focused' : ''}
          />
        )}
      </For>
    </div>
  );
};
```

#### ToolCallPart - Clean & Focused

```typescript
// components/parts/tool-call-part.tsx
interface ToolCallPartProps {
  partId: string;  // ← Only needs part ID
}

export const ToolCallPart: Component<ToolCallPartProps> = (props) => {
  const part = usePartById(() => props.partId);
  const message = useMessageById(() => part()?.messageId);

  const statusConfig = createMemo(() => {
    switch (part()?.status) {
      case 'pending': return { icon: 'clock', color: 'text-muted' };
      case 'executing': return { icon: 'spinner', color: 'text-primary' };
      case 'completed': return { icon: 'check', color: 'text-green-500' };
      case 'failed': return { icon: 'x', color: 'text-destructive' };
    }
  });

  return (
    <div class="tool-call-part">
      <span class={statusConfig().color}>{statusConfig().icon}</span>
      <span>{part()?.toolName}</span>
    </div>
  );
};
```

### 4.8.9 Migration Strategy for Props → Context

1. **Identify prop clusters** - Groups of related props (message, parts, session)
2. **Create domain context** - One context per domain
3. **Move to provider** - Put data fetching/operations in context
4. **Update component** - Replace props with context hooks
5. **Simplify props interface** - Keep only configuration props

```typescript
// Step 1: Identify clusters
interface Props {
  message;
  parts;
  status; // ← Message domain
  session;
  sessionId; // ← Session domain
  focusId;
  setFocusId; // ← UI domain
  variant;
  size; // ← Config props (keep these!)
}

// Step 2: Create contexts
(MessageContext, SessionContext, UIContext);

// Step 3: Update component
export const Component = (props: { variant?: "default" | "compact" }) => {
  const message = useMessage();
  const session = useSession();
  const ui = useUI();

  // Use data from contexts instead of props
  // ...
};
```

### 4.8.10 Best Practices

✅ **DO:**

- Organize contexts by **business domain** (Message, Part, Session)
- Keep contexts **focused** on one domain
- Export **convenience hooks** (`useMessageById`, `useActiveSession`)
- Use **accessor functions** for reactive values
- Make **operations self-contained** (no ID arguments needed)

❌ **DON'T:**

- Create contexts per component ( defeats the purpose!)
- Put everything in one giant context
- Pass both props AND context for the same data
- Use context for **configuration** (variant, size, theme)
- Create deeply nested context providers

---

## 4.9 Data Structure Reference

This section documents the complete data shape at each layer of the architecture.

### 4.9.1 Domain Model Types

#### Message Type

```typescript
// core/domain/message/types.ts

export interface Message {
  // Identity
  id: string; // UUID v7 identifier
  sessionId: string; // Belongs to this session

  // Core
  role: "user" | "assistant" | "system";
  parentId?: string; // For assistant responses (links to user message)

  // Timestamps
  createdAt: number; // Unix timestamp (ms)
  completedAt?: number; // When finished streaming

  // Metadata
  metadata: MessageMetadata;
}

export interface MessageMetadata {
  // Workspace context
  workspace?: string;
  directory?: string;

  // Mode (for future use)
  mode?: "chat" | "plan" | "build";

  // RLM tracking
  rlmSessionId?: string;
  rlmState?: RLMStateData;

  // Error state
  error?: {
    type: string;
    message: string;
    code?: string;
  };
}

// Status derived from Message
export type MessageStatus =
  | "pending" // Created, not started
  | "streaming" // Receiving content
  | "thinking" // Reasoning/planning
  | "working" // Using tools
  | "complete" // Done
  | "failed" // Error occurred
  | "stopped"; // User stopped it
```

#### Part Type

```typescript
// core/domain/part/types.ts

export type Part = TextPart | ToolCallPart | ToolResultPart | ReasoningPart | DataPart;

// ===== TEXT PART =====
export interface TextPart {
  id: string;
  messageId: string;
  type: "text";
  content: {
    text: string; // The actual text content
  };
  order: number; // Order within message
}

// ===== TOOL CALL PART =====
export interface ToolCallPart {
  id: string;
  messageId: string;
  type: "tool-call";
  content: {
    toolName: string; // e.g., 'read', 'edit', 'bash'
    toolCallId: string; // Links to result
    args?: Record<string, unknown>; // Tool arguments (streamed in)
  };
  status: ToolCallStatus;
  order: number;
}

export type ToolCallStatus =
  | "pending" // Created, args not yet received
  | "executing" // Tool is running
  | "completed" // Tool finished
  | "failed"; // Tool error

// ===== TOOL RESULT PART =====
export interface ToolResultPart {
  id: string;
  messageId: string;
  type: "tool-result";
  content: {
    toolName?: string;
    toolCallId: string; // Links to call
    result?: unknown; // Tool output
    error?: string; // Error message if failed
  };
  order: number;
}

// ===== REASONING PART =====
export interface ReasoningPart {
  id: string;
  messageId: string;
  type: "reasoning";
  content: {
    text?: string; // Reasoning content (streamed)
    currentThought?: string; // Current thinking step
    thoughtNumber?: number; // Which step we're on
    totalThoughts?: number; // Total steps
  };
  order: number;
}

// ===== DATA PART =====
export type DataPart = RLMStatePart | ProgressPart | ErrorPart;

export interface RLMStatePart {
  id: string;
  messageId: string;
  type: "data-rlm-state";
  content: {
    state: RLMStateData;
  };
  order: number;
  transient?: boolean; // Don't persist this part
}

export interface ProgressPart {
  id: string;
  messageId: string;
  type: "data-progress";
  content: {
    current: number;
    total: number;
    message?: string;
  };
  order: number;
  transient?: boolean;
}

export interface ErrorPart {
  id: string;
  messageId: string;
  type: "data-error";
  content: {
    error: string;
    details?: unknown;
  };
  order: number;
}
```

#### Session Type

```typescript
// core/domain/session/types.ts

export interface Session {
  id: string; // UUID v7
  title: string; // Display name (from first message)
  workspace: string; // Workspace directory
  directory: string; // Alias for workspace

  // Timestamps
  createdAt: number;
  updatedAt: number;
  lastMessageAt?: number;

  // State
  status: SessionStatus;

  // Thread management (server-side)
  threadId?: string;
  resourceId?: string;

  // Messages
  messageIds: string[]; // Ordered list of message IDs

  // Metadata
  metadata: SessionMetadata;
}

export type SessionStatus =
  | "active" // Current session
  | "archived" // Old session
  | "deleted";

export interface SessionMetadata {
  messageCount?: number; // Cached count
  hasErrors?: boolean; // Any failed operations?
  model?: string; // AI model used
}
```

### 4.9.2 Store Structures

#### MessageStore State

```typescript
// core/stores/message-store.ts

export interface MessageStoreState {
  // Normalized storage
  byId: Record<string, Message>; // All messages by ID
  bySession: Record<string, string[]>; // Session -> ordered message IDs

  // Indexes for fast lookup
  byParent: Record<string, string[]>; // Parent -> child message IDs
  byStatus: Record<MessageStatus, string[]>; // Status -> message IDs

  // Loading state (use Record instead of Set for serializability - anti-pattern #12)
  loadedSessions: Record<string, true>; // Sessions fully loaded
  loadingSessions: Record<string, true>; // Sessions currently loading

  // Pagination
  sessionCursor: Record<string, string | null>; // Last loaded ID per session
}

// Example state shape:
const exampleMessageState: MessageStoreState = {
  byId: {
    msg_1: {
      id: "msg_1",
      sessionId: "sess_abc",
      role: "user",
      parentId: undefined,
      createdAt: 1704067200000,
      completedAt: 1704067200000,
      metadata: { workspace: "/home/user/project" },
    },
    msg_2: {
      id: "msg_2",
      sessionId: "sess_abc",
      role: "assistant",
      parentId: "msg_1",
      createdAt: 1704067201000,
      completedAt: 1704067250000,
      metadata: {},
    },
  },
  bySession: {
    sess_abc: ["msg_1", "msg_2"],
  },
  byParent: {
    msg_1: ["msg_2"],
  },
  byStatus: {
    complete: ["msg_1", "msg_2"],
    streaming: [],
  },
  loadedSessions: { sess_abc: true },
  loadingSessions: {},
  sessionCursor: {
    sess_abc: null, // All messages loaded
  },
};
```

#### PartStore State

```typescript
// core/stores/part-store.ts

export interface PartStoreState {
  // Normalized storage
  byId: Record<string, Part>; // All parts by ID
  byMessage: Record<string, string[]>; // Message -> ordered part IDs

  // Indexes for fast lookup
  byType: Record<Part["type"], string[]>; // Type -> part IDs
  byToolCall: Record<string, string>; // toolCallId -> result part ID

  // Streaming state (use Record instead of Set for serializability - anti-pattern #12)
  streamingParts: Record<string, true>; // Parts currently being streamed
}

// Example state shape:
const examplePartState: PartStoreState = {
  byId: {
    part_1: {
      id: "part_1",
      messageId: "msg_1",
      type: "text",
      content: { text: "Hello, how are you?" },
      order: 0,
    },
    part_2: {
      id: "part_2",
      messageId: "msg_2",
      type: "tool-call",
      content: {
        toolName: "read",
        toolCallId: "call_123",
        args: { path: "src/index.ts" },
      },
      status: "completed",
      order: 0,
    },
    part_3: {
      id: "part_3",
      messageId: "msg_2",
      type: "tool-result",
      content: {
        toolName: "read",
        toolCallId: "call_123",
        result: { content: "file contents..." },
      },
      order: 1,
    },
    part_4: {
      id: "part_4",
      messageId: "msg_2",
      type: "text",
      content: { text: "I found the file!" },
      order: 2,
    },
  },
  byMessage: {
    msg_1: ["part_1"],
    msg_2: ["part_2", "part_3", "part_4"],
  },
  byType: {
    text: ["part_1", "part_4"],
    "tool-call": ["part_2"],
    "tool-result": ["part_3"],
  },
  byToolCall: {
    call_123: "part_3", // Links call to result
  },
  streamingParts: {},
};
```

#### SessionStore State

```typescript
// core/stores/session-store.ts

export interface SessionStoreState {
  // Normalized storage
  byId: Record<string, Session>; // All sessions by ID
  byWorkspace: Record<string, string[]>; // Workspace -> ordered session IDs

  // Active session tracking
  activeSessionId: string | null; // Currently selected session

  // Loading state (use Record instead of Set for serializability - anti-pattern #12)
  loadingWorkspaces: Record<string, true>; // Workspaces currently loading

  // Cache metadata
  lastFetch: Record<string, number>; // Last fetch time per workspace
}

// Example state shape:
const exampleSessionState: SessionStoreState = {
  byId: {
    sess_abc: {
      id: "sess_abc",
      title: "Refactor streaming architecture",
      workspace: "/home/user/project",
      directory: "/home/user/project",
      createdAt: 1704067200000,
      updatedAt: 1704067250000,
      lastMessageAt: 1704067250000,
      status: "active",
      threadId: "thread_xyz",
      resourceId: "res_123",
      messageIds: ["msg_1", "msg_2"],
      metadata: {
        messageCount: 2,
        hasErrors: false,
        model: "claude-sonnet-4",
      },
    },
  },
  byWorkspace: {
    "/home/user/project": ["sess_abc"],
  },
  activeSessionId: "sess_abc",
  loadingWorkspaces: {},
  lastFetch: {
    "/home/user/project": 1704067300000,
  },
};
```

### 4.9.3 Context API Shapes

#### MessageContext

```typescript
// presentation/contexts/message-context.tsx

export interface MessageContextValue {
  // ===== READ OPERATIONS =====

  // Get single message
  getMessage(id: string): Message | undefined;

  // Get all messages in session
  getMessages(sessionId: string): Message[];

  // Get children of a message
  getChildren(parentId: string): Message[];

  // Get message status (derived)
  getStatus(id: string): MessageStatus;

  // Check if message is in specific state
  isPending(id: string): boolean;
  isStreaming(id: string): boolean;
  isComplete(id: string): boolean;
  hasFailed(id: string): boolean;

  // ===== WRITE OPERATIONS =====

  // Retry a failed user message
  retry(id: string): Promise<void>;

  // Delete a message
  delete(id: string): void;

  // Copy message text to clipboard
  copy(id: string): Promise<void>;

  // Stop streaming
  stop(id: string): void;
}
```

#### PartContext

```typescript
// presentation/contexts/part-context.tsx

export interface PartContextValue {
  // ===== READ OPERATIONS =====

  // Get single part
  getPart(id: string): Part | undefined;

  // Get all parts for a message
  getParts(messageId: string): Part[];

  // Get parts by type
  getPartsByType(messageId: string, type: Part["type"]): Part[];

  // Get tool call result
  getToolResult(toolCallId: string): ToolResultPart | undefined;

  // Get text content of message (concatenated)
  getTextContent(messageId: string): string;

  // Check if message is streaming parts
  isStreaming(messageId: string): boolean;

  // Get streaming status for a part
  getPartStreamingStatus(partId: string): "idle" | "streaming" | "complete";

  // ===== WRITE OPERATIONS =====

  // Update text part (for editable messages)
  updateText(partId: string, text: string): void;
}
```

#### SessionContext

```typescript
// presentation/contexts/session-context.tsx

export interface SessionContextValue {
  // ===== READ OPERATIONS =====

  // Get single session
  getSession(id: string): Session | undefined;

  // Get all sessions for workspace
  getSessions(workspace: string): Session[];

  // Get active session
  getActiveSession(): Session | undefined;

  // Get session display info
  getTitle(id: string): string;
  getMessageCount(id: string): number;
  getLastMessageTime(id: string): number | undefined;

  // ===== WRITE OPERATIONS =====

  // Set active session
  setActive(id: string): void;

  // Create new session
  createSession(title?: string): Promise<string>;

  // Rename session
  rename(id: string, title: string): Promise<void>;

  // Delete session
  delete(id: string): Promise<void>;

  // Archive session
  archive(id: string): Promise<void>;
}
```

#### UIContext

```typescript
// presentation/contexts/ui-context.tsx

export interface UIContextValue {
  // ===== FOCUS =====
  focusedId: Accessor<string | null>;
  setFocusedId(id: string | null): void;
  clearFocus(): void;

  // ===== PANELS =====
  openPanels: Accessor<Set<string>>;
  togglePanel(id: string): void;
  openPanel(id: string): void;
  closePanel(id: string): void;
  isPanelOpen(id: string): boolean;

  // ===== MODALS =====
  modalState: Accessor<{
    isOpen: boolean;
    type: string | null;
    data: unknown;
  }>;
  openModal(type: string, data?: unknown): void;
  closeModal(): void;

  // ===== SCROLL =====
  scrollToMessage: Accessor<string | null>;
  requestScrollTo(messageId: string): void;
  clearScrollRequest(): void;
}
```

### 4.9.4 Component Prop Shapes (After Refactor)

#### MessageBubble

```typescript
// presentation/components/chat/message-bubble.tsx

export interface MessageBubbleProps {
  // Only ONE prop - the identifier!
  messageId: string;

  // Optional UI configuration props
  variant?: 'default' | 'compact' | 'minimal';
  showMeta?: boolean;        // Show timestamps, etc.
  class?: string;            // Additional classes
}

// Usage:
<MessageBubble messageId="msg_2" variant="compact" />
```

#### ToolCallPart

```typescript
// presentation/components/parts/tool-call-part.tsx

export interface ToolCallPartProps {
  partId: string;            // Only need part ID

  // Optional UI configuration
  expanded?: boolean;        // Initial expanded state
  showArgs?: boolean;        // Show tool arguments
  class?: string;
}

// Usage:
<ToolCallPart partId="part_2" expanded={false} />
```

#### TypingIndicator

```typescript
// presentation/components/chat/typing-indicator.tsx

export interface TypingIndicatorProps {
  // NO props! Gets state from context
  class?: string;            // Only styling
}

// Usage:
<TypingIndicator class="mb-4" />
```

#### SessionTurn

```typescript
// presentation/components/session/session-turn.tsx

export interface SessionTurnProps {
  // One prop - which user message starts this turn
  messageId: string;         // The user message ID

  // Optional UI configuration
  showSteps?: boolean;       // Show tool call steps
  compact?: boolean;         // Compact mode
  class?: string;
}

// Usage:
<SessionTurn messageId="msg_1" showSteps={true} />
```

### 4.9.5 Data Flow Example

Let's trace how data flows when a user sends a message:

```
┌─────────────────────────────────────────────────────────────────────────┐
│ 1. USER ACTION                                                          │
├─────────────────────────────────────────────────────────────────────────┤
│ User types: "Help me refactor my code"                                 │
│ Component: <ChatInput /> calls chat.sendMessage(text)                  │
└─────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────┐
│ 2. COMMAND LAYER                                                        │
├─────────────────────────────────────────────────────────────────────────┤
│ chatCommands.sendMessage({                                             │
│   text: "Help me refactor my code",                                    │
│   sessionId: "sess_abc",                                               │
│   workspace: "/home/user/project"                                      │
│ })                                                                     │
│                                                                          │
│ → Creates optimistic message:                                           │
│    {                                                                   │
│      id: "msg_3",                                                      │
│      role: "user",                                                     │
│      sessionId: "sess_abc",                                            │
│      createdAt: Date.now(),                                            │
│      metadata: { workspace: "/home/user/project" }                     │
│    }                                                                   │
│                                                                          │
│ → Adds to MessageStore:                                                │
│    state.byId["msg_3"] = message                                       │
│    state.bySession["sess_abc"].push("msg_3")                           │
└─────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────┐
│ 3. API CALL                                                             │
├─────────────────────────────────────────────────────────────────────────┤
│ POST /api/chat with stream: true                                       │
│ → Server begins processing                                             │
└─────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────┐
│ 4. SSE EVENTS START FLOWING                                             │
├─────────────────────────────────────────────────────────────────────────┤
│ Event 1: message.created                                               │
│   { type: "message.created", properties: {                             │
│       info: { id: "msg_4", role: "assistant", parentId: "msg_3" }     │
│     }}                                                                 │
│   → MessageStore adds "msg_4"                                          │
│                                                                          │
│ Event 2: message.part.updated (reasoning)                              │
│   { type: "message.part.updated", properties: {                         │
│       part: { id: "part_5", type: "reasoning", content: {...} }        │
│     }}                                                                 │
│   → PartStore adds "part_5" to "msg_4"                                 │
│                                                                          │
│ Event 3: message.part.updated (tool call)                              │
│   { type: "message.part.updated", properties: {                         │
│       part: { id: "part_6", type: "tool-call",                         │
│                content: { toolName: "read", ... } }                    │
│     }}                                                                 │
│   → PartStore adds "part_6", status: "executing"                        │
│                                                                          │
│ Event 4: message.part.updated (tool result)                            │
│   { type: "message.part.updated", properties: {                         │
│       part: { id: "part_7", type: "tool-result", ... }                │
│     }}                                                                 │
│   → PartStore adds "part_7"                                            │
│   → PartStore updates "part_6" status to "completed"                    │
│                                                                          │
│ Event 5: message.part.updated (text delta)                              │
│   { type: "message.part.updated", properties: {                         │
│       part: { id: "part_8", type: "text", content: { text: "I..." } } │
│     }}                                                                 │
│   → PartStore adds "part_8"                                            │
│   → PartStore updates "part_8" content as more deltas arrive            │
│                                                                          │
│ Event 6: message.updated (complete)                                    │
│   { type: "message.updated", properties: {                             │
│       info: { id: "msg_4", completedAt: 1234567890 }                   │
│     }}                                                                 │
│   → MessageStore updates "msg_4" with completedAt                       │
└─────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────┐
│ 5. COMPONENT RE-RENDERS                                                  │
├─────────────────────────────────────────────────────────────────────────┤
│ MessageList (shows all messages in session)                            │
│   → Detects new message "msg_4" (reactive to bySession changes)         │
│   → Renders <SessionTurn messageId="msg_3" />                          │
│                                                                          │
│ SessionTurn (shows user + assistant)                                   │
│   → Gets user message via useMessageById("msg_3")                      │
│   → Gets assistant messages via getChildren("msg_3")                   │
│   → Finds "msg_4" as child                                             │
│   → Renders <MessageBubble messageId="msg_4" />                        │
│                                                                          │
│ MessageBubble (shows single message)                                   │
│   → Gets message via useMessageById("msg_4")                           │
│   → Gets parts via usePartsByMessageId("msg_4")                        │
│   → Renders parts:                                                     │
│      - <ReasoningPart partId="part_5" />                               │
│      - <ToolCallPart partId="part_6" />                                │
│      - <ToolResultPart partId="part_7" />                              │
│      - <TextPart partId="part_8" />                                    │
│                                                                          │
│ Each part component gets its data via usePartById()                    │
└─────────────────────────────────────────────────────────────────────────┘
```

### 4.9.6 JSON Examples

#### Complete Message with Parts

```json
{
  "message": {
    "id": "msg_4",
    "sessionId": "sess_abc",
    "role": "assistant",
    "parentId": "msg_3",
    "createdAt": 1704067260000,
    "completedAt": 1704067300000,
    "metadata": {
      "workspace": "/home/user/project",
      "mode": "chat"
    }
  },
  "parts": [
    {
      "id": "part_5",
      "messageId": "msg_4",
      "type": "reasoning",
      "order": 0,
      "content": {
        "currentThought": "Analyzing the request",
        "thoughtNumber": 1,
        "totalThoughts": 3
      }
    },
    {
      "id": "part_6",
      "messageId": "msg_4",
      "type": "tool-call",
      "order": 1,
      "content": {
        "toolName": "read",
        "toolCallId": "call_456",
        "args": {
          "path": "src/hooks/use-chat.ts"
        }
      },
      "status": "completed"
    },
    {
      "id": "part_7",
      "messageId": "msg_4",
      "type": "tool-result",
      "order": 2,
      "content": {
        "toolName": "read",
        "toolCallId": "call_456",
        "result": {
          "content": "// File contents here..."
        }
      }
    },
    {
      "id": "part_8",
      "messageId": "msg_4",
      "type": "text",
      "order": 3,
      "content": {
        "text": "I've analyzed your code and here are my suggestions..."
      }
    }
  ]
}
```

#### Session with Messages

```json
{
  "session": {
    "id": "sess_abc",
    "title": "Refactor streaming architecture",
    "workspace": "/home/user/project",
    "createdAt": 1704067200000,
    "updatedAt": 1704067300000,
    "lastMessageAt": 1704067300000,
    "status": "active",
    "threadId": "thread_xyz",
    "messageIds": ["msg_1", "msg_2", "msg_3", "msg_4"],
    "metadata": {
      "messageCount": 4,
      "hasErrors": false,
      "model": "claude-sonnet-4"
    }
  }
}
```

---

## 4.10 Current Implementation Status

Based on code review, the following patterns are **already correctly implemented** in the current codebase:

### ✅ Already Correct (No Changes Needed)

| Pattern                         | Location                   | Notes                                                     |
| ------------------------------- | -------------------------- | --------------------------------------------------------- |
| Stable empty array fallbacks    | `session-turn.tsx`         | Uses `emptyMessages: Message[] = []` as stable reference  |
| Custom equality functions       | `session-turn.tsx`         | Uses `arraysEqual` and `equals: same` for memoization     |
| `produce` for local mutations   | `sync-provider.tsx`        | `setStore(produce(draft => { ... }))` - correct API       |
| `reconcile` for API responses   | `sync-provider.tsx`        | `setStore("message", sessionID, reconcile(messages))`     |
| Binary search for sorted arrays | `sync-provider.tsx`        | Uses `Binary()` utility for O(log n) lookups              |
| Path-based store updates        | `global-sync-provider.tsx` | Uses `setStore("session", index, reconcile(...))`         |
| Event batching + coalescing     | `global-sdk-provider.tsx`  | Uses `@solid-primitives/event-bus` with batched flush     |
| SSE reconnect + bounded queue   | `global-sdk-provider.tsx`  | Reconnect backoff + queue cap + `lastEventId` resume hint |

### ⚠️ Partially Implemented (Needs Refinement)

| Pattern                 | Current State                                          | Recommended Change                                           |
| ----------------------- | ------------------------------------------------------ | ------------------------------------------------------------ |
| Provider-scoped stores  | Scoped by directory cache, not strictly request-scoped | Move to explicit store factories per provider boundary       |
| Domain contexts         | Single `useSync` for most domain data                  | Split into `MessageContext`, `PartContext`, `SessionContext` |
| Component props         | Props include data + callbacks                         | Props should be ID-only, fetch via context                   |
| Typed event contracts   | Event names/payloads are largely stringly-typed        | Add generic `EventMap` and payload parser guards             |
| Storage persistence     | Uses custom persisted workspace cache                  | Add tiered persistence with `@solid-primitives/storage`      |
| SSE catch-up robustness | Resume hint present, no explicit fallback refetch flow | Add gap detection + fallback sync API path                   |
| Hook-free factories     | `createSync()` reaches into hooks for dependencies     | Pass dependencies into pure factory/create functions         |

### ❌ Not Yet Implemented

| Pattern                    | Status                   | Priority                  |
| -------------------------- | ------------------------ | ------------------------- |
| Virtual scrolling          | Not implemented          | High (for large sessions) |
| Domain coordinators        | Not implemented          | Medium                    |
| Anti-pattern lint checks   | Not implemented          | Medium                    |
| Full architecture collapse | 4-provider stack remains | Medium                    |

---

## 5. Migration Strategy

### 5.1 Incremental Migration Approach

1. **Phase 1: Parallel Implementation**
   - Create new architecture alongside old code
   - Introduce provider-scoped store factories (no module singletons)
   - Both systems run simultaneously
   - Feature flags to switch between them

2. **Phase 2: Component Migration**
   - Migrate components one at a time
   - Start with leaf components (typing-indicator, text-part)
   - Move up to parent components

3. **Phase 3: Provider Consolidation**
   - Gradually remove old providers
   - Remove request-shared mutable globals
   - Ensure no components reference old APIs

4. **Phase 4: Cleanup**
   - Remove all old code
   - Update imports
   - Delete unused files

### 5.2 Feature Flag Implementation

```typescript
// shared/feature-flags.ts
export const featureFlags = {
  useNewStreaming: import.meta.env.VITE_USE_NEW_STREAMING === "true",
  useNewStores: import.meta.env.VITE_USE_NEW_STORES === "true",
  useTypedEventBus: import.meta.env.VITE_USE_TYPED_EVENT_BUS === "true",
  useVirtualizedMessages: import.meta.env.VITE_USE_VIRTUALIZED_MESSAGES === "true",
};
```

### 5.3 Testing Strategy

1. **Reactive Logic Unit Tests (`createRoot`)**
   - Run store/hook tests inside `createRoot((dispose) => ...)`.
   - Validate `reconcile` ingest and `produce` transitions independently.
2. **Provider + Hook Integration Tests**
   - Render with `@solidjs/testing-library` wrappers for context providers.
   - Seed test stores through provider factories, not global module mutation.
3. **SSE and Async Flow Tests**
   - Mock EventSource; assert batched updates with `waitFor`.
   - Test reconnect flow: disconnect -> backoff -> resume/catch-up.
4. **Component Contract Tests (Smart vs Dumb)**
   - Smart components: verify orchestration and action wiring.
   - Dumb components: verify rendering from props only (Storybook-friendly).
5. **E2E Scenarios**
   - Send/stop/retry streaming messages.
   - Reload and hydration correctness.
   - Large thread scrolling with virtualization enabled.

---

## 6. Performance Optimizations

### 6.1 Rendering Optimizations

| Optimization                          | Benefit                                         | Effort |
| ------------------------------------- | ----------------------------------------------- | ------ |
| Virtual scrolling for long lists      | O(n) → O(viewport) renders                      | Medium |
| Proper `createMemo` with dependencies | Prevent unnecessary recalculations              | Low    |
| `<For>` over stable ID arrays         | Preserves node identity during inserts/reorders | Low    |
| CSS animations instead of JS          | Offload to compositor thread                    | Low    |

### 6.2 Store Optimizations

| Optimization                                | Benefit                                      | Effort |
| ------------------------------------------- | -------------------------------------------- | ------ |
| Shallow comparison for updates              | Fewer store updates                          | Low    |
| `reconcile` on remote payload ingest        | Preserves references, avoids full list churn | Low    |
| `produce` for local multi-field transitions | Cleaner optimistic update logic              | Low    |
| Indexed lookups (Map) instead of arrays     | O(1) vs O(n) lookups                         | Medium |
| Lazy loading of old messages                | Faster initial load                          | Medium |

### 6.3 Memory Optimizations

| Optimization                       | Benefit                  | Effort |
| ---------------------------------- | ------------------------ | ------ |
| Event queue limits                 | Prevent unbounded growth | Low    |
| Part cleanup for old messages      | Reduce memory footprint  | Medium |
| LRU eviction for inactive sessions | Cap memory usage         | Low    |

---

## 7. Success Metrics

| Metric                           | Current | Target               | How to Measure          |
| -------------------------------- | ------- | -------------------- | ----------------------- |
| Time to first render             | ~500ms  | <100ms               | Performance API         |
| Typing indicator FPS             | ~15fps  | 60fps                | FPS counter             |
| Memory after 100 messages        | ~50MB   | <30MB                | Chrome DevTools         |
| Re-renders per message           | ~50     | <10                  | Solid DevTools          |
| Stream recovery after disconnect | Unknown | <3s median reconnect | Synthetic network tests |
| Bundle size                      | ~2MB    | <1.5MB               | Bundle analyzer         |

---

## 8. Risks & Mitigations

| Risk                              | Impact | Mitigation                                            |
| --------------------------------- | ------ | ----------------------------------------------------- |
| Breaking existing features        | High   | Comprehensive test coverage, gradual migration        |
| SSR data leakage via shared state | High   | Provider-scoped store factories, no module singletons |
| Performance regression            | Medium | Performance benchmarks, profiling                     |
| Long migration period             | Medium | Prioritize high-impact changes first                  |
| Team unfamiliar with new patterns | Medium | Documentation, pair programming                       |

---

## 9. Open Questions

1. **Streaming state machine library (XState)?**
   - Decision: defer for now.
   - Rationale: typed event contracts + coordinator + explicit status enums are sufficient at current scope.

2. **Persistence split finalized?**
   - Decision: yes.
   - `@solid-primitives/storage` for lightweight UI/session metadata.
   - IndexedDB/API hydration for heavy message/part history.

3. **Offline mode v1 scope?**
   - Decision: limited offline support.
   - Queue outbound drafts; no full conflict-free collaborative merge in this refactor.

4. **Concurrent update strategy?**
   - Decision: optimistic UI + server authority + catch-up refetch on reconnect gaps.
   - Revisit optimistic locking only if production telemetry shows race-induced regressions.

---

## 10. Next Steps

1. **Create ADRs for finalized decisions** (store factory scope, typed event map, SSE resume strategy, persistence tiers).
2. **Open implementation issues for R1-R14** in "Research Delta Tasks" (updated with expert recommendations).
3. **Ship foundation milestone**: provider-scoped stores + typed event bus + SSE lifecycle cleanup.
4. **Ship performance milestone**: `<For>` ID lists + `@tanstack/solid-virtual` + profiling baseline.
5. **Ship library integration milestone**: `@solid-primitives/*` packages adopted across the codebase.
6. **Ship QA milestone**: `createRoot` store tests, SSE reconnection tests, wrapper-based integration tests.

---

## Appendix: Key Patterns

### A. Command Pattern

```typescript
// Encapsulate actions as commands
commands.sendMessage({ text, sessionId });
```

### B. Event Sourcing

```typescript
// State is derived from event stream
eventBus.on("message.created", handler);
```

### C. Dependency Injection

```typescript
// Provide dependencies via context
const app = useApp();
```

### D. Reactive Projection

```typescript
// Derive view models from domain state
const messages = createMemo(() => ...)
```

---

## Appendix: Library Recommendations

This appendix documents the recommended SolidJS ecosystem libraries based on expert research and community best practices. These libraries should be preferred over custom implementations unless there's a compelling reason.

### Event Bus & Communication

#### `@solid-primitives/event-bus` ⭐ PRIORITY

**Purpose:** Type-safe event emitters with SolidJS batching

**Installation:**

```bash
pnpm add @solid-primitives/event-bus
```

**Usage:**

```typescript
import { createEmitter, batchEmits } from "@solid-primitives/event-bus";

type AppEvents = {
  "message.created": { messageId: string; sessionId: string };
  "message.updated": { messageId: string; completedAt?: number };
  "stream.error": { reason: string; recoverable: boolean };
};

// Create emitter with batching for performance
const emitter = batchEmits(createEmitter<AppEvents>());

// Typed event emission
emitter.emit("message.created", { messageId: "msg-1", sessionId: "sess-1" });

// Typed event subscription
const unsubscribe = emitter.on("message.created", payload => {
  console.log(payload.messageId); // Fully typed!
});
```

**Why use it:**

- Type-safe event contracts (no `string + any`)
- Automatic SolidJS `batch()` wrapping
- Community-maintained and tested
- Better than custom `Map<string, Set<Handler>>` implementations

**Documentation:** [primitives.solidjs.community/package/event-bus](https://primitives.solidjs.community/package/event-bus/)

### Storage & Persistence

#### `@solid-primitives/storage` ⭐ PRIORITY

**Purpose:** Reactive storage with localStorage/sessionStorage/IndexedDB synchronization

**Installation:**

```bash
pnpm add @solid-primitives/storage
```

**Usage:**

```typescript
import { makePersisted } from "@solid-primitives/storage";

// Simple UI state persistence
const [uiStore, setUiStore] = makePersisted(
  createStore<UIState>({
    focusedId: null,
    openPanels: [],
    selectedTheme: "dark",
  }),
  { name: "ekacode-ui" } // localStorage key
);

// Works with signals too
const [count, setCount] = makePersisted(createSignal(0), { name: "ekacode-counter" });
```

**Features:**

- Automatic JSON serialization/deserialization
- Initial values NOT written (safe refactoring)
- Multi-tab sync via storage events
- Works with `createSignal` AND `createStore`
- Async backends: IndexedDB, LocalForage, Tauri

**Why use it:**

- Handles edge cases (storage quota, parsing errors)
- SSR-safe (no localStorage on server)
- Tested across browsers
- Better than manual `localStorage.getItem/setItem`

**Documentation:** [github.com/solidjs-community/solid-primitives/tree/main/packages/storage](https://github.com/solidjs-community/solid-primitives/tree/main/packages/storage)

### Event Coalescing & Scheduling

#### `@solid-primitives/scheduled` ⭐ PRIORITY

**Purpose:** Debounce, throttle, and schedule reactive updates

**Installation:**

```bash
pnpm add @solid-primitives/scheduled
```

**Usage:**

```typescript
import { debounce, throttle, leading, scheduleIdle } from "@solid-primitives/scheduled";

// Debounce search input (trailing edge delay)
const search = debounce((query: string) => {
  performSearch(query);
}, 300);

// Throttle scroll/resize events (periodic limit)
const handleScroll = throttle(() => {
  updateScrollPosition();
}, 100);

// Leading debounce for button clicks (immediate + lockout)
const handleSubmit = leading(() => {
  submitForm();
}, 1000);

// Schedule during browser idle time
const logAnalytics = scheduleIdle(() => {
  analytics.track("page_view");
});
```

**Why use it:**

- SolidJS-aware (works with reactive tracking)
- Better than Lodash equivalents (doesn't break reactivity)
- Reduces unnecessary re-renders during high-frequency events

**Documentation:** [primitives.solidjs.community/package/scheduled](https://primitives.solidjs.community/package/scheduled/)

### List Virtualization

#### `@tanstack/solid-virtual` ⭐ PRIORITY

**Purpose:** Efficient rendering of large lists (500+ items)

**Installation:**

```bash
pnpm add @tanstack/solid-virtual
```

**Usage:**

```typescript
import { createVirtualizer } from "@tanstack/solid-virtual";

function MessageList() {
  const messages = useSessionMessages(() => props.sessionId);
  const [scrollElement, setScrollElement] = createSignal<HTMLDivElement | null>(null);

  const rowVirtualizer = createVirtualizer({
    count: () => messages.messages().length,
    getScrollElement: () => scrollElement(),
    estimateSize: () => 56, // Estimated row height
    overscan: 5, // Render 5 extra items above/below viewport
  });

  return (
    <div ref={setScrollElement} style="height: 600px; overflow: auto;">
      <div style={`height: ${rowVirtualizer.getTotalSize()}px; position: relative;`}>
        <For each={rowVirtualizer.getVirtualItems()}>
          {(virtualRow) => {
            const message = messages.messages()[virtualRow.index];
            return (
              <div
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start}px)`
                }}
              >
                <MessageBubble messageId={message.id} />
              </div>
            );
          }}
        </For>
      </div>
    </div>
  );
}
```

**Why use it:**

- Framework-agnostic (TanStack Virtual core)
- SolidJS adapter with reactive integration
- Dynamic item sizes support
- Reverse virtualization for chat apps
- Battle-tested at scale

**Alternative:** `@doeixd/create-virtualized-list-solid` (simplified wrapper around TanStack)

**Documentation:** [tanstack.com/virtual/latest](https://tanstack.com/virtual/latest/docs/introduction)

### Additional Recommended Primitives

#### `@solid-primitives/keyed`

**Purpose:** Advanced keyed list operations

**When to use:** When you need explicit key functions or complex mapping beyond `<For>`

```typescript
import { Key } from "@solid-primitives/keyed";

<Key each={items()} by={(item) => item.slug}>
  {(item) => <div>{item.name}</div>}
</Key>
```

#### `@solid-primitives/map`

**Purpose:** Reactive Map and Set primitives

**When to use:** When you need reactive Map/Set operations (outside of store state)

```typescript
import { createMap } from "@solid-primitives/map";

const userMap = createMap<string, User>();
userMap.set("user-1", user);
userMap.has("user-1"); // Reactive!
```

**Note:** Use `Record<string, T>` inside stores for serializability. Use this only for ephemeral state.

#### `@solid-primitives/timer`

**Purpose:** Reactive timers and intervals

**When to use:** For countdowns, polling, or time-based UI updates in components/hooks

**When not to use:** Infrastructure-level reconnect/backoff/coalescing loops where imperative control flow and explicit lifecycle state are required.

**Current guidance in this codebase:**

- Use in presentation layer (example target: `session-turn.tsx` interval/cooldown timers)
- Keep manual timers in infrastructure layer (current: `global-sdk-provider.tsx` reconnect + coalescing timers)

```typescript
import { createTimer } from "@solid-primitives/timer";

const timer = createTimer(() => Date.now(), 1000);
```

### Installation Command Summary

```bash
# Core recommended packages
pnpm add @solid-primitives/event-bus
pnpm add @solid-primitives/storage
pnpm add @solid-primitives/scheduled
pnpm add @tanstack/solid-virtual

# Optional but useful
pnpm add @solid-primitives/keyed
pnpm add @solid-primitives/timer
pnpm add @solid-primitives/map
```

---

_Document maintained by the ekacode team. Last updated: 2026-02-08_
