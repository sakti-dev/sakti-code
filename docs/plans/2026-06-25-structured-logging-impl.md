# Structured Logging Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add centralized, structured, per-layer file logging (Pino) across `packages/llm`, `packages/agent`, `packages/tools`, `apps/server`, and `apps/desktop`, with renderer logs forwarded over IPC, so silent failures like the stream `"Upstream request failed"` error become diagnosable.

**Architecture:** A new `@sakti-code/logger` package owns the `Logger` contract + impls (console / forwarding / noop / pino). The composition root (Electron main, or the standalone server entry) builds one Pino instance per layer (`desktop/server/agent/tools/llm.log`). Each layer receives its logger through its existing dependency-injection seam (`AgentHarnessOptions.logger`, `buildTools(cwd, logger)`, `logger?` on `StreamRequest`/`CompleteRequest`, `ServerContext.log`). The renderer forwards over IPC to the desktop logger. Telemetry (Axiom) is a no-op seam for later.

**Tech Stack:** TypeScript, `vitest`, `pino` + `pino-roll`, existing `typebox`. **No Effect-TS.**

**Design doc:** `docs/plans/2026-06-25-structured-logging.md` (all architectural decisions locked there — read before starting).

---

## Guardrails (apply to every task)

- `exactOptionalPropertyTypes: true` → conditional spread `...(x !== undefined ? { x } : {})`, never pass `undefined`.
- No `any`/`console.log`/`debugger` in production code. (`console.*` inside logging *implementations* is their job — that is the one allowed place.)
- `for...of` over `.forEach()`; arrow callbacks; `unknown` over `any`.
- Tests in `__tests__/` colocated with source; **vitest**, `globals: true`, node env. **TDD**: failing test → verify RED → implement → verify GREEN → commit.
- Lint before commit: `npx biome check` (the `nubx ultracite fix` wrapper has a pre-existing config-nesting error — do **not** use it).
- `logger?` params default to `noopLogger` so existing tests/callers are unaffected (zero regressions is a hard requirement).
- `packages/logger` must depend on **nothing** in the workspace (no cycle: every package depends on it).

---

## Reference commands

```bash
cd packages/logger && nub run test -- <name>     # run a single test by name
cd packages/logger && nub run typecheck          # tsc --noEmit
npx biome check                                   # lint (use this, not nubx)
```

---

## Phase 1 — Scaffold `packages/logger` + pure helpers

### Task 1.1: Scaffold the package

**Files:**
- Create: `packages/logger/package.json`
- Create: `packages/logger/tsconfig.json`
- Create: `packages/logger/vitest.config.ts`
- Create: `packages/logger/src/index.ts` (empty re-export placeholder)

**Step 1:** Mirror `packages/tools/package.json` structure. Set `name: "@sakti-code/logger"`, `version: "0.0.0`, `type: "module"`, scripts `test`/`typecheck` matching siblings. Add `pino` + `pino-roll` to `dependencies` (used only by the `./node` subpath). `exports`:
```json
{
  ".": "./src/index.ts",
  "./node": "./src/node.ts"
}
```
**Step 2:** `tsconfig.json` mirrors `packages/tools/tsconfig.json` (include `src/**/*.ts`).
**Step 3:** `vitest.config.ts` mirrors `packages/tools/vitest.config.ts` (node env, `globals: true`, `src/**/__tests__/**/*.test.ts`).
**Step 4:** `src/index.ts`: `export {};` placeholder.
**Step 5:** Add `"@sakti-code/logger": "workspace:*"` to `packages/llm/package.json` dependencies (root consumer; verifies resolution).
**Step 6:** Run `nub install` (workspace root). Verify `node_modules/@sakti-code/logger` symlinks.
**Step 7:** `cd packages/logger && nub run typecheck` → clean (empty package).
**Step 8:** Commit `feat(logger): scaffold @sakti-code/logger package`.

---

### Task 1.2: Core types (`Logger`, `LogContext`, `LogEntry`, `TelemetrySink`)

**Files:**
- Create: `packages/logger/src/types.ts`
- Create: `packages/logger/src/__tests__/types.test.ts`

