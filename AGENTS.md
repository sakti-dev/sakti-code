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

sakti-code: desktop app (Electron + SolidJS) running multiple AI coding agents concurrently on different codebases. TypeScript monorepo.

- **SolidJS** is a hard requirement (not React).
- LLM via **`@sakti-code/llm`** — `@ai-sdk`-native, driven by models.dev data. Don't hand-roll provider code.
- App server: **Hono** on `@hono/node-server` (REST + WebSocket).
- DB: **node:sqlite + Drizzle ORM**. DB is owned by the app/server, never by the agent package.
- Package manager / tooling is **pnpm** (not Bun runtime, not npm/yarn). `.ts` executed directly via `tsx`/`vite`/`vitest`.

## Monorepo layout

- `packages/agent/` — pure agent loop, types, compaction, coding-agent policy layer (system-prompt composition, prompt preprocessor, builtin agents, auto-compaction, retry). **No persistence, no DB, no app config.** Storage via `SessionStore` interface; model + API key injected by caller.
- `packages/db/` — Drizzle schema, repos, `SqliteSessionStorage`.
- `packages/tools/` — coding tools (read, write, edit, bash, grep, find). `read` also handles directory listings; the old `ls` tool was removed.
- `apps/server/` — Hono REST server. Route modules are `factory.createApp()` sub-apps with `.basePath()`, composed via chained `.route()` in `buildApp(ctx)`. Context injected via `ctxMiddleware` (`c.var.ctx`); routes access it through `getCtx(c)`. UI consumes via Hono RPC (`hcWithType<App>`).
- `apps/desktop/` — Electron shell (electron-vite + electron-builder). `src/` is SolidJS/Vite renderer, `electron/{main,preload,shared}` is the shell. Main embeds the Hono server in-process (`createServer`); renderer is **same-origin** (no CORS, no `window.sakti` for API). Preload sandboxed (`contextBridge` exposes only `window.sakti`).
- `openspec/` — change specs + Pi reference implementation under `references/`.

## Commands

```
vp install                  # install dependencies (replaces pnpm install)
vp check                    # format + lint + typecheck in one pass (run before committing)
vp check --fix              # same, with autofixes
vp run -r test              # run tests across all packages (vitest)
vp run -r build             # build all packages (vp pack; electron-vite for desktop)
vp run @sakti-code/agent#test   # single-package test
vp run @sakti-code/server#dev   # start Hono server on port 3001 (SAKTI_PORT env override)
vp run desktop#dev          # run the Electron app (renderer HMR + embedded server on port 3001)
vp run desktop#rebuild      # rebuild native modules (node-pty) against Electron's ABI
vp run desktop#package      # build + package Linux app into release/ (needs nix develop + python3)
vp env off                  # run once after install so nix stays the Node source
nix develop                 # dev shell: Electron runtime libs + python3/gnumake for native rebuild
```

> `vp run -r <task>` runs across all workspace packages in dependency order; `vp run <pkg>#<task>` targets one. Order comes from the `package.json` dependency graph. Because the workspace uses zsh, always quote the package target: `vp run '@sakti-code/tools#test'`.

## Conventions

- **Follow TDD** — write the failing test first (RED), implement until GREEN, then refactor.
- **Tests live in `__tests__/` colocated with source**, using **vitest** (renderer tests under jsdom).
- **`exactOptionalPropertyTypes: true`** — use conditional spread `...(x !== undefined ? { x } : {})` instead of passing `undefined`.
- TS 7.0 (Go-based): `include`/`references` must be top-level in tsconfig; `shell` in `execSync` must be a `string` (e.g. `"/bin/sh"`).
- Workspace `package.json` exports point to `./src/index.ts` (not `./dist/`) so dev tooling resolves `.ts` directly.
- Before editing unfamiliar code: read `openspec/changes/*/specs/` and the file you're changing.

## Code style (Oxlint / Oxfmt via `vp`)

Run `vp check --fix` — it applies formatting (oxfmt) and lint fixes (oxlint) and reports remaining diagnostics. `vp check` is the read-only gate (type-aware on; full typecheck on via tsgolint on the TS Go toolchain).

- Explicit types for params/returns when they aid clarity; prefer `unknown` over `any`.
- `const` by default; `as const` for immutable values. Arrow callbacks; `for...of` over `.forEach()`. `?.` and `??` for safe access. Template literals. Destructuring.
- Always `await` promises; `async/await` over chains; meaningful `try-catch`. Never use async functions as Promise executors.
- **SolidJS:** use `class` and `for` attributes (not `className`/`htmlFor`).
- Throw `Error` objects, not strings. Early returns over nesting.
- No `console.log`/`debugger`/`alert` in production. `rel="noopener"` on `target="_blank"`. No `eval()`.
- Prefer specific imports over namespace imports; avoid barrel files; no spread in loop accumulators.
- Assert inside `it()`/`test()`; no `.only`/`.skip` in committed code. Flat suites over deep nesting.

## Logging (renderer / `@sakti-code/logger`)

Use the structured logger from `~/lib/utils` (`createLogger({ module })`). Keep permanent logs — don't add for debugging then remove.

**Levels:** `error` (bugs/failures, always stays) > `warn` (recoverable edge cases) > `info` (user actions/state transitions, permanent) > `debug` (internal flow, suppressed in production via `minLevel: import.meta.env.DEV ? "debug" : "info"`).

```ts
const log = createLogger({ module: "ComponentName" });
log.info("dialog open", { source: "picker_button" });
log.debug("filteredSections", { query, counts }); // context as object, never interpolated
```

Pass data as context object (`{ key: value }`), never interpolate into the message string. For expensive debug logs, wrap in `if (import.meta.env.DEV) { ... }`.

## Server

Hono REST server in `apps/server/` — **REST-for-state, WS-for-streaming** split:

- **REST** (`/api`): CRUD over sessions, projects, settings, models, git ops, session utilities (stats, compaction, fork, export). Validation via `@hono/typebox-validator`.
- **WebSocket** (`/ws`): agent streaming loop — send JSON prompt, receive typed events. Implemented via `upgradeWebSocket` + `ws` `WebSocketServer`.
- **Typed client**: UI uses Hono RPC (`hcWithType<App>`); WS via `client.ws.$ws()`.

```bash
vp run @sakti-code/server#dev                    # port 3001
SAKTI_PORT=4000 vp run @sakti-code/server#dev    # override port
```

### Environment & configuration

- **API keys in `auth.json`, never the DB.** Stored in `~/.sakti/agent/auth.json` (locked `0o600`), resolved via `ctx.auth.getApiKey(provider)`. Never from `process.env`.
- **Config home: `~/.sakti/agent/`** (overridable via `SAKTI_AGENT_DIR`). Files: `auth.json`, `profiles.json` (model selection per mode), `settings.json` (global prefs).
- **Model selection in `profiles.json`**, not the DB. A profile maps runtime modes (`default` required; `intake`/`plan`/`build` optional) to `{ provider, model, thinkingLevel }`. Sessions reference a profile via `sessions.profileId`.

## Debugging: bisect before you theorize

When confident explanations don't fit evidence, **bisect to a minimal repro.** One falsifying experiment beats a paragraph of mechanism. Post-hoc memory/GC/runtime jargon is cheap to generate and hard to verify.

Heuristics: "OOM" at the _second_ worker invocation is usually one infinite/unbounded path, not ambient leakage. A hanging test is data: run it alone with `timeout` and check the exit code. If an explanation can't become a falsifying experiment, treat it as a hypothesis, not an answer.
