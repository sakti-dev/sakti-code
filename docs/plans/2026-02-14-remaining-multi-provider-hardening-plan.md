# Remaining Multi-Provider Hardening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Complete all remaining work for the OpenCode-style multi-provider rollout: full test gates, concrete additional provider adapters, guaranteed chat-composer provider/model wiring, stronger schema generation, and merge-ready branch completion.

**Architecture:** Keep the existing provider runtime as the single integration point (`registry` + `auth` + `catalog`). Add provider adapters incrementally behind the same contract, wire desktop selection into outbound chat payload, and tighten API contracts with generated schema artifacts + drift tests.

**Tech Stack:** TypeScript, Vitest, Hono, Zod, unstorage fs-lite, SolidJS desktop, pnpm workspace tooling.

---

### Task 1: Establish Baseline Full-Test Matrix

**Files:**

- Modify: `docs/providers/README.md`
- Create: `docs/providers/test-matrix.md`

**Step 1: Write failing check**

- Add a test-matrix doc assertion entry (if doc checks exist) or start with an empty matrix section.

**Step 2: Run baseline full tests (record failures)**

```bash
pnpm --filter @ekacode/server test
pnpm --filter @ekacode/core test
pnpm --filter @ekacode/desktop test
```

Expected: identify current failing suites (if any).

**Step 3: Write minimal implementation**

- Populate matrix with pass/fail snapshot and failure owner category.

**Step 4: Re-run targeted failing suites**

- Confirm reproducibility and isolation.

**Step 5: Commit**

```bash
git add docs/providers/test-matrix.md docs/providers/README.md
git commit -m "docs: add full test matrix baseline for multi-provider branch"
```

---

### Task 2: Add OpenAI Provider Adapter (Concrete)

**Files:**

- Create: `packages/server/src/provider/adapters/openai.ts`
- Modify: `packages/server/src/provider/registry.ts`
- Create: `packages/server/tests/provider/openai-adapter.test.ts`

**Step 1: Write failing tests**

- Adapter descriptor fields
- Auth state behavior (env + stored token)
- Basic model list contract

**Step 2: Run test to verify fail**

```bash
pnpm --filter @ekacode/server exec vitest run tests/provider/openai-adapter.test.ts
```

**Step 3: Minimal implementation**

- Implement adapter using existing contract only; no chat execution path expansion beyond metadata/auth.

**Step 4: Run test to verify pass**

- Re-run focused suite.

**Step 5: Commit**

```bash
git add packages/server/src/provider/adapters/openai.ts packages/server/src/provider/registry.ts packages/server/tests/provider/openai-adapter.test.ts
git commit -m "feat(server): add openai provider adapter"
```

---

### Task 3: Add Anthropic Provider Adapter (Concrete)

**Files:**

- Create: `packages/server/src/provider/adapters/anthropic.ts`
- Modify: `packages/server/src/provider/registry.ts`
- Create: `packages/server/tests/provider/anthropic-adapter.test.ts`

**Step 1:** failing tests for descriptor/auth/models

**Step 2:** run fail

**Step 3:** minimal adapter implementation

**Step 4:** run pass

**Step 5:** commit

```bash
git add packages/server/src/provider/adapters/anthropic.ts packages/server/src/provider/registry.ts packages/server/tests/provider/anthropic-adapter.test.ts
git commit -m "feat(server): add anthropic provider adapter"
```

---

### Task 4: Add Kimi/Moonshot + Zen/Z.AI Alias Coverage

**Files:**

- Modify: `packages/server/src/provider/models/catalog.ts`
- Modify: `packages/server/src/provider/capabilities.ts`
- Create: `packages/server/tests/provider/alias-catalog.test.ts`

**Step 1:** write failing alias normalization/merge tests (`kimi`, `moonshot`, `zen`, `z.ai coding plan`)

**Step 2:** run fail

**Step 3:** minimal normalization updates

