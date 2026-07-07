# OM System-Prompt Injection — Mastra Alignment Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Stop mutating the base system prompt when observational-memory observations are injected. Align with Mastra's actual design: an immutable, separately-cached base system prompt + chunked observation content delivered as additional system content blocks, so the prefix cache survives observation cycles.

**Architecture:** Observations move out of the `systemPrompt` string (which becomes an immutable base) into a new `systemMessages: string[]` channel. The LLM stream layer combines the immutable base + observation chunks into Anthropic-style system content blocks — the base block is byte-identical across turns (automatic prefix cache hit + an explicit `cache_control` breakpoint), and only the changing observation chunks re-process. This matches Mastra's tagged-bucket + chunked-system-message design (`addSystem(msg, 'observational-memory')` + `buildContextSystemMessages` returning `string[]`) while fitting our `system`-param architecture. No `systemPrompt` string is mutated after the base is set.

**Tech Stack:** TypeScript, Effect, vitest, @ai-sdk, @sakti-code/llm.

**Root cause being fixed:** Our port copied Mastra's standalone `Memory.getContext()` pattern (`generateText({ system: systemMsg })`) into the agent loop, concatenating `${base}\n\n${observations}` into one mutable `system` string every turn. Mastra's own agent loop does NOT do this — it keeps base instructions in an untagged immutable bucket and injects observations as separate tagged system messages (`packages/memory/src/processors/observational-memory/processor.ts:65-99`). Every observation cycle currently invalidates the entire system-prompt prefix cache.

---

## Reference evidence (do not modify — read for context)

- Mastra injection: `openspec/references/mastra/packages/memory/src/processors/observational-memory/processor.ts:65-99` (`injectObservationContextMessages` → `messageList.addSystem(msg, 'observational-memory')`)
- Mastra chunking rationale: `openspec/references/mastra/packages/memory/src/processors/observational-memory/observational-memory.ts:2497-2499` — _"Each chunk is a separate system message for better LLM cache hit rates."_
- Mastra immutable base: `openspec/references/mastra/packages/core/src/agent/durable/preparation.ts:252-263` (instructions added once, untagged)
- Our broken injection: `packages/agent/src/core/agent-loop.ts:285-306, 420-446, 451-461, 550`

---

## Part 1: LLM layer — `StreamRequest` supports chunked system content blocks

The base system prompt becomes one cacheable content block; observation chunks become additional blocks appended after it. Anthropic caches at block granularity, so the immutable base block stays cached when only observation chunks change.

### Task 1.1: Add `systemMessages` field to `StreamRequest`

**Files:**

- Modify: `packages/llm/src/stream.ts:37-79` (the `StreamRequest` interface)

**Step 1: Write the failing test**

Create `packages/llm/src/__tests__/stream-system-messages.test.ts`:

```ts
import { describe, expect, it } from "vite-plus/test";
import type { StreamRequest } from "../stream";

describe("StreamRequest.systemMessages", () => {
  it("accepts an array of observation chunk strings alongside the base system", () => {
    const req: StreamRequest = {
      model: {
        id: "m",
        name: "m",
        api: "ai-sdk",
        provider: "openai",
        baseUrl: "",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 8192,
        maxTokens: 2048,
      },
      messages: [],
      system: "base instructions",
      systemMessages: ["observation chunk 1", "observation chunk 2"],
    };
    expect(req.systemMessages).toEqual(["observation chunk 1", "observation chunk 2"]);
    expect(req.system).toBe("base instructions");
  });
});
```

**Step 2: Run test to verify it fails**

```bash
vp run '@sakti-code/llm#test' -- stream-system-messages
```

Expected: FAIL — `Property 'systemMessages' does not exist on type 'StreamRequest'`.

**Step 3: Add the field**

In `packages/llm/src/stream.ts`, add to the `StreamRequest` interface (after `system?: string;` at line 64):

```ts
  /**
   * Additional system content blocks appended AFTER the base {@link system}
   * string. Each entry becomes its own system content block — used for
   * observational-memory observation chunks that must stay cache-independent
   * from the immutable base prompt. The base {@link system} block is
   * byte-identical across turns (prefix-cache stable); only these chunks
   * re-process when observations change.
   */
  systemMessages?: string[];
```

**Step 4: Run test to verify it passes**

```bash
vp run '@sakti-code/llm#test' -- stream-system-messages
```

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/llm/src/stream.ts packages/llm/src/__tests__/stream-system-messages.test.ts
git commit -m "feat(llm): add systemMessages field to StreamRequest for chunked system blocks"
```

---

### Task 1.2: Stream layer combines `system` + `systemMessages` into system content blocks

When `systemMessages` is present, build an array of system content blocks `[{text: base}, ...chunks]` and pass via the AI SDK `system` param (array form) instead of `instructions` (string). The base block gets a `cache_control` breakpoint so Anthropic pins it as a cached prefix.

**Files:**

- Modify: `packages/llm/src/stream.ts:262-277` (the `runner({...})` call)

**Step 1: Read the current call**

```
packages/llm/src/stream.ts:272 — ...(req.system ? { instructions: req.system } : {}),
```

Note: `instructions` is a single string. The AI SDK `streamText`/`generateText` also accepts a `system` param of type `string | Array<ContentPart>` which maps to Anthropic's multi-block system. We switch to `system` (array) when chunks are present.

**Step 2: Write the failing test**

Append to `packages/llm/src/__tests__/stream-system-messages.test.ts`:

```ts
import { stream } from "../stream";

