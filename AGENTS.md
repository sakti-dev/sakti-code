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
- `apps/server/` — Elysia REST server. Composes route modules via `buildServer()`. State injected via `.state("ctx", createContext(db))`; routes access it through `getCtx(store)`. Eden treaty client at `apps/app/src/lib/api.ts`.
- `openspec/` — change specs + the Pi reference implementation under `references/`.

## Commands

```
bun x ultracite fix                              # format + lint fix + diagnostics (run before committing)
bun typecheck                                    # typecheck all packages (tsc --project tsconfig.json, TS 6.0.3)
bun vitest run packages/tools/                   # tool tests (vitest)
bun vitest run packages/agent/                   # agent tests (vitest)
cd packages/db && bun test                       # db tests (bun:test, needs bun:sqlite)
cd apps/server && bun test                       # server route tests (bun:test)
bun dev:server                                   # start Elysia server on port 3001 (SAKTI_PORT env override)
```

## Conventions

- **Follow TDD** — write the failing test first (RED), implement until it passes (GREEN), then refactor. Verify RED before implementing.
- **Tests live in `__tests__/` colocated with source.** Vitest for agent+tools; `bun:test` for db + server.
- **`exactOptionalPropertyTypes: true` is on.** Use conditional spread `...(x !== undefined ? { x } : {})` instead of passing `undefined`.
- TS 6.0 quirks: `include`/`references` must be top-level in tsconfig (not inside `compilerOptions`); `shell` in `execSync` must be a `string` (e.g. `"/bin/sh"`), not `boolean`.
- Workspace `package.json` exports point to `./src/index.ts` (not `./dist/`) so bun dev resolves `.ts` directly.
- Before editing unfamiliar code: read `openspec/changes/*/specs/` and the file you're changing.

## Code style (Ultracite / Biome)

Write code that is **accessible, performant, type-safe, and maintainable**. Focus on clarity and explicit intent over brevity. Run `bun x ultracite fix` — it applies formatting and lint fixes and reports any remaining diagnostics.

- Explicit types for params/returns when they aid clarity; prefer `unknown` over `any`.
- `const` by default, `let` only when reassigning, never `var`. Const assertions (`as const`) for immutable values.
- Arrow functions for callbacks; `for...of` over `.forEach()`. Optional chaining `?.` and nullish coalescing `??` for safe access. Template literals over concatenation. Destructuring.
- Always `await` promises; `async/await` over promise chains; meaningful `try-catch` (don't catch only to rethrow). Never use async functions as Promise executors.
- **SolidJS:** use `class` and `for` attributes (not `className`/`htmlFor`).
- Throw `Error` objects with descriptive messages, not strings. Early returns over nesting. Named booleans for complex conditions.
- No `console.log`/`debugger`/`alert` in production code. `rel="noopener"` on `target="_blank"`. No `eval()` or raw `document.cookie`.
- Prefer specific imports over namespace imports; avoid barrel files; top-level regex literals; no spread in loop accumulators.

### Testing

- Assert inside `it()`/`test()`; async/await not done-callbacks. No `.only`/`.skip` in committed code. Flat suites over deep `describe` nesting.

Biome catches formatting and common issues automatically — focus your judgment on business logic, naming, architecture, edge cases, and UX/accessibility.

## Debugging: bisect before you theorize

When confident explanations don't fit the evidence, **stop theorizing and bisect to a minimal repro.** Post-hoc memory/GC/runtime jargon is cheap to generate and hard to verify; one falsifying experiment beats a paragraph of mechanism.

*Real example:* agent-loop tests "OOM'd" under vitest. Two research-agent round-trips produced elaborate memory theories (re-imports, spy-history pinning, async-continuation frames) — all wrong. The cause was a **missing 2-line check**: `loop.ts` never honored `AgentToolResult.terminate`, so one test (`terminate:true` tool + reusable `mockReturnValue` stream) spun forever until the worker OOM'd. Looked like a leak; was an infinite loop.

What worked, in value order: (1) `node --trace-gc` to see real retention vs thrash; (2) bisect by test count — 1 test passed at 25 MB, 2 OOM'd at 4 GB (binary trigger ⇒ not accumulation); (3) progressive minimal repros dropping one layer at a time; (4) re-read the failing test against source.

Heuristics: "OOM" at the *second* worker invocation is usually one infinite/unbounded path, not ambient leakage. An 8 GB heap that *hangs* (not crashing faster) = slow infinite loop, not a leak. If an explanation can't become a falsifying experiment, treat it as a hypothesis to test, not an answer — verify its one concrete claim against source before acting. A hanging test is data: run it alone with `timeout` and check the exit code.
