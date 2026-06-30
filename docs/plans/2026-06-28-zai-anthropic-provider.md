# ZAI Anthropic Provider Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Hand-roll a `ZaiAnthropicLanguageModel` (`LanguageModelV4`) in `packages/llm/src/provider/zai-anthropic/` that speaks the Anthropic Messages protocol to Z.ai's endpoint, with leveled thinking budgets, prompt caching, interleaved reasoning, and Z.ai-native `speed`/`output_config`; repoint `zai`/`zai-coding-plan` catalog entries to it.

**Architecture:** Approach A (full hand-roll on `@ai-sdk/provider-utils` primitives), porting from `openspec/references/ai/packages/anthropic/src/` as a template but emitting only a minimal Anthropic subset + the one beta Z.ai needs (`prompt-caching-2024-07-31`). Integration: one new `BUNDLED_PROVIDERS` entry, one new `buildProviderOptions` branch keyed on `model.npm`, one generation-time catalog override in `catalog/convert.ts`. The existing `stream.ts` / `mapUsage` / `mapFinishReason` / `retry.ts` / `context-overflow.ts` are reused unchanged because we emit standard V4 shapes.

**Tech Stack:** TypeScript (ESM), `@ai-sdk/provider` v4, `@ai-sdk/provider-utils`, `zod` v4, `vitest`, `typebox`. Biome/Ultracite for formatting.

**Design doc:** `docs/plans/2026-06-28-zai-anthropic-provider-design.md` (read first).

**Porting source (read these before each task that references them):**

- `openspec/references/ai/packages/anthropic/src/anthropic-api.ts` — wire schemas (port a _minimal subset_)
- `.../anthropic-language-model.ts` — `getArgs` / `doGenerate` / `doStream` structure
- `.../convert-to-anthropic-prompt.ts` — message conversion
- `.../convert-anthropic-usage.ts` — usage mapper
- `.../map-anthropic-stop-reason.ts` — finish-reason map
- `.../get-cache-control.ts` — breakpoint validator
- `.../sanitize-json-schema.ts` — JSON Schema sanitizer
- `.../anthropic-error.ts` — error schema/handler
- `.../anthropic-provider.ts` — factory shape

**Conventions (from repo `AGENTS.md`):**

- TDD: failing test → implement → pass → commit.
- Tests colocated in `__tests__/`. `vitest`. No `.only`/`.skip`.
- `exactOptionalPropertyTypes: true` → use conditional spread `...(x !== undefined ? { x } : {})`, never pass `undefined`.
- `for...of` over `.forEach()`. Arrow callbacks. `const` by default.
- No raw `JSON.parse` in production code — use `parseJSON`/`safeParseJSON` from `@ai-sdk/provider-utils`.
- SolidJS rules don't apply (this is the llm package).
- Verify each task: `cd packages/llm && pnpm run typecheck && pnpm run test`. Before committing run `pnpm run fix` (root).

**Scope guard (v1 — do NOT add):** mcp servers, container/skills, code-execution tools, web_search/web_fetch server tools, advisor, tool_search, fallbacks, citations, compaction context-management, files API, OAuth. These are inert in Z.ai; adding them is out of scope.

---

### Task 1: Scaffold the package + registry entry + factory stub

**Files:**

- Create: `packages/llm/src/provider/zai-anthropic/index.ts`
- Create: `packages/llm/src/provider/zai-anthropic/zai-anthropic-language-model.ts`
- Create: `packages/llm/src/provider/zai-anthropic/__tests__/registry.test.ts`
- Modify: `packages/llm/src/provider/registry.ts` (add one entry)

**Step 1: Write the failing test**

`packages/llm/src/provider/zai-anthropic/__tests__/registry.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { BUNDLED_PROVIDERS } from "../../registry.ts";

describe("zai-anthropic registry entry", () => {
  it("resolves to a LanguageModelV4 with provider zai.messages", async () => {
    const loader = BUNDLED_PROVIDERS["@sakti-code/zai-anthropic"];
    expect(loader).toBeDefined();
    const factory = await loader();
    const sdk = factory({ apiKey: "k", baseURL: "https://api.z.ai/api/anthropic" });
    const model = sdk.languageModel("glm-5.2");
    expect(model.specificationVersion).toBe("v4");
    expect(model.modelId).toBe("glm-5.2");
    expect(model.provider).toBe("zai.messages");
  });
});
```

**Step 2: Run — verify it fails**

`cd packages/llm && pnpm run test -- zai-anthropic/__tests__/registry`
Expected: FAIL — `loader is undefined` / module not found.

**Step 3: Minimal implementation**

`packages/llm/src/provider/zai-anthropic/zai-anthropic-language-model.ts`:

```ts
import type {
  LanguageModelV4,
  LanguageModelV4CallOptions,
  LanguageModelV4GenerateResult,
  LanguageModelV4StreamResult,
} from "@ai-sdk/provider";
import type { FetchFunction } from "@ai-sdk/provider-utils";

export interface ZaiAnthropicConfig {
  baseURL: string;
  fetch?: FetchFunction;
  headers: () => Promise<Record<string, string | undefined>>;
  provider: string;
}

export class ZaiAnthropicLanguageModel implements LanguageModelV4 {
  readonly specificationVersion = "v4" as const;
  readonly modelId: string;
  private readonly config: ZaiAnthropicConfig;

  constructor(modelId: string, config: ZaiAnthropicConfig) {
    this.modelId = modelId;
    this.config = config;
  }

  get provider(): string {
    return this.config.provider;
  }

  supportsUrl(url: URL): boolean {
    return url.protocol === "https:";
  }

  get supportedUrls() {
    return {
      "image/*": [/^https?:\/\/.*$/, /^data:image\/.*$/],
    };
  }

  async doGenerate(_options: LanguageModelV4CallOptions): Promise<LanguageModelV4GenerateResult> {
    throw new Error("ZaiAnthropicLanguageModel.doGenerate: not implemented");
  }

  async doStream(_options: LanguageModelV4CallOptions): Promise<LanguageModelV4StreamResult> {
    throw new Error("ZaiAnthropicLanguageModel.doStream: not implemented");
  }
}
```

`packages/llm/src/provider/zai-anthropic/index.ts`:

```ts
import { withUserAgentSuffix, type FetchFunction } from "@ai-sdk/provider-utils";
import type { ProviderFactory, ProviderFactoryOptions, ProviderSDK } from "../registry.ts";
import { ZaiAnthropicLanguageModel } from "./zai-anthropic-language-model.ts";

const VERSION = "0.0.1";
const PROVIDER_NAME = "zai.messages";

export interface ZaiAnthropicProviderSettings extends ProviderFactoryOptions {
  fetch?: FetchFunction;
}

export function createZaiAnthropic(options: ZaiAnthropicProviderSettings): ProviderSDK {
  const baseURL = (options.baseURL ?? "").replace(/\/+$/, "");
  const apiKey = options.apiKey ?? "";
  const headers = async () =>
    withUserAgentSuffix(
      {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        ...(options.headers ?? {}),
      },
      `ai-sdk/zai-anthropic/${VERSION}`,
    );

  return {
    languageModel: (modelId: string) =>
      new ZaiAnthropicLanguageModel(modelId, {
        baseURL,
        provider: PROVIDER_NAME,
        headers,
        ...(options.fetch ? { fetch: options.fetch } : {}),
      }),
  };
}
```

