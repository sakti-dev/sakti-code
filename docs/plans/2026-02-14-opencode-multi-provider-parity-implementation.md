# OpenCode Multi-Provider Parity (Option 1) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement OpenCode-style multi-provider + multi-model integration in EkaCode (desktop + server) while preserving the existing `@ekacode/zai` SDK provider and adopting unstorage filesystem credential persistence with schema-driven APIs.

**Architecture:** Mirror OpenCode's provider model architecture in `packages/server` and expose normalized provider/model/config endpoints consumed by `apps/desktop`. Keep provider adapters server-side, with a unified model catalog pipeline (models.dev + provider enrichment + local snapshot fallback). Persist user credentials/tokens using `unstorage` `fs-lite` namespaced by profile/provider, and surface only safe auth state to desktop.

**Tech Stack:** TypeScript, Hono, Zod, OpenAPI/JSON Schema generation, Vitest, unstorage (`fs-lite`), existing EkaCode server/desktop packages, preserved `@ekacode/zai` in `packages/zai`.

---

## Scope and Constraints

- Preserve and continue supporting `packages/zai` integration as a first-class provider.
- Follow OpenCode behavior and payload shapes where practical, with explicit alignment checks each phase.
- Implement with strict TDD (red -> green -> refactor) for every behavior change.
- Ship API schemas (JSON schema/OpenAPI-compatible) for provider/auth/model endpoints.
- Add final verification gate: tests + typecheck + lint before completion.

## Reference Alignment Baseline (Read at start, then re-check each phase)

- OpenCode provider model orchestration:
  - `opencode/packages/opencode/src/provider/models.ts`
  - `opencode/packages/opencode/src/provider/provider.ts`
  - `opencode/packages/opencode/src/provider/transform.ts`
  - `opencode/packages/opencode/src/provider/auth.ts`
  - `opencode/packages/opencode/src/provider/error.ts`
- OpenCode server routes:
  - `opencode/packages/opencode/src/server/routes/provider.ts`
  - `opencode/packages/opencode/src/server/routes/config.ts`
- OpenCode app integration points:
  - `opencode/packages/app/src/lib/client.ts`
  - `opencode/packages/app/src/routes/settings/provider.tsx`
  - `opencode/packages/app/src/routes/new/index.tsx`

## Delivery Strategy

- Implement in vertical slices that are independently testable.
- After each task group: run focused tests, then commit.
- After each phase: run phase verification + OpenCode alignment checkpoint.

---

### Task 1: Establish Parity Mapping Document in Repo

**Files:**

- Create: `docs/plans/opencode-parity-mapping.md`
- Modify: `docs/plans/2026-02-14-opencode-multi-provider-parity-implementation.md`
- Test: N/A (documentation task)

**Step 1: Write failing validation test (doc presence check in CI helper, if available)**

- Add/extend lightweight test or script assertion to require parity doc exists.

**Step 2: Run check to verify it fails**

- Run: repo doc-check command or targeted script.
- Expected: fail due to missing mapping file.

**Step 3: Write minimal implementation**

- Add mapping table: OpenCode module -> EkaCode target path, behavior notes, intentional deviations.

**Step 4: Run check to verify it passes**

- Run same check; expected pass.

**Step 5: Commit**

```bash
git add docs/plans/opencode-parity-mapping.md docs/plans/2026-02-14-opencode-multi-provider-parity-implementation.md
git commit -m "docs: add opencode parity mapping baseline"
```

**OpenCode alignment checkpoint:** Verify mapping still points to current upstream source files and semantics.

---

### Task 2: Define Canonical Provider/Model/Auth Domain Schemas

**Files:**

- Create: `packages/server/src/provider/schema.ts`
- Create: `packages/server/src/provider/types.ts`
- Create: `packages/server/src/provider/__tests__/schema.test.ts`
- Modify: `packages/server/src/routes/provider.ts`
- Test: `packages/server/src/provider/__tests__/schema.test.ts`

**Step 1: Write the failing test**

