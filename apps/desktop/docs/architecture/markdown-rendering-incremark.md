# Markdown Rendering Architecture (Incremark)

## Purpose

This document records the post-migration markdown renderer architecture for `apps/desktop`.
The renderer has migrated from `marked + marked-shiki` full-reparse behavior to `@incremark/solid`
stream mode for chat surfaces.

## Why We Removed the Marked Stack

- The previous renderer path reparsed large snapshots repeatedly during streaming and degraded
  under long AI outputs.
- The migration objective was steady streaming responsiveness and reduced parser churn while
  preserving existing `TextPart` / `ReasoningPart` UX behavior.
- Legacy stack dependencies were removed from desktop runtime:
  - `marked`
  - `marked-shiki`
  - `dompurify`
  - `morphdom`
  - direct `shiki`

## Runtime Data Flow

1. `TextPart` / `ReasoningPart` provide snapshot text and streaming flags.
2. `Markdown` applies streaming cadence and optional scroll pause behavior.
3. `Markdown` computes display-safe streaming content (defer code-fence highlighting while active stream).
4. `Markdown` pushes snapshots into `createMarkdownStreamAdapter()`.
5. Adapter emits append deltas (or reset + full snapshot for rewinds) to `IncremarkContent stream={...}`.
6. `Incremark` incrementally renders the stream output.

## Stream Adapter Contract

- Adapter API:
  - `stream(): AsyncGenerator<string>`
  - `update(snapshot, isStreaming)`
  - `finish()`
  - `reset()`
  - `dispose()`
- Diff strategy:
  - append-only snapshot => emit incremental chunk
  - non-monotonic snapshot => reset stream and emit full snapshot
- Lifecycle:
  - stream closes when `isStreaming` becomes `false`
  - renderer remount key updates on adapter run resets

## Security Defaults

- Renderer default is strict: `incremarkOptions.htmlTree = false`.
- Raw model HTML is not rendered as trusted DOM content by default.

## Performance and Telemetry

- Streaming cadence controls remain supported (`streamCadenceMs`, `scrollCadenceMs`, `idleCadenceMs`).
- Scroll pause option remains supported (`pauseWhileScrolling`).
- Telemetry retained for regression monitoring:
  - commit counts
  - stage timings (`parse`, `sanitize`, `morph`, `total`)
  - finalization batch stats
- Benchmark and stress integration tests rely on `markdown-perf-telemetry`.

## Intentional Deviations

- Task 24/26 plan intent was to remove telemetry usage/module.
- Current migration keeps telemetry intentionally for renderer SLO visibility and benchmark fixture report generation.
- This is a temporary compatibility choice; remove telemetry only after replacement perf instrumentation exists.

## Guardrails

- Do not reintroduce mixed marked + incremark rendering paths in production.
- Keep `htmlTree: false` unless security review explicitly approves change.
- Keep stream adapter reset semantics deterministic for non-monotonic snapshots.
- Prefer append-only snapshots at producers to avoid unnecessary adapter resets.

## Verification Commands

Run in repo root:

```bash
pnpm --filter @sakti-code/desktop test:ui
pnpm --filter @sakti-code/desktop typecheck
pnpm --filter @sakti-code/desktop lint
pnpm --filter @sakti-code/desktop markdown:migration:health
```

## Rollback Guidance

- If critical regressions appear, rollback to the last passing migration gate commit.
- Do not hotfix by restoring marked parser internals in parallel path.
- Debug forward using stress + benchmark suites plus markdown streaming unit tests.
