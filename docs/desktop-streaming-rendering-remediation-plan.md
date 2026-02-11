# Desktop Streaming and Rendering Remediation Plan

## Status

- Draft
- Date: 2026-02-09
- Scope: Desktop app chat pipeline (`send -> stream/SSE -> stores -> projection -> UI`)
- Migration policy: Replace flawed paths with the new implementation (no compatibility shims)

## Problem Statement

Current tests pass while runtime can still fail with:

- provider initialization/order errors (`useStores` / `useMessage` outside provider)
- messages not rendering even when streaming appears active (typing dots only)
- missing or delayed session/message linkage causing turn projection gaps

This indicates the suite over-indexes on isolated unit mocks and under-covers real runtime flow.

## Objectives

1. Make the runtime flow deterministic and observable end-to-end.
2. Remove provider/context ambiguity and import-identity drift.
3. Replace stream handling with protocol-accurate parsing.
4. Ensure message rendering does not depend on fragile ordering assumptions.
5. Rebuild tests around realistic payloads and integration boundaries.

## Non-Goals

- Preserve legacy provider wiring or legacy import aliases for compatibility.
- Keep old test patterns that mock core stores/contexts away from real behavior.

## Root Cause Areas to Fix

1. **Provider initialization integrity**
   - Mixed import specifiers and fallback global store escape hatches can mask real defects.
2. **Streaming ingestion gap**
   - Decoding transport bytes without applying protocol events leaves UI dependent on external timing.
3. **Session/message identity drift**
   - `sessionId` transitions and parent linkage can split optimistic and streamed state.
4. **Fragile turn projection**
   - UI groups by user turns; assistant content can exist but not render if linkage/windowing breaks.
5. **Test realism gap**
   - Mocked stores and synthetic responses miss production ordering and payload shape.

## Workstream Plan

## WS0: Baseline and Traceability

### Deliverables

- Correlated runtime tracing (single correlation key per request/session/message).
- Repro matrix for current failure modes.

### Changes

- Add structured trace logs in:
  - `apps/desktop/src/presentation/hooks/use-chat.ts`
  - `apps/desktop/src/presentation/providers/app-provider.tsx`
  - `apps/desktop/src/core/domain/event-router-adapter.ts`
  - `apps/desktop/src/presentation/hooks/use-messages.ts`
  - `apps/desktop/src/views/workspace-view/chat-area/message-list.tsx`

### Exit Criteria

- One captured trace can show every stage from send to render for a single turn.

## WS1: Provider and Module Identity Hardening

### Deliverables

- Strict provider tree behavior without global fallback.
- Canonical import path usage.

### Changes

- Remove `globalThis.__ekacodeActiveStores__` fallback path from:
  - `apps/desktop/src/presentation/providers/store-provider.tsx`
- Keep only strict context access and fail-fast error messages.
- Standardize imports to `@renderer/*` in runtime-critical presentation modules.
- Keep dedupe rules in Vite and align Vitest aliases.

### Exit Criteria

- Runtime works with strict provider dependency.
- Any provider misuse fails immediately in development and tests.

## WS2: Streaming Protocol Ingestion Replacement

### Deliverables

- Protocol-accurate stream parser integration in chat send flow.
- Unified ingestion path for UI message stream and SSE events.

### Changes

- Replace byte-only decode loop in `apps/desktop/src/presentation/hooks/use-chat.ts` with parser-driven event handling.
- Add or restore a dedicated UI stream parser module under desktop source and wire it into `use-chat`.
- Use canonical server stream framing (`data:` SSE frames and `0:/b:/8:/d:` style lines where applicable).
- Ensure completion/error semantics map to `useStreaming` state deterministically.

### Exit Criteria

- Assistant text can render incrementally even before SSE catch-up.
- Stream completion and stop/abort states are consistent and testable.

## WS3: Session and Message Identity Consistency

### Deliverables

- Single source of truth for active/effective session.
- Deterministic message/part ownership during session updates.

### Changes

