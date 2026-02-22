# Model Selector Only (MiniSearch) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement a reusable, accessible command-style model selector in chat input only, powered by global state and `MiniSearch`, with persistence via existing provider preferences API.

**Architecture:** Keep command UI components dumb/controlled. Put all search/indexing/grouping logic in a global provider-selection store. Reuse existing provider/auth/models/preferences endpoints; do not change provider connection UX in Settings for this iteration.

**Tech Stack:** SolidJS, MiniSearch, ProviderClient, unstorage-backed server preferences, Vitest, ESLint, TypeScript.

---

## Scope (Locked)

### In Scope

- Build/adjust reusable dumb command components for selector UX + accessibility.
- Implement model-search and ranking with `MiniSearch` in state-management layer.
- Move/finish model selector UX in `chat-input.tsx`:
  - group options under `Connected` and `Not Connected`
  - show helper text `Connected / Not Connected`
- Persist selected model/provider using existing `/api/providers/preferences` endpoints.
- Add/adjust unit tests and targeted integration tests for model selector flow.
- Run typecheck and lint before completion.

### Out of Scope

- Provider connect modal redesign in Settings.
- OAuth flow changes.
- New backend API contracts.
- Replacing custom `packages/zai` provider/SDK.

## Key Decisions

- Global source of truth: one selected model/provider app-wide.
- Search engine: `MiniSearch` in-memory index built from server model/auth data.
- Dumb components own keyboard/a11y behavior only, no provider/model business logic.
- Persistence remains server-side via existing preference service (`unstorage fs-lite` in server package).

## Visual Architecture

```mermaid
flowchart TD
  A[Chat Input Command UI] --> B[Provider Selection Global Store]
  B --> C[MiniSearch Index]
  B --> D[ProviderClient]
  D --> E[/api/providers/models]
  D --> F[/api/providers/auth]
  D --> G[/api/providers/preferences]
  G --> H[ProviderPreferenceService]
  H --> I[unstorage fs-lite]
```

## Usage Shape

```tsx
const store = useProviderSelectionStore();
const [query, setQuery] = createSignal("");

<CommandRoot
  activeId={activeId()}
  onActiveIdChange={setActiveId}
  onSelect={modelId => void store.setSelectedModel(modelId)}
>
  <CommandInput value={query()} onValueChange={setQuery} aria-label="Select model" />
  <CommandList>
    <CommandGroup heading="Connected">
      <For each={store.connectedResults(query())}>
        {m => (
          <CommandItem id={m.id} value={m.id}>
            {m.name ?? m.id}
          </CommandItem>
        )}
      </For>
    </CommandGroup>
    <CommandSeparator />
    <CommandGroup heading="Not Connected">
      <For each={store.notConnectedResults(query())}>
        {m => (
          <CommandItem id={m.id} value={m.id}>
            {m.name ?? m.id}
          </CommandItem>
        )}
      </For>
    </CommandGroup>
  </CommandList>
</CommandRoot>;
```

---

## Interfaces / Types

### Create / Modify (Desktop)

- Create: `apps/desktop/src/core/state/providers/provider-selection-store.ts`
  - `createProviderSelectionStore(client)`
  - `connectedResults(query: string)`
  - `notConnectedResults(query: string)`
  - `setSelectedModel(modelId: string)`
  - `refresh()`
- Create: `apps/desktop/src/core/state/providers/provider-selection-provider.tsx`
  - context + `useProviderSelectionStore()` hook
- Create/Modify: `apps/desktop/src/components/ui/command.tsx`
  - controlled, composable command primitives
- Modify: `apps/desktop/src/views/workspace-view/chat-area/chat-input.tsx`
  - integrate grouped model selector

### Reuse Without Contract Changes (Server)

- `packages/server/src/routes/provider.ts`
- `packages/server/src/provider/preferences.ts`

---

## Task 1: Add Dumb Command Components (A11y + Keyboard)

**Files:**

- Create/Modify: `apps/desktop/src/components/ui/command.tsx`
- Test: `apps/desktop/tests/unit/components/command.test.tsx`
- Reference: `apps/desktop/src/components/reference/command.tsx`
- Reference: `apps/desktop/src/components/reference/cmdk-solid/src/index.tsx`

1. Write failing tests for:

- `combobox`/`listbox`/`option` roles and aria attributes.
- keyboard navigation (ArrowUp/Down, Home/End, Enter).
- disabled option skip behavior.

2. Run failing test:

- `pnpm --filter @sakti-code/desktop test:run apps/desktop/tests/unit/components/command.test.tsx`

3. Implement minimal controlled primitives.

4. Run same test until green.

5. Commit:

```bash
git add apps/desktop/src/components/ui/command.tsx apps/desktop/tests/unit/components/command.test.tsx
git commit -m "feat(desktop): add controlled command primitives for model selector"
```

---

## Task 2: Implement Global Store + MiniSearch Index

**Files:**

- Create: `apps/desktop/src/core/state/providers/provider-selection-store.ts`
- Create: `apps/desktop/src/core/state/providers/provider-selection-provider.tsx`
- Modify: `apps/desktop/src/core/state/providers/index.ts`
- Test: `apps/desktop/tests/unit/core/state/providers/provider-selection-store.test.ts`

