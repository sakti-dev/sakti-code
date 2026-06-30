# Cache-Stability Phase 2: Tool Sort, Diagnostics, Pinned Turns

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Three independent cache-stability improvements: §7 (sort tool schemas before send), §10 (cache-shape diagnostics events), §5.1 (pin small user turns through compaction).

**Architecture:** All three are independent — can be executed in any order. Recommended order is A → B → C (trivial freebie first, then observability foundation, then correctness fix). §10 builds on the §11 measurement helpers landed in Phase 1 but moves them from test-only to runtime. §5.1 is the highest-value correctness fix (user-stated facts survive compaction).

**Tech Stack:** TypeScript, Effect, vitest, `@sakti-code/llm` StreamRequest, AgentEvent union type.

**Design references (read before starting):**

- `openspec/references/DeepSeek-Reasonix/internal/agent/cache_shape.go` — §10 PrefixShape pattern
- `openspec/references/DeepSeek-Reasonix/internal/agent/compact.go:359-384` — §5.1 pinnedPrefixLen + pinnableUserTurn
- `packages/agent/src/core/__tests__/cache-stability-helpers.ts` — Phase 1 measurement helpers (test-only)
- `packages/agent/src/core/agent-loop.ts:461-479` — StreamRequest build site (§7 + §10 integration)
- `packages/agent/src/core/agent-loop.ts:257-275` — `runLoopEffect` entry (§10 streamFn wrap point)
- `packages/agent/src/compaction/compaction.ts:624-680` — `prepareCompaction` messagesToSummarize + return (§5.1)
- `packages/agent/src/compaction/compaction.ts:684-760` — `compactEffect` summary generation (§5.1)

**Conventions (from repo `AGENTS.md`):**

- TDD: failing test → implement → pass → commit.
- Tests colocated in `__tests__/`. `vitest`. No `.only`/`.skip`.
- `exactOptionalPropertyTypes: true` → conditional spread, never pass `undefined`.
- `for...of` over `.forEach()`. Arrow callbacks. `const` by default.
- `noUncheckedIndexedAccess: true` → `arr[i]!` after bounds check.
- Verify each task: `cd packages/agent && pnpm run typecheck && pnpm run test`.

---

## Change A: §7 — Tool schemas sorted before send

**Why:** Tool order in the request depends on registration order (`buildTools` output). A new tool or MCP plugin connecting mid-session shifts indices and busts the cache prefix for zero semantic reason. Sorting by name makes tool order deterministic — a non-cache-affecting property.

**What Reasonix does** (`cache_shape.go:51-64`): sorts by (name, description, parameters JSON) before hashing AND before sending.

### Task A1: Sort tools in `toStreamTools` + regression test

**Files:**

- Modify: `packages/agent/src/core/agent-loop.ts` — `toStreamTools` function (~line 680)
- Test: `packages/agent/src/core/__tests__/cache-stability.test.ts` — append test

**Step 1: Write the failing test**

Append to `packages/agent/src/core/__tests__/cache-stability.test.ts`, inside the existing `describe("cache-stability: prefix stable across turns", ...)` block (after the hit-rate test):

```ts
it("tool schemas are sorted by name in the request regardless of registration order", async () => {
  const registration = registerFauxStreamProvider();
  registrations.push(registration);
  const captures: StreamRequest[] = [];

  registration.setResponses([
    () => fauxAssistantMessage("done"),
    () => fauxAssistantMessage("done"),
  ]);

  // Register tools in NON-alphabetical order: zeta, alpha, middle.
  const zeta = makeEchoTool("zeta");
  const alpha = makeEchoTool("alpha");
  const middle = makeEchoTool("middle");

  const harness = new AgentHarness({
    env: new TestExecutionEnv(process.cwd()),
    session: await createTestSession(),
    model: registration.getModel(),
    streamFn: (req) => {
      captures.push(req);
      return registration.streamFn(req);
    },
    systemPrompt: "sorted-tools test",
    tools: [zeta, alpha, middle],
  });

  await harness.prompt("run once");

  expect(captures.length).toBeGreaterThanOrEqual(1);
  const toolsKeys = captures[0]!.tools ? Object.keys(captures[0]!.tools!) : [];
  expect(toolsKeys).toEqual(["alpha", "middle", "zeta"]);
});
```

Add the `makeEchoTool` helper near `calculateSchema` at the top of the file:

```ts
function makeEchoTool(name: string): AgentTool<typeof Type.Object({ text: Type.String() })> {
  const schema = Type.Object({ text: Type.String() });
  return {
    name,
    label: name,
    description: `echo tool ${name}`,
    parameters: schema,
    async execute(_id, _params) {
      return { content: [{ type: "text", text: name }], details: {} };
    },
  };
}
```