In `packages/llm/src/provider/registry.ts`, add to `BUNDLED_PROVIDERS` (after the `"@ai-sdk/xai"` entry, before the third-party block):

```ts
  // Hand-rolled Z.ai Anthropic Messages provider (target zai/zai-coding-plan).
  "@sakti-code/zai-anthropic": () =>
    Promise.resolve(
      ((opts: ProviderFactoryOptions) =>
        createZaiAnthropic(opts)) as ProviderFactory,
    ),
```

and add the import at the top:

```ts
import { createZaiAnthropic } from "./zai-anthropic/index.ts";
```

**Step 4: Run — verify it passes**

`cd packages/llm && pnpm run typecheck && pnpm run test -- zai-anthropic/__tests__/registry`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/llm/src/provider/zai-anthropic/ packages/llm/src/provider/registry.ts
git commit -m "feat(llm): scaffold zai-anthropic provider + registry entry"
```

---

### Task 2: `providerOptions.zai` schema

**Files:**

- Create: `packages/llm/src/provider/zai-anthropic/zai-anthropic-options.ts`
- Create: `packages/llm/src/provider/zai-anthropic/__tests__/options.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { parseProviderOptions } from "@ai-sdk/provider-utils";
import { zaiAnthropicOptions } from "../zai-anthropic-options.ts";

describe("zai-anthropic options schema", () => {
  it("parses a full options object", async () => {
    const parsed = await parseProviderOptions({
      provider: "zai",
      providerOptions: {
        zai: {
          thinking: { type: "enabled", budgetTokens: 16000 },
          speed: "fast",
          outputConfig: { effort: "high" },
          cacheControl: { system: true, tools: true },
          sendReasoning: true,
        },
      },
      schema: zaiAnthropicOptions,
    });
    expect(parsed?.thinking?.type).toBe("enabled");
    expect(parsed?.speed).toBe("fast");
    expect(parsed?.outputConfig?.effort).toBe("high");
  });

  it("parses adaptive thinking with display", async () => {
    const parsed = await parseProviderOptions({
      provider: "zai",
      providerOptions: { zai: { thinking: { type: "adaptive", display: "summarized" } } },
      schema: zaiAnthropicOptions,
    });
    expect(parsed?.thinking?.type).toBe("adaptive");
  });

  it("returns null when no zai key is present", async () => {
    const parsed = await parseProviderOptions({
      provider: "zai",
      providerOptions: { anthropic: { thinking: { type: "disabled" } } },
      schema: zaiAnthropicOptions,
    });
    expect(parsed).toBeNull();
  });
});
```

**Step 2: Run — verify it fails** (`zai-anthropic-options.ts` missing).

**Step 3: Implement**

`packages/llm/src/provider/zai-anthropic/zai-anthropic-options.ts`:

```ts
import { zodSchema } from "@ai-sdk/provider-utils";
import { z } from "zod";

const schema = z.object({
  thinking: z
    .discriminatedUnion("type", [
      z.object({
        type: z.literal("enabled"),
        budgetTokens: z.number().int().min(1024).optional(),
      }),
      z.object({
        type: z.literal("adaptive"),
        display: z.enum(["omitted", "summarized"]).optional(),
      }),
      z.object({ type: z.literal("disabled") }),
    ])
    .optional(),
  speed: z.enum(["fast", "standard"]).optional(),
  outputConfig: z
    .object({
      effort: z.enum(["low", "medium", "high", "xhigh", "max"]).optional(),
      taskBudget: z
        .object({
          type: z.literal("tokens"),
          total: z.number().int().min(20000),
          remaining: z.number().int().min(0).optional(),
        })
        .optional(),
      format: z
        .object({ type: z.literal("json_schema"), schema: z.record(z.string(), z.unknown()) })
        .optional(),
    })
    .optional(),
  cacheControl: z
    .object({ system: z.boolean().optional(), tools: z.boolean().optional() })
    .optional(),
  sendReasoning: z.boolean().optional(),
});

export type ZaiAnthropicOptions = z.infer<typeof schema>;
export const zaiAnthropicOptions = zodSchema(schema);
```

**Step 4: Run — PASS.**

**Step 5: Commit**

```bash
git add packages/llm/src/provider/zai-anthropic/zai-anthropic-options.ts packages/llm/src/provider/zai-anthropic/__tests__/options.test.ts
git commit -m "feat(llm): zai-anthropic providerOptions.zai schema"
```

---

### Task 3: Minimal wire schemas + error handler

Port a **strict subset** of `anthropic-api.ts` — only what Z.ai surfaces. Do NOT port mcp/container/code-exec/web tools/advisor/tool-search/fallback/compaction/citations.

**Files:**

- Create: `packages/llm/src/provider/zai-anthropic/zai-anthropic-api.ts`
- Create: `packages/llm/src/provider/zai-anthropic/zai-anthropic-error.ts`
- Create: `packages/llm/src/provider/zai-anthropic/__tests__/api-schema.test.ts`

**Step 1: Write the failing test** — assert each schema parses its target fixture and rejects an unknown block type.

```ts
import { describe, expect, it } from "vitest";
import { zaiResponseSchema, zaiChunkSchema } from "../zai-anthropic-api.ts";