**Step 1 — failing test:**
```ts
import { describe, expect, expectTypeOf, it } from "vitest";
import type { LogContext, LogEntry, LogLevel, Logger, TelemetrySink } from "../types.ts";

describe("logger types", () => {
  it("LogLevel is the four levels", () => {
    const l: LogLevel[] = ["debug", "error", "info", "warn"];
    expect(l).toHaveLength(4);
  });
  it("Logger signature is message-first, error as 2nd arg", () => {
    const l = {} as Logger;
    // compile-time check: these calls type-check
    l.info("msg", { domain: "LLM" });
    l.error("msg", new Error("x"), { domain: "LLM" });
    l.warn("msg");
    l.debug("msg");
    l.child({ module: "stream" });
    expectTypeOf<Logger>().toMatchTypeOf<object>();
  });
  it("LogEntry carries level/message/context", () => {
    const e: LogEntry = { level: "info", message: "hi", context: { domain: "UI" } };
    expect(e.level).toBe("info");
  });
  it("TelemetrySink has record + optional flush", () => {
    const s: TelemetrySink = { record() {} };
    expect(typeof s.record).toBe("function");
  });
  it("LogContext accepts arbitrary string keys", () => {
    const c: LogContext = { domain: "LLM", attempt: 2, model: "x" };
    expect(c.attempt).toBe(2);
  });
});
```

**Step 2:** Run → FAIL (module missing).
**Step 3:** Implement `packages/logger/src/types.ts`:
```ts
export type LogLevel = "debug" | "error" | "info" | "warn";

export interface LogContext extends Record<string, unknown> {
  domain?: string;
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

export interface TelemetrySink {
  record(entry: LogEntry): void;
  flush?(): Promise<void>;
}

export const noopTelemetrySink: TelemetrySink = { record() {} };
```
**Step 4:** Run → PASS. `nub run typecheck` → clean.
**Step 5:** Export from `src/index.ts`: `export type { LogContext, LogEntry, LogLevel, Logger, TelemetrySink } from "./types.ts"; export { noopTelemetrySink } from "./types.ts";`
**Step 6:** Commit `feat(logger): core Logger/LogContext/TelemetrySink types`.

---

### Task 1.3: `describeError` helper

**Files:**
- Create: `packages/logger/src/describe-error.ts`
- Create: `packages/logger/src/__tests__/describe-error.test.ts`

**Step 1 — failing test:** assert `describeError(new Error("boom"))` → `"boom"`; `describeError("plain")` → `"plain"`; `describeError({ a: 1 })` → a JSON string; `describeError(undefined)` → a non-empty string; circular object does not throw.
```ts
it("handles circular refs without throwing", () => {
  const o: Record<string, unknown> = { a: 1 };
  o.self = o;
  expect(() => describeError(o)).not.toThrow();
});
```
**Step 2:** Run → FAIL.
**Step 3:** Implement `describe-error.ts`. Port the existing `apps/desktop/src/lib/utils/logger.tsx:6-14` `describeError`, but make it circular-safe (use a replacer/WeakSet in `JSON.stringify`, or catch + fallback to `String(error)`).
**Step 4:** Run → PASS. Export from `index.ts`.
**Step 5:** Commit `feat(logger): describeError helper (circular-safe)`.

---

### Task 1.4: `noopLogger`

**Files:**
- Create: `packages/logger/src/noop.ts`
- Create: `packages/logger/src/__tests__/noop.test.ts`

**Step 1 — failing test:** assert `noopLogger` satisfies `Logger`; calling any method returns `undefined` and does not throw; `noopLogger.child({})` returns a `Logger`.
**Step 2:** Run → FAIL.
**Step 3:** Implement `noop.ts`:
```ts
import type { Logger, LogContext } from "./types.ts";

const noop = (): void => {};

function createNoopLogger(): Logger {
  const self: Logger = {
    child: (_context: LogContext) => createNoopLogger(),
    debug: noop,
    error: noop,
    info: noop,
    warn: noop,
  };
  return self;
}

export const noopLogger: Logger = createNoopLogger();
```
**Step 4:** Run → PASS. Export `noopLogger` from `index.ts`.
**Step 5:** Commit `feat(logger): noopLogger default`.

---

### Task 1.5: `createConsoleLogger` + `inferDomain`

