<!--VITE PLUS START-->

# Using Vite+, the Unified Toolchain for the Web

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, and it invokes Vite through `vp dev` and `vp build`. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

Docs are local at `node_modules/vite-plus/docs` or online at https://viteplus.dev/guide/.

## Review Checklist

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `vp check` and `vp test` to format, lint, type check and test changes.
- [ ] Check if there are `vite.config.ts` tasks or `package.json` scripts necessary for validation, run via `vp run <script>`.
- [ ] If setup, runtime, or package-manager behavior looks wrong, run `vp env doctor` and include its output when asking for help.

<!--VITE PLUS END-->

## Project

sakti-code: desktop app (Electron + SolidJS) running multiple AI coding agents concurrently on different codebases. The agent core lives here as a TypeScript monorepo.

- **SolidJS** is a hard requirement (not React).
- LLM via **`@sakti-code/llm`** — `@ai-sdk`-native, driven by models.dev data. Don't hand-roll provider code.
- App server: **Hono** on `@hono/node-server` (REST + WebSocket, not all-WS).
- DB: **node:sqlite + Drizzle ORM** (not libsql, not bun:sqlite). DB is owned by the app/server, never by the agent package. Package manager / tooling is **pnpm** (not the Bun runtime, not npm/yarn). `.ts` is executed directly via `tsx`/`vite`/`vitest`.

## Monorepo layout

- `packages/agent/` — pure agent loop, types, compaction, plus the coding-agent policy layer (system-prompt composition, prompt preprocessor, builtin agents, auto-compaction policy, application-level retry). **No persistence, no DB, no app config.** Talks to storage via the `SessionStore` interface; model + API key are injected by the caller.
- `packages/db/` — Drizzle schema, repos, `SqliteSessionStorage` (implements `SessionStorage`).
- `packages/tools/` — coding tools (read, write, edit, bash, grep, find, ls).
- `apps/server/` — Hono REST server (on `@hono/node-server`). Composes route modules via `buildApp(ctx)`; each module is a `factory.createApp()` with `.basePath()`, mounted via chained `.route()`. Context is injected through a `ctxMiddleware` that sets `c.var.ctx`; routes access it through `getCtx(c)`. Exports `type App = ReturnType<typeof buildApp>`; the UI consumes it via Hono RPC (`hcWithType<App>` in `apps/desktop/src/lib/api.ts`).
- `apps/desktop/` — Electron desktop shell (electron-vite + electron-builder, **not** Electrobun). Single package: `src/` is the SolidJS/Vite renderer, `electron/{main,preload,shared}` is the shell. Main embeds the Hono server in-process via `createServer` (`@sakti-code/server/create-server`); the renderer is served **same-origin** (dev: server on fixed port `3001` + Vite proxy; prod: `createServer({ staticDir })` + `win.loadURL(server.url)`), so `window.location.origin` resolves to the embedded server (no CORS, no `window.sakti` for the API). Preload is sandboxed (`contextBridge` exposes only `window.sakti`).
- `openspec/` — change specs + the Pi reference implementation under `references/`.

## Commands

```
vp install                                         # install dependencies (replaces pnpm install)
vp check                                           # format + lint (run before committing); `vp check --fix` autofixes
vp check --fix                                     # format + autofix lint (run before committing)
vp run -r typecheck                                # typecheck all packages via tsc --noEmit (each package owns its tsconfig)
vp run -r test                                     # run tests across all packages (vitest via vite-plus/test)
vp run -r build                                    # build all packages (vp pack; electron-vite for desktop)
vp run @sakti-code/agent#test                      # single-package test (same pattern for any workspace package)
vp run @sakti-code/server#dev                      # start Hono server standalone on port 3001 (SAKTI_PORT env override); tsx watch
vp run desktop#dev                                 # run the Electron app (electron-vite dev: renderer HMR + embedded server on dev port 3001)
vp run desktop#spike                               # headless Electron spike: verifies node:sqlite + embedded createServer + /api/health
vp run desktop#rebuild                             # rebuild native modules (node-pty) against Electron's ABI — run once after install (in nix develop)
vp run desktop#package                             # build + package a Linux app into release/ (run in `nix develop`; python3 needed for node-pty)
vp env off                                         # run once after install so nix (not vp) stays the Node source
nix develop                                        # enter dev shell: Electron runtime libs (libEGL/libGL…) + python3/gnumake for native rebuild
```

> Tasks run through `vp run` (Vite Task). `vp run -r <task>` runs across all workspace packages in dependency order; `vp run <pkg>#<task>` targets one. There is no turbo-style `^task` — order comes from the `package.json` dependency graph.

## Conventions

