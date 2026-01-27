import { zodSchema } from "@ai-sdk/provider-utils";
import { z } from "zod";

export type ZaiChatModelId =
  | "glm-4.7"
  | "glm-4.7-flash"
  | "glm-4.7-flashx"
  | "glm-4.6"
  | "glm-4.6v"
  | "glm-4.6v-flash"
  | "glm-4.6v-flashx"
  | "glm-4.5"
  | "glm-4.5-air"
  | "glm-4.5-x"
  | "glm-4.5-airx"
  | "glm-4.5-flash"
  | "glm-4.5v"
  | "autoglm-phone-multilingual"
  | (string & {});

const zaiChatLanguageModelOptionsSchema = z.object({
  /**
   * Thinking mode configuration.
   * - 'enabled': Model will think before responding (default for GLM-4.7)
   * - 'disabled': No thinking
   */
  thinking: z
    .object({
      type: z.enum(["enabled", "disabled"]),
      clear_thinking: z.boolean().optional(),
    })
    .optional(),

  /**
   * Enable tool streaming.
   */
  tool_stream: z.boolean().optional(),

  /**
   * Web search configuration.
   */
  web_search: z
    .object({
      enable: z.boolean(),
      search_query: z.string().optional(),
      search_result: z.boolean().optional(),
      require_search: z.boolean().optional(),
      search_domain_filter: z.string().optional(),
      search_recency_filter: z
        .enum(["oneDay", "oneWeek", "oneMonth", "oneYear", "noLimit"])
        .optional(),
      content_size: z.enum(["medium", "high"]).optional(),
      result_sequence: z.enum(["before", "after"]).optional(),
    })
    .optional(),

  /**
   * Retrieval tool configuration.
   */
  retrieval: z
    .object({
      knowledge_id: z.string(),
      prompt_template: z.string().optional(),
    })
    .optional(),

  /**
   * Pass-through request fields supported by Z.ai.
   */
  request_id: z.string().optional(),
  user_id: z.string().optional(),
  seed: z.number().int().optional(),
  do_sample: z.boolean().optional(),
  meta: z.record(z.string(), z.string()).optional(),
  sensitive_word_check: z
    .object({
      type: z.string().optional(),
      status: z.string().optional(),
    })
    .optional(),
  watermark_enabled: z.boolean().optional(),
  extra: z.record(z.string(), z.unknown()).optional(),
});

export type ZaiChatLanguageModelOptions = z.infer<typeof zaiChatLanguageModelOptionsSchema>;

export const zaiChatLanguageModelOptions = zodSchema(zaiChatLanguageModelOptionsSchema);
