# Incremark Streaming Markdown Migration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace `apps/desktop` markdown rendering from `marked + marked-shiki` to `@incremark/solid` stream-mode rendering everywhere in chat message surfaces, eliminating freeze-prone full reparse behavior.

**Architecture:** Keep the public `Markdown` component API stable for call sites, but rewrite internals to use Incremark stream mode with a local async chunk queue and snapshot-diff adapter. Preserve existing `TextPart` and `ReasoningPart` behavior while removing legacy parser/sanitizer/finalizer/telemetry infrastructure tied to marked. Lock parser behavior to Incremark's default marked engine path (no Micromark override in desktop chat), keep security posture strict by default with `htmlTree: false`, and never render raw HTML from model output.

**Tech Stack:** Solid.js, `@incremark/solid`, `@incremark/theme`, Vite, Vitest, existing chat state stores/hooks (`useChat`, `useSessionTurns`), Electron desktop runtime.

---

## Mandatory Decisions Locked Before Implementation

- No feature flag rollout for this migration. This is a direct cutover.
- Stream mode is required. Do not implement `IncremarkContent` content mode as the primary path.
- In desktop chat renderer, lock Incremark to default marked-engine behavior; do not add runtime engine switching.
- `htmlTree` must default to `false` for untrusted model output.
- Existing high-level `Markdown` API stays compatible for call sites during migration.
- Existing timeline auto-scroll (`createAutoScroll`) remains authoritative; do not replace with `AutoScrollContainer` unless a specific defect forces it.
- Do not ship `Simulate AI Output` or equivalent synthetic-stream controls in production chat UI.
- Performance SLOs are part of done criteria: `p95 visual staleness <= 100ms`, `p99 visual staleness <= 150ms`, with renderer work budget target `<= 6ms/frame` (`<= 4ms` preferred).

---

## Scope

- In scope:
  - `apps/desktop/src/components/ui/markdown.tsx` full rewrite to Incremark stream mode.
  - New stream adapter utilities under `apps/desktop/src/components/ui/`.
  - Test suite migration from marked-centric assertions to Incremark stream assertions.
  - Removal of marked-specific dependencies and helper files.
  - CSS adjustments for Incremark output and code block controls.

- Out of scope:
  - Refactoring `useChat` stream parser protocol.
  - Introducing server-side markdown sanitization pipeline.
  - Reworking non-chat markdown surfaces outside `apps/desktop`.
  - Shipping parser-engine toggles (`marked`/`micromark`) in desktop chat UI.
  - Shipping simulate-stream controls/buttons in desktop chat UI.
  - Implementing `MicromarkAstBuilder` path for production desktop chat markdown rendering.

---

## Risk Register (track throughout execution)

- Risk 1: stream adapter may reset too often when snapshot updates are non-monotonic.
- Risk 2: Incremark code block DOM shape may differ from existing CSS selectors.
- Risk 3: test flakiness from async generator lifecycle and cleanup timing.
- Risk 4: import/runtime bundling issues for `@incremark/*` in Vitest.
- Risk 5: hidden dependency on removed markdown telemetry files.
- Risk 6: very high token throughput may create queue backpressure and exceed the `p95 <= 100ms` staleness SLO.

Use `@systematic-debugging` whenever observed behavior deviates from expected outcomes.

---

## Performance SLO And Throughput Contract

- `60fps` target means frame budget is `16.7ms`; markdown renderer should consume `<= 6ms/frame` (`<= 4ms` preferred) to avoid crowding layout/paint.
- Stream adapter must use append-delta semantics for monotonic snapshots and hard reset semantics for non-monotonic snapshots.
- Update delivery should be coalesced to roughly frame cadence (`~16ms`) and force-flushed when staleness approaches `100ms`.
- Stream lifecycle must finalize promptly on `isStreaming=false`, abort, or dispose to avoid stuck async generators.
- Verification must include percentile staleness checks (`p95 <= 100ms`, `p99 <= 150ms`) in integration stress reporting.

---

## Batch Map (execution order)

- Batch A: Baseline + migration scaffolding (Tasks 1-6)
- Batch B: Stream primitives (Tasks 7-12)
- Batch C: Incremark component rewrite (Tasks 13-20)
- Batch D: Call-site integration and behavior parity (Tasks 21-24)
- Batch E: Legacy removal + dependency cleanup (Tasks 25-28)
- Batch F: Verification hardening + docs + handoff (Tasks 29-30)

## Implementation Status Update (2026-02-23)

- Completed:
  - `Markdown` now uses `@incremark/solid` stream mode (`stream={adapter.stream}`) with snapshot-diff adapter lifecycle.
  - `TextPart` and `ReasoningPart` are integrated and passing with preserved throttling behavior.
  - Stream-focused verification suites (`markdown-streaming`, stress, benchmark) are green.
  - Legacy sanitizer helper (`markdown-sanitizer.ts`) and its unit tests were removed.
  - Legacy finalizer helper (`markdown-finalizer.ts`) and its unit tests were removed.
  - Legacy dependencies removed from desktop package: `marked`, `marked-shiki`, `dompurify`, `morphdom`, direct `shiki`.
  - Migration health and baseline scripts now target the current test layout (`src/**/__tests__` + `tests/integration/**`).
  - Explicit security/code-fence/unmount lifecycle assertions were added to markdown test suites.

- Intentional deviation:
  - Keep `markdown-perf-telemetry` for migration SLO checks and benchmark reporting instead of removing it in Task 26.
  - Rationale: it is still used by `markdown-stream-stress` and `markdown-benchmark.report` integration tests and the perf panel.

---

### Task 1: Add Repeatable Baseline Script For Markdown Migration

**Files:**

- Create: `apps/desktop/scripts/markdown-migration-baseline.sh`
- Modify: `apps/desktop/package.json`
- Test: `apps/desktop/scripts/markdown-migration-baseline.sh`

**Step 1: Write the failing test**

```bash
# apps/desktop/scripts/markdown-migration-baseline.sh
#!/usr/bin/env bash
set -euo pipefail

pnpm --filter @sakti-code/desktop test:run tests/unit/components/markdown.test.tsx
pnpm --filter @sakti-code/desktop test:run tests/unit/components/markdown-streaming.test.tsx
pnpm --filter @sakti-code/desktop test:run tests/integration/markdown-stream-stress.test.tsx
```

**Step 2: Run test to verify it fails**

Run: `bash apps/desktop/scripts/markdown-migration-baseline.sh`
Expected: FAIL currently because script is not executable and `test:run` call form is not wired yet.

**Step 3: Write minimal implementation**

```json
{
  "scripts": {
    "markdown:migration:baseline": "bash ./scripts/markdown-migration-baseline.sh"
  }
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @sakti-code/desktop markdown:migration:baseline`
Expected: PASS command wiring; test outcomes may be mixed but script runs end-to-end.

**Step 5: Commit**

```bash
git add apps/desktop/scripts/markdown-migration-baseline.sh apps/desktop/package.json
git commit -m "chore(desktop): add markdown migration baseline script"
```

---

### Task 2: Capture Baseline Artifacts For Regression Comparison

**Files:**

- Create: `apps/desktop/tests/fixtures/recorded/perf-reports/markdown-migration.baseline.log`
- Modify: `apps/desktop/scripts/markdown-migration-baseline.sh`
- Test: `apps/desktop/tests/fixtures/recorded/perf-reports/markdown-migration.baseline.log`

**Step 1: Write the failing test**

```bash
# append to script
OUT=tests/fixtures/recorded/perf-reports/markdown-migration.baseline.log
mkdir -p "$(dirname "$OUT")"
: > "$OUT"
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @sakti-code/desktop markdown:migration:baseline`
Expected: FAIL because logging commands are not yet writing command status and timestamps.

**Step 3: Write minimal implementation**

