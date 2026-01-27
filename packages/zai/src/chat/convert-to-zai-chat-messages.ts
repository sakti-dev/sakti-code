import type { LanguageModelV3Prompt, SharedV3Warning } from "@ai-sdk/provider";
import { convertUint8ArrayToBase64 } from "@ai-sdk/provider-utils";
import type { ZaiChatMessage, ZaiContentPart, ZaiToolCall } from "./zai-chat-api";

export function convertToZaiChatMessages({ prompt }: { prompt: LanguageModelV3Prompt }): {
  messages: ZaiChatMessage[];
  warnings: SharedV3Warning[];
} {
  const messages: ZaiChatMessage[] = [];
  const warnings: SharedV3Warning[] = [];

  for (const { role, content } of prompt) {
    switch (role) {
      case "system": {
        messages.push({
          role: "system",
          content,
        });
        break;
      }
      case "user": {
        if (content.length === 1 && content[0].type === "text") {
          messages.push({ role: "user", content: content[0].text });
          break;
        }

        // Handle multimodal content
        const parts: ZaiContentPart[] = [];
        for (const part of content) {
          switch (part.type) {
            case "text":
              parts.push({ type: "text", text: part.text });
              break;
            case "file": {
              if (part.mediaType.startsWith("image/")) {
                const mediaType = part.mediaType === "image/*" ? "image/jpeg" : part.mediaType;
                let url: string;
                if (part.data instanceof URL) {
                  url = part.data.toString();
                } else if (typeof part.data === "string") {
                  // part.data is already a base64 string
                  url = `data:${mediaType};base64,${part.data}`;
                } else {
                  // part.data is Uint8Array or ArrayBuffer
                  url = `data:${mediaType};base64,${convertToBase64(part.data)}`;
                }

                parts.push({
                  type: "image_url",
                  image_url: { url },
                });
              } else {
                warnings.push({
                  type: "unsupported",
                  feature: `file mediaType: ${part.mediaType}`,
                });
              }
              break;
            }
          }
        }
        messages.push({ role: "user", content: parts });
        break;
      }
      case "assistant": {
        const assistantMessage: ZaiChatMessage = { role: "assistant" };

        let text = "";
        let reasoning = "";
        const toolCalls: ZaiToolCall[] = [];

        for (const part of content) {
          switch (part.type) {
            case "text": {
              text += part.text;
              break;
            }
            case "reasoning": {
              reasoning += part.text;
              break;
            }
            case "tool-call": {
              toolCalls.push({
                id: part.toolCallId,
                type: "function",
                function: {
                  name: part.toolName,
                  arguments: JSON.stringify(part.input),
                },
              });
              break;
            }
          }
        }

        if (text.length > 0) {
          assistantMessage.content = text;
        }
        if (reasoning.length > 0) {
          assistantMessage.reasoning_content = reasoning;
        }
        if (toolCalls.length > 0) {
          assistantMessage.tool_calls = toolCalls;
        }

        messages.push(assistantMessage);
        break;
      }
      case "tool": {
        for (const toolResponse of content) {
          if (toolResponse.type === "tool-approval-response") {
            continue;
          }
          const output = toolResponse.output;
          let contentValue: string;
          switch (output.type) {
            case "text":
            case "error-text":
              contentValue = output.value;
              break;
            case "execution-denied":
              contentValue = output.reason ?? "Tool execution denied.";
              break;
            case "json":
            case "error-json":
            case "content":
              contentValue = JSON.stringify(output.value);
              break;
          }

          messages.push({
            role: "tool",
            tool_call_id: toolResponse.toolCallId,
            content: contentValue,
          });
        }
        break;
      }
    }
  }

  return { messages, warnings };
}

function convertToBase64(data: ArrayBuffer | Uint8Array): string {
  const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
  return convertUint8ArrayToBase64(bytes);
}