You'll also need to add `Type` to the imports (from `typebox`) and `AgentTool` to the type imports if not already present.

**Step 2: Run — verify it fails**

```bash
cd packages/agent && pnpm run test -- --run "tool schemas are sorted"
```

Expected: FAIL — `toolsKeys` will be `["zeta", "alpha", "middle"]` (registration order), not sorted.

**Step 3: Implement**

In `packages/agent/src/core/agent-loop.ts`, modify `toStreamTools` (~line 680):

```ts
/** Convert AgentTool[] to @ai-sdk tool format (schema-only, no execute).
 *  Sorted by name so tool order is deterministic and cache-stable — a new
 *  tool or MCP plugin connecting mid-session won't shift indices and bust
 *  the prefix. Mirrors Reasonix cache_shape.go:51-64. */
function toStreamTools(tools: AgentTool[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const tool of [...tools].sort((a, b) => a.name.localeCompare(b.name))) {
    result[tool.name] = {
      description: tool.description,
      inputSchema: jsonSchema(tool.parameters),
    };
  }
  return result;
}
```

**Step 4: Run — verify it passes**

```bash
cd packages/agent && pnpm run typecheck && pnpm run test -- --run "tool schemas are sorted"
```

**Step 5: Commit**

```bash
git add packages/agent/src/core/agent-loop.ts \
        packages/agent/src/core/__tests__/cache-stability.test.ts
git commit -m "fix(agent): sort tool schemas by name before send (§7)

Tools are now sorted alphabetically before serialization into the
StreamRequest, so registration order no longer affects the wire bytes.
Eliminates a class of accidental cache busts when a tool or MCP plugin
connects mid-session and shifts indices."
```

---

## Change B: §10 — Cache-shape diagnostics

**Why:** Without observability, cache misses are invisible. A regression that adds a timestamp to the system prompt, reorders tools, or stops preserving message order shows up as silent cost bleed. Per-turn diagnostics explain WHY a miss happened; session-cumulative counters give a steady cost-oriented hit rate.

**What Reasonix does** (`cache_shape.go`):

- `PrefixShape` = SHA-8 of system + sorted tools + combined prefix.
- `CompareShape(prev, cur, usage)` → `["system" | "tools" | "log_rewrite"]` reasons + actual `CacheHitTokens`/`CacheMissTokens` from provider usage.
- Session-cumulative `sessCacheHit`/`sessCacheMiss` survive compaction.

**Our infrastructure:** The Phase 1 `measureCacheHit` helpers do full byte-comparison (test-only, expensive). §10 uses **hash-based** comparison (cheap, runtime-suitable) + provider `usage.cacheRead`/`cacheWrite` for real hit/miss tokens.

### Task B1: `captureShape` + `compareShape` runtime helpers

**Files:**

- Create: `packages/agent/src/core/cache-shape.ts`
- Test: `packages/agent/src/core/__tests__/cache-shape.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import type { StreamRequest, Usage } from "@sakti-code/llm";
import {
  type CacheDiagnostics,
  type PrefixShape,
  captureShape,
  compareShape,
} from "../cache-shape";

function req(over: Partial<StreamRequest> = {}): StreamRequest {
  return {
    model: { id: "m" },
    messages: [],
    ...over,
  } as StreamRequest;
}

const usage = (cacheRead = 0, cacheWrite = 0): Usage => ({
  input: 100,
  output: 50,
  cacheRead,
  cacheWrite,
  totalTokens: 100 + 50 + cacheRead + cacheWrite,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
});

describe("captureShape", () => {
  it("hashes system + tools into a stable PrefixShape", () => {
    const shape = captureShape(req({ system: "prompt", tools: { read: { description: "r" } } }));
    expect(shape.systemHash).toMatch(/^[0-9a-f]{8}$/);
    expect(shape.toolsHash).toMatch(/^[0-9a-f]{8}$/);
    expect(shape.prefixHash).toMatch(/^[0-9a-f]{8}$/);
  });

  it("produces identical hashes for identical inputs", () => {
    const a = captureShape(req({ system: "p", tools: { a: {} } }));
    const b = captureShape(req({ system: "p", tools: { a: {} } }));
    expect(a).toEqual(b);
  });

  it("changes systemHash when system prompt changes", () => {
    const a = captureShape(req({ system: "p1" }));
    const b = captureShape(req({ system: "p2" }));
    expect(a.systemHash).not.toBe(b.systemHash);
  });
});

describe("compareShape", () => {
  it("reports no changes when shapes are identical", () => {
    const shape = captureShape(req({ system: "p", tools: { a: {} } }));
    const d = compareShape(shape, shape, usage(500, 100));
    expect(d.changed).toBe(false);
    expect(d.changeReasons).toEqual([]);
    expect(d.cacheHitTokens).toBe(500);
    expect(d.cacheMissTokens).toBe(100);
  });

  it("reports 'system' when systemHash differs", () => {
    const prev = captureShape(req({ system: "p1" }));
    const cur = captureShape(req({ system: "p2" }));
    const d = compareShape(prev, cur, usage());
    expect(d.changed).toBe(true);
    expect(d.changeReasons).toContain("system");
  });

  it("reports 'tools' when toolsHash differs", () => {
    const prev = captureShape(req({ tools: { a: {} } }));
    const cur = captureShape(req({ tools: { a: {}, b: {} } }));
    const d = compareShape(prev, cur, usage());
    expect(d.changed).toBe(true);
    expect(d.changeReasons).toContain("tools");
  });

  it("treats first-ever turn (prev undefined) as unchanged baseline", () => {
    const cur = captureShape(req({ system: "p" }));
    const d = compareShape(undefined, cur, usage(0, 500));
    expect(d.changed).toBe(false);
    expect(d.changeReasons).toEqual([]);
  });
});
```