```bash
{
  date -u +"%Y-%m-%dT%H:%M:%SZ"
  echo "COMMAND: tests/unit/components/markdown.test.tsx"
  pnpm --filter @sakti-code/desktop exec vitest run tests/unit/components/markdown.test.tsx
  echo "COMMAND: tests/unit/components/markdown-streaming.test.tsx"
  pnpm --filter @sakti-code/desktop exec vitest run tests/unit/components/markdown-streaming.test.tsx
  echo "COMMAND: tests/integration/markdown-stream-stress.test.tsx"
  pnpm --filter @sakti-code/desktop exec vitest run tests/integration/markdown-stream-stress.test.tsx
} | tee "$OUT"
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @sakti-code/desktop markdown:migration:baseline`
Expected: PASS with baseline log artifact generated.

**Step 5: Commit**

```bash
git add apps/desktop/scripts/markdown-migration-baseline.sh apps/desktop/tests/fixtures/recorded/perf-reports/markdown-migration.baseline.log
git commit -m "chore(desktop): capture markdown migration baseline artifacts"
```

---

### Task 3: Add Migration Health Script For Final Verification Matrix

**Files:**

- Create: `apps/desktop/scripts/markdown-migration-health.sh`
- Modify: `apps/desktop/package.json`
- Test: `apps/desktop/scripts/markdown-migration-health.sh`

**Step 1: Write the failing test**

```bash
# apps/desktop/scripts/markdown-migration-health.sh
#!/usr/bin/env bash
set -euo pipefail

pnpm --filter @sakti-code/desktop exec vitest run tests/unit/components/markdown.test.tsx
pnpm --filter @sakti-code/desktop exec vitest run tests/unit/components/markdown-streaming.test.tsx
pnpm --filter @sakti-code/desktop exec vitest run tests/unit/views/workspace-view/chat-area/parts/text-part.test.tsx
pnpm --filter @sakti-code/desktop exec vitest run tests/unit/views/workspace-view/chat-area/parts/reasoning-part.test.tsx
pnpm --filter @sakti-code/desktop exec vitest run tests/integration/markdown-stream-stress.test.tsx
pnpm --filter @sakti-code/desktop exec vitest run tests/integration/markdown-benchmark.report.test.tsx
pnpm --filter @sakti-code/desktop typecheck
pnpm --filter @sakti-code/desktop lint
```

**Step 2: Run test to verify it fails**

Run: `bash apps/desktop/scripts/markdown-migration-health.sh`
Expected: FAIL because script is not yet executable and package script alias not present.

**Step 3: Write minimal implementation**

```json
{
  "scripts": {
    "markdown:migration:health": "bash ./scripts/markdown-migration-health.sh"
  }
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @sakti-code/desktop markdown:migration:health`
Expected: Executes full matrix; failures are actionable but command path is stable.

**Step 5: Commit**

```bash
git add apps/desktop/scripts/markdown-migration-health.sh apps/desktop/package.json
git commit -m "chore(desktop): add markdown migration health matrix script"
```

---

### Task 4: Add Dedicated Stream Fixture Utility For Unit Tests

**Files:**

- Create: `apps/desktop/tests/helpers/markdown-stream-fixtures.ts`
- Modify: `apps/desktop/tests/unit/components/markdown-streaming.test.tsx`
- Test: `apps/desktop/tests/helpers/markdown-stream-fixtures.ts`

**Step 1: Write the failing test**

```ts
// tests/unit/components/markdown-streaming.test.tsx
import { createChunkSequence } from "@/../tests/helpers/markdown-stream-fixtures";

it("builds deterministic chunk sequences", () => {
  const chunks = createChunkSequence("abcdef", 2);
  expect(chunks).toEqual(["ab", "cd", "ef"]);
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @sakti-code/desktop exec vitest run tests/unit/components/markdown-streaming.test.tsx -t "builds deterministic chunk sequences"`
Expected: FAIL with module not found.

**Step 3: Write minimal implementation**

```ts
// apps/desktop/tests/helpers/markdown-stream-fixtures.ts
export function createChunkSequence(text: string, size: number): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += size) {
    chunks.push(text.slice(i, i + size));
  }
  return chunks;
}
```

**Step 4: Run test to verify it passes**

Run command above.
Expected: PASS deterministic chunk helper test.

**Step 5: Commit**

```bash
git add apps/desktop/tests/helpers/markdown-stream-fixtures.ts apps/desktop/tests/unit/components/markdown-streaming.test.tsx
git commit -m "test(desktop): add markdown stream fixture helper"
```

---

### Task 5: Add Failing Unit Tests For Async Stream Queue Primitive

**Files:**

- Create: `apps/desktop/tests/unit/components/markdown-stream-queue.test.ts`
- Create: `apps/desktop/src/components/ui/markdown-stream-queue.ts`
- Test: `apps/desktop/tests/unit/components/markdown-stream-queue.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { createMarkdownStreamQueue } from "@/components/ui/markdown-stream-queue";

describe("markdown-stream-queue", () => {
  it("yields pushed chunks in order", async () => {
    const q = createMarkdownStreamQueue();
    const stream = q.stream();

    q.push("hello");
    q.push(" world");
    q.close();

    const out: string[] = [];
    for await (const chunk of stream) out.push(chunk);
    expect(out).toEqual(["hello", " world"]);
  });

  it("stops when closed", async () => {
    const q = createMarkdownStreamQueue();
    q.close();
    const out: string[] = [];
    for await (const chunk of q.stream()) out.push(chunk);
    expect(out).toEqual([]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @sakti-code/desktop exec vitest run tests/unit/components/markdown-stream-queue.test.ts`
Expected: FAIL module not found and missing exports.

**Step 3: Write minimal implementation**

```ts
export interface MarkdownStreamQueue {
  stream: () => AsyncGenerator<string>;
  push: (chunk: string) => void;
  close: () => void;
  reset: () => void;
}

export function createMarkdownStreamQueue(): MarkdownStreamQueue {
  const pending: string[] = [];
  let done = false;
  let notify: (() => void) | null = null;

  async function* stream(): AsyncGenerator<string> {
    while (true) {
      while (pending.length > 0) {
        const next = pending.shift();
        if (next !== undefined) yield next;
      }
      if (done) return;
      await new Promise<void>(resolve => {
        notify = resolve;
      });
      notify = null;
    }
  }

  return {
    stream,
    push: chunk => {
      if (done || !chunk) return;
      pending.push(chunk);
      notify?.();
    },
    close: () => {
      done = true;
      notify?.();
    },
    reset: () => {
      pending.length = 0;
      done = false;
      notify?.();
    },
  };
}
```

**Step 4: Run test to verify it passes**

Run command above.
Expected: PASS for ordered-yield and close semantics.

**Step 5: Commit**

```bash
git add apps/desktop/src/components/ui/markdown-stream-queue.ts apps/desktop/tests/unit/components/markdown-stream-queue.test.ts
git commit -m "feat(desktop): add markdown async stream queue primitive"
```

---

### Task 6: Extend Stream Queue Tests For Cleanup Safety

**Files:**

- Modify: `apps/desktop/tests/unit/components/markdown-stream-queue.test.ts`
- Modify: `apps/desktop/src/components/ui/markdown-stream-queue.ts`
- Test: `apps/desktop/tests/unit/components/markdown-stream-queue.test.ts`

**Step 1: Write the failing test**

```ts
it("ignores pushes after close", async () => {
  const q = createMarkdownStreamQueue();
  q.push("a");
  q.close();
  q.push("b");

  const out: string[] = [];
  for await (const chunk of q.stream()) out.push(chunk);
  expect(out).toEqual(["a"]);
});

it("resets and accepts new chunks", async () => {
  const q = createMarkdownStreamQueue();
  q.push("x");
  q.close();
  q.reset();
  q.push("y");
  q.close();
  const out: string[] = [];
  for await (const chunk of q.stream()) out.push(chunk);
  expect(out).toContain("y");
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @sakti-code/desktop exec vitest run tests/unit/components/markdown-stream-queue.test.ts`
Expected: FAIL reset semantics are inconsistent across closed streams.

