# Kilocode-Grade Runtime Mode Hardening (Plan/Build + Explore Subagents) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Persist and enforce only `plan` and `build` as runtime session modes, while allowing both modes to spawn `explore` subagents (single or parallel) safely and deterministically.

**Architecture:** Runtime mode is a persisted session state (`tool_sessions`) with a strict enum (`plan | build`). Mode transitions are centralized, approval-gated, and lock-protected. `explore` remains a subagent type only (never a persisted runtime mode). Both `plan` and `build` runtime agents can call subagent tools, with policy enforcement so `plan` mode can only spawn `explore`.

**Tech Stack:** TypeScript, AI SDK tools, Drizzle (`tool_sessions`), Vitest, existing permission/event bus pipeline.

---

## Corrections from Previous Draft

1. Persisted runtime mode must be `"plan" | "build"` only.
2. `explore` is subagent-only and must not be selected as a session runtime mode.
3. Plan runtime must still be able to spawn `explore` (and support parallel explore fan-out).
4. Transition tests must cover `plan -> build` and `build -> plan` only; `* -> explore` must be invalid.

---

## Runtime Invariants (Must Hold)

1. Runtime mode domain: `null | "plan" | "build"` (`null` means legacy/unset; controller falls back to `build`).
2. Legal transitions: `build -> plan`, `plan -> build`; same-mode transitions are no-op.
3. No persisted `"explore"` runtime mode, ever.
4. Denied mode switch performs no state mutation.
5. Failed compile on `plan_exit` keeps runtime mode at `plan`.
6. `task` from `plan` mode may spawn only `explore` subagents.
7. Parallel `explore` fan-out returns deterministic ordering and isolated failures.

---

### Task 1: Persist Runtime Mode with Narrow Enum (`plan | build`)

**Files:**

- Modify: `packages/core/src/spec/helpers.ts`
- Test: `packages/core/tests/spec/helpers.test.ts`

**Step 1: Write the failing test**

Add tests for:

- `getSessionRuntimeMode(sessionId)` returns `null` when unset.
- `updateSessionRuntimeMode(sessionId, "plan")` then read returns `"plan"`.
- overwrite `"plan" -> "build"` updates one row (upsert behavior).
- legacy/invalid stored value (for example `"explore"`) reads back as `null`.

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @sakti-code/core test -- spec/helpers.test.ts`
Expected: FAIL due missing helper functions.

**Step 3: Write minimal implementation**

In `packages/core/src/spec/helpers.ts`:

- Add `SESSION_MODE_KEY = "runtimeMode"` under `tool_name: "spec"`.
- Add:
  - `type RuntimeMode = "plan" | "build"`
  - `getSessionRuntimeMode(sessionId): Promise<RuntimeMode | null>`
  - `updateSessionRuntimeMode(sessionId, mode: RuntimeMode): Promise<void>`
- Add a narrow parser:

```ts
function asRuntimeMode(value: unknown): "plan" | "build" | null {
  return value === "plan" || value === "build" ? value : null;
}
```

- Reuse the existing upsert structure used by `updateSessionSpec` / `updateCurrentTask`.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @sakti-code/core test -- spec/helpers.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/core/src/spec/helpers.ts packages/core/tests/spec/helpers.test.ts
git commit -m "feat(core): persist session runtime mode as plan/build"
```

---

### Task 2: Add Mode Transition Orchestrator (`plan <-> build`) with Locking

**Files:**

- Create: `packages/core/src/session/mode-transition.ts`
- Test: `packages/core/tests/session/mode-transition.test.ts`

**Step 1: Write the failing test**

Cover:

- no-op transitions return `noop` (`build -> build`, `plan -> plan`).
- invalid target (`to = "explore"`) returns `invalid` and no writes.
- denied approval returns `denied` and no writes.
- approved transition writes mode and returns `approved`.
- concurrent transitions for same session serialize deterministically (lock/mutex).

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @sakti-code/core test -- session/mode-transition.test.ts`
Expected: FAIL (module missing).

**Step 3: Write minimal implementation**

In `packages/core/src/session/mode-transition.ts`:

- Export:
  - `type RuntimeMode = "plan" | "build"`
  - `type ModeTransitionOutcome = "approved" | "denied" | "noop" | "invalid"`
  - `transitionSessionMode(...)`
- Allowed transitions:

```ts
const ALLOWED = new Set(["build->plan", "plan->build"]);
```

- Add per-session lock:

```ts
const sessionLocks = new Map<string, Promise<void>>();
```

- Flow:
  1. Resolve `from` (argument or persisted).
  2. Validate `to` (`plan|build`) and transition legality.
  3. Request approval (if callback provided).
  4. Write mode only after approval.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @sakti-code/core test -- session/mode-transition.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/core/src/session/mode-transition.ts packages/core/tests/session/mode-transition.test.ts
git commit -m "feat(core): add lock-safe runtime mode transition orchestrator"
```

---

### Task 3: Add `mode_switch` Permission Type and Approval Adapter

**Files:**

- Modify: `packages/shared/src/types.ts`
- Modify: `packages/core/src/security/permission-rules.ts`
- Modify: `packages/core/src/config/permissions.ts`
- Modify: `packages/server/src/routes/rules.ts`
- Create: `packages/core/src/session/mode-approval.ts`
- Test: `packages/core/tests/session/mode-approval.test.ts`
- Test: `packages/core/tests/security/permission-rules.test.ts`

**Step 1: Write the failing tests**

Cover:

- permission type `mode_switch` compiles and is accepted.
- default action for `mode_switch` is `ask`.
- `requestModeSwitchApproval` submits request with:
  - `permission: "mode_switch"`
  - `patterns: ["from->to"]`
  - `metadata: { fromMode, toMode, reason }`
- allow/deny/always behavior works through `PermissionManager`.
- server rules API schema accepts `mode_switch` in rule payload/evaluate endpoint.

**Step 2: Run tests to verify they fail**

Run:

- `pnpm --filter @sakti-code/core test -- session/mode-approval.test.ts`
- `pnpm --filter @sakti-code/core test -- security/permission-rules.test.ts`
  Expected: FAIL.

**Step 3: Write minimal implementation**

- Extend `PermissionType` in `packages/shared/src/types.ts`:

```ts
export type PermissionType = "read" | "edit" | "external_directory" | "bash" | "mode_switch";
```

- Add default rule in `createDefaultRules()`:
  - `{ permission: "mode_switch", pattern: "*", action: "ask" }`
- Add adapter `packages/core/src/session/mode-approval.ts`:
  - `requestModeSwitchApproval({ sessionId, fromMode, toMode, reason }): Promise<boolean>`
  - pattern string: `${fromMode}->${toMode}`
- Update `packages/server/src/routes/rules.ts` `z.enum([...])` to include `"mode_switch"`.

**Step 4: Run tests to verify they pass**

Run:

- `pnpm --filter @sakti-code/core test -- session/mode-approval.test.ts`
- `pnpm --filter @sakti-code/core test -- security/permission-rules.test.ts`
  Expected: PASS.

**Step 5: Commit**

```bash
git add packages/shared/src/types.ts packages/core/src/security/permission-rules.ts packages/core/src/config/permissions.ts packages/server/src/routes/rules.ts packages/core/src/session/mode-approval.ts packages/core/tests/session/mode-approval.test.ts packages/core/tests/security/permission-rules.test.ts
git commit -m "feat(core): add mode_switch permission and approval adapter"
```