describe("zai-anthropic wire schemas (minimal subset)", () => {
  it("parses a non-stream response with text + tool_use", () => {
    const raw = {
      id: "msg_1",
      model: "glm-5.2",
      stop_reason: "tool_use",
      content: [
        { type: "text", text: "hello" },
        { type: "thinking", thinking: "hmm", signature: "sig" },
        { type: "tool_use", id: "tu_1", name: "Read", input: { path: "a" } },
      ],
      usage: { input_tokens: 10, output_tokens: 5 },
    };
    const parsed = zaiResponseSchema.parse(raw);
    expect(parsed.content[1]).toMatchObject({ type: "thinking" });
  });

  it("parses a content_block_delta input_json_delta chunk", () => {
    const parsed = zaiChunkSchema.parse({
      type: "content_block_delta",
      index: 0,
      delta: { type: "input_json_delta", partial_json: '{"path":"a' },
    });
    expect(parsed.delta.type).toBe("input_json_delta");
  });

  it("rejects an unsupported block type (mcp_tool_use)", () => {
    expect(() =>
      zaiResponseSchema.parse({
        id: "x",
        model: "x",
        stop_reason: "end_turn",
        content: [{ type: "mcp_tool_use", id: "x", name: "x", server_name: "s", input: {} }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    ).toThrow();
  });
});
```

**Step 2: Run — verify it fails.**

**Step 3: Implement** — port from `anthropic-api.ts` but keep only: response content variants `text` | `thinking` | `redacted_thinking` | `tool_use`; stream events `message_start`, `content_block_start` (same 4 block types + `text_delta`/`thinking_delta`/`signature_delta`/`input_json_delta` deltas), `content_block_delta`, `content_block_stop`, `message_delta`, `message_stop`, `error`, `ping`; usage `{input_tokens, output_tokens, cache_creation_input_tokens?, cache_read_input_tokens?}`. Use `z.lazy(() => ...)`/`lazySchema` + `zodSchema` exactly as the reference does.

`packages/llm/src/provider/zai-anthropic/zai-anthropic-api.ts`:

```ts
import { lazySchema, zodSchema } from "@ai-sdk/provider-utils";
import { z } from "zod";

// Minimal Anthropic Messages wire schema — Z.ai subset only.
// Ported from @ai-sdk/anthropic anthropic-api.ts, with mcp/container/code-exec/
// web/advisor/tool-search/fallback/compaction/citations stripped.

export const zaiResponseSchema = lazySchema(() =>
  zodSchema(
    z.object({
      id: z.string().nullish(),
      model: z.string().nullish(),
      stop_reason: z.string().nullish(),
      stop_sequence: z.string().nullish(),
      content: z.array(
        z.discriminatedUnion("type", [
          z.object({ type: z.literal("text"), text: z.string() }),
          z.object({ type: z.literal("thinking"), thinking: z.string(), signature: z.string() }),
          z.object({ type: z.literal("redacted_thinking"), data: z.string() }),
          z.object({
            type: z.literal("tool_use"),
            id: z.string(),
            name: z.string(),
            input: z.unknown(),
          }),
        ]),
      ),
      usage: z.object({
        input_tokens: z.number(),
        output_tokens: z.number(),
        cache_creation_input_tokens: z.number().nullish(),
        cache_read_input_tokens: z.number().nullish(),
      }),
    }),
  ),
);

export const zaiChunkSchema = lazySchema(() =>
  zodSchema(
    z.discriminatedUnion("type", [
      z.object({
        type: z.literal("message_start"),
        message: z.object({
          id: z.string().nullish(),
          model: z.string().nullish(),
          usage: z
            .object({
              input_tokens: z.number(),
              cache_creation_input_tokens: z.number().nullish(),
              cache_read_input_tokens: z.number().nullish(),
            })
            .nullish(),
        }),
      }),
      z.object({
        type: z.literal("content_block_start"),
        index: z.number(),
        content_block: z.discriminatedUnion("type", [
          z.object({ type: z.literal("text"), text: z.string() }),
          z.object({ type: z.literal("thinking"), thinking: z.string() }),
          z.object({ type: z.literal("redacted_thinking"), data: z.string() }),
          z.object({
            type: z.literal("tool_use"),
            id: z.string(),
            name: z.string(),
            input: z.unknown().optional(),
          }),
        ]),
      }),
      z.object({
        type: z.literal("content_block_delta"),
        index: z.number(),
        delta: z.discriminatedUnion("type", [
          z.object({ type: z.literal("text_delta"), text: z.string() }),
          z.object({ type: z.literal("thinking_delta"), thinking: z.string() }),
          z.object({ type: z.literal("signature_delta"), signature: z.string() }),
          z.object({ type: z.literal("input_json_delta"), partial_json: z.string() }),
        ]),
      }),
      z.object({ type: z.literal("content_block_stop"), index: z.number() }),
      z.object({
        type: z.literal("message_delta"),
        delta: z.object({ stop_reason: z.string().nullish(), stop_sequence: z.string().nullish() }),
        usage: z
          .object({
            input_tokens: z.number().nullish(),
            output_tokens: z.number(),
            cache_creation_input_tokens: z.number().nullish(),
            cache_read_input_tokens: z.number().nullish(),
          })
          .nullish(),
      }),
      z.object({ type: z.literal("message_stop") }),
      z.object({ type: z.literal("ping") }),
      z.object({
        type: z.literal("error"),
        error: z.object({ type: z.string(), message: z.string() }),
      }),
    ]),
  ),
);

export type ZaiResponse = typeof zaiResponseSchema extends { parse: (v: unknown) => infer T }
  ? T
  : never;
```

> NOTE: derive concrete types via `z.infer<typeof schema>` on a locally-bound zod schema if the `infer` helper above is awkward — match how `@ai-sdk/anthropic` exports `InferSchema<typeof anthropicResponseSchema>`. Prefer the explicit `export type ZaiResponse = { id: string | null; ...; content: Array<...>; usage: {...} }` hand-written type (as the old `packages/zai` did) for clarity.

`packages/llm/src/provider/zai-anthropic/zai-anthropic-error.ts`:

```ts
import { createJsonErrorResponseHandler, lazySchema, zodSchema } from "@ai-sdk/provider-utils";
import { z } from "zod";

export const zaiErrorDataSchema = lazySchema(() =>
  zodSchema(
    z.object({
      type: z.literal("error"),
      error: z.object({ type: z.string(), message: z.string() }),
    }),
  ),
);

export const zaiFailedResponseHandler = createJsonErrorResponseHandler({
  errorSchema: zaiErrorDataSchema,
  errorToMessage: (data) => data.error.message,
});
```

**Step 4: Run — PASS.**

**Step 5: Commit**

```bash
git add packages/llm/src/provider/zai-anthropic/zai-anthropic-api.ts packages/llm/src/provider/zai-anthropic/zai-anthropic-error.ts packages/llm/src/provider/zai-anthropic/__tests__/api-schema.test.ts
git commit -m "feat(llm): zai-anthropic minimal wire schemas + error handler"
```

---

### Task 4: `convert-to-zai-messages.ts`

Port from `convert-to-anthropic-prompt.ts`, but the input is the project's `Message[]` (`packages/llm/src/types.ts`) — the project already converts these to `CoreMessage[]` via `messages.ts:toModelMessages`. **Consume `LanguageModelV4Prompt`** (the V4 prompt type the model receives), not the project `Message[]`, so the converter stays SDK-shaped. (The V4 call options carry `prompt: LanguageModelV4Prompt`.)

**Files:**

- Create: `packages/llm/src/provider/zai-anthropic/convert-to-zai-messages.ts`
- Create: `packages/llm/src/provider/zai-anthropic/__tests__/convert-to-zai-messages.test.ts`

**Step 1: Write the failing test** — one case per branch:

- system → `{ role:"system", content:[{type:"text",text}] }`
- single-text user → `content` as a string OR single text block (pick one; match `@ai-sdk/anthropic` which emits an array)
- user image → `{type:"image", source:{type:"base64", media_type, data}}`
- assistant with text + reasoning + tool-call → assistant message with all three block types; reasoning → `{type:"thinking", thinking, signature}` (signature from `providerOptions.anthropic.signature` on the reasoning part — see `anthropic-language-model.ts:944-953`)
- tool result → `{role:"user", content:[{type:"tool_result", tool_use_id, content, is_error}]}`

```ts
import { describe, expect, it } from "vitest";
import { convertToZaiMessages } from "../convert-to-zai-messages.ts";

describe("convertToZaiMessages", () => {
  it("lifts system to top-level", () => {
    const { system, messages } = convertToZaiMessages({
      prompt: [
        { role: "system", content: "you are helpful" },
        { role: "user", content: [{ type: "text", text: "hi" }] },
      ],
    });
    expect(system?.[0]).toMatchObject({ type: "text", text: "you are helpful" });
    expect(messages[0].role).toBe("user");
  });

  it("emits tool_result from a tool role message", () => {
    const { messages } = convertToZaiMessages({
      prompt: [
        { role: "user", content: [{ type: "text", text: "q" }] },
        {
          role: "tool",
          content: [
            { type: "tool-result", toolCallId: "tu_1", toolName: "Read", result: "file contents" },
          ],
        },
      ],
    });
    expect(messages[1]).toMatchObject({
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "tu_1", content: "file contents" }],
    });
  });

  it("replays assistant reasoning with signature", () => {
    const { messages } = convertToZaiMessages({
      prompt: [
        {
          role: "assistant",
          content: [
            {
              type: "reasoning",
              text: "hmm",
              providerOptions: { anthropic: { signature: "sig" } },
            },
            { type: "text", text: "ans" },
          ],
        },
      ],
    });
    expect(messages[0].content[0]).toMatchObject({
      type: "thinking",
      thinking: "hmm",
      signature: "sig",
    });
  });
});
```

**Step 2: Run — verify it fails.**

**Step 3: Implement** — port the dispatch logic from `convert-to-anthropic-prompt.ts`. Emit a `cache_control` slot on each text block (filled later by the `CacheControlValidator` pass in `getArgs`). Keep `sendReasoning:true` default: include `thinking` blocks in assistant messages only when the reasoning part carries a signature AND `sendReasoning !== false`.

Signature for the converter:

```ts
export function convertToZaiMessages(input: {
  prompt: LanguageModelV4Prompt;
  sendReasoning?: boolean;
}): {
  system:
    | Array<{
        type: "text";
        text: string;
        cache_control?: { type: "ephemeral"; ttl?: "5m" | "1h" };
      }>
    | undefined;
  messages: Array<ZaiMessage>;
};
```

**Step 4: Run — PASS** (extend with the remaining branches: user image, assistant text+tool_use, tool-result error/isError).

**Step 5: Commit**

```bash
git add packages/llm/src/provider/zai-anthropic/convert-to-zai-messages.ts packages/llm/src/provider/zai-anthropic/__tests__/convert-to-zai-messages.test.ts
git commit -m "feat(llm): zai-anthropic message converter (system/image/thinking/tool_result)"
```

---

### Task 5: `CacheControlValidator` + `sanitizeJsonSchema` helpers

Port both verbatim from `@ai-sdk/anthropic` (`get-cache-control.ts`, `sanitize-json-schema.ts`). They are small, well-tested, and exactly what we need.

**Files:**

- Create: `packages/llm/src/provider/zai-anthropic/get-cache-control.ts`
- Create: `packages/llm/src/provider/zai-anthropic/sanitize-json-schema.ts`
- Create: `packages/llm/src/provider/zai-anthropic/__tests__/get-cache-control.test.ts`

**Step 1: Write the failing test** — assert the validator caps at 4 breakpoints and emits a warning on the 5th.

```ts
import { describe, expect, it } from "vitest";
import { CacheControlValidator } from "../get-cache-control.ts";

describe("CacheControlValidator", () => {
  it("allows up to 4 breakpoints and warns on the 5th", () => {
    const v = new CacheControlValidator();
    for (const _ of [1, 2, 3, 4]) {
      expect(v.addBreakpoint().breakpoint).toEqual({ type: "ephemeral" });
    }
    const fifth = v.addBreakpoint();
    expect(fifth.breakpoint).toBeUndefined();
    expect(v.getWarnings()).toHaveLength(1);
  });
});
```

**Step 2: Run — fails.**

**Step 3: Port** both files from the reference (copy + rename exports; keep comments). The validator tracks a counter and an `ephemeral` default; `ttl:"5m"` is the Z.ai default (GLM cache_write is free; 5m is the safe default).

**Step 4: Run — PASS.**

**Step 5: Commit**

```bash
git add packages/llm/src/provider/zai-anthropic/get-cache-control.ts packages/llm/src/provider/zai-anthropic/sanitize-json-schema.ts packages/llm/src/provider/zai-anthropic/__tests__/get-cache-control.test.ts
git commit -m "feat(llm): port CacheControlValidator + sanitizeJsonSchema for zai-anthropic"
```

---

### Task 6: `getArgs` — request body builder (the heart of Section 2)

**Files:**

- Modify: `packages/llm/src/provider/zai-anthropic/zai-anthropic-language-model.ts` (add private `getArgs`)
- Create: `packages/llm/src/provider/zai-anthropic/__tests__/get-args.test.ts`
- Create: `packages/llm/src/provider/zai-anthropic/__tests__/__fixtures__/get-args-base.json` (snapshot)

**Step 1: Write the failing tests** (one rule each):

```ts
import { describe, expect, it } from "vitest";
import { ZaiAnthropicLanguageModel } from "../zai-anthropic-language-model.ts";

const make = () =>
  new ZaiAnthropicLanguageModel("glm-5.2", {
    baseURL: "https://api.z.ai/api/anthropic",
    provider: "zai.messages",
    headers: async () => ({}),
  });

const baseOpts = (overrides: Record<string, unknown> = {}) => ({
  prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
  ...overrides,
});

describe("ZaiAnthropicLanguageModel.getArgs", () => {
  it("emits thinking enabled with budget from providerOptions.zai", async () => {
    const m = make();
    const { args } = await m.getArgs(
      baseOpts({
        providerOptions: { zai: { thinking: { type: "enabled", budgetTokens: 16000 } } },
      }),
    );
    expect(args.thinking).toEqual({ type: "enabled", budget_tokens: 16000 });
  });

  it("defaults budget to 1024 when enabled without budgetTokens", async () => {
    const m = make();
    const { args, warnings } = await m.getArgs(
      baseOpts({
        providerOptions: { zai: { thinking: { type: "enabled" } } },
      }),
    );
    expect(args.thinking).toEqual({ type: "enabled", budget_tokens: 1024 });
    expect(warnings.some((w) => w.feature === "extended thinking")).toBe(true);
  });

  it("strips temperature/topP/topK when thinking enabled", async () => {
    const m = make();
    const { args, warnings } = await m.getArgs(
      baseOpts({
        temperature: 0.5,
        topP: 0.9,
        topK: 40,
        providerOptions: { zai: { thinking: { type: "enabled", budgetTokens: 16000 } } },
      }),
    );
    expect(args.temperature).toBeUndefined();
    expect(args.top_p).toBeUndefined();
    expect(args.top_k).toBeUndefined();
    expect(warnings.some((w) => w.feature === "temperature")).toBe(true);
  });

  it("emits speed + output_config only when set", async () => {
    const m = make();
    const { args } = await m.getArgs(
      baseOpts({
        providerOptions: { zai: { speed: "fast", outputConfig: { effort: "high" } } },
      }),
    );
    expect(args.speed).toBe("fast");
    expect(args.output_config).toEqual({ effort: "high" });
  });

  it("puts cache_control on last system block + last tool", async () => {
    const m = make();
    const { args } = await m.getArgs(
      baseOpts({
        prompt: [
          { role: "system", content: "sys" },
          { role: "user", content: [{ type: "text", text: "hi" }] },
        ],
        tools: [{ type: "function", name: "Read", inputSchema: { type: "object" } }],
      }),
    );
    expect(args.system.at(-1).cache_control).toEqual({ type: "ephemeral" });
    expect(args.tools.at(-1).cache_control).toEqual({ type: "ephemeral" });
  });

  it("max_tokens = requested + thinkingBudget", async () => {
    const m = make();
    const { args } = await m.getArgs(
      baseOpts({
        maxOutputTokens: 4096,
        providerOptions: { zai: { thinking: { type: "enabled", budgetTokens: 32000 } } },
      }),
    );
    expect(args.max_tokens).toBe(4096 + 32000);
  });
});
```

> Export `getArgs` as `public` (or test via a thin public wrapper) for the duration of TDD; it can be made private once the public `doGenerate`/`doStream` tests cover it.

**Step 2: Run — fails.**

**Step 3: Implement `getArgs`** — mirror the structure of `anthropic-language-model.ts:203-780`, stripped to v1 scope:

- warnings for `frequencyPenalty` / `presencePenalty` / `seed` / `topK` (topK only stripped when thinking on).
- `parseProviderOptions({ provider:"zai", schema: zaiAnthropicOptions })`.
- resolve `thinking` (enabled/adaptive/disabled), default budget 1024.
- strip temperature/topP/topK when thinking on (with warnings).
- build `baseArgs`: `model`, `max_tokens` (= `maxOutputTokens + budget`), `temperature`, `top_p`, `top_k`, `stop_sequences`, `thinking`, `speed`, `output_config` (effort/task_budget/format with sanitized schema), `system`, `messages`, `tools`, `tool_choice`.
- run the `CacheControlValidator` pass over system + tools (mark last system block + last tool).
- return `{ args, warnings }`.

Hand-written `ZaiRequest` type at the top of the file (snake_case wire shape), e.g.:

```ts
interface ZaiRequest {
  model: string;
  max_tokens: number;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  stop_sequences?: string[];
  thinking?: {
    type: "enabled" | "disabled" | "adaptive";
    budget_tokens?: number;
    display?: "omitted" | "summarized";
  };
  speed?: "fast" | "standard";
  output_config?: {
    effort?: string;
    task_budget?: { type: "tokens"; total: number; remaining?: number };
    format?: { type: "json_schema"; schema: unknown };
  };
  system: Array<{
    type: "text";
    text: string;
    cache_control?: { type: "ephemeral"; ttl?: "5m" | "1h" };
  }>;
  messages: Array<ZaiMessage>;
  tools?: Array<{
    name: string;
    description?: string;
    input_schema: object;
    cache_control?: { type: "ephemeral" };
  }>;
  tool_choice?: { type: "auto" | "any" | "tool"; name?: string };
  stream?: true;
}
```

**Step 4: Run — PASS** (iterate per-rule; commit incrementally if helpful).

**Step 5: Commit**

```bash
git add packages/llm/src/provider/zai-anthropic/zai-anthropic-language-model.ts packages/llm/src/provider/zai-anthropic/__tests__/get-args.test.ts
git commit -m "feat(llm): zai-anthropic getArgs (thinking/cache_control/speed/output_config/max_tokens)"
```

---

### Task 7: `convert-zai-usage` + `map-zai-response` (non-stream mapping)

**Files:**

- Create: `packages/llm/src/provider/zai-anthropic/convert-zai-usage.ts`
- Create: `packages/llm/src/provider/zai-anthropic/map-zai-response.ts`
- Create: `packages/llm/src/provider/zai-anthropic/map-zai-stop-reason.ts`
- Create: `packages/llm/src/provider/zai-anthropic/__tests__/map-zai-response.test.ts`

**Step 1: Failing test**

```ts
import { describe, expect, it } from "vitest";
import { mapZaiResponse } from "../map-zai-response.ts";

describe("mapZaiResponse", () => {
  it("maps text + thinking + tool_use content + usage", () => {
    const result = mapZaiResponse({
      response: {
        id: "msg_1",
        model: "glm-5.2",
        stop_reason: "tool_use",
        content: [
          { type: "thinking", thinking: "hmm", signature: "sig" },
          { type: "text", text: "ans" },
          { type: "tool_use", id: "tu_1", name: "Read", input: { path: "a" } },
        ],
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_creation_input_tokens: 20,
          cache_read_input_tokens: 5,
        },
      },
    });
    expect(result.content.map((c) => c.type)).toEqual(["reasoning", "text", "tool-call"]);
    expect(result.finishReason.unified).toBe("tool-calls");
    expect(result.usage.inputTokens.noCache).toBe(100);
    expect(result.usage.inputTokens.cacheRead).toBe(5);
    expect(result.usage.inputTokens.cacheWrite).toBe(20);
  });
});
```

**Step 2: Run — fails.**

**Step 3: Implement** — port `convert-anthropic-usage.ts` (drop the iterations/fallback handling — Z.ai doesn't surface it; just `input_tokens`/`output_tokens`/`cache_*`) and `map-anthropic-stop-reason.ts` (`end_turn`/`stop_sequence`/`pause_turn`→`stop`; `tool_use`→`tool-calls`; `max_tokens`/`model_context_window_exceeded`→`length`; `refusal`→`content-filter`; default `other`). `mapZaiResponse` maps `content[]` → V4 content (`text`, `reasoning` w/ `providerOptions.zai.signature`, `tool-call` w/ `JSON.stringify(input)`).

**Step 4: Run — PASS.**

**Step 5: Commit**

```bash
git add packages/llm/src/provider/zai-anthropic/convert-zai-usage.ts packages/llm/src/provider/zai-anthropic/map-zai-response.ts packages/llm/src/provider/zai-anthropic/map-zai-stop-reason.ts packages/llm/src/provider/zai-anthropic/__tests__/map-zai-response.test.ts
git commit -m "feat(llm): zai-anthropic non-stream response mapper + usage/stop-reason"
```

---

### Task 8: `doGenerate`

**Files:**

- Modify: `packages/llm/src/provider/zai-anthropic/zai-anthropic-language-model.ts`
- Create: `packages/llm/src/provider/zai-anthropic/__tests__/do-generate.test.ts`

**Step 1: Failing test** — inject a fake `fetch` that returns a canned JSON body; assert the V4 result.

```ts
import { describe, expect, it } from "vitest";
import { ZaiAnthropicLanguageModel } from "../zai-anthropic-language-model.ts";