**Files:**
- Create: `packages/logger/src/console.ts`
- Create: `packages/logger/src/infer-domain.ts`
- Create: `packages/logger/src/__tests__/console.test.ts`
- Create: `packages/logger/src/__tests__/infer-domain.test.ts`

**Note:** Port the formatting logic from the existing `apps/desktop/src/lib/utils/logger.tsx` (lines 40-178). This is a near-verbatim move; the existing file is deleted in Phase 6 and replaced by a thin re-export.

**Step 1 — failing tests:**
- `console.test.ts`: a spy on `console.info`/`error`/`warn`/`log` captures the formatted line; `child()` merges context; `error("m", err)` includes `describeError(err)` in the line.
- `infer-domain.test.ts`: `inferDomain({ module: "auth" })` → `"AUTH"`; `inferDomain({ module: "ws-client" })` → `"WS"`; `inferDomain({})` → `"UI"`; explicit `domain` wins.

**Step 2:** Run → FAIL.
**Step 3:** Implement `infer-domain.ts` (the `toDomain` heuristic from `logger.tsx:65-96`) and `console.ts` (the `createBaseLogger`/`createLogger`/`createDomainLogger` from `logger.tsx:140-178`, reusing `describeError` from Task 1.3 and `inferDomain`). Export `createConsoleLogger`, `createLogger`, `createDomainLogger` from `index.ts`.
**Step 4:** Run → PASS. `nub run typecheck` → clean.
**Step 5:** Commit `feat(logger): createConsoleLogger + inferDomain (port from logger.tsx)`.

---

## Phase 2 — `createForwardingLogger` (renderer-safe)

### Task 2.1: Forwarding logger + sanitization

**Files:**
- Create: `packages/logger/src/forwarding.ts`
- Create: `packages/logger/src/__tests__/forwarding.test.ts`

**Behavior:** each call (a) prints to `console` (DevTools) and (b) invokes `transport(sanitizedEntry)`. `transport` is generic (`(e: LogEntry) => void`) — no Electron import. The entry's `context` is sanitized: Errors → `describeError`, circular refs removed, non-serializable values stringified — so IPC structured-clone never throws. `transport` call is wrapped in try/catch so an IPC failure never breaks logging/console.

**Step 1 — failing tests:**
```ts
it("calls transport with level/message and sanitized context", () => {
  const got: LogEntry[] = [];
  const log = createForwardingLogger((e) => got.push(e));
  log.info("hi", { domain: "UI", n: 2 });
  expect(got[0]).toEqual({ level: "info", message: "hi", context: { domain: "UI", n: 2 } });
});
it("folds error via describeError into context.error", () => {
  const got: LogEntry[] = [];
  const log = createForwardingLogger((e) => got.push(e));
  log.error("boom", new Error("x"));
  expect((got[0].context as { error: string }).error).toBe("x");
});
it("drops circular refs from context without throwing", () => {
  const o: Record<string, unknown> = { a: 1 };
  o.self = o;
  const log = createForwardingLogger((e) => e);
  expect(() => log.info("m", { o })).not.toThrow();
});
it("still prints to console when transport throws", () => {
  const spy = vi.spyOn(console, "info").mockImplementation(() => {});
  const log = createForwardingLogger(() => { throw new Error("ipc down"); });
  expect(() => log.info("m")).not.toThrow();
  expect(spy).toHaveBeenCalled();
  spy.mockRestore();
});
it("child() merges context", () => {
  const got: LogEntry[] = [];
  const log = createForwardingLogger((e) => got.push(e)).child({ domain: "WS" });
  log.warn("w");
  expect(got[0].context?.domain).toBe("WS");
});
```

