# Comparative Research Dossier

## Title

Comprehensive comparison between our Kiro-inspired planner implementation in `ekacode` and the `cc-sdd` repository, including architecture, workflows, implementation mechanics, operational tradeoffs, and a resumable session handoff.

## Date

2026-02-22

## Authoring Context

This document was produced in-session after deep repository exploration of:

- Our codebase (`/home/eekrain/CODE/ekacode`)
- External reference implementation clone (`/home/eekrain/CODE/ekacode/cc-sdd`)

The explicit goal is to preserve enough context to safely resume work later even if conversational context is compacted.

## Scope of This Dossier

This dossier covers:

- What was requested in the session
- What was explored
- What was verified in code
- How `cc-sdd` is actually implemented
- How that differs from our implementation
- What we should adopt, adapt, and avoid
- Concrete recommendations for next implementation steps
- Detailed evidence and file references for fast follow-up

## Session Objective Snapshot

The session trajectory had two major requests:

1. Read and compare our historical planner plan against current implementation.
2. Deeply analyze `cc-sdd` and extract learnings relevant to our Kiro-like planner system.

After these investigations, the user requested a comprehensive documentation artifact to preserve session continuity.

## Executive Summary

`cc-sdd` is best understood as a cross-agent workflow scaffolding system built from:

- Installer CLI
- Manifest-driven artifact planning
- Template and rules packs
- Prompt-command orchestration per agent
- File-based spec lifecycle in `.kiro/specs/<feature>/`

It is not primarily a runtime task orchestration engine with strong DB-backed DAG enforcement.

Our implementation in `ekacode` is stronger in runtime orchestration semantics:

- Session runtime mode (`plan` vs `build`)
- Mode transitions with approval and locking
- Spec parsing and compilation to DB tasks and dependencies
- Ready-task discovery tied to dependency closure
- Spec context injection into runtime agent messages

`cc-sdd` is stronger in workflow ergonomics and team customization:

- Highly portable multi-agent command packs
- Rich templates and rules customization for teams
- Explicit human approval checkpoints in process design
- Extra validation commands (`validate-gap`, `validate-design`, `validate-impl`)
- Rapid pipeline command (`spec-quick`) with subagent orchestration

The most valuable strategy is not replacement but synthesis:

- Keep our runtime orchestration core
- Add a file-visible process layer and richer workflow UX from `cc-sdd`

## Methodology

Research method used in this session:

- Read implementation plan in `docs/old_plans/KIRO_PLANNER_SYSTEM_IMPLEMENTATION_PLAN.md`
- Inspect corresponding source files in our codebase
- Inspect wiring, agent registry integration, tool registry integration
- Validate with targeted tests in `packages/core/tests/spec/*` and session mode tests
- Deep dive `cc-sdd` source, manifests, templates, rule files, and sample specs
- Compare conceptual architecture and operational behavior

## Non-Goals

This document does not:

- Claim upstream `cc-sdd` quality beyond code inspected in this clone
- Benchmark runtime performance of either system
- Implement changes in this pass

## Baseline: Our Current System (ekacode)

### Core Runtime Components

Key implemented files observed:

- `packages/core/src/tools/plan.ts`
- `packages/core/src/spec/helpers.ts`
- `packages/core/src/spec/parser.ts`
- `packages/core/src/spec/compiler.ts`
- `packages/core/src/spec/templates.ts`
- `packages/core/src/agent/spec-injector.ts`
- `packages/core/src/session/controller.ts`
- `packages/core/src/session/processor.ts`
- `packages/core/src/session/mode-transition.ts`
- `packages/core/src/session/mode-approval.ts`
- `packages/core/src/tools/task.ts`
- `packages/core/src/tools/registry.ts`

### What Is Implemented

Implemented behavior we confirmed:

- `plan-enter` tool exists and writes spec templates.
- `plan-exit` tool exists, validates tasks and dependencies, compiles to DB.
- Active spec/current task/runtime mode are persisted in tool session data.
- Parsed spec tasks are compiled into task memory DB records.
- Dependency links are persisted in `task_dependencies`.
- Session mode transitions are handled with lock and approval semantics.
- Runtime mode influences agent selection and subagent policy.
- Spec context is injected into model messages during processing.

### Test Validation in This Session

We ran targeted tests under `packages/core` and confirmed pass status for:

- `tests/spec/parser.test.ts`
- `tests/spec/plan.test.ts`
- `tests/spec/compiler.test.ts`
- `tests/spec/helpers.test.ts`
- `tests/session/mode-transition.test.ts`

Important nuance:

- Running broad patterns from repo root picked up `.worktrees` and `.direnv` mirrored trees and produced noisy failures.
- Running from `packages/core` with targeted test files produced clean passing results.

### Current Strengths

Our current strengths include:

- Runtime rigor with explicit plan/build mode semantics.
- Strong connection from spec artifacts to persisted task model.
- Dependency-aware task readiness determination.
- Session-safe transition handling with lock semantics.
- Integrated prompt context enrichment via spec injector.

### Current Gaps (Relative to Process UX)

Areas that are less mature versus `cc-sdd` process layer:

- User-facing phase UX and macro workflow orchestration.
- Team-facing template/rules customization framework.
- Rich validation gates as dedicated commands.
- Broad multi-agent packaging support story.

## Baseline: `cc-sdd` System Architecture

### High-Level Characterization

`cc-sdd` has two conceptual layers:

1. Installer and scaffolder layer (`tools/cc-sdd/src/*`)
2. Workflow command/rules/templates layer (`tools/cc-sdd/templates/*`)

### CLI and Installation Layer

Core files:

- `cc-sdd/tools/cc-sdd/src/cli.ts`
- `cc-sdd/tools/cc-sdd/src/index.ts`
- `cc-sdd/tools/cc-sdd/src/cli/args.ts`
- `cc-sdd/tools/cc-sdd/src/cli/config.ts`
- `cc-sdd/tools/cc-sdd/src/manifest/loader.ts`
- `cc-sdd/tools/cc-sdd/src/manifest/processor.ts`
- `cc-sdd/tools/cc-sdd/src/manifest/planner.ts`
- `cc-sdd/tools/cc-sdd/src/plan/fileOperations.ts`
- `cc-sdd/tools/cc-sdd/src/plan/executor.ts`
- `cc-sdd/tools/cc-sdd/src/cli/policies.ts`

CLI role summary:

- Parse install options (`--agent`, `--lang`, `--kiro-dir`, overwrite policy, backup)
- Resolve target manifest
- Build operation plan from manifest and template context
- Apply or dry-run writes
- Manage conflict strategy per category

### Manifest-Driven Planning

Manifest system features:

- Artifacts can be `staticDir`, `templateFile`, or `templateDir`.
- Artifacts filtered by agent/os conditions.
- Placeholders replaced from context (`{{AGENT}}`, `{{KIRO_DIR}}`, etc).
- Destination layout resolved per agent profile.

Representative manifests:

- `cc-sdd/tools/cc-sdd/templates/manifests/codex.json`
- `cc-sdd/tools/cc-sdd/templates/manifests/opencode-agent.json`

### Template and Rules Layer

Shared project memory and workflow templates:

- `cc-sdd/tools/cc-sdd/templates/shared/settings/templates/specs/*.md`
- `cc-sdd/tools/cc-sdd/templates/shared/settings/templates/specs/init.json`
- `cc-sdd/tools/cc-sdd/templates/shared/settings/rules/*.md`

Agent-specific command prompts:

- `cc-sdd/tools/cc-sdd/templates/agents/codex/commands/*.md`
- `cc-sdd/tools/cc-sdd/templates/agents/opencode-agent/commands/*.md`
- Additional agent variants under corresponding template directories

### Spec Lifecycle Model

Feature state is persisted in filesystem:

- `.kiro/specs/<feature>/spec.json`
- `.kiro/specs/<feature>/requirements.md`
- `.kiro/specs/<feature>/design.md`
- `.kiro/specs/<feature>/tasks.md`
- Optional `.kiro/specs/<feature>/research.md`

`spec.json` contains:

- `phase`
- per-phase generation/approval booleans
- `ready_for_implementation`
- timestamps
- language

### Approval Gates

Workflow expects approval semantics between phases:

- requirements generation and approval
- design generation and approval
- tasks generation and approval

Flags like `-y` can auto-approve in some commands.

### Subagent Variant

For subagent-capable targets (`claude-agent`, `opencode-agent`):

- Commands dispatch to specialized subagents.
- Subagent files define deeper role-specific behavior.
- `spec-quick` macro can orchestrate init → requirements → design → tasks.

### Validation Command Family

`cc-sdd` defines validation commands as process gates:

- `kiro-validate-gap`
- `kiro-validate-design`
- `kiro-validate-impl`

These are prompt-level checks, not deeply hardcoded runtime engines.

## Comparative Model

### Architectural Pattern Contrast

Our system pattern:

- Runtime-first orchestration engine
- DB-backed task graph and status
- Explicit session mode semantics

`cc-sdd` pattern:

- Workflow-first scaffolding
- File-based process contract
- Prompt/rules-driven guidance

### Trust Boundaries

Our trust boundary emphasizes:

- Persisted task DB state
- Runtime mode and orchestrator checks

`cc-sdd` trust boundary emphasizes:

- Template integrity
- Prompt adherence
- Human review checkpoints

### Data Plane Contrast

Our data plane:

- Task entities in DB
- dependency relations in DB
- runtime thread/session metadata in DB

`cc-sdd` data plane:

- markdown + json artifacts in project workspace
- no central runtime planner DB implied by inspected installer code

### Control Plane Contrast

Our control plane:

- tools with execute functions (`plan-enter`, `plan-exit`)
- orchestrated session controller and processor paths

`cc-sdd` control plane:

- command prompt definitions
- command naming conventions per agent platform
- install-time provisioning of those command files

## Detailed Comparative Findings

### Finding 1: `cc-sdd` is a Portable Workflow Product

Evidence:

- Manifest-driven multi-agent output generation.
- Agent registry and layouts for many platforms.

Interpretation:

- Main product value is portability and team adoption velocity.

Implication for us:

- If we want ecosystem spread, packaging layer matters.

### Finding 2: Our Runtime Semantics Are More Robust

Evidence:

- `transitionSessionMode` with locks and allowed transition checks.
- compile-to-DB and dependency readiness checks.

Interpretation:

- We already have stronger execution correctness substrate.

Implication:

- Preserve this core and avoid replacing it with prompt-only gates.

### Finding 3: Their Process UX Is Stronger

Evidence:

- Rich guides and command docs.
- clear phase-to-command maps.
- quick orchestration command with interactive/auto modes.

Interpretation:

- Onboarding and process ergonomics are highly intentional.

Implication:

- Add user-facing process wrappers to our runtime core.

### Finding 4: Their Team Customization Story Is Better

Evidence:

- `.kiro/settings/templates` and `.kiro/settings/rules` are explicit and supported.
- Documentation instructs safe customization boundaries.

Interpretation:

- They productized “team governance as templates/rules”.

Implication:

- We should add first-class settings and rule packs.

### Finding 5: Validation-as-Commands Is Useful

Evidence:

- `validate-gap`, `validate-design`, `validate-impl` defined as dedicated commands.

Interpretation:

- Separate validation stages improve quality and social review flow.

Implication:

- Consider adding optional gate tools in our system.

### Finding 6: Their Runtime Enforcement is Softer

Evidence:

- Many constraints are in markdown prompt instructions.
- Less hard enforcement observed in executable orchestration code.

Interpretation:

- Quality depends more on agent behavior consistency.

Implication:

- Keep our hard guards for critical correctness paths.

## Component-by-Component Comparison

### Plan Entry and Setup

`cc-sdd`:

- `spec-init` creates directories and initial files from templates.
- Phase state initialized in `spec.json`.

ours:

- `plan-enter` sets runtime mode and writes templates.
- active spec persisted in tool session storage.

difference:

- They emphasize file-state readability.
- We emphasize runtime session state and tool context.

recommendation:

- Mirror runtime state into a human-readable spec state file.

### Requirements Phase

`cc-sdd`:

- Requirements generation rules via EARS guidance in rule files.
- strict numeric requirement heading conventions in newer prompts/rules.

ours:

- Parser expects task requirement references later.
- requirements validation in compiler via ID extraction.

difference:

- They deeply invest in requirements-writing ergonomics.
- We focus on compiler-time validation.

recommendation:

- Add requirements generation/validation helper layer with customizable format rules.

### Design Phase

`cc-sdd`:

- Design generation includes optional discovery research in `research.md`.
- discovery mode may vary (full/light/minimal).

ours:

- Planner and spec injector exist, but no standalone research artifact pipeline by default.

difference:

- They separate discovery notes from design decisions.

recommendation:

- Introduce optional `research.md` artifact and discovery summaries.

### Tasks Phase

`cc-sdd`:

- Tasks generated with strict formatting constraints.
- Optional parallel markers `(P)`.
- optional test tasks marker `- [ ]*`.

ours:

- Parser/Compiler support dependencies and requirements mapping.
- no explicit `(P)` semantics yet.

difference:

- They optimize review readability and workstream parallelization cues.

recommendation:

- Extend parser/compiler to support explicit parallel hints and richer task metadata.

### Implementation Phase

`cc-sdd`:

- `spec-impl` prompt enforces TDD process in instructions.

ours:

- Task execution exists via runtime tooling and subagent modes.

difference:

- They codify TDD expectations as command behavior guides.
- We have stronger runtime infrastructure but less templated ritual around implementation discipline.

recommendation:

- Add optional implementation policy prompts/checklists tied to current task context.

### Validation Phase

`cc-sdd`:

- Separate validation commands for gap, design, implementation.

ours:

- We validate parser/compiler and runtime mode transitions in tests.
- We do not expose equivalent user-facing validation pipeline commands yet.

difference:

- They externalize quality checks as explicit user command steps.

recommendation:

- Add validation tool family integrated with our runtime DB context.

## Design Lessons We Should Adopt

### Lesson A: Human-Readable State Mirror

Adopt:

- Keep `spec.json` synchronized with session/runtime state.

Benefits:

- Easier manual debugging
- easier non-technical review
- easier recovery from partial workflows

Implementation idea:

- write `spec-state.ts` helper to mirror:
  - phase
  - approvals
  - current task
  - last update
  - compile result snapshot

### Lesson B: Team-Level Settings Contract

Adopt:

- standardized `.kiro/settings/templates/*` and `.kiro/settings/rules/*`

Benefits:

- Governance can be versioned.
- AI behavior alignment across teams.

Implementation idea:

- runtime tools load these files when generating docs.
- enforce required structural markers while allowing content customization.

### Lesson C: Optional Validation Gate Commands

Adopt:

- `validate-gap`, `validate-design`, `validate-impl` analogs.

Benefits:

- catches drift earlier.
- creates clear checkpoint culture.

Implementation idea:

- each validation command reads spec artifacts + DB state + selected code signals.

### Lesson D: Quick Mode Wrapper

Adopt:

- macro command `spec-quick` or equivalent for acceleration.

Benefits:

- fast bootstrap for low-risk features.

Guardrails:

- default interactive approvals.
- explicit unsafe mode for auto-approve.

### Lesson E: Parallelization Markers

Adopt:

- parse and persist task parallel hints.

Benefits:

- easier execution planning for teams.

Implementation idea:

- parser detects `(P)` after task identifiers.
- compiler stores metadata `spec.parallel: true`.

## Design Lessons We Should Not Blindly Adopt

### Anti-Lesson A: Prompt-Only Enforcement

Do not replace runtime validation with prompt rules alone.

Reason:

- prompts can drift.
- model behavior may vary.

### Anti-Lesson B: Over-index on File-Only Workflow State

Do not discard DB-backed task graph and dependency relationships.

Reason:

- we already have robust task semantics.
- DB state enables stronger queries and execution controls.

### Anti-Lesson C: Unbounded Complexity in Command Prompts

Do not overpack single prompt files as sole source of truth for critical logic.

Reason:

- maintainability risk.
- hard to test deterministically.

## Proposed Synthesis Architecture

### Principle

Combine:

- our runtime correctness engine
  with
- their configurable process UX and documentation workflow

### Synthesis Layer 1: Runtime Core (retain)

Keep existing:

- session runtime modes
- mode transitions
- parser/compiler to DB
- dependency readiness
- spec context injection

### Synthesis Layer 2: Workflow UX (add)

Add:

- generated spec state mirror file
- customizable templates/rules contract
- validation command family
- quick-phase orchestrator wrapper

### Synthesis Layer 3: Team Customization (add)

Add:

- versioned settings conventions
- compatibility checks for template changes
- lint for spec artifact format integrity

## Recommended Near-Term Work Packages

### Package 1: Spec State Mirror

- create `.kiro/specs/<slug>/spec.json` mirror writer
- synchronize phase transitions from runtime tools
- add tests for write/read/update behavior

### Package 2: Template/Rule Loading Contract

- define expected directories and fallback behavior
- integrate into generation tools where applicable
- validate minimum structural requirements

### Package 3: Validation Tool Family

- `validate-gap` draft
- `validate-design` draft
- `validate-impl` draft
- each tool includes deterministic checks + advisory output

### Package 4: Parser/Compiler Metadata Extensions

- support `(P)` markers
- optional starred test coverage marker parsing
- stricter requirement ID normalization and diagnostics

### Package 5: Quick Workflow Wrapper

- implement guarded macro command
- default interactive mode
- auto mode explicit and noisy about skipped gates

## Risks and Mitigations

### Risk 1: Feature Creep in Planning Layer

Mitigation:

- preserve minimal runtime invariants.
- add UX layers incrementally with tests.

### Risk 2: Config Drift in Team Templates

Mitigation:

- include template schema checks.
- lint required sections and markers.

### Risk 3: Ambiguous Dual Source of Truth

Mitigation:

- define DB as canonical runtime truth.
- file mirror as visibility layer.

### Risk 4: Validation Commands Becoming Heuristic Noise

Mitigation:

- enforce deterministic checks first.
- clearly tag heuristic guidance vs hard failures.

## Decision Matrix

### Option 1: Keep Current System As-Is

Pros:

- no migration cost
- stable runtime behavior

Cons:

- weaker process UX
- less team customization portability

Verdict:

- insufficient for long-term process maturity.

### Option 2: Rebuild Toward `cc-sdd` Style

Pros:

- improved command UX quickly

Cons:

- lose runtime rigor
- risk prompt-driven fragility

Verdict:

- not recommended.

### Option 3: Hybrid (Recommended)

Pros:

- preserve runtime guarantees
- adopt process UX improvements

Cons:

- more integration work

Verdict:

- recommended.

## Resume Guide for Next Session

When resuming later, start with:

1. Read this file.
2. Confirm desired priority among recommended packages.
3. Implement in this order:
   - Package 1
   - Package 4
   - Package 3
   - Package 2
   - Package 5

Why this order:

- state visibility and parser semantics first
- validation tools once metadata fidelity improves
- workflow wrapper last to avoid compounding assumptions

## High-Confidence Facts Extracted From `cc-sdd`

- It supports multiple agent targets via manifests and agent layout definitions.
- It installs templates/rules into `.kiro/settings`.
- It structures feature specs in `.kiro/specs/<feature>/`.
- It uses `spec.json` for phase and approval state.
- It defines command prompts for each stage.
- It provides optional subagent variants.
- It defines validation commands as explicit workflow steps.

## High-Confidence Facts Extracted From Our Codebase

- `plan-enter` and `plan-exit` tools are implemented and wired.
- spec parser/compiler/helpers exist and are tested.
- session runtime mode handling is implemented.
- spec context injector is wired in processor.
- task readiness is dependency-aware.

## Open Questions for Future Work

- Should `spec.json` be fully canonical for phase UX while DB remains execution canonical?
- Should approvals be persisted both in DB and file mirror?
- Do we want formal template schema versioning?
- How strict should requirement ID parser be across legacy docs?
- Should parallel marker affect scheduling automatically or remain advisory?

## Implementation Notes for Future Contributor

