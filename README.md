# sakti-code

Offline-first AI coding agent. Your code stays on your machine.

## Features

- Privacy-focused (local only, no cloud)
- Filesystem tools (read, write, edit, search)
- Permission system (agent actions require approval)
- Multi-workspace support

## Stack

Electron + SolidJS + ai sdk + Hono

## Quick Start

```bash
pnpm install
pnpm dev
```

## Provider Docs

- docs/providers/README.md
- docs/providers/credential-storage.md

## Markdown Migration Notes (2026-02-23)

- Desktop chat markdown renderer is migrated from `marked + marked-shiki` to `@incremark/solid` stream mode in `apps/desktop`.
- Rendering path now uses `IncremarkContent` with `stream={...}` and explicit `MarkedAstBuilder` engine selection for deterministic parser behavior.
- Security posture is locked to `htmlTree: false` for untrusted model output.
- Streaming behavior targets smooth UI updates via throttled cadence and deferred code highlighting during active stream phases.
- Integration is aligned with `incremark/examples/solid` by consuming local `@incremark/solid` source in Vite/Vitest aliasing to avoid published package JSX runtime incompatibilities.
- Legacy desktop markdown sanitizer files were removed; migration telemetry remains temporarily to support benchmark and stress verification suites.