describe("stream system block composition", () => {
  it("passes base + chunks as separate system content blocks via the system param", async () => {
    let capturedArgs: Record<string, unknown> = {};
    // Stub the runner by importing the module and spying — use the real
    // stream() with a mock language model registered via the provider registry.
    // Simpler: assert on the built args by calling stream() with a fake model
    // whose doStream captures the prompt.
    const fakeModel = {
      doStream: async (args: Record<string, unknown>) => {
        capturedArgs = args;
        return {
          stream: (async function* () {})(),
          usage: { input: 0, output: 0, totalTokens: 0 },
        };
      },
    };
    // ... (use the provider registration helper used elsewhere in llm tests)
    // The decisive assertion:
    // capturedArgs.prompt should be an array whose first element is
    // { role: 'system', content: [{ type: 'text', text: 'base', cache_control: ... }] }
    // and subsequent elements are the chunk blocks.
    expect(capturedArgs).toBeDefined();
  });
});
```

> **Note for implementer:** Model the stub on an existing llm-package test (look in `packages/llm/src/__tests__/` for the faux-provider pattern). The decisive assertion is that when `systemMessages: ["c1", "c2"]` is passed, the provider receives a `system` array of 3 blocks (base + c1 + c2) with `cache_control` on the base block — NOT a single `instructions` string.

**Step 3: Run test to verify it fails**

```bash
vp run '@sakti-code/llm#test' -- stream-system-messages
```

Expected: FAIL — currently the provider receives `instructions: "base"` (single string); no `system` array; no `cache_control`.

**Step 4: Implement the composition**

In `packages/llm/src/stream.ts`, replace line 272:

```ts
// Old:
...(req.system ? { instructions: req.system } : {}),
```

with:

```ts
...(buildSystemParam(req.system, req.systemMessages)),
```

and add a helper above the `stream` function:

```ts
/**
 * Build the AI SDK `system` param. When only the base string is present,
 * pass it as `instructions` (string — unchanged behavior). When observation
 * chunks are present, pass an array of system content blocks: the immutable
 * base block first (with an Anthropic `cache_control` breakpoint so the
 * prefix stays cached across turns), then one block per chunk. Anthropic
 * caches at block granularity, so the base block survives observation
 * changes while only the changing chunks re-process.
 */
function buildSystemParam(
  base: string | undefined,
  chunks: string[] | undefined,
): { system: unknown } | { instructions: string } | Record<string, never> {
  if (base === undefined && (chunks === undefined || chunks.length === 0)) {
    return {};
  }
  if (chunks === undefined || chunks.length === 0) {
    return { instructions: base };
  }
  const blocks: Array<Record<string, unknown>> = [];
  if (base !== undefined) {
    blocks.push({
      type: "text",
      text: base,
      providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
    });
  }
  for (const chunk of chunks) {
    blocks.push({ type: "text", text: chunk });
  }
  return { system: blocks };
}
```

**Step 5: Run test to verify it passes**

```bash
vp run '@sakti-code/llm#test' -- stream-system-messages
```

Expected: PASS — provider receives `system` as an array; base block has `cache_control`; chunks are separate blocks.

**Step 6: Run full llm test suite**

```bash
vp run '@sakti-code/llm#test'
```

Expected: PASS — no regressions (existing tests that pass only `system: string` still get `instructions`, unchanged).

**Step 7: Commit**

```bash
git add packages/llm/src/stream.ts packages/llm/src/__tests__/stream-system-messages.test.ts
git commit -m "feat(llm): compose base + systemMessages into cache-stable system content blocks

When systemMessages is present, pass an array of system content blocks via
the AI SDK system param (not instructions). The immutable base block gets a
cache_control breakpoint; observation chunks append as separate blocks.
Anthropic caches at block granularity, so the base survives observation
cycles while only changed chunks re-process."
```

---

## Part 2: Agent types — `AgentContext.systemMessages`

### Task 2.1: Add `systemMessages` to `AgentContext`

**Files:**

- Modify: `packages/agent/src/types.ts:238-242`
- Test: `packages/agent/src/__tests__/agent-context.test.ts` (new)

**Step 1: Write the failing test**

Create `packages/agent/src/__tests__/agent-context.test.ts`:

```ts
import { describe, expect, it } from "vite-plus/test";
import type { AgentContext } from "../types";

describe("AgentContext.systemMessages", () => {
  it("accepts an optional array of observation chunk strings separate from systemPrompt", () => {
    const ctx: AgentContext = {
      systemPrompt: "base",
      messages: [],
      systemMessages: ["obs chunk 1", "obs chunk 2"],
    };
    expect(ctx.systemMessages).toEqual(["obs chunk 1", "obs chunk 2"]);
    expect(ctx.systemPrompt).toBe("base");
  });

  it("systemMessages is optional (undefined when no observations)", () => {
    const ctx: AgentContext = { systemPrompt: "base", messages: [] };
    expect(ctx.systemMessages).toBeUndefined();
  });
});
```

**Step 2: Run test to verify it fails**

```bash
vp run '@sakti-code/agent#test' -- agent-context
```

Expected: FAIL — `Property 'systemMessages' does not exist on type 'AgentContext'`.

**Step 3: Add the field**

In `packages/agent/src/types.ts`, update the `AgentContext` interface (line 238-242):

```ts
export interface AgentContext {
  messages: AgentMessage[];
  systemPrompt: string;
  /**
   * Observation content blocks appended AFTER the immutable base
   * {@link systemPrompt} as separate system content blocks at stream time.
   * Set by observational-memory injection. NEVER mutate {@link systemPrompt}
   * to carry observations — that breaks the prefix cache. Each entry is one
   * cache-stable chunk (mirrors Mastra's chunked system messages).
   */
  systemMessages?: string[];
  tools?: AgentTool<any>[];
}
```

**Step 4: Run test to verify it passes**

```bash
vp run '@sakti-code/agent#test' -- agent-context
```

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/agent/src/types.ts packages/agent/src/__tests__/agent-context.test.ts
git commit -m "feat(agent): add systemMessages field to AgentContext for OM chunks"
```

