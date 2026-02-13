# OpenCode Chat Parity Gap Closure Plan

## 1. Purpose

Close remaining parity gaps between `apps/desktop` chat UI and the OpenCode reference implementation after phases 0-5, with emphasis on:

1. Behavior parity (prompt surfaces, retry/status, steps/summary flow)
2. Data-model parity (question/permission payload fidelity)
3. Visual parity (slot-based styling and spacing hierarchy)
4. Real-fixture validation (recorded event streams)

This plan is implementation-ready and intended as a stable reference document.

---

## 2. Current Gap Summary

### 2.1 Critical gaps

1. Dual prompt surfaces (inline + modal) create non-parity UX and potential duplicate interaction paths.
2. Question store and event mapping flatten structured `questions[]` into a single question model.
3. Turn projection collapses session status to `busy|idle`, losing retry metadata.
4. Retry rendering/countdown path in `SessionTurn` is missing.

### 2.2 Important gaps

1. Duration display is projection-static instead of active-ticking while working.
2. `useThrottledValue` behaves like debounce under sustained updates, not OpenCode-like min-interval throttle.
3. Steps trigger behavior differs (show/hide states and conditions).
4. Styling parity is incomplete compared with OpenCode `session-turn`, `basic-tool`, and `message-part` CSS structure.

### 2.3 Quality gaps

1. Most chat-area tests use generated fixtures, not replayed recorded event traces.
2. No dedicated integration suite asserting parity behavior from recorded event fixture playback.

---

## 3. Source of Truth (Reference)

Use these OpenCode files as parity baseline during implementation and review:

1. `opencode/packages/ui/src/components/session-turn.tsx`
2. `opencode/packages/ui/src/components/message-part.tsx`
3. `opencode/packages/ui/src/components/basic-tool.tsx`
4. `opencode/packages/ui/src/components/session-turn.css`
5. `opencode/packages/ui/src/components/message-part.css`
6. `opencode/packages/ui/src/components/basic-tool.css`
7. `opencode/packages/app/src/pages/session/session-prompt-dock.tsx`
8. `opencode/packages/app/src/components/question-dock.tsx`

Implementation should align behavior and hierarchy, while preserving existing desktop design tokens and component conventions.

---

## 4. Scope and Non-Goals

### 4.1 In scope

1. Prompt surface unification in center panel
2. Question/permission model and event mapping fidelity
3. Retry-aware turn projection and UI
4. Active duration ticking + status cadence parity
5. True min-interval text throttling
6. Steps/summary behavior alignment
7. Slot-based styling parity pass
8. Fixture-first tests using `apps/desktop/tests/fixtures/recorded/*`

### 4.2 Out of scope

1. New product features unrelated to parity
2. Server protocol changes unless strictly required for type fidelity
3. Broad layout redesign outside chat area

---

## 5. Implementation Phases

## Phase A - Prompt Surface Unification

### Goal

Use one canonical prompt interaction surface in center panel, matching OpenCode’s dock pattern.

### Changes

1. Replace modal-driven prompt path in `apps/desktop/src/views/workspace-view/index.tsx`.
2. Add a session prompt dock component in `apps/desktop/src/views/workspace-view/chat-area/` that:
   - Shows pending question request block.
   - Shows pending permission request block.
   - Anchors near prompt area with gradient background treatment.
3. Keep inline historical prompt rendering for completed/answered items only.
4. Ensure pending prompt tool parts are hidden from steps when shown in dock to prevent duplicate UI.

### Target files

1. `apps/desktop/src/views/workspace-view/index.tsx`
2. `apps/desktop/src/views/workspace-view/chat-area/session-prompt-dock.tsx` (new)
3. `apps/desktop/src/views/workspace-view/chat-area/session-turn.tsx`
4. `apps/desktop/src/views/workspace-view/chat-area/chat-area.css`

### Exit criteria

1. No duplicated active prompt controls in modal + timeline + dock.
2. Pending prompt interaction happens in one location.
3. Historical answered prompts still visible in timeline context.

---