**Step 2:** Run → FAIL.
**Step 3:** Implement `forwarding.ts`:
```ts
import { describeError } from "./describe-error.ts";
import type { LogContext, LogEntry, LogLevel, Logger } from "./types.ts";

const CONSOLE = { debug: console.debug, error: console.error, info: console.info, warn: console.warn };

function sanitize(context: LogContext | undefined, error?: unknown): LogContext | undefined {
  if (context === undefined && error === undefined) return undefined;
  const merged: LogContext = { ...(context ?? {}) };
  if (error !== undefined) merged.error = describeError(error);
  return safeClone(merged);
}

function safeClone(value: unknown): any { /* JSON round-trip with circular-safe replacer; fallback String() */ }

export function createForwardingLogger(transport: (entry: LogEntry) => void): Logger {
  const emit = (defaultCtx: LogContext | undefined) =>
    (level: LogLevel, message: string, context?: LogContext, error?: unknown): void => {
      const entry: LogEntry = { level, message, ...(sanitize({ ...defaultCtx, ...context }, error) === undefined ? {} : { context: sanitize({ ...defaultCtx, ...context }, error) }) };
      CONSOLE[level === "debug" ? "log" : level](formatLine(entry)); // DevTools visibility
      try { transport(entry); } catch { /* IPC down — console sink already fired */ }
    };
  // build a Logger whose child() returns a forwarding logger with merged defaultCtx
}
```
(Fill in `formatLine` by reusing the console-logger line formatter from Task 1.5; `any` here is the one pragmatic escape — wrap it as `unknown`-in/`unknown`-out if biome flags it. Prefer a typed `safeClone(context: LogContext): LogContext`.)

**Step 4:** Run → PASS. `nub run typecheck` → clean. `npx biome check` → clean.
**Step 5:** Export `createForwardingLogger` from `index.ts`.
**Step 6:** Commit `feat(logger): createForwardingLogger (renderer-safe, sanitizing)`.

---

## Phase 3 — Node Pino factory

### Task 3.1: Pure pino-arg mapper (testable without a worker)

**Files:**
- Create: `packages/logger/src/node/pino-args.ts`
- Create: `packages/logger/src/__tests__/pino-args.test.ts`

**Why split this out:** Pino's file transport runs in a worker thread, which is flaky to assert against in unit tests. The mapping from our `(level, message, context, error, layer)` → pino's `(obj, msg)` call shape is pure and unit-tested in isolation.

**Step 1 — failing tests:**
```ts
it("maps info to pino (obj, msg) with layer + context merged", () => {
  expect(toPinoCall("info", "hi", { domain: "LLM" }, undefined, "llm"))
    .toEqual([{ domain: "LLM", layer: "llm" }, "hi"]);
});
it("maps error by folding describeError into obj.error", () => {
  const [obj] = toPinoCall("error", "boom", { domain: "LLM" }, new Error("x"), "llm");
  expect((obj as { error: string }).error).toBe("x");
  expect((obj as { layer: string }).layer).toBe("llm");
});
```

**Step 2:** Run → FAIL.
**Step 3:** Implement `pino-args.ts`:
```ts
import { describeError } from "../describe-error.ts";
import type { LogContext, LogLevel } from "../types.ts";

export function toPinoCall(
  level: LogLevel,
  message: string,
  context: LogContext | undefined,
  error: unknown | undefined,
  layer: string,
): [Record<string, unknown>, string] {
  const obj: Record<string, unknown> = { ...(context ?? {}), layer };
  if (error !== undefined) obj.error = describeError(error);
  return [obj, message];
}
```
**Step 4:** Run → PASS. Export from `src/node.ts`.
**Step 5:** Commit `feat(logger): pure pino-arg mapper`.

---

### Task 3.2: `createPinoLogger` + redaction + rotation

**Files:**
- Create: `packages/logger/src/node/pino.ts`
- Modify: `packages/logger/src/node.ts` (subpath entry: re-export `createPinoLogger`, `toPinoCall`)
- Create: `packages/logger/src/__tests__/pino.test.ts`