---

## Part 3: Prompts — chunk the observation formatter

Mastra's `formatObservationsForContext` returns `string[]` (one chunk per cache-stable section). Our port returns a single concatenated string. Split it.

### Task 3.1: `formatObservationsForContext` returns `string[]`

**Files:**

- Modify: `packages/agent/src/observational-memory/prompts.ts:813-816`
- Test: `packages/agent/src/observational-memory/__tests__/prompts.test.ts` (append)

**Step 1: Read the current implementation**

```
packages/agent/src/observational-memory/prompts.ts:813-816 — formatObservationsForContext(activeObservations): string | undefined
```

Currently returns `${OBSERVATION_CONTEXT_PROMPT}\n\n<observations>\n${activeObservations}\n</observations>\n\n${OBSERVATION_CONTEXT_INSTRUCTIONS}` as ONE string.

**Step 2: Write the failing test**

Append to `packages/agent/src/observational-memory/__tests__/prompts.test.ts`:

```ts
import { formatObservationsForContext } from "../prompts";

describe("formatObservationsForContext chunked", () => {
  it("returns an array of cache-stable chunks, not a single string", () => {
    const result = formatObservationsForContext("* User likes TypeScript");
    expect(Array.isArray(result)).toBe(true);
    expect(result).toBeDefined();
    // Preamble chunk (context prompt + instructions), then the observations chunk.
    expect(result!.length).toBeGreaterThanOrEqual(2);
    // The observations themselves live in their own chunk.
    const obsChunk = result!.find((c) => c.includes("<observations>"));
    expect(obsChunk).toBeDefined();
    expect(obsChunk).toContain("* User likes TypeScript");
  });

  it("returns undefined when observations are empty", () => {
    expect(formatObservationsForContext("")).toBeUndefined();
    expect(formatObservationsForContext("   ")).toBeUndefined();
    expect(formatObservationsForContext(undefined as unknown as string)).toBeUndefined();
  });
});
```

**Step 3: Run test to verify it fails**

```bash
vp run '@sakti-code/agent#test' -- prompts.test
```

Expected: FAIL — currently returns a `string`, not an array; `Array.isArray(result)` is false.

**Step 4: Implement the chunked version**

In `packages/agent/src/observational-memory/prompts.ts`, replace `formatObservationsForContext` (line 813-816):

```ts
/**
 * Format active observations as an array of cache-stable system-message
 * chunks. Each entry becomes its own system content block at stream time,
 * so the preamble chunk stays cached while only the observations chunk
 * re-processes when observations change.
 *
 * Mirrors Mastra's `buildContextSystemMessages` (plural) which returns
 * `string[]` — "Each chunk is a separate system message for better LLM
 * cache hit rates."
 */
export function formatObservationsForContext(activeObservations: string): string[] | undefined {
  if (!activeObservations?.trim()) return undefined;
  return [
    `${OBSERVATION_CONTEXT_PROMPT}\n\n${OBSERVATION_CONTEXT_INSTRUCTIONS}`,
    `<observations>\n${activeObservations}\n</observations>`,
  ];
}
```

**Step 5: Run test to verify it passes**

```bash
vp run '@sakti-code/agent#test' -- prompts.test
```

Expected: PASS.

**Step 6: Run full agent test suite**

```bash
vp run '@sakti-code/agent#test'
```

Expected: Some tests may FAIL — `buildObservationsBlock` and `buildContextSystemMessage` still expect `string`. Those are fixed in Tasks 3.2 and 4.1. If failures block progress, stub the callers to join the array temporarily, then fix properly in the next tasks. Preferably: do Tasks 3.2 and 4.1 immediately after.

**Step 7: Commit**

```bash
git add packages/agent/src/observational-memory/prompts.ts packages/agent/src/observational-memory/__tests__/prompts.test.ts
git commit -m "refactor(agent): formatObservationsForContext returns chunked string[]

Splits the single concatenated string into cache-stable chunks: a preamble
chunk (prompt + instructions) and an observations chunk. Each becomes a
separate system content block at stream time, matching Mastra's chunked
design for better prefix-cache hit rates."
```

---

### Task 3.2: `buildObservationsBlock` returns `string[]`

**Files:**

- Modify: `packages/agent/src/observational-memory/prompts.ts:827-832`

**Step 1: Write the failing test**

Append to `packages/agent/src/observational-memory/__tests__/prompts.test.ts`:

```ts
import { buildObservationsBlock } from "../prompts";

describe("buildObservationsBlock chunked", () => {
  it("returns string[] from a record's active observations", () => {
    const result = buildObservationsBlock({ activeObservations: "* note" } as any);
    expect(Array.isArray(result)).toBe(true);
    expect(result!.length).toBeGreaterThanOrEqual(2);
  });

  it("returns undefined for null record or empty observations", () => {
    expect(buildObservationsBlock(null)).toBeUndefined();
    expect(buildObservationsBlock({ activeObservations: "" } as any)).toBeUndefined();
  });
});
```

**Step 2: Run test to verify it fails**

```bash
vp run '@sakti-code/agent#test' -- prompts.test
```

Expected: FAIL — currently returns `string | undefined`.

**Step 3: Implement**

In `packages/agent/src/observational-memory/prompts.ts`, replace `buildObservationsBlock` (line 827-832):

