# MiniSearch Model Search Hardening + Models Freshness Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make model search fast, predictable, and accurate by keeping MiniSearch as the core engine, fixing search/indexing bugs, adding provider alias discoverability, and ensuring model catalog freshness (so models like `GLM-5` appear when available).

**Architecture:** Keep provider/model search logic centralized in `provider-selection-store` with a single MiniSearch index and deterministic query policy. Preserve UI as a dumb consumer. Add server-side model source freshness (snapshot + cache + refresh) so desktop gets current model lists reliably. Fix selector virtualization so narrowing queries never renders an empty viewport when data exists.

**Tech Stack:** SolidJS, TypeScript, MiniSearch (`minisearch`), Vitest, pnpm, ESLint, existing provider runtime in `packages/server`.

---

## 1) Comprehensive Knowledge Baseline

### 1.1 Current symptoms (observed)

1. Searching by provider-style names/aliases can fail (example: `opencode zen`, `z.ai coding plan`).
2. Searching `GLM-5` can appear to drop results while typing, even when partials like `GLM-` work.
3. Model availability can lag if server falls back to stale snapshot.

### 1.2 Root causes identified

1. **Catalog freshness gap:** local snapshot in server currently contains only `zai/glm-4.7` and `zai/glm-4.6v`.
   - `packages/server/src/provider/models/snapshot.json`
2. **No explicit alias strategy in indexed docs:** current index fields are `name`, `id`, `providerId`, `keywords` and `keywords` has only basic concatenation.
   - `apps/desktop/src/core/state/providers/provider-selection-store.ts`
3. **Virtualized list edge case:** visible window is derived from `modelScrollTop`; query/result shrink can leave `scrollTop` out of bounds and yield no rendered rows.
   - `apps/desktop/src/components/model-selector.tsx`
4. **Ranking dilution risk:** grouped section step can reorder results and hide MiniSearch relevance intent.

### 1.3 MiniSearch internals we must leverage (not fight)

1. Per-term dynamic `prefix` and `fuzzy` (functions), not just booleans.
   - `minisearch/src/MiniSearch.ts`
2. `processTerm` can return **multiple terms** (synonym/alias expansion).
   - `minisearch/src/MiniSearch.ts`
3. Weighted scoring combines exact/prefix/fuzzy + BM25+ + term/document boosts.
   - `minisearch/src/MiniSearch.ts`
4. Default tokenizer splits Unicode spaces and punctuation, so dots/hyphens/slashes are naturally tokenized.
   - `minisearch/src/MiniSearch.ts`
5. `autoSuggest` can provide fast fallback suggestions when strict query returns none.
   - `minisearch/src/MiniSearch.ts`

### 1.4 OpenCode reference behavior (for alignment)

1. OpenCode app model picker searches across `provider.name`, `name`, `id`.
   - `opencode/packages/app/src/components/dialog-select-model.tsx`
2. OpenCode list filtering uses fuzzy matching with grouped results.
   - `opencode/packages/ui/src/hooks/use-filtered-list.tsx`
3. OpenCode model data strategy is snapshot + local cache + background refresh.
   - `opencode/packages/opencode/src/provider/models.ts`
   - `opencode/packages/opencode/script/build.ts`

---

## 2) Scope, Non-Goals, and Acceptance Criteria

## Scope

1. Desktop selector search/index behavior in `apps/desktop`.
2. Server model source freshness in `packages/server`.
3. Unit/integration tests for search quality, model availability, and virtualization correctness.

## Non-goals

1. Replacing MiniSearch with another library.
2. Reworking command center UX architecture beyond what is needed for correctness and speed.
3. Changing chat API contracts.

## Acceptance criteria

1. Querying provider aliases (e.g., `z.ai`, `zen`, `opencode zen`, `z.ai coding plan`) returns Z.AI models.
2. Querying model families like `GLM-5` returns expected matches when catalog has them, and never silently renders blank list due to virtualization.
3. Selector preserves MiniSearch relevance order within groups.
4. Connected models are ranked above non-connected when relevance is otherwise similar.
5. Server model catalog stays fresh via cache/refresh and does not depend exclusively on stale snapshot.
6. All added tests pass, plus desktop/server typecheck + lint.

---

## 3) Explicit Decisions (Locked)

1. **Keep MiniSearch** as search core.
2. Use **adaptive query policy**:
   - `combineWith: 'AND'` for multi-term precision.
   - `prefix`: enabled only for last term and minimum length.
   - `fuzzy`: enabled only for sufficiently long terms.
3. Use alias expansion via `processTerm` and/or alias field (not just raw concatenated keywords).
4. Preserve ranking order from MiniSearch inside each provider group; do not alphabetically resort model rows post-search.
5. Add bounded caches for repeated queries.
6. Fix virtualization by clamping/resetting scroll window on query/data-size changes.
7. Implement server model source strategy similar to OpenCode: snapshot baseline + cached models + background refresh.