describe("ZaiAnthropicLanguageModel.doGenerate", () => {
  it("POSTs to {baseURL}/messages and maps the response", async () => {
    let postedUrl = "";
    let postedBody: unknown;
    const fakeFetch = (async (url: string, init: { body?: string }) => {
      postedUrl = url;
      postedBody = JSON.parse(init.body ?? "{}");
      return new Response(
        JSON.stringify({
          id: "msg_1",
          model: "glm-5.2",
          stop_reason: "end_turn",
          content: [{ type: "text", text: "hello" }],
          usage: { input_tokens: 10, output_tokens: 3 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    const model = new ZaiAnthropicLanguageModel("glm-5.2", {
      baseURL: "https://api.z.ai/api/anthropic",
      provider: "zai.messages",
      headers: async () => ({ "x-api-key": "k" }),
      ...(fakeFetch ? { fetch: fakeFetch } : {}),
    });

    const result = await model.doGenerate({
      prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    } as never);

    expect(postedUrl).toBe("https://api.z.ai/api/anthropic/messages");
    expect((postedBody as { model: string }).model).toBe("glm-5.2");
    expect(result.content[0]).toMatchObject({ type: "text", text: "hello" });
    expect(result.finishReason.unified).toBe("stop");
  });
});
```

**Step 2: Run — fails.**

**Step 3: Implement `doGenerate`** using `postJsonToApi` + `zaiFailedResponseHandler` + `createJsonResponseHandler(zaiResponseSchema)` + `mapZaiResponse`. Return `{ ...result, request:{body:args}, response:{ id, modelId, headers, body } }`.

**Step 4: Run — PASS.**

**Step 5: Commit**

```bash
git add packages/llm/src/provider/zai-anthropic/zai-anthropic-language-model.ts packages/llm/src/provider/zai-anthropic/__tests__/do-generate.test.ts
git commit -m "feat(llm): zai-anthropic doGenerate"
```

---

### Task 9: `doStream` — text + reasoning (interleaved)

**Files:**

- Modify: `packages/llm/src/provider/zai-anthropic/zai-anthropic-language-model.ts`
- Create: `packages/llm/src/provider/zai-anthropic/__tests__/do-stream.test.ts`
- Create: `packages/llm/src/provider/zai-anthropic/__tests__/__fixtures__/stream-text-thinking.sse.json`

**Step 1: Failing test** — feed a sequence of SSE events (`message_start`, `content_block_start` thinking, `thinking_delta`×2, `signature_delta`, `content_block_stop`, `content_block_start` text, `text_delta`×2, `content_block_stop`, `message_delta`, `message_stop`) and assert the emitted stream parts.

```ts
import { describe, expect, it } from "vitest";
import { ZaiAnthropicLanguageModel } from "../zai-anthropic-language-model.ts";
import { sseResponse } from "./__fixtures__/sse-helper.ts";

describe("ZaiAnthropicLanguageModel.doStream — text + thinking", () => {
  it("emits reasoning-start/delta/end then text-start/delta/end then finish", async () => {
    const events = [
      { type: "message_start", message: { id: "m", model: "glm-5.2", usage: { input_tokens: 5 } } },
      { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "hmm" } },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "signature_delta", signature: "sig" },
      },
      { type: "content_block_stop", index: 0 },
      { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "he" } },
      { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "llo" } },
      { type: "content_block_stop", index: 1 },
      { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 3 } },
      { type: "message_stop" },
    ];
    const fakeFetch = (async () => sseResponse(events)) as unknown as typeof fetch;
    const model = new ZaiAnthropicLanguageModel("glm-5.2", {
      baseURL: "https://api.z.ai/api/anthropic",
      provider: "zai.messages",
      headers: async () => ({}),
      fetch: fakeFetch,
    });
    const { stream } = await model.doStream({
      prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    } as never);
    const parts: unknown[] = [];
    for await (const p of stream) parts.push(p);
    const types = (parts as { type: string }[]).map((p) => p.type);
    expect(types).toEqual([
      "stream-start",
      "reasoning-start",
      "reasoning-delta",
      "reasoning-end",
      "text-start",
      "text-delta",
      "text-delta",
      "text-end",
      "finish",
    ]);
  });
});
```

Add a helper `__fixtures__/sse-helper.ts` that turns an events array into a `Response` with `content-type: text/event-stream` body (one `data: {...}\n\n` per event).

**Step 2: Run — fails.**

**Step 3: Implement `doStream`** — port the `TransformStream` from `anthropic-language-model.ts:1540-1800`, stripped to v1 events. Maintain per-index block state:

```ts
type Block =
  | { type: "text" }
  | { type: "reasoning"; signature?: string }
  | { type: "tool-call"; id: string; name: string; inputChunks: string[] };