```ts
export function buildObservationsBlock(
  record: ObservationalMemoryRecord | null,
): string[] | undefined {
  if (!record) return undefined;
  return formatObservationsForContext(record.activeObservations);
}
```

**Step 4: Run test to verify it passes**

```bash
vp run '@sakti-code/agent#test' -- prompts.test
```

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/agent/src/observational-memory/prompts.ts packages/agent/src/observational-memory/__tests__/prompts.test.ts
git commit -m "refactor(agent): buildObservationsBlock returns string[]"
```

---

## Part 4: Engine — plural `buildContextSystemMessages`

### Task 4.1: Add `buildContextSystemMessages` (plural) to the engine

Keep the singular `buildContextSystemMessage` as a thin join-wrapper for backward compatibility (it's on the `AgentLoopConfig.observationalMemory.engine` interface and used by tests), but the production path uses the plural.

**Files:**

- Modify: `packages/agent/src/observational-memory/engine.ts:618-620`
- Test: `packages/agent/src/observational-memory/__tests__/engine.test.ts` (append)

**Step 1: Read the current method**

```
packages/agent/src/observational-memory/engine.ts:618-620 — buildContextSystemMessage(record): string | undefined
  → return formatObservationsForContext(record.activeObservations);
```

**Step 2: Write the failing test**

Append to `packages/agent/src/observational-memory/__tests__/engine.test.ts`:

```ts
describe("buildContextSystemMessages (plural)", () => {
  it("returns string[] of observation chunks", async () => {
    // Use the existing test-engine setup helper in this file.
    const engine = makeTestEngine({ activeObservations: "* User likes TS" });
    const record = await engine.getOrCreateRecord();
    const result = engine.buildContextSystemMessages(record);
    expect(Array.isArray(result)).toBe(true);
    expect(result!.length).toBeGreaterThanOrEqual(2);
  });

  it("returns undefined when no active observations", async () => {
    const engine = makeTestEngine({ activeObservations: "" });
    const record = await engine.getOrCreateRecord();
    expect(engine.buildContextSystemMessages(record)).toBeUndefined();
  });
});
```

> **Note for implementer:** Adapt `makeTestEngine` to the existing fixture pattern in `engine.test.ts`. If no such helper exists, construct the engine the way existing engine tests do.

**Step 3: Run test to verify it fails**

```bash
vp run '@sakti-code/agent#test' -- engine.test
```

Expected: FAIL — `buildContextSystemMessages is not a function`.

**Step 4: Implement the plural method**

In `packages/agent/src/observational-memory/engine.ts`, after `buildContextSystemMessage` (line 620), add:

```ts
/**
 * Plural form: returns the observation context as an array of cache-stable
 * system-message chunks (one per section). This is the production path —
 * each chunk becomes a separate system content block at stream time so the
 * preamble stays cached while only the observations chunk re-processes.
 *
 * Mirrors Mastra's `buildContextSystemMessages` (plural). See
 * `openspec/references/mastra/packages/memory/src/processors/observational-memory/observational-memory.ts:2502`.
 */
buildContextSystemMessages(record: ObservationalMemoryRecord): string[] | undefined {
  return formatObservationsForContext(record.activeObservations);
}
```

And update the singular to join (for backward-compat callers):

```ts
buildContextSystemMessage(record: ObservationalMemoryRecord): string | undefined {
  const chunks = this.buildContextSystemMessages(record);
  return chunks?.join("\n\n");
}
```

**Step 5: Run test to verify it passes**

```bash
vp run '@sakti-code/agent#test' -- engine.test
```

Expected: PASS.

**Step 6: Run full agent test suite**

```bash
vp run '@sakti-code/agent#test'
```

Expected: PASS (singular callers now join the array; behavior unchanged for them).

**Step 7: Commit**

```bash
git add packages/agent/src/observational-memory/engine.ts packages/agent/src/observational-memory/__tests__/engine.test.ts
git commit -m "feat(agent): add buildContextSystemMessages (plural) returning chunked string[]

Production path returns cache-stable chunks. The singular
buildContextSystemMessage remains as a backward-compat join wrapper."
```

---

## Part 5: agent-loop — inject into `systemMessages`, never mutate `systemPrompt`

This is the core fix. The three injection sites stop writing `${base}\n\n${obs}` into `currentContext.systemPrompt` and instead write observation chunks to `currentContext.systemMessages`. The base `systemPrompt` stays immutable.

### Task 5.1: Update the `AgentLoopConfig.observationalMemory` engine interface

**Files:**

- Modify: `packages/agent/src/types.ts:82-92`

**Step 1: Read the current interface**

```
packages/agent/src/types.ts:82-92 — observationalMemory.engine has buildContextSystemMessage(record): string | undefined
```

**Step 2: Write the failing test**

This is a type-level change; verify via the agent-loop test in Task 5.2. No standalone test needed — the interface update is exercised by the injection test.

**Step 3: Add the plural method to the interface**

In `packages/agent/src/types.ts`, update the `observationalMemory.engine` type (line 84-89):

```ts
        readonly engine: {
          getOrCreateRecord(): Promise<unknown>;
          maybeObserve(record: unknown): Promise<unknown>;
          maybeReflect(record: unknown): Promise<unknown>;
          buildContextSystemMessages(record: unknown): string[] | undefined;
        };
        readonly getBaseSystemPrompt: () => string;
