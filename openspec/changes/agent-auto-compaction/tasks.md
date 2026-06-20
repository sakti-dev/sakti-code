## 1. Agent config types

- [x] 1.1 Add `apiKey?: string` and `autoCompaction?: boolean` to `AgentConfig` in `packages/agent/src/types.ts`
- [x] 1.2 Add `apiKey?: string` and `autoCompaction?: boolean` to `AgentConfigInput` in `packages/agent/src/types.ts`
- [x] 1.3 Run `bun typecheck` — 0 errors (additive fields, no consumer breaks)

## 2. Agent loop: auto-compaction check (TDD)

- [ ] 2.1 Write failing test `packages/agent/src/__tests__/auto-compaction.test.ts`: with `autoCompaction: true`, a tiny `contextWindow`, and a large user message, mock `completeSimple` to return a summary → assert `compaction_start` + `compaction_end` events are yielded, `store.replaceMessages` is called, and `tokensBefore > tokensAfter`. (RED — no check exists yet)
- [ ] 2.2 Write failing test in the same file: with `autoCompaction` omitted (default), even when tokens exceed the window → assert NO `compaction_*` events are yielded. (RED)
- [ ] 2.3 Write failing test: with `autoCompaction: true` but no `apiKey` → assert no `compaction_*` events and no error thrown (graceful skip)
- [ ] 2.4 Write failing test: with `autoCompaction: true`, `apiKey` set, but `completeSimple` returns `stopReason: "error"` → assert loop continues, no `error` event, `replaceMessages` not called (messages unchanged)
- [ ] 2.5 Implement the compaction check in `packages/agent/src/loop/index.ts`: add `estimateContextTokens` to `packages/agent/src/compaction.ts` (prefer real `usage.totalTokens` from the last assistant message; fall back to char/4 `estimateTokens` over all messages when no usage exists — mirrors pi's proven `estimateContextTokens`); import `compactMessages`, `estimateContextTokens`, `shouldCompact` from `../compaction.ts`; at the top of the `while(true)` loop (after `drainSteers`, before `yield evt("turn_start")`), gate on `resolved.autoCompaction && resolved.apiKey`; if `shouldCompact` trips, yield `compaction_start`, call `compactMessages({ model, apiKey, contextWindow, messages, reserveTokens, keepRecentTokens, signal })`, splice `result.messages` into the working array, `store.replaceMessages`, yield `compaction_end` with `tokensBefore`/`tokensAfter`
- [ ] 2.6 Run `bun vitest run packages/agent/src/__tests__/auto-compaction.test.ts` — all 4 new tests GREEN
- [ ] 2.7 Run full agent suite `bun vitest run packages/agent/` — 54+ existing tests still pass

## 3. Server runner: wire apiKey + autoCompaction

- [ ] 3.1 Write/extend failing test in `apps/server/src/agent/__tests__/runner.test.ts`: with a configured provider API key and `auto_compaction: "true"` in settings → assert `createAgentLoop` receives `autoCompaction: true` and a non-undefined `apiKey`. (RED — currently neither is passed)
- [ ] 3.2 Implement in `apps/server/src/agent/runner.ts`: import `getEnvApiKey` from `@earendil-works/pi-ai`; after resolving the model, compute `provider = ctx.repos.models.getForProject(session.projectId)?.provider ?? ""` and `apiKey = getEnvApiKey(provider) ?? undefined`; pass `autoCompaction: settings.auto_compaction === "true"` and `...(apiKey !== undefined ? { apiKey } : {})` to `createAgentLoop`
- [ ] 3.3 Run `cd apps/server && bun vitest run src/agent/__tests__/runner.test.ts` — GREEN

## 4. Verification

- [ ] 4.1 Run `bun vitest run packages/agent/` — all pass
- [ ] 4.2 Run `cd apps/server && bun vitest run src/agent/__tests__/` — all pass
- [ ] 4.3 Run `bun typecheck` — 0 errors
- [ ] 4.4 Run `bun x ultracite fix` — 0 remaining diagnostics
