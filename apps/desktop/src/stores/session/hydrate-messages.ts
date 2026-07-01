import type { AgentMessage } from "@sakti-code/agent";
import type { Message } from "@sakti-code/llm";
import type { MessagePart, UIMessage } from "../types.ts";
import { extractUsage } from "./usage-stats.ts";

function hasContent(msg: AgentMessage): msg is AgentMessage & { content: Message["content"] } {
  return "content" in msg;
}

function extractText(msg: AgentMessage): string {
  if (!hasContent(msg)) {
    return "";
  }
  const { content } = msg;
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .filter(
        (c): c is { type: "text"; text: string } =>
          c !== null && typeof c === "object" && "type" in c && c.type === "text",
      )
      .map((c) => c.text)
      .join("");
  }
  return "";
}

function getTimestamp(msg: AgentMessage): number {
  return typeof msg.timestamp === "number" ? msg.timestamp : Date.now();
}

function convertAssistantMessage(msg: AgentMessage): UIMessage {
  const parts: MessagePart[] = [];
  let textContent = "";

  const rawContent = hasContent(msg) ? msg.content : undefined;
  const content = Array.isArray(rawContent) ? rawContent : [];
  for (const part of content) {
    if (part !== null && typeof part === "object" && "type" in part && part.type === "thinking") {
      const thinking = (part as { thinking?: string }).thinking;
      if (thinking) {
        parts.push({ type: "thinking", text: thinking });
      }
    } else if (
      part !== null &&
      typeof part === "object" &&
      "type" in part &&
      part.type === "text"
    ) {
      const text = (part as { text?: string }).text ?? "";
      parts.push({ type: "text", text });
      textContent += text;
    } else if (
      part !== null &&
      typeof part === "object" &&
      "type" in part &&
      part.type === "toolCall"
    ) {
      const tc = part as {
        id: string;
        name: string;
        arguments: Record<string, unknown>;
      };
      parts.push({
        type: "tool_call",
        toolCallId: tc.id,
        toolName: tc.name,
        input: tc.arguments,
        status: "running",
      });
    }
  }

  if (typeof rawContent === "string") {
    textContent = rawContent;
    parts.unshift({ type: "text", text: rawContent });
  }

  const usage = extractUsage(msg);

  return {
    id: crypto.randomUUID(),
    role: "assistant",
    content: textContent,
    parts,
    isStreaming: false,
    timestamp: getTimestamp(msg),
    ...(usage === undefined ? {} : { usage }),
  };
}

function mergeToolResult(result: UIMessage[], msg: AgentMessage): void {
  const toolCallId = (msg as { toolCallId?: string }).toolCallId;
  const isError = (msg as { isError?: boolean }).isError ?? false;
  const details = (msg as { details?: unknown }).details;
  const resultText = extractText(msg);

  for (let i = result.length - 1; i >= 0; i--) {
    const uiMsg = result.at(i);
    if (uiMsg?.role !== "assistant") {
      break;
    }
    const part = uiMsg.parts.find((p) => p.type === "tool_call" && p.toolCallId === toolCallId);
    if (part && part.type === "tool_call") {
      part.status = isError ? "error" : "done";
      part.result = resultText;
      if (details !== undefined) {
        part.details = details;
      }
      break;
    }
  }
}

export function hydrateSessionMessages(messages: AgentMessage[]): UIMessage[] {
  const result: UIMessage[] = [];

  for (const msg of messages) {
    if (msg.role === "user") {
      const text = extractText(msg);
      result.push({
        id: crypto.randomUUID(),
        role: "user",
        content: text,
        parts: [{ type: "text", text }],
        isStreaming: false,
        timestamp: getTimestamp(msg),
      });
    } else if (msg.role === "assistant") {
      result.push(convertAssistantMessage(msg));
    } else if (msg.role === "toolResult") {
      mergeToolResult(result, msg);
    } else if (msg.role === "custom" && "customType" in msg && msg.customType === "om_marker") {
      const details = (msg as { details?: Record<string, unknown> }).details;
      if (!details) continue;

      // Find the last assistant UIMessage to attach the marker to.
      let lastAssistant: UIMessage | undefined;
      for (let i = result.length - 1; i >= 0; i--) {
        if (result[i]!.role === "assistant") {
          lastAssistant = result[i];
          break;
        }
      }
      if (!lastAssistant) continue;

      const rawStatus = details.status as string;
      const status =
        rawStatus === "loading" || rawStatus === "buffering" ? "disconnected" : rawStatus;

      lastAssistant.parts.push({
        type: "om_marker",
        cycleId: details.cycleId as string,
        operationType: details.operationType as "observation" | "reflection" | "buffering",
        status: status as MessagePart extends { type: "om_marker" } ? MessagePart["status"] : never,
        ...(details.durationMs !== undefined ? { durationMs: details.durationMs as number } : {}),
        ...(details.tokensProcessed !== undefined
          ? { tokensProcessed: details.tokensProcessed as number }
          : {}),
        ...(details.tokensProduced !== undefined
          ? { tokensProduced: details.tokensProduced as number }
          : {}),
        ...(details.observations !== undefined
          ? { observations: details.observations as string }
          : {}),
        ...(details.currentTask !== undefined
          ? { currentTask: details.currentTask as string }
          : {}),
        ...(details.suggestedResponse !== undefined
          ? { suggestedResponse: details.suggestedResponse as string }
          : {}),
        ...(details.error !== undefined ? { error: details.error as string } : {}),
      });
    }
  }

  return result;
}
