/**
 * Conversion utilities for TanStack AI → AI SDK message/tool formats
 */

import type {
  LanguageModelV1FilePart,
  LanguageModelV1FunctionTool,
  LanguageModelV1ImagePart,
  LanguageModelV1Message,
  LanguageModelV1TextPart,
  LanguageModelV1ToolCallPart,
} from "@ai-sdk/provider";
import type { ContentPart, ModelMessage, Tool } from "@tanstack/ai";

/**
 * Convert TanStack AI messages to AI SDK CoreMessage format
 *
 * @param messages - TanStack ModelMessage array
 * @returns AI SDK CoreMessage array
 */
export function convertToAISDKMessages(messages: ModelMessage[]): LanguageModelV1Message[] {
  const result: LanguageModelV1Message[] = [];

  for (const message of messages) {
    switch (message.role) {
      case "user": {
        result.push(convertUserMessage(message));
        break;
      }
      case "assistant": {
        result.push(convertAssistantMessage(message));
        break;
      }
      case "tool": {
        result.push(convertToolMessage(message));
        break;
      }
    }
  }

  return result;
}

/**
 * Convert a user message to AI SDK format
 */
function convertUserMessage(message: ModelMessage): LanguageModelV1Message {
  const content = message.content;

  // Handle null or empty content
  if (content === null || content === "") {
    return { role: "user", content: [{ type: "text", text: "" }] };
  }

  // Handle string content - wrap in text part array
  if (typeof content === "string") {
    return { role: "user", content: [{ type: "text", text: content }] };
  }

  // Handle multimodal content array
  if (Array.isArray(content)) {
    const parts = content.map(convertContentPart);
    return { role: "user", content: parts };
  }

  return { role: "user", content: [{ type: "text", text: "" }] };
}

/**
 * Convert a content part to AI SDK format
 */
function convertContentPart(
  part: ContentPart
): LanguageModelV1TextPart | LanguageModelV1ImagePart | LanguageModelV1FilePart {
  switch (part.type) {
    case "text":
      return { type: "text", text: part.content };

    case "image": {
      const imageValue = part.source.value;

      // If it's a URL, return it as-is
      if (typeof imageValue === "string") {
        // Check if it's a data URL (base64 encoded)
        if (imageValue.includes(",")) {
          const base64Data = imageValue.split(",")[1];
          const binaryString = atob(base64Data);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          return {
            type: "image",
            image: bytes,
          };
        }

        // It's a regular URL, return as URL object
        return {
          type: "image",
          image: new URL(imageValue),
        };
      }

      // Already Uint8Array or use as-is
      return {
        type: "image",
        image: imageValue,
      };
    }

    case "audio": {
      const audioValue = part.source.value;

      // Convert to base64 data URL string
      if (typeof audioValue === "string") {
        return {
          type: "file",
          data: audioValue,
          mimeType: "audio/*",
          filename: "audio",
        };
      }

      // Convert Uint8Array to base64
      const binaryString = Array.from(audioValue, (byte: number) => String.fromCharCode(byte)).join(
        ""
      );
      const base64 = btoa(binaryString);
      return {
        type: "file",
        data: `data:audio/*;base64,${base64}`,
        mimeType: "audio/*",
        filename: "audio",
      };
    }

    case "video": {
      const videoValue = part.source.value;

      // Convert to base64 data URL string
      if (typeof videoValue === "string") {
        return {
          type: "file",
          data: videoValue,
          mimeType: "video/*",
          filename: "video",
        };
      }

      // Convert Uint8Array to base64
      const binaryString = Array.from(videoValue, (byte: number) => String.fromCharCode(byte)).join(
        ""
      );
      const base64 = btoa(binaryString);
      return {
        type: "file",
        data: `data:video/*;base64,${base64}`,
        mimeType: "video/*",
        filename: "video",
      };
    }

    case "document": {
      const docValue = part.source.value;

      // Convert to base64 data URL string
      if (typeof docValue === "string") {
        return {
          type: "file",
          data: docValue,
          mimeType: "application/pdf",
          filename: "document",
        };
      }

      // Convert Uint8Array to base64
      const binaryString = Array.from(docValue, (byte: number) => String.fromCharCode(byte)).join(
        ""
      );
      const base64 = btoa(binaryString);
      return {
        type: "file",
        data: `data:application/pdf;base64,${base64}`,
        mimeType: "application/pdf",
        filename: "document",
      };
    }

    default:
      return { type: "text", text: String(part) };
  }
}

/**
 * Convert an assistant message to AI SDK format
 */
function convertAssistantMessage(message: ModelMessage): LanguageModelV1Message {
  // Build content array with proper types
  const content: Array<LanguageModelV1TextPart | LanguageModelV1ToolCallPart> = [];

  // Add text content if present
  const messageContent = message.content;
  if (messageContent && messageContent !== null) {
    const textContent = typeof messageContent === "string" ? messageContent : "";
    if (textContent) {
      content.push({ type: "text", text: textContent });
    }
  } else if (!message.toolCalls || message.toolCalls.length === 0) {
    // Ensure we have at least empty text
    content.push({ type: "text", text: "" });
  }

  // Add tool calls
  if (message.toolCalls) {
    for (const toolCall of message.toolCalls) {
      content.push({
        type: "tool-call",
        toolCallId: toolCall.id,
        toolName: toolCall.function.name,
        args:
          typeof toolCall.function.arguments === "string"
            ? JSON.parse(toolCall.function.arguments)
            : toolCall.function.arguments,
      });
    }
  }

  return {
    role: "assistant",
    content,
  };
}

/**
 * Convert a tool result message to AI SDK format
 */
function convertToolMessage(message: ModelMessage): LanguageModelV1Message {
  return {
    role: "tool",
    content: [
      {
        type: "tool-result",
        toolCallId: message.toolCallId || "",
        toolName: "tool",
        result:
          typeof message.content === "string" ? message.content : JSON.stringify(message.content),
      },
    ],
  };
}

/**
 * Convert TanStack AI tools to AI SDK Tool format
 *
 * @param tools - Array of TanStack Tool definitions
 * @returns Array of AI SDK Tool definitions
 */
export function convertToolsToAISDK(tools: Tool[]): LanguageModelV1FunctionTool[] {
  return tools.map(convertTool);
}

/**
 * Convert a single tool definition
 */
function convertTool(tool: Tool): LanguageModelV1FunctionTool {
  const parameters = tool.inputSchema as Record<string, unknown> | undefined;

  // Use default parameters if inputSchema is missing or empty
  const hasParameters = parameters && Object.keys(parameters).length > 0;

  return {
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: hasParameters
      ? parameters
      : {
          type: "object",
          properties: {},
          required: [],
        },
  };
}