- **Follow TDD** — write the failing test first (RED), implement until it passes (GREEN), then refactor. Verify RED before implementing.
- **Tests live in `__tests__/` colocated with source.** Tests use **vitest** throughout (server, desktop renderer, and packages; renderer tests run under jsdom).
- **`exactOptionalPropertyTypes: true` is on.** Use conditional spread `...(x !== undefined ? { x } : {})` instead of passing `undefined`.
- TS 6.0 quirks: `include`/`references` must be top-level in tsconfig (not inside `compilerOptions`); `shell` in `execSync` must be a `string` (e.g. `"/bin/sh"`), not `boolean`.
- Workspace `package.json` exports point to `./src/index.ts` (not `./dist/`) so the dev tooling resolves `.ts` directly.
- Before editing unfamiliar code: read `openspec/changes/*/specs/` and the file you're changing.

## Code style (Oxlint / Oxfmt via `vp`)

Write code that is **accessible, performant, type-safe, and maintainable**. Focus on clarity and explicit intent over brevity. Run `vp check --fix` — it applies formatting (oxfmt) and lint fixes (oxlint) and reports any remaining diagnostics. `vp check` is the read-only gate; lint config lives in the root `vite.config.ts` `lint`/`fmt` blocks (type-aware on; full typecheck off — typecheck is `vp run -r typecheck`).

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

## Logging (renderer / `@sakti-code/logger`)

Use the structured logger from `~/lib/utils` (`createLogger({ module })`). Keep it — don't add logs for debugging then remove them.

**Level contract (permanent):**

- `error` — bugs, API failures, unrecoverable states. Always stays.
- `warn` — recoverable edge cases (unexpected state handled gracefully).
- `info` — user actions and state transitions (dialog opened, model selected, setting changed). Stays permanently.
- `debug` — internal data flow, per-event noise (filteredSections, keydown, render counts). Visible in dev console, suppressed in production via `minLevel: import.meta.env.DEV ? "debug" : "info"`.

**Pattern (one logger per file):**

```ts
const log = createLogger({ module: "ComponentName" });
log.info("dialog open", { source: "picker_button" });
log.debug("filteredSections", { query, counts }); // internal flow only
```

**Structured context** — always pass data as the context argument (`{ key: value }`), never interpolate into the message string. The forwarding logger formats it as `[MODULE:ACTION] message key=value`.

**What stays vs what's temporary:**

- `info` and `warn` — permanent. Leave them in.
- `debug` — permanent but invisible in production. Fine to leave in.
- If a debug log is particularly expensive (large arrays, allocations), wrap in `if (import.meta.env.DEV) { ... }` to strip in production builds.

## Server

The Hono REST server lives in `apps/server/` (served by `@hono/node-server`) and follows a **REST-for-state, WS-for-streaming** split:

- **REST routes** handle CRUD over sessions, projects, settings, models, costs, git operations, and session utilities (stats, compaction). Each route module is a `factory.createApp()` Hono sub-app (see `src/factory.ts`) with a `.basePath()`, composed under `/api` via chained `.route()` in `buildApp(ctx)`. Runtime validation uses `@hono/typebox-validator` over the workspace `typebox` package.
- **WebSocket** (`/ws`) manages the agent streaming loop — send a JSON prompt, receive typed events back over the socket. Implemented via `upgradeWebSocket` from `@hono/node-server` + a `ws` `WebSocketServer`. See the `agent-streaming` spec for the wire format.
- **Typed client**: the UI consumes the server via Hono RPC (`hcWithType<App>` in `apps/desktop/src/lib/api.ts`) for typed REST; WS is driven through `client.ws.$ws()` in `apps/desktop/src/stores/ws-client.ts`.

### Running the server

```bash
vp run @sakti-code/server#dev                # starts on port 3001
SAKTI_PORT=4000 vp run @sakti-code/server#dev          # override port
SAKTI_DB_PATH=/custom/path/sakti-code.db vp run @sakti-code/server#dev   # custom db path
```

### Environment & configuration

- **API keys come from `auth.json`, never from the DB.** Each LLM provider's key is stored in `~/.sakti/agent/auth.json` (locked + `0o600`) and resolved at runtime via `ctx.auth.getApiKey(provider)`. The store never reads from `process.env`.
- **Config home is `~/.sakti/agent/`** (pi-style; overridable via `SAKTI_AGENT_DIR` env). One JSON file per concern: `auth.json` (credentials, locked + `0o600`), `profiles.json` (model selection per mode), `settings.json` (global app preferences). A one-time non-destructive migration runs on first start (copies legacy `~/.config/sakti-code/api-keys.json` → `auth.json`).
- **Model selection lives in `profiles.json`**, not the DB. A profile maps runtime modes (`default` required; `intake`/`plan`/`build` optional, mode-forward) to `{ provider, model, thinkingLevel }`. A `defaultProfile` id selects the active one. Sessions reference a profile via `sessions.profileId` (nullable; null → `defaultProfile`).