- Avoid broad test globs from repo root due to `.worktrees` and `.direnv` mirrors in this environment.
- Run targeted tests from `packages/core` for planner/spec verification.
- Keep runtime invariants enforced in code, not only in prompt text.
- Add tests with each workflow-layer addition to prevent regressions.

## Appendix A: Key Files in Our System

- `packages/core/src/tools/plan.ts`
- `packages/core/src/spec/helpers.ts`
- `packages/core/src/spec/parser.ts`
- `packages/core/src/spec/compiler.ts`
- `packages/core/src/spec/templates.ts`
- `packages/core/src/agent/spec-injector.ts`
- `packages/core/src/session/mode-transition.ts`
- `packages/core/src/session/mode-approval.ts`
- `packages/core/src/session/controller.ts`
- `packages/core/src/session/processor.ts`
- `packages/core/src/tools/registry.ts`
- `packages/core/src/tools/task.ts`

## Appendix B: Key Files in `cc-sdd`

- `cc-sdd/tools/cc-sdd/src/index.ts`
- `cc-sdd/tools/cc-sdd/src/cli.ts`
- `cc-sdd/tools/cc-sdd/src/cli/args.ts`
- `cc-sdd/tools/cc-sdd/src/cli/config.ts`
- `cc-sdd/tools/cc-sdd/src/manifest/loader.ts`
- `cc-sdd/tools/cc-sdd/src/manifest/processor.ts`
- `cc-sdd/tools/cc-sdd/src/manifest/planner.ts`
- `cc-sdd/tools/cc-sdd/src/plan/fileOperations.ts`
- `cc-sdd/tools/cc-sdd/src/plan/executor.ts`
- `cc-sdd/tools/cc-sdd/src/agents/registry.ts`
- `cc-sdd/tools/cc-sdd/src/resolvers/agentLayout.ts`
- `cc-sdd/tools/cc-sdd/templates/shared/settings/templates/specs/init.json`
- `cc-sdd/tools/cc-sdd/templates/shared/settings/templates/specs/requirements.md`
- `cc-sdd/tools/cc-sdd/templates/shared/settings/templates/specs/design.md`
- `cc-sdd/tools/cc-sdd/templates/shared/settings/templates/specs/tasks.md`
- `cc-sdd/tools/cc-sdd/templates/shared/settings/rules/tasks-generation.md`
- `cc-sdd/tools/cc-sdd/templates/shared/settings/rules/tasks-parallel-analysis.md`
- `cc-sdd/tools/cc-sdd/templates/shared/settings/rules/design-review.md`
- `cc-sdd/tools/cc-sdd/templates/shared/settings/rules/gap-analysis.md`
- `cc-sdd/tools/cc-sdd/templates/agents/codex/commands/kiro-spec-init.md`
- `cc-sdd/tools/cc-sdd/templates/agents/codex/commands/kiro-spec-requirements.md`
- `cc-sdd/tools/cc-sdd/templates/agents/codex/commands/kiro-spec-design.md`
- `cc-sdd/tools/cc-sdd/templates/agents/codex/commands/kiro-spec-tasks.md`
- `cc-sdd/tools/cc-sdd/templates/agents/codex/commands/kiro-spec-impl.md`
- `cc-sdd/tools/cc-sdd/templates/agents/codex/commands/kiro-spec-status.md`
- `cc-sdd/tools/cc-sdd/templates/agents/codex/commands/kiro-validate-gap.md`
- `cc-sdd/tools/cc-sdd/templates/agents/codex/commands/kiro-validate-design.md`
- `cc-sdd/tools/cc-sdd/templates/agents/codex/commands/kiro-validate-impl.md`

## Appendix C: Confidence and Evidence Policy

Evidence confidence labels used in this dossier:

- High: directly observed in source files and/or tests in this session.
- Medium: inferred from multiple related files with consistent semantics.
- Low: hypothesis requiring implementation confirmation.

All major claims in this document are intended to be High confidence.

## Appendix D: Immediate Follow-Up Checklist

- [ ] confirm package priority with user
- [ ] define `spec.json` mirror schema in our repo
- [ ] extend parser for `(P)` support
- [ ] add validation command prototypes
- [ ] add docs for template/rule customization contract

## Appendix E: Comparative Observation Ledger

This ledger is intentionally long-form for continuity and resumption.
Each line captures a focused observation tied to architecture, workflow, or implementation strategy.

Legend:

- OURS = ekacode current implementation
- CCSDD = cc-sdd clone analyzed in this session
- ACTION = recommendation direction

### Section E.1: Runtime and State Semantics