**Step 3: Write minimal implementation**

```ts
// refine queue internals to isolate each stream lifecycle
let generation = 0;

function reset() {
  generation += 1;
  pending.length = 0;
  done = false;
  notify?.();
}

async function* stream(): AsyncGenerator<string> {
  const localGeneration = generation;
  while (localGeneration === generation) {
    // existing drain + wait loop
  }
}
```

**Step 4: Run test to verify it passes**

Run command above.
Expected: PASS with deterministic close/reset behavior.

**Step 5: Commit**

```bash
git add apps/desktop/src/components/ui/markdown-stream-queue.ts apps/desktop/tests/unit/components/markdown-stream-queue.test.ts
git commit -m "test(desktop): harden markdown stream queue lifecycle semantics"
```

---

### Task 7: Add Failing Tests For Snapshot Diff Strategy

**Files:**

- Create: `apps/desktop/src/components/ui/markdown-stream-diff.ts`
- Create: `apps/desktop/tests/unit/components/markdown-stream-diff.test.ts`
- Test: `apps/desktop/tests/unit/components/markdown-stream-diff.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { computeStreamDelta } from "@/components/ui/markdown-stream-diff";

describe("markdown-stream-diff", () => {
  it("returns append delta when next extends prev", () => {
    expect(computeStreamDelta("hello", "hello world")).toEqual({
      type: "append",
      chunk: " world",
    });
  });

  it("returns reset when next does not extend prev", () => {
    expect(computeStreamDelta("hello world", "hello")).toEqual({
      type: "reset",
      snapshot: "hello",
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @sakti-code/desktop exec vitest run tests/unit/components/markdown-stream-diff.test.ts`
Expected: FAIL due to missing module/export.

**Step 3: Write minimal implementation**

```ts
export type StreamDeltaResult =
  | { type: "append"; chunk: string }
  | { type: "reset"; snapshot: string };

export function computeStreamDelta(prev: string, next: string): StreamDeltaResult {
  if (next.startsWith(prev)) {
    return { type: "append", chunk: next.slice(prev.length) };
  }
  return { type: "reset", snapshot: next };
}
```

**Step 4: Run test to verify it passes**

Run command above.
Expected: PASS for append and reset branches.

**Step 5: Commit**

```bash
git add apps/desktop/src/components/ui/markdown-stream-diff.ts apps/desktop/tests/unit/components/markdown-stream-diff.test.ts
git commit -m "feat(desktop): add markdown snapshot diff helper for stream mode"
```

---

### Task 8: Extend Diff Tests For Empty And Idempotent Inputs

**Files:**

- Modify: `apps/desktop/tests/unit/components/markdown-stream-diff.test.ts`
- Modify: `apps/desktop/src/components/ui/markdown-stream-diff.ts`
- Test: `apps/desktop/tests/unit/components/markdown-stream-diff.test.ts`

**Step 1: Write the failing test**

```ts
it("returns append with empty chunk when unchanged", () => {
  expect(computeStreamDelta("abc", "abc")).toEqual({
    type: "append",
    chunk: "",
  });
});

it("handles empty previous snapshot", () => {
  expect(computeStreamDelta("", "abc")).toEqual({
    type: "append",
    chunk: "abc",
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @sakti-code/desktop exec vitest run tests/unit/components/markdown-stream-diff.test.ts`
Expected: FAIL if helper normalizes empty chunk incorrectly.

**Step 3: Write minimal implementation**

```ts
export function computeStreamDelta(prev: string, next: string): StreamDeltaResult {
  const safePrev = prev ?? "";
  const safeNext = next ?? "";
  if (safeNext.startsWith(safePrev)) {
    return { type: "append", chunk: safeNext.slice(safePrev.length) };
  }
  return { type: "reset", snapshot: safeNext };
}
```

**Step 4: Run test to verify it passes**

Run command above.
Expected: PASS with deterministic empty/idempotent handling.

**Step 5: Commit**

```bash
git add apps/desktop/src/components/ui/markdown-stream-diff.ts apps/desktop/tests/unit/components/markdown-stream-diff.test.ts
git commit -m "test(desktop): cover markdown stream diff edge cases"
```

---

### Task 9: Add Failing Tests For Stream Adapter Orchestrator

**Files:**

- Create: `apps/desktop/src/components/ui/markdown-stream-adapter.ts`
- Create: `apps/desktop/tests/unit/components/markdown-stream-adapter.test.ts`
- Test: `apps/desktop/tests/unit/components/markdown-stream-adapter.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { createMarkdownStreamAdapter } from "@/components/ui/markdown-stream-adapter";

describe("markdown-stream-adapter", () => {
  it("appends only deltas for monotonic snapshots", async () => {
    const adapter = createMarkdownStreamAdapter();
    adapter.update("hello", true);
    adapter.update("hello world", true);
    adapter.finish();

    const out: string[] = [];
    for await (const chunk of adapter.stream()) out.push(chunk);
    expect(out).toEqual(["hello", " world"]);
  });

  it("resets stream when snapshot rewinds", async () => {
    const adapter = createMarkdownStreamAdapter();
    adapter.update("abc", true);
    adapter.update("a", true);
    adapter.finish();

    const out: string[] = [];
    for await (const chunk of adapter.stream()) out.push(chunk);
    expect(out[out.length - 1]).toBe("a");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @sakti-code/desktop exec vitest run tests/unit/components/markdown-stream-adapter.test.ts`
Expected: FAIL module not found and missing API.

**Step 3: Write minimal implementation**

```ts
import { computeStreamDelta } from "@/components/ui/markdown-stream-diff";
import { createMarkdownStreamQueue } from "@/components/ui/markdown-stream-queue";

export interface MarkdownStreamAdapter {
  stream: () => AsyncGenerator<string>;
  update: (snapshot: string, isStreaming: boolean) => void;
  finish: () => void;
  reset: () => void;
  dispose: () => void;
  getRunId: () => number;
}

export function createMarkdownStreamAdapter(): MarkdownStreamAdapter {
  let previous = "";
  let runId = 0;
  let queue = createMarkdownStreamQueue();

  const reset = () => {
    queue.close();
    queue = createMarkdownStreamQueue();
    previous = "";
    runId += 1;
  };

  return {
    stream: () => queue.stream(),
    update: (snapshot, isStreaming) => {
      const delta = computeStreamDelta(previous, snapshot);
      if (delta.type === "append") {
        if (delta.chunk) queue.push(delta.chunk);
      } else {
        reset();
        if (delta.snapshot) queue.push(delta.snapshot);
      }
      previous = snapshot;
      if (!isStreaming) queue.close();
    },
    finish: () => queue.close(),
    reset,
    dispose: () => queue.close(),
    getRunId: () => runId,
  };
}
```

**Step 4: Run test to verify it passes**

Run command above.
Expected: PASS with monotonic append + rewind reset behavior.

**Step 5: Commit**

```bash
git add apps/desktop/src/components/ui/markdown-stream-adapter.ts apps/desktop/tests/unit/components/markdown-stream-adapter.test.ts
git commit -m "feat(desktop): add markdown stream adapter for snapshot updates"
```

---

### Task 10: Add Adapter Tests For Finish/Dispose Idempotency

**Files:**

- Modify: `apps/desktop/tests/unit/components/markdown-stream-adapter.test.ts`
- Modify: `apps/desktop/src/components/ui/markdown-stream-adapter.ts`
- Test: `apps/desktop/tests/unit/components/markdown-stream-adapter.test.ts`

**Step 1: Write the failing test**

