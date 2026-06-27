import { lazySchema, zodSchema } from "@ai-sdk/provider-utils";
import { z } from "zod/v4";

/**
 * # Zai Anthropic Messages wire schemas — minimal subset
 *
 * Ported from `@ai-sdk/anthropic`'s `anthropic-api.ts`, keeping only the
 * content-block + delta + message-level event variants Z.ai surfaces. **Out
 * of scope** (and intentionally rejected by these schemas): mcp/container/
 * code-exec/web/advisor/tool-search/fallback/compaction/citations.
 *
 * The lazy form (`lazySchema(() => zodSchema(...))`) matches the reference's
 * shape and avoids loading zod until first parse.
 */

const cacheControlSchema = z.object({
  type: z.literal("ephemeral"),
  ttl: z.union([z.literal("5m"), z.literal("1h")]).optional(),
});

const contentBlockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({
    type: z.literal("thinking"),
    thinking: z.string(),
    signature: z.string(),
  }),
  z.object({ type: z.literal("redacted_thinking"), data: z.string() }),
  z.object({
    type: z.literal("tool_use"),
    id: z.string(),
    name: z.string(),
    input: z.unknown(),
  }),
]);

const usageSchema = z.object({
  input_tokens: z.number(),
  output_tokens: z.number(),
  cache_creation_input_tokens: z.number().nullish(),
  cache_read_input_tokens: z.number().nullish(),
});

const responseZodSchema = z.object({
  id: z.string().nullish(),
  model: z.string().nullish(),
  stop_reason: z.string().nullish(),
  stop_sequence: z.string().nullish(),
  content: z.array(contentBlockSchema),
  usage: usageSchema,
});

const chunkZodSchema = z.discriminatedUnion("type", [
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
      z.object({
        type: z.literal("signature_delta"),
        signature: z.string(),
      }),
      z.object({
        type: z.literal("input_json_delta"),
        partial_json: z.string(),
      }),
    ]),
  }),
  z.object({ type: z.literal("content_block_stop"), index: z.number() }),
  z.object({
    type: z.literal("message_delta"),
    delta: z.object({
      stop_reason: z.string().nullish(),
      stop_sequence: z.string().nullish(),
    }),
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
]);

const errorZodSchema = z.object({
  type: z.literal("error"),
  error: z.object({ type: z.string(), message: z.string() }),
});

export const zaiResponseSchema = lazySchema(() => zodSchema(responseZodSchema));
export const zaiChunkSchema = lazySchema(() => zodSchema(chunkZodSchema));
export const zaiErrorDataSchema = lazySchema(() => zodSchema(errorZodSchema));

/**
 * Raw zod schemas — exported for tests (which need `.parse()`) and for any
 * internal call site that prefers the underlying zod type inference over the
 * wrapped `Schema<T>` shape.
 */
export const zaiResponseZod = responseZodSchema;
export const zaiChunkZod = chunkZodSchema;

// ─── hand-written concrete types (clearer than z.infer over a LazySchema) ────

export interface ZaiCacheControl {
  ttl?: "5m" | "1h";
  type: "ephemeral";
}

export type ZaiContentBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string; signature: string }
  | { type: "redacted_thinking"; data: string }
  | { type: "tool_use"; id: string; name: string; input: unknown };

export interface ZaiUsage {
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  input_tokens: number;
  output_tokens: number;
}

export interface ZaiResponse {
  content: ZaiContentBlock[];
  id?: string | null;
  model?: string | null;
  stop_reason?: string | null;
  stop_sequence?: string | null;
  usage: ZaiUsage;
}

export { cacheControlSchema };