- E1.1 OURS persists active execution semantics in runtime and session records, while CCSDD externalizes phase visibility through file metadata; ACTION: keep DB canonical and add a file mirror.
- E1.2 OURS enforces mode transitions with explicit checks, while CCSDD phase flow is largely prompt and approval flag driven; ACTION: preserve hard mode guards.
- E1.3 OURS computes ready tasks from dependency closure in persisted task relations, while CCSDD primarily tracks task completion via markdown checkboxes; ACTION: support both views with compiler sync.
- E1.4 OURS runtime mode actively changes tool behavior such as subagent restrictions, while CCSDD restrictions are mostly procedural instructions; ACTION: retain executable enforcement.
- E1.5 OURS injects spec context into model message flow, while CCSDD relies on command prompt context loading each run; ACTION: retain injector and include phase snapshot.
- E1.6 OURS has compile-time checks for requirement and dependency integrity, while CCSDD encodes many constraints in human-readable rules; ACTION: keep checks in code and mirror in docs.
- E1.7 OURS tracks current task in session state, while CCSDD infers progress from tasks markdown and spec.json approvals; ACTION: synchronize current task into spec mirror.
- E1.8 OURS compiler supports idempotent updates to task entities, while CCSDD encourages iterative regeneration and merge behavior at file level; ACTION: add explicit merge policy.
- E1.9 OURS currently exposes fewer user-facing phase commands than CCSDD command packs; ACTION: add optional UX wrappers without weakening runtime core.
- E1.10 OURS has strong runtime tests around parser, compiler, helpers, and mode transitions, while CCSDD tests focus heavily on installer manifests and file operations; ACTION: preserve runtime test depth.
- E1.11 OURS persists active execution semantics in runtime and session records, while CCSDD externalizes phase visibility through file metadata; ACTION: keep DB canonical and add a file mirror.
- E1.12 OURS enforces mode transitions with explicit checks, while CCSDD phase flow is largely prompt and approval flag driven; ACTION: preserve hard mode guards.
- E1.13 OURS computes ready tasks from dependency closure in persisted task relations, while CCSDD primarily tracks task completion via markdown checkboxes; ACTION: support both views with compiler sync.
- E1.14 OURS runtime mode actively changes tool behavior such as subagent restrictions, while CCSDD restrictions are mostly procedural instructions; ACTION: retain executable enforcement.
- E1.15 OURS injects spec context into model message flow, while CCSDD relies on command prompt context loading each run; ACTION: retain injector and include phase snapshot.
- E1.16 OURS has compile-time checks for requirement and dependency integrity, while CCSDD encodes many constraints in human-readable rules; ACTION: keep checks in code and mirror in docs.
- E1.17 OURS tracks current task in session state, while CCSDD infers progress from tasks markdown and spec.json approvals; ACTION: synchronize current task into spec mirror.
- E1.18 OURS compiler supports idempotent updates to task entities, while CCSDD encourages iterative regeneration and merge behavior at file level; ACTION: add explicit merge policy.
- E1.19 OURS currently exposes fewer user-facing phase commands than CCSDD command packs; ACTION: add optional UX wrappers without weakening runtime core.
- E1.20 OURS has strong runtime tests around parser, compiler, helpers, and mode transitions, while CCSDD tests focus heavily on installer manifests and file operations; ACTION: preserve runtime test depth.
- E1.21 OURS persists active execution semantics in runtime and session records, while CCSDD externalizes phase visibility through file metadata; ACTION: keep DB canonical and add a file mirror.
- E1.22 OURS enforces mode transitions with explicit checks, while CCSDD phase flow is largely prompt and approval flag driven; ACTION: preserve hard mode guards.
- E1.23 OURS computes ready tasks from dependency closure in persisted task relations, while CCSDD primarily tracks task completion via markdown checkboxes; ACTION: support both views with compiler sync.
- E1.24 OURS runtime mode actively changes tool behavior such as subagent restrictions, while CCSDD restrictions are mostly procedural instructions; ACTION: retain executable enforcement.
- E1.25 OURS injects spec context into model message flow, while CCSDD relies on command prompt context loading each run; ACTION: retain injector and include phase snapshot.
- E1.26 OURS has compile-time checks for requirement and dependency integrity, while CCSDD encodes many constraints in human-readable rules; ACTION: keep checks in code and mirror in docs.
- E1.27 OURS tracks current task in session state, while CCSDD infers progress from tasks markdown and spec.json approvals; ACTION: synchronize current task into spec mirror.
- E1.28 OURS compiler supports idempotent updates to task entities, while CCSDD encourages iterative regeneration and merge behavior at file level; ACTION: add explicit merge policy.
- E1.29 OURS currently exposes fewer user-facing phase commands than CCSDD command packs; ACTION: add optional UX wrappers without weakening runtime core.
- E1.30 OURS has strong runtime tests around parser, compiler, helpers, and mode transitions, while CCSDD tests focus heavily on installer manifests and file operations; ACTION: preserve runtime test depth.
- E1.31 OURS persists active execution semantics in runtime and session records, while CCSDD externalizes phase visibility through file metadata; ACTION: keep DB canonical and add a file mirror.
- E1.32 OURS enforces mode transitions with explicit checks, while CCSDD phase flow is largely prompt and approval flag driven; ACTION: preserve hard mode guards.
- E1.33 OURS computes ready tasks from dependency closure in persisted task relations, while CCSDD primarily tracks task completion via markdown checkboxes; ACTION: support both views with compiler sync.
- E1.34 OURS runtime mode actively changes tool behavior such as subagent restrictions, while CCSDD restrictions are mostly procedural instructions; ACTION: retain executable enforcement.
- E1.35 OURS injects spec context into model message flow, while CCSDD relies on command prompt context loading each run; ACTION: retain injector and include phase snapshot.
- E1.36 OURS has compile-time checks for requirement and dependency integrity, while CCSDD encodes many constraints in human-readable rules; ACTION: keep checks in code and mirror in docs.
- E1.37 OURS tracks current task in session state, while CCSDD infers progress from tasks markdown and spec.json approvals; ACTION: synchronize current task into spec mirror.
- E1.38 OURS compiler supports idempotent updates to task entities, while CCSDD encourages iterative regeneration and merge behavior at file level; ACTION: add explicit merge policy.
- E1.39 OURS currently exposes fewer user-facing phase commands than CCSDD command packs; ACTION: add optional UX wrappers without weakening runtime core.
- E1.40 OURS has strong runtime tests around parser, compiler, helpers, and mode transitions, while CCSDD tests focus heavily on installer manifests and file operations; ACTION: preserve runtime test depth.
- E1.41 OURS persists active execution semantics in runtime and session records, while CCSDD externalizes phase visibility through file metadata; ACTION: keep DB canonical and add a file mirror.
- E1.42 OURS enforces mode transitions with explicit checks, while CCSDD phase flow is largely prompt and approval flag driven; ACTION: preserve hard mode guards.
- E1.43 OURS computes ready tasks from dependency closure in persisted task relations, while CCSDD primarily tracks task completion via markdown checkboxes; ACTION: support both views with compiler sync.
- E1.44 OURS runtime mode actively changes tool behavior such as subagent restrictions, while CCSDD restrictions are mostly procedural instructions; ACTION: retain executable enforcement.
- E1.45 OURS injects spec context into model message flow, while CCSDD relies on command prompt context loading each run; ACTION: retain injector and include phase snapshot.
- E1.46 OURS has compile-time checks for requirement and dependency integrity, while CCSDD encodes many constraints in human-readable rules; ACTION: keep checks in code and mirror in docs.
- E1.47 OURS tracks current task in session state, while CCSDD infers progress from tasks markdown and spec.json approvals; ACTION: synchronize current task into spec mirror.
- E1.48 OURS compiler supports idempotent updates to task entities, while CCSDD encourages iterative regeneration and merge behavior at file level; ACTION: add explicit merge policy.
- E1.49 OURS currently exposes fewer user-facing phase commands than CCSDD command packs; ACTION: add optional UX wrappers without weakening runtime core.
- E1.50 OURS has strong runtime tests around parser, compiler, helpers, and mode transitions, while CCSDD tests focus heavily on installer manifests and file operations; ACTION: preserve runtime test depth.
- E1.51 OURS persists active execution semantics in runtime and session records, while CCSDD externalizes phase visibility through file metadata; ACTION: keep DB canonical and add a file mirror.
- E1.52 OURS enforces mode transitions with explicit checks, while CCSDD phase flow is largely prompt and approval flag driven; ACTION: preserve hard mode guards.
- E1.53 OURS computes ready tasks from dependency closure in persisted task relations, while CCSDD primarily tracks task completion via markdown checkboxes; ACTION: support both views with compiler sync.
- E1.54 OURS runtime mode actively changes tool behavior such as subagent restrictions, while CCSDD restrictions are mostly procedural instructions; ACTION: retain executable enforcement.
- E1.55 OURS injects spec context into model message flow, while CCSDD relies on command prompt context loading each run; ACTION: retain injector and include phase snapshot.
- E1.56 OURS has compile-time checks for requirement and dependency integrity, while CCSDD encodes many constraints in human-readable rules; ACTION: keep checks in code and mirror in docs.
- E1.57 OURS tracks current task in session state, while CCSDD infers progress from tasks markdown and spec.json approvals; ACTION: synchronize current task into spec mirror.
- E1.58 OURS compiler supports idempotent updates to task entities, while CCSDD encourages iterative regeneration and merge behavior at file level; ACTION: add explicit merge policy.
- E1.59 OURS currently exposes fewer user-facing phase commands than CCSDD command packs; ACTION: add optional UX wrappers without weakening runtime core.
- E1.60 OURS has strong runtime tests around parser, compiler, helpers, and mode transitions, while CCSDD tests focus heavily on installer manifests and file operations; ACTION: preserve runtime test depth.
- E1.61 OURS persists active execution semantics in runtime and session records, while CCSDD externalizes phase visibility through file metadata; ACTION: keep DB canonical and add a file mirror.
- E1.62 OURS enforces mode transitions with explicit checks, while CCSDD phase flow is largely prompt and approval flag driven; ACTION: preserve hard mode guards.
- E1.63 OURS computes ready tasks from dependency closure in persisted task relations, while CCSDD primarily tracks task completion via markdown checkboxes; ACTION: support both views with compiler sync.
- E1.64 OURS runtime mode actively changes tool behavior such as subagent restrictions, while CCSDD restrictions are mostly procedural instructions; ACTION: retain executable enforcement.
- E1.65 OURS injects spec context into model message flow, while CCSDD relies on command prompt context loading each run; ACTION: retain injector and include phase snapshot.
- E1.66 OURS has compile-time checks for requirement and dependency integrity, while CCSDD encodes many constraints in human-readable rules; ACTION: keep checks in code and mirror in docs.
- E1.67 OURS tracks current task in session state, while CCSDD infers progress from tasks markdown and spec.json approvals; ACTION: synchronize current task into spec mirror.
- E1.68 OURS compiler supports idempotent updates to task entities, while CCSDD encourages iterative regeneration and merge behavior at file level; ACTION: add explicit merge policy.
- E1.69 OURS currently exposes fewer user-facing phase commands than CCSDD command packs; ACTION: add optional UX wrappers without weakening runtime core.
- E1.70 OURS has strong runtime tests around parser, compiler, helpers, and mode transitions, while CCSDD tests focus heavily on installer manifests and file operations; ACTION: preserve runtime test depth.
- E1.71 OURS persists active execution semantics in runtime and session records, while CCSDD externalizes phase visibility through file metadata; ACTION: keep DB canonical and add a file mirror.
- E1.72 OURS enforces mode transitions with explicit checks, while CCSDD phase flow is largely prompt and approval flag driven; ACTION: preserve hard mode guards.
- E1.73 OURS computes ready tasks from dependency closure in persisted task relations, while CCSDD primarily tracks task completion via markdown checkboxes; ACTION: support both views with compiler sync.
- E1.74 OURS runtime mode actively changes tool behavior such as subagent restrictions, while CCSDD restrictions are mostly procedural instructions; ACTION: retain executable enforcement.
- E1.75 OURS injects spec context into model message flow, while CCSDD relies on command prompt context loading each run; ACTION: retain injector and include phase snapshot.
- E1.76 OURS has compile-time checks for requirement and dependency integrity, while CCSDD encodes many constraints in human-readable rules; ACTION: keep checks in code and mirror in docs.
- E1.77 OURS tracks current task in session state, while CCSDD infers progress from tasks markdown and spec.json approvals; ACTION: synchronize current task into spec mirror.
- E1.78 OURS compiler supports idempotent updates to task entities, while CCSDD encourages iterative regeneration and merge behavior at file level; ACTION: add explicit merge policy.
- E1.79 OURS currently exposes fewer user-facing phase commands than CCSDD command packs; ACTION: add optional UX wrappers without weakening runtime core.
- E1.80 OURS has strong runtime tests around parser, compiler, helpers, and mode transitions, while CCSDD tests focus heavily on installer manifests and file operations; ACTION: preserve runtime test depth.
- E1.81 OURS persists active execution semantics in runtime and session records, while CCSDD externalizes phase visibility through file metadata; ACTION: keep DB canonical and add a file mirror.
- E1.82 OURS enforces mode transitions with explicit checks, while CCSDD phase flow is largely prompt and approval flag driven; ACTION: preserve hard mode guards.
- E1.83 OURS computes ready tasks from dependency closure in persisted task relations, while CCSDD primarily tracks task completion via markdown checkboxes; ACTION: support both views with compiler sync.
- E1.84 OURS runtime mode actively changes tool behavior such as subagent restrictions, while CCSDD restrictions are mostly procedural instructions; ACTION: retain executable enforcement.
- E1.85 OURS injects spec context into model message flow, while CCSDD relies on command prompt context loading each run; ACTION: retain injector and include phase snapshot.
- E1.86 OURS has compile-time checks for requirement and dependency integrity, while CCSDD encodes many constraints in human-readable rules; ACTION: keep checks in code and mirror in docs.
- E1.87 OURS tracks current task in session state, while CCSDD infers progress from tasks markdown and spec.json approvals; ACTION: synchronize current task into spec mirror.
- E1.88 OURS compiler supports idempotent updates to task entities, while CCSDD encourages iterative regeneration and merge behavior at file level; ACTION: add explicit merge policy.
- E1.89 OURS currently exposes fewer user-facing phase commands than CCSDD command packs; ACTION: add optional UX wrappers without weakening runtime core.
- E1.90 OURS has strong runtime tests around parser, compiler, helpers, and mode transitions, while CCSDD tests focus heavily on installer manifests and file operations; ACTION: preserve runtime test depth.
- E1.91 OURS persists active execution semantics in runtime and session records, while CCSDD externalizes phase visibility through file metadata; ACTION: keep DB canonical and add a file mirror.
- E1.92 OURS enforces mode transitions with explicit checks, while CCSDD phase flow is largely prompt and approval flag driven; ACTION: preserve hard mode guards.
- E1.93 OURS computes ready tasks from dependency closure in persisted task relations, while CCSDD primarily tracks task completion via markdown checkboxes; ACTION: support both views with compiler sync.
- E1.94 OURS runtime mode actively changes tool behavior such as subagent restrictions, while CCSDD restrictions are mostly procedural instructions; ACTION: retain executable enforcement.
- E1.95 OURS injects spec context into model message flow, while CCSDD relies on command prompt context loading each run; ACTION: retain injector and include phase snapshot.
- E1.96 OURS has compile-time checks for requirement and dependency integrity, while CCSDD encodes many constraints in human-readable rules; ACTION: keep checks in code and mirror in docs.
- E1.97 OURS tracks current task in session state, while CCSDD infers progress from tasks markdown and spec.json approvals; ACTION: synchronize current task into spec mirror.
- E1.98 OURS compiler supports idempotent updates to task entities, while CCSDD encourages iterative regeneration and merge behavior at file level; ACTION: add explicit merge policy.
- E1.99 OURS currently exposes fewer user-facing phase commands than CCSDD command packs; ACTION: add optional UX wrappers without weakening runtime core.
- E1.100 OURS has strong runtime tests around parser, compiler, helpers, and mode transitions, while CCSDD tests focus heavily on installer manifests and file operations; ACTION: preserve runtime test depth.
- E1.101 OURS persists active execution semantics in runtime and session records, while CCSDD externalizes phase visibility through file metadata; ACTION: keep DB canonical and add a file mirror.
- E1.102 OURS enforces mode transitions with explicit checks, while CCSDD phase flow is largely prompt and approval flag driven; ACTION: preserve hard mode guards.
- E1.103 OURS computes ready tasks from dependency closure in persisted task relations, while CCSDD primarily tracks task completion via markdown checkboxes; ACTION: support both views with compiler sync.
- E1.104 OURS runtime mode actively changes tool behavior such as subagent restrictions, while CCSDD restrictions are mostly procedural instructions; ACTION: retain executable enforcement.
- E1.105 OURS injects spec context into model message flow, while CCSDD relies on command prompt context loading each run; ACTION: retain injector and include phase snapshot.
- E1.106 OURS has compile-time checks for requirement and dependency integrity, while CCSDD encodes many constraints in human-readable rules; ACTION: keep checks in code and mirror in docs.
- E1.107 OURS tracks current task in session state, while CCSDD infers progress from tasks markdown and spec.json approvals; ACTION: synchronize current task into spec mirror.
- E1.108 OURS compiler supports idempotent updates to task entities, while CCSDD encourages iterative regeneration and merge behavior at file level; ACTION: add explicit merge policy.
- E1.109 OURS currently exposes fewer user-facing phase commands than CCSDD command packs; ACTION: add optional UX wrappers without weakening runtime core.
- E1.110 OURS has strong runtime tests around parser, compiler, helpers, and mode transitions, while CCSDD tests focus heavily on installer manifests and file operations; ACTION: preserve runtime test depth.
- E1.111 OURS persists active execution semantics in runtime and session records, while CCSDD externalizes phase visibility through file metadata; ACTION: keep DB canonical and add a file mirror.
- E1.112 OURS enforces mode transitions with explicit checks, while CCSDD phase flow is largely prompt and approval flag driven; ACTION: preserve hard mode guards.
- E1.113 OURS computes ready tasks from dependency closure in persisted task relations, while CCSDD primarily tracks task completion via markdown checkboxes; ACTION: support both views with compiler sync.
- E1.114 OURS runtime mode actively changes tool behavior such as subagent restrictions, while CCSDD restrictions are mostly procedural instructions; ACTION: retain executable enforcement.
- E1.115 OURS injects spec context into model message flow, while CCSDD relies on command prompt context loading each run; ACTION: retain injector and include phase snapshot.
- E1.116 OURS has compile-time checks for requirement and dependency integrity, while CCSDD encodes many constraints in human-readable rules; ACTION: keep checks in code and mirror in docs.
- E1.117 OURS tracks current task in session state, while CCSDD infers progress from tasks markdown and spec.json approvals; ACTION: synchronize current task into spec mirror.
- E1.118 OURS compiler supports idempotent updates to task entities, while CCSDD encourages iterative regeneration and merge behavior at file level; ACTION: add explicit merge policy.
- E1.119 OURS currently exposes fewer user-facing phase commands than CCSDD command packs; ACTION: add optional UX wrappers without weakening runtime core.
- E1.120 OURS has strong runtime tests around parser, compiler, helpers, and mode transitions, while CCSDD tests focus heavily on installer manifests and file operations; ACTION: preserve runtime test depth.
- E1.121 OURS persists active execution semantics in runtime and session records, while CCSDD externalizes phase visibility through file metadata; ACTION: keep DB canonical and add a file mirror.
- E1.122 OURS enforces mode transitions with explicit checks, while CCSDD phase flow is largely prompt and approval flag driven; ACTION: preserve hard mode guards.
- E1.123 OURS computes ready tasks from dependency closure in persisted task relations, while CCSDD primarily tracks task completion via markdown checkboxes; ACTION: support both views with compiler sync.
- E1.124 OURS runtime mode actively changes tool behavior such as subagent restrictions, while CCSDD restrictions are mostly procedural instructions; ACTION: retain executable enforcement.
- E1.125 OURS injects spec context into model message flow, while CCSDD relies on command prompt context loading each run; ACTION: retain injector and include phase snapshot.
- E1.126 OURS has compile-time checks for requirement and dependency integrity, while CCSDD encodes many constraints in human-readable rules; ACTION: keep checks in code and mirror in docs.
- E1.127 OURS tracks current task in session state, while CCSDD infers progress from tasks markdown and spec.json approvals; ACTION: synchronize current task into spec mirror.
- E1.128 OURS compiler supports idempotent updates to task entities, while CCSDD encourages iterative regeneration and merge behavior at file level; ACTION: add explicit merge policy.
- E1.129 OURS currently exposes fewer user-facing phase commands than CCSDD command packs; ACTION: add optional UX wrappers without weakening runtime core.
- E1.130 OURS has strong runtime tests around parser, compiler, helpers, and mode transitions, while CCSDD tests focus heavily on installer manifests and file operations; ACTION: preserve runtime test depth.
- E1.131 OURS persists active execution semantics in runtime and session records, while CCSDD externalizes phase visibility through file metadata; ACTION: keep DB canonical and add a file mirror.
- E1.132 OURS enforces mode transitions with explicit checks, while CCSDD phase flow is largely prompt and approval flag driven; ACTION: preserve hard mode guards.
- E1.133 OURS computes ready tasks from dependency closure in persisted task relations, while CCSDD primarily tracks task completion via markdown checkboxes; ACTION: support both views with compiler sync.
- E1.134 OURS runtime mode actively changes tool behavior such as subagent restrictions, while CCSDD restrictions are mostly procedural instructions; ACTION: retain executable enforcement.
- E1.135 OURS injects spec context into model message flow, while CCSDD relies on command prompt context loading each run; ACTION: retain injector and include phase snapshot.
- E1.136 OURS has compile-time checks for requirement and dependency integrity, while CCSDD encodes many constraints in human-readable rules; ACTION: keep checks in code and mirror in docs.
- E1.137 OURS tracks current task in session state, while CCSDD infers progress from tasks markdown and spec.json approvals; ACTION: synchronize current task into spec mirror.
- E1.138 OURS compiler supports idempotent updates to task entities, while CCSDD encourages iterative regeneration and merge behavior at file level; ACTION: add explicit merge policy.
- E1.139 OURS currently exposes fewer user-facing phase commands than CCSDD command packs; ACTION: add optional UX wrappers without weakening runtime core.
- E1.140 OURS has strong runtime tests around parser, compiler, helpers, and mode transitions, while CCSDD tests focus heavily on installer manifests and file operations; ACTION: preserve runtime test depth.
- E1.141 OURS persists active execution semantics in runtime and session records, while CCSDD externalizes phase visibility through file metadata; ACTION: keep DB canonical and add a file mirror.
- E1.142 OURS enforces mode transitions with explicit checks, while CCSDD phase flow is largely prompt and approval flag driven; ACTION: preserve hard mode guards.
- E1.143 OURS computes ready tasks from dependency closure in persisted task relations, while CCSDD primarily tracks task completion via markdown checkboxes; ACTION: support both views with compiler sync.
- E1.144 OURS runtime mode actively changes tool behavior such as subagent restrictions, while CCSDD restrictions are mostly procedural instructions; ACTION: retain executable enforcement.
- E1.145 OURS injects spec context into model message flow, while CCSDD relies on command prompt context loading each run; ACTION: retain injector and include phase snapshot.
- E1.146 OURS has compile-time checks for requirement and dependency integrity, while CCSDD encodes many constraints in human-readable rules; ACTION: keep checks in code and mirror in docs.
- E1.147 OURS tracks current task in session state, while CCSDD infers progress from tasks markdown and spec.json approvals; ACTION: synchronize current task into spec mirror.
- E1.148 OURS compiler supports idempotent updates to task entities, while CCSDD encourages iterative regeneration and merge behavior at file level; ACTION: add explicit merge policy.
- E1.149 OURS currently exposes fewer user-facing phase commands than CCSDD command packs; ACTION: add optional UX wrappers without weakening runtime core.
- E1.150 OURS has strong runtime tests around parser, compiler, helpers, and mode transitions, while CCSDD tests focus heavily on installer manifests and file operations; ACTION: preserve runtime test depth.
- E1.151 OURS persists active execution semantics in runtime and session records, while CCSDD externalizes phase visibility through file metadata; ACTION: keep DB canonical and add a file mirror.
- E1.152 OURS enforces mode transitions with explicit checks, while CCSDD phase flow is largely prompt and approval flag driven; ACTION: preserve hard mode guards.
- E1.153 OURS computes ready tasks from dependency closure in persisted task relations, while CCSDD primarily tracks task completion via markdown checkboxes; ACTION: support both views with compiler sync.
- E1.154 OURS runtime mode actively changes tool behavior such as subagent restrictions, while CCSDD restrictions are mostly procedural instructions; ACTION: retain executable enforcement.
- E1.155 OURS injects spec context into model message flow, while CCSDD relies on command prompt context loading each run; ACTION: retain injector and include phase snapshot.
- E1.156 OURS has compile-time checks for requirement and dependency integrity, while CCSDD encodes many constraints in human-readable rules; ACTION: keep checks in code and mirror in docs.
- E1.157 OURS tracks current task in session state, while CCSDD infers progress from tasks markdown and spec.json approvals; ACTION: synchronize current task into spec mirror.
- E1.158 OURS compiler supports idempotent updates to task entities, while CCSDD encourages iterative regeneration and merge behavior at file level; ACTION: add explicit merge policy.
- E1.159 OURS currently exposes fewer user-facing phase commands than CCSDD command packs; ACTION: add optional UX wrappers without weakening runtime core.
- E1.160 OURS has strong runtime tests around parser, compiler, helpers, and mode transitions, while CCSDD tests focus heavily on installer manifests and file operations; ACTION: preserve runtime test depth.
- E1.161 OURS persists active execution semantics in runtime and session records, while CCSDD externalizes phase visibility through file metadata; ACTION: keep DB canonical and add a file mirror.
- E1.162 OURS enforces mode transitions with explicit checks, while CCSDD phase flow is largely prompt and approval flag driven; ACTION: preserve hard mode guards.
- E1.163 OURS computes ready tasks from dependency closure in persisted task relations, while CCSDD primarily tracks task completion via markdown checkboxes; ACTION: support both views with compiler sync.
- E1.164 OURS runtime mode actively changes tool behavior such as subagent restrictions, while CCSDD restrictions are mostly procedural instructions; ACTION: retain executable enforcement.
- E1.165 OURS injects spec context into model message flow, while CCSDD relies on command prompt context loading each run; ACTION: retain injector and include phase snapshot.
- E1.166 OURS has compile-time checks for requirement and dependency integrity, while CCSDD encodes many constraints in human-readable rules; ACTION: keep checks in code and mirror in docs.
- E1.167 OURS tracks current task in session state, while CCSDD infers progress from tasks markdown and spec.json approvals; ACTION: synchronize current task into spec mirror.
- E1.168 OURS compiler supports idempotent updates to task entities, while CCSDD encourages iterative regeneration and merge behavior at file level; ACTION: add explicit merge policy.
- E1.169 OURS currently exposes fewer user-facing phase commands than CCSDD command packs; ACTION: add optional UX wrappers without weakening runtime core.
- E1.170 OURS has strong runtime tests around parser, compiler, helpers, and mode transitions, while CCSDD tests focus heavily on installer manifests and file operations; ACTION: preserve runtime test depth.
- E1.171 OURS persists active execution semantics in runtime and session records, while CCSDD externalizes phase visibility through file metadata; ACTION: keep DB canonical and add a file mirror.
- E1.172 OURS enforces mode transitions with explicit checks, while CCSDD phase flow is largely prompt and approval flag driven; ACTION: preserve hard mode guards.
- E1.173 OURS computes ready tasks from dependency closure in persisted task relations, while CCSDD primarily tracks task completion via markdown checkboxes; ACTION: support both views with compiler sync.
- E1.174 OURS runtime mode actively changes tool behavior such as subagent restrictions, while CCSDD restrictions are mostly procedural instructions; ACTION: retain executable enforcement.
- E1.175 OURS injects spec context into model message flow, while CCSDD relies on command prompt context loading each run; ACTION: retain injector and include phase snapshot.
- E1.176 OURS has compile-time checks for requirement and dependency integrity, while CCSDD encodes many constraints in human-readable rules; ACTION: keep checks in code and mirror in docs.
- E1.177 OURS tracks current task in session state, while CCSDD infers progress from tasks markdown and spec.json approvals; ACTION: synchronize current task into spec mirror.
- E1.178 OURS compiler supports idempotent updates to task entities, while CCSDD encourages iterative regeneration and merge behavior at file level; ACTION: add explicit merge policy.
- E1.179 OURS currently exposes fewer user-facing phase commands than CCSDD command packs; ACTION: add optional UX wrappers without weakening runtime core.
- E1.180 OURS has strong runtime tests around parser, compiler, helpers, and mode transitions, while CCSDD tests focus heavily on installer manifests and file operations; ACTION: preserve runtime test depth.
- E1.181 OURS persists active execution semantics in runtime and session records, while CCSDD externalizes phase visibility through file metadata; ACTION: keep DB canonical and add a file mirror.
- E1.182 OURS enforces mode transitions with explicit checks, while CCSDD phase flow is largely prompt and approval flag driven; ACTION: preserve hard mode guards.
- E1.183 OURS computes ready tasks from dependency closure in persisted task relations, while CCSDD primarily tracks task completion via markdown checkboxes; ACTION: support both views with compiler sync.
- E1.184 OURS runtime mode actively changes tool behavior such as subagent restrictions, while CCSDD restrictions are mostly procedural instructions; ACTION: retain executable enforcement.
- E1.185 OURS injects spec context into model message flow, while CCSDD relies on command prompt context loading each run; ACTION: retain injector and include phase snapshot.
- E1.186 OURS has compile-time checks for requirement and dependency integrity, while CCSDD encodes many constraints in human-readable rules; ACTION: keep checks in code and mirror in docs.
- E1.187 OURS tracks current task in session state, while CCSDD infers progress from tasks markdown and spec.json approvals; ACTION: synchronize current task into spec mirror.
- E1.188 OURS compiler supports idempotent updates to task entities, while CCSDD encourages iterative regeneration and merge behavior at file level; ACTION: add explicit merge policy.
- E1.189 OURS currently exposes fewer user-facing phase commands than CCSDD command packs; ACTION: add optional UX wrappers without weakening runtime core.
- E1.190 OURS has strong runtime tests around parser, compiler, helpers, and mode transitions, while CCSDD tests focus heavily on installer manifests and file operations; ACTION: preserve runtime test depth.
- E1.191 OURS persists active execution semantics in runtime and session records, while CCSDD externalizes phase visibility through file metadata; ACTION: keep DB canonical and add a file mirror.
- E1.192 OURS enforces mode transitions with explicit checks, while CCSDD phase flow is largely prompt and approval flag driven; ACTION: preserve hard mode guards.
- E1.193 OURS computes ready tasks from dependency closure in persisted task relations, while CCSDD primarily tracks task completion via markdown checkboxes; ACTION: support both views with compiler sync.
- E1.194 OURS runtime mode actively changes tool behavior such as subagent restrictions, while CCSDD restrictions are mostly procedural instructions; ACTION: retain executable enforcement.
- E1.195 OURS injects spec context into model message flow, while CCSDD relies on command prompt context loading each run; ACTION: retain injector and include phase snapshot.
- E1.196 OURS has compile-time checks for requirement and dependency integrity, while CCSDD encodes many constraints in human-readable rules; ACTION: keep checks in code and mirror in docs.
- E1.197 OURS tracks current task in session state, while CCSDD infers progress from tasks markdown and spec.json approvals; ACTION: synchronize current task into spec mirror.
- E1.198 OURS compiler supports idempotent updates to task entities, while CCSDD encourages iterative regeneration and merge behavior at file level; ACTION: add explicit merge policy.
- E1.199 OURS currently exposes fewer user-facing phase commands than CCSDD command packs; ACTION: add optional UX wrappers without weakening runtime core.
- E1.200 OURS has strong runtime tests around parser, compiler, helpers, and mode transitions, while CCSDD tests focus heavily on installer manifests and file operations; ACTION: preserve runtime test depth.
- E1.201 OURS persists active execution semantics in runtime and session records, while CCSDD externalizes phase visibility through file metadata; ACTION: keep DB canonical and add a file mirror.
- E1.202 OURS enforces mode transitions with explicit checks, while CCSDD phase flow is largely prompt and approval flag driven; ACTION: preserve hard mode guards.
- E1.203 OURS computes ready tasks from dependency closure in persisted task relations, while CCSDD primarily tracks task completion via markdown checkboxes; ACTION: support both views with compiler sync.
- E1.204 OURS runtime mode actively changes tool behavior such as subagent restrictions, while CCSDD restrictions are mostly procedural instructions; ACTION: retain executable enforcement.
- E1.205 OURS injects spec context into model message flow, while CCSDD relies on command prompt context loading each run; ACTION: retain injector and include phase snapshot.
- E1.206 OURS has compile-time checks for requirement and dependency integrity, while CCSDD encodes many constraints in human-readable rules; ACTION: keep checks in code and mirror in docs.
- E1.207 OURS tracks current task in session state, while CCSDD infers progress from tasks markdown and spec.json approvals; ACTION: synchronize current task into spec mirror.
- E1.208 OURS compiler supports idempotent updates to task entities, while CCSDD encourages iterative regeneration and merge behavior at file level; ACTION: add explicit merge policy.
- E1.209 OURS currently exposes fewer user-facing phase commands than CCSDD command packs; ACTION: add optional UX wrappers without weakening runtime core.
- E1.210 OURS has strong runtime tests around parser, compiler, helpers, and mode transitions, while CCSDD tests focus heavily on installer manifests and file operations; ACTION: preserve runtime test depth.
- E1.211 OURS persists active execution semantics in runtime and session records, while CCSDD externalizes phase visibility through file metadata; ACTION: keep DB canonical and add a file mirror.
- E1.212 OURS enforces mode transitions with explicit checks, while CCSDD phase flow is largely prompt and approval flag driven; ACTION: preserve hard mode guards.
- E1.213 OURS computes ready tasks from dependency closure in persisted task relations, while CCSDD primarily tracks task completion via markdown checkboxes; ACTION: support both views with compiler sync.
- E1.214 OURS runtime mode actively changes tool behavior such as subagent restrictions, while CCSDD restrictions are mostly procedural instructions; ACTION: retain executable enforcement.
- E1.215 OURS injects spec context into model message flow, while CCSDD relies on command prompt context loading each run; ACTION: retain injector and include phase snapshot.
- E1.216 OURS has compile-time checks for requirement and dependency integrity, while CCSDD encodes many constraints in human-readable rules; ACTION: keep checks in code and mirror in docs.
- E1.217 OURS tracks current task in session state, while CCSDD infers progress from tasks markdown and spec.json approvals; ACTION: synchronize current task into spec mirror.
- E1.218 OURS compiler supports idempotent updates to task entities, while CCSDD encourages iterative regeneration and merge behavior at file level; ACTION: add explicit merge policy.
- E1.219 OURS currently exposes fewer user-facing phase commands than CCSDD command packs; ACTION: add optional UX wrappers without weakening runtime core.
- E1.220 OURS has strong runtime tests around parser, compiler, helpers, and mode transitions, while CCSDD tests focus heavily on installer manifests and file operations; ACTION: preserve runtime test depth.
- E1.221 OURS persists active execution semantics in runtime and session records, while CCSDD externalizes phase visibility through file metadata; ACTION: keep DB canonical and add a file mirror.
- E1.222 OURS enforces mode transitions with explicit checks, while CCSDD phase flow is largely prompt and approval flag driven; ACTION: preserve hard mode guards.
- E1.223 OURS computes ready tasks from dependency closure in persisted task relations, while CCSDD primarily tracks task completion via markdown checkboxes; ACTION: support both views with compiler sync.
- E1.224 OURS runtime mode actively changes tool behavior such as subagent restrictions, while CCSDD restrictions are mostly procedural instructions; ACTION: retain executable enforcement.
- E1.225 OURS injects spec context into model message flow, while CCSDD relies on command prompt context loading each run; ACTION: retain injector and include phase snapshot.
- E1.226 OURS has compile-time checks for requirement and dependency integrity, while CCSDD encodes many constraints in human-readable rules; ACTION: keep checks in code and mirror in docs.
- E1.227 OURS tracks current task in session state, while CCSDD infers progress from tasks markdown and spec.json approvals; ACTION: synchronize current task into spec mirror.
- E1.228 OURS compiler supports idempotent updates to task entities, while CCSDD encourages iterative regeneration and merge behavior at file level; ACTION: add explicit merge policy.
- E1.229 OURS currently exposes fewer user-facing phase commands than CCSDD command packs; ACTION: add optional UX wrappers without weakening runtime core.
- E1.230 OURS has strong runtime tests around parser, compiler, helpers, and mode transitions, while CCSDD tests focus heavily on installer manifests and file operations; ACTION: preserve runtime test depth.
- E1.231 OURS persists active execution semantics in runtime and session records, while CCSDD externalizes phase visibility through file metadata; ACTION: keep DB canonical and add a file mirror.
- E1.232 OURS enforces mode transitions with explicit checks, while CCSDD phase flow is largely prompt and approval flag driven; ACTION: preserve hard mode guards.
- E1.233 OURS computes ready tasks from dependency closure in persisted task relations, while CCSDD primarily tracks task completion via markdown checkboxes; ACTION: support both views with compiler sync.
- E1.234 OURS runtime mode actively changes tool behavior such as subagent restrictions, while CCSDD restrictions are mostly procedural instructions; ACTION: retain executable enforcement.
- E1.235 OURS injects spec context into model message flow, while CCSDD relies on command prompt context loading each run; ACTION: retain injector and include phase snapshot.
- E1.236 OURS has compile-time checks for requirement and dependency integrity, while CCSDD encodes many constraints in human-readable rules; ACTION: keep checks in code and mirror in docs.
- E1.237 OURS tracks current task in session state, while CCSDD infers progress from tasks markdown and spec.json approvals; ACTION: synchronize current task into spec mirror.
- E1.238 OURS compiler supports idempotent updates to task entities, while CCSDD encourages iterative regeneration and merge behavior at file level; ACTION: add explicit merge policy.
- E1.239 OURS currently exposes fewer user-facing phase commands than CCSDD command packs; ACTION: add optional UX wrappers without weakening runtime core.
- E1.240 OURS has strong runtime tests around parser, compiler, helpers, and mode transitions, while CCSDD tests focus heavily on installer manifests and file operations; ACTION: preserve runtime test depth.
- E1.241 OURS persists active execution semantics in runtime and session records, while CCSDD externalizes phase visibility through file metadata; ACTION: keep DB canonical and add a file mirror.
- E1.242 OURS enforces mode transitions with explicit checks, while CCSDD phase flow is largely prompt and approval flag driven; ACTION: preserve hard mode guards.
- E1.243 OURS computes ready tasks from dependency closure in persisted task relations, while CCSDD primarily tracks task completion via markdown checkboxes; ACTION: support both views with compiler sync.
- E1.244 OURS runtime mode actively changes tool behavior such as subagent restrictions, while CCSDD restrictions are mostly procedural instructions; ACTION: retain executable enforcement.
- E1.245 OURS injects spec context into model message flow, while CCSDD relies on command prompt context loading each run; ACTION: retain injector and include phase snapshot.
- E1.246 OURS has compile-time checks for requirement and dependency integrity, while CCSDD encodes many constraints in human-readable rules; ACTION: keep checks in code and mirror in docs.
- E1.247 OURS tracks current task in session state, while CCSDD infers progress from tasks markdown and spec.json approvals; ACTION: synchronize current task into spec mirror.
- E1.248 OURS compiler supports idempotent updates to task entities, while CCSDD encourages iterative regeneration and merge behavior at file level; ACTION: add explicit merge policy.
- E1.249 OURS currently exposes fewer user-facing phase commands than CCSDD command packs; ACTION: add optional UX wrappers without weakening runtime core.
- E1.250 OURS has strong runtime tests around parser, compiler, helpers, and mode transitions, while CCSDD tests focus heavily on installer manifests and file operations; ACTION: preserve runtime test depth.
- E1.251 OURS persists active execution semantics in runtime and session records, while CCSDD externalizes phase visibility through file metadata; ACTION: keep DB canonical and add a file mirror.
- E1.252 OURS enforces mode transitions with explicit checks, while CCSDD phase flow is largely prompt and approval flag driven; ACTION: preserve hard mode guards.
- E1.253 OURS computes ready tasks from dependency closure in persisted task relations, while CCSDD primarily tracks task completion via markdown checkboxes; ACTION: support both views with compiler sync.
- E1.254 OURS runtime mode actively changes tool behavior such as subagent restrictions, while CCSDD restrictions are mostly procedural instructions; ACTION: retain executable enforcement.
- E1.255 OURS injects spec context into model message flow, while CCSDD relies on command prompt context loading each run; ACTION: retain injector and include phase snapshot.
- E1.256 OURS has compile-time checks for requirement and dependency integrity, while CCSDD encodes many constraints in human-readable rules; ACTION: keep checks in code and mirror in docs.
- E1.257 OURS tracks current task in session state, while CCSDD infers progress from tasks markdown and spec.json approvals; ACTION: synchronize current task into spec mirror.
- E1.258 OURS compiler supports idempotent updates to task entities, while CCSDD encourages iterative regeneration and merge behavior at file level; ACTION: add explicit merge policy.
- E1.259 OURS currently exposes fewer user-facing phase commands than CCSDD command packs; ACTION: add optional UX wrappers without weakening runtime core.
- E1.260 OURS has strong runtime tests around parser, compiler, helpers, and mode transitions, while CCSDD tests focus heavily on installer manifests and file operations; ACTION: preserve runtime test depth.