- Refactor `use-chat` and workspace integration to avoid dual authority conflicts:
  - `apps/desktop/src/presentation/hooks/use-chat.ts`
  - `apps/desktop/src/views/workspace-view/index.tsx`
- Enforce stable linkage rules in event routing:
  - `apps/desktop/src/core/domain/event-router-adapter.ts`
- On session ID transition, migrate optimistic entities to the authoritative session path.

### Exit Criteria

- No “orphan” optimistic user message.
- No split timeline between optimistic and streamed assistant data.

## WS4: Render Pipeline Robustness

### Deliverables

- Turn rendering resilient to event ordering gaps.
- UI displays available assistant content even with partial linkage.

### Changes

- Harden turn selection and fallback in:
  - `apps/desktop/src/views/workspace-view/chat-area/session-turn.tsx`
  - `apps/desktop/src/views/workspace-view/chat-area/message-list.tsx`
- Ensure “typing only” state has a timeout/fallback when real assistant parts already exist.
- Validate virtualization behavior with dynamic row changes.

### Exit Criteria

- User turn always renders immediately after send.
- Assistant output always appears once any valid text/tool part is ingested.

## WS5: SSE Lifecycle and Catch-up Completion

### Deliverables

- Proper resume/catch-up behavior after reconnect or missed events.

### Changes

- Finalize fallback refetch logic in:
  - `apps/desktop/src/infrastructure/events/event-source.ts`
  - `apps/desktop/src/infrastructure/events/sse-manager.ts`
- Ensure replay path merges safely into stores without duplications.

### Exit Criteria

- Reconnect during streaming does not leave permanent typing-only state.

## WS6: Event Contract and Adapter Tightening

### Deliverables

- Strict typed payload guarantees between server and desktop.

### Changes

- Tighten shared guards/types for required fields used by renderer:
  - `packages/shared/src/event-types.ts`
  - `packages/shared/src/event-guards.ts`
- Align adapter assumptions with server payload reality:
  - `apps/desktop/src/core/domain/event-router-adapter.ts`
- Remove permissive paths that accept payloads the renderer cannot apply.

### Exit Criteria

- Invalid payloads fail early in tests.
- Valid payloads always result in deterministic store updates.

## WS7: Vitest Overhaul (Accurate Mocks + Integration Coverage)

### Deliverables

- Realistic fixtures and integrated provider tests.
- Regression tests for all observed failures.

### Test Strategy

- **Unit tests (pure logic):**
  - keep for store reducers, adapter mapping, parser branches.
- **Integration tests (default for chat flow):**
  - real `StoreProvider`, `MessageProvider`, `PartProvider`, `SessionProvider`, `ChatProvider`, `AppProvider` as needed.
- **No core-store hook mocking** for flow tests.

### Fixture Policy

- Build canonical fixtures from real server frames/events:
  - capture from `/api/chat` and `/event` once, sanitize, store as fixtures.
- Include realistic ordering variants:
  - in-order
  - part-before-message
  - delayed session header update
  - reconnect and catch-up replay

### Files to rewrite/add

- Rewrite:
  - `apps/desktop/tests/unit/presentation/hooks/use-chat.test.ts`
  - `apps/desktop/tests/unit/presentation/providers/chat-provider.test.ts`
- Expand:
  - `apps/desktop/tests/unit/core/domain/event-router-adapter.test.ts`
  - `apps/desktop/tests/unit/presentation/hooks/use-messages.test.ts`
- Add integration:
  - `apps/desktop/tests/integration/chat-stream-rendering.test.tsx`
  - `apps/desktop/tests/integration/provider-initialization-order.test.tsx`
  - `apps/desktop/tests/integration/reconnect-catchup-rendering.test.tsx`

### Vitest Best Practices to enforce

- Deterministic time and IDs (`vi.useFakeTimers`, stable UUID mocks).
- Explicit async flushing (`await Promise.resolve()` loops or helper `flushAll`).
- DOM assertions on visible behavior, not private implementation details.
- Table-driven tests for event ordering permutations.
- Strict cleanup in `afterEach` with container disposal and mock resets.

