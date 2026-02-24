# Tasks: spec-generation-quality

Implement parity-plus spec generation quality and the added conversational workflow UX.

## Implementation Tasks

### T-001 - Create spec state mirror module

**Maps to requirements:** R-001

**Outcome:** `spec.json` mirror helper API exists with safe read/write semantics.

- [x] Add `packages/core/src/spec/state.ts` with `SpecStateMirror`, `readSpecState`, `writeSpecState`
- [x] Add tests for read/write and missing file behavior
- [ ] Add warning path coverage for mirror write failures

**Dependencies:**

### T-002 - Wire mirror writes into init/plan-enter flow

**Maps to requirements:** R-001, R-010

**Outcome:** mirror state initializes and updates during lifecycle bootstrap.

- [x] Update plan/init flow to write initial `spec.json` values
- [x] Ensure phase/approval fields are initialized consistently
- [ ] Add/adjust tests in plan tool test suite

**Dependencies:** T-001

### T-003 - Add strict and safe parser APIs

**Maps to requirements:** R-002, R-006

**Outcome:** parser supports strict and safe missing-file behavior with explicit contracts.

- [x] Implement `parseTasksMdStrict` and `parseTasksMdSafe`
- [x] Keep backward-compatible `parseTasksMd` aliasing safe behavior
- [x] Add parser tests for strict throw and safe empty result

**Dependencies:**

### T-004 - Parse `(P)` markers and optional test subtasks

**Maps to requirements:** R-003, R-004

**Outcome:** parsed task model includes parallel/optional-test metadata.

- [x] Extend title parser to detect and strip `(P)` suffix
- [x] Extend subtask parser to support `- [ ]` and `- [ ]*`
- [x] Populate `parallel`, `hasOptionalTestSubtasks`, and `subtasksDetailed`
- [ ]\* Add fixtures for edge formatting around marker parsing

**Dependencies:** T-003

### T-005 - Persist new parsed metadata in compiler

**Maps to requirements:** R-005

**Outcome:** compiled tasks carry new metadata fields in DB.

- [x] Extend compiler metadata type for parallel and optional-test fields
- [x] Persist `subtasksDetailed` under `metadata.spec.subtasks`
- [ ] Add compiler tests for defaults and metadata persistence

**Dependencies:** T-004

### T-006 - Restore strict plan-exit behavior for missing tasks.md

**Maps to requirements:** R-006

**Outcome:** plan-exit fails loudly when `tasks.md` is absent.

- [x] Switch plan-exit parser path to strict variant
- [x] Emit required actionable error message
- [x] Add regression test preventing silent fallback

**Dependencies:** T-003

### T-007 - Build deterministic validators module

**Maps to requirements:** R-007, R-013

**Outcome:** core validators enforce requirement IDs, traceability, task format, and dependency graph integrity.

- [x] Add `packages/core/src/spec/validators.ts` with required validator APIs
- [x] Implement requirement ID extraction/normalization helpers
- [x] Implement tasks coverage and design traceability checks
- [x] Implement dependency validation (unknown references + DAG cycle detection)
- [x] Add validator tests with stable error codes and locations

**Dependencies:** T-003, T-004

### T-008 - Add validation tools and registry wiring (P)

**Maps to requirements:** R-008, R-020

**Outcome:** `spec-validate-*` tools are registered and return stable contract payloads.

- [x] Add `spec-validate-gap`, `spec-validate-design`, `spec-validate-impl` tool implementations
- [x] Return `{ ok, phase, errors, warnings, summary, nextSteps }`
- [x] Wire tools into registry and `ToolName` union
- [x] Update phase tool visibility for plan/explore/build contexts

**Dependencies:** T-007

### T-009 - Add prompt pack modules and shared policies

**Maps to requirements:** R-009, R-020

**Outcome:** full prompt suite is centrally defined and composable.

- [x] Create `packages/core/src/prompts/spec/*` constants for shared policies and phase prompts
- [x] Export prompt modules via prompts index
- [x] Ensure prompt constants include required section markers and policy references