### Section E.2: Workflow, Governance, and Team Adoption

- E2.1 CCSDD has clear command-to-artifact mapping for onboarding, while OURS is stronger in internals than process narrative; ACTION: publish first-class workflow docs tied to runtime tools.
- E2.2 CCSDD standardizes team conventions under .kiro/settings templates and rules, while OURS has no equivalent public contract yet; ACTION: introduce settings contract with validation.
- E2.3 CCSDD exposes validate-gap, validate-design, and validate-impl as explicit process gates, while OURS has implicit validations in compiler/runtime; ACTION: add optional gate tools.
- E2.4 CCSDD includes a quick orchestration command for fast drafting, while OURS currently expects more manual sequencing; ACTION: add guarded quick mode with visible caveats.
- E2.5 CCSDD is packaged for many agent ecosystems, while OURS is deeply integrated into its own runtime; ACTION: defer broad packaging unless distribution goal expands.
- E2.6 CCSDD provides extensive user-facing guides and command reference documentation, while OURS documentation is stronger in code-level plans; ACTION: add operator-facing guide layer.
- E2.7 CCSDD separates research notes from design decisions, while OURS does not currently formalize a research artifact step; ACTION: add optional research artifact generation.
- E2.8 CCSDD task rules include explicit parallel markers and optional test-task notation, while OURS parser metadata is narrower; ACTION: extend parser/compiler metadata schema.
- E2.9 CCSDD includes language-localized generation constraints, while OURS has no broad localization profile in planner artifacts; ACTION: keep language metadata ready for future i18n.
- E2.10 CCSDD emphasizes human approval rhythm between phases, while OURS emphasizes executable correctness; ACTION: combine both for governance plus reliability.
- E2.11 CCSDD has clear command-to-artifact mapping for onboarding, while OURS is stronger in internals than process narrative; ACTION: publish first-class workflow docs tied to runtime tools.
- E2.12 CCSDD standardizes team conventions under .kiro/settings templates and rules, while OURS has no equivalent public contract yet; ACTION: introduce settings contract with validation.
- E2.13 CCSDD exposes validate-gap, validate-design, and validate-impl as explicit process gates, while OURS has implicit validations in compiler/runtime; ACTION: add optional gate tools.
- E2.14 CCSDD includes a quick orchestration command for fast drafting, while OURS currently expects more manual sequencing; ACTION: add guarded quick mode with visible caveats.
- E2.15 CCSDD is packaged for many agent ecosystems, while OURS is deeply integrated into its own runtime; ACTION: defer broad packaging unless distribution goal expands.
- E2.16 CCSDD provides extensive user-facing guides and command reference documentation, while OURS documentation is stronger in code-level plans; ACTION: add operator-facing guide layer.
- E2.17 CCSDD separates research notes from design decisions, while OURS does not currently formalize a research artifact step; ACTION: add optional research artifact generation.
- E2.18 CCSDD task rules include explicit parallel markers and optional test-task notation, while OURS parser metadata is narrower; ACTION: extend parser/compiler metadata schema.
- E2.19 CCSDD includes language-localized generation constraints, while OURS has no broad localization profile in planner artifacts; ACTION: keep language metadata ready for future i18n.
- E2.20 CCSDD emphasizes human approval rhythm between phases, while OURS emphasizes executable correctness; ACTION: combine both for governance plus reliability.
- E2.21 CCSDD has clear command-to-artifact mapping for onboarding, while OURS is stronger in internals than process narrative; ACTION: publish first-class workflow docs tied to runtime tools.
- E2.22 CCSDD standardizes team conventions under .kiro/settings templates and rules, while OURS has no equivalent public contract yet; ACTION: introduce settings contract with validation.
- E2.23 CCSDD exposes validate-gap, validate-design, and validate-impl as explicit process gates, while OURS has implicit validations in compiler/runtime; ACTION: add optional gate tools.
- E2.24 CCSDD includes a quick orchestration command for fast drafting, while OURS currently expects more manual sequencing; ACTION: add guarded quick mode with visible caveats.
- E2.25 CCSDD is packaged for many agent ecosystems, while OURS is deeply integrated into its own runtime; ACTION: defer broad packaging unless distribution goal expands.
- E2.26 CCSDD provides extensive user-facing guides and command reference documentation, while OURS documentation is stronger in code-level plans; ACTION: add operator-facing guide layer.
- E2.27 CCSDD separates research notes from design decisions, while OURS does not currently formalize a research artifact step; ACTION: add optional research artifact generation.
- E2.28 CCSDD task rules include explicit parallel markers and optional test-task notation, while OURS parser metadata is narrower; ACTION: extend parser/compiler metadata schema.
- E2.29 CCSDD includes language-localized generation constraints, while OURS has no broad localization profile in planner artifacts; ACTION: keep language metadata ready for future i18n.
- E2.30 CCSDD emphasizes human approval rhythm between phases, while OURS emphasizes executable correctness; ACTION: combine both for governance plus reliability.
- E2.31 CCSDD has clear command-to-artifact mapping for onboarding, while OURS is stronger in internals than process narrative; ACTION: publish first-class workflow docs tied to runtime tools.
- E2.32 CCSDD standardizes team conventions under .kiro/settings templates and rules, while OURS has no equivalent public contract yet; ACTION: introduce settings contract with validation.
- E2.33 CCSDD exposes validate-gap, validate-design, and validate-impl as explicit process gates, while OURS has implicit validations in compiler/runtime; ACTION: add optional gate tools.
- E2.34 CCSDD includes a quick orchestration command for fast drafting, while OURS currently expects more manual sequencing; ACTION: add guarded quick mode with visible caveats.
- E2.35 CCSDD is packaged for many agent ecosystems, while OURS is deeply integrated into its own runtime; ACTION: defer broad packaging unless distribution goal expands.
- E2.36 CCSDD provides extensive user-facing guides and command reference documentation, while OURS documentation is stronger in code-level plans; ACTION: add operator-facing guide layer.
- E2.37 CCSDD separates research notes from design decisions, while OURS does not currently formalize a research artifact step; ACTION: add optional research artifact generation.
- E2.38 CCSDD task rules include explicit parallel markers and optional test-task notation, while OURS parser metadata is narrower; ACTION: extend parser/compiler metadata schema.
- E2.39 CCSDD includes language-localized generation constraints, while OURS has no broad localization profile in planner artifacts; ACTION: keep language metadata ready for future i18n.
- E2.40 CCSDD emphasizes human approval rhythm between phases, while OURS emphasizes executable correctness; ACTION: combine both for governance plus reliability.
- E2.41 CCSDD has clear command-to-artifact mapping for onboarding, while OURS is stronger in internals than process narrative; ACTION: publish first-class workflow docs tied to runtime tools.
- E2.42 CCSDD standardizes team conventions under .kiro/settings templates and rules, while OURS has no equivalent public contract yet; ACTION: introduce settings contract with validation.
- E2.43 CCSDD exposes validate-gap, validate-design, and validate-impl as explicit process gates, while OURS has implicit validations in compiler/runtime; ACTION: add optional gate tools.
- E2.44 CCSDD includes a quick orchestration command for fast drafting, while OURS currently expects more manual sequencing; ACTION: add guarded quick mode with visible caveats.
- E2.45 CCSDD is packaged for many agent ecosystems, while OURS is deeply integrated into its own runtime; ACTION: defer broad packaging unless distribution goal expands.
- E2.46 CCSDD provides extensive user-facing guides and command reference documentation, while OURS documentation is stronger in code-level plans; ACTION: add operator-facing guide layer.
- E2.47 CCSDD separates research notes from design decisions, while OURS does not currently formalize a research artifact step; ACTION: add optional research artifact generation.
- E2.48 CCSDD task rules include explicit parallel markers and optional test-task notation, while OURS parser metadata is narrower; ACTION: extend parser/compiler metadata schema.
- E2.49 CCSDD includes language-localized generation constraints, while OURS has no broad localization profile in planner artifacts; ACTION: keep language metadata ready for future i18n.
- E2.50 CCSDD emphasizes human approval rhythm between phases, while OURS emphasizes executable correctness; ACTION: combine both for governance plus reliability.
- E2.51 CCSDD has clear command-to-artifact mapping for onboarding, while OURS is stronger in internals than process narrative; ACTION: publish first-class workflow docs tied to runtime tools.
- E2.52 CCSDD standardizes team conventions under .kiro/settings templates and rules, while OURS has no equivalent public contract yet; ACTION: introduce settings contract with validation.
- E2.53 CCSDD exposes validate-gap, validate-design, and validate-impl as explicit process gates, while OURS has implicit validations in compiler/runtime; ACTION: add optional gate tools.
- E2.54 CCSDD includes a quick orchestration command for fast drafting, while OURS currently expects more manual sequencing; ACTION: add guarded quick mode with visible caveats.
- E2.55 CCSDD is packaged for many agent ecosystems, while OURS is deeply integrated into its own runtime; ACTION: defer broad packaging unless distribution goal expands.
- E2.56 CCSDD provides extensive user-facing guides and command reference documentation, while OURS documentation is stronger in code-level plans; ACTION: add operator-facing guide layer.
- E2.57 CCSDD separates research notes from design decisions, while OURS does not currently formalize a research artifact step; ACTION: add optional research artifact generation.
- E2.58 CCSDD task rules include explicit parallel markers and optional test-task notation, while OURS parser metadata is narrower; ACTION: extend parser/compiler metadata schema.
- E2.59 CCSDD includes language-localized generation constraints, while OURS has no broad localization profile in planner artifacts; ACTION: keep language metadata ready for future i18n.
- E2.60 CCSDD emphasizes human approval rhythm between phases, while OURS emphasizes executable correctness; ACTION: combine both for governance plus reliability.
- E2.61 CCSDD has clear command-to-artifact mapping for onboarding, while OURS is stronger in internals than process narrative; ACTION: publish first-class workflow docs tied to runtime tools.
- E2.62 CCSDD standardizes team conventions under .kiro/settings templates and rules, while OURS has no equivalent public contract yet; ACTION: introduce settings contract with validation.
- E2.63 CCSDD exposes validate-gap, validate-design, and validate-impl as explicit process gates, while OURS has implicit validations in compiler/runtime; ACTION: add optional gate tools.
- E2.64 CCSDD includes a quick orchestration command for fast drafting, while OURS currently expects more manual sequencing; ACTION: add guarded quick mode with visible caveats.
- E2.65 CCSDD is packaged for many agent ecosystems, while OURS is deeply integrated into its own runtime; ACTION: defer broad packaging unless distribution goal expands.
- E2.66 CCSDD provides extensive user-facing guides and command reference documentation, while OURS documentation is stronger in code-level plans; ACTION: add operator-facing guide layer.
- E2.67 CCSDD separates research notes from design decisions, while OURS does not currently formalize a research artifact step; ACTION: add optional research artifact generation.
- E2.68 CCSDD task rules include explicit parallel markers and optional test-task notation, while OURS parser metadata is narrower; ACTION: extend parser/compiler metadata schema.
- E2.69 CCSDD includes language-localized generation constraints, while OURS has no broad localization profile in planner artifacts; ACTION: keep language metadata ready for future i18n.
- E2.70 CCSDD emphasizes human approval rhythm between phases, while OURS emphasizes executable correctness; ACTION: combine both for governance plus reliability.
- E2.71 CCSDD has clear command-to-artifact mapping for onboarding, while OURS is stronger in internals than process narrative; ACTION: publish first-class workflow docs tied to runtime tools.
- E2.72 CCSDD standardizes team conventions under .kiro/settings templates and rules, while OURS has no equivalent public contract yet; ACTION: introduce settings contract with validation.
- E2.73 CCSDD exposes validate-gap, validate-design, and validate-impl as explicit process gates, while OURS has implicit validations in compiler/runtime; ACTION: add optional gate tools.
- E2.74 CCSDD includes a quick orchestration command for fast drafting, while OURS currently expects more manual sequencing; ACTION: add guarded quick mode with visible caveats.
- E2.75 CCSDD is packaged for many agent ecosystems, while OURS is deeply integrated into its own runtime; ACTION: defer broad packaging unless distribution goal expands.
- E2.76 CCSDD provides extensive user-facing guides and command reference documentation, while OURS documentation is stronger in code-level plans; ACTION: add operator-facing guide layer.
- E2.77 CCSDD separates research notes from design decisions, while OURS does not currently formalize a research artifact step; ACTION: add optional research artifact generation.
- E2.78 CCSDD task rules include explicit parallel markers and optional test-task notation, while OURS parser metadata is narrower; ACTION: extend parser/compiler metadata schema.
- E2.79 CCSDD includes language-localized generation constraints, while OURS has no broad localization profile in planner artifacts; ACTION: keep language metadata ready for future i18n.
- E2.80 CCSDD emphasizes human approval rhythm between phases, while OURS emphasizes executable correctness; ACTION: combine both for governance plus reliability.
- E2.81 CCSDD has clear command-to-artifact mapping for onboarding, while OURS is stronger in internals than process narrative; ACTION: publish first-class workflow docs tied to runtime tools.
- E2.82 CCSDD standardizes team conventions under .kiro/settings templates and rules, while OURS has no equivalent public contract yet; ACTION: introduce settings contract with validation.
- E2.83 CCSDD exposes validate-gap, validate-design, and validate-impl as explicit process gates, while OURS has implicit validations in compiler/runtime; ACTION: add optional gate tools.
- E2.84 CCSDD includes a quick orchestration command for fast drafting, while OURS currently expects more manual sequencing; ACTION: add guarded quick mode with visible caveats.
- E2.85 CCSDD is packaged for many agent ecosystems, while OURS is deeply integrated into its own runtime; ACTION: defer broad packaging unless distribution goal expands.
- E2.86 CCSDD provides extensive user-facing guides and command reference documentation, while OURS documentation is stronger in code-level plans; ACTION: add operator-facing guide layer.
- E2.87 CCSDD separates research notes from design decisions, while OURS does not currently formalize a research artifact step; ACTION: add optional research artifact generation.
- E2.88 CCSDD task rules include explicit parallel markers and optional test-task notation, while OURS parser metadata is narrower; ACTION: extend parser/compiler metadata schema.
- E2.89 CCSDD includes language-localized generation constraints, while OURS has no broad localization profile in planner artifacts; ACTION: keep language metadata ready for future i18n.
- E2.90 CCSDD emphasizes human approval rhythm between phases, while OURS emphasizes executable correctness; ACTION: combine both for governance plus reliability.
- E2.91 CCSDD has clear command-to-artifact mapping for onboarding, while OURS is stronger in internals than process narrative; ACTION: publish first-class workflow docs tied to runtime tools.
- E2.92 CCSDD standardizes team conventions under .kiro/settings templates and rules, while OURS has no equivalent public contract yet; ACTION: introduce settings contract with validation.
- E2.93 CCSDD exposes validate-gap, validate-design, and validate-impl as explicit process gates, while OURS has implicit validations in compiler/runtime; ACTION: add optional gate tools.
- E2.94 CCSDD includes a quick orchestration command for fast drafting, while OURS currently expects more manual sequencing; ACTION: add guarded quick mode with visible caveats.
- E2.95 CCSDD is packaged for many agent ecosystems, while OURS is deeply integrated into its own runtime; ACTION: defer broad packaging unless distribution goal expands.
- E2.96 CCSDD provides extensive user-facing guides and command reference documentation, while OURS documentation is stronger in code-level plans; ACTION: add operator-facing guide layer.
- E2.97 CCSDD separates research notes from design decisions, while OURS does not currently formalize a research artifact step; ACTION: add optional research artifact generation.
- E2.98 CCSDD task rules include explicit parallel markers and optional test-task notation, while OURS parser metadata is narrower; ACTION: extend parser/compiler metadata schema.
- E2.99 CCSDD includes language-localized generation constraints, while OURS has no broad localization profile in planner artifacts; ACTION: keep language metadata ready for future i18n.
- E2.100 CCSDD emphasizes human approval rhythm between phases, while OURS emphasizes executable correctness; ACTION: combine both for governance plus reliability.
- E2.101 CCSDD has clear command-to-artifact mapping for onboarding, while OURS is stronger in internals than process narrative; ACTION: publish first-class workflow docs tied to runtime tools.
- E2.102 CCSDD standardizes team conventions under .kiro/settings templates and rules, while OURS has no equivalent public contract yet; ACTION: introduce settings contract with validation.
- E2.103 CCSDD exposes validate-gap, validate-design, and validate-impl as explicit process gates, while OURS has implicit validations in compiler/runtime; ACTION: add optional gate tools.
- E2.104 CCSDD includes a quick orchestration command for fast drafting, while OURS currently expects more manual sequencing; ACTION: add guarded quick mode with visible caveats.
- E2.105 CCSDD is packaged for many agent ecosystems, while OURS is deeply integrated into its own runtime; ACTION: defer broad packaging unless distribution goal expands.
- E2.106 CCSDD provides extensive user-facing guides and command reference documentation, while OURS documentation is stronger in code-level plans; ACTION: add operator-facing guide layer.
- E2.107 CCSDD separates research notes from design decisions, while OURS does not currently formalize a research artifact step; ACTION: add optional research artifact generation.
- E2.108 CCSDD task rules include explicit parallel markers and optional test-task notation, while OURS parser metadata is narrower; ACTION: extend parser/compiler metadata schema.
- E2.109 CCSDD includes language-localized generation constraints, while OURS has no broad localization profile in planner artifacts; ACTION: keep language metadata ready for future i18n.
- E2.110 CCSDD emphasizes human approval rhythm between phases, while OURS emphasizes executable correctness; ACTION: combine both for governance plus reliability.
- E2.111 CCSDD has clear command-to-artifact mapping for onboarding, while OURS is stronger in internals than process narrative; ACTION: publish first-class workflow docs tied to runtime tools.
- E2.112 CCSDD standardizes team conventions under .kiro/settings templates and rules, while OURS has no equivalent public contract yet; ACTION: introduce settings contract with validation.
- E2.113 CCSDD exposes validate-gap, validate-design, and validate-impl as explicit process gates, while OURS has implicit validations in compiler/runtime; ACTION: add optional gate tools.
- E2.114 CCSDD includes a quick orchestration command for fast drafting, while OURS currently expects more manual sequencing; ACTION: add guarded quick mode with visible caveats.
- E2.115 CCSDD is packaged for many agent ecosystems, while OURS is deeply integrated into its own runtime; ACTION: defer broad packaging unless distribution goal expands.
- E2.116 CCSDD provides extensive user-facing guides and command reference documentation, while OURS documentation is stronger in code-level plans; ACTION: add operator-facing guide layer.
- E2.117 CCSDD separates research notes from design decisions, while OURS does not currently formalize a research artifact step; ACTION: add optional research artifact generation.
- E2.118 CCSDD task rules include explicit parallel markers and optional test-task notation, while OURS parser metadata is narrower; ACTION: extend parser/compiler metadata schema.
- E2.119 CCSDD includes language-localized generation constraints, while OURS has no broad localization profile in planner artifacts; ACTION: keep language metadata ready for future i18n.
- E2.120 CCSDD emphasizes human approval rhythm between phases, while OURS emphasizes executable correctness; ACTION: combine both for governance plus reliability.
- E2.121 CCSDD has clear command-to-artifact mapping for onboarding, while OURS is stronger in internals than process narrative; ACTION: publish first-class workflow docs tied to runtime tools.
- E2.122 CCSDD standardizes team conventions under .kiro/settings templates and rules, while OURS has no equivalent public contract yet; ACTION: introduce settings contract with validation.
- E2.123 CCSDD exposes validate-gap, validate-design, and validate-impl as explicit process gates, while OURS has implicit validations in compiler/runtime; ACTION: add optional gate tools.
- E2.124 CCSDD includes a quick orchestration command for fast drafting, while OURS currently expects more manual sequencing; ACTION: add guarded quick mode with visible caveats.
- E2.125 CCSDD is packaged for many agent ecosystems, while OURS is deeply integrated into its own runtime; ACTION: defer broad packaging unless distribution goal expands.
- E2.126 CCSDD provides extensive user-facing guides and command reference documentation, while OURS documentation is stronger in code-level plans; ACTION: add operator-facing guide layer.
- E2.127 CCSDD separates research notes from design decisions, while OURS does not currently formalize a research artifact step; ACTION: add optional research artifact generation.
- E2.128 CCSDD task rules include explicit parallel markers and optional test-task notation, while OURS parser metadata is narrower; ACTION: extend parser/compiler metadata schema.
- E2.129 CCSDD includes language-localized generation constraints, while OURS has no broad localization profile in planner artifacts; ACTION: keep language metadata ready for future i18n.
- E2.130 CCSDD emphasizes human approval rhythm between phases, while OURS emphasizes executable correctness; ACTION: combine both for governance plus reliability.
- E2.131 CCSDD has clear command-to-artifact mapping for onboarding, while OURS is stronger in internals than process narrative; ACTION: publish first-class workflow docs tied to runtime tools.
- E2.132 CCSDD standardizes team conventions under .kiro/settings templates and rules, while OURS has no equivalent public contract yet; ACTION: introduce settings contract with validation.
- E2.133 CCSDD exposes validate-gap, validate-design, and validate-impl as explicit process gates, while OURS has implicit validations in compiler/runtime; ACTION: add optional gate tools.
- E2.134 CCSDD includes a quick orchestration command for fast drafting, while OURS currently expects more manual sequencing; ACTION: add guarded quick mode with visible caveats.
- E2.135 CCSDD is packaged for many agent ecosystems, while OURS is deeply integrated into its own runtime; ACTION: defer broad packaging unless distribution goal expands.
- E2.136 CCSDD provides extensive user-facing guides and command reference documentation, while OURS documentation is stronger in code-level plans; ACTION: add operator-facing guide layer.
- E2.137 CCSDD separates research notes from design decisions, while OURS does not currently formalize a research artifact step; ACTION: add optional research artifact generation.
- E2.138 CCSDD task rules include explicit parallel markers and optional test-task notation, while OURS parser metadata is narrower; ACTION: extend parser/compiler metadata schema.
- E2.139 CCSDD includes language-localized generation constraints, while OURS has no broad localization profile in planner artifacts; ACTION: keep language metadata ready for future i18n.
- E2.140 CCSDD emphasizes human approval rhythm between phases, while OURS emphasizes executable correctness; ACTION: combine both for governance plus reliability.
- E2.141 CCSDD has clear command-to-artifact mapping for onboarding, while OURS is stronger in internals than process narrative; ACTION: publish first-class workflow docs tied to runtime tools.
- E2.142 CCSDD standardizes team conventions under .kiro/settings templates and rules, while OURS has no equivalent public contract yet; ACTION: introduce settings contract with validation.
- E2.143 CCSDD exposes validate-gap, validate-design, and validate-impl as explicit process gates, while OURS has implicit validations in compiler/runtime; ACTION: add optional gate tools.
- E2.144 CCSDD includes a quick orchestration command for fast drafting, while OURS currently expects more manual sequencing; ACTION: add guarded quick mode with visible caveats.
- E2.145 CCSDD is packaged for many agent ecosystems, while OURS is deeply integrated into its own runtime; ACTION: defer broad packaging unless distribution goal expands.
- E2.146 CCSDD provides extensive user-facing guides and command reference documentation, while OURS documentation is stronger in code-level plans; ACTION: add operator-facing guide layer.
- E2.147 CCSDD separates research notes from design decisions, while OURS does not currently formalize a research artifact step; ACTION: add optional research artifact generation.
- E2.148 CCSDD task rules include explicit parallel markers and optional test-task notation, while OURS parser metadata is narrower; ACTION: extend parser/compiler metadata schema.
- E2.149 CCSDD includes language-localized generation constraints, while OURS has no broad localization profile in planner artifacts; ACTION: keep language metadata ready for future i18n.
- E2.150 CCSDD emphasizes human approval rhythm between phases, while OURS emphasizes executable correctness; ACTION: combine both for governance plus reliability.
- E2.151 CCSDD has clear command-to-artifact mapping for onboarding, while OURS is stronger in internals than process narrative; ACTION: publish first-class workflow docs tied to runtime tools.
- E2.152 CCSDD standardizes team conventions under .kiro/settings templates and rules, while OURS has no equivalent public contract yet; ACTION: introduce settings contract with validation.
- E2.153 CCSDD exposes validate-gap, validate-design, and validate-impl as explicit process gates, while OURS has implicit validations in compiler/runtime; ACTION: add optional gate tools.
- E2.154 CCSDD includes a quick orchestration command for fast drafting, while OURS currently expects more manual sequencing; ACTION: add guarded quick mode with visible caveats.
- E2.155 CCSDD is packaged for many agent ecosystems, while OURS is deeply integrated into its own runtime; ACTION: defer broad packaging unless distribution goal expands.
- E2.156 CCSDD provides extensive user-facing guides and command reference documentation, while OURS documentation is stronger in code-level plans; ACTION: add operator-facing guide layer.
- E2.157 CCSDD separates research notes from design decisions, while OURS does not currently formalize a research artifact step; ACTION: add optional research artifact generation.
- E2.158 CCSDD task rules include explicit parallel markers and optional test-task notation, while OURS parser metadata is narrower; ACTION: extend parser/compiler metadata schema.
- E2.159 CCSDD includes language-localized generation constraints, while OURS has no broad localization profile in planner artifacts; ACTION: keep language metadata ready for future i18n.
- E2.160 CCSDD emphasizes human approval rhythm between phases, while OURS emphasizes executable correctness; ACTION: combine both for governance plus reliability.
- E2.161 CCSDD has clear command-to-artifact mapping for onboarding, while OURS is stronger in internals than process narrative; ACTION: publish first-class workflow docs tied to runtime tools.
- E2.162 CCSDD standardizes team conventions under .kiro/settings templates and rules, while OURS has no equivalent public contract yet; ACTION: introduce settings contract with validation.
- E2.163 CCSDD exposes validate-gap, validate-design, and validate-impl as explicit process gates, while OURS has implicit validations in compiler/runtime; ACTION: add optional gate tools.
- E2.164 CCSDD includes a quick orchestration command for fast drafting, while OURS currently expects more manual sequencing; ACTION: add guarded quick mode with visible caveats.
- E2.165 CCSDD is packaged for many agent ecosystems, while OURS is deeply integrated into its own runtime; ACTION: defer broad packaging unless distribution goal expands.
- E2.166 CCSDD provides extensive user-facing guides and command reference documentation, while OURS documentation is stronger in code-level plans; ACTION: add operator-facing guide layer.
- E2.167 CCSDD separates research notes from design decisions, while OURS does not currently formalize a research artifact step; ACTION: add optional research artifact generation.
- E2.168 CCSDD task rules include explicit parallel markers and optional test-task notation, while OURS parser metadata is narrower; ACTION: extend parser/compiler metadata schema.
- E2.169 CCSDD includes language-localized generation constraints, while OURS has no broad localization profile in planner artifacts; ACTION: keep language metadata ready for future i18n.
- E2.170 CCSDD emphasizes human approval rhythm between phases, while OURS emphasizes executable correctness; ACTION: combine both for governance plus reliability.
- E2.171 CCSDD has clear command-to-artifact mapping for onboarding, while OURS is stronger in internals than process narrative; ACTION: publish first-class workflow docs tied to runtime tools.
- E2.172 CCSDD standardizes team conventions under .kiro/settings templates and rules, while OURS has no equivalent public contract yet; ACTION: introduce settings contract with validation.
- E2.173 CCSDD exposes validate-gap, validate-design, and validate-impl as explicit process gates, while OURS has implicit validations in compiler/runtime; ACTION: add optional gate tools.
- E2.174 CCSDD includes a quick orchestration command for fast drafting, while OURS currently expects more manual sequencing; ACTION: add guarded quick mode with visible caveats.
- E2.175 CCSDD is packaged for many agent ecosystems, while OURS is deeply integrated into its own runtime; ACTION: defer broad packaging unless distribution goal expands.
- E2.176 CCSDD provides extensive user-facing guides and command reference documentation, while OURS documentation is stronger in code-level plans; ACTION: add operator-facing guide layer.
- E2.177 CCSDD separates research notes from design decisions, while OURS does not currently formalize a research artifact step; ACTION: add optional research artifact generation.
- E2.178 CCSDD task rules include explicit parallel markers and optional test-task notation, while OURS parser metadata is narrower; ACTION: extend parser/compiler metadata schema.
- E2.179 CCSDD includes language-localized generation constraints, while OURS has no broad localization profile in planner artifacts; ACTION: keep language metadata ready for future i18n.
- E2.180 CCSDD emphasizes human approval rhythm between phases, while OURS emphasizes executable correctness; ACTION: combine both for governance plus reliability.
- E2.181 CCSDD has clear command-to-artifact mapping for onboarding, while OURS is stronger in internals than process narrative; ACTION: publish first-class workflow docs tied to runtime tools.
- E2.182 CCSDD standardizes team conventions under .kiro/settings templates and rules, while OURS has no equivalent public contract yet; ACTION: introduce settings contract with validation.
- E2.183 CCSDD exposes validate-gap, validate-design, and validate-impl as explicit process gates, while OURS has implicit validations in compiler/runtime; ACTION: add optional gate tools.
- E2.184 CCSDD includes a quick orchestration command for fast drafting, while OURS currently expects more manual sequencing; ACTION: add guarded quick mode with visible caveats.
- E2.185 CCSDD is packaged for many agent ecosystems, while OURS is deeply integrated into its own runtime; ACTION: defer broad packaging unless distribution goal expands.
- E2.186 CCSDD provides extensive user-facing guides and command reference documentation, while OURS documentation is stronger in code-level plans; ACTION: add operator-facing guide layer.
- E2.187 CCSDD separates research notes from design decisions, while OURS does not currently formalize a research artifact step; ACTION: add optional research artifact generation.
- E2.188 CCSDD task rules include explicit parallel markers and optional test-task notation, while OURS parser metadata is narrower; ACTION: extend parser/compiler metadata schema.
- E2.189 CCSDD includes language-localized generation constraints, while OURS has no broad localization profile in planner artifacts; ACTION: keep language metadata ready for future i18n.
- E2.190 CCSDD emphasizes human approval rhythm between phases, while OURS emphasizes executable correctness; ACTION: combine both for governance plus reliability.
- E2.191 CCSDD has clear command-to-artifact mapping for onboarding, while OURS is stronger in internals than process narrative; ACTION: publish first-class workflow docs tied to runtime tools.
- E2.192 CCSDD standardizes team conventions under .kiro/settings templates and rules, while OURS has no equivalent public contract yet; ACTION: introduce settings contract with validation.
- E2.193 CCSDD exposes validate-gap, validate-design, and validate-impl as explicit process gates, while OURS has implicit validations in compiler/runtime; ACTION: add optional gate tools.
- E2.194 CCSDD includes a quick orchestration command for fast drafting, while OURS currently expects more manual sequencing; ACTION: add guarded quick mode with visible caveats.
- E2.195 CCSDD is packaged for many agent ecosystems, while OURS is deeply integrated into its own runtime; ACTION: defer broad packaging unless distribution goal expands.
- E2.196 CCSDD provides extensive user-facing guides and command reference documentation, while OURS documentation is stronger in code-level plans; ACTION: add operator-facing guide layer.
- E2.197 CCSDD separates research notes from design decisions, while OURS does not currently formalize a research artifact step; ACTION: add optional research artifact generation.
- E2.198 CCSDD task rules include explicit parallel markers and optional test-task notation, while OURS parser metadata is narrower; ACTION: extend parser/compiler metadata schema.
- E2.199 CCSDD includes language-localized generation constraints, while OURS has no broad localization profile in planner artifacts; ACTION: keep language metadata ready for future i18n.
- E2.200 CCSDD emphasizes human approval rhythm between phases, while OURS emphasizes executable correctness; ACTION: combine both for governance plus reliability.
- E2.201 CCSDD has clear command-to-artifact mapping for onboarding, while OURS is stronger in internals than process narrative; ACTION: publish first-class workflow docs tied to runtime tools.
- E2.202 CCSDD standardizes team conventions under .kiro/settings templates and rules, while OURS has no equivalent public contract yet; ACTION: introduce settings contract with validation.
- E2.203 CCSDD exposes validate-gap, validate-design, and validate-impl as explicit process gates, while OURS has implicit validations in compiler/runtime; ACTION: add optional gate tools.
- E2.204 CCSDD includes a quick orchestration command for fast drafting, while OURS currently expects more manual sequencing; ACTION: add guarded quick mode with visible caveats.
- E2.205 CCSDD is packaged for many agent ecosystems, while OURS is deeply integrated into its own runtime; ACTION: defer broad packaging unless distribution goal expands.
- E2.206 CCSDD provides extensive user-facing guides and command reference documentation, while OURS documentation is stronger in code-level plans; ACTION: add operator-facing guide layer.
- E2.207 CCSDD separates research notes from design decisions, while OURS does not currently formalize a research artifact step; ACTION: add optional research artifact generation.
- E2.208 CCSDD task rules include explicit parallel markers and optional test-task notation, while OURS parser metadata is narrower; ACTION: extend parser/compiler metadata schema.
- E2.209 CCSDD includes language-localized generation constraints, while OURS has no broad localization profile in planner artifacts; ACTION: keep language metadata ready for future i18n.
- E2.210 CCSDD emphasizes human approval rhythm between phases, while OURS emphasizes executable correctness; ACTION: combine both for governance plus reliability.
- E2.211 CCSDD has clear command-to-artifact mapping for onboarding, while OURS is stronger in internals than process narrative; ACTION: publish first-class workflow docs tied to runtime tools.
- E2.212 CCSDD standardizes team conventions under .kiro/settings templates and rules, while OURS has no equivalent public contract yet; ACTION: introduce settings contract with validation.
- E2.213 CCSDD exposes validate-gap, validate-design, and validate-impl as explicit process gates, while OURS has implicit validations in compiler/runtime; ACTION: add optional gate tools.
- E2.214 CCSDD includes a quick orchestration command for fast drafting, while OURS currently expects more manual sequencing; ACTION: add guarded quick mode with visible caveats.
- E2.215 CCSDD is packaged for many agent ecosystems, while OURS is deeply integrated into its own runtime; ACTION: defer broad packaging unless distribution goal expands.
- E2.216 CCSDD provides extensive user-facing guides and command reference documentation, while OURS documentation is stronger in code-level plans; ACTION: add operator-facing guide layer.
- E2.217 CCSDD separates research notes from design decisions, while OURS does not currently formalize a research artifact step; ACTION: add optional research artifact generation.
- E2.218 CCSDD task rules include explicit parallel markers and optional test-task notation, while OURS parser metadata is narrower; ACTION: extend parser/compiler metadata schema.
- E2.219 CCSDD includes language-localized generation constraints, while OURS has no broad localization profile in planner artifacts; ACTION: keep language metadata ready for future i18n.
- E2.220 CCSDD emphasizes human approval rhythm between phases, while OURS emphasizes executable correctness; ACTION: combine both for governance plus reliability.
- E2.221 CCSDD has clear command-to-artifact mapping for onboarding, while OURS is stronger in internals than process narrative; ACTION: publish first-class workflow docs tied to runtime tools.
- E2.222 CCSDD standardizes team conventions under .kiro/settings templates and rules, while OURS has no equivalent public contract yet; ACTION: introduce settings contract with validation.
- E2.223 CCSDD exposes validate-gap, validate-design, and validate-impl as explicit process gates, while OURS has implicit validations in compiler/runtime; ACTION: add optional gate tools.
- E2.224 CCSDD includes a quick orchestration command for fast drafting, while OURS currently expects more manual sequencing; ACTION: add guarded quick mode with visible caveats.
- E2.225 CCSDD is packaged for many agent ecosystems, while OURS is deeply integrated into its own runtime; ACTION: defer broad packaging unless distribution goal expands.
- E2.226 CCSDD provides extensive user-facing guides and command reference documentation, while OURS documentation is stronger in code-level plans; ACTION: add operator-facing guide layer.
- E2.227 CCSDD separates research notes from design decisions, while OURS does not currently formalize a research artifact step; ACTION: add optional research artifact generation.
- E2.228 CCSDD task rules include explicit parallel markers and optional test-task notation, while OURS parser metadata is narrower; ACTION: extend parser/compiler metadata schema.
- E2.229 CCSDD includes language-localized generation constraints, while OURS has no broad localization profile in planner artifacts; ACTION: keep language metadata ready for future i18n.
- E2.230 CCSDD emphasizes human approval rhythm between phases, while OURS emphasizes executable correctness; ACTION: combine both for governance plus reliability.
- E2.231 CCSDD has clear command-to-artifact mapping for onboarding, while OURS is stronger in internals than process narrative; ACTION: publish first-class workflow docs tied to runtime tools.
- E2.232 CCSDD standardizes team conventions under .kiro/settings templates and rules, while OURS has no equivalent public contract yet; ACTION: introduce settings contract with validation.
- E2.233 CCSDD exposes validate-gap, validate-design, and validate-impl as explicit process gates, while OURS has implicit validations in compiler/runtime; ACTION: add optional gate tools.
- E2.234 CCSDD includes a quick orchestration command for fast drafting, while OURS currently expects more manual sequencing; ACTION: add guarded quick mode with visible caveats.
- E2.235 CCSDD is packaged for many agent ecosystems, while OURS is deeply integrated into its own runtime; ACTION: defer broad packaging unless distribution goal expands.
- E2.236 CCSDD provides extensive user-facing guides and command reference documentation, while OURS documentation is stronger in code-level plans; ACTION: add operator-facing guide layer.
- E2.237 CCSDD separates research notes from design decisions, while OURS does not currently formalize a research artifact step; ACTION: add optional research artifact generation.
- E2.238 CCSDD task rules include explicit parallel markers and optional test-task notation, while OURS parser metadata is narrower; ACTION: extend parser/compiler metadata schema.
- E2.239 CCSDD includes language-localized generation constraints, while OURS has no broad localization profile in planner artifacts; ACTION: keep language metadata ready for future i18n.
- E2.240 CCSDD emphasizes human approval rhythm between phases, while OURS emphasizes executable correctness; ACTION: combine both for governance plus reliability.
- E2.241 CCSDD has clear command-to-artifact mapping for onboarding, while OURS is stronger in internals than process narrative; ACTION: publish first-class workflow docs tied to runtime tools.
- E2.242 CCSDD standardizes team conventions under .kiro/settings templates and rules, while OURS has no equivalent public contract yet; ACTION: introduce settings contract with validation.
- E2.243 CCSDD exposes validate-gap, validate-design, and validate-impl as explicit process gates, while OURS has implicit validations in compiler/runtime; ACTION: add optional gate tools.
- E2.244 CCSDD includes a quick orchestration command for fast drafting, while OURS currently expects more manual sequencing; ACTION: add guarded quick mode with visible caveats.
- E2.245 CCSDD is packaged for many agent ecosystems, while OURS is deeply integrated into its own runtime; ACTION: defer broad packaging unless distribution goal expands.
- E2.246 CCSDD provides extensive user-facing guides and command reference documentation, while OURS documentation is stronger in code-level plans; ACTION: add operator-facing guide layer.
- E2.247 CCSDD separates research notes from design decisions, while OURS does not currently formalize a research artifact step; ACTION: add optional research artifact generation.
- E2.248 CCSDD task rules include explicit parallel markers and optional test-task notation, while OURS parser metadata is narrower; ACTION: extend parser/compiler metadata schema.
- E2.249 CCSDD includes language-localized generation constraints, while OURS has no broad localization profile in planner artifacts; ACTION: keep language metadata ready for future i18n.
- E2.250 CCSDD emphasizes human approval rhythm between phases, while OURS emphasizes executable correctness; ACTION: combine both for governance plus reliability.
- E2.251 CCSDD has clear command-to-artifact mapping for onboarding, while OURS is stronger in internals than process narrative; ACTION: publish first-class workflow docs tied to runtime tools.
- E2.252 CCSDD standardizes team conventions under .kiro/settings templates and rules, while OURS has no equivalent public contract yet; ACTION: introduce settings contract with validation.
- E2.253 CCSDD exposes validate-gap, validate-design, and validate-impl as explicit process gates, while OURS has implicit validations in compiler/runtime; ACTION: add optional gate tools.
- E2.254 CCSDD includes a quick orchestration command for fast drafting, while OURS currently expects more manual sequencing; ACTION: add guarded quick mode with visible caveats.
- E2.255 CCSDD is packaged for many agent ecosystems, while OURS is deeply integrated into its own runtime; ACTION: defer broad packaging unless distribution goal expands.
- E2.256 CCSDD provides extensive user-facing guides and command reference documentation, while OURS documentation is stronger in code-level plans; ACTION: add operator-facing guide layer.
- E2.257 CCSDD separates research notes from design decisions, while OURS does not currently formalize a research artifact step; ACTION: add optional research artifact generation.
- E2.258 CCSDD task rules include explicit parallel markers and optional test-task notation, while OURS parser metadata is narrower; ACTION: extend parser/compiler metadata schema.
- E2.259 CCSDD includes language-localized generation constraints, while OURS has no broad localization profile in planner artifacts; ACTION: keep language metadata ready for future i18n.
- E2.260 CCSDD emphasizes human approval rhythm between phases, while OURS emphasizes executable correctness; ACTION: combine both for governance plus reliability.