**Step 2: Run — verify it fails**

```bash
cd packages/agent && pnpm run test -- --run cache-shape
```

Expected: FAIL — module not found.

**Step 3: Implement**

Create `packages/agent/src/core/cache-shape.ts`:

```ts
import { createHash } from "node:crypto";
import type { StreamRequest, Usage } from "@sakti-code/llm";

/**
 * # Cache-shape diagnostics (§10)
 *
 * Hash-based prefix comparison for runtime cache-stability observability.
 * Mirrors Reasonix's `cache_shape.go` PrefixShape/CompareShape pattern but
 * uses our {@link StreamRequest} shape and provider `usage.cacheRead`/`cacheWrite`
 * for real hit/miss tokens (no mock endpoint needed).
 *
 * Unlike the Phase 1 `measureCacheHit` test helpers (full byte-comparison),
 * this is cheap enough to run every turn: two short SHA-8 hashes + a field
 * comparison.
 */

/** Short stable hash for diagnostics display (first 8 hex chars of SHA-256). */
function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 8);
}

/** Snapshot of the cache-relevant prefix of a request. */
export interface PrefixShape {
  /** Hash of the system prompt. */
  systemHash: string;
  /** Hash of the tools JSON (sorted keys for determinism). */
  toolsHash: string;
  /** Combined hash of {system, tools} — changes iff either changes. */
  prefixHash: string;
}

/** Per-turn diagnostics explaining why a cache hit or miss happened. */
export interface CacheDiagnostics {
  /** Current prefix hash (for display). */
  prefixHash: string;
  /** True when system or tools changed since the previous turn. */
  changed: boolean;
  /** Which component(s) changed: "system" | "tools". */
  changeReasons: string[];
  /** Current system hash (for display). */
  systemHash: string;
  /** Current tools hash (for display). */
  toolsHash: string;
  /** Provider-reported cache hit tokens (from usage.cacheRead). */
  cacheHitTokens: number;
  /** Provider-reported cache miss tokens (from usage.cacheWrite). */
  cacheMissTokens: number;
  /** Hit rate percentage from provider usage (0–100). 0 when no cache data. */
  hitRate: number;
}

/** Capture a {@link StreamRequest}'s prefix shape. */
export function captureShape(req: StreamRequest): PrefixShape {
  const system = req.system ?? "";
  const toolsSorted = req.tools ? JSON.stringify(req.tools, Object.keys(req.tools).sort()) : "{}";
  const prefix = JSON.stringify({ system, tools: toolsSorted });
  return {
    systemHash: shortHash(system),
    toolsHash: shortHash(toolsSorted),
    prefixHash: shortHash(prefix),
  };
}

/**
 * Compare two consecutive turns' shapes and explain a cache miss.
 * `prev === undefined` (first turn) → unchanged baseline (nothing to compare).
 */
export function compareShape(
  prev: PrefixShape | undefined,
  cur: PrefixShape,
  usage: Usage | undefined,
): CacheDiagnostics {
  const reasons: string[] = [];
  if (prev !== undefined) {
    if (prev.systemHash !== cur.systemHash) {
      reasons.push("system");
    }
    if (prev.toolsHash !== cur.toolsHash) {
      reasons.push("tools");
    }
  }
  const cacheHitTokens = usage?.cacheRead ?? 0;
  const cacheMissTokens = usage?.cacheWrite ?? 0;
  const total = cacheHitTokens + cacheMissTokens;
  const hitRate = total === 0 ? 0 : Math.floor((cacheHitTokens * 100) / total);
  return {
    prefixHash: cur.prefixHash,
    changed: reasons.length > 0,
    changeReasons: reasons,
    systemHash: cur.systemHash,
    toolsHash: cur.toolsHash,
    cacheHitTokens,
    cacheMissTokens,
    hitRate,
  };
}
```