---

## 4) Public Interface and Type Changes

## Desktop (`apps/desktop`)

1. Extend `ProviderSelectionModelDoc` with explicit alias/search fields.
2. Keep existing public store methods, plus optional additions if needed:
   - `providerGroupedSections(query)` (existing, behavior tightened)
   - optional `suggestions(query)` for empty-result assist
3. No breaking prop changes for `ChatInput` / `ModelSelector`.

## Server (`packages/server`)

1. No route contract changes required (`/api/providers/models` stays same).
2. Internal provider model source gets cache + refresh plumbing.
3. Snapshot update process added/updated for deterministic fallback.

---

## 5) Opencode Alignment Checklist (Must run in each phase)

Before implementing each phase, inspect and align to OpenCode references:

1. `opencode/packages/opencode/src/provider/models.ts`
2. `opencode/packages/opencode/script/build.ts`
3. `opencode/packages/app/src/components/dialog-select-model.tsx`
4. `opencode/packages/ui/src/hooks/use-filtered-list.tsx`

Per phase, document one short parity note in commit message/PR notes:

1. What behavior we matched.
2. What we intentionally diverged on and why.

---

## 6) Implementation Plan (TDD, Decision-Complete)

### Task 1: Reproduce and lock bugs with failing tests (RED)

**Files**

1. Modify: `apps/desktop/tests/unit/core/state/providers/provider-selection-store.test.ts`
2. Modify: `apps/desktop/tests/unit/components/model-selector-command-center.test.tsx`
3. Optional add: `apps/desktop/tests/unit/components/model-selector-virtualization.test.tsx`

**Step 1: Add provider alias search failing test**

```ts
it("finds Z.AI models by alias query", async () => {
  // query: "opencode zen" / "z.ai coding plan"
  // assert results include zai models
});
```

**Step 2: Add GLM-5 narrowing regression test**

```ts
it("does not render empty viewport when query narrows from GLM- to GLM-5", async () => {
  // simulate typing and scroll state
  // assert at least one row is rendered when store returns matches
});
```

**Step 3: Add ranking-order test for grouped sections**

```ts
it("preserves minisearch order inside provider sections", async () => {
  // query with fuzzy/prefix relevance
  // assert grouped models keep source result order
});
```

**Step 4: Run focused tests**

Run:

```bash
pnpm --filter @sakti-code/desktop test -- --run tests/unit/core/state/providers/provider-selection-store.test.ts tests/unit/components/model-selector-command-center.test.tsx
```

Expected: FAIL on new assertions.

**Step 5: Commit tests-only**

```bash
git add apps/desktop/tests/unit/core/state/providers/provider-selection-store.test.ts apps/desktop/tests/unit/components/model-selector-command-center.test.tsx
git commit -m "test(desktop): capture alias search and virtualization regressions"
```

---

### Task 2: Improve server model freshness (snapshot + cache + refresh) (RED->GREEN)

**Files**

1. Modify: `packages/server/src/provider/models/catalog.ts`
2. Create: `packages/server/src/provider/models/cache.ts` (or equivalent)
3. Modify: `packages/server/src/provider/runtime.ts`
4. Modify: `packages/server/src/provider/models/snapshot.json`
5. Modify/Add tests:
   - `packages/server/tests/provider/catalog.test.ts`
   - `packages/server/tests/provider/model-cache.test.ts` (new)

**Design decision**

1. Read order for model payload:
   - local cache file (if present)
   - bundled snapshot
   - empty object fallback
2. Background refresh:
   - fetch `https://models.dev/api.json` with timeout
   - on success, persist cache and refresh in-memory source
3. Keep route unchanged: `/api/providers/models`.

**Step 1: Write failing server tests**

```ts
it("uses cache when network unavailable and snapshot stale", async () => {});
it("refresh updates cache and subsequent list includes new models", async () => {});
```

**Step 2: Run failing server tests**

Run:

```bash
pnpm --filter @sakti-code/server test -- --run tests/provider/catalog.test.ts tests/provider/model-cache.test.ts
```

Expected: FAIL.

**Step 3: Implement minimal source/cache layer + runtime wiring**

**Step 4: Update snapshot baseline**

1. Refresh `packages/server/src/provider/models/snapshot.json` from latest models.dev payload.
2. Ensure deterministic shape matches existing parser assumptions.

**Step 5: Re-run server tests**

Run:

```bash
pnpm --filter @sakti-code/server test -- --run tests/provider/catalog.test.ts tests/provider/model-cache.test.ts
```

Expected: PASS.

