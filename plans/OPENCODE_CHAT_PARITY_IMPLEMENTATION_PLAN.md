# OpenCode-Like Chat UI Parity Plan (Desktop Core Architecture)

## 1. Objective

Implement a chat presentation layer in `apps/desktop` that is **visually and behaviorally very similar** to OpenCode's desktop/app chat experience while preserving your refactored architecture in `apps/desktop/src/core`.

Target parity includes:

- Turn-based conversation layout (user turn + assistant sequence)
- Sticky user prompt card per turn
- Collapsible "steps" section (tool/reasoning activity)
- Final assistant summary response rendering
- Streaming-safe updates (text deltas, tool status transitions)
- Permission/question interaction surfaces
- Stable behavior under reconnects, out-of-order events, and deduplication edge cases

This plan is intentionally comprehensive and implementation-ready.

---

## 2. Current State Summary (What Exists Today)

## 2.1 Strengths already in place

You already have a strong backend/frontend core foundation:

1. SSE ingestion and coalescing

- `apps/desktop/src/core/services/sse/event-source.ts`
- `apps/desktop/src/core/services/sse/sse-manager.ts`
- coalescing logic aligned with frame-like batching and dedupe keys (`session.status`, `message.part.updated`)

2. Event integrity and ordering

- `apps/desktop/src/core/chat/domain/event-router-adapter.ts`
- event ordering buffer + deduplicator + validation
- pending parts buffering when `message.part.updated` arrives before `message.updated`

3. Store architecture

- normalized stores (`message`, `part`, `session`) with provider scoping
- FK constraints and cascade deletes in `store-provider.tsx`
- good isolation and SSR/test safety direction

4. Hook layer

- `useChat`, `useMessages`, `useStreaming`
- optimistic sending behavior and stream parser integration

5. Workspace shell

- 3-column layout implemented
- center chat panel is intentionally placeholder, which is exactly where parity UI should go

## 2.2 Gaps relative to OpenCode-like UX

1. No turn-based rendering components yet

- no equivalent of `MessageTimeline -> SessionTurn -> MessagePart`

2. Flat projection

- `timeline-projection.ts` is useful, but not enough for OpenCode-style grouped turns

3. No part renderer registry

- need typed renderers for `text`, `reasoning`, `tool`, and prompt UX events

4. Potential mixed authority during stream

- `useChat` writes optimistic and stream-derived parts while SSE also writes store events
- can cause duplicates/inconsistent canonical IDs without reconciliation strategy

5. Permission path duplication

- `usePermissions` currently opens separate EventSource
- core already has unified SSE/event routing capabilities

---

## 3. Implementation Principles

1. Preserve your architecture

- Keep `core/services` + `core/domain` + `core/state` boundaries.
- Add presentation components without collapsing abstractions.

2. SSE-authoritative persistence

- Treat SSE/store updates as canonical.
- Keep optimistic UX but reconcile temporary artifacts when canonical events arrive.

3. Build UI against selectors/projections, not raw store internals

- New projection hooks should hide store normalization details from components.

4. Incremental rollout

- Phase implementation so center panel becomes usable early.
- Avoid large one-shot rewrite.

5. Feature flags during migration

- Optional flag toggles between placeholder/legacy/new chat panel for safe rollout.

6. Mandatory OpenCode alignment checks in every phase

- For each phase, compare implementation decisions against the cloned OpenCode repo under `opencode/`.
- Do not assume parity from memory; verify component structure, behavior, and data-flow details directly from source.
- Treat OpenCode as the reference baseline for UI/UX parity while adapting to this project's architecture.

---

## 4. Target UX/Component Parity (OpenCode-like)

Desired center chat panel structure:

1. `MessageTimeline`

- scroll container
- per-user-message turn rendering
- optional jump/anchor support

2. `SessionTurn`

- sticky user prompt section
- status/steps trigger row (spinner + status text + elapsed duration)
- collapsible assistant "steps" region
- summary response region when streaming completes

3. `MessagePart` + registry