const blocks = new Map<number, Block>();
```

Map events per the table in the design doc (Section 3). Emit `stream-start` with warnings on `start`; `finish` on `flush` with `{ finishReason:{unified,raw}, usage, providerMetadata:{ zai: { usage: raw } } }`. Use `safeParseJSON` from `@ai-sdk/provider-utils` to parse accumulated tool input (Task 10).

**Step 4: Run — PASS.**

**Step 5: Commit**

```bash
git add packages/llm/src/provider/zai-anthropic/zai-anthropic-language-model.ts packages/llm/src/provider/zai-anthropic/__tests__/do-stream.test.ts packages/llm/src/provider/zai-anthropic/__tests__/__fixtures__/
git commit -m "feat(llm): zai-anthropic doStream (text + interleaved reasoning)"
```

---

### Task 10: `doStream` — tool_use assembly

**Files:**

- Modify: the doStream test file + implementation.

**Step 1: Failing test** — events: `content_block_start` tool_use (id, name), 2× `input_json_delta`, `content_block_stop`. Assert: `tool-input-start` {id, toolName}, two `tool-input-delta`, `tool-input-end`, `tool-call` with `input` = parsed JSON.

```ts
it("assembles tool_use input from input_json_delta and emits tool-call", async () => {
  const events = [
    { type: "message_start", message: { id: "m", model: "glm-5.2", usage: { input_tokens: 5 } } },
    {
      type: "content_block_start",
      index: 0,
      content_block: { type: "tool_use", id: "tu_1", name: "Read" },
    },
    {
      type: "content_block_delta",
      index: 0,
      delta: { type: "input_json_delta", partial_json: '{"path":"a' },
    },
    {
      type: "content_block_delta",
      index: 0,
      delta: { type: "input_json_delta", partial_json: '.ts"}' },
    },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 6 } },
    { type: "message_stop" },
  ];
  // … fake fetch + collect parts …
  const toolCall = parts.find((p) => p.type === "tool-call");
  expect(toolCall).toMatchObject({
    toolCallId: "tu_1",
    toolName: "Read",
    input: '{"path":"a.ts"}',
  });
});
```

**Step 2: Run — fails.**

**Step 3: Implement** — accumulate `partial_json` strings on the block's `inputChunks`; on `content_block_stop`, join and `safeParseJSON` (fall back to the raw string if it doesn't parse — emit a warning). Emit `tool-input-start`/`tool-input-delta`/`tool-input-end` + `tool-call`. If the block arrives with `input` already populated (deferred-style), emit the `tool-call` directly.

**Step 4: Run — PASS.**

**Step 5: Commit**

```bash
git add packages/llm/src/provider/zai-anthropic/zai-anthropic-language-model.ts packages/llm/src/provider/zai-anthropic/__tests__/do-stream.test.ts
git commit -m "feat(llm): zai-anthropic doStream tool_use assembly"
```

---

### Task 11: `doStream` — error event, finish, usage accumulation

**Files:**

- Modify: test + impl.

**Step 1: Failing tests**

- error event → emits `{type:"error"}` and the stream ends (finishReason.unified = "error").
- usage: `cache_creation_input_tokens`/`cache_read_input_tokens` from `message_start.message.usage` + `message_delta.usage` populate `finish.usage` correctly (cacheWrite = cache_creation, cacheRead = cache_read, noCache = input_tokens).
- redacted_thinking block → reasoning content with empty text + `providerOptions.zai.redactedData`.

**Step 2: Run — fails.**

**Step 3: Implement** the remaining branches: `error` (enqueue error, mark finish `error`), redacted_thinking (reasoning with metadata), and the usage accumulator (seed from `message_start`, overlay `message_delta.usage`). `flush` emits `finish`.

**Step 4: Run — PASS.**

**Step 5: Commit**

```bash
git add packages/llm/src/provider/zai-anthropic/zai-anthropic-language-model.ts packages/llm/src/provider/zai-anthropic/__tests__/do-stream.test.ts
git commit -m "feat(llm): zai-anthropic doStream error/finish/usage/redacted_thinking"
```

---

### Task 12: `ZAI_THINKING_BUDGETS` + `buildProviderOptions` zai-anthropic branch

**Files:**

- Create: `packages/llm/src/provider/zai-anthropic/thinking-budgets.ts`
- Modify: `packages/llm/src/provider/transform.ts` (add branch)
- Create: `packages/llm/src/provider/__tests__/transform-zai.test.ts`

**Step 1: Failing test**

```ts
import { describe, expect, it } from "vitest";
import { buildProviderOptions } from "../transform.ts";
import type { Model } from "../../types.ts";

