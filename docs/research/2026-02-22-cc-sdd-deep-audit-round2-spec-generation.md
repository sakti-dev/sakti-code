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