```ts
it("finish is idempotent", async () => {
  const adapter = createMarkdownStreamAdapter();
  adapter.update("x", true);
  adapter.finish();
  adapter.finish();
  const out: string[] = [];
  for await (const chunk of adapter.stream()) out.push(chunk);
  expect(out).toEqual(["x"]);
});

it("dispose closes stream without throwing", async () => {
  const adapter = createMarkdownStreamAdapter();
  adapter.update("x", true);
  expect(() => adapter.dispose()).not.toThrow();
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @sakti-code/desktop exec vitest run tests/unit/components/markdown-stream-adapter.test.ts`
Expected: FAIL due to closed-stream race conditions.

**Step 3: Write minimal implementation**

```ts
let closed = false;

const closeSafely = () => {
  if (closed) return;
  closed = true;
  queue.close();
};

finish: () => closeSafely(),
dispose: () => closeSafely(),
reset: () => {
  closeSafely();
  queue = createMarkdownStreamQueue();
  closed = false;
  previous = "";
  runId += 1;
},
```

**Step 4: Run test to verify it passes**

Run command above.
Expected: PASS with idempotent finish/dispose semantics.

**Step 5: Commit**

```bash
git add apps/desktop/src/components/ui/markdown-stream-adapter.ts apps/desktop/tests/unit/components/markdown-stream-adapter.test.ts
git commit -m "test(desktop): harden markdown stream adapter lifecycle"
```

---

### Task 11: Add Failing Smoke Test For Incremark Dependencies

**Files:**

- Modify: `apps/desktop/tests/unit/components/markdown.test.tsx`
- Modify: `apps/desktop/package.json`
- Test: `apps/desktop/tests/unit/components/markdown.test.tsx`

**Step 1: Write the failing test**

```ts
it("loads incremark packages", async () => {
  const solid = await import("@incremark/solid");
  expect(solid).toBeDefined();
  const theme = await import("@incremark/theme/styles.css");
  expect(theme).toBeDefined();
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @sakti-code/desktop exec vitest run tests/unit/components/markdown.test.tsx -t "loads incremark packages"`
Expected: FAIL with module not found.

**Step 3: Write minimal implementation**

```json
{
  "dependencies": {
    "@incremark/solid": "<pin-latest-compatible>",
    "@incremark/theme": "<pin-latest-compatible>"
  }
}
```

Then run: `pnpm install`.

**Step 4: Run test to verify it passes**

Run command above.
Expected: PASS import smoke test.

**Step 5: Commit**

```bash
git add apps/desktop/package.json pnpm-lock.yaml apps/desktop/tests/unit/components/markdown.test.tsx
git commit -m "chore(desktop): add incremark dependencies for markdown migration"
```

---

### Task 12: Import Incremark Theme CSS Globally Once

**Files:**

- Modify: `apps/desktop/src/main.tsx`
- Test: `apps/desktop/tests/unit/components/markdown.test.tsx`

**Step 1: Write the failing test**

```ts
it("renders markdown with incremark base theme classes applied", async () => {
  const { Markdown } = await import("@/components/ui/markdown");
  // render smoke; expectation is theme CSS import does not crash runtime
  expect(Markdown).toBeTypeOf("function");
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @sakti-code/desktop exec vitest run tests/unit/components/markdown.test.tsx -t "renders markdown with incremark base theme classes applied"`
Expected: FAIL if runtime theme tokens or CSS import path is missing.

**Step 3: Write minimal implementation**

```ts
// apps/desktop/src/main.tsx
import "@incremark/theme/styles.css";
import "./assets/main.css";
```

**Step 4: Run test to verify it passes**

Run command above.
Expected: PASS; app/test bundle resolves theme CSS.

**Step 5: Commit**

```bash
git add apps/desktop/src/main.tsx apps/desktop/tests/unit/components/markdown.test.tsx
git commit -m "feat(desktop): import incremark theme styles globally"
```

---

### Task 13: Add Failing Tests For Stream-Mode Markdown Baseline Rendering

**Files:**

- Modify: `apps/desktop/tests/unit/components/markdown.test.tsx`
- Modify: `apps/desktop/src/components/ui/markdown.tsx`
- Test: `apps/desktop/tests/unit/components/markdown.test.tsx`

**Step 1: Write the failing test**

```ts
it("renders plain markdown through incremark", async () => {
  const { Markdown } = await import("@/components/ui/markdown");
  dispose = render(() => <Markdown text="Hello **world**" isStreaming={false} />, container);
  await vi.waitFor(() => {
    expect(container.textContent).toContain("Hello");
    expect(container.textContent).toContain("world");
  });
});

it("preserves data-component attribute for selectors", async () => {
  const { Markdown } = await import("@/components/ui/markdown");
  dispose = render(() => <Markdown text="x" />, container);
  await vi.waitFor(() => {
    expect(container.querySelector('[data-component="markdown"]')).not.toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @sakti-code/desktop exec vitest run tests/unit/components/markdown.test.tsx -t "renders plain markdown through incremark"`
Expected: FAIL because component is still marked-based.

**Step 3: Write minimal implementation**

```tsx
// replace markdown.tsx with Incremark stream-mode skeleton (no content-mode bootstrap)
import { createMarkdownStreamAdapter } from "@/components/ui/markdown-stream-adapter";
import { IncremarkContent } from "@incremark/solid";
import { cn } from "@/utils";
import { Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";

export function Markdown(props: { text: string; class?: string; isStreaming?: boolean }) {
  const adapter = createMarkdownStreamAdapter();
  const [runId, setRunId] = createSignal(0);
  const streamFn = createMemo(() => () => adapter.stream());

  createEffect(() => {
    adapter.update(props.text ?? "", props.isStreaming ?? false);
    setRunId(adapter.getRunId());
  });

  onCleanup(() => adapter.dispose());

  return (
    <div
      data-component="markdown"
      data-run-id={runId()}
      class={cn("prose prose-sm max-w-none", props.class)}
    >
      <Show when={streamFn()} keyed>
        {fn => (
          <IncremarkContent
            stream={fn}
            incremarkOptions={{ htmlTree: false, gfm: true, containers: true, math: true }}
          />
        )}
      </Show>
    </div>
  );
}
```

**Step 4: Run test to verify it passes**

Run command above.
Expected: PASS for static rendering + attribute checks.

**Step 5: Commit**

```bash
git add apps/desktop/src/components/ui/markdown.tsx apps/desktop/tests/unit/components/markdown.test.tsx
git commit -m "feat(desktop): initialize markdown renderer directly in incremark stream mode"
```

---

### Task 14: Harden Stream-Mode Lifecycle Wiring In Markdown Component

**Files:**

- Modify: `apps/desktop/src/components/ui/markdown.tsx`
- Modify: `apps/desktop/tests/unit/components/markdown-streaming.test.tsx`
- Test: `apps/desktop/tests/unit/components/markdown-streaming.test.tsx`

**Step 1: Write the failing test**

```ts
it("uses stream mode and updates rendered output while streaming", async () => {
  const { Markdown } = await import("@/components/ui/markdown");
  const [text, setText] = createSignal("Hello");
  const [streaming, setStreaming] = createSignal(true);

  dispose = render(() => <Markdown text={text()} isStreaming={streaming()} />, container);

  setText("Hello world");
  await vi.waitFor(() => expect(container.textContent).toContain("world"));

  setStreaming(false);
  await vi.waitFor(() => expect(container.textContent).toContain("Hello world"));
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @sakti-code/desktop exec vitest run tests/unit/components/markdown-streaming.test.tsx -t "uses stream mode and updates rendered output while streaming"`
Expected: FAIL because stream lifecycle wiring is incomplete (stream factory/run key/finalization behavior not yet stable).

**Step 3: Write minimal implementation**