---

### Task 4: Make `plan_enter` and `plan_exit` Use Transition Flow Correctly

**Files:**

- Modify: `packages/core/src/tools/plan.ts`
- Test: `packages/core/tests/spec/plan.test.ts`

**Step 1: Write the failing test**

Add tests:

- `plan_enter` sets runtime mode to `plan`.
- `plan_exit` denied approval returns `planning_continued`; no compile; no current task mutation; mode stays `plan`.
- `plan_exit` approved path compiles + updates `currentTask` + switches to `build`.
- compile failure after approval does not flip mode to `build`.

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @sakti-code/core test -- spec/plan.test.ts`
Expected: FAIL.

**Step 3: Write minimal implementation**

In `packages/core/src/tools/plan.ts`:

- `plan_enter`:
  - keep template/spec behavior.
  - call `updateSessionRuntimeMode(sessionID, "plan")`.
- `plan_exit` flow:
  1. Validate tasks/DAG preflight.
  2. Request `mode_switch` approval (`plan -> build`).
  3. If denied: return `{ status: "planning_continued", ... }`.
  4. Compile and set first ready task.
  5. Persist mode `build` only after successful compile/task update.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @sakti-code/core test -- spec/plan.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/core/src/tools/plan.ts packages/core/tests/spec/plan.test.ts
git commit -m "feat(core): gate plan_exit with approval and atomic mode transition"
```

---

### Task 5: Make Session Controller Resolve Runtime Agent from Persisted Mode

**Files:**

- Modify: `packages/core/src/session/controller.ts`
- Modify: `packages/core/src/session/types.ts`
- Test: `packages/core/tests/session/controller-simplified.test.ts`
- Test: `packages/core/tests/session/controller.test.ts`

**Step 1: Write the failing test**

Add assertions:

- no persisted mode -> `build` agent.
- persisted `plan` -> `plan` agent.
- persisted `build` -> `build` agent.
- legacy/invalid persisted value (including `explore`) -> fallback `build` with warning.
- checkpoint result includes selected runtime mode for diagnostics.

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @sakti-code/core test -- session/controller-simplified.test.ts session/controller.test.ts`
Expected: FAIL with current hardcoded build behavior.

**Step 3: Write minimal implementation**

In `packages/core/src/session/controller.ts`:

- resolve mode at `processMessage()` start via helper.
- map mode to `createAgent("plan" | "build", ...)`.
- include selected mode in checkpoint metadata/result.

In `packages/core/src/session/types.ts`:

- add optional runtime mode field for checkpoint diagnostics.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @sakti-code/core test -- session/controller-simplified.test.ts session/controller.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/core/src/session/controller.ts packages/core/src/session/types.ts packages/core/tests/session/controller-simplified.test.ts packages/core/tests/session/controller.test.ts
git commit -m "feat(core): resolve primary runtime agent from persisted plan/build mode"
```

---

### Task 6: Ensure Runtime `plan` Agent Can Spawn Explore and Exit Plan

**Files:**

- Modify: `packages/core/src/agent/registry.ts`
- Test: `packages/core/tests/agent/registry.test.ts`

**Step 1: Write the failing test**

Add assertions that `AGENT_REGISTRY.plan.tools` includes:

- `task`
- `task-parallel` (introduced in Task 8)
- `plan-exit`

Also keep assertions:

- no `write` / `bash` in `plan` agent (plan remains non-build runtime).

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @sakti-code/core test -- agent/registry.test.ts`
Expected: FAIL.

**Step 3: Write minimal implementation**

In `packages/core/src/agent/registry.ts`:

- update `plan` agent tool list to include subagent spawning and mode exit tools.
- keep plan runtime read-focused.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @sakti-code/core test -- agent/registry.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/core/src/agent/registry.ts packages/core/tests/agent/registry.test.ts
git commit -m "feat(core): enable explore spawning and plan exit in runtime plan agent"
```

---

### Task 7: Enforce Runtime-Mode Subagent Policy in `task` Tool

**Files:**

- Modify: `packages/core/src/tools/task.ts`
- Test: `packages/core/tests/tools/task.test.ts`
- Create: `packages/core/tests/tools/task-runtime-policy.test.ts`

**Step 1: Write the failing test**

Cover policy matrix:

- runtime `plan` + `subagent_type=explore` => allowed.
- runtime `plan` + `subagent_type in {plan,general}` => rejected.
- runtime `build` preserves existing behavior (`explore`, `plan`, `general` allowed).

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @sakti-code/core test -- tools/task.test.ts tools/task-runtime-policy.test.ts`
Expected: FAIL.

**Step 3: Write minimal implementation**

In `packages/core/src/tools/task.ts`:

- read runtime mode from `getSessionRuntimeMode(Instance.context.sessionID)`.
- add allow-list resolver:

```ts
if (mode === "plan" && subagent_type !== "explore") {
  throw new Error("Plan mode can only spawn explore subagents");
}
```

- keep default mode fallback to `build` when unset/invalid.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @sakti-code/core test -- tools/task.test.ts tools/task-runtime-policy.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/core/src/tools/task.ts packages/core/tests/tools/task.test.ts packages/core/tests/tools/task-runtime-policy.test.ts
git commit -m "feat(core): enforce runtime-mode policy for task subagent spawning"
```

---

### Task 8: Add Deterministic Parallel Explore Spawning Tool

**Files:**

- Create: `packages/core/src/tools/task-parallel.ts`
- Modify: `packages/core/src/tools/registry.ts`
- Modify: `packages/core/src/tools/index.ts`
- Modify: `packages/core/src/agent/registry.ts`
- Test: `packages/core/tests/tools/task-parallel.test.ts`

**Step 1: Write the failing test**

Cover:

- accepts N explore prompts and runs them concurrently.
- output order matches input order deterministically.
- failed child does not cancel successful siblings (`allSettled` behavior).
- per-request result includes status, error/final content, duration, tool calls.
- plan-mode policy enforcement applies (explore only).

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @sakti-code/core test -- tools/task-parallel.test.ts`
Expected: FAIL (tool missing).

**Step 3: Write minimal implementation**

Create `packages/core/src/tools/task-parallel.ts`:

- schema:
  - `tasks: Array<{ description: string; prompt: string }>` (min 1, max 8)
  - optional `max_concurrency` (1..8, default 4)
- enforce explore-only subagent type in this tool.
- run bounded parallelism and return stable index-ordered results.

Implementation sketch:

```ts
const settled = await Promise.allSettled(tasks.map((t, index) => runExplore(index, t)));
return settled.map((entry, index) => toOrderedResult(index, entry));
```

Wire tool into:

- `ToolName` union as `"task-parallel"`
- `toolRegistry`
- exported tools index
- runtime `build` and `plan` agent tool lists

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @sakti-code/core test -- tools/task-parallel.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/core/src/tools/task-parallel.ts packages/core/src/tools/registry.ts packages/core/src/tools/index.ts packages/core/src/agent/registry.ts packages/core/tests/tools/task-parallel.test.ts
git commit -m "feat(core): add deterministic parallel explore subagent tool"
```

---