const zaiModel = (overrides: Partial<Model> = {}): Model => ({
  api: "ai-sdk",
  baseUrl: "https://api.z.ai/api/anthropic",
  contextWindow: 200000,
  cost: { cacheRead: 0.26, cacheWrite: 0, input: 1.4, output: 4.4 },
  id: "glm-5.2",
  input: ["text"],
  maxTokens: 64000,
  name: "GLM-5.2",
  npm: "@sakti-code/zai-anthropic",
  provider: "zai",
  reasoning: true,
  ...overrides,
});

describe("buildProviderOptions — zai-anthropic branch", () => {
  it("maps each ThinkingLevel to a thinking budget", () => {
    const high = buildProviderOptions({ level: "high", model: zaiModel() });
    expect(high).toEqual({ zai: { thinking: { type: "enabled", budget_tokens: 16000 } } });
    const xhigh = buildProviderOptions({ level: "xhigh", model: zaiModel() });
    expect(xhigh.zai.thinking).toEqual({ type: "enabled", budget_tokens: 32000 });
  });

  it("maps off to disabled", () => {
    const off = buildProviderOptions({ level: "off", model: zaiModel() });
    expect(off).toEqual({ zai: { thinking: { type: "disabled" } } });
  });

  it("returns {} for a non-reasoning zai model", () => {
    expect(buildProviderOptions({ level: "high", model: zaiModel({ reasoning: false }) })).toEqual(
      {},
    );
  });
});
```

**Step 2: Run — fails.**

**Step 3: Implement**

`packages/llm/src/provider/zai-anthropic/thinking-budgets.ts`:

```ts
import type { ThinkingLevel } from "../../types.ts";