### Route modules

Route modules register themselves via `buildApp`'s chained `.route()` calls in `src/app.ts` — add new modules there.

| Module                    | Routes                                                                           | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                |
| :------------------------ | :------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `healthRoutes`            | `GET /health`                                                                    | Liveness check                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `projectsRoutes`          | `GET/PUT/DELETE /api/projects`                                                   | Project CRUD                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `sessionsRoutes`          | `GET /api/sessions`, `GET /api/sessions/:id/messages`                            | Session listing; `:id/messages` projects the entry tree via `buildSessionContext`                                                                                                                                                                                                                                                                                                                                                    |
| `settingsRoutes`          | `GET/PUT /api/settings`                                                          | Global settings (file-backed `settings.json`, deep-merge on PUT)                                                                                                                                                                                                                                                                                                                                                                     |
| `profilesRoutes`          | `GET/PUT /api/profiles`                                                          | Profiles (file-backed `profiles.json`, whole-file replace on PUT)                                                                                                                                                                                                                                                                                                                                                                    |
| `authRoutes`              | `GET /api/auth`, `POST/DELETE /api/auth/:provider`                               | Provider credentials (masked list, file-backed `auth.json`)                                                                                                                                                                                                                                                                                                                                                                          |
| `availableModelsRoutes`   | `GET /api/available-models`                                                      | Models catalog                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `gitRoutes`               | `GET /api/git/:projectId/status, /branch, /diff, /log`, `GET /api/git/turn-diff` | Git operations (status, branch switch, diff, log) + structured turn-diff (numstat-parsed file changes since HEAD)                                                                                                                                                                                                                                                                                                                    |
| `statsRoutes`             | `GET /api/sessions/:id/stats`                                                    | **Fast, local read** — derives `activeMessageCount` + token/cost totals from assistant `usage` fields via `buildSessionContext`; no `costs` table                                                                                                                                                                                                                                                                                    |
| `compactionRoutes`        | `POST /api/sessions/:id/compact`                                                 | **Network-backed (LLM)** — runs the agent's `prepareCompaction` + `compact` summarizer on a session's entry tree, persists the compaction entry via `Session.appendCompaction()`, returns `{ tokensBefore, summary, firstKeptEntryId }`. Latency depends on the provider. Calls `resolveModel`/`resolveAuth` from `agent/model-resolver.ts` and resolves the API key from `auth.json`. Returns 500 on summary failure (error/abort). |
| `forkingRoutes`           | `POST /api/sessions/:id/fork`, `GET /api/sessions/:id/fork-messages`             | Entry-tree fork via `SqliteSessionStorage.forkFrom`; copies `session_entries` rows with regenerated IDs preserving the tree                                                                                                                                                                                                                                                                                                          |
| `lastAssistantTextRoutes` | `GET /api/sessions/:id/last-assistant-text`                                      | Reads last assistant message from the entry tree                                                                                                                                                                                                                                                                                                                                                                                     |
| `exportRoutes`            | `GET /api/sessions/:id/export-html`                                              | Renders session to standalone HTML                                                                                                                                                                                                                                                                                                                                                                                                   |

## Debugging: bisect before you theorize

When confident explanations don't fit the evidence, **stop theorizing and bisect to a minimal repro.** Post-hoc memory/GC/runtime jargon is cheap to generate and hard to verify; one falsifying experiment beats a paragraph of mechanism.

_Real example:_ agent-loop tests "OOM'd" under vitest. Two research-agent round-trips produced elaborate memory theories (re-imports, spy-history pinning, async-continuation frames) — all wrong. The cause was a **missing 2-line check**: `loop.ts` never honored `AgentToolResult.terminate`, so one test (`terminate:true` tool + reusable `mockReturnValue` stream) spun forever until the worker OOM'd. Looked like a leak; was an infinite loop.

What worked, in value order: (1) `node --trace-gc` to see real retention vs thrash; (2) bisect by test count — 1 test passed at 25 MB, 2 OOM'd at 4 GB (binary trigger ⇒ not accumulation); (3) progressive minimal repros dropping one layer at a time; (4) re-read the failing test against source.

Heuristics: "OOM" at the _second_ worker invocation is usually one infinite/unbounded path, not ambient leakage. An 8 GB heap that _hangs_ (not crashing faster) = slow infinite loop, not a leak. If an explanation can't become a falsifying experiment, treat it as a hypothesis to test, not an answer — verify its one concrete claim against source before acting. A hanging test is data: run it alone with `timeout` and check the exit code.
