import type { ModelMessage } from "ai";
import type {
  AssistantMessage,
  ImageContent,
  Message,
  TextContent,
  ToolResultMessage,
  UserMessage,
} from "./types.ts";
/**
 * # Message conversion
 *
 * Converts our message contract ({@link Message}[]) to @ai-sdk's
 * {@link ModelMessage}[] for `streamText`. This is the bridge between the
 * shape the agent/db/UI use (kept stable — ~20 consumers) and the shape
 * `@ai-sdk/*` factories expect.
 *
 * ## Type mapping
 *
 * | Our type          | @ai-sdk type         | Notes                                  |
 * |-------------------|----------------------|----------------------------------------|
 * | `UserMessage`     | `UserModelMessage`   | string content passes through          |
 * | `AssistantMessage`| `AssistantModelMessage`| content array mapped per-part         |
 * | `ToolResultMessage`| `ToolModelMessage`  | one ToolResultPart per message         |
 * | `TextContent`     | `TextPart`           | verbatim                               |
 * | `ThinkingContent` | `ReasoningPart`      | `thinking` → `text`                    |
 * | `ImageContent`    | `ImagePart`          | `data` → `image`, `mimeType` → `mediaType` |
 * | `ToolCall`        | `ToolCallPart`       | `arguments` → `input`, `id` → `toolCallId` |
 *
 * ## Deferred
 *
 - `thinkingSignature` (OpenAI/Anthropic reasoning signatures) and
 - `thoughtSignature` (Google) are not yet forwarded into `providerOptions`.
 - Image tool results are flattened to text (rare in coding-agent use).
 */

/**
 * Convert our message history to @ai-sdk's `ModelMessage[]`.
 *
 * The system prompt is NOT included here — `streamText` takes it as a
 * separate `system` parameter.
 */
export function toModelMessages(messages: Message[]): ModelMessage[] {
  return messages.map(convertMessage);
}

function convertMessage(message: Message): ModelMessage {
  switch (message.role) {
    case "user":
      return convertUserMessage(message);
    case "assistant":
      return convertAssistantMessage(message);
    case "toolResult":
      return convertToolResultMessage(message);
  }
}

// ─── UserMessage → UserModelMessage ───────────────────────────────────────────

function convertUserMessage(message: UserMessage): ModelMessage {
  if (typeof message.content === "string") {
    return { content: message.content, role: "user" };
  }
  return {
    content: message.content.map(convertUserContent),
    role: "user",
  };
}

function convertUserContent(part: TextContent | ImageContent) {
  switch (part.type) {
    case "text":
      return { text: part.text, type: "text" as const };
    case "image":
      return {
        image: part.data,
        mediaType: part.mimeType,
        type: "image" as const,
      };
  }
}

// ─── AssistantMessage → AssistantModelMessage ────────────────────────────────

function convertAssistantMessage(message: AssistantMessage): ModelMessage {
  return {
    content: message.content.map(convertAssistantContent),
    role: "assistant",
  };
}

function convertAssistantContent(part: AssistantMessage["content"][number]) {
  switch (part.type) {
    case "text":
      return { text: part.text, type: "text" as const };
    case "thinking":
      // Forward the provider signature via providerMetadata so Anthropic's
      // extended-thinking multi-turn continuity works (@ai-sdk reads
      // providerMetadata.anthropic.signature on reasoning parts).
      return {
        text: part.thinking,
        type: "reasoning" as const,
        ...(part.thinkingSignature
          ? {
              providerMetadata: {
                anthropic: { signature: part.thinkingSignature },
              },
            }
          : {}),
      };
    case "toolCall":
      return {
        input: part.arguments,
        toolCallId: part.id,
        toolName: part.name,
        type: "tool-call" as const,
      };
  }
}

// ─── ToolResultMessage → ToolModelMessage ─────────────────────────────────────

function convertToolResultMessage(message: ToolResultMessage): ModelMessage {
  const output = extractToolOutput(message.content);
  return {
    content: [
      {
        output,
        toolCallId: message.toolCallId,
        toolName: message.toolName,
        type: "tool-result" as const,
        ...(message.isError ? { isError: true } : {}),
      },
    ],
    role: "tool",
  };
}

/**
 * Extract the tool result output from content parts.
 *
 * Text content → `{ type: "text", value: concatenatedText }` (the @ai-sdk
 * ToolResultOutput shape). Image-only content → empty text value (image tool
 * results are rare in coding-agent use; a structured image output can be
 * added when a consumer needs it).
 */
function extractToolOutput(content: (TextContent | ImageContent)[]): {
  type: "text";
  value: string;
} {
  const value = content
    .filter((part): part is TextContent => part.type === "text")
    .map((part) => part.text)
    .join("\n");
  return { type: "text", value };
}