- Add tests asserting Zod schemas for:
  - `ProviderDescriptor`
  - `ProviderAuthState`
  - `ModelDescriptor`
  - `ProviderConfigPayload`
- Include compatibility assertions for expected OpenCode-like fields (`id`, `name`, `env`, `api`, `models`, `auth`).

**Step 2: Run test to verify it fails**

```bash
pnpm --filter @ekacode/server vitest run packages/server/src/provider/__tests__/schema.test.ts
```

Expected: FAIL due to missing schemas/types.

**Step 3: Write minimal implementation**

- Implement Zod schemas and inferred TS types.
- Export JSON schema generators (using current project schema tooling).

**Step 4: Run test to verify it passes**

- Re-run focused test; expected PASS.

**Step 5: Commit**

```bash
git add packages/server/src/provider/schema.ts packages/server/src/provider/types.ts packages/server/src/provider/__tests__/schema.test.ts packages/server/src/routes/provider.ts
git commit -m "feat(server): add canonical provider model auth schemas"
```

**OpenCode alignment checkpoint:** Compare schema fields with OpenCode route payloads and provider object shape.

---

### Task 3: Build Provider Registry and Adapter Contract (Preserve ZAI)

**Files:**

- Create: `packages/server/src/provider/registry.ts`
- Create: `packages/server/src/provider/adapters/base.ts`
- Create: `packages/server/src/provider/adapters/zai.ts`
- Create: `packages/server/src/provider/__tests__/registry.test.ts`
- Modify: `packages/server/src/routes/provider.ts`
- Test: `packages/server/src/provider/__tests__/registry.test.ts`

**Step 1: Write the failing test**

- Test registry returns provider list with required metadata.
- Test registry includes ZAI provider from `@ekacode/zai` and does not regress existing behavior.

**Step 2: Run test to verify it fails**

```bash
pnpm --filter @ekacode/server vitest run packages/server/src/provider/__tests__/registry.test.ts
```

Expected: FAIL due to missing registry/adapters.

**Step 3: Write minimal implementation**

- Implement adapter interface (`listModels`, `getAuthState`, `setCredential`, `clearCredential`).
- Implement initial ZAI adapter wiring to existing SDK package.
- Implement registry lookup + stable provider IDs.

**Step 4: Run test to verify it passes**

- Re-run targeted tests; expected PASS.

**Step 5: Commit**

```bash
git add packages/server/src/provider/registry.ts packages/server/src/provider/adapters/base.ts packages/server/src/provider/adapters/zai.ts packages/server/src/provider/__tests__/registry.test.ts packages/server/src/routes/provider.ts
git commit -m "feat(server): add provider registry with zai adapter"
```

**OpenCode alignment checkpoint:** Match registry/provider abstraction to OpenCode `provider.ts` lifecycle patterns.

---

### Task 4: Implement Credential Storage with unstorage fs-lite

**Files:**

- Create: `packages/server/src/provider/storage.ts`
- Create: `packages/server/src/provider/__tests__/storage.test.ts`
- Modify: `packages/server/package.json`
- Modify: `packages/server/src/provider/adapters/base.ts`
- Test: `packages/server/src/provider/__tests__/storage.test.ts`

**Step 1: Write the failing test**

- Test credential save/load/delete per provider/account/profile namespace.
- Test file persistence metadata behavior and non-leakage across providers.

**Step 2: Run test to verify it fails**

```bash
pnpm --filter @ekacode/server vitest run packages/server/src/provider/__tests__/storage.test.ts
```

Expected: FAIL due to missing storage layer.

**Step 3: Write minimal implementation**

- Add `unstorage` + `unstorage/drivers/fs-lite` dependency.
- Create storage base path strategy (e.g. app data dir, provider namespace).
- Implement secure-ish envelope format with redaction-safe serialized structure.

**Step 4: Run test to verify it passes**

- Re-run targeted tests; expected PASS.

**Step 5: Commit**

```bash
git add packages/server/package.json packages/server/src/provider/storage.ts packages/server/src/provider/__tests__/storage.test.ts packages/server/src/provider/adapters/base.ts
git commit -m "feat(server): add unstorage fs-lite credential persistence"
```

