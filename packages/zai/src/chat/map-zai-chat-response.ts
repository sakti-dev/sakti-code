import type { LanguageModelV3GenerateResult, SharedV3Warning } from "@ai-sdk/provider";
import { generateId } from "@ai-sdk/provider-utils";
import type { ZaiChatResponse } from "./zai-chat-api";

export function mapZaiChatResponse({
  response,
  warnings,
}: {
  response: ZaiChatResponse;
  warnings: SharedV3Warning[];
}): LanguageModelV3GenerateResult {
  const choice = response.choices[0];
  const content: LanguageModelV3GenerateResult["content"] = [];

  // Add reasoning content if present
  if (choice.message.reasoning_content) {
    content.push({
      type: "reasoning",
      text: choice.message.reasoning_content,
    });
  }

  // Add text content
  if (choice.message.content) {
    content.push({
      type: "text",
      text: choice.message.content,
    });
  }

  // Add tool calls
  for (const toolCall of choice.message.tool_calls ?? []) {
    content.push({
      type: "tool-call",
      toolCallId: toolCall.id,
      toolName: toolCall.function.name,
      input: toolCall.function.arguments,
    });
  }

  // Add web search results as sources
  for (const searchResult of response.web_search ?? []) {
    content.push({
      type: "source",
      sourceType: "url",
      id: generateId(),
      url: searchResult.link,
      title: searchResult.title,
    });
  }

  return {
    content,
    finishReason: {
      unified: mapZaiFinishReason(choice.finish_reason),
      raw: choice.finish_reason,
    },
    usage: convertZaiChatUsage(response.usage),
    warnings,
  };
}

function convertZaiChatUsage(
  usage: ZaiChatResponse["usage"] | undefined
): LanguageModelV3GenerateResult["usage"] {
  if (usage == null) {
    return {
      inputTokens: {
        total: undefined,
        noCache: undefined,
        cacheRead: undefined,
        cacheWrite: undefined,
      },
      outputTokens: {
        total: undefined,
        text: undefined,
        reasoning: undefined,
      },
      raw: undefined,
    };
  }

  const promptTokens = usage.prompt_tokens ?? 0;
  const completionTokens = usage.completion_tokens ?? 0;
  const cachedTokens = usage.prompt_tokens_details?.cached_tokens ?? 0;
  const reasoningTokens = usage.completion_tokens_details?.reasoning_tokens ?? 0;

  return {
    inputTokens: {
      total: promptTokens,
      noCache: promptTokens - cachedTokens,
      cacheRead: cachedTokens > 0 ? cachedTokens : undefined,
      cacheWrite: undefined,
    },
    outputTokens: {
      total: completionTokens,
      text: completionTokens - reasoningTokens,
      reasoning: reasoningTokens > 0 ? reasoningTokens : undefined,
    },
    raw: usage as unknown as LanguageModelV3GenerateResult["usage"]["raw"],
  };
}

function mapZaiFinishReason(
  finishReason: string
): LanguageModelV3GenerateResult["finishReason"]["unified"] {
  switch (finishReason) {
    case "stop":
      return "stop";
    case "length":
      return "length";
    case "tool_calls":
      return "tool-calls";
    case "sensitive":
      return "content-filter";
    case "network_error":
      return "error";
    default:
      return "other";
  }
}