1. Write failing tests for:

- hydrate providers/auth/models/preferences.
- builds searchable docs and returns ranked results.
- groups results by connected status.
- persists selection through `updatePreferences`.

2. Run failing test:

- `pnpm --filter @sakti-code/desktop test:run apps/desktop/tests/unit/core/state/providers/provider-selection-store.test.ts`

3. Implement with `MiniSearch`:

- index fields: `name`, `id`, `providerId`, `keywords`
- store fields: `id`, `name`, `providerId`, `connected`
- options: `prefix: true`, `fuzzy: 0.2`, boost `name`

4. Run same test until green.

5. Commit:

```bash
git add apps/desktop/src/core/state/providers/provider-selection-store.ts apps/desktop/src/core/state/providers/provider-selection-provider.tsx apps/desktop/src/core/state/providers/index.ts apps/desktop/tests/unit/core/state/providers/provider-selection-store.test.ts
git commit -m "feat(desktop): add global model selector store with minisearch"
```

---

## Task 3: Wire Model Selector In Chat Input Only

**Files:**

- Modify: `apps/desktop/src/views/workspace-view/chat-area/chat-input.tsx`
- Modify: chat input container wiring under `apps/desktop/src/views/workspace-view/chat-area/` (as needed)
- Test: `apps/desktop/tests/unit/views/workspace-view/chat-area/chat-input.test.tsx`
- Test: `apps/desktop/tests/unit/views/model-selector.test.tsx`

1. Write failing tests for:

- grouped `Connected` and `Not Connected` lists.
- helper text visibility.
- selecting model triggers `setSelectedModel`.
- selected model persists after store refresh.

2. Run failing tests:

- `pnpm --filter @sakti-code/desktop test:run apps/desktop/tests/unit/views/workspace-view/chat-area/chat-input.test.tsx apps/desktop/tests/unit/views/model-selector.test.tsx`

3. Implement chat-input integration with command components + store selectors.

4. Re-run tests until green.

5. Commit:

```bash
git add apps/desktop/src/views/workspace-view/chat-area/chat-input.tsx apps/desktop/tests/unit/views/workspace-view/chat-area/chat-input.test.tsx apps/desktop/tests/unit/views/model-selector.test.tsx
 git commit -m "feat(desktop): implement model selector in chat input with connected grouping"
```

---

## Task 4: Integration + Regression Coverage

**Files:**

- Create/Modify: `apps/desktop/tests/integration/provider-model-selector-flow.test.tsx` (or existing closest integration file)

1. Write failing integration test:

- auth state has mixed connected/disconnected providers.
- chat model selector renders grouped options correctly.
- selecting model persists via preferences API and survives reload cycle.

2. Run failing test:

- `pnpm --filter @sakti-code/desktop test:run apps/desktop/tests/integration/provider-model-selector-flow.test.tsx`

3. Implement minimal glue updates if needed.

4. Re-run test until green.

5. Commit:

```bash
git add apps/desktop/tests/integration/provider-model-selector-flow.test.tsx apps/desktop/src/views/workspace-view/chat-area apps/desktop/src/core/state/providers
 git commit -m "test(desktop): add model selector integration flow coverage"
```

---

## Task 5: Final Verification (Mandatory)

1. Targeted desktop tests:

- `pnpm --filter @sakti-code/desktop test:run apps/desktop/tests/unit/components/command.test.tsx`
- `pnpm --filter @sakti-code/desktop test:run apps/desktop/tests/unit/core/state/providers/provider-selection-store.test.ts`
- `pnpm --filter @sakti-code/desktop test:run apps/desktop/tests/unit/views/workspace-view/chat-area/chat-input.test.tsx`
- `pnpm --filter @sakti-code/desktop test:run apps/desktop/tests/unit/views/model-selector.test.tsx`

2. Integration test:

- `pnpm --filter @sakti-code/desktop test:run apps/desktop/tests/integration/provider-model-selector-flow.test.tsx`

3. Typecheck and lint:

- `pnpm --filter @sakti-code/desktop typecheck`
- `pnpm --filter @sakti-code/server typecheck`
- `pnpm --filter @sakti-code/desktop lint`
- `pnpm --filter @sakti-code/server lint`

4. Manual smoke:

- selector shows grouped models.
- typing filters quickly and ranks relevant models.
- chosen model remains selected after app restart.

5. Final commit:

```bash
git add apps/desktop packages/server docs/plans/2026-02-14-model-selector-only-minisearch-implementation.md
git commit -m "feat(desktop): model selector only flow with minisearch"
```

---

## Acceptance Criteria

- Only model selector behavior is changed.
- Settings provider-connection UX is not redesigned in this pass.
- Selector uses reusable dumb command components.
- Search/filter uses `MiniSearch` in store/controller layer.
- Selector clearly groups `Connected` and `Not Connected` models.
- Selection persists via existing server provider preferences.
- Typecheck + lint pass.

## Assumptions

- Existing provider APIs remain stable and sufficient.
- Current auth state endpoint truthfully reflects connection status.
- `MiniSearch` dependency can be added to desktop package without build issues.
