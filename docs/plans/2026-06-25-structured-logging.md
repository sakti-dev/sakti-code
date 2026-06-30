# Structured logging (Pino, centralized, per-layer files)

> **For the implementer:** this is the validated DESIGN. Use
> `superpowers:writing-plans` to turn it into a phased task-by-task
> implementation plan. All architectural decisions below are locked (approved
> during brainstorm); the "Telemetry seam" and "Testing" sections carry the
> recommended defaults the user delegated.

## Goal & motivation

Add observability across every layer of the app so bugs like the current
silent stream failure (`"Error from provider (Console): Upstream request
failed"`, which leaves no trace in the agent/server/llm code) become
diagnosable. Today the **agent loop, tools, and server have zero logging**;
the renderer has a console-only structured logger; the main process has an
8-line console wrapper. We want **centralized, structured, file-backed
logging** for dogfooding, with a clean seam to add cloud telemetry later.

**Non-goals (explicitly deferred):** Axiom/cloud telemetry ingestion (privacy
sensitive — this app reads the user's whole codebase; opt-in only, built
later on the seam defined here).

## Architecture

```
Renderer (SolidJS) ──IPC (window.sakti.log)──►  ┐
                                                 │
Main process (server/agent/tools/llm in-proc) ──►├──►  Pino (1 instance per layer)  ──►  rotating file per layer
                                                 │
Main process own logs ──────────────────────────►┘
```

- **One Pino instance per layer**, each writing its own rotating file. Pino is
  the sole writer; every log from every layer lands in a file.
- The renderer is sandboxed (no `fs`), so it **forwards** `{level, message,
context}` over IPC to main, which re-emits through the **desktop** Pino
  instance. Renderer logs fold into `desktop.log`, tagged `origin:
"renderer"|"main"`.
- In embedded (Electron) mode the server/agent/tools/llm run **inside** the
  main process, so they receive their Pino logger **directly** (no IPC). In
  standalone `nub run dev:server` mode, the server entry builds the
  server-side loggers itself (no `desktop`, no renderer).

### Resulting files in `logDir/`

| File          | Written by                                  | How it gets the logger                           |
| ------------- | ------------------------------------------- | ------------------------------------------------ |
| `desktop.log` | Electron main + renderer (via IPC)          | main keeps it; renderer forwarded over IPC       |
| `server.log`  | Hono routes, ws-handler, retry-loop, runner | injected into `ServerContext.log.server`         |
| `agent.log`   | agent loop / harness                        | `AgentHarnessOptions.logger`                     |
| `tools.log`   | read/write/edit/bash/grep/find tools        | closed over in `buildTools(cwd, logger)`         |
| `llm.log`     | stream / complete / provider resolve        | `logger?` on `StreamRequest` / `CompleteRequest` |

## Decisions locked (approved during brainstorm)

1. **New `packages/logger` (`@sakti-code/logger`)** owns the logger contract +
   implementations. Logging is cross-cutting infrastructure; it must be
   importable by the root package `packages/llm` (which nothing can depend
   _upward_ into), so the contract cannot live in `agent` or `llm`.
2. **Subpath split** — `"."` exports types + `createConsoleLogger` +
   `createForwardingLogger` + `noopLogger` + `describeError` (safe for the
   sandboxed renderer; no Pino in the bundle). `"./node"` exports
   `createPinoLogger` (Node-only). The renderer imports `"."` only.
3. **Message-first `Logger` interface** (matches the existing renderer style;
   call sites read naturally). Pino's obj-first API is hidden inside the
   factory via a thin adapter. `error()` takes the error as the 2nd arg.
4. **`buildTools(cwd, logger?)` second param** rather than changing the
   `execute(toolCallId, params, signal, onUpdate)` signature (avoids breaking
   churn across every tool). Tools close over the logger at construction.
5. **Renderer logs fold into `desktop.log`** with an `origin` tag (no separate
   `renderer.log`).
6. **Per-layer files** (`server/agent/tools/llm/desktop.log`). Generic factory
   instantiated once per layer by the composition root; the package itself
   knows nothing about layer names.
7. **No cloud telemetry now.** A `TelemetrySink` seam is defined and wired as
   a no-op so Axiom can be added later without call-site churn.
8. **Default = `noopLogger`** for every `logger?` param, so existing tests and
   callers that don't care about logging are unaffected.

## Constraints (from `AGENTS.md`)

- `exactOptionalPropertyTypes: true` → conditional spread
  `...(x !== undefined ? { x } : {})`, never pass `undefined`.