export const ZAI_THINKING_BUDGETS: Record<ThinkingLevel, number> = {
  minimal: 2000,
  low: 8000,
  medium: 16000,
  high: 16000,
  xhigh: 32000,
};
```

In `packages/llm/src/provider/transform.ts`, at the top of `buildProviderOptions` (before the existing `if (!(model.compat && model.reasoning))` guard):

```ts
if (model.npm === "@sakti-code/zai-anthropic" && model.reasoning) {
  return level === "off"
    ? { zai: { thinking: { type: "disabled" } } }
    : { zai: { thinking: { type: "enabled", budget_tokens: ZAI_THINKING_BUDGETS[level] } } };
}
```

Add the import: `import { ZAI_THINKING_BUDGETS } from "./zai-anthropic/thinking-budgets.ts";` and `ModelThinkingLevel`/`ThinkingLevel` are already imported.

**Step 4: Run — PASS** (also rerun the existing transform tests to confirm no regression).

**Step 5: Commit**

```bash
git add packages/llm/src/provider/zai-anthropic/thinking-budgets.ts packages/llm/src/provider/transform.ts packages/llm/src/provider/__tests__/transform-zai.test.ts
git commit -m "feat(llm): buildProviderOptions zai-anthropic branch + thinking budgets"
```

---

### Task 13: `StreamRequest.providerOptions` passthrough

**Files:**

- Modify: `packages/llm/src/stream.ts` (`StreamRequest` + `streamWithModel` merge)
- Create: `packages/llm/src/__tests__/stream-provider-options.test.ts`

**Step 1: Failing test** — using `streamWithModel` with an injected fake runner, assert the caller's `providerOptions.zai.speed` reaches the runner merged with the auto-derived thinking.

```ts
import { describe, expect, it } from "vitest";
import { streamWithModel } from "../stream.ts";
import type { Model } from "../types.ts";
import type { LanguageModelV4 } from "@ai-sdk/provider";

const zaiModel: Model = {
  api: "ai-sdk",
  baseUrl: "https://api.z.ai/api/anthropic",
  contextWindow: 200000,
  cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
  id: "glm-5.2",
  input: ["text"],
  maxTokens: 64000,
  name: "GLM-5.2",
  npm: "@sakti-code/zai-anthropic",
  provider: "zai",
  reasoning: true,
};

describe("streamWithModel providerOptions passthrough", () => {
  it("merges caller speed/outputConfig with auto-derived thinking", async () => {
    let captured: Record<string, unknown> | undefined;
    const fakeRunner = ((opts: Record<string, unknown>) => {
      captured = opts.providerOptions as Record<string, unknown>;
      return {
        fullStream: (async function* () {})(),
        usage: Promise.resolve({ inputTokens: 0, outputTokens: 0, totalTokens: 0 }),
        finishReason: Promise.resolve("stop" as const),
        response: Promise.resolve({}),
      };
    }) as never;

    streamWithModel(
      {
        model: zaiModel,
        messages: [{ role: "user", content: "hi", timestamp: 0 }],
        thinkingLevel: "xhigh",
        providerOptions: { zai: { speed: "fast" } },
      },
      {} as LanguageModelV4,
      fakeRunner,
    );

    // trigger the lazy merge by reading captured (runner is sync-invoked)
    expect(captured?.zai).toMatchObject({
      thinking: { type: "enabled", budget_tokens: 32000 },
      speed: "fast",
    });
  });
});
```

**Step 2: Run — fails.**

**Step 3: Implement** — add `providerOptions?: Record<string, unknown>` to `StreamRequest`. In `streamWithModel`, after `reasoningOptions` is computed, deep-merge:

```ts
const callerOpts = req.providerOptions;
const providerOptions =
  callerOpts === undefined
    ? reasoningOptions
    : deepMergeProviderOptions(reasoningOptions, callerOpts);