**OpenCode alignment checkpoint:** Validate credential lifecycle mirrors OpenCode auth persistence semantics while using unstorage backend.

---

### Task 5: Implement Auth Flows (API Key + OAuth Scaffolding)

**Files:**

- Create: `packages/server/src/provider/auth/service.ts`
- Create: `packages/server/src/provider/auth/oauth.ts`
- Create: `packages/server/src/provider/__tests__/auth.service.test.ts`
- Modify: `packages/server/src/routes/provider.ts`
- Test: `packages/server/src/provider/__tests__/auth.service.test.ts`

**Step 1: Write the failing test**

- Tests for:
  - set/get/clear API token per provider
  - OAuth start/callback state handling scaffold
  - safe auth-state response (no secrets in payload)

**Step 2: Run test to verify it fails**

```bash
pnpm --filter @ekacode/server vitest run packages/server/src/provider/__tests__/auth.service.test.ts
```

Expected: FAIL due to missing auth service routes.

**Step 3: Write minimal implementation**

- Implement auth service using storage abstraction.
- Add provider route handlers for login/logout/state.
- Add OAuth placeholder for providers requiring browser flow (feature-flagged if needed).

**Step 4: Run test to verify it passes**

- Re-run targeted tests; expected PASS.

**Step 5: Commit**

```bash
git add packages/server/src/provider/auth/service.ts packages/server/src/provider/auth/oauth.ts packages/server/src/provider/__tests__/auth.service.test.ts packages/server/src/routes/provider.ts
git commit -m "feat(server): add provider auth service with oauth scaffolding"
```

**OpenCode alignment checkpoint:** Compare with OpenCode `provider/auth.ts` auth state transitions and route contracts.

---

### Task 6: Build Model Catalog Service (models.dev + cache + snapshot fallback)

**Files:**

- Create: `packages/server/src/provider/models/catalog.ts`
- Create: `packages/server/src/provider/models/models-dev-client.ts`
- Create: `packages/server/src/provider/models/snapshot.json`
- Create: `packages/server/src/provider/__tests__/catalog.test.ts`
- Modify: `packages/server/src/provider/registry.ts`
- Test: `packages/server/src/provider/__tests__/catalog.test.ts`

**Step 1: Write the failing test**

- Test catalog merge precedence:
  1. provider-specific enrichment
  2. models.dev data
  3. snapshot fallback
- Test normalization for aliases such as Zen/Kimi/Z.AI plan model tags.

**Step 2: Run test to verify it fails**

```bash
pnpm --filter @ekacode/server vitest run packages/server/src/provider/__tests__/catalog.test.ts
```

Expected: FAIL due to missing catalog pipeline.

**Step 3: Write minimal implementation**

- Add fetch client + caching policy + stale fallback.
- Add model normalization, capabilities mapping, default model selection rules.

**Step 4: Run test to verify it passes**

- Re-run targeted tests; expected PASS.

**Step 5: Commit**

```bash
git add packages/server/src/provider/models/catalog.ts packages/server/src/provider/models/models-dev-client.ts packages/server/src/provider/models/snapshot.json packages/server/src/provider/__tests__/catalog.test.ts packages/server/src/provider/registry.ts
git commit -m "feat(server): add models catalog with models.dev and snapshot fallback"
```

**OpenCode alignment checkpoint:** Reconcile catalog transformation behavior with OpenCode `models.ts` and `transform.ts`.

---

### Task 7: Expand Provider Routes to Full Contract + JSON Schema Export

**Files:**

- Modify: `packages/server/src/routes/provider.ts`
- Create: `packages/server/src/routes/__tests__/provider.routes.test.ts`
- Create: `packages/server/src/routes/provider.openapi.ts`
- Modify: `packages/server/src/index.ts`
- Test: `packages/server/src/routes/__tests__/provider.routes.test.ts`

**Step 1: Write the failing test**