- `text` part: markdown + copy action + throttled rendering
- `reasoning` part: subtle/italic treatment
- `tool` part: collapsible tool cards with status and result body
- optional `question`/`permission` inline cards

4. Styling pattern

- `data-component` / `data-slot` CSS selectors
- sticky gradients, overflow behavior, no-jank transitions

---

## 5. Proposed File/Module Additions

All paths below are proposed and compatible with your current structure.

## 5.1 New projection hooks/selectors

1. `apps/desktop/src/core/chat/hooks/use-session-turns.ts`

- Build OpenCode-like turn model from normalized stores.

2. `apps/desktop/src/core/chat/hooks/turn-projection.ts`

- Pure projection helpers and types:
  - `ChatTurn`
  - `AssistantStep`
  - `TurnStatus`

3. `apps/desktop/src/core/chat/hooks/use-message-parts.ts` (optional)

- Convenience selectors for part lookup and partitioning.

## 5.2 New chat-area view components

Create folder:

- `apps/desktop/src/views/workspace-view/chat-area/`

Files:

1. `message-timeline.tsx`
2. `session-turn.tsx`
3. `message-part.tsx`
4. `basic-tool.tsx`
5. `parts/text-part.tsx`
6. `parts/reasoning-part.tsx`
7. `parts/tool-part.tsx`
8. `parts/question-part.tsx` (phase-gated)
9. `parts/permission-part.tsx` (phase-gated)
10. `chat-area.css`
11. `index.ts` barrel exports

## 5.3 Existing files to modify

1. `apps/desktop/src/views/workspace-view/index.tsx`

- Replace center placeholder with `MessageTimeline`.

2. `apps/desktop/src/core/chat/hooks/use-messages.ts`

- Keep existing API; add compatibility helpers if needed for new turn hook.

3. `apps/desktop/src/core/chat/hooks/use-chat.ts`

- Add reconciliation logic for optimistic-vs-SSE convergence.

4. `apps/desktop/src/core/permissions/hooks/use-permissions.ts` (later phase)

- Stop separate SSE stream; consume unified event bus/store projections.

5. `apps/desktop/src/components/index.ts`

- Export stable reusable chat components if needed.

---

## 6. Data Model Design for Turn Rendering

## 6.1 Turn type

`ChatTurn` should represent:

- `userMessage`: canonical user message
- `userParts`: user prompt parts (text + attachments)
- `assistantMessages`: assistant messages with `parentID === user.id`, until next user
- `assistantPartsByMessageId`
- `finalTextPart`: last assistant text part
- `reasoningParts`: all reasoning parts in assistant sequence
- `toolParts`: all tool parts in assistant sequence
- `isActiveTurn`: user message is latest turn in session
- `working`: derived from session status + active turn
- `error`: derived from assistant message error metadata or error-like tool state
- `durationMs`: from user createdAt to assistant completedAt/now
- `statusLabel`: OpenCode-like status mapping from last meaningful part

## 6.2 Status derivation policy

Map latest meaningful assistant activity to status text:

- reasoning -> "Thinking"
- read/list/grep/glob -> "Gathering context"
- edit/write/apply_patch -> "Making edits"
- bash -> "Running commands"
- question/permission -> "Waiting for input"
- fallback -> "Working"

Throttle status text changes to reduce rapid flicker (OpenCode-like behavior).

## 6.3 Part grouping policy

Within a turn:

- Summary text = last assistant text part
- Steps = tool + reasoning + non-summary assistant parts
- Hide duplicate summary text in steps when summary section is shown

---

## 7. Streaming Authority + Reconciliation Strategy

## 7.1 Problem

`useChat` currently mutates stores directly during stream callbacks while SSE also applies events. Without canonical reconciliation, duplicates can occur.

## 7.2 Policy

1. Keep optimistic local writes for immediate UI.
2. Mark optimistic entities with local metadata:

- `metadata.optimistic = true`
- `metadata.optimisticSource = "useChat"`

3. On SSE canonical upsert:

- If canonical matches optimistic by stable correlation key, replace/merge and clear optimistic marker.