**Step 1 — failing tests** (inject a fake pino to avoid worker-thread flakiness — mirrors the `runStreamText` injection pattern in `packages/llm/src/stream.ts`):
```ts
it("builds a pino instance with redact + pino-roll transport and logs via the adapter", () => {
  const calls: Array<{ level: string; obj: unknown; msg: string }> = [];
  const fakePino = (opts: Record<string, unknown>) => ({
    info: (o: unknown, m: string) => calls.push({ level: "info", obj: o, msg: m }),
    error: (o: unknown, m: string) => calls.push({ level: "error", obj: o, msg: m }),
    warn: (o: unknown, m: string) => calls.push({ level: "warn", obj: o, msg: m }),
    debug: (o: unknown, m: string) => calls.push({ level: "debug", obj: o, msg: m }),
    child: () => fakePino(opts),
  });
  const log = createPinoLogger({ dest: "agent.log", layer: "agent", logDir: "/tmp/x", pinoFactory: fakePino as never });
  log.info("hi", { domain: "AGENT" });
  expect(calls[0]).toEqual({ level: "info", obj: { domain: "AGENT", layer: "agent" }, msg: "hi" });
});
it("child() preserves layer and merges context", () => {
  // spy pino; child().info merges {module:"loop"} into obj alongside layer
});
it("telemetry sink receives each entry (no-op default)", () => {
  const seen: LogEntry[] = [];
  const log = createPinoLogger({ dest: "x.log", layer: "x", logDir: "/tmp/x", telemetry: { record: (e) => seen.push(e) }, pinoFactory: fakePino as never });
  log.warn("w", { attempt: 1 });
  expect(seen[0].level).toBe("warn");
});
it("default redact paths include apiKey/authorization/cookie", () => {
  // assert the options passed to fakePino contain redact.paths with those entries
});
```

**Step 2:** Run → FAIL.
**Step 3:** Implement `pino.ts`:
```ts
import type { LogContext, LogEntry, LogLevel, Logger, TelemetrySink } from "../types.ts";
import { noopTelemetrySink } from "../types.ts";
import { toPinoCall } from "./pino-args.ts";

export interface PinoLoggerOptions {
  dest: string;          // basename, placed in logDir
  layer: string;         // tag on every record
  logDir: string;
  level?: LogLevel;      // default "info"
  redactPaths?: string[];
  telemetry?: TelemetrySink;       // default noopTelemetrySink
  pinoFactory?: unknown;           // test injection; production omits → real pino+pino-roll
}

const DEFAULT_REDACT = ["*.apiKey", "*.authorization", "*.cookie", "apiKey", "headers.authorization", "headers.cookie"];

export function createPinoLogger(opts: PinoLoggerOptions): Logger {
  const telemetry = opts.telemetry ?? noopTelemetrySink;
  const layer = opts.layer;
  const pino = opts.pinoFactory !== undefined
    ? (opts.pinoFactory as (o: Record<string, unknown>) => PinoInstance)({ level: opts.level ?? "info", redact: { paths: opts.redactPaths ?? DEFAULT_REDACT, censor: "[REDACTED]" } })
    : createRealPino(opts);
  function make(defaultCtx: LogContext | undefined): Logger {
    const send = (level: LogLevel, message: string, context?: LogContext, error?: unknown): void => {
      const [obj, msg] = toPinoCall(level, message, mergeCtx(defaultCtx, context), error, layer);
      pino[level](obj, msg);
      telemetry.record({ level, message, ...(context === undefined ? {} : { context }) });
    };
    return {
      child: (c) => make({ ...defaultCtx, ...c }),
      debug: (m, c) => send("debug", m, c),
      error: (m, e, c) => send("error", m, c, e),
      info: (m, c) => send("info", m, c),
      warn: (m, c) => send("warn", m, c),
    };
  }
  return make(undefined);
}
```
`createRealPino` does the dynamic `import("pino")` + `pino.transport({ target: "pino-roll", options: { file: join(logDir, dest), frequency: "daily", size: "10m", mkdir: true } })` so the renderer (which imports `"."` only) never pulls pino. `mergeCtx` deep-merges default + call context.

**Step 4:** Run → PASS. `nub run typecheck` → clean. `npx biome check` → clean.
**Step 5:** `src/node.ts`: `export { createPinoLogger } from "./src/node/pino.ts"; export type { PinoLoggerOptions } from "./src/node/pino.ts"; export { toPinoCall } from "./src/node/pino-args.ts";`
**Step 6:** Commit `feat(logger): createPinoLogger (pino + pino-roll + redaction, injectable for tests)`.

---

## Phase 4 — Wire `logger?` into llm / agent / tools

> **Regression guard:** every `logger?` param defaults to `noopLogger`. Run each package's full test suite after each task — it must stay green with no call-site changes.

### Task 4.1: `packages/llm` — log stream/complete errors (the bug-surfacing layer)