```tsx
// markdown.tsx lifecycle refinements
const runKey = createMemo(() => runId());
const streamFactory = createMemo(() => {
  runKey(); // rebuild factory when adapter generation changes
  return () => adapter.stream();
});

createEffect(() => {
  const text = props.text ?? "";
  const isStreaming = props.isStreaming ?? false;
  adapter.update(text, isStreaming);
  setRunId(adapter.getRunId());
  if (!isStreaming) adapter.finish();
});

onCleanup(() => adapter.dispose());

<Show when={streamFactory()} keyed>
  {fn => <IncremarkContent stream={fn} incremarkOptions={INCREMARK_OPTIONS} />}
</Show>;
```

**Step 4: Run test to verify it passes**

Run command above.
Expected: PASS and visible streaming updates.

**Step 5: Commit**

```bash
git add apps/desktop/src/components/ui/markdown.tsx apps/desktop/tests/unit/components/markdown-streaming.test.tsx
git commit -m "fix(desktop): harden markdown stream-mode lifecycle wiring"
```

---

### Task 15: Add Failing Tests For Monotonic Append Behavior In Stream Mode

**Files:**

- Modify: `apps/desktop/tests/unit/components/markdown-streaming.test.tsx`
- Modify: `apps/desktop/src/components/ui/markdown.tsx`
- Test: `apps/desktop/tests/unit/components/markdown-streaming.test.tsx`

**Step 1: Write the failing test**

```ts
it("handles frequent monotonic updates without losing tail text", async () => {
  const { Markdown } = await import("@/components/ui/markdown");
  const [text, setText] = createSignal("a");
  dispose = render(() => <Markdown text={text()} isStreaming={true} />, container);

  for (let i = 0; i < 50; i++) setText(`a${"b".repeat(i)}`);

  await vi.waitFor(() => {
    expect(container.textContent).toContain("abbbbb");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @sakti-code/desktop exec vitest run tests/unit/components/markdown-streaming.test.tsx -t "handles frequent monotonic updates without losing tail text"`
Expected: FAIL intermittently due adapter race.

**Step 3: Write minimal implementation**

```ts
// in adapter + component
// ensure update ordering is serialized
let lastUpdate = Promise.resolve();

const enqueueUpdate = (snapshot: string, isStreaming: boolean) => {
  lastUpdate = lastUpdate.then(async () => {
    adapter.update(snapshot, isStreaming);
    setRunId(adapter.getRunId());
  });
};
```

**Step 4: Run test to verify it passes**

Run command above.
Expected: PASS with no tail-loss across frequent updates.

**Step 5: Commit**

```bash
git add apps/desktop/src/components/ui/markdown.tsx apps/desktop/tests/unit/components/markdown-streaming.test.tsx
git commit -m "fix(desktop): stabilize incremark stream updates under high-frequency input"
```

---

### Task 16: Add Failing Tests For Non-Monotonic Reset Handling

**Files:**

- Modify: `apps/desktop/tests/unit/components/markdown-streaming.test.tsx`
- Modify: `apps/desktop/src/components/ui/markdown.tsx`
- Test: `apps/desktop/tests/unit/components/markdown-streaming.test.tsx`

**Step 1: Write the failing test**

```ts
it("resets rendering stream when upstream snapshot rewinds", async () => {
  const { Markdown } = await import("@/components/ui/markdown");
  const [text, setText] = createSignal("abcdef");
  dispose = render(() => <Markdown text={text()} isStreaming={true} />, container);

  await vi.waitFor(() => expect(container.textContent).toContain("abcdef"));
  setText("abc");
  await vi.waitFor(() => expect(container.textContent).toContain("abc"));
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @sakti-code/desktop exec vitest run tests/unit/components/markdown-streaming.test.tsx -t "resets rendering stream when upstream snapshot rewinds"`
Expected: FAIL with stale suffix still visible.

**Step 3: Write minimal implementation**

```tsx
// when adapter runId increments, re-key IncremarkContent
<div data-run-id={runId()}>
  <Show when={streamFactory()} keyed>
    {fn => <IncremarkContent stream={fn} ... />}
  </Show>
</div>
```

Also ensure `reset` path pushes full snapshot into new queue before close.

**Step 4: Run test to verify it passes**

Run command above.
Expected: PASS with correct rewind behavior.

**Step 5: Commit**

```bash
git add apps/desktop/src/components/ui/markdown.tsx apps/desktop/tests/unit/components/markdown-streaming.test.tsx
git commit -m "fix(desktop): reset incremark stream on non-monotonic markdown snapshots"
```

---

### Task 17: Add Failing Tests For Stream Finalization On Completion

**Files:**

- Modify: `apps/desktop/tests/unit/components/markdown-streaming.test.tsx`
- Modify: `apps/desktop/src/components/ui/markdown.tsx`
- Test: `apps/desktop/tests/unit/components/markdown-streaming.test.tsx`

**Step 1: Write the failing test**

```ts
it("finalizes active stream when isStreaming flips false", async () => {
  const { Markdown } = await import("@/components/ui/markdown");
  const [text, setText] = createSignal("hello");
  const [streaming, setStreaming] = createSignal(true);

  dispose = render(() => <Markdown text={text()} isStreaming={streaming()} />, container);
  setText("hello world");
  setStreaming(false);

  await vi.waitFor(() => expect(container.textContent).toContain("hello world"));
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @sakti-code/desktop exec vitest run tests/unit/components/markdown-streaming.test.tsx -t "finalizes active stream when isStreaming flips false"`
Expected: FAIL or flake due stream not closing promptly.

**Step 3: Write minimal implementation**

```ts
createEffect(() => {
  const activeStreaming = props.isStreaming ?? false;
  if (!activeStreaming) {
    adapter.finish();
  }
});
```

**Step 4: Run test to verify it passes**

Run command above.
Expected: PASS, stable completion behavior.

**Step 5: Commit**

```bash
git add apps/desktop/src/components/ui/markdown.tsx apps/desktop/tests/unit/components/markdown-streaming.test.tsx
git commit -m "fix(desktop): finalize incremark stream when streaming ends"
```

---

### Task 18: Add Failing Security Tests For Raw HTML Blocking

**Files:**

- Modify: `apps/desktop/tests/unit/components/markdown.test.tsx`
- Modify: `apps/desktop/src/components/ui/markdown.tsx`
- Test: `apps/desktop/tests/unit/components/markdown.test.tsx`

**Step 1: Write the failing test**

```ts
it("does not render raw html nodes from markdown input", async () => {
  const { Markdown } = await import("@/components/ui/markdown");
  dispose = render(() => <Markdown text={'safe\n<div data-xss="1">unsafe</div>'} />, container);

  await vi.waitFor(() => {
    expect(container.textContent).toContain("safe");
  });

  const injected = container.querySelector('[data-xss="1"]');
  expect(injected).toBeNull();
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @sakti-code/desktop exec vitest run tests/unit/components/markdown.test.tsx -t "does not render raw html nodes from markdown input"`
Expected: FAIL if `htmlTree` not forced off.

**Step 3: Write minimal implementation**

```tsx
<IncremarkContent
  stream={fn}
  incremarkOptions={{
    gfm: true,
    math: true,
    containers: true,
    htmlTree: false,
  }}
/>
```

**Step 4: Run test to verify it passes**

Run command above.
Expected: PASS; raw HTML not inserted as DOM node.

**Step 5: Commit**

```bash
git add apps/desktop/src/components/ui/markdown.tsx apps/desktop/tests/unit/components/markdown.test.tsx
git commit -m "sec(desktop): disable htmlTree in incremark markdown renderer"
```

---

### Task 19: Add Failing Tests For Code Fence Highlighted Rendering Presence

**Files:**

- Modify: `apps/desktop/tests/unit/components/markdown.test.tsx`
- Modify: `apps/desktop/src/components/ui/markdown.tsx`
- Test: `apps/desktop/tests/unit/components/markdown.test.tsx`

**Step 1: Write the failing test**

