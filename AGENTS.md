# AGENTS.md

Guide for AI coding agents working in this repository.

## Project

sakti-code: desktop app (Electrobun + SolidJS) running multiple AI coding agents concurrently on different codebases. The agent core lives here as a TypeScript monorepo.

- **SolidJS** is a hard requirement (not React).
- LLM via **`@earendil-works/pi-ai`** — don't hand-roll provider code.
- App server: **Elysia** (REST + WebSocket, not all-WS).
- DB: **bun:sqlite + Drizzle ORM** (not libsql). DB is owned by the app/server, never by the agent package.

## Monorepo layout

- `packages/agent/` — pure agent loop, types, compaction. **No persistence, no DB.** Talks to storage via the `SessionStore` interface.
- `packages/db/` — Drizzle schema, repos, `SqliteSessionStore` (implements `SessionStore`).
- `packages/tools/` — coding tools (read, write, edit, bash, grep, find, ls).
- `openspec/` — change specs + the Pi reference implementation under `references/`.

## Commands

```
npx tsc --project tsconfig.json                    # typecheck all packages (TS 6.0.3)
npx vitest run packages/tools/                     # tool tests
npx vitest run packages/agent/                     # agent tests (vitest)
cd packages/db && bun test                         # db tests (bun:test, needs bun:sqlite)
```

## Conventions

- **Follow TDD** — write the failing test first (RED), implement until it passes (GREEN), then refactor. Verify RED before implementing.
- **Tests live in `__tests__/` colocated with source.** Vitest for agent+tools; `bun:test` for db.
- **`exactOptionalPropertyTypes: true` is on.** Use conditional spread `...(x !== undefined ? { x } : {})` instead of passing `undefined`.
- TS 6.0 quirks: `include`/`references` must be top-level in tsconfig (not inside `compilerOptions`); `shell` in `execSync` must be a `string` (e.g. `"/bin/sh"`), not `boolean`.
- Workspace `package.json` exports point to `./src/index.ts` (not `./dist/`) so bun dev resolves `.ts` directly.
- Before editing unfamiliar code: read `openspec/changes/*/specs/` and the file you're changing.

## Debugging: bisect before you theorize

When confident explanations don't fit the evidence, **stop theorizing and bisect to a minimal repro.** Post-hoc memory/GC/runtime jargon is cheap to generate and hard to verify; one falsifying experiment beats a paragraph of mechanism.

*Real example:* agent-loop tests "OOM'd" under vitest. Two research-agent round-trips produced elaborate memory theories (re-imports, spy-history pinning, async-continuation frames) — all wrong. The cause was a **missing 2-line check**: `loop.ts` never honored `AgentToolResult.terminate`, so one test (`terminate:true` tool + reusable `mockReturnValue` stream) spun forever until the worker OOM'd. Looked like a leak; was an infinite loop.

What worked, in value order: (1) `node --trace-gc` to see real retention vs thrash; (2) bisect by test count — 1 test passed at 25 MB, 2 OOM'd at 4 GB (binary trigger ⇒ not accumulation); (3) progressive minimal repros dropping one layer at a time; (4) re-read the failing test against source.

Heuristics: "OOM" at the *second* worker invocation is usually one infinite/unbounded path, not ambient leakage. An 8 GB heap that *hangs* (not crashing faster) = slow infinite loop, not a leak. If an explanation can't become a falsifying experiment, treat it as a hypothesis to test, not an answer — verify its one concrete claim against source before acting. A hanging test is data: run it alone with `timeout` and check the exit code.