**Files:**
- Modify: `packages/llm/src/stream.ts` (`StreamRequest` gains `logger?: Logger`; `streamWithModel` wraps `fullStream` to log `error`/`finish`)
- Modify: `packages/llm/src/complete.ts` (`CompleteRequest` gains `logger?: Logger`; logs caught errors)
- Modify: `packages/llm/src/index.ts` (re-export noopLogger import path is the caller's concern — no change)
- Create: `packages/llm/src/__tests__/stream-logging.test.ts`

**Step 1 — failing test:**
```ts
it("logs full error detail when the stream emits an error part", async () => {
  const seen: LogEntry[] = [];
  const log: Logger = { child: () => log, debug(){}, error:(m,e,c)=>seen.push({level:"error",message:m,context:c}), info(){}, warn(){} };
  const fakeStream = async function* () { yield { type: "error", error: new Error("Upstream request failed") }; };
  const { fullStream, result } = streamWithModel(req({ logger: log }), fakeModel, fakeStreamText(fakeStream));
  for await (const _ of fullStream) { /* drain */ }
  await result.catch(() => {});
  expect(seen.some((e) => /Upstream request failed/.test(String(e.context?.error)))).toBe(true);
});
```
Also assert the logged context includes `model`, `provider`, `baseURL` (threaded from `req.model`).

**Step 2:** Run → FAIL.
**Step 3:** Implement:
- `stream.ts`: add `logger?: Logger` to `StreamRequest`; import `noopLogger` from `@sakti-code/logger`. In `streamWithModel`, wrap `raw.fullStream` in an async generator that, on each part: if `part.type === "error"`, calls `logger.error("stream error", part.error, { model: req.model.id, provider: req.model.provider, baseURL: req.model.baseUrl })`; yields the part through unchanged. On `finish`, optionally `logger.debug("stream finish", { finishReason })`.
- `complete.ts`: add `logger?: Logger` to `CompleteRequest`; in the `catch`, `logger.error("complete failed", error, { model: req.model.id })`.
- Default both to `noopLogger`.
**Step 4:** Run → PASS. Run `cd packages/llm && nub run test` → all 117 + new green. `nub run typecheck`.
**Step 5:** Commit `feat(llm): log stream/complete errors (surfaces provider failures)`.

---

### Task 4.2: `packages/agent` — `AgentHarnessOptions.logger` + loop logging

**Files:**
- Modify: `packages/agent/src/types.ts` (`AgentLoopConfig` gains `logger?: Logger`)
- Modify: `packages/agent/src/harness/agent-harness.ts` (`AgentHarnessOptions.logger` → stored → threaded into loop config)
- Modify: `packages/agent/src/loop/agent-loop.ts` (log turn start/end, tool-call dispatch, captured stream error)
- Create: `packages/agent/src/loop/__tests__/agent-loop-logging.test.ts`

**Step 1 — failing test:** inject a spy logger; run a turn with a fake stream that yields text + finish; assert `info("turn start")` and `debug("tool dispatch")` (when a tool-call part flows) were called. Run a turn whose stream yields an `error` part; assert `logger.error` was called.
**Step 2:** Run → FAIL.
**Step 3:** Implement. Default `noopLogger`. Add `@sakti-code/logger` to `packages/agent` deps.
**Step 4:** Run → PASS. `cd packages/agent && nub run test` → 115 + new green. `nub run typecheck`.
**Step 5:** Commit `feat(agent): harness + loop logging via injected logger`.

---

### Task 4.3: `packages/tools` — `buildTools(cwd, logger?)`

**Files:**
- Modify: `packages/tools/src/index.ts` (or wherever `buildTools` lives — Grep `export function buildTools`)
- Modify: `packages/tools/src/tools/{read,write,edit,bash,grep,find}.ts` (close over an injected logger; log execute entry/exit/error)
- Create: `packages/tools/src/__tests__/tools-logging.test.ts`

**Step 1 — failing test:** `buildTools(cwd, spyLogger)`; invoke the bash tool; assert `spyLogger.debug` called with the tool name. Invoke read on a missing file; assert `spyLogger.error` called.
**Step 2:** Run → FAIL.
**Step 3:** Implement: `buildTools(cwd: string, logger: Logger = noopLogger)`. Pass `logger.child({ domain: "TOOL", module: name })` into each tool at construction. Existing `buildTools(cwd)` callers still work (default arg).
**Step 4:** Run → PASS. `cd packages/tools && nub run test` → 48 + new green.
**Step 5:** Commit `feat(tools): buildTools accepts a logger; tools log execute + errors`.

---

## Phase 5 — Server wiring + standalone composition root

### Task 5.1: `ServerContext.log` + standalone server builds the set

**Files:**
- Modify: `apps/server/src/context.ts` (add `log: ServerLoggers` to `ServerContext`)
- Create: `apps/server/src/lib/loggers.ts` (`createServerLoggers({ logDir, level }): { server, agent, tools, llm }` — calls `createPinoLogger` from `@sakti-code/logger/node` 4×, with console fallback)
- Modify: `apps/server/src/index.ts` (build loggers at boot: `logDir = process.env.SAKTI_LOG_DIR ?? ~/.sakti/logs`; try/catch → console fallback; inject into ctx)
- Create: `apps/server/src/__tests__/loggers.test.ts`

**Step 1 — failing test:** `createServerLoggers({ logDir: tmp, level: "debug" })` returns 4 loggers; writing via each creates `server.log`/`agent.log`/`tools.log`/`llm.log` in `logDir` (use `createPinoLogger` with injected fake factory, or assert file creation with real pino + small flush). Console-fallback path: when `logDir` unwritable, returns console loggers (no throw).
**Step 2:** Run → FAIL.
**Step 3:** Implement `createServerLoggers` and wire into `ServerContext`. Add `@sakti-code/logger` + the `/node` subpath to `apps/server` deps.
**Step 4:** Run → PASS. `cd apps/server && nub run typecheck`.
**Step 5:** Commit `feat(server): ServerContext.log + standalone logger-set composition root`.

---

### Task 5.2: `runner.ts` threads the loggers

**Files:**
- Modify: `apps/server/src/agent/runner.ts` (`runPrompt`: `buildTools(cwd, ctx.log.tools)`, `new Harness({ ..., logger: ctx.log.agent })`, stream request carries `logger: ctx.log.llm`)

**Step 1 — failing test:** a `runPrompt` test with a spy ctx.log asserts the harness got `ctx.log.agent`, buildTools got `ctx.log.tools`, and the stream request got `ctx.log.llm`. (Use the existing faux-LLM test pattern; inject spies.)
**Step 2:** Run → FAIL.
**Step 3:** Implement the three wiring points.
**Step 4:** Run → PASS. `cd apps/server && nub run test` → green (5 pre-existing failures unchanged).
**Step 5:** Commit `feat(server): runPrompt threads per-layer loggers into harness/tools/llm`.

---

### Task 5.3: ws-handler + retry-loop + routes use `ctx.log.server`

**Files:**
- Modify: `apps/server/src/agent/ws-handler.ts`, `apps/server/src/agent/retry-loop.ts` (signatures gain access to the server logger — thread via the caller), and any route that handles errors.

**Step 1 — failing test:** retry-loop emits start/end → `ctx.log.server.info` called with attempt/delay.
**Step 2:** Run → FAIL.
**Step 3:** Implement (thread the logger into retry-loop's deps; ws-handler logs connect/disconnect/prompt).
**Step 4:** Run → PASS.
**Step 5:** Commit `feat(server): ws-handler + retry-loop log to server.log`.

---

## Phase 6 — Renderer IPC + replace `logger.tsx`

### Task 6.1: Preload bridge + main IPC listener

**Files:**
- Modify: `apps/desktop/electron/preload/index.ts` (add `log: (entry) => ipcRenderer.send("renderer-log", entry)` to the `contextBridge` `sakti` surface; type the `LogEntry` param from `@sakti-code/logger`)
- Modify: `apps/desktop/electron/shared/` (shared types for the bridge if applicable)
- Modify: `apps/desktop/electron/main/index.ts` (register `ipcMain.on("renderer-log", ...)` → `loggers.desktop[level](message, { ...context, origin: "renderer" })`)
- Create: `apps/desktop/electron/main/__tests__/ipc-log.test.ts`

**Step 1 — failing test:** simulate an `ipcMain` "renderer-log" event with `{ level: "info", message: "hi", context: { domain: "UI" } }`; assert the desktop logger received `.info("hi", { domain: "UI", origin: "renderer" })`. (Use electron-mock or factor the handler into a pure testable function `(entry, desktopLogger) => void`.)
**Step 2:** Run → FAIL.
**Step 3:** Implement the bridge + listener.
**Step 4:** Run → PASS. `cd apps/desktop && nub run typecheck`.
**Step 5:** Commit `feat(desktop): renderer→desktop.log IPC bridge`.

---

### Task 6.2: Replace `apps/desktop/src/lib/utils/logger.tsx` with the forwarding logger

**Files:**
- Modify: `apps/desktop/src/lib/utils/logger.tsx` → shrink to a thin module that builds the forwarding logger wired to `window.sakti.log`, re-exporting `logger`, `createLogger`, `createDomainLogger`, `describeError` (re-exported from `@sakti-code/logger`).
- Modify: the 5 call sites (Grep `lib/utils/logger`) → import from `@sakti-code/logger` directly (types) or the thin local module (the `logger` instance). The `Logger` signature is identical, so call code is unchanged.

**Step 1 — failing test:** in a jsdom renderer test, `window.sakti.log` is a spy; `logger.info("x")` calls the spy with `{ level: "info", message: "x", ... }` AND prints to console.
**Step 2:** Run → FAIL.
**Step 3:** Implement the thin re-export:
```ts
import { createForwardingLogger, describeError, createDomainLogger as _cdl } from "@sakti-code/logger";
import type { Logger } from "@sakti-code/logger";
export const logger: Logger = createForwardingLogger((e) => window.sakti.log(e));
export const createLogger = () => logger;
export const createDomainLogger = _cdl;
export { describeError };
```
**Step 4:** Run → PASS. Update the 5 import sites. `cd apps/desktop && nub run typecheck`.
**Step 5:** Commit `feat(desktop): renderer logger → forwarding logger via packages/logger`.

---

## Phase 7 — Electron composition root (all 5 loggers)

### Task 7.1: Desktop main builds the 5-logger set and feeds the embedded server

**Files:**
- Modify: `apps/desktop/electron/main/lib/logger.ts` (replace the 8-line console wrapper with a build of the full 5-logger set using `createPinoLogger` from `@sakti-code/logger/node`; `logDir = app.getPath('userData')/logs`; export `{ desktop, server, agent, tools, llm }`)
- Modify: `apps/desktop/electron/main/index.ts` (or wherever `createServer` is called) → pass `{ server, agent, tools, llm }` into the server `ctx`; keep `desktop` for main + the IPC listener)

**Step 1 — failing test:** a main-process test asserts the logger-set builder creates 5 Pino loggers into `app.getPath('userData')/logs` with the right `layer` tags; the embedded-server `ctx.log` receives the 4 server-side ones.
**Step 2:** Run → FAIL.
**Step 3:** Implement. (The standalone-server `createServerLoggers` from Task 5.1 can be reused here for the 4 server-side ones; build `desktop` separately.)
**Step 4:** Run → PASS. `cd apps/desktop && nub run typecheck`.
**Step 5:** Commit `feat(desktop): main-process owns the 5-logger set; feeds embedded server`.

---

## Phase 8 — Verification

### Task 8.1: Workspace typecheck + lint
- `npx biome check` → clean across `packages/logger`, `packages/llm`, `packages/agent`, `packages/tools`, `apps/server`, `apps/desktop`.
- `nub run typecheck` → all 6+1 packages clean.
- Commit `chore(logger): lint + typecheck`.

### Task 8.2: Full test suite — zero regressions
- `packages/logger`: all new tests green.
- `packages/llm` (117 + new), `packages/agent` (115 + new), `packages/tools` (48 + new), `packages/db` (36), `apps/desktop` (252 + new), `apps/server` (231/5 pre-existing).
- Pre-existing failures unchanged. Commit if any test fixtures needed updating.

### Task 8.3: End-to-end dogfood check
- Run the Electron app; trigger the same prompt that produced `"Upstream request failed"`.
- Confirm `~/.config/sakti-code/logs/llm.log` (or `userData/logs/llm.log`) now contains the full error object + model + baseURL + providerOptions — the previously-invisible detail.
- Confirm `desktop.log` contains renderer-origin lines tagged `origin: "renderer"`.
- (No commit — verification only. If the retry-pattern gap from the earlier bug investigation is still relevant, file it separately.)