```

(Remove `buildContextSystemMessage` from the interface — the loop now uses the plural. The concrete engine still has the singular for other callers, but the loop's contract is the plural.)

**Step 4: Run typecheck**

```bash
vp check
```

Expected: Type errors in `agent-loop.ts` and test mocks (`makeOwnOm` in `agent-loop-om-readonly.test.ts`) that reference `buildContextSystemMessage`. These are fixed in Tasks 5.2 and 5.4.

**Step 5: Commit (after 5.2/5.4 green)**

```bash
git add packages/agent/src/types.ts
git commit -m "refactor(agent): AgentLoopConfig.observationalMemory.engine uses plural buildContextSystemMessages"
```

---

### Task 5.2: Turn-boundary injection writes to `systemMessages` (not `systemPrompt`)

**Files:**

- Modify: `packages/agent/src/core/agent-loop.ts:420-446`
- Test: `packages/agent/src/core/__tests__/agent-loop.test.ts` (append)

**Step 1: Write the failing test**

Append to `packages/agent/src/core/__tests__/agent-loop.test.ts`:

```ts
describe("OM injection does not mutate systemPrompt", () => {
  it("keeps the base systemPrompt immutable and delivers observations via systemMessages", async () => {
    const BASE = "you are a coding agent";
    const OBS_CHUNKS = ["preamble chunk", "<observations>\n* note\n</observations>"];

    const captured: { system?: unknown; messages?: unknown[] } = {};
    const streamFn: StreamFn = (req) => {
      captured.system = req.system;
      captured.messages = req.messages;
      return Promise.resolve({
        fullStream: (async function* () {
          yield { type: "text-delta", id: "t1", text: "ok" };
        })(),
        result: Promise.resolve({ finishReason: "stop", usage: createUsage() }),
      });
    };

    const config: AgentLoopConfig = {
      model: createModel(),
      convertToLlm: identityConverter,
      observationalMemory: {
        engine: {
          getOrCreateRecord: async () => ({}),
          maybeObserve: async (r: unknown) => r,
          maybeReflect: async (r: unknown) => r,
          buildContextSystemMessages: () => OBS_CHUNKS,
        },
        getBaseSystemPrompt: () => BASE,
      },
      // ...streamFn wiring per existing tests
    };

    // Run one turn (use the existing agentLoop invocation pattern in this file).
    // ... invoke agentLoop ...

    // Decisive: base systemPrompt is byte-identical to BASE (never mutated).
    expect(captured.system).toBe(BASE);
    // Observations travel as separate system content blocks, NOT concatenated into system.
    expect(captured.system).not.toContain("observations");
  });
});
```

> **Note for implementer:** Fill in the `agentLoop` invocation + `streamFn` wiring by copying the pattern from the existing `agent-loop-om-readonly.test.ts:63-90`. The decisive assertions are the two `expect` lines at the end.

**Step 2: Run test to verify it fails**

```bash
vp run '@sakti-code/agent#test' -- agent-loop.test
```

Expected: FAIL — currently `captured.system` is `"you are a coding agent\n\npreamble chunk\n\n<observations>..."` (mutated); the `not.toContain("observations")` assertion fails.

**Step 3: Implement the fix**

In `packages/agent/src/core/agent-loop.ts`, replace the turn-boundary OM block (lines 420-446):

Old:

```ts
if (config.observationalMemory) {
  const omResult =
    yield *
    Effect.tryPromise({
      try: async () => {
        const om = config.observationalMemory!;
        const record = await om.engine.getOrCreateRecord();
        const observedRecord = await om.engine.maybeObserve(record);
        const reflectedRecord = await om.engine.maybeReflect(observedRecord);
        const observations = om.engine.buildContextSystemMessage(reflectedRecord);
        const base = om.getBaseSystemPrompt();
        return observations ? `${base}\n\n${observations}` : base;
      },
      catch: (error: unknown) => {
        config.logger?.error("observational memory turn hook failed", error, {
          sessionId: config.sessionId,
        });
        return undefined;
      },
    });
  if (omResult !== undefined) {
    currentContext = {
      ...currentContext,
      systemPrompt: omResult,
    };
  }
}
```

New:

```ts
// §OM: run observational-memory observe/reflect at turn boundary.
// Observations are delivered as separate system content blocks via
// systemMessages — the base systemPrompt stays IMMUTABLE so the
// prefix cache survives observation cycles. Mirrors Mastra's
// tagged-bucket design (base instructions untagged/immutable,
// observations as separate system messages).
if (config.observationalMemory) {
  const omChunks =
    yield *
    Effect.tryPromise({
      try: async () => {
        const om = config.observationalMemory!;
        const record = await om.engine.getOrCreateRecord();
        const observedRecord = await om.engine.maybeObserve(record);
        const reflectedRecord = await om.engine.maybeReflect(observedRecord);
        return om.engine.buildContextSystemMessages(reflectedRecord);
      },
      catch: (error: unknown) => {
        config.logger?.error("observational memory turn hook failed", error, {
          sessionId: config.sessionId,
        });
        return undefined;
      },
    });
  if (omChunks !== undefined) {
    currentContext = {
      ...currentContext,
      systemMessages: omChunks,
    };
  }
}
```

**Step 4: Run test to verify it passes**

```bash
vp run '@sakti-code/agent#test' -- agent-loop.test
```

Expected: PASS — `captured.system` is the immutable base; observations travel via `systemMessages`.

**Step 5: Commit**

```bash
git add packages/agent/src/core/agent-loop.ts packages/agent/src/core/__tests__/agent-loop.test.ts
git commit -m "fix(agent): inject OM observations via systemMessages, not systemPrompt