- Route tests for:
  - `GET /provider` list providers
  - `GET /provider/models` merged model catalog
  - `POST /provider/:id/auth/token`
  - `DELETE /provider/:id/auth/token`
  - OAuth route stubs
- Schema endpoint/assertions for route request/response shapes.

**Step 2: Run test to verify it fails**

```bash
pnpm --filter @ekacode/server vitest run packages/server/src/routes/__tests__/provider.routes.test.ts
```

Expected: FAIL for missing/placeholder behavior.

**Step 3: Write minimal implementation**

- Wire registry/auth/catalog services into route handlers.
- Add schema generation/registration module.

**Step 4: Run test to verify it passes**

- Re-run targeted tests; expected PASS.

**Step 5: Commit**

```bash
git add packages/server/src/routes/provider.ts packages/server/src/routes/__tests__/provider.routes.test.ts packages/server/src/routes/provider.openapi.ts packages/server/src/index.ts
git commit -m "feat(server): implement provider routes and json schema exports"
```

**OpenCode alignment checkpoint:** Validate route names and response payload parity with OpenCode provider/config routes.

---

### Task 8: Integrate Provider Selection into Chat Execution Path

**Files:**

- Modify: `packages/server/src/routes/chat.ts`
- Create: `packages/server/src/provider/runtime.ts`
- Create: `packages/server/src/routes/__tests__/chat-provider-selection.test.ts`
- Test: `packages/server/src/routes/__tests__/chat-provider-selection.test.ts`

**Step 1: Write the failing test**

- Test chat request can select provider + model.
- Test auth guard errors when provider is configured but unauthenticated.
- Test fallback/default provider behavior remains backward compatible.

**Step 2: Run test to verify it fails**

```bash
pnpm --filter @ekacode/server vitest run packages/server/src/routes/__tests__/chat-provider-selection.test.ts
```

Expected: FAIL for missing runtime routing.

**Step 3: Write minimal implementation**

- Add provider runtime resolver in chat route.
- Preserve existing ZAI default flow for existing clients.

**Step 4: Run test to verify it passes**

- Re-run targeted tests; expected PASS.

**Step 5: Commit**

```bash
git add packages/server/src/routes/chat.ts packages/server/src/provider/runtime.ts packages/server/src/routes/__tests__/chat-provider-selection.test.ts
git commit -m "feat(server): route chat generation through provider runtime"
```

**OpenCode alignment checkpoint:** Compare runtime provider invocation and defaulting behavior with OpenCode chat/provider wiring.

---

### Task 9: Desktop API Client Expansion for Provider/Auth/Models

**Files:**

- Modify: `apps/desktop/src/core/services/api/api-client.ts`
- Modify: `apps/desktop/src/core/services/api/sdk-client.ts`
- Create: `apps/desktop/src/core/services/api/provider-client.ts`
- Create: `apps/desktop/src/core/services/api/__tests__/provider-client.test.ts`
- Test: `apps/desktop/src/core/services/api/__tests__/provider-client.test.ts`

**Step 1: Write the failing test**

- Tests for typed calls to provider endpoints and response parsing.
- Tests for schema compatibility (breaking-change guard).

**Step 2: Run test to verify it fails**

```bash
pnpm --filter @ekacode/desktop vitest run apps/desktop/src/core/services/api/__tests__/provider-client.test.ts
```

Expected: FAIL due to missing provider client.

**Step 3: Write minimal implementation**

- Add provider client wrapper and typed DTO mapping.
- Keep existing API behavior untouched.

**Step 4: Run test to verify it passes**

- Re-run targeted tests; expected PASS.

**Step 5: Commit**

```bash
git add apps/desktop/src/core/services/api/api-client.ts apps/desktop/src/core/services/api/sdk-client.ts apps/desktop/src/core/services/api/provider-client.ts apps/desktop/src/core/services/api/__tests__/provider-client.test.ts
git commit -m "feat(desktop): add typed provider api client"
```

**OpenCode alignment checkpoint:** Compare desktop client call patterns with OpenCode app client utilities.

---