**Step 4:** run pass

**Step 5:** commit

```bash
git add packages/server/src/provider/models/catalog.ts packages/server/src/provider/capabilities.ts packages/server/tests/provider/alias-catalog.test.ts
git commit -m "feat(server): add kimi and zen alias parity coverage"
```

---

### Task 5: Wire Desktop Chat Composer to Selected Provider/Model

**Files:**

- Modify: `apps/desktop/src/core/services/api/api-client.ts`
- Modify: `apps/desktop/src/core/chat/hooks/use-chat.ts`
- Create: `apps/desktop/tests/unit/presentation/hooks/use-chat-provider-selection.test.ts`

**Step 1:** write failing test asserting chat request body includes selected `providerId` and `modelId`

**Step 2:** run fail

**Step 3:** minimal wiring from persisted settings to outgoing chat payload

**Step 4:** run pass

**Step 5:** commit

```bash
git add apps/desktop/src/core/services/api/api-client.ts apps/desktop/src/core/chat/hooks/use-chat.ts apps/desktop/tests/unit/presentation/hooks/use-chat-provider-selection.test.ts
git commit -m "feat(desktop): send selected provider and model in chat requests"
```

---

### Task 6: Upgrade Schema Generation to Zod-Derived Artifact

**Files:**

- Modify: `packages/server/src/routes/provider.openapi.ts`
- Modify: `packages/server/src/schema/generate-provider-schema.mjs`
- Modify: `packages/server/src/schema/provider.schemas.json`
- Modify: `packages/server/src/schema/__tests__/provider-schema-drift.test.ts`

**Step 1:** write/adjust failing drift test to compare generated artifact from route schemas

**Step 2:** run fail

**Step 3:** minimal generation upgrade (derive from canonical schema modules, avoid hand-maintained duplication)

**Step 4:** run `schema:provider` + drift pass

**Step 5:** commit

```bash
git add packages/server/src/routes/provider.openapi.ts packages/server/src/schema/generate-provider-schema.mjs packages/server/src/schema/provider.schemas.json packages/server/src/schema/__tests__/provider-schema-drift.test.ts
git commit -m "feat(server): derive provider schema artifact from canonical schemas"
```

---

### Task 7: Full Regression Suite Closure

**Files:**

- Modify: `docs/providers/test-matrix.md`

**Step 1:** run all tests

```bash
pnpm --filter @ekacode/server test
pnpm --filter @ekacode/core test
pnpm --filter @ekacode/desktop test
```

**Step 2:** fix only failing tests via smallest changes (repeat red/green loops)

**Step 3:** re-run full tests until green

**Step 4:** update matrix with final pass status

**Step 5:** commit

```bash
git add docs/providers/test-matrix.md
git commit -m "test: close full regression suite for multi-provider rollout"
```

---

### Task 8: Final Verification + Branch Readiness

**Step 1: Mandatory checks**

```bash
pnpm --filter @ekacode/server typecheck
pnpm --filter @ekacode/server lint
pnpm --filter @ekacode/core typecheck
pnpm --filter @ekacode/core lint
pnpm --filter @ekacode/desktop typecheck
pnpm --filter @ekacode/desktop lint
```

**Step 2:** generate provider schema artifact and verify drift

```bash
pnpm --filter @ekacode/server schema:provider
pnpm --filter @ekacode/server exec vitest run src/schema/__tests__/provider-schema-drift.test.ts
```

**Step 3:** produce merge summary in PR notes

- list adapters added
- list route/contract changes
- list credential storage notes
- list OpenCode parity deltas

---

## Completion Criteria

- Full server/core/desktop test suites pass.
- Full server/core/desktop typecheck + lint pass.
- At least OpenAI + Anthropic concrete adapters added, ZAI preserved.
- Desktop chat requests always include selected provider/model.
- Provider schema artifact generation is automated and drift-tested.
- Docs updated with final matrix and operational notes.
