# ADR: OpenAI Responses API routing

**Status:** Deferred (deliberate simplicity tradeoff) — last reviewed 2026-06-26.
**Scope:** `packages/llm` provider resolution (`provider/resolve.ts`).

## Context

opencode routes OpenAI and xAI models through `sdk.responses(modelId)` — the
**Responses API** — while falling back to `sdk.languageModel(modelId)`
(Chat Completions) for every other provider:

- `plugin/provider/openai.ts:180` → `evt.language = evt.sdk.responses(...)`
- `plugin/provider/xai.ts:18` → `evt.language = evt.sdk.responses(...)`
- `aisdk.ts:223` → default `sdk.languageModel(model.api.id)`

`@sakti-code/llm` resolves **every** model through `sdk.languageModel(model.id)`
(`provider/resolve.ts:246`), i.e. Chat Completions uniformly.

## Decision

**Keep uniform Chat Completions for now.** Do not special-case OpenAI/xAI to the
Responses API.

## Rationale

- **Universality.** Chat Completions works for all 142 catalog providers through
  one code path. The Responses API is OpenAI-specific; routing through it for a
  subset introduces a provider-specific branch in `resolveLanguageModel` and a
  second request/response shape to maintain.
- **Catalog parity.** Every catalog model's `cost` / `contextWindow` / tool
  support is validated against Chat Completions behavior. Switching the OpenAI
  path changes token accounting (the Responses API reports usage differently
  and carries encrypted reasoning content) and would need a separate
  verification pass.
- **Our `Usage` contract already normalizes.** `mapUsage` reads
  `inputTokenDetails.noCacheTokens` / `outputTokenDetails.reasoningTokens`, which
  `@ai-sdk/openai`'s Chat Completions adapter reports correctly. We are not
  missing cost/usage fidelity by staying on Chat Completions.

## What we would gain by switching

- Stateless reasoning + encrypted reasoning content (OpenAI-only feature).
- Marginally more effective prompt caching on OpenAI (we already hint
  `providerOptions.openai.promptCacheKey` on the Chat Completions path — see
  M2).
- Closer parity with opencode's default OpenAI path.

## When to revisit

Add a `Model.api.method` catalog field (`"chat" | "responses"`) and route on it
**only if** a concrete need appears:

- An OpenAI model requires a Responses-only feature (hosted tools that don't
  have a Chat Completions equivalent), or
- Prompt-cache hit rates on OpenAI are measurably worse than opencode's and the
  gap closes by switching APIs.

This is a deliberate simplicity tradeoff, not a correctness bug. Both APIs are
first-class in `@ai-sdk/openai`; the choice is ours to make per provider when a
reason materializes.