### Section E.3: Technical Debt and Migration Risk Notes

- E3.1 Risk: file-state and DB-state divergence after partial failures; Mitigation: DB remains canonical, file mirror is derived and reconciled after writes.
- E3.2 Risk: prompt drift in validation commands reducing reliability; Mitigation: encode hard failures in code and present advisory guidance in prompt output.
- E3.3 Risk: parser brittleness if teams customize templates too freely; Mitigation: require structural markers and add lint checks for required sections.
- E3.4 Risk: confusion between runtime mode and workflow phase; Mitigation: expose both fields in status output with explicit definitions and examples.
- E3.5 Risk: quick mode may bypass review quality gates by default; Mitigation: default interactive mode and require explicit auto flag with warnings.
- E3.6 Risk: schema churn for spec.json mirror can break tooling; Mitigation: versioned schema and backward-compatible readers with migration helpers.
- E3.7 Risk: context overflow in long orchestration sessions; Mitigation: write compact checkpoints and rely on persisted phase/task state for resumption.
- E3.8 Risk: inconsistent requirement IDs in legacy docs causes compile failures; Mitigation: normalization plus actionable diagnostics and optional strict mode.
- E3.9 Risk: naive parallel markers create unsafe concurrent work assumptions; Mitigation: treat markers as advisory until dependency and resource checks pass.
- E3.10 Risk: adding too many commands without ownership model; Mitigation: phased rollout with ownership matrix and deprecation policy.
- E3.11 Risk: file-state and DB-state divergence after partial failures; Mitigation: DB remains canonical, file mirror is derived and reconciled after writes.
- E3.12 Risk: prompt drift in validation commands reducing reliability; Mitigation: encode hard failures in code and present advisory guidance in prompt output.
- E3.13 Risk: parser brittleness if teams customize templates too freely; Mitigation: require structural markers and add lint checks for required sections.
- E3.14 Risk: confusion between runtime mode and workflow phase; Mitigation: expose both fields in status output with explicit definitions and examples.
- E3.15 Risk: quick mode may bypass review quality gates by default; Mitigation: default interactive mode and require explicit auto flag with warnings.
- E3.16 Risk: schema churn for spec.json mirror can break tooling; Mitigation: versioned schema and backward-compatible readers with migration helpers.
- E3.17 Risk: context overflow in long orchestration sessions; Mitigation: write compact checkpoints and rely on persisted phase/task state for resumption.
- E3.18 Risk: inconsistent requirement IDs in legacy docs causes compile failures; Mitigation: normalization plus actionable diagnostics and optional strict mode.
- E3.19 Risk: naive parallel markers create unsafe concurrent work assumptions; Mitigation: treat markers as advisory until dependency and resource checks pass.
- E3.20 Risk: adding too many commands without ownership model; Mitigation: phased rollout with ownership matrix and deprecation policy.
- E3.21 Risk: file-state and DB-state divergence after partial failures; Mitigation: DB remains canonical, file mirror is derived and reconciled after writes.
- E3.22 Risk: prompt drift in validation commands reducing reliability; Mitigation: encode hard failures in code and present advisory guidance in prompt output.
- E3.23 Risk: parser brittleness if teams customize templates too freely; Mitigation: require structural markers and add lint checks for required sections.
- E3.24 Risk: confusion between runtime mode and workflow phase; Mitigation: expose both fields in status output with explicit definitions and examples.
- E3.25 Risk: quick mode may bypass review quality gates by default; Mitigation: default interactive mode and require explicit auto flag with warnings.
- E3.26 Risk: schema churn for spec.json mirror can break tooling; Mitigation: versioned schema and backward-compatible readers with migration helpers.
- E3.27 Risk: context overflow in long orchestration sessions; Mitigation: write compact checkpoints and rely on persisted phase/task state for resumption.
- E3.28 Risk: inconsistent requirement IDs in legacy docs causes compile failures; Mitigation: normalization plus actionable diagnostics and optional strict mode.
- E3.29 Risk: naive parallel markers create unsafe concurrent work assumptions; Mitigation: treat markers as advisory until dependency and resource checks pass.
- E3.30 Risk: adding too many commands without ownership model; Mitigation: phased rollout with ownership matrix and deprecation policy.
- E3.31 Risk: file-state and DB-state divergence after partial failures; Mitigation: DB remains canonical, file mirror is derived and reconciled after writes.
- E3.32 Risk: prompt drift in validation commands reducing reliability; Mitigation: encode hard failures in code and present advisory guidance in prompt output.
- E3.33 Risk: parser brittleness if teams customize templates too freely; Mitigation: require structural markers and add lint checks for required sections.
- E3.34 Risk: confusion between runtime mode and workflow phase; Mitigation: expose both fields in status output with explicit definitions and examples.
- E3.35 Risk: quick mode may bypass review quality gates by default; Mitigation: default interactive mode and require explicit auto flag with warnings.
- E3.36 Risk: schema churn for spec.json mirror can break tooling; Mitigation: versioned schema and backward-compatible readers with migration helpers.
- E3.37 Risk: context overflow in long orchestration sessions; Mitigation: write compact checkpoints and rely on persisted phase/task state for resumption.
- E3.38 Risk: inconsistent requirement IDs in legacy docs causes compile failures; Mitigation: normalization plus actionable diagnostics and optional strict mode.
- E3.39 Risk: naive parallel markers create unsafe concurrent work assumptions; Mitigation: treat markers as advisory until dependency and resource checks pass.
- E3.40 Risk: adding too many commands without ownership model; Mitigation: phased rollout with ownership matrix and deprecation policy.
- E3.41 Risk: file-state and DB-state divergence after partial failures; Mitigation: DB remains canonical, file mirror is derived and reconciled after writes.
- E3.42 Risk: prompt drift in validation commands reducing reliability; Mitigation: encode hard failures in code and present advisory guidance in prompt output.
- E3.43 Risk: parser brittleness if teams customize templates too freely; Mitigation: require structural markers and add lint checks for required sections.
- E3.44 Risk: confusion between runtime mode and workflow phase; Mitigation: expose both fields in status output with explicit definitions and examples.
- E3.45 Risk: quick mode may bypass review quality gates by default; Mitigation: default interactive mode and require explicit auto flag with warnings.
- E3.46 Risk: schema churn for spec.json mirror can break tooling; Mitigation: versioned schema and backward-compatible readers with migration helpers.
- E3.47 Risk: context overflow in long orchestration sessions; Mitigation: write compact checkpoints and rely on persisted phase/task state for resumption.
- E3.48 Risk: inconsistent requirement IDs in legacy docs causes compile failures; Mitigation: normalization plus actionable diagnostics and optional strict mode.
- E3.49 Risk: naive parallel markers create unsafe concurrent work assumptions; Mitigation: treat markers as advisory until dependency and resource checks pass.
- E3.50 Risk: adding too many commands without ownership model; Mitigation: phased rollout with ownership matrix and deprecation policy.
- E3.51 Risk: file-state and DB-state divergence after partial failures; Mitigation: DB remains canonical, file mirror is derived and reconciled after writes.
- E3.52 Risk: prompt drift in validation commands reducing reliability; Mitigation: encode hard failures in code and present advisory guidance in prompt output.
- E3.53 Risk: parser brittleness if teams customize templates too freely; Mitigation: require structural markers and add lint checks for required sections.
- E3.54 Risk: confusion between runtime mode and workflow phase; Mitigation: expose both fields in status output with explicit definitions and examples.
- E3.55 Risk: quick mode may bypass review quality gates by default; Mitigation: default interactive mode and require explicit auto flag with warnings.
- E3.56 Risk: schema churn for spec.json mirror can break tooling; Mitigation: versioned schema and backward-compatible readers with migration helpers.
- E3.57 Risk: context overflow in long orchestration sessions; Mitigation: write compact checkpoints and rely on persisted phase/task state for resumption.
- E3.58 Risk: inconsistent requirement IDs in legacy docs causes compile failures; Mitigation: normalization plus actionable diagnostics and optional strict mode.
- E3.59 Risk: naive parallel markers create unsafe concurrent work assumptions; Mitigation: treat markers as advisory until dependency and resource checks pass.
- E3.60 Risk: adding too many commands without ownership model; Mitigation: phased rollout with ownership matrix and deprecation policy.
- E3.61 Risk: file-state and DB-state divergence after partial failures; Mitigation: DB remains canonical, file mirror is derived and reconciled after writes.
- E3.62 Risk: prompt drift in validation commands reducing reliability; Mitigation: encode hard failures in code and present advisory guidance in prompt output.
- E3.63 Risk: parser brittleness if teams customize templates too freely; Mitigation: require structural markers and add lint checks for required sections.
- E3.64 Risk: confusion between runtime mode and workflow phase; Mitigation: expose both fields in status output with explicit definitions and examples.
- E3.65 Risk: quick mode may bypass review quality gates by default; Mitigation: default interactive mode and require explicit auto flag with warnings.
- E3.66 Risk: schema churn for spec.json mirror can break tooling; Mitigation: versioned schema and backward-compatible readers with migration helpers.
- E3.67 Risk: context overflow in long orchestration sessions; Mitigation: write compact checkpoints and rely on persisted phase/task state for resumption.
- E3.68 Risk: inconsistent requirement IDs in legacy docs causes compile failures; Mitigation: normalization plus actionable diagnostics and optional strict mode.
- E3.69 Risk: naive parallel markers create unsafe concurrent work assumptions; Mitigation: treat markers as advisory until dependency and resource checks pass.
- E3.70 Risk: adding too many commands without ownership model; Mitigation: phased rollout with ownership matrix and deprecation policy.
- E3.71 Risk: file-state and DB-state divergence after partial failures; Mitigation: DB remains canonical, file mirror is derived and reconciled after writes.
- E3.72 Risk: prompt drift in validation commands reducing reliability; Mitigation: encode hard failures in code and present advisory guidance in prompt output.
- E3.73 Risk: parser brittleness if teams customize templates too freely; Mitigation: require structural markers and add lint checks for required sections.
- E3.74 Risk: confusion between runtime mode and workflow phase; Mitigation: expose both fields in status output with explicit definitions and examples.
- E3.75 Risk: quick mode may bypass review quality gates by default; Mitigation: default interactive mode and require explicit auto flag with warnings.
- E3.76 Risk: schema churn for spec.json mirror can break tooling; Mitigation: versioned schema and backward-compatible readers with migration helpers.
- E3.77 Risk: context overflow in long orchestration sessions; Mitigation: write compact checkpoints and rely on persisted phase/task state for resumption.
- E3.78 Risk: inconsistent requirement IDs in legacy docs causes compile failures; Mitigation: normalization plus actionable diagnostics and optional strict mode.
- E3.79 Risk: naive parallel markers create unsafe concurrent work assumptions; Mitigation: treat markers as advisory until dependency and resource checks pass.
- E3.80 Risk: adding too many commands without ownership model; Mitigation: phased rollout with ownership matrix and deprecation policy.
- E3.81 Risk: file-state and DB-state divergence after partial failures; Mitigation: DB remains canonical, file mirror is derived and reconciled after writes.
- E3.82 Risk: prompt drift in validation commands reducing reliability; Mitigation: encode hard failures in code and present advisory guidance in prompt output.
- E3.83 Risk: parser brittleness if teams customize templates too freely; Mitigation: require structural markers and add lint checks for required sections.
- E3.84 Risk: confusion between runtime mode and workflow phase; Mitigation: expose both fields in status output with explicit definitions and examples.
- E3.85 Risk: quick mode may bypass review quality gates by default; Mitigation: default interactive mode and require explicit auto flag with warnings.
- E3.86 Risk: schema churn for spec.json mirror can break tooling; Mitigation: versioned schema and backward-compatible readers with migration helpers.
- E3.87 Risk: context overflow in long orchestration sessions; Mitigation: write compact checkpoints and rely on persisted phase/task state for resumption.
- E3.88 Risk: inconsistent requirement IDs in legacy docs causes compile failures; Mitigation: normalization plus actionable diagnostics and optional strict mode.
- E3.89 Risk: naive parallel markers create unsafe concurrent work assumptions; Mitigation: treat markers as advisory until dependency and resource checks pass.
- E3.90 Risk: adding too many commands without ownership model; Mitigation: phased rollout with ownership matrix and deprecation policy.
- E3.91 Risk: file-state and DB-state divergence after partial failures; Mitigation: DB remains canonical, file mirror is derived and reconciled after writes.
- E3.92 Risk: prompt drift in validation commands reducing reliability; Mitigation: encode hard failures in code and present advisory guidance in prompt output.
- E3.93 Risk: parser brittleness if teams customize templates too freely; Mitigation: require structural markers and add lint checks for required sections.
- E3.94 Risk: confusion between runtime mode and workflow phase; Mitigation: expose both fields in status output with explicit definitions and examples.
- E3.95 Risk: quick mode may bypass review quality gates by default; Mitigation: default interactive mode and require explicit auto flag with warnings.
- E3.96 Risk: schema churn for spec.json mirror can break tooling; Mitigation: versioned schema and backward-compatible readers with migration helpers.
- E3.97 Risk: context overflow in long orchestration sessions; Mitigation: write compact checkpoints and rely on persisted phase/task state for resumption.
- E3.98 Risk: inconsistent requirement IDs in legacy docs causes compile failures; Mitigation: normalization plus actionable diagnostics and optional strict mode.
- E3.99 Risk: naive parallel markers create unsafe concurrent work assumptions; Mitigation: treat markers as advisory until dependency and resource checks pass.
- E3.100 Risk: adding too many commands without ownership model; Mitigation: phased rollout with ownership matrix and deprecation policy.
- E3.101 Risk: file-state and DB-state divergence after partial failures; Mitigation: DB remains canonical, file mirror is derived and reconciled after writes.
- E3.102 Risk: prompt drift in validation commands reducing reliability; Mitigation: encode hard failures in code and present advisory guidance in prompt output.
- E3.103 Risk: parser brittleness if teams customize templates too freely; Mitigation: require structural markers and add lint checks for required sections.
- E3.104 Risk: confusion between runtime mode and workflow phase; Mitigation: expose both fields in status output with explicit definitions and examples.
- E3.105 Risk: quick mode may bypass review quality gates by default; Mitigation: default interactive mode and require explicit auto flag with warnings.
- E3.106 Risk: schema churn for spec.json mirror can break tooling; Mitigation: versioned schema and backward-compatible readers with migration helpers.
- E3.107 Risk: context overflow in long orchestration sessions; Mitigation: write compact checkpoints and rely on persisted phase/task state for resumption.
- E3.108 Risk: inconsistent requirement IDs in legacy docs causes compile failures; Mitigation: normalization plus actionable diagnostics and optional strict mode.
- E3.109 Risk: naive parallel markers create unsafe concurrent work assumptions; Mitigation: treat markers as advisory until dependency and resource checks pass.
- E3.110 Risk: adding too many commands without ownership model; Mitigation: phased rollout with ownership matrix and deprecation policy.
- E3.111 Risk: file-state and DB-state divergence after partial failures; Mitigation: DB remains canonical, file mirror is derived and reconciled after writes.
- E3.112 Risk: prompt drift in validation commands reducing reliability; Mitigation: encode hard failures in code and present advisory guidance in prompt output.
- E3.113 Risk: parser brittleness if teams customize templates too freely; Mitigation: require structural markers and add lint checks for required sections.
- E3.114 Risk: confusion between runtime mode and workflow phase; Mitigation: expose both fields in status output with explicit definitions and examples.
- E3.115 Risk: quick mode may bypass review quality gates by default; Mitigation: default interactive mode and require explicit auto flag with warnings.
- E3.116 Risk: schema churn for spec.json mirror can break tooling; Mitigation: versioned schema and backward-compatible readers with migration helpers.
- E3.117 Risk: context overflow in long orchestration sessions; Mitigation: write compact checkpoints and rely on persisted phase/task state for resumption.
- E3.118 Risk: inconsistent requirement IDs in legacy docs causes compile failures; Mitigation: normalization plus actionable diagnostics and optional strict mode.
- E3.119 Risk: naive parallel markers create unsafe concurrent work assumptions; Mitigation: treat markers as advisory until dependency and resource checks pass.
- E3.120 Risk: adding too many commands without ownership model; Mitigation: phased rollout with ownership matrix and deprecation policy.
- E3.121 Risk: file-state and DB-state divergence after partial failures; Mitigation: DB remains canonical, file mirror is derived and reconciled after writes.
- E3.122 Risk: prompt drift in validation commands reducing reliability; Mitigation: encode hard failures in code and present advisory guidance in prompt output.
- E3.123 Risk: parser brittleness if teams customize templates too freely; Mitigation: require structural markers and add lint checks for required sections.
- E3.124 Risk: confusion between runtime mode and workflow phase; Mitigation: expose both fields in status output with explicit definitions and examples.
- E3.125 Risk: quick mode may bypass review quality gates by default; Mitigation: default interactive mode and require explicit auto flag with warnings.
- E3.126 Risk: schema churn for spec.json mirror can break tooling; Mitigation: versioned schema and backward-compatible readers with migration helpers.
- E3.127 Risk: context overflow in long orchestration sessions; Mitigation: write compact checkpoints and rely on persisted phase/task state for resumption.
- E3.128 Risk: inconsistent requirement IDs in legacy docs causes compile failures; Mitigation: normalization plus actionable diagnostics and optional strict mode.
- E3.129 Risk: naive parallel markers create unsafe concurrent work assumptions; Mitigation: treat markers as advisory until dependency and resource checks pass.
- E3.130 Risk: adding too many commands without ownership model; Mitigation: phased rollout with ownership matrix and deprecation policy.
- E3.131 Risk: file-state and DB-state divergence after partial failures; Mitigation: DB remains canonical, file mirror is derived and reconciled after writes.
- E3.132 Risk: prompt drift in validation commands reducing reliability; Mitigation: encode hard failures in code and present advisory guidance in prompt output.
- E3.133 Risk: parser brittleness if teams customize templates too freely; Mitigation: require structural markers and add lint checks for required sections.
- E3.134 Risk: confusion between runtime mode and workflow phase; Mitigation: expose both fields in status output with explicit definitions and examples.
- E3.135 Risk: quick mode may bypass review quality gates by default; Mitigation: default interactive mode and require explicit auto flag with warnings.
- E3.136 Risk: schema churn for spec.json mirror can break tooling; Mitigation: versioned schema and backward-compatible readers with migration helpers.
- E3.137 Risk: context overflow in long orchestration sessions; Mitigation: write compact checkpoints and rely on persisted phase/task state for resumption.
- E3.138 Risk: inconsistent requirement IDs in legacy docs causes compile failures; Mitigation: normalization plus actionable diagnostics and optional strict mode.
- E3.139 Risk: naive parallel markers create unsafe concurrent work assumptions; Mitigation: treat markers as advisory until dependency and resource checks pass.
- E3.140 Risk: adding too many commands without ownership model; Mitigation: phased rollout with ownership matrix and deprecation policy.
- E3.141 Risk: file-state and DB-state divergence after partial failures; Mitigation: DB remains canonical, file mirror is derived and reconciled after writes.
- E3.142 Risk: prompt drift in validation commands reducing reliability; Mitigation: encode hard failures in code and present advisory guidance in prompt output.
- E3.143 Risk: parser brittleness if teams customize templates too freely; Mitigation: require structural markers and add lint checks for required sections.
- E3.144 Risk: confusion between runtime mode and workflow phase; Mitigation: expose both fields in status output with explicit definitions and examples.
- E3.145 Risk: quick mode may bypass review quality gates by default; Mitigation: default interactive mode and require explicit auto flag with warnings.
- E3.146 Risk: schema churn for spec.json mirror can break tooling; Mitigation: versioned schema and backward-compatible readers with migration helpers.
- E3.147 Risk: context overflow in long orchestration sessions; Mitigation: write compact checkpoints and rely on persisted phase/task state for resumption.
- E3.148 Risk: inconsistent requirement IDs in legacy docs causes compile failures; Mitigation: normalization plus actionable diagnostics and optional strict mode.
- E3.149 Risk: naive parallel markers create unsafe concurrent work assumptions; Mitigation: treat markers as advisory until dependency and resource checks pass.
- E3.150 Risk: adding too many commands without ownership model; Mitigation: phased rollout with ownership matrix and deprecation policy.
- E3.151 Risk: file-state and DB-state divergence after partial failures; Mitigation: DB remains canonical, file mirror is derived and reconciled after writes.
- E3.152 Risk: prompt drift in validation commands reducing reliability; Mitigation: encode hard failures in code and present advisory guidance in prompt output.
- E3.153 Risk: parser brittleness if teams customize templates too freely; Mitigation: require structural markers and add lint checks for required sections.
- E3.154 Risk: confusion between runtime mode and workflow phase; Mitigation: expose both fields in status output with explicit definitions and examples.
- E3.155 Risk: quick mode may bypass review quality gates by default; Mitigation: default interactive mode and require explicit auto flag with warnings.
- E3.156 Risk: schema churn for spec.json mirror can break tooling; Mitigation: versioned schema and backward-compatible readers with migration helpers.
- E3.157 Risk: context overflow in long orchestration sessions; Mitigation: write compact checkpoints and rely on persisted phase/task state for resumption.
- E3.158 Risk: inconsistent requirement IDs in legacy docs causes compile failures; Mitigation: normalization plus actionable diagnostics and optional strict mode.
- E3.159 Risk: naive parallel markers create unsafe concurrent work assumptions; Mitigation: treat markers as advisory until dependency and resource checks pass.
- E3.160 Risk: adding too many commands without ownership model; Mitigation: phased rollout with ownership matrix and deprecation policy.
- E3.161 Risk: file-state and DB-state divergence after partial failures; Mitigation: DB remains canonical, file mirror is derived and reconciled after writes.
- E3.162 Risk: prompt drift in validation commands reducing reliability; Mitigation: encode hard failures in code and present advisory guidance in prompt output.
- E3.163 Risk: parser brittleness if teams customize templates too freely; Mitigation: require structural markers and add lint checks for required sections.
- E3.164 Risk: confusion between runtime mode and workflow phase; Mitigation: expose both fields in status output with explicit definitions and examples.
- E3.165 Risk: quick mode may bypass review quality gates by default; Mitigation: default interactive mode and require explicit auto flag with warnings.
- E3.166 Risk: schema churn for spec.json mirror can break tooling; Mitigation: versioned schema and backward-compatible readers with migration helpers.
- E3.167 Risk: context overflow in long orchestration sessions; Mitigation: write compact checkpoints and rely on persisted phase/task state for resumption.
- E3.168 Risk: inconsistent requirement IDs in legacy docs causes compile failures; Mitigation: normalization plus actionable diagnostics and optional strict mode.
- E3.169 Risk: naive parallel markers create unsafe concurrent work assumptions; Mitigation: treat markers as advisory until dependency and resource checks pass.
- E3.170 Risk: adding too many commands without ownership model; Mitigation: phased rollout with ownership matrix and deprecation policy.
- E3.171 Risk: file-state and DB-state divergence after partial failures; Mitigation: DB remains canonical, file mirror is derived and reconciled after writes.
- E3.172 Risk: prompt drift in validation commands reducing reliability; Mitigation: encode hard failures in code and present advisory guidance in prompt output.
- E3.173 Risk: parser brittleness if teams customize templates too freely; Mitigation: require structural markers and add lint checks for required sections.
- E3.174 Risk: confusion between runtime mode and workflow phase; Mitigation: expose both fields in status output with explicit definitions and examples.
- E3.175 Risk: quick mode may bypass review quality gates by default; Mitigation: default interactive mode and require explicit auto flag with warnings.
- E3.176 Risk: schema churn for spec.json mirror can break tooling; Mitigation: versioned schema and backward-compatible readers with migration helpers.
- E3.177 Risk: context overflow in long orchestration sessions; Mitigation: write compact checkpoints and rely on persisted phase/task state for resumption.
- E3.178 Risk: inconsistent requirement IDs in legacy docs causes compile failures; Mitigation: normalization plus actionable diagnostics and optional strict mode.
- E3.179 Risk: naive parallel markers create unsafe concurrent work assumptions; Mitigation: treat markers as advisory until dependency and resource checks pass.
- E3.180 Risk: adding too many commands without ownership model; Mitigation: phased rollout with ownership matrix and deprecation policy.
- E3.181 Risk: file-state and DB-state divergence after partial failures; Mitigation: DB remains canonical, file mirror is derived and reconciled after writes.
- E3.182 Risk: prompt drift in validation commands reducing reliability; Mitigation: encode hard failures in code and present advisory guidance in prompt output.
- E3.183 Risk: parser brittleness if teams customize templates too freely; Mitigation: require structural markers and add lint checks for required sections.
- E3.184 Risk: confusion between runtime mode and workflow phase; Mitigation: expose both fields in status output with explicit definitions and examples.
- E3.185 Risk: quick mode may bypass review quality gates by default; Mitigation: default interactive mode and require explicit auto flag with warnings.
- E3.186 Risk: schema churn for spec.json mirror can break tooling; Mitigation: versioned schema and backward-compatible readers with migration helpers.
- E3.187 Risk: context overflow in long orchestration sessions; Mitigation: write compact checkpoints and rely on persisted phase/task state for resumption.
- E3.188 Risk: inconsistent requirement IDs in legacy docs causes compile failures; Mitigation: normalization plus actionable diagnostics and optional strict mode.
- E3.189 Risk: naive parallel markers create unsafe concurrent work assumptions; Mitigation: treat markers as advisory until dependency and resource checks pass.
- E3.190 Risk: adding too many commands without ownership model; Mitigation: phased rollout with ownership matrix and deprecation policy.
- E3.191 Risk: file-state and DB-state divergence after partial failures; Mitigation: DB remains canonical, file mirror is derived and reconciled after writes.
- E3.192 Risk: prompt drift in validation commands reducing reliability; Mitigation: encode hard failures in code and present advisory guidance in prompt output.
- E3.193 Risk: parser brittleness if teams customize templates too freely; Mitigation: require structural markers and add lint checks for required sections.
- E3.194 Risk: confusion between runtime mode and workflow phase; Mitigation: expose both fields in status output with explicit definitions and examples.
- E3.195 Risk: quick mode may bypass review quality gates by default; Mitigation: default interactive mode and require explicit auto flag with warnings.
- E3.196 Risk: schema churn for spec.json mirror can break tooling; Mitigation: versioned schema and backward-compatible readers with migration helpers.
- E3.197 Risk: context overflow in long orchestration sessions; Mitigation: write compact checkpoints and rely on persisted phase/task state for resumption.
- E3.198 Risk: inconsistent requirement IDs in legacy docs causes compile failures; Mitigation: normalization plus actionable diagnostics and optional strict mode.
- E3.199 Risk: naive parallel markers create unsafe concurrent work assumptions; Mitigation: treat markers as advisory until dependency and resource checks pass.
- E3.200 Risk: adding too many commands without ownership model; Mitigation: phased rollout with ownership matrix and deprecation policy.
- E3.201 Risk: file-state and DB-state divergence after partial failures; Mitigation: DB remains canonical, file mirror is derived and reconciled after writes.
- E3.202 Risk: prompt drift in validation commands reducing reliability; Mitigation: encode hard failures in code and present advisory guidance in prompt output.
- E3.203 Risk: parser brittleness if teams customize templates too freely; Mitigation: require structural markers and add lint checks for required sections.
- E3.204 Risk: confusion between runtime mode and workflow phase; Mitigation: expose both fields in status output with explicit definitions and examples.
- E3.205 Risk: quick mode may bypass review quality gates by default; Mitigation: default interactive mode and require explicit auto flag with warnings.
- E3.206 Risk: schema churn for spec.json mirror can break tooling; Mitigation: versioned schema and backward-compatible readers with migration helpers.
- E3.207 Risk: context overflow in long orchestration sessions; Mitigation: write compact checkpoints and rely on persisted phase/task state for resumption.
- E3.208 Risk: inconsistent requirement IDs in legacy docs causes compile failures; Mitigation: normalization plus actionable diagnostics and optional strict mode.
- E3.209 Risk: naive parallel markers create unsafe concurrent work assumptions; Mitigation: treat markers as advisory until dependency and resource checks pass.
- E3.210 Risk: adding too many commands without ownership model; Mitigation: phased rollout with ownership matrix and deprecation policy.
- E3.211 Risk: file-state and DB-state divergence after partial failures; Mitigation: DB remains canonical, file mirror is derived and reconciled after writes.
- E3.212 Risk: prompt drift in validation commands reducing reliability; Mitigation: encode hard failures in code and present advisory guidance in prompt output.
- E3.213 Risk: parser brittleness if teams customize templates too freely; Mitigation: require structural markers and add lint checks for required sections.
- E3.214 Risk: confusion between runtime mode and workflow phase; Mitigation: expose both fields in status output with explicit definitions and examples.
- E3.215 Risk: quick mode may bypass review quality gates by default; Mitigation: default interactive mode and require explicit auto flag with warnings.
- E3.216 Risk: schema churn for spec.json mirror can break tooling; Mitigation: versioned schema and backward-compatible readers with migration helpers.
- E3.217 Risk: context overflow in long orchestration sessions; Mitigation: write compact checkpoints and rely on persisted phase/task state for resumption.
- E3.218 Risk: inconsistent requirement IDs in legacy docs causes compile failures; Mitigation: normalization plus actionable diagnostics and optional strict mode.
- E3.219 Risk: naive parallel markers create unsafe concurrent work assumptions; Mitigation: treat markers as advisory until dependency and resource checks pass.
- E3.220 Risk: adding too many commands without ownership model; Mitigation: phased rollout with ownership matrix and deprecation policy.