- TS 6.0 quirks; `nub` tooling (not Bun runtime).
- No `console.log`/`any`/`debugger` in production code; `unknown` over `any`.
  (Logging _implementations_ call `console.*` deliberately — that is their job;
  the ban is on scattered ad-hoc debugging, which this replaces.)
- Tests in `__tests__/` colocated with source; **vitest** throughout; TDD
  (failing test → RED → implement → GREEN → commit).
- Before commit: `npx biome check` (the `nubx ultracite fix` wrapper has a
  pre-existing config-nesting error — use `npx biome check` directly).

---

## Section 1 — Package structure + `Logger` interface

```
packages/logger/
  src/
    types.ts          # Logger interface + LogContext + LogLevel + LogEntry (pure types)
    describe-error.ts # describeError(error) — shared by all impls
    console.ts        # createConsoleLogger() — DevTools/std fallback, no deps
    forwarding.ts     # createForwardingLogger(transport) — generic, Electron-agnostic
    noop.ts           # noopLogger — default for all `logger?` params + tests
    infer-domain.ts   # inferDomain(context) — optional helper ported from logger.tsx
    node/
      pino.ts         # createPinoLogger(opts) — pino + pino-roll + redact (NODE ONLY)
    index.ts          # re-exports types + console + forwarding + noop + describeError + inferDomain
  node.ts             # subpath entry → re-exports ./src/node/pino.ts
```

`package.json` exports: `"."` → `./src/index.ts`; `"./node"` → `./src/node.ts`.
Workspace `package.json` exports point to `./src/index.ts` (nub resolves `.ts`
directly), so no build step.

### The contract

```ts
export type LogLevel = "debug" | "error" | "info" | "warn";

export interface LogContext extends Record<string, unknown> {
  domain?: string; // "LLM" | "AGENT" | "TOOL" | "SERVER" | "WS" | "UI" | ...
  module?: string;
  scope?: string;
}

export interface LogEntry {
  level: LogLevel;
  message: string;
  context?: LogContext;
}

export interface Logger {
  child(context: LogContext): Logger;
  debug(message: string, context?: LogContext): void;
  error(message: string, error?: unknown, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
}
```

---

## Section 2 — Node/Pino implementation (per-layer files)

```ts
// packages/logger/src/node/pino.ts
export interface PinoLoggerOptions {
  dest: string; // basename e.g. "agent.log" (placed in logDir)
  layer: string; // tag written on every record
  logDir: string; // resolved by the composition root
  level?: LogLevel; // default "info" (dev: "debug")
  redactPaths?: string[]; // shared secret-redaction list
  telemetry?: TelemetrySink; // no-op by default (Section 5)
}
export function createPinoLogger(opts: PinoLoggerOptions): Logger;
```

- Each call constructs a **separate Pino + separate `pino-roll` target**
  writing `logDir/dest`. No custom routing transport.
- **Adapter** maps `logger.info("msg", ctx)` → `pino.info({ ...ctx, layer },
"msg")`; `error(msg, err, ctx)` folds `describeError(err)` into context.
- **Shared defaults** (overridable per call): rotation = daily + 10 MB size
  cap; redaction list = `["*.apiKey", "*.authorization", "*.cookie",
"apiKey", "headers.authorization", "headers.cookie"]` + known env-key field
  names; `level` from composition root.

### Composition root owns the layer map

`packages/logger` is generic; the **app** knows the 5 layers. A small
`createLoggerSet` helper lives in **`apps/`** composition code (not the
package), calling the factory 5 times.

- **Electron** (`apps/desktop/electron/main`): `logDir =
app.getPath('userData')/logs`; builds all 5; keeps `desktop`; passes
  `{ server, agent, tools, llm }` into `createServer(ctx)`.
- **Standalone server** (`apps/server/src/index.ts`): `logDir =
process.env.SAKTI_LOG_DIR ?? ~/.sakti/logs`; builds the 4 server-side ones
  (no `desktop`). Falls back to `createConsoleLogger()` if the dir is not
  writable.

---

## Section 3 — Wiring each layer (dependency injection)

```ts
// packages/agent — AgentHarnessOptions gains:
logger?: Logger;                       // default noopLogger; threaded into AgentLoopConfig
```

```ts
// packages/tools
buildTools(cwd: string, logger?: Logger): AgentTool[]   // tools close over logger
```

```ts
// packages/llm — StreamRequest + CompleteRequest gain:
logger?: Logger;                       // passed through to the stream-consumption path
```

```ts
// apps/server — ServerContext gains:
interface ServerContext {
  // ...existing repos, db, auth...
  log: { server: Logger; agent: Logger; tools: Logger; llm: Logger };
}
```