## 7.3 Correlation keys

Message match priority:

1. exact `id`
2. assistant parent + creation window + role

Part match priority:

1. exact `id`
2. `messageID + type + callID` for tool parts
3. `messageID + type` for single active text part

## 7.4 Cleanup policy

At stream completion (or when assistant message marked complete):

- remove unresolved orphan optimistic parts
- keep canonical SSE entities only

---

## 8. UI Component Behavior Specs

## 8.1 MessageTimeline

Responsibilities:

- render turns in chronological order
- maintain stable keys by `userMessage.id`
- host scroll container and optional auto-scroll-to-bottom logic
- allow future integration with "load earlier"

Props:

- `turns`
- `isStreaming`
- `onRetry`
- `onDelete`
- `onCopy`

## 8.2 SessionTurn

Responsibilities:

- sticky user card at top of turn scope
- collapse/expand steps state
- status row with spinner when active and working
- summary markdown section when non-working and summary exists
- display error card if present

State:

- local: `stepsExpanded`
- derived: `working`, `statusLabel`, `durationLabel`, `summaryText`

## 8.3 MessagePart dispatcher

Map part types to renderer:

- `text` -> `TextPart`
- `reasoning` -> `ReasoningPart`
- `tool` -> `ToolPart`
- fallback -> `UnknownPart` (safe dev diagnostic)

## 8.4 ToolPart + BasicTool

Behaviors:

- trigger row with icon/title/subtitle/args
- open/close details
- `running` shows spinner-like indicator
- `completed` shows output/diff/result
- `error` shows error card styling
- permission/question lock states (future)

---

## 9. Styling Plan

## 9.1 CSS architecture

Use `chat-area.css` with data attributes:

- `[data-component="session-turn"]`
- `[data-slot="session-turn-sticky"]`
- `[data-component="text-part"]`
- `[data-component="tool-part"]`

Benefits:

- mirrors OpenCode maintainability
- avoids brittle class-only targeting

## 9.2 Core style requirements

1. Sticky user block with gradient fade
2. Collapsed user message with expand affordance
3. Tool cards with compact typography and subtle border hierarchy
4. Consistent vertical rhythm between turns
5. Hover-revealed copy actions
6. Scrollbar minimization where appropriate

---

## 10. Permissions and Questions Integration Plan

## 10.1 Current state

`usePermissions` opens independent SSE connection and maintains separate pending state.

## 10.2 Target state

Unify through existing app-level SSE flow:

- Permission/question events routed to dedicated store slices
- turn UI consumes those slices for inline cards and dock prompts

## 10.3 Steps

1. Add permission/question stores in `core/state/stores` (if not already)
2. Extend `event-router-adapter` to mutate these stores directly
3. Replace `usePermissions` live SSE with selectors + command methods only
4. Add inline renderers in `session-turn`/`message-part`

---

## 11. Sequential Phase Workbook (Work One-by-One)

Use this as the primary execution sequence. Do not start the next phase until the current phase exit criteria are met.

### OpenCode Reference Gate (required in every phase)

Before marking any phase complete:

1. Re-open relevant OpenCode files in cloned repo:

- `opencode/packages/app`
- `opencode/packages/ui`

2. Verify parity for that phase:

- hierarchy
- behavior
- interaction
- styling intent

3. Record intentional deviations (what/why).
4. Only then move to next phase.

---

### Phase 0 - Gap Closure Foundation (Must Be First)

Goal:

- Close architecture and data-flow gaps before starting UI parity work.

Why first:

- Building UI before resolving authority/reconciliation and state-shape gaps will create rework and unstable behavior.

Scope:

1. Define canonical authority contract:

- SSE/store is canonical for persisted entities.
- optimistic writes are temporary and must reconcile.

2. Normalize part/message shape contract for renderers:

- document required fields for `text`, `reasoning`, `tool`, `permission`, `question`.
- add local guards where shared event types are intentionally loose.

3. Resolve streaming dual-write policy in design (implementation may start here):

