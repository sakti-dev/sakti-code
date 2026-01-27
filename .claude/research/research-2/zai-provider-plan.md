# Z.ai Provider Implementation Plan (Refined)

> Implementation plan for `@ai-sdk/zai` aligned with the Vercel AI SDK codebase in `ai/` and the issues observed during Phase 2 work.

## Table of Contents

1. [Overview](#overview)
2. [Key Learnings / Constraints](#key-learnings--constraints)
3. [Current Status](#current-status)
4. [Refined Phases & Gates](#refined-phases--gates)
5. [Implementation Details](#implementation-details)
6. [Testing Strategy](#testing-strategy)
7. [Documentation](#documentation)
8. [Open Risks](#open-risks)

---

## Overview

### Goal

Create a fully-featured Vercel AI SDK v3 provider for Z.ai that supports:

- Chat completions with streaming
- Function calling (tools)
- Thinking modes (interleaved, preserved, turn-level)
- Context caching (preserved thinking)
- Web search tools
- Retrieval tools
- Structured output (JSON mode)
- Vision/multimodal support
- Tool streaming (tool_stream)

### Reference Implementation

Use the local Vercel AI SDK implementation in `ai/`, especially:

- `ai/packages/openai-compatible/src/chat/openai-compatible-chat-language-model.ts`
- `ai/packages/openai-compatible/src/chat/openai-compatible-prepare-tools.ts`
- `ai/packages/provider-utils/src/schema.ts`
- `ai/packages/provider-utils/src/parse-json.ts`

---

## Key Learnings / Constraints

These are hard requirements observed during implementation or from the SDK source:

1. **Provider options parsing**: Must use `parseProviderOptions` with a Zod schema and the provider key `zai`.
2. **Tool schemas**: `LanguageModelV3FunctionTool.inputSchema` is a JSON schema; pass through directly. Use `JSONSchema7` from `@ai-sdk/provider` and `z.custom<JSONSchema7>()` for Zod schemas to avoid `any`.
3. **Thinking config typing**: If `thinking` is provided, it must include `type` (not optional). Normalize before assigning to `ZaiChatRequest.thinking`.
4. **Tool streaming**: If streamed tool arguments never become valid JSON, still emit a final tool call on flush (matches openai-compatible behavior).
5. **Raw chunk support**: Respect `options.includeRawChunks` and emit `{ type: 'raw', rawValue }` before parsing errors.
6. **Base64 conversion**: Use `convertUint8ArrayToBase64` from `@ai-sdk/provider-utils` (runtime-safe); avoid direct `btoa` in Node/Edge contexts.
7. **Response metadata**: For non-streaming, include `id`, `modelId`, `timestamp` in `response` to match SDK patterns.
8. **Tool choice**: Only include `tool_choice` if `tools` is non-empty.
9. **Seed precedence**: Standard `options.seed` should take precedence over providerOptions.seed.
10. **No `any`**: Replace `any` with `unknown` and proper types in Zod schemas and request mapping.

---

## Current Status

**Implemented (Phase 1–2 partially):**
- Provider factory (`createZai`) and defaults.
- Chat request/response mapping.
- Streaming with reasoning, text, tool-call deltas.
- Basic tool handling.
- Provider options schema (Zod).

**Fixed based on issues:**
- Provider options parsing via `parseProviderOptions`.
- Removed `any` usages in schemas and request mapping.
- Tool streaming flush behavior.
- Response metadata in non-streaming.
- Raw chunk support.
- Base64 conversion via provider-utils.

**Still missing or incomplete:**
- Preserved thinking (clear_thinking=false) guarantees re-sending reasoning content across turns.
- Formal tool preparation helper (zai-chat-prepare-tools.ts) + tests.
- Web search/retrieval behavior validations + response mapping tests.
- Vision support tests.
- Robust metadata extraction for streaming usage.

---

## Refined Phases & Gates

Each phase ends with a gate you can run locally.

### Phase 0 — Baseline Stability
- Align coding patterns with `ai/packages/openai-compatible`.
- Type safety: no `any` or `as any` in provider code.

**Gate:**
- `pnpm -C packages/zai typecheck` passes
- `rg -n "\\bany\\b|as any" packages/zai/src` returns nothing

### Phase 1 — Core Request/Response Parity
- `doGenerate`: include request/response metadata and warnings.
- `doStream`: emit response metadata on first chunk, emit finish with usage.
- Normalize response_format handling (`json` → `json_object`).

**Gate:**
- Unit tests for request body shape and response mapping.

### Phase 2 — Tools & Tool Streaming
- Prepare tools (function + provider tools).
- Handle tool_choice passthrough (auto/none/required/tool).
- Ensure tool calls emitted even when JSON never becomes parsable.

**Gate:**
- Streaming tests:
  - full tool JSON in one chunk
  - chunked tool JSON
  - never-valid JSON (should still emit tool-call on flush)

### Phase 3 — Thinking + Context Caching
- Implement preserved thinking: if `clear_thinking=false`, return full `reasoning_content` for prior assistant turns.
- Respect `thinking` options from providerOptions.

**Gate:**
- Multi-turn tests that ensure reasoning_content is preserved and echoed in requests.

### Phase 4 — Multimodal Support
- Convert image files to data URIs and strip `data:image/*;base64,` prefix before sending.
- Ensure supportedUrls covers `image/*` with http(s) and data.

**Gate:**
- Tests for URL image, base64 string image, Uint8Array image.

### Phase 5 — Web Search + Retrieval
- Support providerOptions `web_search` and `retrieval` (as tools).
- Map `response.web_search` to `source` content parts.

**Gate:**
- Tests for web_search tool config, response mapping to sources.

### Phase 6 — Docs + Examples
- README with provider options, tool streaming, web search examples.
- Usage snippet aligned to AI SDK v6 shapes.

**Gate:**
- Example code compiles.

---

## Implementation Details

### Provider Options Parsing
- Use `parseProviderOptions` with schema from `zai-chat-settings.ts`.
- Provider key: `zai`.
- Merge into request with standard options precedence:
  - `seed`: use `options.seed ?? providerOptions.seed`.
  - `do_sample`: default from providerOptions unless temperature <= 0.

### Tool Handling
- Map `LanguageModelV3FunctionTool` to Z.ai tool:
  - `parameters: tool.inputSchema` (already JSONSchema7).
- Provider tools:
  - Support `web_search` + `retrieval` from providerOptions.
  - Allow provider-defined tools in `options.tools` with IDs `web_search` / `retrieval`.

### Streaming
- Emit `raw` chunks if `options.includeRawChunks`.
- When tool args never become valid JSON, emit `tool-call` in `flush`.
- Close reasoning/text blocks before tool calls (parity with OpenAI-compatible).

### Response Metadata
- For non-streaming: include `id`, `modelId`, `timestamp` in `response`.

---

## Testing Strategy

Add focused tests similar to `ai/packages/openai-compatible`:

**Unit Tests**
- Request args mapping (temperature/top_p clamping, response_format).
- ProviderOptions parsing and warnings.
- Tool preparation mapping.
- Reasoning content mapping.

**Streaming Tests**
- Tool deltas with partial JSON, valid JSON, invalid JSON.
- Usage and finish reason mapping.

**Integration Tests**
- Web search tool activation + response source mapping.
- Image message conversion.

---

## Documentation

- README should include:
  - Basic usage with `createZai`.
  - Provider options (`thinking`, `tool_stream`, `web_search`, `retrieval`).
  - Tool streaming example.
  - Image usage example.

---

## Open Risks

- **Preserved thinking correctness**: Ensure reasoning_content is fully re-sent for prior assistant turns when required; this is a common source of bugs.
- **Tool streaming completeness**: Some providers omit tool IDs or send partial arguments; must be robust.
- **Vision models**: Z.ai may require specific content part formats; validate with API behavior.