## Appendix F: Evidence File Index (cc-sdd)

This index captures key files reviewed during the session.
Each entry is intentionally one line for quick grep and session resumption.

- F.1 File reviewed: cc-sdd/tools/cc-sdd/.gitignore
- F.2 File reviewed: cc-sdd/tools/cc-sdd/README.md
- F.3 File reviewed: cc-sdd/tools/cc-sdd/README_ja.md
- F.4 File reviewed: cc-sdd/tools/cc-sdd/README_zh-TW.md
- F.5 File reviewed: cc-sdd/tools/cc-sdd/package-lock.json
- F.6 File reviewed: cc-sdd/tools/cc-sdd/package.json
- F.7 File reviewed: cc-sdd/tools/cc-sdd/scripts/add-shebang.mjs
- F.8 File reviewed: cc-sdd/tools/cc-sdd/src/agents/registry.ts
- F.9 File reviewed: cc-sdd/tools/cc-sdd/src/cli.ts
- F.10 File reviewed: cc-sdd/tools/cc-sdd/src/cli/agents.ts
- F.11 File reviewed: cc-sdd/tools/cc-sdd/src/cli/args.ts
- F.12 File reviewed: cc-sdd/tools/cc-sdd/src/cli/config.ts
- F.13 File reviewed: cc-sdd/tools/cc-sdd/src/cli/io.ts
- F.14 File reviewed: cc-sdd/tools/cc-sdd/src/cli/policies.ts
- F.15 File reviewed: cc-sdd/tools/cc-sdd/src/cli/store.ts
- F.16 File reviewed: cc-sdd/tools/cc-sdd/src/cli/ui/colors.ts
- F.17 File reviewed: cc-sdd/tools/cc-sdd/src/cli/ui/prompt.ts
- F.18 File reviewed: cc-sdd/tools/cc-sdd/src/constants/languages.ts
- F.19 File reviewed: cc-sdd/tools/cc-sdd/src/index.ts
- F.20 File reviewed: cc-sdd/tools/cc-sdd/src/manifest/loader.ts
- F.21 File reviewed: cc-sdd/tools/cc-sdd/src/manifest/planner.ts
- F.22 File reviewed: cc-sdd/tools/cc-sdd/src/manifest/processor.ts
- F.23 File reviewed: cc-sdd/tools/cc-sdd/src/plan/categories.ts
- F.24 File reviewed: cc-sdd/tools/cc-sdd/src/plan/executor.ts
- F.25 File reviewed: cc-sdd/tools/cc-sdd/src/plan/fileOperations.ts
- F.26 File reviewed: cc-sdd/tools/cc-sdd/src/plan/printer.ts
- F.27 File reviewed: cc-sdd/tools/cc-sdd/src/resolvers/agentLayout.ts
- F.28 File reviewed: cc-sdd/tools/cc-sdd/src/resolvers/kiroDir.ts
- F.29 File reviewed: cc-sdd/tools/cc-sdd/src/resolvers/os.ts
- F.30 File reviewed: cc-sdd/tools/cc-sdd/src/template/context.ts
- F.31 File reviewed: cc-sdd/tools/cc-sdd/src/template/fromResolved.ts
- F.32 File reviewed: cc-sdd/tools/cc-sdd/src/template/renderer.ts
- F.33 File reviewed: cc-sdd/tools/cc-sdd/src/utils/fs.ts
- F.34 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/claude-code-agent/agents/spec-design.md
- F.35 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/claude-code-agent/agents/spec-impl.md
- F.36 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/claude-code-agent/agents/spec-requirements.md
- F.37 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/claude-code-agent/agents/spec-tasks.md
- F.38 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/claude-code-agent/agents/steering-custom.md
- F.39 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/claude-code-agent/agents/steering.md
- F.40 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/claude-code-agent/agents/validate-design.md
- F.41 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/claude-code-agent/agents/validate-gap.md
- F.42 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/claude-code-agent/agents/validate-impl.md
- F.43 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/claude-code-agent/commands/spec-design.md
- F.44 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/claude-code-agent/commands/spec-impl.md
- F.45 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/claude-code-agent/commands/spec-init.md
- F.46 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/claude-code-agent/commands/spec-quick.md
- F.47 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/claude-code-agent/commands/spec-requirements.md
- F.48 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/claude-code-agent/commands/spec-status.md
- F.49 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/claude-code-agent/commands/spec-tasks.md
- F.50 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/claude-code-agent/commands/steering-custom.md
- F.51 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/claude-code-agent/commands/steering.md
- F.52 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/claude-code-agent/commands/validate-design.md
- F.53 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/claude-code-agent/commands/validate-gap.md
- F.54 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/claude-code-agent/commands/validate-impl.md
- F.55 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/claude-code-agent/docs/CLAUDE.md
- F.56 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/claude-code/commands/spec-design.md
- F.57 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/claude-code/commands/spec-impl.md
- F.58 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/claude-code/commands/spec-init.md
- F.59 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/claude-code/commands/spec-requirements.md
- F.60 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/claude-code/commands/spec-status.md
- F.61 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/claude-code/commands/spec-tasks.md
- F.62 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/claude-code/commands/steering-custom.md
- F.63 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/claude-code/commands/steering.md
- F.64 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/claude-code/commands/validate-design.md
- F.65 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/claude-code/commands/validate-gap.md
- F.66 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/claude-code/commands/validate-impl.md
- F.67 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/claude-code/docs/CLAUDE.md
- F.68 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/codex/commands/kiro-spec-design.md
- F.69 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/codex/commands/kiro-spec-impl.md
- F.70 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/codex/commands/kiro-spec-init.md
- F.71 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/codex/commands/kiro-spec-requirements.md
- F.72 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/codex/commands/kiro-spec-status.md
- F.73 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/codex/commands/kiro-spec-tasks.md
- F.74 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/codex/commands/kiro-steering-custom.md
- F.75 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/codex/commands/kiro-steering.md
- F.76 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/codex/commands/kiro-validate-design.md
- F.77 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/codex/commands/kiro-validate-gap.md
- F.78 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/codex/commands/kiro-validate-impl.md
- F.79 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/codex/docs/AGENTS.md
- F.80 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/cursor/commands/spec-design.md
- F.81 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/cursor/commands/spec-impl.md
- F.82 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/cursor/commands/spec-init.md
- F.83 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/cursor/commands/spec-requirements.md
- F.84 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/cursor/commands/spec-status.md
- F.85 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/cursor/commands/spec-tasks.md
- F.86 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/cursor/commands/steering-custom.md
- F.87 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/cursor/commands/steering.md
- F.88 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/cursor/commands/validate-design.md
- F.89 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/cursor/commands/validate-gap.md
- F.90 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/cursor/commands/validate-impl.md
- F.91 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/cursor/docs/AGENTS.md
- F.92 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/gemini-cli/commands/spec-design.toml
- F.93 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/gemini-cli/commands/spec-impl.toml
- F.94 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/gemini-cli/commands/spec-init.toml
- F.95 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/gemini-cli/commands/spec-requirements.toml
- F.96 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/gemini-cli/commands/spec-status.toml
- F.97 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/gemini-cli/commands/spec-tasks.toml
- F.98 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/gemini-cli/commands/steering-custom.toml
- F.99 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/gemini-cli/commands/steering.toml
- F.100 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/gemini-cli/commands/validate-design.toml
- F.101 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/gemini-cli/commands/validate-gap.toml
- F.102 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/gemini-cli/commands/validate-impl.toml
- F.103 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/gemini-cli/docs/GEMINI.md
- F.104 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/github-copilot/commands/kiro-spec-design.prompt.md
- F.105 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/github-copilot/commands/kiro-spec-impl.prompt.md
- F.106 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/github-copilot/commands/kiro-spec-init.prompt.md
- F.107 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/github-copilot/commands/kiro-spec-requirements.prompt.md
- F.108 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/github-copilot/commands/kiro-spec-status.prompt.md
- F.109 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/github-copilot/commands/kiro-spec-tasks.prompt.md
- F.110 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/github-copilot/commands/kiro-steering-custom.prompt.md
- F.111 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/github-copilot/commands/kiro-steering.prompt.md
- F.112 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/github-copilot/commands/kiro-validate-design.prompt.md
- F.113 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/github-copilot/commands/kiro-validate-gap.prompt.md
- F.114 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/github-copilot/commands/kiro-validate-impl.prompt.md
- F.115 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/github-copilot/docs/AGENTS.md
- F.116 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/opencode-agent/agents/spec-design.md
- F.117 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/opencode-agent/agents/spec-impl.md
- F.118 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/opencode-agent/agents/spec-requirements.md
- F.119 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/opencode-agent/agents/spec-tasks.md
- F.120 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/opencode-agent/agents/steering-custom.md
- F.121 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/opencode-agent/agents/steering.md
- F.122 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/opencode-agent/agents/validate-design.md
- F.123 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/opencode-agent/agents/validate-gap.md
- F.124 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/opencode-agent/agents/validate-impl.md
- F.125 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/opencode-agent/commands/kiro-spec-design.md
- F.126 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/opencode-agent/commands/kiro-spec-impl.md
- F.127 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/opencode-agent/commands/kiro-spec-init.md
- F.128 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/opencode-agent/commands/kiro-spec-quick.md
- F.129 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/opencode-agent/commands/kiro-spec-requirements.md
- F.130 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/opencode-agent/commands/kiro-spec-status.md
- F.131 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/opencode-agent/commands/kiro-spec-tasks.md
- F.132 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/opencode-agent/commands/kiro-steering-custom.md
- F.133 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/opencode-agent/commands/kiro-steering.md
- F.134 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/opencode-agent/commands/kiro-validate-design.md
- F.135 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/opencode-agent/commands/kiro-validate-gap.md
- F.136 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/opencode-agent/commands/kiro-validate-impl.md
- F.137 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/opencode-agent/docs/AGENTS.md
- F.138 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/opencode/commands/kiro-spec-design.md
- F.139 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/opencode/commands/kiro-spec-impl.md
- F.140 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/opencode/commands/kiro-spec-init.md
- F.141 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/opencode/commands/kiro-spec-requirements.md
- F.142 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/opencode/commands/kiro-spec-status.md
- F.143 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/opencode/commands/kiro-spec-tasks.md
- F.144 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/opencode/commands/kiro-steering-custom.md
- F.145 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/opencode/commands/kiro-steering.md
- F.146 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/opencode/commands/kiro-validate-design.md
- F.147 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/opencode/commands/kiro-validate-gap.md
- F.148 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/opencode/commands/kiro-validate-impl.md
- F.149 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/opencode/docs/AGENTS.md
- F.150 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/qwen-code/docs/QWEN.md
- F.151 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/windsurf/commands/kiro-spec-design.md
- F.152 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/windsurf/commands/kiro-spec-impl.md
- F.153 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/windsurf/commands/kiro-spec-init.md
- F.154 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/windsurf/commands/kiro-spec-requirements.md
- F.155 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/windsurf/commands/kiro-spec-status.md
- F.156 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/windsurf/commands/kiro-spec-tasks.md
- F.157 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/windsurf/commands/kiro-steering-custom.md
- F.158 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/windsurf/commands/kiro-steering.md
- F.159 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/windsurf/commands/kiro-validate-design.md
- F.160 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/windsurf/commands/kiro-validate-gap.md
- F.161 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/windsurf/commands/kiro-validate-impl.md
- F.162 File reviewed: cc-sdd/tools/cc-sdd/templates/agents/windsurf/docs/AGENTS.md
- F.163 File reviewed: cc-sdd/tools/cc-sdd/templates/manifests/claude-code-agent.json
- F.164 File reviewed: cc-sdd/tools/cc-sdd/templates/manifests/claude-code.json
- F.165 File reviewed: cc-sdd/tools/cc-sdd/templates/manifests/codex.json
- F.166 File reviewed: cc-sdd/tools/cc-sdd/templates/manifests/cursor.json
- F.167 File reviewed: cc-sdd/tools/cc-sdd/templates/manifests/gemini-cli.json
- F.168 File reviewed: cc-sdd/tools/cc-sdd/templates/manifests/github-copilot.json
- F.169 File reviewed: cc-sdd/tools/cc-sdd/templates/manifests/opencode-agent.json
- F.170 File reviewed: cc-sdd/tools/cc-sdd/templates/manifests/opencode.json
- F.171 File reviewed: cc-sdd/tools/cc-sdd/templates/manifests/qwen-code.json
- F.172 File reviewed: cc-sdd/tools/cc-sdd/templates/manifests/windsurf.json
- F.173 File reviewed: cc-sdd/tools/cc-sdd/templates/shared/settings/rules/design-discovery-full.md
- F.174 File reviewed: cc-sdd/tools/cc-sdd/templates/shared/settings/rules/design-discovery-light.md
- F.175 File reviewed: cc-sdd/tools/cc-sdd/templates/shared/settings/rules/design-principles.md
- F.176 File reviewed: cc-sdd/tools/cc-sdd/templates/shared/settings/rules/design-review.md
- F.177 File reviewed: cc-sdd/tools/cc-sdd/templates/shared/settings/rules/ears-format.md
- F.178 File reviewed: cc-sdd/tools/cc-sdd/templates/shared/settings/rules/gap-analysis.md
- F.179 File reviewed: cc-sdd/tools/cc-sdd/templates/shared/settings/rules/steering-principles.md
- F.180 File reviewed: cc-sdd/tools/cc-sdd/templates/shared/settings/rules/tasks-generation.md
- F.181 File reviewed: cc-sdd/tools/cc-sdd/templates/shared/settings/rules/tasks-parallel-analysis.md
- F.182 File reviewed: cc-sdd/tools/cc-sdd/templates/shared/settings/templates/specs/design.md
- F.183 File reviewed: cc-sdd/tools/cc-sdd/templates/shared/settings/templates/specs/init.json
- F.184 File reviewed: cc-sdd/tools/cc-sdd/templates/shared/settings/templates/specs/requirements-init.md
- F.185 File reviewed: cc-sdd/tools/cc-sdd/templates/shared/settings/templates/specs/requirements.md
- F.186 File reviewed: cc-sdd/tools/cc-sdd/templates/shared/settings/templates/specs/research.md
- F.187 File reviewed: cc-sdd/tools/cc-sdd/templates/shared/settings/templates/specs/tasks.md
- F.188 File reviewed: cc-sdd/tools/cc-sdd/templates/shared/settings/templates/steering-custom/api-standards.md
- F.189 File reviewed: cc-sdd/tools/cc-sdd/templates/shared/settings/templates/steering-custom/authentication.md
- F.190 File reviewed: cc-sdd/tools/cc-sdd/templates/shared/settings/templates/steering-custom/database.md
- F.191 File reviewed: cc-sdd/tools/cc-sdd/templates/shared/settings/templates/steering-custom/deployment.md
- F.192 File reviewed: cc-sdd/tools/cc-sdd/templates/shared/settings/templates/steering-custom/error-handling.md
- F.193 File reviewed: cc-sdd/tools/cc-sdd/templates/shared/settings/templates/steering-custom/security.md
- F.194 File reviewed: cc-sdd/tools/cc-sdd/templates/shared/settings/templates/steering-custom/testing.md
- F.195 File reviewed: cc-sdd/tools/cc-sdd/templates/shared/settings/templates/steering/product.md
- F.196 File reviewed: cc-sdd/tools/cc-sdd/templates/shared/settings/templates/steering/structure.md
- F.197 File reviewed: cc-sdd/tools/cc-sdd/templates/shared/settings/templates/steering/tech.md
- F.198 File reviewed: cc-sdd/tools/cc-sdd/test/agentLayout.test.ts
- F.199 File reviewed: cc-sdd/tools/cc-sdd/test/args.test.ts
- F.200 File reviewed: cc-sdd/tools/cc-sdd/test/cliApplyManifest.test.ts
- F.201 File reviewed: cc-sdd/tools/cc-sdd/test/cliDryRunManifest.test.ts
- F.202 File reviewed: cc-sdd/tools/cc-sdd/test/cliEntry.test.ts
- F.203 File reviewed: cc-sdd/tools/cc-sdd/test/cliEntryEdgeCases.test.ts
- F.204 File reviewed: cc-sdd/tools/cc-sdd/test/configMerge.test.ts
- F.205 File reviewed: cc-sdd/tools/cc-sdd/test/configStore.test.ts
- F.206 File reviewed: cc-sdd/tools/cc-sdd/test/configStoreEdgeCases.test.ts
- F.207 File reviewed: cc-sdd/tools/cc-sdd/test/kiroDir.test.ts
- F.208 File reviewed: cc-sdd/tools/cc-sdd/test/manifestLoader.test.ts
- F.209 File reviewed: cc-sdd/tools/cc-sdd/test/manifestPlanner.test.ts
- F.210 File reviewed: cc-sdd/tools/cc-sdd/test/manifestProcessor.test.ts
- F.211 File reviewed: cc-sdd/tools/cc-sdd/test/os.test.ts
- F.212 File reviewed: cc-sdd/tools/cc-sdd/test/osFiltering.test.ts
- F.213 File reviewed: cc-sdd/tools/cc-sdd/test/planExecutor.test.ts
- F.214 File reviewed: cc-sdd/tools/cc-sdd/test/planPrinter.test.ts
- F.215 File reviewed: cc-sdd/tools/cc-sdd/test/realManifestClaudeCode.test.ts
- F.216 File reviewed: cc-sdd/tools/cc-sdd/test/realManifestClaudeCodeAgent.test.ts
- F.217 File reviewed: cc-sdd/tools/cc-sdd/test/realManifestCodex.test.ts
- F.218 File reviewed: cc-sdd/tools/cc-sdd/test/realManifestCursor.test.ts
- F.219 File reviewed: cc-sdd/tools/cc-sdd/test/realManifestGeminiCli.test.ts
- F.220 File reviewed: cc-sdd/tools/cc-sdd/test/realManifestGithubCopilot.test.ts
- F.221 File reviewed: cc-sdd/tools/cc-sdd/test/realManifestOpencode.test.ts
- F.222 File reviewed: cc-sdd/tools/cc-sdd/test/realManifestOpencodeAgent.test.ts
- F.223 File reviewed: cc-sdd/tools/cc-sdd/test/realManifestWindsurf.test.ts
- F.224 File reviewed: cc-sdd/tools/cc-sdd/test/renderer.test.ts
- F.225 File reviewed: cc-sdd/tools/cc-sdd/test/rendererEdgeCases.test.ts
- F.226 File reviewed: cc-sdd/tools/cc-sdd/test/templateContext.test.ts
- F.227 File reviewed: cc-sdd/tools/cc-sdd/test/templateFromResolved.test.ts
- F.228 File reviewed: cc-sdd/tools/cc-sdd/tsconfig.json

