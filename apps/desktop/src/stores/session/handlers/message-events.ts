import type { AgentMessage } from "@sakti-code/agent";
import type { Message } from "@sakti-code/llm";
import { registerHandler } from "../event-handler.ts";
import type { UIMessage } from "../../types.ts";
import { extractUsage } from "../usage-stats.ts";

function isMessageWithContent(msg: AgentMessage): msg is Message & { content: Message["content"] } {
  return "content" in msg;
}

function extractTextContent(msg: AgentMessage): string {
  if (!isMessageWithContent(msg)) {
    return "";
  }
  const { content } = msg;
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .filter((c): c is { type: "text"; text: string } => c.type === "text")
      .map((c) => c.text)
      .join("");
  }
  return "";
}

export function registerMessageHandlers(): void {
  registerHandler("message_start", (event, ctx) => {
    const msg = event.message;

    if (msg.role === "user") {
      const text = extractTextContent(msg);
      if (ctx.actions.wasLastUserMessage(text)) {
        return;
      }
      const userMsg: UIMessage = {
        content: text,
        id: crypto.randomUUID(),
        isStreaming: false,
        parts: [{ type: "text", text }],
        role: "user",
        timestamp: typeof msg.timestamp === "number" ? msg.timestamp : Date.now(),
      };
      ctx.actions.startTurn(userMsg);
      return;
    }

    if (msg.role !== "assistant") {
      return;
    }

    const text = extractTextContent(msg);
    const assistantMsg: UIMessage = {
      content: text,
      id: crypto.randomUUID(),
      isStreaming: true,
      parts: text ? [{ type: "text", text }] : [],
      role: "assistant",
      timestamp: Date.now(),
    };
    ctx.actions.addAssistantMessage(assistantMsg);
    ctx.actions.setPhase("writing");
  });

  registerHandler("message_update", (event, ctx) => {
    const msgId = ctx.actions.getCurrentMessageId();
    if (!msgId) {
      return;
    }
    if (event.delta.kind === "text") {
      ctx.batcher.append(msgId, event.delta.text);
    } else if (event.delta.kind === "thinking") {
      ctx.actions.appendThinkingToken(msgId, event.delta.text);
    }
  });

  registerHandler("message_end", (event, ctx) => {
    const msgId = ctx.actions.getCurrentMessageId();
    if (msgId) {
      ctx.actions.finalizeMessage(msgId, extractUsage(event.message));
    }
  });
}