### Task 9: Improve Mode-Switch Permission UX in Event Router + Dialog (Recommended)

**Files:**

- Modify: `apps/desktop/src/core/chat/domain/event-router-adapter.ts`
- Modify: `apps/desktop/src/components/permissions/permission-dialog.tsx`
- Test: `apps/desktop/tests/unit/core/chat/domain/event-router-adapter.test.ts`

**Step 1: Write the failing test**

Add assertions:

- `permission.asked` with `permission="mode_switch"` maps metadata to readable dialog text.
- description format includes `fromMode -> toMode` and `reason`.

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @sakti-code/desktop test -- event-router-adapter.test.ts`
Expected: FAIL.

**Step 3: Write minimal implementation**

In adapter (`event-router-adapter.ts`):

- if `permission === "mode_switch"`, set `toolName` to `mode_switch` and build friendly description:
  - `Switch mode: plan -> build`
  - include reason when present.

In dialog (`permission-dialog.tsx`):

- render a mode-switch-specific header copy when `request.toolName === "mode_switch"`.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @sakti-code/desktop test -- event-router-adapter.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/desktop/src/core/chat/domain/event-router-adapter.ts apps/desktop/src/components/permissions/permission-dialog.tsx apps/desktop/tests/unit/core/chat/domain/event-router-adapter.test.ts
git commit -m "feat(desktop): improve mode-switch permission UX copy"
```

---

### Task 10: Integration Hardening for Mode Switching + Parallel Explore

**Files:**

- Create: `packages/core/tests/session/mode-switching.integration.test.ts`
- Modify: `packages/core/tests/spec/plan.test.ts`
- Modify: `packages/core/tests/tools/task-parallel.test.ts`

**Step 1: Write the failing test**

Add end-to-end scenarios:

- repeated `plan_exit` calls are idempotent (no state corruption).
- concurrent transitions for same session serialize deterministically.
- denied transition does not leak into subsequent approved transition.
- compile failure after approval leaves mode in `plan`.
- parallel explore calls from both runtime modes complete with stable output ordering.

**Step 2: Run tests to verify they fail**

Run:

- `pnpm --filter @sakti-code/core test -- session/mode-switching.integration.test.ts`
- `pnpm --filter @sakti-code/core test -- spec/plan.test.ts`
- `pnpm --filter @sakti-code/core test -- tools/task-parallel.test.ts`
  Expected: FAIL.

**Step 3: Write minimal implementation fixes**

- tighten lock handling in `mode-transition.ts`.
- ensure `plan_exit` mutation order is approval -> compile/task -> mode write.
- ensure parallel tool maps settled results back to input index.

**Step 4: Run tests to verify they pass**

Run:

- `pnpm --filter @sakti-code/core test -- session/mode-switching.integration.test.ts spec/plan.test.ts tools/task-parallel.test.ts`
  Expected: PASS.

**Step 5: Commit**

```bash
git add packages/core/tests/session/mode-switching.integration.test.ts packages/core/tests/spec/plan.test.ts packages/core/tests/tools/task-parallel.test.ts packages/core/src/session/mode-transition.ts packages/core/src/tools/plan.ts packages/core/src/tools/task-parallel.ts
git commit -m "test(core): harden mode transitions and parallel explore behavior"
```

---

## Verification Gate (Before PR)

Run in order:

1. `pnpm --filter @sakti-code/core lint`
2. `pnpm --filter @sakti-code/core typecheck`
3. `pnpm --filter @sakti-code/core test`
4. `pnpm --filter @sakti-code/server test`
5. `pnpm --filter @sakti-code/desktop test`

Expected:

- All pass.
- Controller never boots runtime agent from `explore` persisted mode.
- Plan/build runtime both support explore subagent spawning.
- Parallel explore results are deterministic and stable across reruns.

---

## Config and Policy Examples

### Permission policy example (`mode_switch`)

```json
{
  "permissions": {
    "mode_switch": {
      "build->plan": "allow",
      "plan->build": "ask",
      "*": "ask"
    }
  }
}
```

### Runtime-mode semantics

- `build` runtime: normal coding workflow, can spawn `explore` / `plan` / `general` subagents.
- `plan` runtime: planning workflow, can spawn `explore` (single or parallel) and use `plan_exit`.

---

## Rollout Notes

- Keep fallback default to `build` when runtime mode is unset or invalid.
- Optional feature flag for staged rollout: `SAKTI_CODE_ENABLE_RUNTIME_MODE_SWITCHING=true`.
- Log transition audit records (`sessionId`, `from`, `to`, `approved`, `reason`).
- Add one-week production monitor for transition-denied and transition-failed counts.

---

## Out of Scope

- Persisting `explore` as a runtime mode.
- Replacing the full permission system architecture.
- Generic parallelization for non-explore subagents (follow-up if needed).

---

## Success Criteria

- Session runtime mode persists and validates as `plan|build` only.
- `plan_enter` / `plan_exit` are approval-safe and atomic.
- Controller respects persisted mode with safe fallback.
- Both runtime modes can spawn explore subagents.
- Parallel explore fan-out works deterministically with solid failure isolation.

---

## Observational Memory Reliability Addendum (Critical)

This addendum is mandatory for this plan because runtime mode hardening and explore-subagent reliability are tightly coupled.

If we only harden plan/build switching but leave subagent memory isolation and observer prompt routing incomplete, the system will still appear to work in happy paths while silently degrading trustworthiness in realistic sessions.

### Why This Addendum Exists

1. Explore subagent results are consumed as actionable evidence by the parent agent.
2. Any prompt-mode mismatch or memory-thread contamination can cause subtle factual drift.
3. Existing tests are broad and passing, but they do not yet pin the critical integration contracts.
4. The implementation must guarantee that explore findings are derived from isolated, mode-specific memory and that the handoff remains structured and durable.

### Additional Non-Negotiable Invariants

1. Explore subagent observational memory must be isolated from parent thread memory by default.
2. Explore-mode observer prompt must be the prompt actually passed to `generateText`, not just computed and discarded.
3. `session_id` in task tool must have explicit semantics: either true resume (shared thread) or forbidden; never ambiguous.
4. Exploration goal must be present in observable context when requested.
5. Structured result parsing must never fail silently without status signal.
6. Parent-facing handoff must include both machine-parsable fields and human-readable fallback.
7. Every invariant above must be enforced by at least one deterministic test.

### Required Scope Expansion

This plan now explicitly includes:

1. mode-aware observer prompt plumbing,
2. memory-thread isolation for subagents,
3. resume semantics hardening,
4. exploration-goal context injection,
5. structured handoff resiliency,
6. telemetry and diagnostics for observation/handoff failures,
7. expanded regression and soak testing.

---

### Task 11: Make Observer Runtime Prompt Truly Mode-Aware

**Files:**

- Modify: `packages/core/src/memory/observation/observer.ts`
- Modify: `packages/core/src/memory/observation/orchestration.ts`
- Test: `packages/core/tests/memory/observation/observer-runtime-prompt.test.ts`
- Modify: `packages/core/tests/memory/observation/agent-loop.test.ts`

**Step 1: Write the failing test**

Add tests that verify the prompt used by observer runtime is actually mode-specific:

- for mode `explore`, `callObserverAgent` must receive `buildObserverSystemPrompt("explore")`.
- for mode `default`, it must receive `buildObserverSystemPrompt("default")`.
- regression guard: ensure `OBSERVER_SYSTEM_PROMPT` constant is not the only prompt source at runtime.

**Step 2: Run test to verify it fails**

Run:

- `pnpm --filter @sakti-code/core test -- memory/observation/observer-runtime-prompt.test.ts`

Expected:

- FAIL, because observer currently uses the default static prompt.

**Step 3: Write minimal implementation**

In `packages/core/src/memory/observation/observer.ts`:

- extend input:

```ts
export interface ObserverInput {
  existingObservations: string;
  messages: ObservationMessage[];
  systemPrompt?: string;
}
```

- select prompt at call site:

```ts
const systemPrompt =
  typeof input.systemPrompt === "string" && input.systemPrompt.trim().length > 0
    ? input.systemPrompt
    : OBSERVER_SYSTEM_PROMPT;
```

In `packages/core/src/memory/observation/orchestration.ts`:

- `createObserverAgent(model, mode, timeoutMs)` must precompute:

```ts
const modePrompt = buildObserverPromptForMode(mode);
```

- and pass `systemPrompt: modePrompt` to `callObserverAgent(...)`.

**Step 4: Run test to verify it passes**

Run:

- `pnpm --filter @sakti-code/core test -- memory/observation/observer-runtime-prompt.test.ts memory/observation/agent-loop.test.ts`

Expected:

- PASS.

**Step 5: Commit**

```bash
git add packages/core/src/memory/observation/observer.ts packages/core/src/memory/observation/orchestration.ts packages/core/tests/memory/observation/observer-runtime-prompt.test.ts packages/core/tests/memory/observation/agent-loop.test.ts
git commit -m "fix(core): enforce mode-specific observer prompt at runtime"
```

---

### Task 12: Isolate Subagent Memory Thread from Parent by Default

**Files:**

- Modify: `packages/core/src/tools/task.ts`
- Modify: `packages/core/src/session/processor.ts`
- Test: `packages/core/tests/tools/task-memory-isolation.test.ts`
- Test: `packages/core/tests/session/processor-memory.test.ts`

**Step 1: Write the failing test**

Add tests that prove memory isolation:

- spawned subagent with no explicit resume uses `threadId = subagent session id`, not parent.
- parent and subagent writes persist to different memory thread ids.
- fallback to `Instance.context.sessionID` does not override explicit `threadId` passed by task tool.

**Step 2: Run test to verify it fails**

Run:

- `pnpm --filter @sakti-code/core test -- tools/task-memory-isolation.test.ts session/processor-memory.test.ts`

Expected:

- FAIL with current context fallback behavior.

**Step 3: Write minimal implementation**

In `packages/core/src/tools/task.ts`:

- when building subagent input context, set explicit thread/session context:

```ts
context: {
  threadId: agentId,
  sessionId: agentId,
  resourceId: "local",
  parentSessionId: instanceContext.sessionID,
  parentMessageId: instanceContext.messageID,
  mode: config.mode,
}
```

In `packages/core/src/session/processor.ts`:

- keep current precedence (`threadId` then `sessionId` then instance fallback), but add comments and tests to lock this contract.

**Step 4: Run test to verify it passes**

Run:

- `pnpm --filter @sakti-code/core test -- tools/task-memory-isolation.test.ts session/processor-memory.test.ts`

Expected:

- PASS.

**Step 5: Commit**

```bash
git add packages/core/src/tools/task.ts packages/core/src/session/processor.ts packages/core/tests/tools/task-memory-isolation.test.ts packages/core/tests/session/processor-memory.test.ts
git commit -m "fix(core): isolate subagent memory thread from parent session"
```

---

### Task 13: Define and Enforce `session_id` Resume Semantics

**Files:**

- Modify: `packages/core/src/tools/task.ts`
- Test: `packages/core/tests/tools/task-resume-semantics.test.ts`
- Modify: `packages/core/tests/tools/task.test.ts`

**Step 1: Write the failing test**

Define explicit behavior:

- if `session_id` provided, subagent uses that id as `agentId`, `threadId`, and `sessionId`.
- if omitted, new id generated and used consistently for all three.
- malformed `session_id` rejected with clear error.

**Step 2: Run test to verify it fails**

Run:

- `pnpm --filter @sakti-code/core test -- tools/task-resume-semantics.test.ts tools/task.test.ts`

Expected:

- FAIL.

**Step 3: Write minimal implementation**

In `packages/core/src/tools/task.ts`:

- add helper:

```ts
function resolveSubagentSessionId(input?: string): string {
  const id = input?.trim();
  if (id) return id;
  return `subagent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
```

- ensure same resolved id is used for:
  - `agentConfig.id`,
  - input context `threadId`,
  - input context `sessionId`,
  - return payload `sessionId`.

**Step 4: Run test to verify it passes**

Run:

- `pnpm --filter @sakti-code/core test -- tools/task-resume-semantics.test.ts tools/task.test.ts`

Expected:

- PASS.

**Step 5: Commit**

```bash
git add packages/core/src/tools/task.ts packages/core/tests/tools/task-resume-semantics.test.ts packages/core/tests/tools/task.test.ts
git commit -m "fix(core): make task session_id resume semantics explicit and consistent"
```

---

### Task 14: Inject Exploration Goal into Prompt and Context Deterministically

**Files:**

- Modify: `packages/core/src/tools/task.ts`
- Modify: `packages/core/src/prompts/memory/observer/modes.ts`
- Test: `packages/core/tests/tools/task-exploration-goal.test.ts`
- Test: `packages/core/tests/memory/observation/explore-prompts.test.ts`

**Step 1: Write the failing test**

Add tests:

- explore agent system prompt includes concrete goal text from the parent prompt.
- mode prompt placeholder `${explorationGoal}` is replaced when used for runtime prompt composition.
- goal persists in subagent input context metadata for debug/tracing.

**Step 2: Run test to verify it fails**

Run:

- `pnpm --filter @sakti-code/core test -- tools/task-exploration-goal.test.ts memory/observation/explore-prompts.test.ts`

Expected:

- FAIL.

**Step 3: Write minimal implementation**

In `packages/core/src/tools/task.ts`:

- update `buildExploreSystemPrompt(goal?: string)`:

```ts
const objective =
  goal?.trim() || "Explore the codebase and capture exact details about what you find.";
