# Research & Design Decisions

## Summary

- **Feature**: Spec Generation Quality & Workflow UX
- **Scope**: Brownfield extension of existing spec runtime + new conversational UX
- **Decision**: Implement parity-plus core first, then layer wizard UX on top of existing Plan/Build and part-rendering architecture

## Research Log

### Core Runtime Audit

- **Context**: Identify parity gaps against `docs/plans/2026-02-22-spec-generation-parity-plus-implementation-plan.md`.
- **Sources Consulted**:
  - `packages/core/src/spec/parser.ts`
  - `packages/core/src/spec/compiler.ts`
  - `packages/core/src/spec/helpers.ts`
  - `packages/core/src/tools/plan.ts`
  - `packages/core/src/spec/templates.ts`
- **Findings**:
  - Parser currently returns `[]` on missing `tasks.md`; strict mode path is needed.
  - Parser does not yet model `(P)` or `- [ ]*` metadata.
  - Compiler metadata currently stores slug/taskId/requirements only.
  - Compiler currently ignores unknown dependency references instead of hard-failing transition.
  - Existing templates are placeholder-centric and do not include prompt-policy wiring.
- **Implications**:
  - Need strict+safe parser APIs and deterministic validators.
  - Need metadata extension in compiler + tool/phase gate integration.

### Prompt and Validation Layer Audit

- **Context**: Ensure generated specs are constrained by reusable prompt policy and runtime checks.
- **Sources Consulted**:
  - `docs/research/2026-02-22-next-gen-spec-prompt-suite.md`
  - `docs/research/2026-02-22-cc-sdd-deep-audit-round2-spec-generation.md`
- **Findings**:
  - High-quality generation depends on layered policies (format, traceability, safety) and explicit phase prompts.
  - Prompt-only checks are insufficient; runtime validators and error codes are required.
  - Snapshot tests are needed to detect prompt truncation/drift.
- **Implications**:
  - Build prompt constants under `packages/core/src/prompts/spec/*`.
  - Add validator module and `spec-validate-*` tools with stable response contract.

### UX Architecture Audit

- **Context**: Add wizard experience without destabilizing chat pipeline.
- **Sources Consulted**:
  - `apps/desktop/src/views/workspace-view/chat-area/parts/`
  - `apps/desktop/src/views/workspace-view/chat-area/timeline/session-turn.tsx`
  - Existing Plan/Build mode controls in desktop app
- **Findings**:
  - Part registry supports incremental addition of new part types.
  - Session timeline rendering supports deterministic ordering and event callbacks.
  - Plan/Build mode already exists; wizard should orchestrate, not replace.
- **Implications**:
  - Implement `action_buttons` part type and wizard controller as additive extensions.

## Architecture Pattern Evaluation

| Option                                  | Strengths                    | Risks                               | Decision |
| --------------------------------------- | ---------------------------- | ----------------------------------- | -------- |
| Core-only parity changes, no UX         | Lower immediate risk         | Poor usability and low adoption     | Rejected |
| UX-only wizard changes                  | Better discoverability       | No deterministic quality guarantees | Rejected |
| Combined parity-plus core + additive UX | Strong quality and usability | Larger scope                        | Selected |

## Key Decisions

### Decision 1: DB-first canonical state with mirror fallback

- **Why**: Matches existing runtime design and avoids file-only drift.
- **Trade-off**: Must handle mirror-sync failure paths explicitly.

### Decision 2: Enforce hard checks in code + validator tools

- **Why**: Prevents prompt drift from weakening safety guarantees.
- **Trade-off**: Adds validation complexity and test burden.

### Decision 3: Keep slash commands and add wizard as a first-class UX layer

- **Why**: Preserves power-user workflows while enabling guided path.
- **Trade-off**: Requires clearer state synchronization between tool results and UI state.

### Decision 4: Treat `research.md` as required lifecycle artifact

- **Why**: Preserves discovery rationale and improves design quality.
- **Trade-off**: Adds one more phase artifact to maintain.

## Risks and Mitigations

1. **Scope expansion** across core + UX tracks.
   - Mitigation: phase-gated task sequencing and strict traceability matrix.
2. **State divergence** between workflow state, DB, and mirror.
   - Mitigation: DB canonical policy + reconciliation path + warning protocol.
3. **Validator brittleness** on markdown edge cases.
   - Mitigation: fixture-driven tests from real spec artifacts.
4. **UX false positives** from intent detection.
   - Mitigation: confidence threshold + config toggle + user feedback capture.

## Open Questions

1. Should low-confidence intent offer be shown as a subtle suggestion or suppressed entirely?
2. Should workflow state live in a dedicated table or session metadata blob initially?
3. What is the minimum validator set required for `spec-quick --auto` to be considered safe?

## References

- `docs/plans/2026-02-22-spec-generation-parity-plus-implementation-plan.md`
- `docs/research/2026-02-22-next-gen-spec-prompt-suite.md`
- `docs/research/2026-02-22-cc-sdd-deep-audit-round2-spec-generation.md`
- `packages/core/src/spec/parser.ts`
- `packages/core/src/spec/compiler.ts`
- `apps/desktop/src/views/workspace-view/chat-area/parts/`