### Task 10: Desktop Settings UI for Provider Login and Model Selection

**Files:**

- Modify: `apps/desktop/src/views/settings-view.tsx`
- Create: `apps/desktop/src/views/components/provider-settings.tsx`
- Create: `apps/desktop/src/views/components/model-selector.tsx`
- Create: `apps/desktop/src/views/__tests__/provider-settings.test.tsx`
- Test: `apps/desktop/src/views/__tests__/provider-settings.test.tsx`

**Step 1: Write the failing test**

- UI tests for:
  - provider list rendering
  - token/OAuth connect flows
  - model dropdown grouped by provider
  - auth-state indicators without leaking secrets

**Step 2: Run test to verify it fails**

```bash
pnpm --filter @ekacode/desktop vitest run apps/desktop/src/views/__tests__/provider-settings.test.tsx
```

Expected: FAIL due to missing UI modules.

**Step 3: Write minimal implementation**

- Implement settings components.
- Wire provider client actions to buttons/forms.
- Preserve existing style and view structure.

**Step 4: Run test to verify it passes**

- Re-run targeted tests; expected PASS.

**Step 5: Commit**

```bash
git add apps/desktop/src/views/settings-view.tsx apps/desktop/src/views/components/provider-settings.tsx apps/desktop/src/views/components/model-selector.tsx apps/desktop/src/views/__tests__/provider-settings.test.tsx
git commit -m "feat(desktop): add provider auth and model selection settings"
```

**OpenCode alignment checkpoint:** Check UX flow alignment with OpenCode settings/provider pages.

---

### Task 11: Persist Desktop Preferences for Selected Provider/Model

**Files:**

- Modify: `apps/desktop/src/core/store/*` (exact existing store file)
- Create: `apps/desktop/src/core/store/__tests__/provider-preferences.test.ts`
- Modify: `apps/desktop/src/views/components/model-selector.tsx`
- Test: `apps/desktop/src/core/store/__tests__/provider-preferences.test.ts`

**Step 1: Write the failing test**

- Test selected provider/model persists across app restart semantics.
- Test invalid/stale model IDs self-heal to default.

**Step 2: Run test to verify it fails**

```bash
pnpm --filter @ekacode/desktop vitest run apps/desktop/src/core/store/__tests__/provider-preferences.test.ts
```

Expected: FAIL due to missing persistence wiring.

**Step 3: Write minimal implementation**

- Add preference state + migration fallback.
- Integrate with model selector and chat request payload.

**Step 4: Run test to verify it passes**

- Re-run targeted tests; expected PASS.

**Step 5: Commit**

```bash
git add apps/desktop/src/core/store apps/desktop/src/core/store/__tests__/provider-preferences.test.ts apps/desktop/src/views/components/model-selector.tsx
git commit -m "feat(desktop): persist selected provider and model preferences"
```

**OpenCode alignment checkpoint:** Validate preference/default strategy against OpenCode new-chat and settings defaults.

---

### Task 12: Provider-Specific Capability Flags and UI Guardrails

**Files:**

- Create: `packages/server/src/provider/capabilities.ts`
- Modify: `packages/server/src/provider/models/catalog.ts`
- Modify: `apps/desktop/src/views/components/model-selector.tsx`
- Create: `packages/server/src/provider/__tests__/capabilities.test.ts`
- Test: `packages/server/src/provider/__tests__/capabilities.test.ts`

**Step 1: Write the failing test**

- Test capability flags (vision/tools/reasoning/plan-mode/etc.) for representative providers/models.
- UI tests assert unsupported options are disabled/annotated.

**Step 2: Run test to verify it fails**

```bash
pnpm --filter @ekacode/server vitest run packages/server/src/provider/__tests__/capabilities.test.ts
```

Expected: FAIL due to missing capability map.

**Step 3: Write minimal implementation**

- Implement capability inference and explicit overrides.
- Expose to desktop in model metadata.

**Step 4: Run test to verify it passes**

- Re-run targeted tests; expected PASS.

**Step 5: Commit**