## Phase B - Question/Permission Data Fidelity

### Goal

Align question/permission domain model and event mapping with OpenCode-like payload semantics.

### Changes

1. Expand question store model from single `question` to structured `questions[]` entries.
2. Preserve option descriptions, multiple-select flags, and per-question headers where available.
3. Keep backward-compat parsing for existing flat fixtures and legacy shapes.
4. Update router mapping to persist full payload, not only first question.

### Target files

1. `apps/desktop/src/core/state/stores/question-store.ts`
2. `apps/desktop/src/core/chat/domain/event-router-adapter.ts`
3. `apps/desktop/src/views/workspace-view/chat-area/parts/question-part.tsx`
4. `apps/desktop/src/views/workspace-view/chat-area/parts/permission-part.tsx`
5. `apps/desktop/tests/fixtures/permission-question-fixtures.ts`

### Exit criteria

1. Store state preserves full `question.asked` payload shape.
2. UI can render structured multi-question flows from store data.
3. Legacy flat shapes continue to render (guarded compatibility).

---

## Phase C - Retry + Status + Duration Parity

### Goal

Match OpenCode’s active-turn behavior for retry messaging, status transitions, and duration updates.

### Changes

1. Propagate full session status payload into turn projection (not `busy|idle` flattening).
2. Add retry metadata on `ChatTurn` where relevant.
3. Render retry message, attempt count, and countdown in `SessionTurn`.
4. Add active duration ticker (1s cadence) while turn is working.
5. Keep status throttling at min interval with trailing latest value.

### Target files

1. `apps/desktop/src/core/chat/hooks/use-session-turns.ts`
2. `apps/desktop/src/core/chat/hooks/turn-projection.ts`
3. `apps/desktop/src/views/workspace-view/chat-area/session-turn.tsx`
4. `apps/desktop/src/core/chat/hooks/use-status-throttled-value.ts`

### Exit criteria

1. Retry states are visible and accurate in active turn.
2. Duration increments during active processing.
3. Status text does not flicker under rapid part changes.

---

## Phase D - Text Streaming Throttle + Steps/Summary Alignment

### Goal

Align streaming text behavior and steps trigger semantics with reference behavior.

### Changes

1. Rework `useThrottledValue` to true min-interval throttle semantics.
2. Ensure text updates flush periodically during long continuous streams.
3. Make steps trigger visible when `working || hasSteps`.
4. Add clear show/hide steps label behavior for non-working state.
5. Ensure final summary text is not duplicated inside expanded steps.

### Target files

1. `apps/desktop/src/core/chat/hooks/use-throttled-value.ts`
2. `apps/desktop/src/views/workspace-view/chat-area/session-turn.tsx`
3. `apps/desktop/src/views/workspace-view/chat-area/parts/text-part.tsx`

### Exit criteria

1. Streaming text appears smoothly under sustained deltas.
2. Steps trigger behavior matches intended parity conditions.
3. No duplicated summary content across sections.

---

## Phase E - Visual Parity Styling Pass

### Goal

Reach near-reference visual hierarchy while preserving current design system tokens.

### Changes

1. Add/expand slot-targeted CSS modules in chat area:
   - `session-turn.css`
   - `message-part.css`
   - `basic-tool.css`
2. Port critical layout semantics:
   - Sticky shell offsets and gradient fade
   - Spacing rhythm between message regions
   - Copy-action affordance visibility behavior
   - Tool trigger typography hierarchy
3. Keep existing token usage (`--background`, `--text-*`, etc.) and current component conventions.

### Target files

1. `apps/desktop/src/views/workspace-view/chat-area/chat-area.css`
2. `apps/desktop/src/views/workspace-view/chat-area/session-turn.css` (new)
3. `apps/desktop/src/views/workspace-view/chat-area/message-part.css` (new)
4. `apps/desktop/src/views/workspace-view/chat-area/basic-tool.css` (new)
5. `apps/desktop/src/views/workspace-view/chat-area/index.ts`

### Exit criteria

