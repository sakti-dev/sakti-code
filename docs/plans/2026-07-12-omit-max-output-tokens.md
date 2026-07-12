# Omit `maxOutputTokens` from the Agent Loop Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Stop sending `maxOutputTokens = model.maxTokens` on every agent-loop LLM call; omit it so each provider applies its own sane default (z.ai → 4096), matching the proven mastracode design.

**Architecture:** A single line — `packages/agent/src/core/agent-loop.ts:580` — sets `maxOutputTokens: config.model.maxTokens` (the model's _capability ceiling_) on every request. For glm-5-turbo (`contextWindow: 200000`, `maxTokens: 131072`), this reserves 131072 tokens for output, leaving only ~67k for input. Once a session crosses ~67k tokens, every request fails deterministically with `finish: "length"`, 0 tokens (`input + reserved_output > contextWindow`). Removing the line lets `StreamRequest.maxOutputTokens` stay `undefined`; `stream.ts:271` omits the field; the z.ai wrapper's `maxOutputTokens ?? 4096` default applies (`zai-language-model.ts:231`), freeing ~196k of the 200k window for input. This is exactly what mastracode does — it never sets `maxOutputTokens` anywhere.

**Tech Stack:** TypeScript, Effect (agent loop), vitest (`vite-plus/test`), pnpm workspace. Tests run via `vp test run <file>`; lint/typecheck via `vp check`.

---

## Background — the bug chain (evidence)

| Layer          | File:Line                                                               | Code                                                                       | Effect                                                   |
| -------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------- |
| **Bug site**   | `packages/agent/src/core/agent-loop.ts:580`                             | `maxOutputTokens: config.model.maxTokens,`                                 | sends 131072                                             |
| Stream forward | `packages/llm/src/stream.ts:271`                                        | `...(req.maxOutputTokens ? { maxOutputTokens: req.maxOutputTokens } : {})` | forwards 131072 (truthy)                                 |
| z.ai default   | `packages/llm/src/provider/zai-anthropic/zai-language-model.ts:231`     | `maxOutputTokens: maxOutputTokens ?? 4096`                                 | 131072 is truthy → stays 131072 (default never triggers) |
| z.ai cap       | `packages/llm/src/provider/zai-anthropic/zai-language-model.ts:402-407` | `min(maxOutputTokens, maxTokens − 4000)` → `min(131072, 127072)`           | **127072** — still huge                                  |
| Catalog source | `packages/llm/src/catalog/convert.ts:71`                                | `maxTokens: model.limit?.output ?? 4096`                                   | 131072 = glm-5-turbo `limit.output`                      |

Net: only ~73k of the 200k window remains for input. Session `dece9647` (95 messages, ~154k tokens) is 2× over → deterministic `finish: "length"`.

### What mastracode does (the reference)

Mastracode (`sdk/src/index.ts:561`) sets only `modelSettings: { temperature: 1 }` — **`maxOutputTokens` is never set at any layer** (not in agent config, not in the gateway, not in any provider constructor). The provider/AI-SDK default (~4096) applies silently. Its model object (`GatewayLanguageModel`) doesn't even carry a `maxTokens` field, so the bug is structurally impossible there. Confirmed by subagent investigation of `.sakti/references/mastra/mastracode`.

### In-repo precedent

`packages/agent/src/session/branch-summarization.ts:256` already does the right thing for auxiliary LLM calls:

```ts
maxOutputTokens: Math.min(model.maxTokens, 4096),
```

Only the **main** agent loop fails to cap. This plan fixes that single site by omission (cleaner than a cap — no magic number, defers to each provider's tuned default).

### Why 4096 is enough for an agent loop

- Tool-call turns produce minimal text + structured tool calls (well under 4k).
- File content goes through `write`/`edit` tools, not raw LLM output.
- Mastracode runs a full coding agent on the provider default.

### Recovery for the stuck session

With the fix, session `dece9647` (154k input) sends `max_tokens: 4096` → `154k + 4k = 158k < 200k` → **recovers on the next run, no compaction needed**.

---

## Files

- **Modify (bug site):** `packages/agent/src/core/agent-loop.ts:580` — delete the line.
- **Modify (test):** `packages/agent/src/core/__tests__/agent-loop.test.ts:1981-2009` — flip the test from "passes maxTokens" to "omits maxOutputTokens".
- **Read-only references (do NOT change):**
  - `packages/llm/src/stream.ts:48,271` — `maxOutputTokens?` is optional; conditionally spread (handles omission cleanly).
  - `packages/llm/src/provider/zai-anthropic/zai-language-model.ts:231` — `?? 4096` default that takes effect once we omit.
  - `packages/agent/src/agent/agent-harness.ts:620` — a debug log field (`maxTokens: req.maxOutputTokens`); after the fix it logs `undefined` (structured loggers omit the key). **Leave as-is** — per AGENTS.md, logs are permanent; `undefined` accurately reflects "no explicit cap".
  - `packages/agent/src/session/branch-summarization.ts:256` — already correct; no change.

---

## Task 1: Flip the test to assert omission (RED)

**Files:**

- Modify test: `packages/agent/src/core/__tests__/agent-loop.test.ts:1981-2009`

**Step 1: Replace the test**

Replace the `describe` block at line 1981:

```ts
describe("agentLoop maxOutputTokens", () => {
  it("passes model.maxTokens as maxOutputTokens to the stream function", async () => {
    const context: AgentContext = {
      systemPrompt: "You are helpful.",
      messages: [],
      tools: [],
    };

    const model = createModel();
    model.maxTokens = 8192;

    const config: AgentLoopConfig = {
      model,
      convertToLlm: identityConverter,
    };

    let capturedReq: StreamRequest | undefined;
    const { fn: streamFn } = makeStreamFnWithReq((req) => {
      capturedReq = req;
      return { content: [{ type: "text", text: "ok" }] };
    });

    const stream = agentLoop([createUserMessage("Hello")], context, config, undefined, streamFn);
    for await (const _ of stream) {
      // drain
    }

    expect(capturedReq?.maxOutputTokens).toBe(8192);
  });
```

with:

```ts
describe("agentLoop maxOutputTokens", () => {
  // The loop must NOT send `maxOutputTokens = model.maxTokens`. That reserves the
  // model's full output ceiling (e.g. 131072 for glm-5-turbo) on every request,
  // leaving only `contextWindow − maxTokens` (~67k of 200k) for input. Once a
  // session crosses that, every request fails deterministically with
  // `finish: "length"`, 0 tokens (input + reserved_output > contextWindow).
  //
  // Omitting maxOutputTokens lets each provider apply its own sane default
  // (z.ai wrapper: `?? 4096`), matching the mastracode design (which never sets
  // maxOutputTokens anywhere). See docs/plans/2026-07-12-omit-max-output-tokens.md.
  it("omits maxOutputTokens so the provider default applies", async () => {
    const context: AgentContext = {
      systemPrompt: "You are helpful.",
      messages: [],
      tools: [],
    };

    const model = createModel();
    model.maxTokens = 8192; // would previously have been sent verbatim

    const config: AgentLoopConfig = {
      model,
      convertToLlm: identityConverter,
    };

    let capturedReq: StreamRequest | undefined;
    const { fn: streamFn } = makeStreamFnWithReq((req) => {
      capturedReq = req;
      return { content: [{ type: "text", text: "ok" }] };
    });

    const stream = agentLoop([createUserMessage("Hello")], context, config, undefined, streamFn);
    for await (const _ of stream) {
      // drain
    }

    expect(capturedReq?.maxOutputTokens).toBeUndefined();
  });
```

**Step 2: Run the test — verify it FAILS**

```
vp test run packages/agent/src/core/__tests__/agent-loop.test.ts -t "omits maxOutputTokens"
```

Expected: **FAIL** —

```
AssertionError: expected 8192 to be undefined
  Expected: undefined
  Received: 8192
```

This confirms the test now exercises the buggy line (it currently sends `model.maxTokens`). If it errors (not fails), fix the error and re-run until it fails with the assertion above.

---

## Task 2: Remove the buggy line (GREEN)

**Files:**

- Modify: `packages/agent/src/core/agent-loop.ts:575-582`

**Step 1: Delete the `maxOutputTokens` line**

In `packages/agent/src/core/agent-loop.ts`, the stream call (around line 568-583) currently reads:

```ts
      streamFunction({
        model: config.model,
        messages: llmMessages,
        ...(context.systemPrompt ? { system: context.systemPrompt } : {}),
        ...(context.tools && context.tools.length > 0
          ? { tools: toStreamTools(context.tools) }
          : {}),
        ...(forbidTools ? { toolChoice: "none" as const } : {}),
        ...(config.reasoning === undefined ? {} : { thinkingLevel: config.reasoning }),
        ...(resolvedApiKey === undefined ? {} : { apiKey: resolvedApiKey }),
        ...(config.headers ? { headers: config.headers } : {}),
        ...(config.sessionId ? { sessionId: config.sessionId } : {}),
        maxOutputTokens: config.model.maxTokens,
        ...(signal ? { abortSignal: signal } : {}),
      }),
```

Remove **only** the `maxOutputTokens: config.model.maxTokens,` line:

```ts
      streamFunction({
        model: config.model,
        messages: llmMessages,
        ...(context.systemPrompt ? { system: context.systemPrompt } : {}),
        ...(context.tools && context.tools.length > 0
          ? { tools: toStreamTools(context.tools) }
          : {}),
        ...(forbidTools ? { toolChoice: "none" as const } : {}),
        ...(config.reasoning === undefined ? {} : { thinkingLevel: config.reasoning }),
        ...(resolvedApiKey === undefined ? {} : { apiKey: resolvedApiKey }),
        ...(config.headers ? { headers: config.headers } : {}),
        ...(config.sessionId ? { sessionId: config.sessionId } : {}),
        ...(signal ? { abortSignal: signal } : {}),
      }),
```

**Step 2: Run the test — verify it PASSES**

```
vp test run packages/agent/src/core/__tests__/agent-loop.test.ts -t "omits maxOutputTokens"
```

Expected: **PASS** (1 passed).

**Step 3: Run the full agent-loop test file — verify no regressions**

```
vp test run packages/agent/src/core/__tests__/agent-loop.test.ts
```

Expected: all tests pass (the only `maxOutputTokens` assertion was the one flipped in Task 1).

---

## Task 3: Full verification

**Step 1: Agent package suite**

```
vp run '@sakti-code/agent#test'
```

Expected: all pass. Watch especially for anything in `agent-harness` or `branch-summarization` tests (the harness log field change is benign; `branch-summarization` is untouched).

**Step 2: LLM package suite (the z.ai wrapper default + cap)**

```
vp run '@sakti-code/llm#test'
```

Expected: all pass. The z.ai wrapper's `?? 4096` default and cap (`min(maxOutputTokens, maxTokens − 4000)`) are exercised with their own explicit inputs; omission in the agent loop does not change their behavior.

**Step 3: Server suite**

```
vp run '@sakti-code/server#test'
```

Expected: all pass except possibly `terminal.test.ts` (environmental — `node-pty` returns 503 outside `nix develop`; **pre-existing, unrelated**). If `ws-welcome.test.ts` times out, re-run alone (parallel-load flakiness, also pre-existing).

**Step 4: Lint + typecheck + format**

```
vp check
```

Expected: clean — "Found no warnings, lint errors, or type errors".

If formatting drift is reported: `vp check --fix`, then re-run `vp check`.

---

## Task 4: Commit

**Step 1: Stage the two files (only these)**

```
git add packages/agent/src/core/agent-loop.ts packages/agent/src/core/__tests__/agent-loop.test.ts
```

**Step 2: Verify the staged diff is exactly two files (no stray changes)**

```
git status --short
git diff --cached --stat
```

Expected: only `agent-loop.ts` (−1 line) and `agent-loop.test.ts` (test rewrite).

**Step 3: Commit**

```
git commit -m "fix(agent): omit maxOutputTokens so the provider default applies

The agent loop sent maxOutputTokens = model.maxTokens on every request —
the model's full output-ceiling capability (131072 for glm-5-turbo). That
reserved 2/3 of the 200k context window for output, leaving only ~67k for
input. Sessions crossing ~67k tokens failed deterministically with
finish: 'length', 0 tokens (input + reserved_output > contextWindow).

Omit maxOutputTokens instead, letting each provider apply its own default
(z.ai wrapper: ?? 4096), matching the mastracode design which never sets
maxOutputTokens at any layer. Frees ~196k of the window for input; the
stuck session (154k) recovers without compaction."
```

---

## Out of scope (do NOT do in this plan)

1. **Do not** add a dynamic `contextWindow − input` budget. Mastracode proves omission suffices; dynamic budgeting adds a tokenizer dependency and complexity for no proven benefit.
2. **Do not** change `branch-summarization.ts:256` — it's already correct.
3. **Do not** touch `agent-harness.ts:618-623` log — logs are permanent; `maxTokens: undefined` is accurate.
4. **Do not** change the z.ai wrapper's `SUMMARY_RESERVE` (4000) cap logic — it's correct for its purpose (reserves for compaction output), it just can't help when the caller passes the ceiling. With omission, the caller no longer undermines it.
5. **Follow-up (separate plan, not this one):** the silent-empty hardening (`agent-loop.ts:770`) currently retries `finish: "length"` via the synthesized "ended without content" message. Since length-failures are sizing problems (deterministic), retrying wastes ~14s. After this fix the common case disappears, but consider making `finish: "length"` non-retryable (or routing to compaction) in a follow-up.

## Verification of recovery (post-commit, manual/optional)

After committing, to confirm the stuck session recovers:

1. Restart the desktop app (`vp run desktop#dev`).
2. Resume session `dece9647` with any prompt.
3. Watch `~/.sakti/logs/llm.1.log` — the `stream request` line should show `maxOutputTokens` absent (or `4096` after the z.ai wrapper), and the `stream finish` should show `finishReason: "tool-calls"` or `"stop"` with non-zero usage.
4. `~/.sakti/logs/agent.1.log` should show `maxTokens` absent from the `llm call starting` log.

If it still fails: check that the dev build picked up the change (restart, not HMR — the server runs in the Electron main process).
