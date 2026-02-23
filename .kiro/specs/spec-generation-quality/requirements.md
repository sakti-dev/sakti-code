# Requirements Document: Spec Generation Quality & Workflow UX

## Introduction

This specification combines two required tracks:

1. Parity-plus core improvements for spec generation quality (parser/compiler/state/validators/prompts/tools/tests).
2. Conversational workflow UX improvements (interactive buttons, wizard flow, intent detection, workflow state).

The canonical runtime state remains database-backed. `.kiro/specs/<slug>/spec.json` is a mirror for portability and visibility.

## Requirements

### Requirement 1 (R-001): Spec State Mirror Module

**Objective:** As a developer, I want a `spec.json` mirror so spec state is portable and inspectable.

#### Acceptance Criteria

1. When a new spec is initialized, the system shall create `.kiro/specs/<slug>/spec.json` with `feature_name`, `created_at`, `updated_at`, `language`, `phase`, `approvals`, and `ready_for_implementation`.
2. The system shall provide `readSpecState(specDir)` returning `null` when `spec.json` is missing.
3. The system shall provide `writeSpecState(specDir, state)` with safe JSON read/parse/write behavior.
4. When mirror write fails after DB write succeeds, the system shall warn and continue without corrupting DB state.

### Requirement 2 (R-002): Strict and Safe Parser APIs

**Objective:** As a developer, I want strict and safe parser APIs with explicit error behavior.

#### Acceptance Criteria

1. `parseTasksMdStrict(path)` shall throw on missing `tasks.md` with explicit message.
2. `parseTasksMdSafe(path)` shall return `[]` when file is missing.
3. `parseTasksMd(path)` shall remain backward-compatible and alias the safe behavior.
4. For valid `tasks.md`, strict and safe variants shall produce equivalent parsed data.

### Requirement 3 (R-003): Parallel Task Marker Parsing

**Objective:** As a developer, I want `(P)` task markers parsed into metadata.

#### Acceptance Criteria

1. If task title ends with `(P)`, parser shall emit `parallel: true`.
2. Parser shall normalize title by removing `(P)` suffix from stored title text.
3. If task title does not end with `(P)`, parser shall emit `parallel: false`.

### Requirement 4 (R-004): Optional Test Subtask Detection

**Objective:** As a developer, I want `- [ ]*` optional test subtasks represented explicitly.

#### Acceptance Criteria

1. Subtasks matching `- [ ]* <text>` shall be parsed with `optionalTest: true`.
2. Subtasks matching `- [ ] <text>` shall be parsed with `optionalTest: false`.
3. Parent task shall include `hasOptionalTestSubtasks: true` when any optional-test subtask exists.
4. Parsed result shall include `subtasksDetailed: Array<{ text: string; optionalTest: boolean }>`.

### Requirement 5 (R-005): Compiler Metadata Persistence

**Objective:** As a developer, I want parser metadata persisted in task metadata for runtime use.

#### Acceptance Criteria

1. Compiler shall persist `metadata.spec.parallel`.
2. Compiler shall persist `metadata.spec.hasOptionalTestSubtasks`.
3. Compiler shall persist `metadata.spec.subtasks` from `subtasksDetailed`.
4. Defaults shall be deterministic: booleans default `false`; arrays default `[]`.

### Requirement 6 (R-006): Strict Plan Exit Behavior

**Objective:** As a developer, I want plan exit to fail deterministically when `tasks.md` is missing.

#### Acceptance Criteria

1. `plan-exit` shall fail when `tasks.md` is missing with message containing `tasks.md not found`.
2. Failure message shall include `Create it before exiting plan mode.`
3. `plan-exit` shall use strict parser path.
4. There shall be no silent fallback to empty task lists in this path.

### Requirement 7 (R-007): Deterministic Validators Module

**Objective:** As a developer, I want machine-checkable validators enforcing hard runtime invariants.

#### Acceptance Criteria

1. System shall provide `validateRequirementIds(requirementsMd)`.
2. System shall provide `validateTasksCoverage(requirementsMd, tasksMd)`.
3. System shall provide `validateDesignTraceability(requirementsMd, designMd)`.
4. System shall provide `validateTaskFormat(tasksMd)` for `(P)` and `- [ ]*` semantics.
5. System shall provide dependency integrity checks for unknown task references and non-DAG dependency graphs.
6. Validation outputs shall include stable codes (including `REQ_ID_FORMAT_INVALID`, `REQ_UNCOVERED_BY_TASKS`, `DESIGN_TRACEABILITY_GAP`, task-format codes, and dependency-graph codes), message, and optional location.

