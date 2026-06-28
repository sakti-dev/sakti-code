# Source Coverage Gate Design

## Goal

Add enforced test coverage for published library code under `src/**` with an initial global threshold of:

- `lines >= 80`
- `functions >= 80`
- `statements >= 80`
- `branches >= 75`

The gate should prevent regressions in package behavior without pulling the playground under `dev/**` into the same requirement.

## Current State

- The repo already has strong client and SSR test coverage in Vitest, but coverage is not collected or enforced.
- Client and SSR tests are split today through mode-sensitive config in `vitest.config.ts`.
- CI in `.github/workflows/tests.yml` runs build, tests, and lint, but has no coverage step.
- `@vitest/coverage-v8` is not installed.

## Scope

Included:

- `src/**/*.{ts,tsx}`

Excluded from the initial gate:

- `dev/**`
- `test/**`
- `**/__tests__/**`
- generated files and type declarations

Non-goals for this first pass:

- coverage enforcement for the playground
- per-file thresholds
- external coverage services such as Codecov

## Decision

Use Vitest's workspace support to run the existing client and SSR suites as separate projects while producing one combined coverage report for `src/**`.

Implementation shape:

1. Keep a dedicated client config and a dedicated SSR config.
2. Add a `vitest.workspace.ts` file that references both configs.
3. Add `coverage` settings with the `v8` provider and global thresholds.
4. Add a `test:coverage` script that runs the workspace in coverage mode.
5. Update CI to run the coverage gate for pull requests and pushes to `main`.

This keeps local fast-test workflows intact while giving CI one authoritative coverage gate.

## Test Backfill Priorities

The first test-writing pass should target source areas that are most likely to drag down global `src/**` coverage or hide real regressions:

1. `src/parser/block-parser.ts`
   Reference extraction, footnote extraction, continuation indentation, normalization.
2. `src/model/render-document.ts`
   Footnote reference ordering, block reuse, append/replace metrics, unchanged block reuse.
3. `src/parser/html-element.ts`
   Nested elements, void elements, invalid fragments, attribute parsing fallbacks.
4. `src/render/code-blocks/shiki-manager.ts`
   Singleton behavior, alias resolution, unsupported-language fallback, per-theme caching.
5. `src/render/render-block.tsx` and nearby render helpers
   Unsupported block fallback, remaining branch cases not already covered by integration tests.
6. `src/render/directives/directive-attribute-props.ts`
   Empty input and attribute mapping.

## CI and Workflow

- Keep pre-commit focused on fast feedback: Ultracite plus `test:client` and `test:ssr`.
- Enforce coverage in CI, not in pre-commit.
- Prefer an explicit CI step for `test:coverage` instead of relying on the `pnpm run test` wrapper.

## Success Criteria

This work is complete when:

1. `pnpm run test:coverage` passes locally.
2. Coverage is computed only against `src/**`.
3. The repo meets the initial global threshold.
4. `.github/workflows/tests.yml` fails when coverage drops below threshold.
5. Existing fast local test workflows still work without coverage overhead.