**Dependencies:**

### T-010 - Integrate prompt pack into planner/spec tools

**Maps to requirements:** R-009, R-010

**Outcome:** agents/tools consume centralized prompt constants.

- [x] Replace inline/generic prompt assembly in planner/spec flows
- [x] Inject shared policy blocks into phase prompts
- [x] Add integration assertions for expected prompt composition

**Dependencies:** T-009

### T-011 - Implement spec phase tools and lifecycle transitions

**Maps to requirements:** R-010, R-011, R-012, R-014, R-015

**Outcome:** lifecycle tools generate/update artifacts with gating and status outputs.

- [x] Implement/extend `spec-init`, `spec-requirements`, `spec-design`, `spec-tasks`, `spec-status`, `spec-quick`
- [x] Add discovery mode classification and persisted mode output
- [x] Ensure `research.md` is generated/updated in lifecycle
- [x] Update mirror phase and approvals map during transitions
- [x] Provide blockers and exact next action in status output

**Dependencies:** T-001, T-007, T-010

### T-012 - Implement requirement ID normalization and enforcement (P)

**Maps to requirements:** R-013

**Outcome:** non-numeric requirement ID headings are normalized or rejected with mapping report.

- [ ] Add `normalizeRequirementHeadings` utility
- [ ] Emit mapping report for converted IDs
- [ ] Enforce phase failure when unresolved invalid IDs remain

**Dependencies:** T-007

### T-013 - Enrich spec injector with phase and approval context

**Maps to requirements:** R-016

**Outcome:** injected spec context is phase-aware and actionable.

- [ ] Read mirror state in injector
- [ ] Include approvals summary and current phase in injected context
- [ ] Include validation highlights relevant to next action

**Dependencies:** T-001, T-011

### T-014 - Add prompt integrity and snapshot tests (P)

**Maps to requirements:** R-017

**Outcome:** prompt regressions are caught deterministically.

- [ ] Add tests for required sections/constraints in each prompt
- [ ] Add snapshot coverage for prompt constants
- [ ]\* Add targeted snapshot fixtures for large prompt fragments

**Dependencies:** T-009

### T-015 - Add end-to-end parity flow test

**Maps to requirements:** R-018

**Outcome:** integration test proves full lifecycle works under parity path.

- [ ] Execute init -> requirements -> design -> tasks -> validation in test flow
- [ ] Assert artifacts and phase transitions
- [ ] Assert no unexpected validation failures

**Dependencies:** T-011, T-013, T-014

### T-016 - Add deterministic guard tests (P)

**Maps to requirements:** R-019

**Outcome:** invalid states/transitions are blocked with explicit error signals.

- [ ] Add failing-case tests for ID format violations
- [ ] Add failing-case tests for traceability gaps
- [ ] Add failing-case tests for unknown dependencies and DAG cycles
- [ ]\* Add edge-case tests for malformed marker usage

**Dependencies:** T-007, T-011

### T-017 - Wire public exports and package entrypoints

**Maps to requirements:** R-020

**Outcome:** new prompts/tools/validators/state helpers are importable from core entrypoints.

- [ ] Update prompts index exports
- [ ] Update tools index exports
- [ ] Update core package exports for validators/state utilities

**Dependencies:** T-008, T-009, T-011

### T-018 - Add ActionButtonPart component and part schema

**Maps to requirements:** R-022

**Outcome:** timeline can render actionable button groups.

- [ ] Add `action_buttons` part type schema
- [ ] Implement ActionButtonPart rendering and variants
- [ ] Implement loading-state handling and duplicate-click prevention

**Dependencies:**

### T-019 - Add workflow state persistence for wizard

**Maps to requirements:** R-023

**Outcome:** wizard state is persisted and resumable per session.

- [ ] Add workflow state model/storage API
- [ ] Add DB-first write path with explicit mirror sync behavior
- [ ] Add state query/recovery helpers by session ID

**Dependencies:** T-001

### T-020 - Add intent detection with configurable policy (P)

**Maps to requirements:** R-024