```

where `deepMergeProviderOptions` merges `{ zai: { ...auto, ...caller.zai } }` style — auto-derived keys win for `thinking` (it is the authority), caller wins for everything else. Implement a small 2-level merge: for each top-level ns, `{...auto[ns], ...caller[ns]}` but force `thinking` back to the auto value. Keep it simple and tested.

**Step 4: Run — PASS.**

**Step 5: Commit**

```bash
git add packages/llm/src/stream.ts packages/llm/src/__tests__/stream-provider-options.test.ts
git commit -m "feat(llm): StreamRequest.providerOptions passthrough (speed/outputConfig)"
```

---

### Task 14: Catalog converter override + regenerate

**Files:**

- Modify: `packages/llm/src/catalog/convert.ts`
- Modify: `packages/llm/scripts/generate-models.ts` (`BUNDLED_NPM` set)
- Modify: `packages/llm/src/catalog/generated.ts` (regenerated)
- Create: `packages/llm/src/catalog/__tests__/convert-zai-override.test.ts`

**Step 1: Failing test**

```ts
import { describe, expect, it } from "vitest";
import { convertModelsDevModel } from "../convert.ts";
import type { ModelsDevModel, ModelsDevProvider } from "../types.ts";

const zaiProvider: ModelsDevProvider = {
  id: "zai",
  name: "Z.ai",
  npm: "@ai-sdk/openai-compatible",
  api: "https://api.z.ai/api/paas/v4",
  models: {},
};

const glmModel: ModelsDevModel = {
  id: "glm-5.2",
  name: "GLM-5.2",
  tool_call: true,
  reasoning: true,
  modalities: { input: ["text"], output: ["text"] },
  limit: { context: 200000, output: 64000 },
  cost: { input: 1.4, output: 4.4, cache_read: 0.26 },
};

describe("convertModelsDevModel zai override", () => {
  it("repoints zai to @sakti-code/zai-anthropic + anthropic baseURL, drops compat", () => {
    const converted = convertModelsDevModel({ ...zaiProvider, id: "zai" }, glmModel)!;
    expect(converted.npm).toBe("@sakti-code/zai-anthropic");
    expect(converted.baseUrl).toBe("https://api.z.ai/api/anthropic");
    expect(converted.compat).toBeUndefined();
    expect(converted.reasoning).toBe(true);
  });

  it("repoints zai-coding-plan to the coding anthropic baseURL", () => {
    const converted = convertModelsDevModel({ ...zaiProvider, id: "zai-coding-plan" }, glmModel)!;
    expect(converted.npm).toBe("@sakti-code/zai-anthropic");
    expect(converted.baseUrl).toBe("https://api.z.ai/api/coding/anthropic");
  });

  it("leaves a non-zai provider on @ai-sdk/openai-compatible", () => {
    const converted = convertModelsDevModel({ ...zaiProvider, id: "302ai" }, glmModel)!;
    expect(converted.npm).toBe("@ai-sdk/openai-compatible");
  });
});
```

**Step 2: Run — fails.**

**Step 3: Implement** — in `convert.ts`, after the `converted: Model` object is built (before `return converted;`), apply the override:

```ts
const overridden = applyZaiAnthropicOverride(provider.id, converted);
return overridden;

function applyZaiAnthropicOverride(providerId: string, model: Model): Model {
  if (providerId !== "zai" && providerId !== "zai-coding-plan") {
    return model;
  }
  const baseURL =
    providerId === "zai-coding-plan"
      ? "https://api.z.ai/api/coding/anthropic"
      : "https://api.z.ai/api/anthropic";
  // Drop compat (openai-compat thinkingFormat) — our model reads providerOptions.zai.
  const { compat: _compat, ...rest } = model;
  return { ...rest, npm: "@sakti-code/zai-anthropic", baseUrl: baseURL };
}
```

In `generate-models.ts`, add `"@sakti-code/zai-anthropic"` to the `BUNDLED_NPM` set (after the `@ai-sdk/xai` line).

**Step 4: Run the converter test — PASS.**

**Step 5: Regenerate the catalog** (needs network):

```bash
cd packages/llm && pnpm run generate-models
```

Verify `src/catalog/generated.ts` now shows `zai` models with `"npm":"@sakti-code/zai-anthropic"` and `"baseUrl":"https://api.z.ai/api/anthropic"`. Spot-check via:

```bash
rg '"provider":"zai"' packages/llm/src/catalog/generated.ts | head -3
```

**Step 6: Commit**

```bash
git add packages/llm/src/catalog/convert.ts packages/llm/scripts/generate-models.ts packages/llm/src/catalog/generated.ts packages/llm/src/catalog/__tests__/convert-zai-override.test.ts
git commit -m "feat(llm): repoint zai/zai-coding-plan catalog to zai-anthropic provider"
```

---

### Task 15: Full verification + formatting

**Step 1: Typecheck**

```bash
cd packages/llm && pnpm run typecheck
```

Expected: 0 errors. Fix any `exactOptionalPropertyTypes` violations with conditional spread.

**Step 2: Tests**

```bash
cd packages/llm && pnpm run test
```

Expected: all green. Pay attention to the existing transform tests (Task 12 must not regress them) and the existing stream tests (Task 13 must not regress them).

**Step 3: Format + lint**

```bash
pnpm run fix
```

**Step 4: Workspace-wide sanity**

```bash
pnpm run typecheck
```

Expected: 0 errors across packages (the catalog change is types-stable; `Model.npm` is `string`, so the new value is fine).

**Step 5: Final commit** if `pnpm run fix` changed anything:

```bash
git add -A
git commit -m "chore(llm): format + typecheck zai-anthropic provider"
```

---

## Out of scope (explicitly deferred)

- OAuth subscription flow for Z.ai coding-plan (v1 uses the API-key path via `auth.json`).
- mcp servers, container/skills, code-execution tools, web_search/web_fetch server tools, advisor, tool_search, fallbacks, citations, compaction context-management, files API.
- A `thinkingLevelMap` on the zai catalog rows for UI level-greyout (functional path doesn't need it).
- Live network smoke test against Z.ai (add as a manual checklist item once an API key is available; not part of the automated suite).

## Manual smoke checklist (after implementation, before merge)

- [ ] With a real `auth.json` Z.ai key, run a one-turn stream through the agent against `glm-5.2` and confirm reasoning + text stream correctly.
- [ ] Confirm `cache_creation_input_tokens` > 0 on the second turn (cache primed).
- [ ] Confirm `temperature` is absent from the request body when thinking is on (check server logs / network).
- [ ] Confirm `anthropic-beta: prompt-caching-2024-07-31` is the only beta header sent.