**Step 6: Commit**

```bash
git add packages/server/src/provider/models/catalog.ts packages/server/src/provider/models/cache.ts packages/server/src/provider/runtime.ts packages/server/src/provider/models/snapshot.json packages/server/tests/provider/catalog.test.ts packages/server/tests/provider/model-cache.test.ts
git commit -m "feat(server): add models cache+refresh and update snapshot baseline"
```

---

### Task 3: Rebuild model docs for alias-aware MiniSearch indexing (RED->GREEN)

**Files**

1. Modify: `apps/desktop/src/core/state/providers/provider-selection-store.ts`
2. Add tests in: `apps/desktop/tests/unit/core/state/providers/provider-selection-store.test.ts`

**Design decision**

1. Introduce provider alias map in desktop store (initially):
   - `zai`: `z.ai`, `z-ai`, `zen`, `opencode zen`, `z.ai coding plan`, `zai`
   - plus curated aliases for other providers where needed
2. Index explicit searchable fields instead of overloaded `keywords` only.
3. Keep `storeFields` minimal but sufficient for UI.

**Step 1: Add failing alias-expansion tests**

```ts
it("matches provider aliases using index terms", async () => {});
it("matches provider display names and ids consistently", async () => {});
```

**Step 2: Run focused failing tests**

Run:

```bash
pnpm --filter @sakti-code/desktop test -- --run tests/unit/core/state/providers/provider-selection-store.test.ts
```

Expected: FAIL.

**Step 3: Implement doc shaping + alias field generation**

**Step 4: Re-run tests**

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/desktop/src/core/state/providers/provider-selection-store.ts apps/desktop/tests/unit/core/state/providers/provider-selection-store.test.ts
git commit -m "feat(desktop): add alias-aware model docs for minisearch"
```

---

### Task 4: Adopt adaptive MiniSearch query policy (RED->GREEN)

**Files**

1. Modify: `apps/desktop/src/core/state/providers/provider-selection-store.ts`
2. Modify tests: `apps/desktop/tests/unit/core/state/providers/provider-selection-store.test.ts`

**Locked query policy**

1. `combineWith: 'AND'` for multi-token user queries.
2. `prefix(term, i, terms)`: true only for last term and `term.length >= 2`.
3. `fuzzy(term, i, terms)`: for last term when `term.length >= 4`, set fractional distance (e.g. `0.2`), else false.
4. `maxFuzzy`: cap (e.g. 2 or 3) for predictable performance.
5. `boostTerm`: lower weight for very short terms (1-2 chars).
6. `boostDocument`: prefer connected providers.

**Step 1: Add failing behavior tests**

```ts
it("does not return noisy cross-provider matches for unrelated two-term queries", async () => {});
it("still returns useful typo tolerance for long model terms", async () => {});
it("prefers connected models when relevance is close", async () => {});
```

**Step 2: Run focused failing tests**

Run:

```bash
pnpm --filter @sakti-code/desktop test -- --run tests/unit/core/state/providers/provider-selection-store.test.ts
```

Expected: FAIL.

**Step 3: Implement search options and ranking controls**

**Step 4: Re-run tests**

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/desktop/src/core/state/providers/provider-selection-store.ts apps/desktop/tests/unit/core/state/providers/provider-selection-store.test.ts
git commit -m "feat(desktop): apply adaptive minisearch query policy for model selector"
```

---

### Task 5: Preserve relevance through grouping and cache hardening (RED->GREEN)

**Files**

1. Modify: `apps/desktop/src/core/state/providers/provider-selection-store.ts`
2. Modify tests: `apps/desktop/tests/unit/core/state/providers/provider-selection-store.test.ts`

**Design decision**

1. Keep provider group ordering rule (connected first, provider name next).
2. Keep model order within each group as search-result order from MiniSearch.
3. Replace unbounded query maps with bounded cache (LRU/fixed cap).
4. Invalidate caches only on source data changes (docs/index input).

**Step 1: Add failing tests**

```ts
it("does not alphabetically reorder group rows over relevance", async () => {});
it("evicts old query entries when cache cap reached", async () => {});
```

**Step 2: Run tests (expect FAIL)**

**Step 3: Implement minimal fixes**

**Step 4: Run tests (expect PASS)**

**Step 5: Commit**

```bash
git add apps/desktop/src/core/state/providers/provider-selection-store.ts apps/desktop/tests/unit/core/state/providers/provider-selection-store.test.ts
git commit -m "fix(desktop): preserve relevance order and bound selector caches"
```

---

### Task 6: Fix selector virtualization narrowing bug (RED->GREEN)

**Files**