### Requirement 8 (R-008): Validation Tools and Registry Wiring

**Objective:** As a developer, I want validation tools exposed in the registry with stable response contracts.

#### Acceptance Criteria

1. Registry shall include `spec-validate-gap`, `spec-validate-design`, and `spec-validate-impl`.
2. Each validation tool shall return `{ ok, phase, errors, warnings, summary, nextSteps }`.
3. Tool names shall be added to `ToolName` union and exported tool sets.
4. Plan/explore read-only contexts may expose validator/status tools, while build context exposes full mutating spec toolset.

### Requirement 9 (R-009): Prompt Pack Module

**Objective:** As a developer, I want complete, composable prompt constants for every spec phase.

#### Acceptance Criteria

1. Shared policy constants shall be exported: `SPEC_CORE_POLICY`, `SPEC_CONTEXT_LOADING`, `SPEC_FORMAT_RULES`, `SPEC_TRACEABILITY_RULES`, `SPEC_SAFETY_AND_FALLBACK`.
2. Phase constants shall include generators/validators/orchestrators for requirements, gap, design, design-validation, tasks, impl, impl-validation, status, and quick flows.
3. Prompt assembly shall be centralized in `packages/core/src/prompts/spec/*`.
4. Prompt constants shall preserve required structural sections and be snapshot-tested.

### Requirement 10 (R-010): Spec Generation Tools

**Objective:** As a developer, I want phase tools for spec lifecycle management.

#### Acceptance Criteria

1. System shall provide `spec-init`, `spec-requirements`, `spec-design`, `spec-tasks`, `spec-status`, and `spec-quick`.
2. Tools shall read/write under `.kiro/specs/<slug>/`.
3. Tools shall update mirror state on phase transitions.
4. Tools shall enforce approvals and validation gates before transitions.

### Requirement 11 (R-011): Research Artifact Lifecycle Support

**Objective:** As a developer, I want `research.md` as a first-class artifact.

#### Acceptance Criteria

1. `spec-init` shall create `research.md` template.
2. Design generation flow shall read/update `research.md` before finalizing `design.md`.
3. Research references shall be summarized in design output and status reporting.

### Requirement 12 (R-012): Discovery Mode Classification

**Objective:** As a developer, I want design discovery mode classification to scale effort.

#### Acceptance Criteria

1. System shall provide `classifyDiscoveryMode(...) -> "full" | "light" | "minimal"`.
2. Classification inputs shall include requirement complexity and context signals.
3. Selected mode shall be persisted and exposed by status tooling.

### Requirement 13 (R-013): Requirement ID Normalization and Enforcement

**Objective:** As a developer, I want deterministic requirement ID normalization/enforcement.

#### Acceptance Criteria

1. System shall provide normalization utility for alphabetic headings (`Requirement A`) to numeric sequence.
2. Normalization shall emit an explicit mapping report.
3. Phase transitions shall fail when non-numeric requirement IDs remain unresolved.

### Requirement 14 (R-014): Quick Orchestrator Tool

**Objective:** As a developer, I want a fast path tool for simple specs.

#### Acceptance Criteria

1. `spec-quick` shall support auto and checkpointed interactive behavior.
2. Auto mode shall execute init -> requirements -> design -> tasks sequence.
3. Interactive mode shall return checkpoint status between phases.
4. Tool shall surface warnings when validations are deferred/skipped.

### Requirement 15 (R-015): Status Report Enhancements

**Objective:** As a developer, I want status output that is operationally actionable.

#### Acceptance Criteria

1. Status shall include phase completion and artifact presence.
2. Status shall include task breakdown (checked vs unchecked).
3. Status shall include blockers and exact next command/action.
4. Status shall include discovery mode and validation summary.

### Requirement 16 (R-016): Spec Injector Phase Context

**Objective:** As a developer, I want injected context to include phase/approval visibility.

#### Acceptance Criteria

1. Injector shall read mirror state and include current phase.
2. Injector shall include approval status summary.
3. Injector shall include traceability/validation highlights relevant to current task.

### Requirement 17 (R-017): Prompt Integrity Tests

**Objective:** As a developer, I want prompt integrity tests preventing accidental prompt degradation.

#### Acceptance Criteria

1. Tests shall verify required prompt sections are present.
2. Tests shall verify critical constraints are present (numeric requirement IDs, `(P)`, `- [ ]*`, safety policy).
3. Snapshot tests shall detect truncation or structural regression in prompt constants.