**Step 4: Run — verify it passes**

```bash
cd packages/agent && pnpm run typecheck && pnpm run test -- --run cache-shape
```

**Step 5: Commit**

```bash
git add packages/agent/src/core/cache-shape.ts \
        packages/agent/src/core/__tests__/cache-shape.test.ts
git commit -m "feat(agent): cache-shape diagnostics helpers (§10 foundation)"
```

---

### Task B2: Add `cache_shape` event to AgentEvent + emit from loop

**Files:**

- Modify: `packages/agent/src/types.ts` — add `cache_shape` variant to `AgentEvent`
- Modify: `packages/agent/src/core/agent-loop.ts` — wrap streamFn in `runLoopEffect`, emit event
- Test: `packages/agent/src/core/__tests__/agent-loop.test.ts` — add test for emission

**Step 1: Write the failing test**

Append to `packages/agent/src/core/__tests__/agent-loop.test.ts`. Add a test that verifies a `cache_shape` event is emitted with the right fields after a turn:

```ts
it("emits a cache_shape event with hit/miss tokens from usage", async () => {
  const context: AgentContext = {
    systemPrompt: "You are helpful.",
    messages: [],
    tools: [],
  };
  const userPrompt = createUserMessage("Hello");

  const config: AgentLoopConfig = {
    model: createModel(),
    convertToLlm: identityConverter,
  };

  // Response with non-zero cache usage.
  const { fn: streamFn } = makeStreamFn({
    content: [{ type: "text", text: "Hi!" }],
    usage: createMockUsage(500, 50, 800, 200), // cacheRead=800, cacheWrite=200
  });

  const events: AgentEvent[] = [];
  const stream = agentLoop([userPrompt], context, config, undefined, streamFn);
  for await (const event of stream) {
    events.push(event);
    if (event.type === "agent_end") break;
  }

  const shapeEvent = events.find((e) => e.type === "cache_shape");
  expect(shapeEvent).toBeDefined();
  if (shapeEvent?.type === "cache_shape") {
    expect(shapeEvent.diagnostics.cacheHitTokens).toBe(800);
    expect(shapeEvent.diagnostics.cacheMissTokens).toBe(200);
    expect(shapeEvent.diagnostics.prefixHash).toMatch(/^[0-9a-f]{8}$/);
  }
});
```

> **Note:** `createMockUsage` needs to accept `(input, output, cacheRead, cacheWrite)`. Check the existing helper signature — if it only takes `(input, output, cacheRead, cacheWrite)`, align the call. If the existing `fakeStreamResult` doesn't carry usage, you may need to extend it to include the usage in the finish result. Check `fakeStreamResult`'s `finish` object.

**Step 2: Run — verify it fails**

```bash
cd packages/agent && pnpm run test -- --run "emits a cache_shape event"
```

Expected: FAIL — `cache_shape` is not a known event type / no event emitted.

**Step 3: Implement**

3a. Add the event variant to `AgentEvent` in `packages/agent/src/types.ts` (append to the union before the closing `>`):

```ts
  | {
      type: "cache_shape";
      diagnostics: import("./core/cache-shape").CacheDiagnostics;
    };
```

> If the import-in-type-literal style causes issues, add a top-level import at the top of `types.ts`: `import type { CacheDiagnostics } from "./core/cache-shape";` and reference `CacheDiagnostics` directly.

3b. In `packages/agent/src/core/agent-loop.ts`, import the helpers at the top:

```ts
import { captureShape, compareShape } from "./cache-shape";
```

3c. In `runLoopEffect` (~line 265), wrap `streamFn` to capture the request shape and emit diagnostics. Add this BEFORE the `while (true)` loop, after the `pendingMessages` initialization:

```ts
// §10: wrap streamFn to capture prefix shape for cache diagnostics.
let prevShape: ReturnType<typeof captureShape> | undefined;
let lastShape: ReturnType<typeof captureShape> | undefined;
const diagnosticStreamFn: StreamFn | undefined = streamFn
  ? async (req) => {
      lastShape = captureShape(req);
      return streamFn!(req);
    }
  : undefined;
```

3d. After `streamAssistantResponse` returns (inside the inner while loop, after `const message = yield* Effect.promise(...)` and after `step++` / `newMessages.push(message)`), emit the diagnostics:

```ts
// §10: emit cache-shape diagnostics for the just-completed turn.
if (lastShape) {
  const diagnostics = compareShape(prevShape, lastShape, message.usage);
  yield * emitEffect(emit, { type: "cache_shape", diagnostics });
  prevShape = lastShape;
}
```