Turn-boundary injection no longer mutates the base systemPrompt string.
Observations travel as separate system content blocks (systemMessages),
keeping the base prompt byte-identical across turns so the prefix cache
survives observation cycles. Matches Mastra's tagged-bucket design."
```

---

### Task 5.3: Initial-turn injection writes to `systemMessages`

**Files:**

- Modify: `packages/agent/src/core/agent-loop.ts:285-306`

**Step 1: Write the failing test**

Append to `packages/agent/src/core/__tests__/agent-loop.test.ts`:

```ts
it("first-turn OM injection also uses systemMessages, not systemPrompt", async () => {
  // Same pattern as Task 5.2 but assert on the FIRST turn's captured stream
  // request — the base systemPrompt must be the original, and observations
  // must appear in systemMessages (delivered as system content blocks), not
  // concatenated into system.
  // ... invoke agentLoop with observationalMemory configured ...
  expect(captured.system).toBe(originalBaseSystemPrompt);
  expect(captured.system).not.toContain("observations");
});
```

**Step 2: Run test to verify it fails**

```bash
vp run '@sakti-code/agent#test' -- agent-loop.test
```

Expected: FAIL — first-turn injection still does `${base}\n\n${observations}`.

**Step 3: Implement the fix**

In `packages/agent/src/core/agent-loop.ts`, replace the initial-turn OM block (lines 285-306):

Old:

```ts
if (config.observationalMemory) {
  const omInitial =
    yield *
    Effect.tryPromise({
      try: async () => {
        const om = config.observationalMemory!;
        const record = await om.engine.getOrCreateRecord();
        const observations = om.engine.buildContextSystemMessage(record);
        return observations ? `${om.getBaseSystemPrompt()}\n\n${observations}` : undefined;
      },
      catch: (error: unknown) => {
        config.logger?.error("om initial inject failed", error, {
          sessionId: config.sessionId,
        });
        return undefined;
      },
    });
  if (omInitial !== undefined) {
    currentContext = { ...currentContext, systemPrompt: omInitial };
  }
}
```

New:

```ts
if (config.observationalMemory) {
  const omInitialChunks =
    yield *
    Effect.tryPromise({
      try: async () => {
        const om = config.observationalMemory!;
        const record = await om.engine.getOrCreateRecord();
        return om.engine.buildContextSystemMessages(record);
      },
      catch: (error: unknown) => {
        config.logger?.error("om initial inject failed", error, {
          sessionId: config.sessionId,
        });
        return undefined;
      },
    });
  if (omInitialChunks !== undefined) {
    currentContext = { ...currentContext, systemMessages: omInitialChunks };
  }
}
```

**Step 4: Run test to verify it passes**

```bash
vp run '@sakti-code/agent#test' -- agent-loop.test
```

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/agent/src/core/agent-loop.ts packages/agent/src/core/__tests__/agent-loop.test.ts
git commit -m "fix(agent): first-turn OM injection uses systemMessages, not systemPrompt"
```

---

### Task 5.4: Read-only OM injection writes to `systemMessages`

**Files:**

- Modify: `packages/agent/src/core/agent-loop.ts:451-461`
- Modify: `packages/agent/src/types.ts:101-105` (`observationalMemoryReadOnly` interface)
- Test: `packages/agent/src/core/__tests__/agent-loop-om-readonly.test.ts` (update)

**Step 1: Read the current code**

```
packages/agent/src/core/agent-loop.ts:451-461 — appends getObservationsBlock() to systemPrompt
packages/agent/src/types.ts:101-105 — observationalMemoryReadOnly.getObservationsBlock(): Promise<string | undefined>
```

**Step 2: Write the failing test**

Update `packages/agent/src/core/__tests__/agent-loop-om-readonly.test.ts` — change the existing test's assertion from "system contains the block" to "systemMessages contains the block, systemPrompt is unchanged":

```ts
it("delivers read-only observations via systemMessages, keeping systemPrompt immutable", async () => {
  const context: AgentContext = {
    systemPrompt: "You are helpful.",
    messages: [],
    tools: [],
  };
  // ... existing setup ...
  let capturedSystem: string | undefined;
  let capturedMessages: unknown[];
  const streamFn: StreamFn = (req) => {
    capturedSystem = req.system as string | undefined;
    capturedMessages = req.messages;
    // ... existing stream stub ...
  };
  const config: AgentLoopConfig = {
    model: createModel(),
    convertToLlm: identityConverter,
    observationalMemoryReadOnly: {
      getObservationsBlocks: async () => [OBS_BLOCK], // plural
    },
  };
  // ... invoke ...
  expect(capturedSystem).toBe("You are helpful."); // immutable
  expect(capturedSystem).not.toContain("observations");
  // The block travels as a system content block in the messages array.
});
```

> **Note for implementer:** The read-only block is a single string today. Change the interface to `getObservationsBlocks: () => Promise<string[] | undefined>` (plural) and wrap the existing single-string return in an array at the runner call site (Task 6.2).

**Step 3: Run test to verify it fails**

```bash
vp run '@sakti-code/agent#test' -- agent-loop-om-readonly
```

Expected: FAIL — currently `capturedSystem` contains the observations block.

**Step 4: Update the interface**

In `packages/agent/src/types.ts`, update `observationalMemoryReadOnly` (line 101-105):

```ts
  observationalMemoryReadOnly?:
    | {
        readonly getObservationsBlocks: () => Promise<string[] | undefined>;
      }
    | undefined;
```

**Step 5: Implement the fix**

In `packages/agent/src/core/agent-loop.ts`, replace the read-only OM block (lines 451-461):

Old:

```ts
if (config.observationalMemoryReadOnly) {
  const omReadOnlyResult =
    yield *
    Effect.tryPromise({
      try: () => config.observationalMemoryReadOnly!.getObservationsBlock(),
      catch: () => undefined,
    });
  if (omReadOnlyResult !== undefined) {
    currentContext = {
      ...currentContext,
      systemPrompt: `${currentContext.systemPrompt ?? ""}\n\n${omReadOnlyResult}`,
    };
  }
}
```

