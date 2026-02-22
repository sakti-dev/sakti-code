# Spec Generation Parity-Plus Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reach `cc-sdd` parity for spec-generation quality in this codebase, then exceed parity with deterministic runtime validation and stronger state guarantees.

**Architecture:** Keep database-backed spec/task runtime as canonical state, add a file-state mirror and prompt/rule/template layers to improve generation quality, and enforce critical invariants in code (not prompt text). Introduce phase-specific generation/validation tools with strict validators, full prompt packs, and comprehensive tests.

**Tech Stack:** TypeScript, AI SDK tools, Drizzle-backed task memory tables via `server-bridge`, Vitest, markdown templates in `.kiro/specs`, prompt constants in `packages/core/src/prompts`.

---

## 0. Plan Intent and Adaptation Guarantees

This plan is adapted to current implementation details in:

- `packages/core/src/spec/parser.ts`
- `packages/core/src/spec/compiler.ts`
- `packages/core/src/spec/helpers.ts`
- `packages/core/src/spec/templates.ts`
- `packages/core/src/tools/plan.ts`
- `packages/core/src/tools/registry.ts`
- `packages/core/src/agent/registry.ts`
- `packages/core/src/agent/spec-injector.ts`
- existing tests under `packages/core/tests/spec/*`

This plan deliberately does **not** replace canonical DB state with markdown-only state.

This plan deliberately does **not** rely on prompt-only guarantees for critical checks.

This plan deliberately includes complete prompt payloads (see Appendix A) and deep audit context (see Appendix B) so session compaction will not lose required implementation detail.

---

## 1. Inputs Re-Read and Included in This Plan

Mandatory synthesis sources:

- `docs/research/2026-02-22-cc-sdd-comparison-and-session-continuation.md`
- `docs/research/2026-02-22-adopt-vs-skip-implementation-diff.md`
- `docs/research/2026-02-22-prompt-generation-analysis-cc-sdd.md`
- `docs/research/2026-02-22-next-gen-spec-prompt-suite.md`
- `docs/research/2026-02-22-cc-sdd-deep-audit-round2-spec-generation.md`

Core synthesis into implementation:

1. Adopt layered model: prompts + rules + templates + validation tools.
2. Keep runtime DB canonical, add `spec.json` mirror for portability.
3. Extend parser/compiler for `(P)` and optional test marker `- [ ]*`.
4. Add deterministic validators for requirements/design/tasks coherence.
5. Add research artifact (`research.md`) as first-class phase output.
6. Add phase tools with explicit approval and failure behaviors.
7. Add full prompt pack constants and tests for prompt integrity.

---

## 2. Delivery Model

### 2.1 PR Sequence (Recommended)

1. PR-01: Spec state mirror foundation (`spec.json` helpers + tests)
2. PR-02: Parser/Compiler metadata expansion (`(P)`, optional test marker, stricter parse API)
3. PR-03: Plan tool hardening and strict missing-file behavior
4. PR-04: Validation tool family (`validate-gap`, `validate-design`, `validate-impl`) + registry wiring
5. PR-05: Prompt pack and rule/template infrastructure in core prompts layer
6. PR-06: Phase generator tools (requirements/design/tasks/research/status)
7. PR-07: Spec injector improvements for phase context and traceability visibility
8. PR-08: Integration tests, regression tests, docs update

### 2.2 Acceptance Gate for Full Completion

All must be true:

- New prompts committed and unit-tested for structure integrity.
- New phase tools available in tool registry and agent tool lists.
- Parser/Compiler capture and persist parallel/optional-test metadata.
- Deterministic validation tools return actionable machine-check output.
- `plan-exit` enforces strict checks and no silent fallback.
- New tests pass in `packages/core/tests/spec/*` and new validation test files.
- DB remains canonical source; file mirror writes are consistent and test-covered.

---

## 3. Target File Topology (Post-Implementation)

### 3.1 New Files (Planned)

- `packages/core/src/spec/state.ts`
- `packages/core/src/spec/validators.ts`
- `packages/core/src/prompts/spec/index.ts`
- `packages/core/src/prompts/spec/policies.ts`
- `packages/core/src/prompts/spec/requirements.ts`
- `packages/core/src/prompts/spec/gap-analysis.ts`
- `packages/core/src/prompts/spec/design.ts`
- `packages/core/src/prompts/spec/design-validation.ts`
- `packages/core/src/prompts/spec/tasks.ts`
- `packages/core/src/prompts/spec/impl.ts`
- `packages/core/src/prompts/spec/impl-validation.ts`
- `packages/core/src/prompts/spec/status.ts`
- `packages/core/src/prompts/spec/quick.ts`
- `packages/core/src/tools/spec.ts`
- `packages/core/src/tools/spec-validate.ts`
- `packages/core/tests/spec/state.test.ts`
- `packages/core/tests/spec/validators.test.ts`
- `packages/core/tests/spec/spec-tools.test.ts`
- `packages/core/tests/prompts/spec-prompts.test.ts`

### 3.2 Modified Files (Planned)

- `packages/core/src/spec/parser.ts`
- `packages/core/src/spec/compiler.ts`
- `packages/core/src/spec/helpers.ts`
- `packages/core/src/spec/templates.ts`
- `packages/core/src/tools/plan.ts`
- `packages/core/src/tools/registry.ts`
- `packages/core/src/tools/index.ts`
- `packages/core/src/tools/phase-tools.ts`
- `packages/core/src/agent/registry.ts`
- `packages/core/src/index.ts`
- `packages/core/tests/spec/parser.test.ts`
- `packages/core/tests/spec/compiler.test.ts`
- `packages/core/tests/spec/plan.test.ts`
- `packages/core/tests/spec/templates.test.ts`
- `packages/core/tests/spec/injector.test.ts`

---

## 4. Data Model and Runtime Invariants

### 4.1 Canonical and Mirror State

- Canonical: DB-backed task/spec runtime via `tool_sessions`, `tasks`, and `task_dependencies`.
- Mirror: `.kiro/specs/<slug>/spec.json` to improve portability and phase visibility.

Invariant:

- DB must be writable and consistent even if mirror write fails.
- Mirror write failure must produce warning but must not corrupt runtime state.

### 4.2 Parser and Compiler Metadata

Add to parsed task model:

- `parallel: boolean`
- `hasOptionalTestSubtasks: boolean`
- `subtasksDetailed: Array<{ text: string; optionalTest: boolean }>`

Persist into task metadata under `metadata.spec`:

- `parallel`
- `hasOptionalTestSubtasks`
- `subtasks`

### 4.3 Validator Hard Checks

Hard checks in code (not prompt):

- missing `tasks.md` should fail strict parser path
- tasks without requirement mapping fail compile/phase transition
- dependency references to unknown tasks fail compile
- non-DAG dependencies fail transition
- requirement ID format validation
- design/tasks traceability coverage checks

---

## 5. Detailed Execution Tasks

### Task 1: Create Spec State Mirror Module (`spec.json` IO)

**Files:**

- Create: `packages/core/src/spec/state.ts`
- Modify: `packages/core/src/spec/helpers.ts`
- Test: `packages/core/tests/spec/state.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { readSpecState, writeSpecState } from "../../src/spec/state";

describe("spec state mirror", () => {
  it("writes and reads spec.json phase state", async () => {
    // setup temp spec dir and call writeSpecState
    // expect readSpecState returns same fields
  });

  it("returns null when spec.json is missing", async () => {
    // expect null
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @sakti-code/core test -- packages/core/tests/spec/state.test.ts`
Expected: FAIL with module not found for `../../src/spec/state`.

**Step 3: Write minimal implementation**

Implement in `state.ts`:

- `export interface SpecStateMirror`
- `export async function readSpecState(specDir: string): Promise<SpecStateMirror | null>`
- `export async function writeSpecState(specDir: string, state: SpecStateMirror): Promise<void>`
- safe JSON parse with clear error text

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @sakti-code/core test -- packages/core/tests/spec/state.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/core/src/spec/state.ts packages/core/src/spec/helpers.ts packages/core/tests/spec/state.test.ts
git commit -m "feat(spec): add spec.json mirror read/write helpers"
```

---

### Task 2: Wire Mirror Writes into `plan-enter`

**Files:**

- Modify: `packages/core/src/tools/plan.ts`
- Modify: `packages/core/src/spec/templates.ts`
- Test: `packages/core/tests/spec/plan.test.ts`

**Step 1: Write the failing test**

Add test in `plan.test.ts`:

```ts
it("writes spec.json mirror during plan_enter", async () => {
  // call planEnterTool.execute
  // expect .kiro/specs/<slug>/spec.json exists and contains initialized phase
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @sakti-code/core test -- packages/core/tests/spec/plan.test.ts`
Expected: FAIL because `spec.json` is not written.

**Step 3: Write minimal implementation**

- In `writeSpecTemplate`, also create `spec.json` with:
  - `feature_name`, `created_at`, `updated_at`, `language`, `phase`, approvals map.
- In `planEnterTool.execute`, set initial phase metadata via helper.

**Step 4: Run test to verify it passes**

Run same command.
Expected: PASS for new assertion.

**Step 5: Commit**

```bash
git add packages/core/src/tools/plan.ts packages/core/src/spec/templates.ts packages/core/tests/spec/plan.test.ts
git commit -m "feat(spec): write spec.json mirror during plan enter"
```

---

### Task 3: Add Strict and Safe Parser APIs

**Files:**

- Modify: `packages/core/src/spec/parser.ts`
- Test: `packages/core/tests/spec/parser.test.ts`

**Step 1: Write the failing test**

Add tests:

```ts
it("parseTasksMdStrict throws ENOENT for missing tasks.md", async () => {
  await expect(parseTasksMdStrict("/missing/tasks.md")).rejects.toThrow();
});

it("parseTasksMdSafe returns [] for missing tasks.md", async () => {
  await expect(parseTasksMdSafe("/missing/tasks.md")).resolves.toEqual([]);
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @sakti-code/core test -- packages/core/tests/spec/parser.test.ts`
Expected: FAIL because functions do not exist.

**Step 3: Write minimal implementation**

In `parser.ts`:

- keep existing behavior as `parseTasksMdSafe`
- add `parseTasksMdStrict` that throws on read errors
- alias `parseTasksMd` to safe for backward compatibility (temporary)

**Step 4: Run test to verify it passes**

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/core/src/spec/parser.ts packages/core/tests/spec/parser.test.ts
git commit -m "refactor(spec): split tasks parser into strict and safe variants"
```

---

### Task 4: Parse `(P)` Marker and Optional Test Marker `- [ ]*`

**Files:**

- Modify: `packages/core/src/spec/parser.ts`
- Test: `packages/core/tests/spec/parser.test.ts`

**Step 1: Write the failing test**

```ts
it("parses task title with (P) marker as parallel=true", async () => {
  // tasks.md includes "### T-001 — Build worker (P)"
  // expect tasks[0].parallel === true
});

it("detects optional test subtasks using - [ ]*", async () => {
  // body has - [ ]* Add acceptance test baseline
  // expect hasOptionalTestSubtasks === true
});
```

**Step 2: Run test to verify it fails**

Run parser tests, observe new fields missing.

**Step 3: Write minimal implementation**

In task block parser:

- detect `(P)` suffix in title and normalize title text without suffix.
- parse subtasks with regex supporting `- [ ]` and `- [ ]*`.
- set:
  - `parallel`
  - `hasOptionalTestSubtasks`
  - `subtasksDetailed`

**Step 4: Run test to verify it passes**

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/core/src/spec/parser.ts packages/core/tests/spec/parser.test.ts
git commit -m "feat(spec): parse parallel marker and optional test subtasks"
```

---

### Task 5: Persist New Parsed Metadata in Compiler

**Files:**

- Modify: `packages/core/src/spec/compiler.ts`
- Test: `packages/core/tests/spec/compiler.test.ts`

**Step 1: Write the failing test**

```ts
it("persists parallel and optional-test metadata on compiled task", async () => {
  // compile task with (P) and - [ ]* subtask
  // expect metadata.spec.parallel === true
  // expect metadata.spec.hasOptionalTestSubtasks === true
});
```

**Step 2: Run test to verify it fails**

Run compiler test file.

**Step 3: Write minimal implementation**

Update metadata write paths in compiler create/update branches:

```ts
spec: {
  slug: specSlug,
  taskId: task.id,
  requirements: task.requirements,
  parallel: task.parallel ?? false,
  hasOptionalTestSubtasks: task.hasOptionalTestSubtasks ?? false,
  subtasks: task.subtasksDetailed ?? [],
}
```

**Step 4: Run test to verify it passes**

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/core/src/spec/compiler.ts packages/core/tests/spec/compiler.test.ts
git commit -m "feat(spec): persist parsed task execution metadata"
```

---

### Task 6: Restore Strict Missing `tasks.md` Behavior in Plan Exit

**Files:**

- Modify: `packages/core/src/tools/plan.ts`
- Modify: `packages/core/src/spec/parser.ts`
- Test: `packages/core/tests/spec/plan.test.ts`

**Step 1: Write the failing test**

Add test ensuring missing `tasks.md` always throws explicit error:

```ts
it("plan_exit fails with explicit tasks.md missing message", async () => {
  // no tasks.md exists
  // expect throw /tasks.md not found/
});
```

**Step 2: Run test to verify it fails**

Current behavior may resolve to empty tasks and different message.

**Step 3: Write minimal implementation**

In `planExitTool`:

- switch to `parseTasksMdStrict`.
- keep exact error message contract:
  - `tasks.md not found. Create it before exiting plan mode.`

**Step 4: Run test to verify it passes**

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/core/src/tools/plan.ts packages/core/src/spec/parser.ts packages/core/tests/spec/plan.test.ts
git commit -m "fix(plan): enforce strict missing tasks.md failure"
```

---

### Task 7: Add Deterministic Validator Module

**Files:**

- Create: `packages/core/src/spec/validators.ts`
- Test: `packages/core/tests/spec/validators.test.ts`

**Step 1: Write the failing test**

Test validator APIs:

```ts
describe("spec validators", () => {
  it("validates requirement ID format", () => {
    // expect invalid alphabetic heading to fail
  });

  it("validates requirements -> tasks mapping coverage", () => {
    // expect uncovered requirement IDs in error list
  });

  it("validates design traceability references", () => {
    // expect missing component mapping to fail
  });
});
```

**Step 2: Run test to verify it fails**

Expected: module missing.

**Step 3: Write minimal implementation**

Implement exported functions:

- `validateRequirementIds(requirementsContent: string)`
- `validateTasksCoverage(requirementsContent: string, tasksContent: string)`
- `validateDesignTraceability(requirementsContent: string, designContent: string)`
- `validateTaskFormat(tasksContent: string)` for `(P)` and `- [ ]*` conventions.

Return machine-friendly shape:

```ts
type ValidationResult = {
  ok: boolean;
  errors: Array<{ code: string; message: string; location?: string }>;
  warnings: Array<{ code: string; message: string; location?: string }>;
};
```

**Step 4: Run test to verify it passes**

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/core/src/spec/validators.ts packages/core/tests/spec/validators.test.ts
git commit -m "feat(spec): add deterministic validators for ids and traceability"
```

---

### Task 8: Add Validation Tools Skeleton (`spec-validate`) and Registry Wiring

**Files:**

- Create: `packages/core/src/tools/spec-validate.ts`
- Modify: `packages/core/src/tools/registry.ts`
- Modify: `packages/core/src/tools/index.ts`
- Modify: `packages/core/src/agent/registry.ts`
- Test: `packages/core/tests/spec/spec-tools.test.ts`

**Step 1: Write the failing test**

```ts
it("registers spec-validate-gap tool", () => {
  // assert tool name in registry and build agent tool list
});

it("spec-validate-gap returns structured validation response", async () => {
  // call execute and assert keys: ok/errors/warnings/nextSteps
});
```

**Step 2: Run test to verify it fails**

Expected: tool names not found.

**Step 3: Write minimal implementation**

In `spec-validate.ts`, add tools:

- `specValidateGapTool`
- `specValidateDesignTool`
- `specValidateImplTool`

Each reads spec files and calls `validators.ts`, returning JSON-safe output.

Add tool names to:

- `ToolName` union
- `toolRegistry`
- `AGENT_REGISTRY.build.tools`
- optionally `plan` tool list if needed

**Step 4: Run test to verify it passes**

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/core/src/tools/spec-validate.ts packages/core/src/tools/registry.ts packages/core/src/tools/index.ts packages/core/src/agent/registry.ts packages/core/tests/spec/spec-tools.test.ts
git commit -m "feat(tools): add spec validation tool family and registry wiring"
```

---

### Task 9: Add Prompt Pack Module Skeleton

**Files:**

- Create: `packages/core/src/prompts/spec/index.ts`
- Create: `packages/core/src/prompts/spec/policies.ts`
- Create: `packages/core/src/prompts/spec/requirements.ts`
- Create: `packages/core/src/prompts/spec/gap-analysis.ts`
- Create: `packages/core/src/prompts/spec/design.ts`
- Create: `packages/core/src/prompts/spec/design-validation.ts`
- Create: `packages/core/src/prompts/spec/tasks.ts`
- Create: `packages/core/src/prompts/spec/impl.ts`
- Create: `packages/core/src/prompts/spec/impl-validation.ts`
- Create: `packages/core/src/prompts/spec/status.ts`
- Create: `packages/core/src/prompts/spec/quick.ts`
- Test: `packages/core/tests/prompts/spec-prompts.test.ts`

**Step 1: Write the failing test**

```ts
it("exports all required phase prompt constants", async () => {
  // import index and assert all keys exist
});

it("all prompts include core policy fragment", async () => {
  // assert string contains SPEC_CORE_POLICY marker text
});
```

**Step 2: Run test to verify it fails**

Expected: module paths missing.

**Step 3: Write minimal implementation**

Add prompt constant scaffolding with explicit exported names:

- `SPEC_CORE_POLICY`
- `SPEC_CONTEXT_LOADING`
- `SPEC_FORMAT_RULES`
- `SPEC_TRACEABILITY_RULES`
- `SPEC_SAFETY_AND_FALLBACK`
- phase-specific prompt constants

Populate with full content from Appendix A.

**Step 4: Run test to verify it passes**

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/core/src/prompts/spec packages/core/tests/prompts/spec-prompts.test.ts
git commit -m "feat(prompts): add full spec phase prompt pack"
```

---

### Task 10: Integrate Prompt Pack Into Planner Agent

**Files:**

- Modify: `packages/core/src/agent/planner.ts`
- Modify: `packages/core/src/prompts/agent-modes.ts`
- Modify: `packages/core/src/agent/registry.ts`
- Test: `packages/core/tests/spec/spec-tools.test.ts`

**Step 1: Write the failing test**

```ts
it("planner agent instructions reference spec-phase prompt framework", () => {
  // create planner agent and inspect instructions text for phase contract markers
});
```

**Step 2: Run test to verify it fails**

Expected: old generic planner instructions.

**Step 3: Write minimal implementation**

- Replace plain planner instructions with composition of prompt policies.
- Keep concise default but route phase tools to detailed prompt constants.
- Update plan-mode prompt in `agent-modes.ts` to include references to phase gates and validation requirements.

**Step 4: Run test to verify it passes**

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/core/src/agent/planner.ts packages/core/src/prompts/agent-modes.ts packages/core/src/agent/registry.ts packages/core/tests/spec/spec-tools.test.ts
git commit -m "refactor(agent): wire planner to spec-phase prompt contracts"
```

---

### Task 11: Add Spec Generation Tools (Requirements/Design/Tasks/Status)

**Files:**

- Create: `packages/core/src/tools/spec.ts`
- Modify: `packages/core/src/tools/registry.ts`
- Modify: `packages/core/src/tools/index.ts`
- Modify: `packages/core/src/agent/registry.ts`
- Test: `packages/core/tests/spec/spec-tools.test.ts`

**Step 1: Write the failing test**

```ts
it("registers spec generation tools", () => {
  // expect tool names: spec-init/spec-requirements/spec-design/spec-tasks/spec-status
});

it("spec-status reports phase and counts", async () => {
  // create sample spec files and assert report structure
});
```

**Step 2: Run test to verify it fails**

Expected: tools not present.

**Step 3: Write minimal implementation**

Implement core tools:

- `specInitTool`
- `specRequirementsTool`
- `specDesignTool`
- `specTasksTool`
- `specStatusTool`

Behavior:

- read/write in `.kiro/specs/<slug>`
- use prompt constants for generation directives
- enforce approvals and validators before phase transitions
- update `spec.json` mirror and session runtime metadata

**Step 4: Run test to verify it passes**

Expected: PASS for registry presence and status behavior.

**Step 5: Commit**

```bash
git add packages/core/src/tools/spec.ts packages/core/src/tools/registry.ts packages/core/src/tools/index.ts packages/core/src/agent/registry.ts packages/core/tests/spec/spec-tools.test.ts
git commit -m "feat(spec-tools): add phase generation tools and status reporting"
```

---

### Task 12: Add `research.md` First-Class Lifecycle Support

**Files:**

- Modify: `packages/core/src/spec/templates.ts`
- Modify: `packages/core/src/tools/spec.ts`
- Test: `packages/core/tests/spec/templates.test.ts`
- Test: `packages/core/tests/spec/spec-tools.test.ts`

**Step 1: Write the failing test**

```ts
it("creates research.md template for new specs", async () => {
  // writeSpecTemplate -> expect research.md file
});

it("spec-design updates research.md before design.md", async () => {
  // assert timestamps or content markers in both files
});
```

**Step 2: Run test to verify it fails**

Expected: missing file or ordering markers.

**Step 3: Write minimal implementation**

- Add `RESEARCH_TEMPLATE` in templates module.
- Ensure `specDesignTool` writes/updates research first.
- Ensure design includes reference summary from research.

**Step 4: Run test to verify it passes**

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/core/src/spec/templates.ts packages/core/src/tools/spec.ts packages/core/tests/spec/templates.test.ts packages/core/tests/spec/spec-tools.test.ts
git commit -m "feat(spec): add research artifact lifecycle support"
```

---

### Task 13: Add Discovery Mode Classification (full/light/minimal)

**Files:**

- Modify: `packages/core/src/tools/spec.ts`
- Modify: `packages/core/src/prompts/spec/design.ts`
- Test: `packages/core/tests/spec/spec-tools.test.ts`

**Step 1: Write the failing test**

```ts
it("selects full discovery for complex/new features", async () => {
  // pass design input with integration complexity hints
  // expect selectedMode === "full"
});

it("selects light discovery for extensions", async () => {
  // expect selectedMode === "light"
});
```

**Step 2: Run test to verify it fails**

Expected: mode selection logic absent.

**Step 3: Write minimal implementation**

Implement helper:

```ts
function classifyDiscoveryMode(args: {
  requirements: string;
  designExists: boolean;
  hasExternalIntegrationHints: boolean;
}): "full" | "light" | "minimal" { ... }
```

Persist selected mode in metadata and status output.

**Step 4: Run test to verify it passes**

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/core/src/tools/spec.ts packages/core/src/prompts/spec/design.ts packages/core/tests/spec/spec-tools.test.ts
git commit -m "feat(spec-design): classify and persist discovery mode"
```

---

### Task 14: Requirements ID Normalization and Enforcement

**Files:**

- Modify: `packages/core/src/spec/validators.ts`
- Modify: `packages/core/src/tools/spec.ts`
- Test: `packages/core/tests/spec/validators.test.ts`
- Test: `packages/core/tests/spec/spec-tools.test.ts`

**Step 1: Write the failing test**

```ts
it("normalizes alphabetic requirement headings to numeric ids when allowed", () => {
  // input with Requirement A -> output with Requirement 1 mapping
});

it("fails phase transition when non-numeric ids remain", async () => {
  // expect explicit validation error
});
```

**Step 2: Run test to verify it fails**

Expected: no normalization function yet.

**Step 3: Write minimal implementation**

- Add `normalizeRequirementHeadings` utility.
- Add strict fail in transition if unresolved non-numeric IDs remain.
- Include mapping report in tool output.

**Step 4: Run test to verify it passes**

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/core/src/spec/validators.ts packages/core/src/tools/spec.ts packages/core/tests/spec/validators.test.ts packages/core/tests/spec/spec-tools.test.ts
git commit -m "feat(spec): enforce numeric requirement ids with normalization report"
```

---

### Task 15: Add `spec-quick` Orchestrator (Optional Fast Path)

**Files:**

- Modify: `packages/core/src/tools/spec.ts`
- Modify: `packages/core/src/prompts/spec/quick.ts`
- Test: `packages/core/tests/spec/spec-tools.test.ts`

**Step 1: Write the failing test**

```ts
it("spec-quick runs init->requirements->design->tasks in auto mode", async () => {
  // assert all artifact files are generated and phase progressed
});

it("spec-quick interactive mode stops between phases", async () => {
  // assert state after each checkpoint
});
```

**Step 2: Run test to verify it fails**

Expected: tool/flow absent.

**Step 3: Write minimal implementation**

- Add `specQuickTool` with `--auto` behavior.
- For now, interactive checkpoints implemented as explicit return statuses requiring reinvocation.
- Add caution output about skipped validations when auto mode is used.

**Step 4: Run test to verify it passes**

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/core/src/tools/spec.ts packages/core/src/prompts/spec/quick.ts packages/core/tests/spec/spec-tools.test.ts
git commit -m "feat(spec): add quick orchestrator with auto and checkpointed modes"
```

---

### Task 16: Add Status Report Enhancements

**Files:**

- Modify: `packages/core/src/tools/spec.ts`
- Modify: `packages/core/src/spec/helpers.ts`
- Test: `packages/core/tests/spec/spec-tools.test.ts`

**Step 1: Write the failing test**

```ts
it("spec-status includes phase completion percentages and next action", async () => {
  // assert fields: phaseProgress, taskBreakdown, blockers, nextCommand
});
```

**Step 2: Run test to verify it fails**

Expected: status shape not present.

**Step 3: Write minimal implementation**

- Derive completion percent per phase.
- Parse checked vs unchecked tasks.
- Include precise `nextAction` command recommendation.

**Step 4: Run test to verify it passes**

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/core/src/tools/spec.ts packages/core/src/spec/helpers.ts packages/core/tests/spec/spec-tools.test.ts
git commit -m "feat(spec-status): add phase percentages blockers and next command"
```

---

### Task 17: Enrich Spec Injector with Current Phase Context

**Files:**

- Modify: `packages/core/src/agent/spec-injector.ts`
- Modify: `packages/core/src/spec/state.ts`
- Test: `packages/core/tests/spec/injector.test.ts`

**Step 1: Write the failing test**

```ts
it("injects phase and approval context from spec.json mirror", async () => {
  // expect injected text contains phase and approvals summary
});
```

**Step 2: Run test to verify it fails**

Expected: injector currently task-centric only.

**Step 3: Write minimal implementation**

- Read `spec.json` mirror in injector context builder.
- Add compact phase summary above current task section.

**Step 4: Run test to verify it passes**

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/core/src/agent/spec-injector.ts packages/core/src/spec/state.ts packages/core/tests/spec/injector.test.ts
git commit -m "feat(injector): include spec phase and approval context"
```

---

### Task 18: Add Prompt Integrity Snapshot Tests

**Files:**

- Modify: `packages/core/tests/prompts/spec-prompts.test.ts`
- Create: `packages/core/tests/prompts/__snapshots__/spec-prompts.test.ts.snap` (if snapshot style used)

**Step 1: Write the failing test**

```ts
it("requirements prompt contains all required sections", () => {
  expect(REQUIREMENTS_PROMPT).toContain("Mission");
  expect(REQUIREMENTS_PROMPT).toContain("Execution Steps");
  expect(REQUIREMENTS_PROMPT).toContain("Safety & Fallback");
});

it("prompt files do not drop numeric-id guardrails", () => {
  expect(DESIGN_PROMPT).toContain("numeric requirement IDs");
  expect(TASKS_PROMPT).toContain("(P)");
});
```

**Step 2: Run test to verify it fails**

Expected: guards missing before full prompt migration.

**Step 3: Write minimal implementation**

- finalize prompt constants with required sections.
- add snapshots for critical prompts to detect accidental truncation.

**Step 4: Run test to verify it passes**

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/core/tests/prompts/spec-prompts.test.ts packages/core/tests/prompts/__snapshots__/spec-prompts.test.ts.snap
git commit -m "test(prompts): add integrity guards and snapshots for spec prompts"
```

---

### Task 19: Add End-to-End Spec Flow Test (Parity Path)

**Files:**

- Modify/Create: `packages/core/tests/spec/spec-tools.test.ts`

**Step 1: Write the failing test**

```ts
it("executes parity flow: init -> requirements -> design -> tasks -> validate", async () => {
  // run tools in sequence
  // assert artifacts + state transitions + no validation failures
});
```

**Step 2: Run test to verify it fails**

Expected: missing tools or state transitions.

**Step 3: Write minimal implementation**

- complete tool implementations and transitions.
- wire required helper calls.

**Step 4: Run test to verify it passes**

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/core/tests/spec/spec-tools.test.ts
git commit -m "test(spec): add end-to-end parity flow regression test"
```

---

### Task 20: Add “Parity-Plus” Deterministic Guard Tests

**Files:**

- Modify: `packages/core/tests/spec/spec-tools.test.ts`
- Modify: `packages/core/tests/spec/validators.test.ts`

**Step 1: Write the failing test**

```ts
it("rejects build-phase transition when traceability gaps remain", async () => {
  // expect explicit error codes from validators
});

it("rejects invalid parallel marker usage and reports location", () => {
  // invalid tasks format -> precise location in result
});
```

**Step 2: Run test to verify it fails**

Expected: permissive behavior before hard checks.

**Step 3: Write minimal implementation**

- ensure validation failure blocks transitions.
- include location-aware error reporting.

**Step 4: Run test to verify it passes**

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/core/tests/spec/spec-tools.test.ts packages/core/tests/spec/validators.test.ts
git commit -m "test(spec): enforce parity-plus deterministic guardrails"
```

---

### Task 21: Export and Public API Wiring

**Files:**

- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/src/tools/index.ts`
- Modify: `packages/core/src/prompts/index.ts`
- Test: `packages/core/tests/spec/spec-tools.test.ts`

**Step 1: Write the failing test**

```ts
it("exports spec prompt and tool APIs from package entrypoints", async () => {
  // import @sakti-code/core and assert named exports
});
```

**Step 2: Run test to verify it fails**

Expected: missing exports.

**Step 3: Write minimal implementation**

Add explicit exports for:

- prompt constants
- new spec tools
- validator helpers if intended public

**Step 4: Run test to verify it passes**

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/core/src/index.ts packages/core/src/tools/index.ts packages/core/src/prompts/index.ts packages/core/tests/spec/spec-tools.test.ts
git commit -m "chore(core): export new spec prompt and tool APIs"
```

---

### Task 22: Documentation Update for New Spec Workflow

**Files:**

- Modify: `docs/research/2026-02-22-adopt-vs-skip-implementation-diff.md` (status notes)
- Create: `docs/plans/2026-02-22-spec-generation-parity-plus-implementation-runbook.md`

**Step 1: Write the failing doc-check test (optional)**

If doc lint/snapshot exists, add assertions for command names and paths.

**Step 2: Run test to verify it fails**

If no doc tests, skip and record `N/A`.

**Step 3: Write minimal implementation**

Document:

- new phase tools
- new validator behavior
- `spec.json` mirror schema
- migration notes from old plan mode behavior

**Step 4: Run lint/check**

Run any markdown lint if configured.

**Step 5: Commit**

```bash
git add docs/plans/2026-02-22-spec-generation-parity-plus-implementation-runbook.md docs/research/2026-02-22-adopt-vs-skip-implementation-diff.md
git commit -m "docs(spec): add parity-plus workflow runbook"
```

---

### Task 23: Full Core Test Pass and Typecheck

**Files:**

- Modify as needed from failures

**Step 1: Run targeted spec tests first**

Run:

```bash
pnpm --filter @sakti-code/core test -- packages/core/tests/spec/parser.test.ts
pnpm --filter @sakti-code/core test -- packages/core/tests/spec/compiler.test.ts
pnpm --filter @sakti-code/core test -- packages/core/tests/spec/plan.test.ts
pnpm --filter @sakti-code/core test -- packages/core/tests/spec/spec-tools.test.ts
pnpm --filter @sakti-code/core test -- packages/core/tests/prompts/spec-prompts.test.ts
```

Expected: PASS.

**Step 2: Run full core test suite**

Run: `pnpm --filter @sakti-code/core test`
Expected: PASS.

**Step 3: Run typecheck**

Run: `pnpm --filter @sakti-code/core typecheck`
Expected: PASS.

**Step 4: Fix regressions minimally**

Patch only failing files.

**Step 5: Commit**

```bash
git add packages/core
git commit -m "test(core): ensure full parity-plus spec system passes tests and typecheck"
```

---

### Task 24: Final Parity Validation Against cc-sdd Criteria

**Files:**

- Create: `docs/research/2026-02-22-spec-generation-parity-validation-report.md`

**Step 1: Write failing checklist test (manual criterion sheet)**

Define checklist based on parity criteria:

- phased prompts present
- research/design split
- numeric id enforcement
- traceability checks
- task `(P)` and `- [ ]*` semantics
- validation command family
- state mirror + DB canonical consistency

**Step 2: Execute manual or scripted checklist**

Collect evidence paths and test outputs.

**Step 3: Write report**

Include:

- parity matched items
- parity exceeded items
- known deltas and follow-up work

**Step 4: Review and finalize**

Ensure references are accurate.

**Step 5: Commit**

```bash
git add docs/research/2026-02-22-spec-generation-parity-validation-report.md
git commit -m "docs(spec): add parity and parity-plus validation report"
```

---

## 6. Cross-Task Detailed Code Guidance (Adapted)

### 6.1 `SpecMetadata` Extension Contract

Target structure in `packages/core/src/spec/compiler.ts` and related helpers:

```ts
export interface SpecMetadata {
  spec: {
    slug: string;
    taskId: string;
    requirements: string[];
    parallel?: boolean;
    hasOptionalTestSubtasks?: boolean;
    subtasks?: Array<{
      text: string;
      optionalTest: boolean;
    }>;
  };
}
```

### 6.2 Parser Regex Guidance

Current title parser:

```ts
const taskBlocks = content.split(/^#{2,3}\s+(T-\d+)\s*[—–-]\s+(.+)$/m);
```

Add `(P)` support by detecting suffix in parsed title string:

```ts
const parallel = /\(P\)\s*$/.test(titleRaw);
const title = titleRaw.replace(/\s*\(P\)\s*$/, "").trim();
```

Current subtask parser:

```ts
const subtaskMatches = body.matchAll(/^-\s*\[\s*\]\s+(.+)$/gm);
```

Extended parser (supports optional marker):

```ts
const subtaskMatches = body.matchAll(/^-\s*\[\s*\](\*)?\s+(.+)$/gm);
for (const m of subtaskMatches) {
  const optionalTest = Boolean(m[1]);
  const text = m[2].trim();
}
```

### 6.3 Validator Coverage Algorithm (Requirements -> Tasks)

Pseudo-implementation:

```ts
const reqIds = extractRequirementIds(requirementsMd);
const taskReqIds = extractTaskMappedRequirementIds(tasksMd);
const uncovered = reqIds.filter(id => !taskReqIds.has(id));
```

Return codes:

- `REQ_ID_FORMAT_INVALID`
- `REQ_UNCOVERED_BY_TASKS`
- `TASK_FORMAT_INVALID_PARALLEL_MARKER`
- `TASK_FORMAT_INVALID_OPTIONAL_TEST_MARKER`
- `DESIGN_TRACEABILITY_GAP`

### 6.4 Validation Tool Response Contract

```ts
type SpecValidationResponse = {
  ok: boolean;
  phase: "gap" | "design" | "impl";
  errors: Array<{ code: string; message: string; location?: string }>;
  warnings: Array<{ code: string; message: string; location?: string }>;
  summary: string;
  nextSteps: string[];
};
```

### 6.5 Mirror File Schema (`spec.json`)

```json
{
  "feature_name": "<slug>",
  "created_at": "<ISO8601>",
  "updated_at": "<ISO8601>",
  "language": "en",
  "phase": "initialized",
  "approvals": {
    "requirements": { "generated": false, "approved": false },
    "design": { "generated": false, "approved": false },
    "tasks": { "generated": false, "approved": false }
  },
  "ready_for_implementation": false
}
```

### 6.6 Tool Naming Conventions in Registry

Use hyphenated names aligned with current `ToolName` style:

- `spec-init`
- `spec-requirements`
- `spec-design`
- `spec-tasks`
- `spec-status`
- `spec-quick`
- `spec-validate-gap`
- `spec-validate-design`
- `spec-validate-impl`

### 6.7 `phase-tools.ts` Update Guidance

Ensure plan and explore phases can access read-only validators and spec status tool if needed without write capabilities.

Potential plan-phase tool additions:

- `spec-status`
- `spec-validate-gap`
- `spec-validate-design`

Build phase gets all spec tools.

### 6.8 Agent Prompt Migration Guidance

Replace generic planning prompt in:

- `packages/core/src/agent/planner.ts`
- `packages/core/src/agent/registry.ts` (`plan` agent system prompt)

with policy-driven prompt assembly from `packages/core/src/prompts/spec/*`.

---

## 7. QA Matrix

### 7.1 Unit Coverage Matrix

- Parser:
  - strict missing file behavior
  - `(P)` detection
  - optional test marker detection
- Compiler:
  - metadata persistence
  - dependency/requirement validation
- Validators:
  - requirement format
  - coverage and traceability
- State mirror:
  - read/write and missing-file behavior

### 7.2 Tool Coverage Matrix

- Spec generation tools register and execute.
- Validation tools return structured output.
- Status tool summarizes phases and next action.
- Quick tool orchestrates phase progression.

### 7.3 Prompt Integrity Matrix

- all phase prompts exported
- required section markers present
- critical constraints preserved
- snapshots prevent accidental truncation

### 7.4 Integration Coverage Matrix

- full flow from init to tasks with validations
- plan-exit strict failure behavior
- injector context includes phase + current task + task index

---

## 8. Risk Log and Mitigation

### Risk 1: Prompt payload becomes too large and noisy

Mitigation:

- separate policy constants from phase constants
- compose prompts at runtime from reusable blocks
- unit test for mandatory sections only; avoid brittle full-string tests except targeted snapshots

### Risk 2: Overlapping state writes (DB vs mirror)

Mitigation:

- DB first, mirror second
- mirror write warning path with no DB rollback
- periodic consistency checker test in `state.test.ts`

### Risk 3: Regex-based validators too fragile

Mitigation:

- keep extraction logic modular
- include edge-case fixtures from real generated docs
- extend toward AST-ish markdown parser later if needed

### Risk 4: Tool explosion in build agent

Mitigation:

- map spec tools to plan/build modes intentionally
- keep descriptions concise and non-overlapping

### Risk 5: Existing tests assume old template format

Mitigation:

- migrate tests in small PRs
- preserve compatibility aliases where possible
- update expected fixtures deliberately

---

## 9. Rollout and Backward Compatibility

### Phase 1 (internal hidden)

- Add modules and tools but do not expose in user-facing UI yet.
- Keep old plan-enter/plan-exit behavior functioning.

### Phase 2 (dual path)

- Expose spec tools under feature flag.
- Run side-by-side with existing plan flow.

### Phase 3 (default)

- Set new spec generation flow as default path.
- Keep migration compatibility shim for old tasks format.

### Compatibility Policy

- Existing `T-###` format supported.
- Existing `R-###` mapping maintained.
- New metadata fields are optional and backward-compatible.

---

## 10. Implementation Checklist (Condensed)

- [ ] `spec.json` mirror IO module
- [ ] plan-enter mirror write
- [ ] strict/safe parser split
- [ ] `(P)` parse support
- [ ] `- [ ]*` parse support
- [ ] compiler metadata persistence
- [ ] plan-exit strict missing tasks check
- [ ] validators module
- [ ] validation tools and registry wiring
- [ ] full prompt pack constants
- [ ] planner prompt integration
- [ ] spec generation tools
- [ ] research artifact lifecycle
- [ ] discovery mode classification
- [ ] requirement ID normalization + strict enforcement
- [ ] quick orchestrator
- [ ] enhanced status reporting
- [ ] injector phase context
- [ ] prompt integrity tests
- [ ] end-to-end parity test
- [ ] parity-plus guard tests
- [ ] exports and public API wiring
- [ ] docs + runbook
- [ ] full tests + typecheck
- [ ] parity validation report

---

## 11. Command Reference for Implementer

### Targeted tests

```bash
pnpm --filter @sakti-code/core test -- packages/core/tests/spec/parser.test.ts
pnpm --filter @sakti-code/core test -- packages/core/tests/spec/compiler.test.ts
pnpm --filter @sakti-code/core test -- packages/core/tests/spec/plan.test.ts
pnpm --filter @sakti-code/core test -- packages/core/tests/spec/validators.test.ts
pnpm --filter @sakti-code/core test -- packages/core/tests/spec/spec-tools.test.ts
pnpm --filter @sakti-code/core test -- packages/core/tests/prompts/spec-prompts.test.ts
```

### Full validation

```bash
pnpm --filter @sakti-code/core test
pnpm --filter @sakti-code/core typecheck
```

---

## 12. Definition of Done

Project is done when:

1. All tasks in section 10 are completed and committed.
2. All tests and typecheck pass.
3. New prompt pack is fully committed and referenced by tools.
4. Validation tools deterministically block invalid transitions.
5. `spec.json` mirror exists and remains consistent with runtime transitions.
6. `docs/research/2026-02-22-spec-generation-parity-validation-report.md` confirms parity achieved and parity-plus items delivered.

---

## 13. Appendix A Notice

Appendix A includes the complete next-gen prompt suite (full text) to avoid loss during context compaction and to preserve implementation fidelity.

## 14. Appendix B Notice

Appendix B includes deep-audit findings required for rationale, tradeoff decisions, and anti-pattern avoidance during implementation.

---

# Appendix A: Full Prompt Suite (Verbatim Baseline)

# Next-Gen Spec Prompt Suite

## Objective

Provide a production-grade prompt suite for our planner/spec system that reaches and exceeds cc-sdd quality while preserving our runtime guarantees.

This suite is designed for direct adoption in `ekacode` and aligns with:

- session runtime modes (`plan`/`build`)
- parser/compiler pipeline
- DB-backed task graph
- spec context injection

---

## Design Principles

1. Runtime invariants stay in code.
2. Prompts enforce structure, clarity, and artifact quality.
3. Every phase has explicit inputs, outputs, and failure paths.
4. Context loading is deterministic and auditable.
5. Output summaries are schema-shaped for composability.
6. Templates and rules are configurable but structurally constrained.
7. Human review remains default; automation is explicit.

---

## Prompt Architecture

### Layers

1. Base Role Prompt
2. Shared Policy Blocks
3. Phase Prompt
4. Artifact Template Contract
5. Output Summary Contract
6. Fallback/Recovery Contract

### Shared Variables

Use these placeholders in prompts:

- `{{WORKSPACE_DIR}}`
- `{{KIRO_DIR}}` (default `.kiro`)
- `{{SPEC_SLUG}}`
- `{{SPEC_DIR}}` = `{{WORKSPACE_DIR}}/{{KIRO_DIR}}/specs/{{SPEC_SLUG}}`
- `{{SESSION_ID}}`
- `{{RUNTIME_MODE}}`
- `{{LANG}}`

### Shared Artifact Paths

- `{{SPEC_DIR}}/spec.json`
- `{{SPEC_DIR}}/requirements.md`
- `{{SPEC_DIR}}/research.md`
- `{{SPEC_DIR}}/design.md`
- `{{SPEC_DIR}}/tasks.md`
- `{{KIRO_DIR}}/steering/*.md`
- `{{KIRO_DIR}}/settings/templates/**`
- `{{KIRO_DIR}}/settings/rules/**`

---

## Shared Policy Block: SPEC_CORE_POLICY

```text
You are operating inside a spec-driven workflow.

Non-negotiable rules:
1) Read-first / write-last: collect required context before generating artifacts.
2) Phase integrity: do not produce downstream artifacts prematurely.
3) Deterministic structure: generated artifacts must follow the active template format.
4) Traceability: requirements must map to design and tasks.
5) Explainable decisions: include rationale and trade-offs for architectural decisions.
6) Fail loud on missing prerequisites.
7) Keep output concise in chat; write full detail to artifacts.

Critical boundary:
- Runtime invariants (mode transitions, DAG validity, compile checks) are enforced by tools/code.
- You must not claim to have bypassed tool-checked invariants.
```

---

## Shared Policy Block: SPEC_CONTEXT_LOADING

```text
Required context loading sequence:
1) Read spec metadata (`spec.json`) if present.
2) Read phase prerequisite artifacts for the current command.
3) Read all steering documents under `{{KIRO_DIR}}/steering/`.
4) Read relevant template and rule files under `{{KIRO_DIR}}/settings/`.
5) For brownfield work, inspect codebase structure and relevant modules.

When reporting completion, include a "Context Loaded" checklist in summary.
```

---

## Shared Policy Block: SPEC_FORMAT_RULES

```text
Formatting constraints:
- Keep markdown headings stable and consistent.
- Use explicit numbered sections where template expects numbering.
- Use requirement IDs consistently and exactly as defined.
- Do not invent IDs with a different scheme mid-document.
- Use tables where template expects tabular summaries.
- Keep prose dense and specific; avoid generic filler.
```

---

## Shared Policy Block: SPEC_TRACEABILITY_RULES

```text
Traceability rules:
- Every major requirement must map to at least one design element.
- Every task must include requirement references in task details.
- Cross-cutting concerns (auth, security, performance, observability) must be represented explicitly.
- If requirement coverage is incomplete, report gap explicitly and stop downstream progression.
```

---

## Shared Policy Block: SPEC_SAFETY_AND_FALLBACK

```text
Fallback behavior:
- Missing prerequisite artifact: stop and provide exact fix command.
- Missing template/rule file: warn and use minimal inline fallback structure.
- Ambiguous scope: propose 2-3 options with recommendation.
- Inconsistent IDs: stop and request normalization.

Never silently continue through critical inconsistencies.
```

---

## Prompt 1: SPEC_REQUIREMENTS_GENERATOR

### Intent

Generate high-quality requirements from project description and steering context.

### Prompt

```text
<Role>
You are a senior product+systems requirements engineer.
</Role>

<Mission>
Generate a comprehensive, testable requirements document for `{{SPEC_SLUG}}`.
</Mission>

<SuccessCriteria>
- Requirements are complete enough for design phase.
- Acceptance criteria are testable and unambiguous.
- Scope boundaries are explicit (goals/non-goals).
- Security/performance/observability constraints are represented.
</SuccessCriteria>

{{SPEC_CORE_POLICY}}
{{SPEC_CONTEXT_LOADING}}
{{SPEC_FORMAT_RULES}}
{{SPEC_TRACEABILITY_RULES}}
{{SPEC_SAFETY_AND_FALLBACK}}

<Inputs>
- `{{SPEC_DIR}}/spec.json` (if exists)
- `{{SPEC_DIR}}/requirements.md` (existing content or init stub)
- `{{KIRO_DIR}}/steering/*.md`
- `{{KIRO_DIR}}/settings/templates/specs/requirements.md`
- `{{KIRO_DIR}}/settings/rules/ears-format.md` (if exists)
</Inputs>

<ExecutionPlan>
1) Load and summarize project context from steering.
2) Extract feature intent from requirements init/project description.
3) Identify requirement domains:
   - Functional core flows
   - Data and state handling
   - Error handling/recovery
   - Security/privacy
   - Performance/scalability
   - Observability/operations
4) Draft requirements sections in template structure.
5) Write measurable acceptance criteria.
6) Validate internal consistency:
   - no contradictions
   - no missing critical constraints
   - no implementation-level code details
7) Update `requirements.md`.
8) Propose clarifying questions only for unresolved critical ambiguities.
</ExecutionPlan>

<HardConstraints>
- Focus on WHAT, not HOW.
- Do not generate design.md or tasks.md.
- Requirement IDs must be deterministic and stable.
- If existing IDs exist, preserve them.
</HardConstraints>

<QualityChecklist>
- [ ] All primary user/system outcomes represented
- [ ] Edge/error conditions covered
- [ ] Security concerns included where relevant
- [ ] Performance goals stated where applicable
- [ ] Acceptance criteria testable
- [ ] Non-goals explicitly listed
</QualityChecklist>

<OutputSummarySchema>
Return a concise markdown summary with:
1) Status
2) Requirements domains created
3) Risks/ambiguities requiring user decision
4) Context Loaded checklist
5) Next recommended command
</OutputSummarySchema>
```

---

## Prompt 2: SPEC_GAP_ANALYZER (Optional, Brownfield)

### Intent

Analyze the gap between requirements and existing implementation.

### Prompt

```text
<Role>
You are a senior brownfield modernization architect.
</Role>

<Mission>
Analyze implementation gaps for `{{SPEC_SLUG}}` by comparing requirements to current codebase.
</Mission>

<SuccessCriteria>
- Existing assets/patterns identified.
- Requirement-to-current-state gap map produced.
- 2-3 viable implementation approaches compared.
- Risks, unknowns, and required research clearly identified.
</SuccessCriteria>

{{SPEC_CORE_POLICY}}
{{SPEC_CONTEXT_LOADING}}
{{SPEC_FORMAT_RULES}}
{{SPEC_SAFETY_AND_FALLBACK}}

<Inputs>
- `{{SPEC_DIR}}/requirements.md`
- `{{KIRO_DIR}}/steering/*.md`
- `{{KIRO_DIR}}/settings/rules/gap-analysis.md` (if exists)
- Relevant codebase modules discovered via ls/glob/grep/read
</Inputs>

<ExecutionPlan>
1) Build requirement inventory with IDs.
2) Inspect existing code for corresponding capabilities.
3) Produce requirement-to-asset map:
   - Covered
   - Partially covered
   - Missing
   - Unknown (needs research)
4) Provide approaches:
   - Extend existing
   - New components
   - Hybrid
5) For each approach, estimate complexity/risk.
6) Identify blockers for design phase.
</ExecutionPlan>

<OutputContract>
Write analysis to `{{SPEC_DIR}}/research.md` (append/update under Gap Analysis section).

Return concise summary:
- Coverage highlights
- Preferred approach and rationale
- Must-resolve unknowns before design
- Next command
</OutputContract>
```

---

## Prompt 3: SPEC_DESIGN_GENERATOR

### Intent

Generate architecture-level design with traceability and explicit decisions.

### Prompt

```text
<Role>
You are a principal software architect.
</Role>

<Mission>
Produce `design.md` for `{{SPEC_SLUG}}` that translates approved requirements into implementable architecture and interfaces.
</Mission>

<SuccessCriteria>
- Every requirement is represented in design decisions.
- Components and interfaces are explicit.
- System flows and failure paths are clear.
- Risks/trade-offs are documented with rationale.
- Design is review-ready and implementation-safe.
</SuccessCriteria>

{{SPEC_CORE_POLICY}}
{{SPEC_CONTEXT_LOADING}}
{{SPEC_FORMAT_RULES}}
{{SPEC_TRACEABILITY_RULES}}
{{SPEC_SAFETY_AND_FALLBACK}}

<Inputs>
- `{{SPEC_DIR}}/spec.json` (if exists)
- `{{SPEC_DIR}}/requirements.md`
- `{{SPEC_DIR}}/research.md` (if exists)
- `{{KIRO_DIR}}/steering/*.md`
- `{{KIRO_DIR}}/settings/templates/specs/design.md`
- `{{KIRO_DIR}}/settings/templates/specs/research.md`
- `{{KIRO_DIR}}/settings/rules/design-principles.md`
- `{{KIRO_DIR}}/settings/rules/design-discovery-full.md` or light variant
</Inputs>

<DiscoveryModeSelection>
Choose one and state why:
- full discovery
- light discovery
- minimal discovery

Default to full when uncertain.
</DiscoveryModeSelection>

<ExecutionPlan>
1) Validate requirements completeness and ID consistency.
2) Run discovery suitable for complexity level.
3) Write/update `research.md` with:
   - findings
   - sources
   - implications
   - unresolved questions
4) Generate/update `design.md` using template structure.
5) Ensure sections include:
   - overview
   - goals/non-goals
   - architecture boundary map
   - technology rationale
   - system flows
   - requirements traceability
   - components and interfaces
   - data models
   - error handling
   - testing strategy
   - optional security/perf/migration where applicable
6) Validate design quality checklist.
</ExecutionPlan>

<HardConstraints>
- No production implementation code.
- Interfaces/contracts may include illustrative signatures.
- Use exact requirement IDs from requirements.md.
- If requirement IDs are malformed or inconsistent, stop and request fix.
</HardConstraints>

<QualityChecklist>
- [ ] Requirement traceability complete
- [ ] Architecture boundaries explicit
- [ ] External dependencies justified
- [ ] Failure modes documented
- [ ] Testing strategy aligns with risk
- [ ] Security/performance concerns represented when relevant
- [ ] Key decisions include alternatives and rationale
</QualityChecklist>

<OutputSummarySchema>
Return concise summary:
1) Status and discovery mode
2) Top design decisions and trade-offs
3) Open risks/questions
4) Context Loaded checklist
5) Next command (tasks or validation)
</OutputSummarySchema>
```

---

## Prompt 4: SPEC_DESIGN_VALIDATOR

### Intent

Perform high-signal review of design quality before tasks.

### Prompt

```text
<Role>
You are a rigorous architecture reviewer.
</Role>

<Mission>
Validate whether `design.md` for `{{SPEC_SLUG}}` is implementation-ready.
</Mission>

<SuccessCriteria>
- Critical issues identified (max 5, prioritize top 3).
- Evidence and requirement traceability included for each issue.
- Balanced strengths + risks.
- Clear GO / CONDITIONAL GO / NO-GO result.
</SuccessCriteria>

{{SPEC_CORE_POLICY}}
{{SPEC_CONTEXT_LOADING}}
{{SPEC_FORMAT_RULES}}
{{SPEC_TRACEABILITY_RULES}}

<Inputs>
- `{{SPEC_DIR}}/requirements.md`
- `{{SPEC_DIR}}/design.md`
- `{{SPEC_DIR}}/research.md` (if exists)
- `{{KIRO_DIR}}/steering/*.md`
- `{{KIRO_DIR}}/settings/rules/design-review.md`
</Inputs>

<ExecutionPlan>
1) Evaluate requirements coverage.
2) Evaluate architecture fit with project constraints.
3) Evaluate interface clarity and type safety.
4) Evaluate error handling and operational readiness.
5) Evaluate testing strategy quality.
6) Produce prioritized issues with evidence.
</ExecutionPlan>

<IssueFormat>
For each issue:
- Severity: Critical|Major|Minor
- Concern
- Impact
- Evidence (design section)
- Requirement reference
- Recommended correction
</IssueFormat>

<DecisionRule>
- GO: No critical blockers.
- CONDITIONAL GO: Corrective changes are bounded and clear.
- NO-GO: Core design flaws or major traceability gaps.
</DecisionRule>

<OutputSummarySchema>
Return:
1) Decision
2) Top issues (up to 5)
3) Design strengths
4) Required next action
</OutputSummarySchema>
```

---

## Prompt 5: SPEC_TASKS_GENERATOR

### Intent

Generate implementation task plan with traceability, dependencies, and parallel cues.

### Prompt

```text
<Role>
You are a staff-level delivery planner for engineering execution.
</Role>

<Mission>
Generate `tasks.md` for `{{SPEC_SLUG}}` from approved requirements and design.
</Mission>

<SuccessCriteria>
- Tasks are actionable and scoped.
- Every requirement has task coverage.
- Dependencies are explicit and valid.
- Parallelizable tasks are identified safely.
- Testing and integration work are included.
</SuccessCriteria>

{{SPEC_CORE_POLICY}}
{{SPEC_CONTEXT_LOADING}}
{{SPEC_FORMAT_RULES}}
{{SPEC_TRACEABILITY_RULES}}
{{SPEC_SAFETY_AND_FALLBACK}}

<Inputs>
- `{{SPEC_DIR}}/requirements.md`
- `{{SPEC_DIR}}/design.md`
- `{{SPEC_DIR}}/tasks.md` (if exists)
- `{{KIRO_DIR}}/steering/*.md`
- `{{KIRO_DIR}}/settings/templates/specs/tasks.md`
- `{{KIRO_DIR}}/settings/rules/tasks-generation.md`
- `{{KIRO_DIR}}/settings/rules/tasks-parallel-analysis.md`
</Inputs>

<ExecutionPlan>
1) Build requirement coverage matrix.
2) Build component-to-task decomposition from design.
3) Generate tasks with max two hierarchy levels.
4) For each task include:
   - clear objective
   - key implementation bullets
   - requirements mapping line
   - dependencies where needed
5) Mark parallelizable tasks with `(P)` only when safe.
6) Mark optional deferrable test-only work using `- [ ]*` only under strict conditions.
7) Validate numbering and traceability consistency.
8) Write/update `tasks.md`.
</ExecutionPlan>

<HardConstraints>
- Max 2 task levels.
- Requirement IDs must be exact.
- Do not emit orphan tasks with no requirement mapping.
- Avoid file-path-heavy micro-tasks; focus on capability outcomes.
- Include integration tasks to close loops.
</HardConstraints>

<ParallelizationRules>
Apply `(P)` only if all true:
- no data dependency on pending tasks
- no shared mutable resource conflict
- no review gate prerequisite
- independent testability

If unsure, do not mark parallel.
</ParallelizationRules>

<OutputSummarySchema>
Return summary with:
1) Status
2) Task counts (major/sub)
3) Requirement coverage stats
4) Parallel tasks count
5) Critical sequencing notes
6) Next command
</OutputSummarySchema>
```

---

## Prompt 6: SPEC_IMPL_EXECUTOR

### Intent

Execute selected tasks with verification discipline and spec alignment.

### Prompt

```text
<Role>
You are a senior implementation engineer executing against approved spec tasks.
</Role>

<Mission>
Implement selected tasks for `{{SPEC_SLUG}}` with strong verification and traceability.
</Mission>

<SuccessCriteria>
- Task scope respected.
- Tests and checks run.
- No regressions introduced.
- Task completion state updated accurately.
- Changes align with requirements and design.
</SuccessCriteria>

{{SPEC_CORE_POLICY}}
{{SPEC_CONTEXT_LOADING}}
{{SPEC_TRACEABILITY_RULES}}

<Inputs>
- `{{SPEC_DIR}}/requirements.md`
- `{{SPEC_DIR}}/design.md`
- `{{SPEC_DIR}}/tasks.md`
- `{{KIRO_DIR}}/steering/*.md`
- selected task IDs (or derive from pending)
</Inputs>

<ExecutionPlan>
1) Resolve target task set.
2) Confirm each task has requirement mappings.
3) Implement tasks incrementally.
4) Run relevant tests/checks after each major chunk.
5) Update task checkboxes only when verification passes.
6) Produce summary with evidence.
</ExecutionPlan>

<VerificationPolicy>
Minimum:
- project-level tests relevant to changed scope
- static checks where available
- explicit note of what could not be verified

Do not claim completion without verification evidence.
</VerificationPolicy>

<OutputSummarySchema>
Return:
1) Implemented task IDs
2) Verification commands run + pass/fail
3) Remaining tasks
4) Risks/deferred items
</OutputSummarySchema>
```

---

## Prompt 7: SPEC_IMPL_VALIDATOR

### Intent

Validate implemented tasks against requirements/design/contracts.

### Prompt

```text
<Role>
You are an implementation quality auditor.
</Role>

<Mission>
Validate implementation for `{{SPEC_SLUG}}` and selected tasks.
</Mission>

<SuccessCriteria>
- Task completion is evidence-backed.
- Requirement coverage is demonstrated.
- Design alignment is checked.
- Regression risk is surfaced.
- Clear GO/NO-GO verdict.
</SuccessCriteria>

{{SPEC_CORE_POLICY}}
{{SPEC_CONTEXT_LOADING}}
{{SPEC_TRACEABILITY_RULES}}

<Inputs>
- `{{SPEC_DIR}}/requirements.md`
- `{{SPEC_DIR}}/design.md`
- `{{SPEC_DIR}}/tasks.md`
- changed code and tests
- runtime task state if available
</Inputs>

<ExecutionPlan>
1) Resolve validation target tasks.
2) Confirm each target task marked complete in tasks.md.
3) Validate requirement-to-code evidence.
4) Validate design contract alignment.
5) Validate test coverage and pass status.
6) Report defects with severity and file evidence.
</ExecutionPlan>

<Decision>
- GO: all critical checks pass.
- NO-GO: critical failures or unverified required behavior.
</Decision>

<OutputSummarySchema>
Return:
1) Decision
2) Failed checks by severity
3) Coverage summary
4) Required fixes
</OutputSummarySchema>
```

---

## Prompt 8: SPEC_STATUS_REPORTER

### Intent

Produce deterministic status snapshot by merging file + runtime state.

### Prompt

```text
<Role>
You are a workflow status reporter.
</Role>

<Mission>
Report current spec status for `{{SPEC_SLUG}}` with actionable next step.
</Mission>

<Inputs>
- `{{SPEC_DIR}}/spec.json` (if present)
- `{{SPEC_DIR}}/requirements.md` (if present)
- `{{SPEC_DIR}}/design.md` (if present)
- `{{SPEC_DIR}}/tasks.md` (if present)
- runtime mode/current task (if available)
</Inputs>

<OutputSchema>
1) Feature overview
2) Artifact existence matrix
3) Approval/phase state
4) Task completion counts
5) Runtime mode/current task
6) Blockers
7) Next recommended command
</OutputSchema>
```

---

## Prompt 9: SPEC_QUICK_ORCHESTRATOR (Optional)

### Intent

Fast path for drafting artifacts across phases with explicit caveats.

### Prompt

```text
<Role>
You are a spec workflow orchestrator.
</Role>

<Mission>
Execute init -> requirements -> design -> tasks for `{{SPEC_SLUG}}`.
</Mission>

<Modes>
- interactive (default): require user confirmation between phases
- auto (explicit): run continuously and report skipped review gates
</Modes>

<ExecutionPlan>
1) Initialize state and artifacts.
2) Run requirements generation.
3) Run design generation.
4) Run tasks generation.
5) Emit final summary and explicit skipped-gates list.
</ExecutionPlan>

<Constraints>
- Never default to auto mode.
- In auto mode, print prominent warning that review gates were skipped.
</Constraints>
```

---

## Shared Output Schemas (Canonical)

### Requirements Phase Summary

```json
{
  "phase": "requirements",
  "status": "generated|updated|blocked",
  "domains": ["functional", "security", "performance"],
  "open_questions": ["..."],
  "context_loaded": ["spec.json", "steering/*", "requirements template", "EARS rules"],
  "next_command": "..."
}
```

### Design Phase Summary

```json
{
  "phase": "design",
  "status": "generated|updated|blocked",
  "discovery_mode": "full|light|minimal",
  "decisions": [{ "title": "...", "tradeoff": "..." }],
  "risks": ["..."],
  "context_loaded": ["requirements.md", "steering/*", "design template", "design rules"],
  "next_command": "..."
}
```

### Tasks Phase Summary

```json
{
  "phase": "tasks",
  "status": "generated|updated|blocked",
  "major_tasks": 0,
  "sub_tasks": 0,
  "requirements_covered": 0,
  "requirements_total": 0,
  "parallel_tasks": 0,
  "sequencing_notes": ["..."],
  "next_command": "..."
}
```

### Impl Validation Summary

```json
{
  "phase": "validate-impl",
  "decision": "GO|NO-GO",
  "critical_failures": 0,
  "major_failures": 0,
  "minor_findings": 0,
  "coverage": {
    "tasks": "x/y",
    "requirements": "x/y",
    "tests": "pass|partial|fail"
  },
  "required_fixes": ["..."]
}
```

---

## Runtime Integration Notes (Important)

### Hard Checks in Code (Do Not Move to Prompt)

Keep these enforced by tools:

- Mode transition legality
- DAG validation
- Requirement mapping integrity
- Task dependency validity
- Compilation error handling

### Prompt Responsibilities

Prompts should handle:

- artifact quality
- structure and traceability clarity
- review/readability
- operator guidance

### State Strategy

- DB is canonical runtime state.
- `spec.json` is canonical human-facing workflow mirror.
- tool operations should synchronize both.

---

## Suggested File Layout for Prompt Assets in `ekacode`

Proposed new structure:

- `packages/core/src/prompts/spec/shared.ts`
- `packages/core/src/prompts/spec/requirements.ts`
- `packages/core/src/prompts/spec/gap.ts`
- `packages/core/src/prompts/spec/design.ts`
- `packages/core/src/prompts/spec/design-validate.ts`
- `packages/core/src/prompts/spec/tasks.ts`
- `packages/core/src/prompts/spec/impl.ts`
- `packages/core/src/prompts/spec/impl-validate.ts`
- `packages/core/src/prompts/spec/status.ts`
- `packages/core/src/prompts/spec/quick.ts`

Shared exports:

- `SPEC_CORE_POLICY`
- `SPEC_CONTEXT_LOADING`
- `SPEC_FORMAT_RULES`
- `SPEC_TRACEABILITY_RULES`
- `SPEC_SAFETY_AND_FALLBACK`

---

## Proposed Prompt Constants (Code Skeleton)

```ts
// packages/core/src/prompts/spec/shared.ts
export const SPEC_CORE_POLICY = `...`;
export const SPEC_CONTEXT_LOADING = `...`;
export const SPEC_FORMAT_RULES = `...`;
export const SPEC_TRACEABILITY_RULES = `...`;
export const SPEC_SAFETY_AND_FALLBACK = `...`;
```

```ts
// packages/core/src/prompts/spec/design.ts
import {
  SPEC_CORE_POLICY,
  SPEC_CONTEXT_LOADING,
  SPEC_FORMAT_RULES,
  SPEC_TRACEABILITY_RULES,
  SPEC_SAFETY_AND_FALLBACK,
} from "./shared";

export const SPEC_DESIGN_GENERATOR_PROMPT = `
...full prompt text...
${SPEC_CORE_POLICY}
${SPEC_CONTEXT_LOADING}
${SPEC_FORMAT_RULES}
${SPEC_TRACEABILITY_RULES}
${SPEC_SAFETY_AND_FALLBACK}
`;
```

---

## Quality Upgrades Beyond cc-sdd

1. Explicit runtime-boundary statements in every prompt.
2. Schema-like output summaries for easier orchestration.
3. Stronger failure discipline: stop on ID inconsistency.
4. Deterministic context-loaded checklist in outputs.
5. Decision tier `CONDITIONAL GO` in design validation.
6. Integration of runtime mode/current task into status reporting.

---

## Test Plan for Prompt Suite Adoption

### Unit Tests

- prompt builders include shared blocks
- placeholder expansion sanity
- output schema sections present

### Integration Tests

- phase tool uses correct prompt constants
- status summaries include required fields
- fallback instructions appear on missing artifacts

### Artifact Snapshot Tests

- generate sample requirements/design/tasks and compare structure
- verify traceability section appears where expected

---

## Rollout Plan

### Wave 1

- Add shared blocks + requirements/design/tasks prompts
- Wire to relevant tools/subagents
- Keep existing behavior fallback

### Wave 2

- Add validator prompts + status reporter prompt
- introduce `spec.json` mirror status in summaries

### Wave 3

- Add quick orchestrator prompt
- gate auto mode with explicit flag and warnings

---

## Anti-Regression Guardrails

- Do not remove existing parser/compiler validations.
- Do not bypass mode transition orchestrator.
- Do not mark tasks complete without verification evidence.
- Do not auto-approve by default.

---

## Final Notes

This suite is intentionally comprehensive and production-oriented.
It is designed to deliver at least parity with cc-sdd in artifact quality while surpassing it in runtime correctness and deterministic execution behavior.

---

# Appendix B: Deep Audit (Verbatim Baseline)

# cc-sdd Deep Audit (Round 2): Spec-Generation Quality and Full Extraction

Date: 2026-02-22
Repository analyzed: `./cc-sdd`
Audit goal: identify _all_ mechanisms that drive high-quality spec generation, including hidden prompt structures, template/rule interactions, runtime installation behavior, and weak points we should not copy blindly.

---

## 1) Scope and Method

This pass focused on:

1. Full prompt/template/rule surface area in `tools/cc-sdd/templates/`.
2. Runtime/installer behavior in `tools/cc-sdd/src/`.
3. Example generated specs in `cc-sdd/.kiro/specs/*`.
4. Release notes and migration guides for implicit design intent.
5. Cross-agent parity patterns and platform-specific deltas.

This is an audit of **how quality is induced** (prompt engineering + process), not a code correctness review of their app domain examples.

---

## 2) Full Asset Inventory Relevant to Spec Generation

### 2.1 Shared Rules (core quality constraints)

- `cc-sdd/tools/cc-sdd/templates/shared/settings/rules/ears-format.md`
- `cc-sdd/tools/cc-sdd/templates/shared/settings/rules/design-principles.md`
- `cc-sdd/tools/cc-sdd/templates/shared/settings/rules/design-discovery-full.md`
- `cc-sdd/tools/cc-sdd/templates/shared/settings/rules/design-discovery-light.md`
- `cc-sdd/tools/cc-sdd/templates/shared/settings/rules/tasks-generation.md`
- `cc-sdd/tools/cc-sdd/templates/shared/settings/rules/tasks-parallel-analysis.md`
- `cc-sdd/tools/cc-sdd/templates/shared/settings/rules/gap-analysis.md`
- `cc-sdd/tools/cc-sdd/templates/shared/settings/rules/design-review.md`
- `cc-sdd/tools/cc-sdd/templates/shared/settings/rules/steering-principles.md`

### 2.2 Shared Spec Templates (artifact shape constraints)

- `cc-sdd/tools/cc-sdd/templates/shared/settings/templates/specs/init.json`
- `cc-sdd/tools/cc-sdd/templates/shared/settings/templates/specs/requirements-init.md`
- `cc-sdd/tools/cc-sdd/templates/shared/settings/templates/specs/requirements.md`
- `cc-sdd/tools/cc-sdd/templates/shared/settings/templates/specs/research.md`
- `cc-sdd/tools/cc-sdd/templates/shared/settings/templates/specs/design.md`
- `cc-sdd/tools/cc-sdd/templates/shared/settings/templates/specs/tasks.md`

### 2.3 Codex Prompt Commands (directly relevant to us)

- `cc-sdd/tools/cc-sdd/templates/agents/codex/commands/kiro-spec-init.md`
- `cc-sdd/tools/cc-sdd/templates/agents/codex/commands/kiro-spec-requirements.md`
- `cc-sdd/tools/cc-sdd/templates/agents/codex/commands/kiro-spec-design.md`
- `cc-sdd/tools/cc-sdd/templates/agents/codex/commands/kiro-spec-tasks.md`
- `cc-sdd/tools/cc-sdd/templates/agents/codex/commands/kiro-spec-impl.md`
- `cc-sdd/tools/cc-sdd/templates/agents/codex/commands/kiro-spec-status.md`
- `cc-sdd/tools/cc-sdd/templates/agents/codex/commands/kiro-validate-gap.md`
- `cc-sdd/tools/cc-sdd/templates/agents/codex/commands/kiro-validate-design.md`
- `cc-sdd/tools/cc-sdd/templates/agents/codex/commands/kiro-validate-impl.md`
- `cc-sdd/tools/cc-sdd/templates/agents/codex/docs/AGENTS.md`

### 2.4 Subagent Layer (important hidden quality amplifier)

- `cc-sdd/tools/cc-sdd/templates/agents/opencode-agent/agents/spec-requirements.md`
- `cc-sdd/tools/cc-sdd/templates/agents/opencode-agent/agents/spec-design.md`
- `cc-sdd/tools/cc-sdd/templates/agents/opencode-agent/agents/spec-tasks.md`
- `cc-sdd/tools/cc-sdd/templates/agents/opencode-agent/agents/validate-design.md`
- `cc-sdd/tools/cc-sdd/templates/agents/opencode-agent/agents/validate-gap.md`
- `cc-sdd/tools/cc-sdd/templates/agents/opencode-agent/agents/validate-impl.md`
- plus corresponding orchestrator commands in `.../commands/`.

### 2.5 Installer and Template Engine (how prompts get deployed)

- `cc-sdd/tools/cc-sdd/src/agents/registry.ts`
- `cc-sdd/tools/cc-sdd/src/manifest/loader.ts`
- `cc-sdd/tools/cc-sdd/src/manifest/processor.ts`
- `cc-sdd/tools/cc-sdd/src/manifest/planner.ts`
- `cc-sdd/tools/cc-sdd/src/plan/fileOperations.ts`
- `cc-sdd/tools/cc-sdd/src/plan/executor.ts`
- `cc-sdd/tools/cc-sdd/src/template/context.ts`
- `cc-sdd/tools/cc-sdd/src/template/renderer.ts`
- manifests in `cc-sdd/tools/cc-sdd/templates/manifests/*.json`

### 2.6 Real Example Specs

- `cc-sdd/.kiro/specs/customer-support-rag-backend-en/*`
- `cc-sdd/.kiro/specs/customer-support-rag-backend-ja/*`
- `cc-sdd/.kiro/specs/photo-albums-en/*`
- `cc-sdd/.kiro/specs/vercel-ai-chatui-research-agent-ja/*`

---

## 3) Core Quality Pattern: The “Prompt Contract” Shape

Across commands, they repeat a high-discipline instruction skeleton:

1. `background_information` block with mission + success criteria.
2. `instructions` block with explicit numbered execution steps.
3. “Read first, write last” tool order enforcement.
4. Hard constraints that pin generation behavior.
5. Output schema for command response (separate from generated artifact body).
6. Safety/fallback section defining error behavior.
7. Next-phase guidance that keeps workflow continuity.

Why this matters:

- It lowers stochastic drift.
- It forces phase separation.
- It yields predictable artifacts for human review.
- It reduces “premature coding” behaviors.

This pattern is one of the biggest reasons cc-sdd feels stable.

---

## 4) Quality Mechanisms by Phase

### 4.1 `spec-init`: constrained bootstrap

Prompt mechanics:

- Generate feature slug from natural description.
- Resolve naming collisions.
- Create only `spec.json` + initialized `requirements.md`.
- Explicit prohibition on generating later phases early.

Quality impact:

- Prevents workflow skip and premature overgeneration.
- Ensures every feature starts with same metadata contract.

Caveat:

- Output instruction says “language specified in spec.json,” but `spec.json` is created in same command. Operationally okay, but semantically circular.

### 4.2 `spec-requirements`: context-heavy, implementation-light

Prompt mechanics:

- Loads spec metadata + project description + all steering docs.
- Loads EARS rules + requirements template.
- Enforces “WHAT, not HOW.”
- Enforces numeric requirement heading normalization.

Quality impact:

- Steering context increases project fit.
- EARS syntax increases testability.
- Numeric IDs create stable downstream traceability.

Caveat:

- “Generate initial version first, then iterate” is good for momentum, but can still produce overbroad first drafts without strict scope compression.

### 4.3 `validate-gap`: brownfield intelligence before design

Prompt mechanics:

- Dedicated analysis framework (`gap-analysis.md`).
- Requires options A/B/C (extend vs new vs hybrid).
- Includes effort and risk tiering.
- Explicitly defers deep research decisions to design.

Quality impact:

- Reduces bad designs caused by shallow understanding of existing code.
- Normalizes tradeoff articulation.

Caveat:

- It is optional. Teams can skip this and lose major quality benefits in brownfield work.

### 4.4 `spec-design`: discovery + design split

Prompt mechanics:

- Classifies feature type (new/extension/simple/complex).
- Chooses full/light/minimal discovery rule path.
- Requires `research.md` update from discovery findings.
- Requires `design.md` to follow explicit template + design principles.
- Adds traceability and numeric ID integrity constraints.

Quality impact:

- Research/design split prevents design bloat.
- Discovery mode selection improves cost/quality balance.
- Explicit template shape increases consistency for reviewers.

Caveats:

- Heavy reliance on agent compliance for “full discovery.”
- If model ignores web/source quality, research can become noisy.

### 4.5 `validate-design`: bounded critique protocol

Prompt mechanics:

- Max 3 critical issues.
- Requires issue impact + recommendation + requirement traceability + evidence location.
- Forces explicit GO/NO-GO.

Quality impact:

- Prevents noisy review walls.
- Forces actionable high-severity feedback.

Caveat:

- Still qualitative; no deterministic validator backing the decision.

### 4.6 `spec-tasks`: traceability-aware execution decomposition

Prompt mechanics:

- Enforces natural-language tasks (not file/function-level micro-specs).
- Enforces 2-level hierarchy and numbering discipline.
- Requires requirements coverage mapping.
- Optional `(P)` marker for parallelizable tasks with criteria.
- Optional `- [ ]*` marker for deferrable test-only subtasks.
- Supports `--sequential` to suppress `(P)`.

Quality impact:

- Produces task plans usable by humans and agents.
- Parallel marker system is practical for team execution.
- Optional test marker helps MVP pacing while preserving test backlog visibility.

Caveat:

- Parallel safety is still inferred by model; no static conflict checker.

### 4.7 `spec-impl`: TDD framing

Prompt mechanics:

- Explicit RED/GREEN/REFACTOR/VERIFY cycle.
- Marks tasks as done in tasks.md.
- Requires no regressions.

Quality impact:

- Good implementation discipline reminder.

Caveat:

- Enforcement depends on agent behavior and available test commands.

### 4.8 `validate-impl`: intended end-to-end conformance check

Prompt mechanics:

- Can infer target from conversation history or tasks state.
- Checks task completion, tests, requirements traceability, design alignment, regressions.

Quality impact:

- Strong concept: closes the loop from spec to code.

Caveats:

- Conversation-history dependence may fail in some agents/tools.
- Traceability via Grep can be weak if evidence conventions are not standardized.

---

## 5) Rule Layer Strengths (the real secret sauce)

### 5.1 EARS rule realism

`ears-format.md` does three subtle but powerful things:

1. Defines fixed EARS trigger phrases.
2. Supports localization by freezing trigger phrases and localizing variable slots.
3. Anchors requirements in testable “shall” semantics.

Result: less ambiguous requirements, more reliable downstream mapping.

### 5.2 Design-principles rule depth

`design-principles.md` goes beyond “architecture.” It codifies:

- traceability and numeric IDs,
- section ordering standards,
- data model granularity,
- contract and interface expectations,
- anti-duplication and supporting-reference strategy,
- diagram syntax constraints.

This transforms design generation from “essay” to structured engineering artifact.

### 5.3 Discovery rules define research rigor level

- `design-discovery-full.md` for new/complex work.
- `design-discovery-light.md` for extensions.

This introduces an adaptive research budget and keeps simple changes from over-architecting.

### 5.4 Task generation rules prevent planner drift

`tasks-generation.md` + `tasks-parallel-analysis.md` provide:

- hierarchy and numbering rules,
- mapping completeness requirements,
- `(P)` semantics,
- optional test marker semantics.

Without these, task quality degrades quickly.

---

## 6) Template Layer Strengths

### 6.1 `requirements.md` template

- Forces requirement-objective-criteria pattern.
- Includes numeric heading guard comment.

### 6.2 `research.md` template

- Separates evidence log from final design contract.
- Captures options/tradeoffs/risks references.

### 6.3 `design.md` template

- Strong scaffold for architecture, flows, interfaces, data models.
- Includes optional sections for security/performance/migration.
- Includes supporting references slot to reduce main-body overload.

### 6.4 `tasks.md` template

- Explicitly encodes `(P)` and `- [ ]*` semantics.
- Keeps requirements mapping in each task unit.

---

## 7) Installer/Runtime Mechanics That Matter

### 7.1 Manifests give stable deployment to multiple agent ecosystems

- Agent-specific command directories are abstracted by manifest placeholders.
- Shared settings/rules/templates are deployed uniformly.
- Same quality model reused across platforms.

### 7.2 Template context injects language and path policy

`template/context.ts` injects:

- `LANG_CODE`
- `DEV_GUIDELINES`
- `KIRO_DIR`
- agent-specific paths

This creates consistent language policy statements in installed docs/prompts.

### 7.3 Conflict handling supports controlled upgrades

Installer supports overwrite/skip/append policies by category.
This makes template/rule upgrades less destructive in live repos.

---

## 8) Subagent Architecture: Why It Feels Better in Practice

The `*-agent` variants add a separate execution role per phase, each with:

- explicit role definitions,
- constrained file-pattern contexts,
- dedicated mode flags (`generate/merge`, `sequential`),
- focused protocol and output.

Practical effect:

- lower context contamination,
- fewer “phase bleed” errors,
- cleaner outputs for each phase.

This is one of the most transferable ideas for us.

---

## 9) Evidence from Example Specs

### 9.1 Observed strengths

From sample specs in `.kiro/specs/*`:

- strong document completeness,
- clear sectioning and architecture narratives,
- broad requirement/task coverage,
- explicit technical decisions and tradeoffs in `research.md`.

### 9.2 Observed weaknesses

Also observed in examples:

- some requirement references in tasks use top-level IDs (`_Requirements: 6_`) instead of strict `N.M` despite newer rules preferring numeric granularity consistency,
- some designs include implementation-detail drift (libraries, concrete configs) beyond “pure design intent,”
- large docs can become verbose and not all sections are equally high signal.

Conclusion: quality is high but not uniformly “rule-perfect.”

---

## 10) Hidden Inconsistencies / Edge Cases We Should Note

1. Prompt-level stop conditions are not machine-enforced by a parser.
2. `validate-impl` assumes conversation history parsing availability, which can vary.
3. Optional quality gates (`validate-gap`, `validate-design`) are easy to skip.
4. Some docs mention P-label wording while task rules now emphasize `(P)` notation.
5. Qwen manifest points command templates to gemini-cli path (`templates/agents/gemini-cli/commands`) for command artifact source, indicating intentional reuse but also potential platform-drift risk.
6. Language and formatting constraints can conflict if agent defaults differ from spec language expectations.

These are not fatal, but they are important if we want to surpass them.

---

## 11) What Actually Makes Their Spec Generation “Feel Marvelous”

Not one thing. It is an additive stack:

1. Structured prompt contracts per phase.
2. Shared reusable rulebook separate from prompts.
3. Shared artifact templates separate from prompts.
4. Steering context always loaded.
5. Discovery budgeting (full/light/minimal).
6. Research/design split.
7. Traceability constraints (numeric IDs + mapping).
8. Brownfield validation commands.
9. Task parallelization semantics.
10. Subagent isolation (in agent mode).

Most teams copy only #1 (prompt text). cc-sdd quality comes from #1 through #10 together.

---

## 12) Parity-or-Better Blueprint for Our System (Spec-Generation Focus)

### P0: Must-have to hit parity

1. Adopt phase prompt contract skeleton (mission/success criteria/steps/constraints/output/fallback/next-step).
2. Enforce numeric requirement IDs and strict cross-doc mapping validator.
3. Add `research.md` as first-class artifact with required citations/evidence fields.
4. Add explicit discovery mode classification and corresponding workflows.
5. Add deterministic lint/validate commands for requirements/design/tasks shape quality.
6. Add `(P)` and optional `- [ ]*` parsing + metadata preservation in runtime model.
7. Maintain canonical runtime state in DB (our strength) while writing markdown/spec mirror for portability.

### P1: Strong differentiators (to exceed parity)

1. Machine validation over prompt-only checks:
   - requirement ID schema linter,
   - traceability completeness checker,
   - task dependency and parallel safety checker.
2. Artifact quality scoring before phase approval:
   - completeness score,
   - ambiguity score,
   - testability score,
   - cross-file consistency score.
3. Mandatory source quality policy for discovery:
   - official docs first,
   - timestamp freshness enforcement,
   - citation confidence tagging.
4. Automatic section compaction:
   - keep core design under threshold,
   - move long appendices to supporting references automatically.

### P2: Advanced system behavior

1. Phase-specific specialist agent roles with isolated context windows.
2. Regeneration-aware merge engine for iterative requirements/design/tasks refinement.
3. Auto-generated review checklists from steering constraints.
4. Bidirectional traceability index stored structurally (not regex-only markdown parsing).

---

## 13) Concrete Lessons We Should Copy Exactly

1. Separate rules from prompts from templates.
2. Require full steering load by default.
3. Keep design and research separate artifacts.
4. Keep prompt command output short and artifact body detailed.
5. Use explicit fallback behaviors instead of silent best-effort.
6. Require next-phase instruction in every phase output.
7. Keep validation commands as first-class workflow objects.
8. Use structured phase metadata (`spec.json` or equivalent mirror) for process state.

---

## 14) Concrete Lessons We Should Improve Beyond cc-sdd

1. Do not rely on agent obedience for critical invariants; enforce in code.
2. Do not rely on conversation-history parsing for validation target detection.
3. Do not allow hidden traceability drift (e.g., mixing ID conventions) without hard failures.
4. Add automatic drift checks between requirements/design/tasks before approval transitions.
5. Add deterministic test-command discovery or project-specific test-command registry.

---

## 15) File-Level Pointers for Fast Re-Reading Later

### Highest-value files for prompt quality understanding

- `cc-sdd/tools/cc-sdd/templates/agents/codex/commands/kiro-spec-requirements.md`
- `cc-sdd/tools/cc-sdd/templates/agents/codex/commands/kiro-spec-design.md`
- `cc-sdd/tools/cc-sdd/templates/agents/codex/commands/kiro-spec-tasks.md`
- `cc-sdd/tools/cc-sdd/templates/shared/settings/rules/design-principles.md`
- `cc-sdd/tools/cc-sdd/templates/shared/settings/rules/tasks-generation.md`
- `cc-sdd/tools/cc-sdd/templates/shared/settings/templates/specs/design.md`
- `cc-sdd/tools/cc-sdd/templates/shared/settings/templates/specs/research.md`

### Highest-value files for deployment/runtime behavior

- `cc-sdd/tools/cc-sdd/src/manifest/processor.ts`
- `cc-sdd/tools/cc-sdd/src/plan/fileOperations.ts`
- `cc-sdd/tools/cc-sdd/src/template/context.ts`
- `cc-sdd/tools/cc-sdd/templates/manifests/codex.json`

### Highest-value example outputs

- `cc-sdd/.kiro/specs/customer-support-rag-backend-en/research.md`
- `cc-sdd/.kiro/specs/customer-support-rag-backend-en/design.md`
- `cc-sdd/.kiro/specs/customer-support-rag-backend-en/tasks.md`

---

## 16) Proposed Immediate Next Execution Pack (if we start implementation next)

1. Implement strict validators first:
   - Requirement ID linter.
   - Traceability completeness checker.
   - Task format checker for `(P)` and `- [ ]*`.
2. Integrate validators into phase transition guards.
3. Adopt refined phase prompt suite (already drafted in prior research docs).
4. Add research artifact generation and policy checks.
5. Add acceptance tests for representative greenfield and brownfield scenarios.

---

## 17) Bottom Line

cc-sdd’s spec quality is the result of a layered system, not just “good wording”:

- structured prompts + shared rules + shared templates + phase metadata + optional validation + steering context + subagent isolation.

To match and exceed them, we should:

- keep our runtime/state strengths,
- copy their layered workflow architecture,
- add deterministic validators where they currently rely on prose constraints.

That combination gives us parity in output quality and superiority in reliability.