1. Sticky, spacing, and action affordances feel consistent with reference.
2. No major layout shifts in long streams.
3. Styling remains consistent with current desktop implementation tokens.

---

## 6. TDD Strategy

## 6.1 Rules

1. Write/adjust failing tests first per phase.
2. Use real recorded fixtures whenever flow-level behavior is being validated.
3. Use synthetic fixtures only for isolated unit edge cases that recorded fixtures cannot target cleanly.

## 6.2 Test order

1. Projection/store/router tests
2. Component unit tests
3. Fixture replay integration tests
4. Existing integration/e2e regression pass

## 6.3 Required new/updated suites

1. `apps/desktop/tests/unit/core/chat/hooks/turn-projection.test.ts`
   - Add retry/status payload coverage
2. `apps/desktop/tests/unit/core/chat/hooks/use-throttled-value.test.tsx`
   - Add sustained-stream periodic flush cases
3. `apps/desktop/tests/unit/views/workspace-view/chat-area/session-turn.test.tsx`
   - Add retry countdown + working trigger cases
4. `apps/desktop/tests/unit/views/workspace-view/chat-area/parts/question-part.test.tsx`
   - Add structured multi-question rendering/interaction
5. `apps/desktop/tests/integration/chat-area-parity-recorded.test.tsx` (new)
   - Replay recorded fixtures and assert parity-critical DOM behavior

---

## 7. Fixture Policy

## 7.1 Mandatory fixture sources

1. `apps/desktop/tests/fixtures/recorded/event-ordering.from-log.json`
2. `apps/desktop/tests/fixtures/recorded/chat-stream.from-log.json`

## 7.2 Fixture usage matrix

1. Replay event ordering fixture for:
   - steps visibility
   - retry/status transitions
   - prompt lifecycle
2. Replay chat stream fixture for:
   - text throttling smoothness
   - summary stability after completion

## 7.3 Anti-regression rule

Any new parity bug fix must include either:

1. A recorded fixture-based test, or
2. An extension of an existing recorded fixture case.

---

## 8. Detailed Acceptance Checklist

1. Single active prompt surface (dock) for pending permission/question.
2. No duplicate prompt controls in modal and inline timeline.
3. Full structured question payload persisted and rendered.
4. Retry status rendered with countdown and attempt metadata.
5. Active turn duration ticks every second while working.
6. Status label updates are throttled and non-flickering.
7. Text streaming uses periodic throttle flush, not end-only debounce.
8. Steps trigger and summary behavior match defined parity rules.
9. Slot-based styling pass complete and integrated.
10. Fixture replay integration tests cover critical parity scenarios.

---

## 9. Quality Gates

Before closing work:

1. `pnpm --dir apps/desktop test:run`
2. `pnpm --dir apps/desktop typecheck`
3. `pnpm --dir apps/desktop lint`

If any gate fails, parity phase is not complete.

---

## 10. Risks and Mitigations

1. Risk: Breaking existing question flows while expanding model.
   - Mitigation: backward-compatible parser in part components and router guards.
2. Risk: Retry metadata contract mismatch with upstream event shape.
   - Mitigation: introduce typed narrowing in projection and add fixture-based contract tests.
3. Risk: Styling drift from current design tokens.
   - Mitigation: keep token-driven CSS and avoid hardcoded non-system palette.
4. Risk: Performance regressions in large sessions.
   - Mitigation: throttle verification on recorded long-stream fixture and maintain minimal DOM churn.

---

## 11. Suggested Execution Sequence

1. Phase A (Prompt unification)
2. Phase B (Question/permission fidelity)
3. Phase C (Retry/status/duration)
4. Phase D (Text throttle + steps/summary)
5. Phase E (Visual polish)
6. Full regression and quality gates

---

## 12. Completion Definition

This gap-closure plan is complete when:

1. All acceptance checklist items are satisfied.
2. Recorded fixture integration suite passes.
3. Typecheck and lint pass cleanly.
4. Side-by-side comparison with OpenCode chat behavior shows no major parity gaps in prompt flow, turn behavior, and rendering cadence.