3e. Pass `diagnosticStreamFn` to `streamAssistantResponse` instead of `streamFn`. Find every call to `streamAssistantResponse` inside `runLoopEffect` and change the last argument from `streamFn` to `diagnosticStreamFn`.

**Step 4: Run — verify it passes**

```bash
cd packages/agent && pnpm run typecheck && pnpm run test -- --run "emits a cache_shape event"
```

> If the `fakeStreamResult` helper doesn't carry usage into the `FinishResult`, extend it: add a `usage?` option to the `opts` parameter and use it in the `finish` object. The existing pattern creates `createUsage()` (all zeros); add `finish = { finishReason: ..., usage: opts.usage ?? createUsage() }`.

**Step 5: Commit**

```bash
git add packages/agent/src/types.ts \
        packages/agent/src/core/agent-loop.ts \
        packages/agent/src/core/__tests__/agent-loop.test.ts
git commit -m "feat(agent): emit cache_shape diagnostics event per turn (§10)

Wraps streamFn in runLoopEffect to capture a PrefixShape hash each turn,
then emits a cache_shape event with change reasons (system/tools) and
provider-reported cache hit/miss tokens. Pure addition — the harness
forwards it to subscribers automatically via emitAny."
```

---

### Task B3: Session-cumulative cache hit/miss counters in harness

**Files:**

- Modify: `packages/agent/src/agent/agent-harness.ts` — accumulate counters, expose getter
- Test: `packages/agent/src/agent/__tests__/agent-harness.test.ts` — append test

**Step 1: Write the failing test**

Append a test that runs a 2-prompt dialogue through the harness (using the faux provider) and verifies the cumulative counters:

```ts
it("tracks session-cumulative cache hit/miss counters across turns", async () => {
  const registration = registerFauxStreamProvider();
  // ... set 2 responses ...
  const harness = new AgentHarness({ ... });
  await harness.prompt("first");
  await harness.prompt("second");
  // The counters accumulate from usage.cacheRead/cacheWrite across both turns.
  // Faux provider usage may be zero — so verify the counters exist and are numbers.
  const counters = harness.getCacheCounters();
  expect(typeof counters.cacheHitTokens).toBe("number");
  expect(typeof counters.cacheMissTokens).toBe("number");
  expect(counters.turnCount).toBeGreaterThanOrEqual(2);
});
```

> The faux provider returns zero usage by default. To make this test meaningful, either (a) extend the faux provider to return non-zero cache usage, or (b) just verify the counters exist and accumulate turn counts. Option (b) is sufficient for proving the plumbing; real cache tokens come from production providers.

**Step 2: Run — verify it fails**

```bash
cd packages/agent && pnpm run test -- --run "session-cumulative cache"
```

**Step 3: Implement**

In `agent-harness.ts`, add fields + accumulation in `handleAgentEvent`:

3a. Add private fields (near the other private fields):

```ts
  private cacheHitTokens = 0;
  private cacheMissTokens = 0;
  private cacheShapeTurnCount = 0;
```

3b. Add a getter (near the other public getters like `getModel()`):

```ts
  /** Session-cumulative cache counters (§10). Survive compaction. */
  getCacheCounters(): {
    cacheHitTokens: number;
    cacheMissTokens: number;
    turnCount: number;
    hitRate: number;
  } {
    const total = this.cacheHitTokens + this.cacheMissTokens;
    return {
      cacheHitTokens: this.cacheHitTokens,
      cacheMissTokens: this.cacheMissTokens,
      turnCount: this.cacheShapeTurnCount,
      hitRate: total === 0 ? 0 : Math.floor((this.cacheHitTokens * 100) / total),
    };
  }
```

3c. In `handleAgentEvent`, add accumulation for `cache_shape` events (near the top, before the `message_end`/`turn_end`/`agent_end` special cases):

```ts
if (event.type === "cache_shape") {
  this.cacheHitTokens += event.diagnostics.cacheHitTokens;
  this.cacheMissTokens += event.diagnostics.cacheMissTokens;
  this.cacheShapeTurnCount++;
  await this.emitAny(event, signal);
  return;
}
```

**Step 4: Run — verify it passes**

```bash
cd packages/agent && pnpm run typecheck && pnpm run test -- --run "session-cumulative cache"
```

**Step 5: Commit**

```bash
git add packages/agent/src/agent/agent-harness.ts \
        packages/agent/src/agent/__tests__/agent-harness.test.ts
git commit -m "feat(agent): session-cumulative cache hit/miss counters (§10)"
```

---

### Task B4: Export cache-shape types + diagnostics from package index

**Files:**

- Modify: `packages/agent/src/index.ts` — export public types/helpers

**Step 1: Add exports**

In `packages/agent/src/index.ts`, add:

```ts
export type { CacheDiagnostics, PrefixShape } from "./core/cache-shape.ts";
export { captureShape, compareShape } from "./core/cache-shape.ts";
```

**Step 2: Run typecheck (server consumes agent exports)**

```bash
cd packages/agent && pnpm run typecheck
cd apps/server && pnpm run typecheck
```

**Step 3: Commit**

```bash
git add packages/agent/src/index.ts
git commit -m "feat(agent): export cache-shape diagnostics from package index (§10)"
```

---

## Change C: §5.1 — Pin small user turns through compaction

**Why:** Today, `prepareCompaction` summarizes ALL messages in the compaction range, including user turns. A user-stated fact or constraint early in a long session gets compressed into lossy summary prose and can drift. Reasonix keeps small user turns (<1500 tokens, <15% of window) verbatim — a fact stated once survives every compaction, anywhere in the session.

**What Reasonix does** (`compact.go:359-384`): `partitionFold` splits the compaction region into `kept` (small user turns + prior digests) and `fold` (everything else). `kept` is spliced back verbatim; only `fold` goes to the summarizer.

**Our approach:** Our session store is append-only — we can't splice messages back into the tree. Instead, pinned user turns are embedded verbatim (wrapped in markers) at the TOP of the compaction summary. The model sees them as inviolable context within the summary block. This preserves the user's exact words without session mutation.

### Task C1: `isPinnableUserTurn` predicate + partition

**Files:**

- Create: `packages/agent/src/compaction/pinned-turns.ts`
- Test: `packages/agent/src/compaction/__tests__/pinned-turns.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_PINNED_USER_TOKENS,
  isPinnableUserTurn,
  partitionPinnedTurns,
} from "../pinned-turns";
import type { AgentMessage } from "../../types";

function userMsg(text: string): AgentMessage {
  return {
    role: "user",
    content: [{ type: "text", text }],
    timestamp: 1,
  };
}

function asstMsg(text: string): AgentMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "openai",
    provider: "p",
    model: "m",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: 1,
  };
}

describe("isPinnableUserTurn", () => {
  it("returns true for a small user turn", () => {
    expect(isPinnableUserTurn(userMsg("remember: use pnpm"), { maxTokens: 1500 })).toBe(true);
  });

  it("returns false for a large user turn (over the token budget)", () => {
    const big = "x".repeat(1500 * 4 + 100); // > 1500 tokens at 4 chars/token
    expect(isPinnableUserTurn(userMsg(big), { maxTokens: 1500 })).toBe(false);
  });

  it("returns false for a non-user message", () => {
    expect(isPinnableUserTurn(asstMsg("assistant text"), { maxTokens: 1500 })).toBe(false);
  });
});

describe("partitionPinnedTurns", () => {
  it("separates small user turns into pinned, rest into foldable", () => {
    const messages: AgentMessage[] = [
      userMsg("use pnpm always"), // pinnable
      asstMsg("ok"), // foldable
      userMsg("now do X"), // pinnable
      asstMsg("doing X"), // foldable
    ];
    const { pinned, foldable } = partitionPinnedTurns(messages, { maxTokens: 1500 });
    expect(pinned).toHaveLength(2);
    expect(foldable).toHaveLength(2);
    expect(pinned[0]).toBe(messages[0]);
    expect(foldable[0]).toBe(messages[1]);
  });

  it("returns all-foldable when no user turns are small enough", () => {
    const big = "x".repeat(8000);
    const messages: AgentMessage[] = [userMsg(big), asstMsg("ok")];
    const { pinned, foldable } = partitionPinnedTurns(messages, { maxTokens: 1500 });
    expect(pinned).toHaveLength(0);
    expect(foldable).toHaveLength(2);
  });
});
```

**Step 2: Run — verify it fails**

```bash
cd packages/agent && pnpm run test -- --run pinned-turns
```

**Step 3: Implement**

Create `packages/agent/src/compaction/pinned-turns.ts`:

```ts
import { estimateTokens } from "./compaction";
import type { AgentMessage } from "../types";

/**
 * # Pinned user turns (§5.1)
 *
 * Small user turns in the compaction range are kept verbatim rather than
 * summarized — a user-stated fact or constraint survives every compaction
 * unchanged. Mirrors Reasonix's `pinnableUserTurn` + `partitionFold`
 * (compact.go:376-400).
 *
 * Token estimate uses the same chars/4 heuristic as {@link estimateTokens}.
 */

export const DEFAULT_MAX_PINNED_USER_TOKENS = 1500;

export interface PinnableOptions {
  /** Maximum token estimate for a user turn to be pinnable. Default 1500. */
  maxTokens?: number;
}

/** Whether a message is a small-enough user turn to pin through compaction. */
export function isPinnableUserTurn(message: AgentMessage, options: PinnableOptions = {}): boolean {
  if (message.role !== "user") {
    return false;
  }
  const maxTokens = options.maxTokens ?? DEFAULT_MAX_PINNED_USER_TOKENS;
  return estimateTokens(message) <= maxTokens;
}

/** Split messages into pinned (small user turns) and foldable (the rest). */
export function partitionPinnedTurns(
  messages: AgentMessage[],
  options: PinnableOptions = {},
): { pinned: AgentMessage[]; foldable: AgentMessage[] } {
  const pinned: AgentMessage[] = [];
  const foldable: AgentMessage[] = [];
  for (const message of messages) {
    if (isPinnableUserTurn(message, options)) {
      pinned.push(message);
    } else {
      foldable.push(message);
    }
  }
  return { pinned, foldable };
}

/**
 * Render pinned user turns into a verbatim marker block for embedding at the
 * top of a compaction summary. The model sees these as inviolable context.
 */
export function renderPinnedTurns(pinned: AgentMessage[]): string {
  if (pinned.length === 0) {
    return "";
  }
  const turns = pinned
    .map((m) => {
      const text =
        typeof (m as { content: unknown }).content === "string"
          ? (m as { content: string }).content
          : (m as { content: Array<{ type: string; text?: string }> }).content
              .filter((p) => p.type === "text" && typeof p.text === "string")
              .map((p) => p.text)
              .join("\n");
      return `<pinned-user-turn>\n${text}\n</pinned-user-turn>`;
    })
    .join("\n\n");
  return `<pinned-user-turns>\n${turns}\n</pinned-user-turns>`;
}
```

**Step 4: Run — verify it passes**

```bash
cd packages/agent && pnpm run typecheck && pnpm run test -- --run pinned-turns
```

**Step 5: Commit**

```bash
git add packages/agent/src/compaction/pinned-turns.ts \
        packages/agent/src/compaction/__tests__/pinned-turns.test.ts
git commit -m "feat(agent): isPinnableUserTurn + partitionPinnedTurns (§5.1)"
```

---

### Task C2: Integrate pinned turns into `prepareCompaction` + `compactEffect`

**Files:**

- Modify: `packages/agent/src/compaction/compaction.ts` — partition in `prepareCompaction`, embed in `compactEffect`
- Modify: `packages/agent/src/compaction/__tests__/compaction.test.ts` — add integration test
- Test: `packages/agent/src/compaction/__tests__/prune.test.ts` — update fixtures that assert `CompactionPreparation` shape (add `pinnedUserTurns: []`)

**Step 1: Write the failing test**

Append to `packages/agent/src/compaction/__tests__/compaction.test.ts`:

```ts
describe("prepareCompaction pinned user turns (§5.1)", () => {
  it("partitions small user turns out of messagesToSummarize into pinnedUserTurns", () => {
    const u1 = createMessageEntry(createUserMessage("always use pnpm"));
    const a1 = createMessageEntry(createAssistantMessage("ok"), u1.id);
    const u2 = createMessageEntry(
      createUserMessage("x".repeat(8000)), // large → foldable
      a1.id,
    );
    const a2 = createMessageEntry(createAssistantMessage("done"), u2.id);

    const preparation = getOrThrow(
      prepareCompaction([u1, a1, u2, a2], {
        ...DEFAULT_COMPACTION_SETTINGS,
        keepRecentTokens: 1,
      }),
    );
    expect(preparation).toBeDefined();
    // u1 ("always use pnpm") is small → pinned
    const pinned = preparation?.pinnedUserTurns ?? [];
    expect(pinned.length).toBe(1);
    const pinnedText = (pinned[0] as { content: Array<{ type: string; text?: string }> }).content[0]
      ?.text;
    expect(pinnedText).toBe("always use pnpm");
    // The pinned turn is NOT in messagesToSummarize (it's in pinnedUserTurns)
    const summarizeTexts = (preparation?.messagesToSummarize ?? [])
      .filter((m) => m.role === "user")
      .map((m) => (m as { content: Array<{ text?: string }> }).content[0]?.text);
    expect(summarizeTexts).not.toContain("always use pnpm");
  });
});
```

**Step 2: Run — verify it fails**

```bash
cd packages/agent && pnpm run test -- --run "pinned user turns"
```

Expected: FAIL — `pinnedUserTurns` does not exist on `CompactionPreparation`.

**Step 3: Implement**

3a. In `packages/agent/src/compaction/compaction.ts`, import the helpers:

```ts
import { partitionPinnedTurns, renderPinnedTurns } from "./pinned-turns";
```

3b. Add `pinnedUserTurns` to `CompactionPreparation`:

```ts
export interface CompactionPreparation {
  fileOps: FileOperations;
  firstKeptEntryId: string;
  isSplitTurn: boolean;
  messagesToSummarize: AgentMessage[];
  /** Small user turns kept verbatim through compaction (§5.1). */
  pinnedUserTurns: AgentMessage[];
  previousSummary?: string | undefined;
  pruneStats: PruneStats;
  settings: CompactionSettings;
  tokensBefore: number;
  turnPrefixMessages: AgentMessage[];
}
```

3c. In `prepareCompaction`, after the prune pass and BEFORE the return, partition the pruned messages:

```ts
// §5.1: pin small user turns out of the summarize range — a user-stated
// fact survives compaction verbatim rather than being summarized away.
const { pinned: pinnedUserTurns, foldable: foldableMessages } =
  partitionPinnedTurns(prunedSummarize);
```

3d. Change the return to use `foldableMessages` as `messagesToSummarize` and include `pinnedUserTurns`:

```ts
return ok({
  firstKeptEntryId,
  messagesToSummarize: foldableMessages,
  pinnedUserTurns,
  turnPrefixMessages,
  isSplitTurn: cutPoint.isSplitTurn,
  tokensBefore,
  previousSummary,
  fileOps,
  pruneStats,
  settings,
});
```

3e. In `compactEffect`, after the summary is generated, prepend the pinned turns. Find the line where `summary` is assigned (after the summarizer call(s)), and add BEFORE the file-ops formatting:

```ts
// §5.1: embed pinned user turns verbatim at the top of the summary.
if (preparation.pinnedUserTurns.length > 0) {
  const pinnedBlock = renderPinnedTurns(preparation.pinnedUserTurns);
  summary = `${pinnedBlock}\n\n${summary}`;
}
```

> The destructuring at the top of `compactEffect` also needs `pinnedUserTurns`:
>
> ```ts
> const { ..., pinnedUserTurns, ... } = preparation;
> ```
>
> Then reference `pinnedUserTurns` instead of `preparation.pinnedUserTurns` in the condition.

3f. Update existing test fixtures in `compaction.test.ts` that build `CompactionPreparation` objects inline — they now need `pinnedUserTurns: []`. Search for `const preparation: CompactionPreparation` and add the field:

```ts
pinnedUserTurns: [],
```

(Use the same replaceAll pattern as the Phase 1 pruneStats fix — the existing fixtures all have `pruneStats: { results: 0, savedChars: 0 },` so add `pinnedUserTurns: [],` right after it.)

**Step 4: Run — verify it passes**

```bash
cd packages/agent && pnpm run typecheck && pnpm run test -- --run "pinned user turns"
```

Then run the full suite to confirm no regressions:

```bash
cd packages/agent && pnpm run test
```

**Step 5: Commit**

```bash
git add packages/agent/src/compaction/compaction.ts \
        packages/agent/src/compaction/__tests__/compaction.test.ts
git commit -m "feat(agent): pin small user turns through compaction (§5.1)

prepareCompaction now partitions small user turns (<1500 tokens) out of
messagesToSummarize into pinnedUserTurns. compactEffect embeds them
verbatim (wrapped in <pinned-user-turns> markers) at the top of the
compaction summary. A user-stated fact or constraint survives every
compaction unchanged rather than being summarized into lossy prose."
```

---

## Execution order

```
A1 (tool sort)              — trivial freebie, ship first
B1 (cache-shape helpers)    — pure functions, no integration
B2 (emit cache_shape event) — wire into agent loop
B3 (cumulative counters)    — wire into harness
B4 (export from index)      — make available to server/UI
C1 (pinned-turn predicate)  — pure function
C2 (integrate into compaction) — the correctness fix
```

**Recommended commit sequence:** A1 → B1 → B2 → B3 → B4 → C1 → C2.

A and B and C are independent — they can be done in any order. But B should land before any future §6 reasoning-drop work (diagnostics are needed to measure the delta).

## Final verification

After all tasks:

```bash
pnpm run fix                              # format + lint
pnpm run typecheck                        # all packages
cd packages/agent && pnpm run test        # full agent suite
cd apps/server && pnpm run test           # full server suite (expect 2 pre-existing failures)
```

## Out-of-scope (explicitly deferred)

- **§6 reasoning_content drop** — deferred pending empirical Z.ai endpoint testing. The §10 diagnostics (this plan) are the prerequisite for measuring any §6 savings.
- **§5.2 prior-digest preservation** — our append-only architecture handles this differently (compaction entries excluded from messagesToSummarize, previousSummary passed to summarizer). Valid design, not a bug.
- **§5.3/§5.4 boundary alignment + tool pairing** — already correct by construction (`findValidCutPoints` excludes toolResult from cut points).
- **§5.5 keep policies (KeepErrors, KeepUserMarked)** — future enhancement.
- **§5.6 archiving** — N/A (append-only session store).