1. Modify: `apps/desktop/src/components/model-selector.tsx`
2. Modify/Add tests:
   - `apps/desktop/tests/unit/components/model-selector-command-center.test.tsx`
   - optional `apps/desktop/tests/unit/components/model-selector-virtualization.test.tsx`

**Design decision**

1. On query change and row-count change:
   - clamp `modelScrollTop` to valid max scroll
   - reset to top when narrowing query causes out-of-range start index
2. Keep keyboard active-row auto-scroll behavior.

**Step 1: Add failing render-window test**

```ts
it("keeps visible rows rendered when filter reduces total rows", () => {});
```

**Step 2: Run focused tests (expect FAIL)**

Run:

```bash
pnpm --filter @sakti-code/desktop test -- --run tests/unit/components/model-selector-command-center.test.tsx
```

**Step 3: Implement clamp/reset logic**

**Step 4: Re-run tests (expect PASS)**

**Step 5: Commit**

```bash
git add apps/desktop/src/components/model-selector.tsx apps/desktop/tests/unit/components/model-selector-command-center.test.tsx
git commit -m "fix(desktop): stabilize virtualized model list on query narrowing"
```

---

### Task 7: Optional no-result assist via MiniSearch autoSuggest (if UX required)

**Files**

1. Modify: `apps/desktop/src/core/state/providers/provider-selection-store.ts`
2. Modify: `apps/desktop/src/components/model-selector.tsx`
3. Add tests:
   - `apps/desktop/tests/unit/core/state/providers/provider-selection-store.test.ts`
   - `apps/desktop/tests/unit/components/model-selector-command-center.test.tsx`

**Design decision**

1. When strict query yields zero rows, show `Did you mean…` suggestions from `autoSuggest`.
2. Suggestions are non-destructive: selecting suggestion updates query.
3. If not needed, skip this task to keep scope minimal.

---

### Task 8: Verification-before-completion gate (Required)

**Step 1: Desktop tests**

```bash
pnpm --filter @sakti-code/desktop test
```

**Step 2: Server tests**

```bash
pnpm --filter @sakti-code/server test
```

**Step 3: Typecheck**

```bash
pnpm --filter @sakti-code/desktop typecheck
pnpm --filter @sakti-code/server typecheck
```

**Step 4: Lint**

```bash
pnpm --filter @sakti-code/desktop lint
pnpm --filter @sakti-code/server lint
```

**Step 5: Final integration sanity**

1. Open model selector.
2. Verify queries: `z.ai`, `zen`, `opencode zen`, `glm-`, `glm-5`.
3. Verify connected ranking and grouped rendering.
4. Verify no blank viewport during fast typing.

**Step 6: Final commit**

```bash
git add -A
git commit -m "feat: harden minisearch model selector and model-catalog freshness"
```

---

## 7) Test Matrix (Decision Complete)

1. **Alias discovery**
   - `z.ai`, `z-ai`, `zen`, `opencode zen`, `z.ai coding plan` -> returns `zai/*`
2. **Model family typing flow**
   - `glm` -> broad
   - `glm-` -> broad
   - `glm-5` -> expected matches if catalog has them, otherwise stable empty+assist (no render bug)
3. **Precision controls**
   - multi-token `AND` behavior reduces noisy results
   - short-token fuzzy disabled avoids random matches
4. **Connected preference**
   - connected provider rows rank above disconnected when relevance ties
5. **Virtualization correctness**
   - large list + deep scroll + narrowing query keeps visible rows
6. **Freshness fallback**
   - network failure uses cache/snapshot
   - refresh updates cache and subsequent list reflects new models

---

## 8) Risks and Mitigations

1. **Risk:** Overly strict `AND` could hide useful results.
   - **Mitigation:** keep fuzzy/prefix on last term and optional autoSuggest fallback.
2. **Risk:** Alias list drift over time.
   - **Mitigation:** centralize alias map and add test fixtures for critical aliases.
3. **Risk:** Refresh failures degrade freshness.
   - **Mitigation:** snapshot + local cache fallback + timeout + retry schedule.
4. **Risk:** Additional scoring rules make relevance opaque.
   - **Mitigation:** add deterministic ranking tests and keep scoring rules documented in code comments.

---

## 9) Default Assumptions (Explicit)

1. User prefers precision and stable behavior over highly permissive fuzzy noise.
2. Keeping MiniSearch is non-negotiable for this feature.
3. No backend API shape changes are required.
4. Existing `./packages/zai` provider remains intact; this plan changes search/index/catalog freshness behavior only.

---

## 10) Execution Recommendation

Recommended execution order:

1. Task 1
2. Task 2
3. Task 3
4. Task 4
5. Task 5
6. Task 6
7. Task 8
8. Task 7 only if UX asks for suggestion row

This order minimizes regressions by fixing data freshness and search correctness before UI refinements.
