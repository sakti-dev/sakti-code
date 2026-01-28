import type { JSONSchema7 } from "@ai-sdk/provider";
import { z } from "zod";

// Content part types for multimodal messages
export type ZaiContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | { type: "video_url"; video_url: { url: string } }
  | { type: "file_url"; file_url: { url: string } };

// Zai content part schema
export const zaiContentPartSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("text"),
    text: z.string(),
  }),
  z.object({
    type: z.literal("image_url"),
    image_url: z.object({
      url: z.string(),
    }),
  }),
  z.object({
    type: z.literal("video_url"),
    video_url: z.object({
      url: z.string(),
    }),
  }),
  z.object({
    type: z.literal("file_url"),
    file_url: z.object({
      url: z.string(),
    }),
  }),
]);

// Tool call structure
export interface ZaiToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

// Zai tool call schema
export const zaiToolCallSchema: z.ZodType<ZaiToolCall> = z.object({
  id: z.string(),
  type: z.literal("function"),
  function: z.object({
    name: z.string(),
    arguments: z.string(),
  }),
});

// Message role types
export type ZaiMessageRole = "system" | "user" | "assistant" | "tool";

// Chat message structure
export interface ZaiChatMessage {
  role: ZaiMessageRole;
  content?: string | ZaiContentPart[];
  tool_calls?: ZaiToolCall[];
  tool_call_id?: string;
  reasoning_content?: string;
}

// Zai chat message schema
export const zaiChatMessageSchema: z.ZodType<ZaiChatMessage> = z.object({
  role: z.enum(["system", "user", "assistant", "tool"]),
  content: z.union([z.string(), z.array(zaiContentPartSchema)]).optional(),
  tool_calls: z.array(zaiToolCallSchema).optional(),
  tool_call_id: z.string().optional(),
  reasoning_content: z.string().optional(),
});

// Tool types
export interface ZaiFunctionTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: JSONSchema7;
  };
}

export interface ZaiWebSearchTool {
  type: "web_search";
  web_search: {
    enable: boolean;
    search_engine?: "search_pro_jina";
    search_query?: string;
    search_result?: boolean;
    require_search?: boolean;
    search_domain_filter?: string;
    search_recency_filter?: "oneDay" | "oneWeek" | "oneMonth" | "oneYear" | "noLimit";
    content_size?: "medium" | "high";
    result_sequence?: "before" | "after";
  };
}

export interface ZaiRetrievalTool {
  type: "retrieval";
  retrieval: {
    knowledge_id: string;
    prompt_template?: string;
  };
}

export type ZaiTool = ZaiFunctionTool | ZaiWebSearchTool | ZaiRetrievalTool;

// Zai tool schema
export const zaiToolSchema: z.ZodType<ZaiTool> = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("function"),
    function: z.object({
      name: z.string(),
      description: z.string(),
      parameters: z.custom<JSONSchema7>(),
    }),
  }),
  z.object({
    type: z.literal("web_search"),
    web_search: z.object({
      enable: z.boolean(),
      search_engine: z.literal("search_pro_jina").optional(),
      search_query: z.string().optional(),
      search_result: z.boolean().optional(),
      require_search: z.boolean().optional(),
      search_domain_filter: z.string().optional(),
      search_recency_filter: z
        .enum(["oneDay", "oneWeek", "oneMonth", "oneYear", "noLimit"])
        .optional(),
      content_size: z.enum(["medium", "high"]).optional(),
      result_sequence: z.enum(["before", "after"]).optional(),
    }),
  }),
  z.object({
    type: z.literal("retrieval"),
    retrieval: z.object({
      knowledge_id: z.string(),
      prompt_template: z.string().optional(),
    }),
  }),
]);

// Tool choice types
export type ZaiToolChoice =
  | "auto"
  | "none"
  | "required"
  | { type: "function"; function: { name: string } };

// Thinking configuration
export interface ZaiThinkingConfig {
  type: "enabled" | "disabled";
  clear_thinking?: boolean;
}

// Response format types
export type ZaiResponseFormat =
  | { type: "text" }
  | { type: "json_object" }
  | Record<string, unknown>;

// Sensitive word check configuration
export interface ZaiSensitiveWordCheck {
  type?: string;
  status?: string;
}

// Chat request structure
export interface ZaiChatRequest {
  model: string;
  messages: ZaiChatMessage[];
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  seed?: number;
  stop?: string[];
  stream?: boolean;
  thinking?: ZaiThinkingConfig;
  tool_stream?: boolean;
  tools?: ZaiTool[];
  tool_choice?: ZaiToolChoice;
  response_format?: ZaiResponseFormat;
  user_id?: string;
  do_sample?: boolean;
  request_id?: string;
  meta?: Record<string, string>;
  sensitive_word_check?: ZaiSensitiveWordCheck;
  watermark_enabled?: boolean;
  extra?: Record<string, unknown>;
}