### Exit Criteria

- Tests fail on old broken flow and pass only with new implementation.
- “Typing dots only” regression is locked by integration tests.

## WS8: Plan Next Steps from Refactor Document

### Deliverables

- Execute unresolved high-priority items tied to this failure class.

### Immediate items to include in this remediation

- Complete SSE catch-up fallback refetch flow.
- Finalize typed SSE payload guard strictness.
- Add wrapper-based integration tests for streaming and rendering.
- Prepare ADR notes for:
  - session authority model
  - stream ingestion source-of-truth
  - provider strictness policy

## Execution Order (Batched by Goal)

Workstreams are grouped into batches with similar goals to enable focused, incremental delivery:

### Batch 1: Foundation (WS0 + WS1)

**Goal**: Observability and strict provider architecture

- WS0 adds tracing to understand current behavior
- WS1 removes global fallback that's masking real issues
- **Why together**: Need tracing before removing fallbacks to catch new failures

**Order**: WS0 → WS1

### Batch 2: Data Integrity (WS3 + WS6)

**Goal**: Consistent session/message identity and strict typing

- WS3 fixes session/message ownership and linkage
- WS6 tightens payload types/guards between server and desktop
- **Why together**: Both address data integrity and type safety

**Order**: WS3 → WS6

### Batch 3: Stream Processing (WS2 + WS5)

**Goal**: Reliable stream ingestion and lifecycle management

- WS2 replaces broken byte-only decoder with protocol-accurate parser
- WS5 completes catch-up/reconnect logic for resilience
- **Why together**: Both deal with stream ingestion end-to-end

**Order**: WS2 → WS5

### Batch 4: UI Rendering (WS4)

**Goal**: Robust turn rendering regardless of event ordering

- **Why separate**: Depends on batches 2-3; needs correct data to render

### Batch 5: Testing (WS7)

**Goal**: Validate all fixes with realistic integration tests

- **Why last**: Tests validate the implementation; write after fixes stabilize

### Batch 6: Closeout (WS8)

**Goal**: Complete remaining items and document decisions

- Execute remaining high-priority refactor items
- Prepare ADRs for architectural decisions

---

## Original Linear Order (Reference)

1. WS0 tracing
2. WS1 provider hardening
3. WS2 stream ingestion replacement
4. WS3 identity consistency
5. WS4 render robustness
6. WS5 reconnect/catch-up completion
7. WS6 contract tightening
8. WS7 test overhaul
9. WS8 closeout tasks and ADRs

## Acceptance Criteria (Definition of Done)

1. No provider-context runtime errors across navigation/HMR flows.
2. User message renders immediately on send.
3. Assistant stream renders progressively and finalizes correctly.
4. Reconnect mid-stream recovers and renders final state.
5. Integration tests reproduce and protect against prior failures.
6. Legacy fallback wiring removed; strict provider architecture enforced.

## Validation Checklist

- `pnpm -C apps/desktop typecheck`
- `pnpm -C apps/desktop test:run`
- targeted integration suite passes:
  - `chat-stream-rendering`
  - `provider-initialization-order`
  - `reconnect-catchup-rendering`
- manual smoke:
  - open workspace
  - send message
  - observe user bubble, assistant incremental content, completion state

## Risks and Mitigations

1. **Risk:** stricter provider rules expose hidden consumers.
   - **Mitigation:** fail-fast tests and targeted provider tree integration tests.
2. **Risk:** parser replacement introduces protocol edge regressions.
   - **Mitigation:** fixture-backed parser contract tests from real server output.
3. **Risk:** session migration logic duplicates or loses optimistic entities.
   - **Mitigation:** invariant checks in tests (`message/part count`, ownership assertions).

## Ownership Notes

- Primary implementation scope: desktop renderer (`apps/desktop/src`)
- Contract alignment: shared package (`packages/shared/src`)
- Fixture source of truth: server stream output (`packages/server/src/routes/chat.ts`, `/event`)