- local optimistic IDs + correlation keys for canonical replacement.

4. Decide permission/question state strategy:

- confirm migration from separate permission SSE stream to unified state path.

5. Produce a short architecture note in-repo (phase artifact):

- final rules for projection, reconciliation, and event ownership.

Exit criteria:

1. Written contract exists for canonical vs optimistic data.
2. Correlation/reconciliation rules are explicitly documented.
3. Renderer-required part field matrix is documented.
4. Permission/question unified-state direction is confirmed.
5. Open questions that block implementation are resolved.

OpenCode check:

- Confirm these contracts are aligned with OpenCode’s event->store->render behavior patterns in cloned repo.

---

### Phase 1 - Turn Projection + Timeline Skeleton

Goal:

- Replace center placeholder with a functional turn timeline (minimal UI).

Scope:

1. Build turn projection layer:

- `apps/desktop/src/core/chat/hooks/turn-projection.ts`
- `apps/desktop/src/core/chat/hooks/use-session-turns.ts`

2. Add skeleton chat-area components:

- `chat-area/message-timeline.tsx`
- `chat-area/session-turn.tsx`

3. Wire center panel in:

- `apps/desktop/src/views/workspace-view/index.tsx`

4. Render only:

- user message content
- assistant summary text

Exit criteria:

1. Center panel no longer placeholder.
2. Messages grouped by turns (user + assistant sequence).
3. Streaming assistant text updates in active turn.
4. No regressions in send/stop/retry flow.

OpenCode check:

- Compare with OpenCode `MessageTimeline` + `SessionTurn` grouping behavior.

---

### Phase 2 - Part Renderer System + Steps UX

Goal:

- Implement OpenCode-like steps rendering with part dispatch.

Scope:

1. Add component framework:

- `chat-area/message-part.tsx`
- `chat-area/basic-tool.tsx`

2. Add part components:

- `parts/text-part.tsx`
- `parts/reasoning-part.tsx`
- `parts/tool-part.tsx`

3. Add per-turn UI behavior:

- collapsible steps toggle
- live status text
- duration display
- copy actions

4. Introduce `chat-area.css` with `data-component`/`data-slot` conventions.

Exit criteria:

1. Steps can expand/collapse per turn.
2. Tool and reasoning content appears under steps.
3. Summary response is separate when complete.
4. Active turn shows live status + timing.

OpenCode check:

- Compare against OpenCode `message-part`, `basic-tool`, and step summary split.

---

### Phase 3 - Streaming Reconciliation Hardening

Goal:

- Eliminate duplicate/misaligned artifacts from local optimistic + SSE canonical updates.

Scope:

1. Add optimistic metadata tagging in `useChat`.
2. Implement canonical merge/replacement policy on SSE arrival.
3. Add completion cleanup for unresolved optimistic parts.
4. Add diagnostics counters/logging for dedupe/reconciliation outcomes.

Exit criteria:

1. No duplicate text/tool parts after stream completion.
2. Stable render keys and canonical IDs.
3. Retry/abort paths do not leave orphan UI artifacts.

OpenCode check:

- Ensure final rendered state stability matches OpenCode behavior after stream settles.

---

### Phase 4 - Permission/Question Path Unification

Goal:

- Use unified app SSE/state flow for permissions/questions and render inline/docked controls.

Scope:

1. Add/extend permission + question state slices in core stores.
2. Route events in `event-router-adapter` directly into those slices.
3. Refactor `usePermissions` away from separate EventSource subscription.
4. Add UI parts:

- `parts/permission-part.tsx`
- `parts/question-part.tsx`

Exit criteria:

1. Permission/question events are visible via unified state path.
2. Inline or dock prompts work and clear correctly on reply.
3. No duplicate event handling between separate SSE clients.

OpenCode check:

- Compare permission/question interaction behavior with OpenCode turn-integrated UX.

---

### Phase 5 - Visual Parity Polish + Performance

Goal:

- Reach production-quality parity in feel and responsiveness.

Scope:

1. Status text throttling.
2. Text render throttling (~100ms for streaming deltas).
3. Sticky gradients, spacing, and action affordances polish.
4. Optional virtualization in timeline if needed.
5. Accessibility pass:

- aria-live behavior
- keyboard interaction for expand/collapse

Exit criteria:

1. Smooth rendering during long streams.
2. No major layout shifts or flicker.
3. Interaction polish close to OpenCode target.
4. Performance acceptable for large sessions.

OpenCode check:

- Final side-by-side parity pass with cloned OpenCode behavior and visual hierarchy.
- comparable look/feel to OpenCode target

---

## 12. Testing Plan

## 12.1 Unit tests

1. Turn projection

- groups assistant messages by user parent
- summary extraction correctness
- step filtering correctness

2. Reconciliation

- optimistic + SSE canonical merge
- tool part matching by callID
- orphan cleanup on complete

3. Status derivation

- part sequences map to expected status labels

## 12.2 Integration tests (component-level)

1. streaming text appears in active turn
2. steps expand/collapse toggles content
3. summary appears when stream completes
4. retry reproduces turn behavior

## 12.3 E2E/manual matrix

1. Basic chat response
2. Long response with many deltas
3. Tool call with output
4. Reasoning + tool + summary combo
5. Permission ask/reply
6. Session switch while stream active
7. SSE reconnect mid-stream
8. Out-of-order event sequence replay

---

## 13. Observability and Debugging

Add structured logs (debug level) for:

- turn projection output counts
- stream part upsert counts
- reconciliation actions (merged/replaced/dropped)
- dedupe/order buffer stats snapshots

Add optional dev-only diagnostics panel:

- active session id
- stream status
- queued coalescer events
- dedupe hit counts
- pending parts buffer size

---

## 14. Risks and Mitigations

1. Duplicate rendering from dual writes

- Mitigation: explicit optimistic markers + canonical reconciliation.

2. Event schema looseness (`Part` is broad record)

- Mitigation: add local guards in part renderer and projection helpers.

3. Session ID race on new chat

- Mitigation: keep your existing server-authoritative session resolution path; ensure all local writes defer until resolved session id exists.

4. Performance with large sessions

- Mitigation: memoized turn selectors and optional virtualization in timeline.

5. Permission flow fragmentation

- Mitigation: phase 4 unification through core store/event path.

---

## 15. Definition of Done

The initiative is complete when:

1. Center panel is fully replaced with OpenCode-like chat area.
2. Turn UI matches target behavior (sticky user block, steps, summary, status).
3. Streaming is stable without duplicate artifacts.
4. Tool/reasoning rendering is production-usable.
5. Permission/question path is unified and functional.
6. Test matrix passes (unit + integration + manual/e2e critical flows).
7. Documentation updated (architecture + component usage notes).

---

## 16. Suggested Execution Order (Day-by-Day)

Day 1:

- Phase 1 scaffolding + panel wiring

Day 2:

- Phase 2 part components + styling baseline

Day 3:

- Phase 3 reconciliation hardening + tests

Day 4:

- Phase 4 permission/question unification

Day 5:

- Phase 5 polish + performance + QA pass

---

## 17. Immediate Next Actions

1. Create `chat-area/` components and turn projection hook skeleton.
2. Replace placeholder center panel with `MessageTimeline`.
3. Land a minimal vertical slice:

- user message card
- assistant streaming text summary
- per-turn grouping

Once this is merged, iterate to full parity via phases 2-5.

---

## 18. Changelog Note (2026-02-13)

Post-phase parity updates landed:

1. Retry events now emit and render as first-class timeline parts (`type: "retry"`).
2. Retry countdown rendering is deterministic and throttled to 1Hz.
3. Retry countdown formatting is compact (`1m 36s`).
4. Streaming retry policy moved to uncapped exponential series (`3s, 6s, 12s, ...`) with a hard stop at 10 retries.
5. Added retry-focused coverage:
   - core retry policy tests,
   - server retry part publication tests,
   - desktop chronological replay tests.
