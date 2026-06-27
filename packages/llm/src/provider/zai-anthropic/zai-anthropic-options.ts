import { zodSchema } from "@ai-sdk/provider-utils";
import { z } from "zod/v4";

/**
 * # providerOptions.zai schema
 *
 * The Z.ai Anthropic provider's per-call options. Resolved via
 * `parseProviderOptions({ provider: "zai", schema: zaiAnthropicOptions })`.
 *
 * The model also accepts a handful of these fields directly through the V4
 * `reasoning` field (mapped by `buildProviderOptions` in `provider/transform.ts`);
 * when both are set, the explicit `providerOptions.zai.thinking` wins (the
 * runtime path is the authority for thinking budgets).
 *
 * Field mapping (zai providerOptions → Anthropic Messages wire):
 * - `thinking`              → `thinking` (top-level request field)
 * - `speed`                 → `speed` (Z.ai-native, top-level)
 * - `outputConfig.effort`   → `output_config.effort`
 * - `outputConfig.taskBudget` → `output_config.task_budget`
 * - `outputConfig.format`   → `output_config.format`
 * - `cacheControl`          → drives where `cache_control:{type:"ephemeral"}` markers
 *   are placed (system prefix, last tool definition).
 * - `sendReasoning`         → whether signature-bearing thinking blocks are
 *   replayed in assistant turns for multi-turn continuity (Anthropic protocol).
 */

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
          total: z.number().int().min(20_000),
          remaining: z.number().int().min(0).optional(),
        })
        .optional(),
      format: z
        .object({
          type: z.literal("json_schema"),
          schema: z.record(z.string(), z.unknown()),
        })
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