```bash
git add packages/server/src/provider/capabilities.ts packages/server/src/provider/models/catalog.ts apps/desktop/src/views/components/model-selector.tsx packages/server/src/provider/__tests__/capabilities.test.ts
git commit -m "feat: expose provider model capabilities and ui guardrails"
```

**OpenCode alignment checkpoint:** Confirm capabilities semantics align with OpenCode provider/model metadata.

---

### Task 13: Error Normalization and User-Facing Auth/Provider Errors

**Files:**

- Create: `packages/server/src/provider/errors.ts`
- Modify: `packages/server/src/routes/provider.ts`
- Modify: `packages/server/src/routes/chat.ts`
- Create: `packages/server/src/provider/__tests__/errors.test.ts`
- Test: `packages/server/src/provider/__tests__/errors.test.ts`

**Step 1: Write the failing test**

- Assert normalized error codes/messages for auth failure, quota, invalid model, provider unavailable.

**Step 2: Run test to verify it fails**

```bash
pnpm --filter @ekacode/server vitest run packages/server/src/provider/__tests__/errors.test.ts
```

Expected: FAIL due to unnormalized errors.

**Step 3: Write minimal implementation**

- Add error translation helpers and apply across provider/chat routes.

**Step 4: Run test to verify it passes**

- Re-run targeted tests; expected PASS.

**Step 5: Commit**

```bash
git add packages/server/src/provider/errors.ts packages/server/src/routes/provider.ts packages/server/src/routes/chat.ts packages/server/src/provider/__tests__/errors.test.ts
git commit -m "feat(server): normalize provider and auth errors"
```

**OpenCode alignment checkpoint:** Verify error shape and code mapping against OpenCode `error.ts` conventions.

---

### Task 14: JSON Schema/OpenAPI Contract Artifacts and Drift Tests

**Files:**

- Create: `packages/server/src/schema/provider.schemas.json`
- Create: `packages/server/src/schema/__tests__/provider-schema-drift.test.ts`
- Modify: `packages/server/src/routes/provider.openapi.ts`
- Modify: `packages/server/package.json` (schema generation script)
- Test: `packages/server/src/schema/__tests__/provider-schema-drift.test.ts`

**Step 1: Write the failing test**

- Contract drift test: generated schemas must match committed schema artifact.

**Step 2: Run test to verify it fails**

```bash
pnpm --filter @ekacode/server vitest run packages/server/src/schema/__tests__/provider-schema-drift.test.ts
```

Expected: FAIL before artifact generation.

**Step 3: Write minimal implementation**

- Add schema generation script and produce artifact.
- Wire route schemas to generator source.

**Step 4: Run test to verify it passes**

- Re-run targeted tests; expected PASS.

**Step 5: Commit**

```bash
git add packages/server/src/schema/provider.schemas.json packages/server/src/schema/__tests__/provider-schema-drift.test.ts packages/server/src/routes/provider.openapi.ts packages/server/package.json
git commit -m "feat(server): add provider json schema artifacts and drift test"
```

**OpenCode alignment checkpoint:** Ensure exported schema covers parity-required fields with OpenCode route payloads.

---

### Task 15: End-to-End Integration Tests (Server + Desktop contract)

**Files:**

- Create: `packages/server/src/routes/__tests__/provider-e2e.test.ts`
- Create: `apps/desktop/src/core/services/api/__tests__/provider-contract.e2e.test.ts`
- Modify: test setup files as needed
- Test: the two new e2e-style tests

**Step 1: Write the failing test**

- Add integration tests for full flow:
  - list providers -> authenticate -> list models -> select model -> chat request uses model/provider.

**Step 2: Run test to verify it fails**

```bash
pnpm --filter @ekacode/server vitest run packages/server/src/routes/__tests__/provider-e2e.test.ts
pnpm --filter @ekacode/desktop vitest run apps/desktop/src/core/services/api/__tests__/provider-contract.e2e.test.ts
```

Expected: FAIL until full wiring is done.

**Step 3: Write minimal implementation**

- Fill missing glue logic uncovered by integration failures.

