# Source Coverage Gate Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an enforced global coverage gate for `src/**`, backfill the highest-risk gaps, and fail CI when source coverage drops below `80` lines/functions/statements and `75` branches.

**Architecture:** Split Vitest into explicit client and SSR project configs, combine them with a workspace-based coverage run, and keep the coverage scope limited to `src/**`. Raise coverage by targeting parser, render-document, HTML parsing, and Shiki manager branches before enabling the CI gate.

**Tech Stack:** Vitest 1.6, Vite Solid plugin, `@vitest/coverage-v8`, GitHub Actions, pnpm, Ultracite

---

### Task 1: Add coverage tooling and project-level test configs

**Files:**
- Create: `vitest.shared.ts`
- Create: `vitest.ssr.config.ts`
- Create: `vitest.workspace.ts`
- Modify: `vitest.config.ts`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

**Step 1: Add the missing coverage provider**

Run:

```bash
pnpm add -D @vitest/coverage-v8
```

Expected: `package.json` and `pnpm-lock.yaml` include `@vitest/coverage-v8`.

**Step 2: Extract shared Vitest configuration**

Move the current common config out of `vitest.config.ts` into `vitest.shared.ts` and expose a helper such as:

```ts
export function createVitestConfig(testSSR: boolean) {
  return {
    plugins: [solidPlugin(/* existing Solid config */)],
    test: {
      watch: false,
      transformMode: { web: [/\.[jt]sx$/] },
      coverage: {
        provider: "v8",
        all: true,
        include: ["src/**/*.{ts,tsx}"],
        exclude: [
          "src/**/__tests__/**",
          "src/**/*.test.{ts,tsx}",
          "src/**/*.d.ts",
        ],
        thresholds: {
          lines: 80,
          functions: 80,
          statements: 80,
          branches: 75,
        },
      },
    },
  };
}
```

**Step 3: Keep `vitest.config.ts` as the client config**

Make `vitest.config.ts` export the client project using the shared helper:

```ts
export default defineConfig(createVitestConfig(false));
```

**Step 4: Add an SSR-specific config**

Create `vitest.ssr.config.ts`:

```ts
export default defineConfig(createVitestConfig(true));
```

**Step 5: Add a Vitest workspace for unified coverage**

Create `vitest.workspace.ts`:

```ts
export default defineWorkspace(["./vitest.config.ts", "./vitest.ssr.config.ts"]);
```

**Step 6: Add the coverage script**

Update `package.json` scripts so local runs stay explicit:

```json
{
  "test:client": "vitest run --config vitest.config.ts",
  "test:ssr": "vitest run --config vitest.ssr.config.ts",
  "test:coverage": "vitest run --workspace vitest.workspace.ts --coverage"
}
```

**Step 7: Verify the refactor did not break existing tests**

Run:

```bash
pnpm run test:client
pnpm run test:ssr
```

Expected: both commands pass exactly as before.

**Step 8: Commit**

```bash
git add package.json pnpm-lock.yaml vitest.config.ts vitest.shared.ts vitest.ssr.config.ts vitest.workspace.ts
git commit -m "test: add src coverage harness"
```

### Task 2: Cover parser extraction and HTML parsing branches

**Files:**
- Create: `src/parser/__tests__/block-parser.test.ts`
- Create: `src/parser/__tests__/html-element.test.ts`
- Modify: `src/parser/__tests__/inline-parser.test.ts`

**Step 1: Write parser extraction tests**

Add coverage for:

- reference definitions with normalized identifiers
- optional titles in `"double"`, `'single'`, and `(paren)` forms
- footnote definitions with indented continuation lines
- non-definition lines that must remain in the parsed content

Example test shape:

```ts
it("extracts reference and footnote definitions without dropping content", () => {
  const result = parseMarkdownToBlocks(markdown);
  expect(result.definitions.example).toEqual({ href: "/docs", title: "Docs" });
  expect(result.footnoteDefinitions.note).toHaveLength(1);
  expect(result.blocks).toHaveLength(1);
});
```

**Step 2: Write HTML element parser tests**

Add coverage for:

- quoted and unquoted attributes
- nested same-tag elements
- void elements such as `<br>`
- invalid or unclosed fragments falling back to text nodes
- recursive conversion into inline tokens

Example test shape:

```ts
it("parses nested HTML children and converts them to inline tokens", () => {
  const parsed = parseSimpleHtmlElement("<mark>a<strong>b</strong></mark>");
  expect(parsed?.node.children).toHaveLength(2);
});
```

**Step 3: Run the targeted parser tests**

Run:

```bash
pnpm exec vitest run src/parser/__tests__/block-parser.test.ts src/parser/__tests__/html-element.test.ts src/parser/__tests__/inline-parser.test.ts
```

Expected: the new tests pass and no existing parser behavior regresses.

**Step 4: Commit**

```bash
git add src/parser/__tests__/block-parser.test.ts src/parser/__tests__/html-element.test.ts src/parser/__tests__/inline-parser.test.ts
git commit -m "test: cover parser extraction branches"
```

### Task 3: Cover render-document reuse and footnote ordering

**Files:**
- Create: `src/model/__tests__/render-document.test.ts`
- Modify: `src/model/__tests__/render-metrics.test.ts`

**Step 1: Add render-document tests for block reuse**

Write tests that prove:

- unchanged blocks are reused by identity across incremental updates
- appended tail blocks increase version and append counts correctly
- changed blocks are replaced rather than reused

Example:

```ts
it("reuses unchanged blocks when markdown grows at the tail", () => {
  const first = buildRenderDocument(undefined, "# Title");
  const second = buildRenderDocument(first, "# Title\n\nTail");
  expect(second.blocks[0]).toBe(first.blocks[0]);
});
```

