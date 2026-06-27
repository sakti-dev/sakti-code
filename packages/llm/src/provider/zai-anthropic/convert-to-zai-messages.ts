import type { LanguageModelV4Prompt } from "@ai-sdk/provider";
import { convertToBase64 } from "@ai-sdk/provider-utils";
import type { ZaiCacheControl, ZaiContentBlock } from "./zai-anthropic-api.ts";

/**
 * # convertToZaiMessages — V4 prompt → Anthropic Messages body shape
 *
 * Ported from `@ai-sdk/anthropic/convert-to-anthropic-prompt.ts`, stripped to
 * the minimal subset Z.ai surfaces. Lifts `system` to top-level, groups
 * user/tool messages into a single user turn (Anthropic protocol), and emits
 * `text` / `thinking` / `tool_use` / `tool_result` blocks.
 *
 * Out of scope (and intentionally unsupported): mcp/container/code-exec/web/
 * advisor/tool-search/fallback/compaction/citations, mid-conversation system,
 * and provider-executed tools generally. Z.ai surfaces none of these.
 *
 * `cache_control` slots are emitted on every text block as `undefined`; the
 * `CacheControlValidator` pass in `getArgs` fills them in for the stable
 * prefix / last tool.
 */

export interface ZaiTextBlock {
  cache_control?: ZaiCacheControl;
  text: string;
  type: "text";
}

export interface ZaiUserContent {
  data: string;
  media_type: string;
  type: "base64";
}

export interface ZaiMessage {
  content: Array<
    | ZaiTextBlock
    | ZaiContentBlock
    | { type: "image"; source: ZaiUserContent }
    | ZaiToolResultBlock
  >;
  role: "user" | "assistant" | "system";
}

export interface ZaiToolResultBlock {
  cache_control?: ZaiCacheControl;
  content: string;
  is_error?: true;
  tool_use_id: string;
  type: "tool_result";
}

export interface ConvertToZaiMessagesResult {
  messages: ZaiMessage[];
  system: ZaiTextBlock[] | undefined;
}

export function convertToZaiMessages(input: {
  prompt: LanguageModelV4Prompt;
  sendReasoning?: boolean;
}): ConvertToZaiMessagesResult {
  const sendReasoning = input.sendReasoning !== false;
  const blocks = groupIntoBlocks(input.prompt);

  let system: ZaiTextBlock[] | undefined;
  const messages: ZaiMessage[] = [];

  for (const block of blocks) {
    if (block.type === "system") {
      const content = block.messages.map(({ content }) => ({
        type: "text" as const,
        text: content,
      }));
      if (system == null) {
        system = content;
      } else {
        // Mid-conversation system messages: Z.ai doesn't support the
        // Claude-era beta; merge into the prior system text as a fallback.
        system.push(...content);
      }
      continue;
    }
    if (block.type === "assistant") {
      messages.push({
        role: "assistant",
        content: buildAssistantContent(block.messages, sendReasoning),
      });
      continue;
    }
    // user block: combine user + tool messages into a single user turn.
    messages.push({ role: "user", content: buildUserContent(block.messages) });
  }

  return { system, messages };
}

function buildAssistantContent(
  messages: AssistantBlock["messages"],
  sendReasoning: boolean
): ZaiMessage["content"] {
  const content: ZaiMessage["content"] = [];
  for (const message of messages) {
    for (const part of message.content) {
      if (part.type === "text") {
        content.push({ type: "text", text: part.text });
      } else if (part.type === "reasoning") {
        if (!sendReasoning) {
          continue;
        }
        const signature = readSignature(part.providerOptions);
        // reasoning without signature → drop (Anthropic can't replay it)
        if (signature !== undefined) {
          content.push({
            type: "thinking",
            thinking: part.text,
            signature,
          });
        }
      } else if (part.type === "tool-call") {
        content.push({
          type: "tool_use",
          id: part.toolCallId,
          name: part.toolName,
          input: part.input,
        });
      }
      // file/reasoning-file/custom/tool-result parts on assistant messages
      // are not part of the inbound prompt shape (only `tool` role carries
      // tool results) — skip silently.
    }
  }
  return content;
}

function buildUserContent(
  messages: UserBlock["messages"]
): ZaiMessage["content"] {
  const content: ZaiMessage["content"] = [];
  for (const message of messages) {
    if (message.role === "user") {
      pushUserMessageContent(content, message.content);
    } else {
      pushToolMessageContent(content, message.content);
    }
  }
  return content;
}

function pushUserMessageContent(
  out: ZaiMessage["content"],
  parts: Extract<LanguageModelV4Prompt[number], { role: "user" }>["content"]
): void {
  for (const part of parts) {
    if (part.type === "text") {
      out.push({ type: "text", text: part.text });
    } else if (part.type === "file") {
      const image = fileToImageBlock(part);
      if (image) {
        out.push(image);
      }
    }
  }
}