**Step 4: Run test to verify it passes**

- Re-run integration tests; expected PASS.

**Step 5: Commit**

```bash
git add packages/server/src/routes/__tests__/provider-e2e.test.ts apps/desktop/src/core/services/api/__tests__/provider-contract.e2e.test.ts
git commit -m "test: add multi-provider integration flow coverage"
```

**OpenCode alignment checkpoint:** Compare full flow behavior with OpenCode desktop + server end-user flow.

---

### Task 16: Documentation and Operational Notes

**Files:**

- Create: `docs/providers/README.md`
- Create: `docs/providers/credential-storage.md`
- Modify: `README.md`
- Test: N/A (documentation)

**Step 1: Write failing docs check (if present)**

- Ensure docs lint/check detects missing provider docs references.

**Step 2: Run docs check to verify it fails**

- Run docs lint command.

**Step 3: Write minimal implementation**

- Document:
  - provider onboarding flow
  - credential storage path and key naming
  - security caveats and migration notes
  - how to add a new provider adapter

**Step 4: Run docs check to verify it passes**

- Re-run docs lint/check.

**Step 5: Commit**

```bash
git add docs/providers/README.md docs/providers/credential-storage.md README.md
git commit -m "docs: add multi-provider integration and credential storage guide"
```

**OpenCode alignment checkpoint:** Verify docs truthfully reflect OpenCode-inspired behavior and known deviations.

---

## Phase Gates (Must Pass Before Next Phase)

### Gate A (after Task 4)

- Server unit tests for schema/registry/storage/auth foundations pass.
- ZAI provider remains functional in existing chat path tests.

### Gate B (after Task 8)

- Provider routes and chat runtime provider selection pass end-to-end in server tests.
- JSON schema generation works and is versioned.

### Gate C (after Task 12)

- Desktop settings and selection behavior pass UI/API tests.
- Preferences persist correctly and fallback logic works.

### Gate D (after Task 15)

- Full integration flow passes for at least:
  - ZAI preserved provider path
  - one API-token provider
  - one OAuth-enabled provider (can be scaffolded/test-double).

---

## Mandatory Final Verification (Before Claiming Completion)

Run all verification commands and capture outputs in final report:

```bash
pnpm --filter @ekacode/server test
pnpm --filter @ekacode/desktop test
pnpm --filter @ekacode/core test

pnpm --filter @ekacode/server typecheck
pnpm --filter @ekacode/desktop typecheck
pnpm --filter @ekacode/core typecheck

pnpm --filter @ekacode/server lint
pnpm --filter @ekacode/desktop lint
pnpm --filter @ekacode/core lint
```

If any fail:

- Fix in smallest possible change.
- Re-run only failing command first, then full verification set.

---

## Risk Register and Mitigations

- Risk: Provider payload drift from OpenCode after upstream changes.
  - Mitigation: parity mapping doc + schema drift tests + per-phase alignment checkpoint.
- Risk: Credential leakage in logs/responses.
  - Mitigation: explicit redaction tests + response schema excludes sensitive fields.
- Risk: models.dev availability/network instability.
  - Mitigation: cached responses + checked-in snapshot fallback + stale-while-revalidate policy.
- Risk: Regression to existing ZAI-only flows.
  - Mitigation: preserve default path tests and add explicit compatibility integration tests.

## Non-Goals (for this implementation cycle)

- Migrating provider execution into desktop process.
- Adding every niche provider at first delivery; focus on framework and key exemplars.
- Rewriting existing chat architecture beyond provider/model routing seams.

## Definition of Done

- Multi-provider registry implemented in server with preserved ZAI provider.
- Auth persistence implemented via unstorage `fs-lite` and covered by tests.
- Provider/model endpoints exposed with schema artifacts and drift tests.
- Desktop can authenticate providers, view models, select provider/model, and persist choice.
- Chat route uses selected provider/model with compatibility fallback.
- Full tests, typecheck, lint all pass.
- Documentation updated with operational guidance and OpenCode alignment notes.