**Step 2: Add footnote-order tests**

Cover:

- first-seen ordering across paragraphs, lists, and tables
- nested inline tokens that contain footnote references
- missing definitions that should not break ordering collection

**Step 3: Extend metrics tests where branches remain uncovered**

Use `collectRenderMetrics` cases for:

- append-only changes
- replacements at a shared index
- full reuse
- sparse or empty next-block arrays

**Step 4: Run the targeted model tests**

Run:

```bash
pnpm exec vitest run src/model/__tests__/render-document.test.ts src/model/__tests__/render-metrics.test.ts src/model/__tests__/stable-id.test.ts
```

Expected: all model tests pass and cover the reuse logic added in this task.

**Step 5: Commit**

```bash
git add src/model/__tests__/render-document.test.ts src/model/__tests__/render-metrics.test.ts
git commit -m "test: cover render document reuse paths"
```

### Task 4: Cover render routing and code-block fallback branches

**Files:**
- Create: `src/render/code-blocks/__tests__/shiki-manager.test.ts`
- Create: `src/render/directives/__tests__/directive-attribute-props.test.ts`
- Modify: `src/render/__tests__/render-blocks.test.tsx`

**Step 1: Add `ShikiManager` unit tests**

Cover:

- singleton access through `getShikiManager`
- cached highlighter reuse per theme
- aliased languages resolving to a bundled language
- unsupported languages falling back to `"text"`
- `"text"` bypassing language loading

Example:

```ts
it("falls back to text for unsupported languages", async () => {
  const manager = getShikiManager();
  const result = await manager.ensureLanguage("github-light", "not-a-language");
  expect(result.language).toBe("text");
});
```

Mock `shiki` so tests stay deterministic and do not depend on actual syntax data loading.

**Step 2: Add a directive attribute helper test**

Cover both branches:

```ts
it("returns an empty object when attributes are missing", () => {
  expect(directiveAttributeProps()).toEqual({});
});
```

and:

```ts
it("maps attributes to velomark data props", () => {
  expect(directiveAttributeProps({ tone: "info" })).toEqual({
    "data-velomark-attr-tone": "info",
  });
});
```

**Step 3: Extend render-block integration coverage**

Add cases in `src/render/__tests__/render-blocks.test.tsx` for:

- unsupported block kinds using the paragraph fallback path
- HTML block and HTML element rendering branches not yet asserted directly
- directive/container attribute propagation if missing from existing coverage

**Step 4: Run the targeted render tests**

Run:

```bash
pnpm exec vitest run src/render/code-blocks/__tests__/shiki-manager.test.ts src/render/directives/__tests__/directive-attribute-props.test.ts src/render/__tests__/render-blocks.test.tsx
```

Expected: render routing and syntax highlighting fallback branches are covered without breaking existing DOM assertions.

**Step 5: Commit**

```bash
git add src/render/code-blocks/__tests__/shiki-manager.test.ts src/render/directives/__tests__/directive-attribute-props.test.ts src/render/__tests__/render-blocks.test.tsx
git commit -m "test: cover render routing and shiki fallbacks"
```

### Task 5: Turn on the global coverage gate and wire CI to it

**Files:**
- Modify: `.github/workflows/tests.yml`
- Modify: `package.json`
- Modify: `vitest.shared.ts`

**Step 1: Run the full coverage command and inspect the baseline**

Run:

```bash
pnpm run test:coverage
```

Expected: a combined coverage report is produced for `src/**`.

If the run is still below threshold, add the smallest missing tests in the modules already targeted above before enabling the final gate.

**Step 2: Finalize the threshold values in config**

Confirm `vitest.shared.ts` keeps:

```ts
thresholds: {
  lines: 80,
  functions: 80,
  statements: 80,
  branches: 75,
}
```

with `perFile: false`.

**Step 3: Update CI to run the coverage gate explicitly**

Replace the generic test step in `.github/workflows/tests.yml` with explicit commands that avoid the `concurrently` wrapper:

```yaml
- name: Test packed consumer
  run: pnpm run test:packed-consumer

- name: Test coverage
  run: pnpm run test:coverage
  env:
    CI: true
```

Keep build and lint as separate steps.

**Step 4: Run the full verification set**

Run:

```bash
pnpm exec ultracite check
pnpm run test:client
pnpm run test:ssr
pnpm run test:coverage
```

Expected:

- Ultracite reports no issues
- client tests pass
- SSR tests pass
- coverage passes with the configured global thresholds

**Step 5: Commit**

```bash
git add .github/workflows/tests.yml package.json vitest.shared.ts
git commit -m "ci: enforce src coverage gate"
```

### Task 6: Close the loop with a final repo check

**Files:**
- Review only: `docs/plans/2026-03-11-src-coverage-gate-design.md`
- Review only: `docs/plans/2026-03-11-src-coverage-gate.md`

**Step 1: Re-read the original goal**

Confirm the implementation still matches:

- `src/**` only
- global thresholds first
- `80/80/80/75` enforcement
- no `dev/**` coverage requirement

**Step 2: Run a final VCS and workflow check**

Run:

```bash
git status --short
git diff --stat HEAD~3..HEAD
```

Expected: only the intended coverage tooling, tests, and CI changes are present.

**Step 3: Prepare the merge-ready summary**

Report:

- what coverage command was added
- which source hotspots gained tests
- the final threshold numbers
- the exact verification results

**Step 4: Commit if anything remains**

```bash
git add -A
git commit -m "docs: finalize coverage rollout notes"
```

Skip this step if there are no remaining tracked changes.