New:

```ts
if (config.observationalMemoryReadOnly) {
  const omReadOnlyBlocks =
    yield *
    Effect.tryPromise({
      try: () => config.observationalMemoryReadOnly!.getObservationsBlocks(),
      catch: () => undefined,
    });
  if (omReadOnlyBlocks !== undefined && omReadOnlyBlocks.length > 0) {
    currentContext = {
      ...currentContext,
      systemMessages: [...(currentContext.systemMessages ?? []), ...omReadOnlyBlocks],
    };
  }
}
```

**Step 6: Run test to verify it passes**

```bash
vp run '@sakti-code/agent#test' -- agent-loop-om-readonly
```

Expected: PASS.

**Step 7: Commit**

```bash
git add packages/agent/src/core/agent-loop.ts packages/agent/src/types.ts packages/agent/src/core/__tests__/agent-loop-om-readonly.test.ts
git commit -m "fix(agent): read-only OM injection uses systemMessages, not systemPrompt

Read-only observations no longer mutate the base systemPrompt. They append
to systemMessages as separate content blocks. Interface renamed
getObservationsBlock → getObservationsBlocks (plural, string[])."
```

---

### Task 5.5: Stream call passes `systemMessages` to the stream function

**Files:**

- Modify: `packages/agent/src/core/agent-loop.ts:545-562` (the `streamFunction({...})` call)

**Step 1: Write the failing test**

The test from Task 5.2 already asserts `captured.system` is the immutable base and observations are NOT in it. Extend it to also assert the stream request carries `systemMessages`:

```ts
// In the Task 5.2 test, add:
let capturedSystemMessages: string[] | undefined;
const streamFn: StreamFn = (req) => {
  capturedSystem = req.system as string | undefined;
  capturedSystemMessages = req.systemMessages as string[] | undefined;
  // ...
};
// ... invoke ...
expect(capturedSystemMessages).toEqual(OBS_CHUNKS);
```

**Step 2: Run test to verify it fails**

```bash
vp run '@sakti-code/agent#test' -- agent-loop.test
```