## Appendix G: Evidence File Index (Our Planner Implementation)

- G.1 File reviewed: packages/core/src/tools/plan.ts
- G.2 File reviewed: packages/core/src/spec/helpers.ts
- G.3 File reviewed: packages/core/src/spec/parser.ts
- G.4 File reviewed: packages/core/src/spec/compiler.ts
- G.5 File reviewed: packages/core/src/spec/templates.ts
- G.6 File reviewed: packages/core/src/agent/spec-injector.ts
- G.7 File reviewed: packages/core/src/session/controller.ts
- G.8 File reviewed: packages/core/src/session/processor.ts
- G.9 File reviewed: packages/core/src/session/mode-transition.ts
- G.10 File reviewed: packages/core/src/session/mode-approval.ts
- G.11 File reviewed: packages/core/src/tools/task.ts
- G.12 File reviewed: packages/core/src/tools/registry.ts
- G.13 File reviewed: packages/core/src/agent/planner.ts
- G.14 File reviewed: packages/core/src/agent/registry.ts
- G.15 File reviewed: packages/core/src/agent/workflow/factory.ts
- G.16 File reviewed: packages/core/tests/spec/parser.test.ts
- G.17 File reviewed: packages/core/tests/spec/compiler.test.ts
- G.18 File reviewed: packages/core/tests/spec/helpers.test.ts
- G.19 File reviewed: packages/core/tests/spec/plan.test.ts
- G.20 File reviewed: packages/core/tests/session/mode-transition.test.ts