`runner.ts:runPrompt` wires them: `buildTools(cwd, ctx.log.tools)`,
`new Harness({ ..., logger: ctx.log.agent })`, and the stream request carries
`logger: ctx.log.llm`. `ws-handler.ts`, routes, `retry-loop.ts` use
`ctx.log.server`.

**The `llm.log` layer is the one that surfaces the current bug:** on a stream
`error` part it logs the _full_ error object (not just `.message`), the
resolved model, baseURL, provider, and providerOptions — everything that is
currently invisible.

---

## Section 4 — Renderer IPC logger (replaces `logger.tsx`)

- **Preload** adds one method to `window.sakti`:
  `log: (entry: LogEntry) => ipcRenderer.send("renderer-log", entry)`.
- **Renderer logger** = `createForwardingLogger((e) => window.sakti.log(e))`
  from `packages/logger` (generic; no Electron import). Each call: prints to
  `console` (DevTools) **and** invokes `transport(e)`. Context is sanitized
  before send (`describeError` for Errors, circular refs dropped) because IPC
  uses structured clone.
- **Main listener:** `ipcMain.on("renderer-log", ...)` re-emits through the
  **desktop** Pino instance, tagged `origin: "renderer"`.
- The **5 existing renderer call sites** change only their import path
  (`lib/utils/logger` → `@sakti-code/logger`); the `Logger` signature is
  identical, so call-site code is unchanged. The domain heuristic
  (`AUTH`/`CHAT`/`WS`/…) ports into `packages/logger` as `inferDomain()`.
- **Guards:** the `transport` call is wrapped in try/catch — if preload isn't
  ready or IPC fails (early boot, crash), the console sink still fires so no
  DevTools log is lost. Standalone server has no renderer → no IPC.

---

## Section 5 — Telemetry seam (no-op now, Axiom later) [recommended default]

```ts
// packages/logger/src/types.ts
export interface TelemetrySink {
  record(entry: LogEntry): void; // fire-and-forget; must never throw
  flush?(): Promise<void>;
}
export const noopTelemetrySink: TelemetrySink = { record() {} };
```

`createPinoLogger` accepts an optional `telemetry` and fans each record to it
in addition to the file. Default = `noopTelemetrySink`. When Axiom is wanted:
an `createAxiomSink({ token, dataset })` in `packages/logger/node`
implements the interface (batched HTTP ingest, flush-on-quit). **Privacy:**
telemetry is opt-in via env/setting; **local file logging is always on.** No
call-site changes when the sink swaps — only the composition root changes.

---

## Section 6 — Testing [recommended default, TDD per AGENTS.md]

- **`packages/logger`** — interface-conformance suite shared across
  `console`/`forwarding`/`pino` impls (same `Logger` contract); `child()`
  merging; `describeError` for Error/string/object/circular; context
  sanitization before IPC send (non-serializable dropped, no throw);
  `inferDomain` mapping.
- **Pino factory** — temp `logDir`; assert per-layer files are created with
  the right `layer` tag and that redacted paths are censored in the file
  content (read back the JSON lines).
- **`packages/agent` / `tools` / `llm`** — existing suites stay green
  (`logger` defaults to `noopLogger`). New spy-logger tests at the key seams:
  stream `error` part → `llm.log` invoked with full error; tool execute →
  `tools.log` invoked; harness turn boundary → `agent.log` invoked.
- **`apps/server`** — assert `runPrompt` threads `ctx.log.{agent,tools,llm}`
  into the right seams; `retry-loop` logs retry start/end on `server.log`.
- **`apps/desktop`** — IPC listener test: a forwarded entry reaches the
  desktop logger with `origin: "renderer"`; try/catch guard holds when IPC
  throws.

---

## Risk register

- **Renderer bundle bloat** — mitigated by the subpath split (`"."` has no
  Pino import; renderer imports `"."` only).
- **IPC serialization throw crashing the renderer** — mitigated by the
  transport try/catch + pre-send sanitization.
- **Logger param churn causing test regressions** — mitigated by
  `noopLogger` default on every `logger?` param; existing tests pass
  unchanged.
- **`packages/llm` adding a dep** — `@sakti-code/logger` becomes the one
  package every layer depends on; verify no cycle (logger depends on nothing
  in the workspace).
- **Standalone-server log dir not writable** — mitigated by
  `createConsoleLogger()` fallback.

## Out of scope

- Axiom/cloud telemetry ingestion (seam provided; implementation deferred).
- Per-tool log files (all tools share `tools.log`).
- Log viewing UI inside the app (a future feature; the files are on disk).
- Changing the `AgentTool.execute` signature (we close over the logger
  instead).
- Migrating the trivial main-process `lib/logger.ts` console wrapper beyond
  re-pointing it at the new desktop logger.