Expected: FAIL — `req.systemMessages` is undefined (the stream call doesn't pass it yet).

**Step 3: Implement**

In `packages/agent/src/core/agent-loop.ts`, in the `streamFunction({...})` call (around line 547-561), add after the `system` line (550):

```ts
      streamFunction({
        model: config.model,
        messages: llmMessages,
        ...(context.systemPrompt ? { system: context.systemPrompt } : {}),
        ...(context.systemMessages && context.systemMessages.length > 0
          ? { systemMessages: context.systemMessages }
          : {}),
        // ... remaining existing fields ...
      }),
```

**Step 4: Run test to verify it passes**

```bash
vp run '@sakti-code/agent#test' -- agent-loop.test
```

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/agent/src/core/agent-loop.ts packages/agent/src/core/__tests__/agent-loop.test.ts
git commit -m "feat(agent): pass systemMessages to the stream function"
```

---

## Part 6: Wire the runner + agent-run config

### Task 6.1: `agent-run.ts` exposes the plural engine method + read-only blocks

**Files:**

- Modify: `packages/agent/src/runner/agent-run.ts` (the `observationalMemory` config construction)
- Modify: `apps/server/src/agent/runner.ts:474-477` (the `getObservationsBlock` → `getObservationsBlocks` rename)

**Step 1: Read the current wiring**

```
packages/agent/src/runner/agent-run.ts — constructs the observationalMemory config passed to AgentLoopConfig
apps/server/src/agent/runner.ts:474-477 — getObservationsBlock: async () => { ... }
```

**Step 2: Write the failing test**

```bash
vp run '@sakti-code/server#test' -- runner
```

Run existing runner tests — they'll fail after the interface rename (`getObservationsBlock` → `getObservationsBlocks`, `buildContextSystemMessage` → `buildContextSystemMessages`).

**Step 3: Update agent-run.ts**

In `packages/agent/src/runner/agent-run.ts`, wherever the `observationalMemory` config object is built, ensure the engine exposes `buildContextSystemMessages` (the concrete `ObservationalMemoryEngine` already has it from Task 4.1). If the config narrows the engine type, update the narrowing to include the plural method. Remove any reference to `buildContextSystemMessage` in the config construction (the loop no longer calls it).

**Step 4: Update runner.ts read-only block**

In `apps/server/src/agent/runner.ts`, rename `getObservationsBlock` → `getObservationsBlocks` (line 474-477) and return an array:

```ts
const omReadOnly = {
  getObservationsBlocks: async () => {
    const block = await buildObservationsBlock(record); // now returns string[] | undefined
    return block;
  },
};
```

(`buildObservationsBlock` from Task 3.2 already returns `string[] | undefined`.)

**Step 5: Run tests**

```bash
vp run '@sakti-code/agent#test' -- agent-run
vp run '@sakti-code/server#test' -- runner
```

Expected: PASS.

**Step 6: Commit**

```bash
git add packages/agent/src/runner/agent-run.ts apps/server/src/agent/runner.ts
git commit -m "fix(server): wire plural OM engine method + read-only blocks

agent-run exposes buildContextSystemMessages; runner's read-only OM
returns string[] via getObservationsBlocks. Aligns the config with the
new systemMessages injection path."
```

---

## Part 7: Update existing tests + full verification

### Task 7.1: Fix the loop-integration test

**Files:**

- Modify: `packages/agent/src/observational-memory/__tests__/loop-integration.test.ts`

**Step 1:** Read the file. It mocks `buildContextSystemMessage` and asserts on `req.system` containing observations.

**Step 2:** Update mocks to `buildContextSystemMessages` returning `string[]`. Update assertions: `req.system` is the immutable base; observations appear via `req.systemMessages` (or the composed system content blocks).

**Step 3:** Run:

```bash
vp run '@sakti-code/agent#test' -- loop-integration
```

Expected: PASS.

**Step 4: Commit**

```bash
git add packages/agent/src/observational-memory/__tests__/loop-integration.test.ts
git commit -m "test(agent): update loop-integration for systemMessages injection"
```

---

### Task 7.2: Fix the `makeOwnOm` mock in agent-loop-om-readonly.test.ts

**Files:**

- Modify: `packages/agent/src/core/__tests__/agent-loop-om-readonly.test.ts:51-61`

**Step 1:** The `makeOwnOm` mock (line 57) has `buildContextSystemMessage: () => OWN_BLOCK`. Update to `buildContextSystemMessages: () => [OWN_BLOCK]` (or chunked). Update assertions throughout the file: `req.system` is the immutable `OWN_BASE`; `OWN_BLOCK` travels via `req.systemMessages`.

**Step 2:** Run:

```bash
vp run '@sakti-code/agent#test' -- agent-loop-om-readonly
```

Expected: PASS.

**Step 3: Commit**

```bash
git add packages/agent/src/core/__tests__/agent-loop-om-readonly.test.ts
git commit -m "test(agent): update makeOwnOm mock + assertions for systemMessages"
```

---

### Task 7.3: Run the full workspace test suite + check

**Step 1: Run all tests**

```bash
vp run -r test
```

Expected: ALL PASS (the only pre-existing failure is `workspace-build.test.ts` — missing `packages/llm/dist/index.mjs`, unrelated; rebuild with `vp run -r build` if it blocks).

**Step 2: Run full check**

```bash
vp check --fix
```

Expected: 0 warnings, 0 errors.

**Step 3: Verify no stale references**

```bash
grep -rn "buildContextSystemMessage\b" packages/agent/src apps/server/src --include="*.ts" | grep -v "__tests__\|\.test\."
```

Expected: only the backward-compat join-wrapper in `engine.ts` (which delegates to the plural). No production code calls the singular.

```bash
grep -rn 'systemPrompt:.*\${.*observations\|`${base}.*observations`' packages/agent/src --include="*.ts"
```

Expected: no matches — no code mutates systemPrompt with observations.

---

## Verification Checklist

After all tasks complete:

- [ ] `AgentContext.systemPrompt` is NEVER mutated by OM injection (immutable base)
- [ ] Observations travel via `AgentContext.systemMessages: string[]`
- [ ] `formatObservationsForContext` returns `string[]` (chunked)
- [ ] `buildContextSystemMessages` (plural) is the production path
- [ ] `buildContextSystemMessage` (singular) is a backward-compat join wrapper only
- [ ] Stream layer composes `[base block (cache_control), ...chunk blocks]` when `systemMessages` present
- [ ] When no observations, stream uses `instructions: base` (unchanged behavior)
- [ ] All three injection sites (initial, turn-boundary, read-only) write to `systemMessages`
- [ ] `observationalMemoryReadOnly` uses `getObservationsBlocks` (plural, `string[]`)
- [ ] Existing tests updated; no test asserts observations in `req.system`
- [ ] `vp run -r test` passes
- [ ] `vp check` clean (0 warnings, 0 errors)

---

## Cache Stability Analysis (post-fix)

### Within a phase (observations accumulate)

```
Turn 1: system=[base(cached)] + messages=[user1, skill, resp1, ...]
Turn 2: system=[base(cached HIT)] + messages=[..., user2, resp2]
        ↑ base block byte-identical → Anthropic block cache HIT
Observe fires → observations grow:
Turn 3: system=[base(cached HIT), obs-chunk-v2]
        ↑ base still HIT; only obs-chunk re-processes
```

The base system block never changes → always a cache hit. Only the observation chunk block re-processes when observations change. Compare to the current broken behavior where the ENTIRE system string changes → full system cache miss every observation cycle.

### Why this matches Mastra

Mastra keeps base instructions in an untagged immutable `MessageList.systemMessages` bucket and observations in `taggedSystemMessages['observational-memory']`, concatenated only at prompt-build time. Our `systemPrompt` (immutable base) + `systemMessages` (observation chunks) maps directly: two separate buckets, base never touched by OM.

---

## Notes for the Implementer

- **TDD is mandatory.** Every task follows RED → GREEN → COMMIT.
- **`exactOptionalPropertyTypes: true`** — use conditional spread `...(x !== undefined ? { x } : {})` for optional fields; never pass `undefined`.
- **The AI SDK `system` param accepts `string | Array<ContentPart>`.** Our `runner` currently uses `instructions` (string only). Task 1.2 switches to `system` (array) when chunks are present. Verify the AI SDK version in `packages/llm` supports the array form — if not, upgrade or use `providerOptions` to pass Anthropic system blocks.
- **Anthropic `cache_control` breakpoint budget is 4.** The base block uses one. Tools use another. The existing `CacheControlValidator` (`packages/llm/src/provider/zai-anthropic/get-cache-control.ts`) enforces the budget — the base-block breakpoint must be registered through it, not hardcoded.
- **The singular `buildContextSystemMessage` stays** as a public method on the engine (other callers may exist) but the agent loop's contract is the plural. Do not delete the singular.
- **Test stubs for `StreamFn`** capture `req.system` and `req.systemMessages` — model them on `agent-loop-om-readonly.test.ts:74-82`.