````ts
it("renders fenced code block with code container", async () => {
  const { Markdown } = await import("@/components/ui/markdown");
  const code = "```ts\nconst answer = 42\n```";
  dispose = render(() => <Markdown text={code} isStreaming={false} />, container);

  await vi.waitFor(() => {
    const pre = container.querySelector("pre");
    const codeNode = container.querySelector("code");
    expect(pre).not.toBeNull();
    expect(codeNode).not.toBeNull();
  });
});
````

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @sakti-code/desktop exec vitest run tests/unit/components/markdown.test.tsx -t "renders fenced code block with code container"`
Expected: FAIL if renderer fails to process fence during stream completion.

**Step 3: Write minimal implementation**

```ts
// Ensure stream completes for non-streaming snapshot
createEffect(() => {
  const text = props.text ?? "";
  adapter.update(text, props.isStreaming ?? false);
  if (!(props.isStreaming ?? false)) adapter.finish();
});
```

**Step 4: Run test to verify it passes**

Run command above.
Expected: PASS code fence render smoke.

**Step 5: Commit**

```bash
git add apps/desktop/src/components/ui/markdown.tsx apps/desktop/tests/unit/components/markdown.test.tsx
git commit -m "fix(desktop): ensure fenced markdown finalizes in non-stream mode"
```

---

### Task 20: Add Failing Tests For Unmount Cleanup And Timer-Free Lifecycle

**Files:**

- Modify: `apps/desktop/tests/unit/components/markdown-streaming.test.tsx`
- Modify: `apps/desktop/src/components/ui/markdown.tsx`
- Test: `apps/desktop/tests/unit/components/markdown-streaming.test.tsx`

**Step 1: Write the failing test**

```ts
it("cleans up stream adapter on unmount without throwing", async () => {
  const { Markdown } = await import("@/components/ui/markdown");
  const [text, setText] = createSignal("x");
  dispose = render(() => <Markdown text={text()} isStreaming={true} />, container);
  setText("xy");
  expect(() => dispose()).not.toThrow();
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @sakti-code/desktop exec vitest run tests/unit/components/markdown-streaming.test.tsx -t "cleans up stream adapter on unmount without throwing"`
Expected: FAIL if stream generator continues waiting after dispose.

**Step 3: Write minimal implementation**

```ts
onCleanup(() => {
  adapter.dispose();
});
```

Ensure no `setTimeout`, `requestIdleCallback`, or `morphdom` lifecycle remains in component.

**Step 4: Run test to verify it passes**

Run command above.
Expected: PASS cleanup path stable.

**Step 5: Commit**

```bash
git add apps/desktop/src/components/ui/markdown.tsx apps/desktop/tests/unit/components/markdown-streaming.test.tsx
git commit -m "refactor(desktop): remove legacy markdown lifecycle cleanup complexity"
```

---

### Task 21: Update TextPart Tests For Incremark-Backed Markdown Semantics

**Files:**

- Modify: `apps/desktop/tests/unit/views/workspace-view/chat-area/parts/text-part.test.tsx`
- Modify: `apps/desktop/src/views/workspace-view/chat-area/parts/text-part.tsx`
- Test: `apps/desktop/tests/unit/views/workspace-view/chat-area/parts/text-part.test.tsx`

**Step 1: Write the failing test**

```ts
it("renders text part via incremark markdown component", async () => {
  const part = { type: "text", text: "Hello **stream**" };
  dispose = render(() => <TextPart part={part} isStreaming={false} />, container);

  await vi.waitFor(() => {
    expect(container.querySelector('[data-component="markdown"]')).not.toBeNull();
    expect(container.textContent).toContain("stream");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @sakti-code/desktop exec vitest run tests/unit/views/workspace-view/chat-area/parts/text-part.test.tsx -t "renders text part via incremark markdown component"`
Expected: FAIL if text-part assumptions still depend on old markdown internals.

**Step 3: Write minimal implementation**

```tsx
// keep TextPart API unchanged; ensure Markdown props passed remain valid
<Markdown
  text={throttledText()}
  isStreaming={props.isStreaming}
  isScrollActive={props.isScrollActive}
  deferHighlightUntilComplete={true}
  pauseWhileScrolling={true}
/>
```

(If props removed from `MarkdownProps`, clean TextPart call to pass only supported props.)

**Step 4: Run test to verify it passes**

Run command above.
Expected: PASS TextPart still renders and copy button behavior unchanged.

**Step 5: Commit**

```bash
git add apps/desktop/src/views/workspace-view/chat-area/parts/text-part.tsx apps/desktop/tests/unit/views/workspace-view/chat-area/parts/text-part.test.tsx
git commit -m "test(desktop): align text-part tests with incremark markdown renderer"
```

---

### Task 22: Update ReasoningPart Tests For Incremark-Backed Markdown Semantics

**Files:**

- Modify: `apps/desktop/tests/unit/views/workspace-view/chat-area/parts/reasoning-part.test.tsx`
- Modify: `apps/desktop/src/views/workspace-view/chat-area/parts/reasoning-part.tsx`
- Test: `apps/desktop/tests/unit/views/workspace-view/chat-area/parts/reasoning-part.test.tsx`

**Step 1: Write the failing test**

```ts
it("renders reasoning markdown through incremark-backed Markdown", async () => {
  const part = { type: "reasoning", text: "*thinking*" };
  dispose = render(() => <ReasoningPart part={part} isStreaming={false} />, container);

  await vi.waitFor(() => {
    expect(container.querySelector('[data-component="markdown"]')).not.toBeNull();
    expect(container.textContent).toContain("thinking");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @sakti-code/desktop exec vitest run tests/unit/views/workspace-view/chat-area/parts/reasoning-part.test.tsx -t "renders reasoning markdown through incremark-backed Markdown"`
Expected: FAIL if reasoning part depends on old streaming cadence details.

**Step 3: Write minimal implementation**

```tsx
// keep usage path; remove obsolete markdown props if no longer accepted
<Markdown
  text={throttledText()}
  class="prose-p:m-0"
  isStreaming={props.isStreaming}
  isScrollActive={props.isScrollActive}
/>
```

**Step 4: Run test to verify it passes**

Run command above.
Expected: PASS reasoning markdown path stable.

**Step 5: Commit**

```bash
git add apps/desktop/src/views/workspace-view/chat-area/parts/reasoning-part.tsx apps/desktop/tests/unit/views/workspace-view/chat-area/parts/reasoning-part.test.tsx
git commit -m "test(desktop): align reasoning-part markdown behavior with incremark"
```

---

### Task 23: Rewrite Markdown Unit Tests Away From Marked/Shiki Mocks

**Files:**

- Modify: `apps/desktop/tests/unit/components/markdown.test.tsx`
- Modify: `apps/desktop/tests/unit/components/markdown-streaming.test.tsx`
- Test: `apps/desktop/tests/unit/components/markdown.test.tsx`

**Step 1: Write the failing test**

```ts
// remove old vi.mock("shiki") and marked.parse spies
it("does not depend on marked parse spy assertions", async () => {
  const markedImportAttempt = await import("marked").catch(() => null);
  // this test should not assert parse call counts anymore
  expect(markedImportAttempt === null || typeof markedImportAttempt === "object").toBe(true);
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @sakti-code/desktop exec vitest run tests/unit/components/markdown.test.tsx`
Expected: FAIL because old tests still reference marked/shiki mocks.

**Step 3: Write minimal implementation**

```ts
// new assertions focus on rendered DOM/text behavior
// - text appears under streaming
// - fenced code renders
// - htmlTree false blocks raw html
// - rewind resets output
```

Remove all references to:

- `vi.mock("shiki", ...)`
- `import("marked")`
- `parseSpy`

**Step 4: Run test to verify it passes**

Run:
`pnpm --filter @sakti-code/desktop exec vitest run tests/unit/components/markdown.test.tsx tests/unit/components/markdown-streaming.test.tsx`
Expected: PASS with behavior-based assertions only.

**Step 5: Commit**

```bash
git add apps/desktop/tests/unit/components/markdown.test.tsx apps/desktop/tests/unit/components/markdown-streaming.test.tsx
git commit -m "test(desktop): migrate markdown unit tests to incremark behavior assertions"
```

---

### Task 24: Rewrite Integration Stress Tests Without Legacy Telemetry API

**Files:**

- Modify: `apps/desktop/tests/integration/markdown-stream-stress.test.tsx`
- Modify: `apps/desktop/tests/integration/markdown-benchmark.report.test.tsx`
- Modify: `apps/desktop/package.json`
- Test: `apps/desktop/tests/integration/markdown-stream-stress.test.tsx`

**Step 1: Write the failing test**

```ts
// remove imports from markdown-perf-telemetry
// use direct lag sampling + DOM outcome assertions instead
it("streams long markdown without event-loop spikes", async () => {
  // existing lagSamples pattern retained + percentile SLO checks
  expect(p95Lag).toBeLessThanOrEqual(100);
  expect(p99Lag).toBeLessThanOrEqual(150);
  expect(container.textContent).toContain("Streaming Load");
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @sakti-code/desktop exec vitest run tests/integration/markdown-stream-stress.test.tsx`
Expected: FAIL due stale telemetry import references.

**Step 3: Write minimal implementation**

```ts
// in both integration tests:
// - remove getMarkdownPerfSnapshot/resetMarkdownPerfTelemetry
// - keep stream replay + lag probe
// - compute and assert lag percentiles (p95 <= 100ms, p99 <= 150ms)
// - benchmark report persists raw lag + percentile + duration metrics computed in-test
```

Update script:

```json
{
  "scripts": {
    "test:perf": "PERF_BENCH=1 vitest run tests/integration/markdown-stream-stress.test.tsx tests/integration/markdown-benchmark.report.test.tsx"
  }
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @sakti-code/desktop test:perf`
Expected: PASS and updated benchmark JSON emitted.

**Step 5: Commit**

```bash
git add apps/desktop/tests/integration/markdown-stream-stress.test.tsx apps/desktop/tests/integration/markdown-benchmark.report.test.tsx apps/desktop/package.json
git commit -m "test(desktop): migrate markdown perf integration tests off legacy telemetry"
```

---

### Task 25: Remove Legacy Markdown Helper Files And Their Unit Tests

**Files:**

- Delete: `apps/desktop/src/components/ui/markdown-finalizer.ts`
- Delete: `apps/desktop/src/components/ui/markdown-sanitizer.ts`
- Delete: `apps/desktop/tests/unit/components/markdown-finalizer.test.ts`
- Delete: `apps/desktop/tests/unit/components/markdown-sanitizer.test.ts`
- Modify: `apps/desktop/src/components/ui/markdown.tsx`
- Test: `apps/desktop/tests/unit/components/markdown.test.tsx`

**Step 1: Write the failing test**

```bash
rg -n "markdown-finalizer|markdown-sanitizer|sanitizeMarkdownHtml|finalizeMarkdownInChunks" apps/desktop/src apps/desktop/tests
```

Expected before removal: matches exist.

**Step 2: Run test to verify it fails**

Run command above.
Expected: FAIL migration rule because old helper references remain.

**Step 3: Write minimal implementation**

- Remove helper files.
- Remove imports from `markdown.tsx`.
- Remove or rewrite tests that target removed helpers.

**Step 4: Run test to verify it passes**

Run command above again.
Expected: no matches except migration-plan docs or intentional references.

Then run:
`pnpm --filter @sakti-code/desktop exec vitest run tests/unit/components/markdown.test.tsx`
Expected: PASS.

**Step 5: Commit**

```bash
git add -A apps/desktop/src/components/ui apps/desktop/tests/unit/components
git commit -m "refactor(desktop): remove marked-era markdown helper modules"
```

---

### Task 26: Remove Legacy Markdown Perf Telemetry Module And Tests

**Files:**

- Delete: `apps/desktop/src/core/chat/services/markdown-perf-telemetry.ts`
- Delete: `apps/desktop/tests/unit/core/chat/services/markdown-perf-telemetry.test.ts`
- Modify: `apps/desktop/tests/integration/markdown-stream-stress.test.tsx`
- Modify: `apps/desktop/tests/integration/markdown-benchmark.report.test.tsx`
- Test: `apps/desktop/tests/unit/core/chat/services`

**Step 1: Write the failing test**

```bash
rg -n "markdown-perf-telemetry|recordMarkdown|getMarkdownPerfSnapshot|resetMarkdownPerfTelemetry" apps/desktop/src apps/desktop/tests
```

**Step 2: Run test to verify it fails**

Run command above.
Expected: FAIL because telemetry references still present.

**Step 3: Write minimal implementation**

- Delete telemetry source and unit test.
- Remove references from integration tests.
- Ensure no imports remain.

**Step 4: Run test to verify it passes**

Run command above again.
Expected: no runtime references remain.

Then run:
`pnpm --filter @sakti-code/desktop exec vitest run tests/integration/markdown-stream-stress.test.tsx`
Expected: PASS.

**Step 5: Commit**

```bash
git add -A apps/desktop/src/core/chat/services apps/desktop/tests/unit/core/chat/services apps/desktop/tests/integration
git commit -m "refactor(desktop): remove obsolete markdown performance telemetry module"
```

---

### Task 27: Remove Marked Stack Dependencies And Update Lockfile

**Files:**

- Modify: `apps/desktop/package.json`
- Modify: `pnpm-lock.yaml`
- Test: dependency graph (`pnpm list`)

**Step 1: Write the failing test**

```bash
cd apps/desktop && pnpm list marked marked-shiki shiki dompurify morphdom --depth 0
```

Expected before removal: packages are present.

**Step 2: Run test to verify it fails**

Run command above.
Expected: FAIL migration rule because obsolete deps still installed for desktop package.

**Step 3: Write minimal implementation**

Update `apps/desktop/package.json` dependencies:

- Remove: `marked`, `marked-shiki`, `shiki`, `dompurify`, `morphdom`
- Keep/Add: `@incremark/solid`, `@incremark/theme`

Then run:

```bash
pnpm install
```

**Step 4: Run test to verify it passes**

Run:
`cd apps/desktop && pnpm list marked marked-shiki shiki dompurify morphdom --depth 0`
Expected: either empty/no direct deps for removed packages.

Run:
`pnpm --filter @sakti-code/desktop exec vitest run tests/unit/components/markdown.test.tsx`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/desktop/package.json pnpm-lock.yaml
git commit -m "chore(desktop): remove marked markdown stack dependencies"
```

---

### Task 28: Align CSS To Incremark Output And Keep Existing Visual Contract

**Files:**

- Modify: `apps/desktop/src/assets/main.css`
- Modify: `apps/desktop/tests/unit/components/markdown.test.tsx`
- Test: `apps/desktop/tests/unit/components/markdown.test.tsx`

**Step 1: Write the failing test**

````ts
it("keeps markdown root classes and code block visual hooks", async () => {
  const { Markdown } = await import("@/components/ui/markdown");
  const code = "```ts\nconst x = 1\n```";
  dispose = render(() => <Markdown text={code} />, container);
  await vi.waitFor(() => {
    const root = container.querySelector('[data-component="markdown"]');
    expect(root).not.toBeNull();
    expect(container.querySelector("pre")).not.toBeNull();
  });
});
````

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @sakti-code/desktop exec vitest run tests/unit/components/markdown.test.tsx -t "keeps markdown root classes and code block visual hooks"`
Expected: FAIL if selectors/styles tied to removed `data-component="markdown-code"` wrappers.

**Step 3: Write minimal implementation**

In `main.css`:

- Keep `[data-component="markdown"]` root prose styling.
- Replace old `[data-component="markdown-code"]` assumptions with selectors that target Incremark output (`pre`, `.shiki`, code wrapper classes).
- Keep code button selector only if implemented through new custom renderer data attributes.

**Step 4: Run test to verify it passes**

Run command above.
Expected: PASS visual hook smoke test.

Then run:
`pnpm --filter @sakti-code/desktop exec vitest run tests/unit/views/workspace-view/chat-area/parts/text-part.test.tsx`
Expected: PASS copy button UI remains unaffected.

**Step 5: Commit**

```bash
git add apps/desktop/src/assets/main.css apps/desktop/tests/unit/components/markdown.test.tsx
git commit -m "style(desktop): align markdown css selectors with incremark output"
```

---

### Task 29: Full Verification Sweep Before Branch Completion

**Files:**

- Modify: `apps/desktop/scripts/markdown-migration-health.sh`
- Modify: `apps/desktop/scripts/markdown-migration-baseline.sh`
- Test: full matrix

**Step 1: Write the failing test**

```bash
pnpm --filter @sakti-code/desktop markdown:migration:health
```

Expected before completion: at least one failing category until all migration tasks are complete.

**Step 2: Run test to verify it fails**

Run command above.
Expected: FAIL until all preceding tasks are merged.

**Step 3: Write minimal implementation**

- Update scripts to remove references to deleted files/tests.
- Ensure `test:perf` invocation points to migrated integration tests.
- Keep script deterministic (no flaky random waits).

**Step 4: Run test to verify it passes**

Run:
`pnpm --filter @sakti-code/desktop markdown:migration:health`
Expected: PASS across unit/integration/lint/typecheck/perf commands.

**Step 5: Commit**

```bash
git add apps/desktop/scripts/markdown-migration-health.sh apps/desktop/scripts/markdown-migration-baseline.sh apps/desktop/package.json
git commit -m "chore(desktop): finalize markdown migration verification scripts"
```

---

### Task 30: Document Migration Architecture And Post-Migration Guardrails

**Files:**

- Create: `apps/desktop/docs/architecture/markdown-rendering-incremark.md`
- Modify: `apps/desktop/docs/architecture/phase0-contracts.md`
- Test: docs lint/readability (manual)

**Step 1: Write the failing test**

```markdown
# markdown-rendering-incremark.md

(TODO)
```

Missing content should fail review checklist because architecture decisions are undocumented.

**Step 2: Run test to verify it fails**

Run manual check:

- missing: decision log (`htmlTree: false`)
- missing: stream adapter behavior
- missing: removed dependencies list

Expected: FAIL review checklist.

**Step 3: Write minimal implementation**

Document sections:

- Why marked stack was removed (freeze/O(N²) behavior)
- New stream architecture and diff-reset contract
- Security defaults and rationale
- Test coverage map
- Operational playbook for regressions (`@systematic-debugging`)

Update `phase0-contracts.md` to point at new markdown architecture doc.

**Step 4: Run test to verify it passes**

Manual acceptance checklist:

- docs explain runtime data flow from `TextPart`/`ReasoningPart` to Incremark stream.
- docs specify non-goals and rollback strategy.
- docs include verification commands from migration health script.

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/desktop/docs/architecture/markdown-rendering-incremark.md apps/desktop/docs/architecture/phase0-contracts.md
git commit -m "docs(desktop): record incremark markdown rendering architecture"
```

---

## Cross-Task Command Reference (single-source)

Use these commands consistently during execution:

```bash
# Unit markdown
pnpm --filter @sakti-code/desktop exec vitest run tests/unit/components/markdown.test.tsx
pnpm --filter @sakti-code/desktop exec vitest run tests/unit/components/markdown-streaming.test.tsx
pnpm --filter @sakti-code/desktop exec vitest run tests/unit/components/markdown-stream-queue.test.ts
pnpm --filter @sakti-code/desktop exec vitest run tests/unit/components/markdown-stream-diff.test.ts
pnpm --filter @sakti-code/desktop exec vitest run tests/unit/components/markdown-stream-adapter.test.ts

# Parts
pnpm --filter @sakti-code/desktop exec vitest run tests/unit/views/workspace-view/chat-area/parts/text-part.test.tsx
pnpm --filter @sakti-code/desktop exec vitest run tests/unit/views/workspace-view/chat-area/parts/reasoning-part.test.tsx

# Integration/perf
pnpm --filter @sakti-code/desktop exec vitest run tests/integration/markdown-stream-stress.test.tsx
pnpm --filter @sakti-code/desktop exec vitest run tests/integration/markdown-benchmark.report.test.tsx
pnpm --filter @sakti-code/desktop test:perf
rg -n "MicromarkAstBuilder|astBuilder|engineType|simulateAI|Simulate AI Output" apps/desktop/src/components/ui/markdown.tsx apps/desktop/src/views/workspace-view/chat-area

# Repo quality
pnpm --filter @sakti-code/desktop typecheck
pnpm --filter @sakti-code/desktop lint
pnpm --filter @sakti-code/desktop markdown:migration:health
```

---

## Acceptance Criteria (must all be true)

- No runtime imports of `marked`, `marked-shiki`, `shiki`, `dompurify`, `morphdom` in `apps/desktop/src/**`.
- `Markdown` renderer uses Incremark stream mode for live updates.
- Desktop chat markdown renderer stays on Incremark default marked-engine path (no `MicromarkAstBuilder`, no runtime parser selector).
- `htmlTree` is disabled (`false`) in default renderer options.
- `TextPart` and `ReasoningPart` continue to render streaming output and pass existing behavior tests.
- No `Simulate AI Output`/synthetic-stream control is shipped in production chat surfaces.
- Integration stream stress test passes with `p95 visual staleness <= 100ms` and `p99 visual staleness <= 150ms`.
- `pnpm --filter @sakti-code/desktop markdown:migration:health` passes in clean workspace.
- Architecture docs explain the new renderer and migration rationale.

---

## Batch Checkpoints (review gates)

- Gate A (after Task 6): stream queue + diff primitives tested and deterministic.
- Gate B (after Task 12): Incremark dependencies and global theme plumbing stable.
- Gate C (after Task 20): markdown component fully stream-mode and secure defaults enforced.
- Gate D (after Task 24): call-site and integration behavior parity re-established.
- Gate E (after Task 28): legacy stack removed and CSS aligned.
- Gate F (after Task 30): full verification and docs complete.

At each gate, request code review using `@requesting-code-review` before continuing.

---

## Rollback Strategy (if critical regression appears)

- Use git commit granularity from each task to revert only the smallest broken increment.
- Do not reintroduce partial marked + incremark dual rendering in production path.
- If rollback is needed, revert to last passing gate commit, then debug forward using `@systematic-debugging`.

---

## Execution Notes For The Implementer

- Keep each task scoped to one commit.
- Do not batch unrelated refactors into migration tasks.
- Prefer behavior assertions over implementation-detail assertions.
- Avoid adding new rendering abstractions unless proven necessary by failing tests.
- Keep `Markdown` public API stable unless a call-site change is unavoidable.
- If bundler issues appear with Incremark in Vitest, fix resolver config with minimal blast radius.
- If streaming output jitters, debug adapter order first before touching chat stores.

---

## Final Pre-Merge Checklist

- [ ] All 30 tasks completed with committed checkpoints.
- [ ] No skipped failing-test step.
- [ ] No stale imports from removed modules.
- [ ] No `MicromarkAstBuilder`/engine-toggle/simulate-stream UI path in desktop chat markdown surfaces.
- [ ] Updated lockfile committed.
- [ ] Updated perf report artifact committed if benchmark test regenerates fixture.
- [ ] Architecture docs committed.
- [ ] Final `markdown:migration:health` output captured and attached to PR/merge notes.