return `...\nYOUR OBJECTIVE: ${objective}\n...`;
```

- pass `prompt` as goal seed when `subagent_type === "explore"`.

In `packages/core/src/prompts/memory/observer/modes.ts`:

- add helper:

```ts
export function resolveModeTaskContext(mode: AgentMode, vars?: Record<string, string>): string;
```

- replace `${explorationGoal}` with provided var value.

**Step 4: Run test to verify it passes**

Run:

- `pnpm --filter @sakti-code/core test -- tools/task-exploration-goal.test.ts memory/observation/explore-prompts.test.ts`

Expected:

- PASS.

**Step 5: Commit**

```bash
git add packages/core/src/tools/task.ts packages/core/src/prompts/memory/observer/modes.ts packages/core/tests/tools/task-exploration-goal.test.ts packages/core/tests/memory/observation/explore-prompts.test.ts
git commit -m "feat(core): inject exploration goal into explore prompt and observer context"
```

---

### Task 15: Harden Structured Exploration Result Parsing and Status Signaling

**Files:**

- Modify: `packages/core/src/tools/task.ts`
- Test: `packages/core/tests/tools/task-result-parsing.test.ts`

**Step 1: Write the failing test**

Cover parsing robustness:

- fully tagged result yields populated fields.
- missing `<file_inventory>` or `<gaps>` yields partial result with parse warnings.
- no tags yields fallback extraction from plain text and `structured=false` flag.
- parser never silently returns all-empty payload without warning.

**Step 2: Run test to verify it fails**

Run:

- `pnpm --filter @sakti-code/core test -- tools/task-result-parsing.test.ts`

Expected:

- FAIL.

**Step 3: Write minimal implementation**

In `packages/core/src/tools/task.ts`:

- extend `ExplorationResult`:

```ts
interface ExplorationResult {
  findings: string;
  fileInventory: string;
  gaps: string;
  structured?: boolean;
  warnings?: string[];
  rawMessages?: string[];
}
```

- parser behavior:
  - set `structured=true` when required tags found,
  - append warnings for missing sections,
  - fallback to best-effort plain text extraction,
  - guarantee `warnings` when output is weak.

**Step 4: Run test to verify it passes**

Run:

- `pnpm --filter @sakti-code/core test -- tools/task-result-parsing.test.ts`

Expected:

- PASS.

**Step 5: Commit**

```bash
git add packages/core/src/tools/task.ts packages/core/tests/tools/task-result-parsing.test.ts
git commit -m "fix(core): harden exploration result parsing with structured status and warnings"
```

---

### Task 16: Parent Handoff Contract for Exploration Results

**Files:**

- Modify: `packages/core/src/session/processor.ts`
- Modify: `packages/core/src/tools/task.ts`
- Test: `packages/core/tests/session/processor-exploration-handoff.test.ts`

**Step 1: Write the failing test**

Add tests for parent handoff contract:

- tool result emitted by subagent includes:
  - `explorationResult.findings`,
  - `explorationResult.fileInventory`,
  - `explorationResult.gaps`,
  - parser status fields.
- parent next iteration message list contains tool result context (via AI SDK response messages persistence).

**Step 2: Run test to verify it fails**

Run:

- `pnpm --filter @sakti-code/core test -- session/processor-exploration-handoff.test.ts`

Expected:

- FAIL.

**Step 3: Write minimal implementation**

In `packages/core/src/tools/task.ts`:

- ensure `execute()` return object consistently carries `explorationResult` for explore mode, even on partial parse.

In `packages/core/src/session/processor.ts`:

- retain existing `stream.response` persistence path and add guard tests around fallback branches.
- if fallback branch is used, include minimal tool-result placeholder in messages for continuity.

**Step 4: Run test to verify it passes**

Run:

- `pnpm --filter @sakti-code/core test -- session/processor-exploration-handoff.test.ts`

Expected:

- PASS.

**Step 5: Commit**

```bash
git add packages/core/src/session/processor.ts packages/core/src/tools/task.ts packages/core/tests/session/processor-exploration-handoff.test.ts
git commit -m "test(core): enforce parent handoff contract for explore subagent results"
```

---

### Task 17: Add High-Signal Regression Tests for Memory/Prompt/Isolation Contracts

**Files:**

- Create: `packages/core/tests/integration/explore-memory-isolation.integration.test.ts`
- Create: `packages/core/tests/integration/explore-observer-prompt.integration.test.ts`
- Modify: `packages/core/tests/memory/observation/phase5-end-to-end.test.ts`

**Step 1: Write the failing test**

Add scenarios:

- spawn parent + explore child; assert distinct observational memory records.
- assert mode config in child record matches explore thresholds.
- assert observer prompt includes explore-specific markers and not default-only markers.
- assert handoff object is present in parent tool-result path.

**Step 2: Run tests to verify they fail**

Run:

- `pnpm --filter @sakti-code/core test -- integration/explore-memory-isolation.integration.test.ts integration/explore-observer-prompt.integration.test.ts`

Expected:

- FAIL.

**Step 3: Write minimal implementation**

- implement only what tests require from Tasks 11-16.
- avoid extra abstraction beyond needed helpers.

**Step 4: Run tests to verify they pass**

Run:

- `pnpm --filter @sakti-code/core test -- integration/explore-memory-isolation.integration.test.ts integration/explore-observer-prompt.integration.test.ts memory/observation/phase5-end-to-end.test.ts`

Expected:

- PASS.

**Step 5: Commit**

```bash
git add packages/core/tests/integration/explore-memory-isolation.integration.test.ts packages/core/tests/integration/explore-observer-prompt.integration.test.ts packages/core/tests/memory/observation/phase5-end-to-end.test.ts
git commit -m "test(core): add regression coverage for explore prompt and memory isolation"
```

---

### Task 18: Observability and Telemetry for Exploration Reliability

**Files:**

- Modify: `packages/core/src/tools/task.ts`
- Modify: `packages/core/src/session/processor.ts`
- Modify: `packages/core/src/memory/observation/orchestration.ts`
- Test: `packages/core/tests/tools/task-telemetry.test.ts`

**Step 1: Write the failing test**

Add telemetry assertions:

- parse warnings are logged with session/subagent id.
- mode prompt selection logs mode and prompt fingerprint.
- memory thread resolution logs selected thread id and source.

**Step 2: Run test to verify it fails**

Run:

- `pnpm --filter @sakti-code/core test -- tools/task-telemetry.test.ts`

Expected:

- FAIL.

**Step 3: Write minimal implementation**

Add structured logging fields:

- `subagent_type`, `subagent_session_id`, `parent_session_id`,
- `memory_thread_id`, `memory_mode`,
- `exploration_structured`, `exploration_warning_count`.

**Step 4: Run test to verify it passes**

Run:

- `pnpm --filter @sakti-code/core test -- tools/task-telemetry.test.ts`

Expected:

- PASS.

**Step 5: Commit**

```bash
git add packages/core/src/tools/task.ts packages/core/src/session/processor.ts packages/core/src/memory/observation/orchestration.ts packages/core/tests/tools/task-telemetry.test.ts
git commit -m "chore(core): add telemetry for explore memory and handoff reliability"
```

---

### Task 19: Backward Compatibility and Migration Hardening

**Files:**

- Modify: `packages/core/src/spec/helpers.ts`
- Modify: `packages/core/src/session/controller.ts`
- Create: `packages/core/tests/session/runtime-mode-legacy.test.ts`

**Step 1: Write the failing test**

Add tests:

- legacy runtime values (`explore`, invalid strings) do not crash controller.
- fallback behavior remains deterministic (`build`).
- migration path preserves active sessions.

**Step 2: Run test to verify it fails**

Run:

- `pnpm --filter @sakti-code/core test -- session/runtime-mode-legacy.test.ts`

Expected:

- FAIL.

**Step 3: Write minimal implementation**

- tighten runtime mode parser and fallback logging.
- no destructive migration; normalize on read.

**Step 4: Run test to verify it passes**

Run:

- `pnpm --filter @sakti-code/core test -- session/runtime-mode-legacy.test.ts`

Expected:

- PASS.

**Step 5: Commit**

```bash
git add packages/core/src/spec/helpers.ts packages/core/src/session/controller.ts packages/core/tests/session/runtime-mode-legacy.test.ts
git commit -m "fix(core): harden runtime mode fallback for legacy persisted values"
```

---

### Task 20: Deterministic Soak Testing for Explore Reliability Under Load

**Files:**

- Create: `packages/core/tests/integration/explore-soak.integration.test.ts`
- Modify: `packages/core/tests/session/mode-switching.integration.test.ts`

**Step 1: Write the failing test**

Add soak scenarios:

- 50 sequential explore spawns in same parent session without memory-thread collision.
- 20 parallel explore spawns with deterministic result indexing.
- interleaved mode switch requests and explore spawns do not corrupt runtime mode.

**Step 2: Run test to verify it fails**

Run:

- `pnpm --filter @sakti-code/core test -- integration/explore-soak.integration.test.ts session/mode-switching.integration.test.ts`

Expected:

- FAIL.

**Step 3: Write minimal implementation**

- use existing lock and per-subagent thread context.
- avoid global mutable state in task-parallel orchestration.

**Step 4: Run test to verify it passes**

Run:

- `pnpm --filter @sakti-code/core test -- integration/explore-soak.integration.test.ts session/mode-switching.integration.test.ts`

Expected:

- PASS.

**Step 5: Commit**

```bash
git add packages/core/tests/integration/explore-soak.integration.test.ts packages/core/tests/session/mode-switching.integration.test.ts
git commit -m "test(core): add soak coverage for explore reliability under load"
```

---

## Expanded Verification Gate (Required for Merge)

Run in order:

1. `pnpm --filter @sakti-code/core lint`
2. `pnpm --filter @sakti-code/core typecheck`
3. `pnpm --filter @sakti-code/core test -- memory/observation/**`
4. `pnpm --filter @sakti-code/core test -- tools/task*.test.ts`
5. `pnpm --filter @sakti-code/core test -- session/**`
6. `pnpm --filter @sakti-code/core test -- integration/explore*.test.ts`
7. `pnpm --filter @sakti-code/core test`
8. `pnpm --filter @sakti-code/server test`
9. `pnpm --filter @sakti-code/desktop test`

Expected:

1. No failures.
2. No flaky behavior across 3 repeated runs of explore integration tests.
3. No unexpected memory cross-contamination between parent and explore subagent threads.
4. No prompt-mode mismatch in runtime observer calls.
5. Structured exploration handoff always available with status signal.

---

## Detailed Design Notes

### Design Note 1: Prompt Routing Contract

The orchestration layer owns mode selection.

The observer execution layer owns model invocation.

The handoff between those two layers must include concrete runtime prompt text.

Never allow the observer execution layer to silently re-select default prompts once mode has been selected.

### Design Note 2: Thread Identity Contract

Subagent memory identity must be derived from subagent session id.

Parent identity must remain parent session id.

No implicit fallback should overwrite explicit subagent thread ids.

Fallback is allowed only when no thread/session id is present in input context.

### Design Note 3: Result Handoff Contract

Explore result shape is part of a stable contract:

```ts
interface ExplorationResult {
  findings: string;
  fileInventory: string;
  gaps: string;
  structured?: boolean;
  warnings?: string[];
  rawMessages?: string[];
}
```

The caller must not infer structured success from non-empty final content.

The caller must rely on `structured` and `warnings` fields for reliability decisions.

### Design Note 4: Runtime Mode and Subagent Mode Separation

Runtime mode:

- `plan | build`

Subagent mode:

- `explore | plan | general`

Observation mode:

- `default | explore | bug_fixing | refactoring | testing | debugging | research`

These are related but not identical domains.

Keep explicit mapping functions and tests for each mapping boundary.

---

## Expanded Risk Register

| Risk ID | Risk                                          | Severity | Likelihood | Mitigation      | Owner |
| ------- | --------------------------------------------- | -------: | ---------: | --------------- | ----- |
| R-01    | Observer prompt defaults silently for explore | Critical |       High | Task 11 + tests | Core  |
| R-02    | Parent/subagent memory contamination          | Critical |       High | Task 12 + tests | Core  |
| R-03    | Ambiguous resume semantics                    |     High |     Medium | Task 13 + tests | Core  |
| R-04    | Missing exploration goal injection            |     High |     Medium | Task 14         | Core  |
| R-05    | Silent parse degradation                      |     High |     Medium | Task 15         | Core  |
| R-06    | Parent handoff not durable                    |     High |     Medium | Task 16         | Core  |
| R-07    | Regression from refactors                     |     High |       High | Task 17         | Core  |
| R-08    | Low observability in prod                     |   Medium |       High | Task 18         | Core  |
| R-09    | Legacy data mismatch                          |   Medium |     Medium | Task 19         | Core  |
| R-10    | Load race regressions                         |   Medium |     Medium | Task 20         | Core  |

---

## Failure-Mode Matrix

| Failure Mode                            | Detection Signal                    | User Impact              | Automatic Recovery        | Manual Action          |
| --------------------------------------- | ----------------------------------- | ------------------------ | ------------------------- | ---------------------- |
| Explore observer using default prompt   | Runtime prompt fingerprint mismatch | Lower precision findings | None                      | Block release          |
| Parent and child sharing same thread id | Same thread id in telemetry         | Context pollution        | None                      | Patch + data cleanup   |
| Missing exploration tags                | `structured=false` + warnings       | Partial handoff          | Fallback parse            | Prompt refinement      |
| Invalid persisted runtime mode          | fallback warning log                | build fallback only      | Yes                       | none                   |
| Denied mode switch with mutation        | mode changed despite denial         | policy violation         | None                      | hotfix                 |
| Duplicate transition race               | inconsistent runtime mode           | unstable behavior        | lock serialized           | verify lock metrics    |
| Resume session mismatch                 | missing prior context               | confusion                | None                      | clarify contract       |
| Explore parallel index drift            | output order mismatch               | wrong association        | deterministic re-map      | add stricter tests     |
| Tool-result persistence miss            | no tool results in next iteration   | parent forgets subresult | fallback tool role append | investigate SDK branch |
| Missing parse warning logs              | silent degradation                  | hard diagnosis           | None                      | add telemetry          |

---

## Expanded Implementation Order (Strict)

1. Task 11 prompt routing.
2. Task 12 thread isolation.
3. Task 13 resume semantics.
4. Task 15 parse signaling.
5. Task 16 handoff durability.
6. Task 14 exploration goal injection.
7. Task 17 regressions.
8. Task 18 telemetry.
9. Task 19 compatibility.
10. Task 20 soak.

Rationale:

- Fix correctness-critical routing and isolation before adding new capability.
- Add parse status before depending on structured result quality.
- Add telemetry only after key contracts exist to avoid noisy low-value metrics.

---

## Coding Standards for This Plan

1. No hidden global state for session transitions or subagent thread ids.
2. All new helpers must be pure where possible.
3. Every helper that parses external text must return status metadata.
4. Every runtime fallback must emit one structured debug/warn log.
5. Every new branch in transition logic must have at least one failing-first test.

---

## Detailed Pseudocode References

### Pseudocode A: Mode-Aware Observer Agent

```ts
export function createObserverAgent(model: LanguageModelV3, mode: AgentMode, timeoutMs = 30000) {
  const systemPrompt = buildObserverPromptForMode(mode);

  return async (existingObservations: string, messages: ObservationMessage[]): Promise<string> => {
    const input: ObserverInput = {
      existingObservations,
      messages,
      systemPrompt,
    };

    const result = await callObserverAgent(input, model, timeoutMs);
    return result.observations;
  };
}
```

### Pseudocode B: Subagent Memory Context Resolver

```ts
function buildSubagentContext(
  agentId: string,
  parentSessionId: string,
  parentMessageId: string,
  mode: AgentMode
) {
  return {
    threadId: agentId,
    sessionId: agentId,
    resourceId: "local",
    parentSessionId,
    parentMessageId,
    mode,
  };
}
```

### Pseudocode C: Exploration Parse with Status

```ts
function parseExplorationResult(content: string): ExplorationResult {
  const warnings: string[] = [];

  const findings = extractTag(content, "findings");
  const fileInventory = extractTag(content, "file_inventory");
  const gaps = extractTag(content, "gaps");

  if (!findings) warnings.push("missing_findings_tag");
  if (!fileInventory) warnings.push("missing_file_inventory_tag");
  if (!gaps) warnings.push("missing_gaps_tag");

  const structured = warnings.length === 0;

  return {
    findings: findings ?? fallbackFindings(content),
    fileInventory: fileInventory ?? "",
    gaps: gaps ?? "",
    structured,
    warnings,
  };
}
```

---

## Full Test Matrix (Comprehensive)

### Unit: Prompt Routing

1. U-PR-001: default mode prompt selected for build.
2. U-PR-002: explore mode prompt selected for explore.
3. U-PR-003: unknown mode falls back to default.
4. U-PR-004: observer input uses override system prompt when provided.
5. U-PR-005: observer input uses default prompt when no override.
6. U-PR-006: explore prompt includes output format section.
7. U-PR-007: explore prompt includes precision guideline section.
8. U-PR-008: explore prompt includes exploration goal placeholder resolution.
9. U-PR-009: prompt routing does not mutate prompt source constants.
10. U-PR-010: prompt routing remains deterministic across repeated calls.

### Unit: Thread Isolation

11. U-TI-001: task tool assigns generated agent id to threadId.
12. U-TI-002: task tool assigns resume id to threadId.
13. U-TI-003: task tool assigns agent id to sessionId in context.
14. U-TI-004: processor respects explicit threadId over instance context.
15. U-TI-005: processor respects explicit sessionId over instance context when threadId missing.
16. U-TI-006: processor falls back to instance context only when explicit ids absent.
17. U-TI-007: memory output persists with resolved thread id.
18. U-TI-008: memory input fetch uses resolved thread id.
19. U-TI-009: parent/subagent ids differ in default spawn.
20. U-TI-010: parent/subagent ids match only on explicit resume.

### Unit: Resume Semantics

21. U-RS-001: omitted session_id generates non-empty id.
22. U-RS-002: provided session_id used as return sessionId.
23. U-RS-003: provided session_id used as agent config id.
24. U-RS-004: provided session_id used as threadId.
25. U-RS-005: provided session_id used as sessionId.
26. U-RS-006: invalid empty session_id rejected.
27. U-RS-007: whitespace-only session_id rejected.
28. U-RS-008: resume semantics documented in tool description.
29. U-RS-009: resume semantics unchanged across subagent types.
30. U-RS-010: resume path records telemetry flag.

### Unit: Parse and Handoff

31. U-PH-001: all tags present -> structured true.
32. U-PH-002: missing findings tag -> warning emitted.
33. U-PH-003: missing file inventory tag -> warning emitted.
34. U-PH-004: missing gaps tag -> warning emitted.
35. U-PH-005: no tags -> structured false + fallback content.
36. U-PH-006: parser preserves multiline findings.
37. U-PH-007: parser handles nested markdown safely.
38. U-PH-008: parser handles CRLF line endings.
39. U-PH-009: parser output always includes warnings array when degraded.
40. U-PH-010: parser output never returns all fields empty silently.

### Unit: Mode Config

41. U-MC-001: explore config threshold is 60000.
42. U-MC-002: default config threshold is 30000.
43. U-MC-003: explore config bufferTokens is 12000.
44. U-MC-004: explore config lastMessages is 15.
45. U-MC-005: unknown mode falls back to default config.
46. U-MC-006: mode config map immutable at runtime.
47. U-MC-007: merged custom config overrides expected keys only.
48. U-MC-008: scope remains thread for explore defaults.
49. U-MC-009: reflection threshold remains above observation threshold.
50. U-MC-010: config serialization round-trip stable.

### Integration: Parent + Explore Flow

51. I-PE-001: parent spawns explore child and receives non-empty result.
52. I-PE-002: child uses explore observer mode prompt.
53. I-PE-003: child stores observations under child thread id.
54. I-PE-004: parent stores observations under parent thread id.
55. I-PE-005: parent subsequent iteration sees tool-result context.
56. I-PE-006: parse warnings surface in tool result.
57. I-PE-007: parse warnings do not crash parent flow.
58. I-PE-008: child failure propagates error field to parent.
59. I-PE-009: child stop propagates stopped status to parent.
60. I-PE-010: child duration and iterations included in result.

### Integration: Runtime Mode + Explore

61. I-RM-001: plan runtime can spawn explore.
62. I-RM-002: build runtime can spawn explore.
63. I-RM-003: plan runtime policy rejects disallowed subagent types.
64. I-RM-004: mode switch denied keeps plan runtime.
65. I-RM-005: mode switch approved to build succeeds.
66. I-RM-006: compile failure keeps plan runtime.
67. I-RM-007: repeated plan_exit idempotent.
68. I-RM-008: concurrent mode switch serialized.
69. I-RM-009: invalid persisted runtime mode falls back to build.
70. I-RM-010: no persisted runtime mode defaults to build.

### Integration: Parallel Explore

71. I-PX-001: two explore tasks run concurrently.
72. I-PX-002: output order matches input order.
73. I-PX-003: one failure does not cancel siblings.
74. I-PX-004: each child has distinct thread id by default.
75. I-PX-005: each child emits per-task telemetry.
76. I-PX-006: aggregated result includes success and failure entries.
77. I-PX-007: deterministic mapping from index to result.
78. I-PX-008: max_concurrency limit enforced.
79. I-PX-009: invalid max_concurrency rejected.
80. I-PX-010: empty task array rejected.

### Soak and Reliability

81. S-RL-001: 50 sequential explore runs with no collisions.
82. S-RL-002: 20 parallel explore runs with no order drift.
83. S-RL-003: alternating plan/build transitions + explore runs stable.
84. S-RL-004: repeated parse-degraded outputs log warnings without crash.
85. S-RL-005: stale lock recovery does not deadlock observation.
86. S-RL-006: mode prompt routing remains consistent across long run.
87. S-RL-007: memory output persistence remains bounded and successful.
88. S-RL-008: no unhandled promise rejections in soak.
89. S-RL-009: no flaky test behavior across 3 repeats.
90. S-RL-010: total runtime within acceptable CI budget.

### Regression Guard Rails

91. R-GR-001: observer default behavior unchanged for non-explore modes.
92. R-GR-002: build runtime tool availability unchanged except planned updates.
93. R-GR-003: existing mode-config tests remain green.
94. R-GR-004: existing agent-loop tests remain green.
95. R-GR-005: existing plan tests remain green.
96. R-GR-006: existing task tests updated from placeholders to behavior checks.
97. R-GR-007: existing session processor tests remain green.
98. R-GR-008: server permission routes still accept old rules.
99. R-GR-009: desktop permission rendering unaffected for non-mode permissions.
100.  R-GR-010: no changes to unrelated tool schemas.

---

## Extended Command Catalog

### Focused test runs

1. `pnpm --filter @sakti-code/core test -- memory/observation/observer-runtime-prompt.test.ts`
2. `pnpm --filter @sakti-code/core test -- tools/task-memory-isolation.test.ts`
3. `pnpm --filter @sakti-code/core test -- tools/task-resume-semantics.test.ts`
4. `pnpm --filter @sakti-code/core test -- tools/task-exploration-goal.test.ts`
5. `pnpm --filter @sakti-code/core test -- tools/task-result-parsing.test.ts`
6. `pnpm --filter @sakti-code/core test -- session/processor-exploration-handoff.test.ts`
7. `pnpm --filter @sakti-code/core test -- integration/explore-memory-isolation.integration.test.ts`
8. `pnpm --filter @sakti-code/core test -- integration/explore-observer-prompt.integration.test.ts`
9. `pnpm --filter @sakti-code/core test -- integration/explore-soak.integration.test.ts`
10. `pnpm --filter @sakti-code/core test -- session/mode-switching.integration.test.ts`

### Repeatability runs

1. `pnpm --filter @sakti-code/core test -- integration/explore-memory-isolation.integration.test.ts && pnpm --filter @sakti-code/core test -- integration/explore-memory-isolation.integration.test.ts && pnpm --filter @sakti-code/core test -- integration/explore-memory-isolation.integration.test.ts`
2. `pnpm --filter @sakti-code/core test -- integration/explore-observer-prompt.integration.test.ts && pnpm --filter @sakti-code/core test -- integration/explore-observer-prompt.integration.test.ts && pnpm --filter @sakti-code/core test -- integration/explore-observer-prompt.integration.test.ts`

### Full verification runs

1. `pnpm --filter @sakti-code/core lint`
2. `pnpm --filter @sakti-code/core typecheck`
3. `pnpm --filter @sakti-code/core test`
4. `pnpm --filter @sakti-code/server test`
5. `pnpm --filter @sakti-code/desktop test`

---

## Operational Runbook

### Runbook 1: Diagnosing Suspected Memory Contamination

1. Capture parent session id from logs.
2. Capture subagent session id from task tool result.
3. Query observational memory records by thread id.
4. Verify records differ for parent and child.
5. If same id appears:
   - check task context builder,
   - check processor resolve precedence,
   - run isolation tests,
   - block release until fixed.

### Runbook 2: Diagnosing Low-Quality Explore Findings

1. Inspect telemetry for `memory_mode` and prompt fingerprint.
2. Confirm mode is `explore` for child session.
3. Confirm prompt fingerprint matches explore prompt baseline.
4. Check parse status (`structured`, `warnings`).
5. If warnings high:
   - inspect subagent final content format,
   - tune explore system prompt formatting reminders,
   - rerun parse tests.

### Runbook 3: Diagnosing Resume Mismatch

1. Confirm `session_id` passed to task tool.
2. Confirm returned `sessionId` equals requested id.
3. Confirm context threadId/sessionId in child input equals requested id.
4. Confirm memory read/write occurred in requested thread.
5. If mismatch found, reject deployment and patch resume resolver.

### Runbook 4: Diagnosing Mode Switch/Explore Interference

1. Record timeline of mode transition requests and explore spawns.
2. Inspect mode transition lock logs.
3. Validate no partial transition state writes on denied transitions.
4. Validate explore spawns read runtime mode correctly.
5. If race seen, reproduce with soak tests and patch lock granularity.

---

## Rollback Strategy

### Safe rollback criteria

Rollback if any of the following occurs in staging or production:

1. > 1% of explore results with empty findings and no warnings.
2. any confirmed parent/child memory contamination event.
3. any mode switch causing invalid persisted runtime value.
4. consistent flakiness in explore integration tests.

### Rollback steps

1. Disable runtime mode switching feature flag if enabled.
2. Revert commits for tasks 11-20 in reverse order.
3. Keep schema-compatible non-breaking logging changes if safe.
4. Re-run baseline test gate.
5. Re-enable only after targeted fix and green repeatability run.

---

## Documentation Updates Required

1. Update task tool docs to define `session_id` semantics precisely.
2. Update memory docs to explain parent/subagent thread isolation.
3. Update mode docs to clarify runtime mode vs subagent mode vs observation mode.
4. Update troubleshooting docs with parse warnings and telemetry interpretation.
5. Add one architecture diagram showing parent/subagent memory boundaries.

---

## Example Architecture Diagram (Text)

```text
User Message
   |
   v
Parent Runtime Agent (mode=plan or build, thread=<parent-session>)
   |
   |-- task(subagent_type=explore, session_id optional)
   |
   v
Explore Subagent AgentProcessor
   - agentId = <child-session>
   - context.threadId = <child-session>
   - context.sessionId = <child-session>
   - observation mode = explore
   - observer prompt = buildObserverSystemPrompt("explore")
   |
   v
Explore Final Content + Parsed ExplorationResult(structured,warnings,...)
   |
   v
Parent Agent receives tool-result in stream.response messages
   |
   v
Parent decides next action (plan refinement/build execution)
```

---

## Acceptance Checklist (Expanded)

### Functional

1. Runtime mode persisted as `plan|build` only.
2. Explore remains subagent-only.
3. Plan and build runtime both can spawn explore.
4. Explore subagent memory is isolated by default.
5. Resume semantics are explicit and tested.
6. Observer runtime prompt is mode-specific.
7. Exploration goal can be injected and verified.
8. Structured parsing reports degradation with warnings.
9. Parent handoff contains stable structured fields.
10. Parallel explore returns deterministic order.

### Reliability

11. No memory contamination in isolation tests.
12. No prompt routing mismatch in runtime tests.
13. No parse-silent failure in result parser tests.
14. No mode transition race corruption in integration tests.
15. No flaky failures across repeated integration test runs.

### Operability

16. Logs include session ids, mode, parse status.
17. Runbook steps validated by at least one dry run.
18. Rollback criteria documented and rehearsed.
19. Metrics dashboard includes error/warning counters.
20. Release notes call out changed contracts clearly.

---

## Final Success Criteria (Superset)

The work is complete only when all conditions below are true:

1. Mode switching is deterministic, approval-safe, and policy-driven for runtime `plan|build`.
2. Explore subagents are reliably spawnable from allowed runtime modes.
3. Explore subagents use isolated memory threads by default.
4. Explore observer behavior is truly mode-specific at runtime.
5. Structured exploration results are robust and self-describing under degraded outputs.
6. Parent agent receives reliable, parse-status-aware exploration handoff.
7. Expanded tests pass and remain stable under repeat runs.
8. Telemetry is sufficient to diagnose prompt, memory, and parse regressions quickly.