function pushToolMessageContent(
  out: ZaiMessage["content"],
  parts: Extract<LanguageModelV4Prompt[number], { role: "tool" }>["content"]
): void {
  for (const part of parts) {
    if (part.type !== "tool-result") {
      continue;
    }
    const { content: body, isError } = serializeToolResult(part.output);
    out.push({
      type: "tool_result",
      tool_use_id: part.toolCallId,
      content: body,
      ...(isError ? { is_error: true as const } : {}),
    });
  }
}

// ─── helpers ────────────────────────────────────────────────────────────────

interface SystemBlock {
  messages: Extract<LanguageModelV4Prompt[number], { role: "system" }>[];
  type: "system";
}
interface AssistantBlock {
  messages: Extract<LanguageModelV4Prompt[number], { role: "assistant" }>[];
  type: "assistant";
}
interface UserBlock {
  messages: Array<
    | Extract<LanguageModelV4Prompt[number], { role: "user" }>
    | Extract<LanguageModelV4Prompt[number], { role: "tool" }>
  >;
  type: "user";
}

function groupIntoBlocks(
  prompt: LanguageModelV4Prompt
): Array<SystemBlock | AssistantBlock | UserBlock> {
  const blocks: Array<SystemBlock | AssistantBlock | UserBlock> = [];

  function openBlock(
    type: "system" | "assistant" | "user"
  ): SystemBlock | AssistantBlock | UserBlock {
    let block: SystemBlock | AssistantBlock | UserBlock;
    if (type === "system") {
      block = { type: "system", messages: [] };
    } else if (type === "assistant") {
      block = { type: "assistant", messages: [] };
    } else {
      block = { type: "user", messages: [] };
    }
    blocks.push(block);
    return block;
  }

  for (const message of prompt) {
    const role = message.role;
    const blockType = role === "tool" ? "user" : role;
    const current = blocks.at(-1);
    const block =
      current && current.type === blockType ? current : openBlock(blockType);
    block.messages.push(message as never);
  }
  return blocks;
}

function readSignature(
  providerOptions: Record<string, unknown> | undefined
): string | undefined {
  const zaiSig = (providerOptions?.zai as { signature?: unknown } | undefined)
    ?.signature;
  if (typeof zaiSig === "string") {
    return zaiSig;
  }
  const anthropicSig = (
    providerOptions?.anthropic as { signature?: unknown } | undefined
  )?.signature;
  if (typeof anthropicSig === "string") {
    return anthropicSig;
  }
  return;
}

interface FilePart {
  data:
    | { type: "data"; data: Uint8Array | string }
    | { type: "url"; url: URL | string }
    | { type: "reference"; reference: Record<string, unknown> }
    | { type: "text"; text: string };
  mediaType: string;
}

function fileToImageBlock(
  part: FilePart
): { source: ZaiUserContent; type: "image" } | undefined {
  // Only emit an image block for image/* media. PDFs / other docs are out of
  // scope for v1 (Z.ai's Anthropic endpoint accepts images, not documents).
  if (!part.mediaType.startsWith("image/")) {
    return;
  }
  if (part.data.type === "data") {
    return {
      type: "image",
      source: {
        type: "base64",
        media_type: part.mediaType,
        data:
          typeof part.data.data === "string"
            ? part.data.data
            : convertToBase64(part.data.data),
      },
    };
  }
  return;
}

interface ToolResultOutput {
  reason?: string;
  type:
    | "text"
    | "json"
    | "error-text"
    | "error-json"
    | "execution-denied"
    | "content";
  value?: unknown;
}

function serializeToolResult(output: ToolResultOutput): {
  content: string;
  isError: boolean;
} {
  switch (output.type) {
    case "text":
      return { content: String(output.value ?? ""), isError: false };
    case "error-text":
      return { content: String(output.value ?? ""), isError: true };
    case "json":
      return {
        content: JSON.stringify(output.value ?? null),
        isError: false,
      };
    case "error-json":
      return {
        content: JSON.stringify(output.value ?? null),
        isError: true,
      };
    case "execution-denied":
      return {
        content: output.reason ?? "Tool call execution denied.",
        isError: true,
      };
    case "content": {
      // Concatenate text parts of a `content`-typed result; images / files
      // in tool results are out of scope for v1.
      const parts =
        (output.value as Array<{ type: string; text?: string }>) ?? [];
      const text = parts
        .filter((p) => p.type === "text" && typeof p.text === "string")
        .map((p) => p.text as string)
        .join("");
      return { content: text, isError: false };
    }
    default:
      return { content: "", isError: false };
  }
}