// Zai chat request schema
export const zaiChatRequestSchema: z.ZodType<ZaiChatRequest> = z.object({
  model: z.string(),
  messages: z.array(zaiChatMessageSchema),
  temperature: z.number().optional(),
  top_p: z.number().optional(),
  max_tokens: z.number().optional(),
  seed: z.number().optional(),
  stop: z.array(z.string()).optional(),
  stream: z.boolean().optional(),
  thinking: z
    .object({
      type: z.enum(["enabled", "disabled"]),
      clear_thinking: z.boolean().optional(),
    })
    .optional(),
  tool_stream: z.boolean().optional(),
  tools: z.array(zaiToolSchema).optional(),
  tool_choice: z
    .union([
      z.literal("auto"),
      z.literal("none"),
      z.literal("required"),
      z.object({
        type: z.literal("function"),
        function: z.object({
          name: z.string(),
        }),
      }),
    ])
    .optional(),
  response_format: z
    .union([
      z.object({
        type: z.literal("text"),
      }),
      z.object({
        type: z.literal("json_object"),
      }),
      z.object({}).passthrough().catch({}), // Record<string, unknown>
    ])
    .optional(),
  user_id: z.string().optional(),
  do_sample: z.boolean().optional(),
  request_id: z.string().optional(),
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

// Finish reason types
export type ZaiFinishReason = "stop" | "tool_calls" | "length" | "sensitive" | "network_error";

// Usage details
export interface ZaiUsagePromptDetails {
  cached_tokens: number;
}

export interface ZaiUsageCompletionDetails {
  reasoning_tokens: number;
}

export interface ZaiUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  prompt_tokens_details?: ZaiUsagePromptDetails;
  completion_tokens_details?: ZaiUsageCompletionDetails;
}

// Web search result
export interface ZaiWebSearchResult {
  title?: string | null;
  content?: string | null;
  link?: string | null;
  media?: string | null;
  icon?: string | null;
  refer?: string | null;
  publish_date?: string | null;
}

// Chat message in response
export interface ZaiResponseMessage {
  role: "assistant";
  content?: string;
  reasoning_content?: string;
  tool_calls?: ZaiToolCall[];
}

// Choice in response
export interface ZaiChoice {
  index: number;
  message: ZaiResponseMessage;
  finish_reason: ZaiFinishReason;
}

// Chat response structure
export interface ZaiChatResponse {
  id: string;
  created: number;
  model: string;
  choices: ZaiChoice[];
  usage: ZaiUsage;
  web_search?: ZaiWebSearchResult[] | null;
}

// Zai chat response schema
export const zaiChatResponseSchema: z.ZodType<ZaiChatResponse> = z.object({
  id: z.string(),
  created: z.number(),
  model: z.string(),
  choices: z.array(
    z.object({
      index: z.number(),
      message: z.object({
        role: z.literal("assistant"),
        content: z.string().optional(),
        reasoning_content: z.string().optional(),
        tool_calls: z.array(zaiToolCallSchema).optional(),
      }),
      finish_reason: z.enum(["stop", "tool_calls", "length", "sensitive", "network_error"]),
    })
  ),
  usage: z.object({
    prompt_tokens: z.number(),
    completion_tokens: z.number(),
    total_tokens: z.number(),
    prompt_tokens_details: z
      .object({
        cached_tokens: z.number(),
      })
      .optional(),
    completion_tokens_details: z
      .object({
        reasoning_tokens: z.number(),
      })
      .optional(),
  }),
  web_search: z
    .array(
      z.object({
        title: z.string().nullish(),
        content: z.string().nullish(),
        link: z.string().nullish(),
        media: z.string().nullish(),
        icon: z.string().nullish(),
        refer: z.string().nullish(),
        publish_date: z.string().nullish(),
      })
    )
    .nullish(),
});

// Delta in streaming chunk
export interface ZaiDelta {
  role?: "assistant";
  content?: string;
  reasoning_content?: string;
  tool_calls?: Array<{
    index: number;
    id?: string;
    type?: "function";
    function?: {
      name?: string;
      arguments?: string;
    };
  }>;
}

// Choice in streaming chunk
export interface ZaiStreamChoice {
  index: number;
  delta: ZaiDelta;
  finish_reason?: ZaiFinishReason;
}

// Chat chunk structure for streaming
export interface ZaiChatChunk {
  id: string;
  created?: number;
  model?: string;
  choices: ZaiStreamChoice[];
  usage?: ZaiUsage;
}

// Zai chat chunk schema
export const zaiChatChunkSchema: z.ZodType<ZaiChatChunk> = z.object({
  id: z.string(),
  created: z.number().optional(),
  model: z.string().optional(),
  choices: z.array(
    z.object({
      index: z.number(),
      delta: z.object({
        role: z.literal("assistant").optional(),
        content: z.string().optional(),
        reasoning_content: z.string().optional(),
        tool_calls: z
          .array(
            z.object({
              index: z.number(),
              id: z.string().optional(),
              type: z.literal("function").optional(),
              function: z
                .object({
                  name: z.string().optional(),
                  arguments: z.string().optional(),
                })
                .optional(),
            })
          )
          .optional(),
      }),
      finish_reason: z
        .enum(["stop", "tool_calls", "length", "sensitive", "network_error"])
        .optional(),
    })
  ),
  usage: z
    .object({
      prompt_tokens: z.number(),
      completion_tokens: z.number(),
      total_tokens: z.number(),
      prompt_tokens_details: z
        .object({
          cached_tokens: z.number(),
        })
        .optional(),
      completion_tokens_details: z
        .object({
          reasoning_tokens: z.number(),
        })
        .optional(),
    })
    .optional(),
});