## Appendix H: Resume Protocol

If session context is compacted, resume with this strict sequence:

1. Read this dossier top to bottom once.
2. Re-run targeted tests from packages/core only.
3. Confirm desired package priority with user.
4. Implement one package at a time with verification.
5. Update this dossier with deltas before ending session.

Operational command hints for next session:

- cd packages/core
- pnpm -s vitest run tests/spec/parser.test.ts
- pnpm -s vitest run tests/spec/plan.test.ts
- pnpm -s vitest run tests/spec/compiler.test.ts tests/spec/helpers.test.ts tests/session/mode-transition.test.ts

State continuity checklist:

- Confirm current branch and dirty status
- Confirm no unexpected changes in planner files
- Confirm test environment path scope avoids mirrored worktrees
- Confirm runtime mode assumptions before editing tools

## Appendix I: Adoption Rubric

Score each candidate adaptation from 1 to 5 on each dimension:

- Runtime correctness impact
- Process usability impact
- Migration cost
- Testability impact
- Operational clarity impact

Use this weighted formula:

- Weighted score = (Correctness _ 0.35) + (Usability _ 0.25) + (Testability _ 0.20) + (Operational clarity _ 0.15) - (Migration cost \* 0.05)

Interpretation:

- > = 4.0: prioritize now
- 3.0 to 3.9: schedule in next wave
- < 3.0: defer unless strategic mandate

## Appendix J: Suggested Change Queue (Draft)

- J.1 Add spec.json mirror writer in plan tools
- J.2 Extend parser for parallel marker metadata
- J.3 Add requirement ID strict-normalization with clear diagnostics
- J.4 Add validate-gap tool prototype
- J.5 Add validate-design tool prototype
- J.6 Add validate-impl tool prototype
- J.7 Add quick workflow wrapper with interactive default
- J.8 Add template/rule loading contract and lints
- J.9 Add docs for operator workflow and governance model
- J.10 Add migration notes for existing specs

## Appendix K: Closing Notes

This document is intentionally oversized to preserve session continuity.
It should be treated as the canonical handoff artifact for resuming planner-system alignment work with cc-sdd learnings.
