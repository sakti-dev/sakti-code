import type { LanguageModelV4Content, LanguageModelV4GenerateResult } from "@ai-sdk/provider";
import type { z } from "zod/v4";
import { convertZaiUsage } from "./convert-zai-usage.ts";
import { mapZaiStopReason } from "./map-zai-stop-reason.ts";
import type { ZaiContentBlock, zaiResponseZod } from "./zai-api.ts";

/**
 * # mapZaiResponse — non-stream response → V4 `LanguageModelV4GenerateResult`
 *
 * Ported from `@ai-sdk/anthropic`'s `mapAnthropicResponse` (inside
 * `anthropic-language-model.ts:850-960`), stripped to v1 content variants
 * (`text` / `thinking` / `redacted_thinking` / `tool_use`).
 *
 * Mapping rules:
 * - `text` → `{ type:"text", text }`
 * - `thinking` → `{ type:"reasoning", text:thinking, providerMetadata:{ zai:{ signature } } }`
 * - `redacted_thinking` → `{ type:"reasoning", text:"", providerMetadata:{ zai:{ redactedData } } }`
 * - `tool_use` → `{ type:"tool-call", toolCallId:id, toolName:name, input:JSON.stringify(input) }`
 *
 * Tool-input is stringified via the SDK convention (`LanguageModelV4ToolCall.input: string`).
 */
export function mapZaiResponse({
  response,
}: {
  response: z.infer<typeof zaiResponseZod>;
}): LanguageModelV4GenerateResult {
  const content: LanguageModelV4Content[] = response.content.map(
    (block): LanguageModelV4Content => mapContentBlock(block),
  );

  return {
    content,
    finishReason: {
      unified: mapZaiStopReason({ finishReason: response.stop_reason }),
      raw: response.stop_reason ?? undefined,
    },
    usage: convertZaiUsage({ usage: response.usage }),
    warnings: [],
    ...(response.id !== undefined && response.id !== null
      ? {
          response: {
            id: response.id,
            ...(response.model !== undefined && response.model !== null
              ? { modelId: response.model }
              : {}),
            timestamp: new Date(),
          },
        }
      : {}),
  };
}

function mapContentBlock(block: ZaiContentBlock): LanguageModelV4Content {
  switch (block.type) {
    case "text":
      return { type: "text", text: block.text };
    case "thinking":
      return {
        type: "reasoning",
        text: block.thinking,
        providerMetadata: { zai: { signature: block.signature } },
      };
    case "redacted_thinking":
      return {
        type: "reasoning",
        text: "",
        providerMetadata: { zai: { redactedData: block.data } },
      };
    case "tool_use":
      return {
        type: "tool-call",
        toolCallId: block.id,
        toolName: block.name,
        input: JSON.stringify(block.input),
      };
  }
}