**Outcome:** feature-request intent can proactively trigger wizard offers.

- [ ] Implement intent classifier with confidence result
- [ ] Add configurable thresholds/patterns and enable toggle
- [ ] Add feedback capture for false-positive/false-negative events

**Dependencies:**

### T-021 - Implement spec wizard controller and phase buttons

**Maps to requirements:** R-021, R-022, R-023, R-024

**Outcome:** users can run guided spec lifecycle from chat actions.

- [ ] Implement wizard controller state machine for init/requirements/design/tasks/complete
- [ ] Map canonical action IDs to operations (`wizard:start:comprehensive`, `wizard:start:quick`, `wizard:requirements:revise`, `wizard:requirements:approve`, `wizard:design:revise`, `wizard:design:approve`, `wizard:tasks:approve`, `wizard:start-implementation`, `spec-status`)
- [ ] Render exact phase-specific labels: `Add More Requirements`, `Approve Requirements and Continue`, `Request Changes`, `Approve Design and Continue`, `Approve Tasks`, `Start Implementation`, `Edit Spec`
- [ ] Generate session title before presenting primary wizard options

**Dependencies:** T-018, T-019, T-020, T-011

### T-022 - Wire Plan->Build transition from wizard completion

**Maps to requirements:** R-021

**Outcome:** `Start Implementation` (`wizard:start-implementation`) transitions workflow mode safely.

- [ ] Add mode-switch integration for `wizard:start-implementation`
- [ ] Add guards for invalid transition conditions
- [ ] Add user-visible status confirmation after transition

**Dependencies:** T-021

### T-023 - Add UX integration tests for wizard flow (P)

**Maps to requirements:** R-021, R-022, R-023, R-024

**Outcome:** conversational workflow is validated end-to-end.

- [ ] Add integration tests for intent -> canonical buttons -> action ID execution
- [ ] Add integration tests for workflow resume by session
- [ ] Add integration tests for `wizard:requirements:approve` and `wizard:design:approve` transitions
- [ ] Add integration tests for `wizard:start-implementation` Plan->Build transition
- [ ]\* Add exploratory test for low-confidence intent suppression

**Dependencies:** T-022

### T-024 - Implement structured clarification loop lifecycle

**Maps to requirements:** R-021, R-022, R-025

**Outcome:** option-based questioning works end-to-end (tool -> events -> UX -> reply/reject) and can be repeated safely.

- [ ] Add core question lifecycle manager with pending/request/reply/reject behavior
- [ ] Add `question` tool schema and execution behavior with structured prompts/options
- [ ] Register `question` tool in agent/phase tool maps used by spec-generation flows
- [ ] Add server question routes and bus events for asked/replied/rejected lifecycle
- [ ] Wire desktop API + timeline handlers for option selection, free-form input, and skip/reject
- [ ] Ensure repeated `question` calls are exempt from doom-loop detection heuristics

**Dependencies:** T-018, T-021

### T-025 - Add clarification-loop validation and integration tests (P)

**Maps to requirements:** R-023, R-025

**Outcome:** iterative question loops are regression-tested and phase-gating behavior is deterministic.

- [ ] Add unit tests for question lifecycle manager (pending, reply, reject, unknown-id safety)
- [ ] Add tool tests asserting question metadata and reply propagation
- [ ] Add agent/session tests proving repeated question loops are not flagged as doom loops
- [ ] Add server contract/route tests for question event payloads and API behavior
- [ ] Add desktop tests for question endpoint client calls and timeline interaction path
- [ ] Add integration tests ensuring required clarifications block phase transitions until answered/rejected

**Dependencies:** T-024, T-023

### T-026 - Final documentation and parity validation report

**Maps to requirements:** R-015, R-018, R-019, R-020, R-021, R-025

**Outcome:** implementation status and parity claims are documented and auditable.

- [ ] Update spec workflow docs with new tooling and UX flow
- [ ] Add parity and parity-plus validation report
- [ ] Record verification commands/results for CI and local runs

**Dependencies:** T-015, T-016, T-017, T-023, T-025