### Requirement 18 (R-018): End-to-End Parity Flow Test

**Objective:** As a developer, I want an integration test proving full parity flow.

#### Acceptance Criteria

1. Integration test shall execute init -> requirements -> design -> tasks -> validations.
2. Test shall assert expected artifacts are created.
3. Test shall assert phase transitions and status progression.

### Requirement 19 (R-019): Deterministic Guard Tests

**Objective:** As a developer, I want tests that prove invalid states are blocked.

#### Acceptance Criteria

1. Tests shall fail phase transitions when traceability gaps remain.
2. Tests shall fail invalid requirement IDs.
3. Tests shall fail unknown dependency references.
4. Tests shall fail non-DAG dependencies.

### Requirement 20 (R-020): Public API and Registry Exports

**Objective:** As a developer, I want new APIs exported for stable consumption.

#### Acceptance Criteria

1. Prompt constants shall be exported via prompts index.
2. Spec/validation tools shall be exported via tools index/registry.
3. Validator/state helpers shall be exported from core package entrypoints.

### Requirement 21 (R-021): Conversational Spec Workflow Wizard

**Objective:** As a user, I want guided spec creation via conversational prompts and interactive buttons.

#### Acceptance Criteria

1. In Plan mode, feature-request intent shall trigger wizard suggestion UI.
2. Initial options shall include:
   - `Comprehensive Spec` (`wizard:start:comprehensive`)
   - `Quick Spec` (`wizard:start:quick`)
3. Session title generation shall occur before presenting wizard options.
4. Requirements-phase buttons shall be:
   - `Add More Requirements` (`wizard:requirements:revise`)
   - `Approve Requirements and Continue` (`wizard:requirements:approve`)
5. Design-phase buttons shall be:
   - `Request Changes` (`wizard:design:revise`)
   - `Approve Design and Continue` (`wizard:design:approve`)
6. Tasks/Completion-phase buttons shall include:
   - `Approve Tasks` (`wizard:tasks:approve`)
   - `Start Implementation` (`wizard:start-implementation`)
   - `Edit Spec` (`spec-status`) as the non-mutating fallback action
7. `Start Implementation` shall switch user workflow from Plan mode to Build mode only when readiness gates pass.
8. Current spec phase status shall be visible in chat UX.

### Requirement 22 (R-022): Action Button Chat Part

**Objective:** As a developer, I want a timeline-rendered action button part.

#### Acceptance Criteria

1. UI shall support an `action_buttons` part with grouped buttons.
2. Each button shall include id, label, variant, and canonical action ID (`action`), with optional metadata.
3. Clicks shall emit action messages to agent pipeline.
4. Part shall support loading states and prevent duplicate submits.
5. Click handling shall enforce action-token validation (session, user, phase, action, expiry) before invoking mutating operations.

### Requirement 23 (R-023): Workflow State Management

**Objective:** As a developer, I want persistent per-session wizard workflow state.

#### Acceptance Criteria

1. Workflow state shall persist phase/spec type/responses/completion metadata by session.
2. State shall survive session reload/resume.
3. DB state remains canonical; mirror sync/recovery paths shall be explicit.
4. API shall support querying state by session ID.

### Requirement 24 (R-024): Intent Detection for Spec Requests

**Objective:** As a system, I want configurable feature-request intent detection.

#### Acceptance Criteria

1. System shall analyze Plan-mode user input for feature-request patterns.
2. Detection configuration shall be tunable (enabled flag/threshold/patterns).
3. Wizard shall not be offered on clear non-feature intents (question/exploration/bug report).
4. System shall support feedback capture for false positives/negatives.

## Non-Goals

1. Replacing canonical DB state with markdown-only state.
2. Prompt-only enforcement of critical invariants.
3. Removing slash-command flows in favor of wizard-only UX.
4. Introducing a new agent type solely for this feature.

## Risks and Mitigations

### Risk 1: Prompt payload bloat

Mitigation: compose prompts from shared policies + phase constants, and test required sections.

### Risk 2: DB/mirror divergence

Mitigation: DB-first writes, mirror-second writes, warning-only on mirror failure.

### Risk 3: Validator fragility

Mitigation: modular extraction + fixtures from real generated specs + guard tests.

### Risk 4: UX complexity in chat timeline

Mitigation: implement as incremental part type extension using existing registry conventions.

### Risk 5: Scope creep across parity and UX tracks

Mitigation: enforce task sequencing and requirement traceability matrix in design/tasks artifacts.
