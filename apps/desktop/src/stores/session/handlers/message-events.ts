import { registerHandler } from "../event-handler.ts";
import type { UIMessage } from "../../types.ts";
import { extractText, getTimestamp } from "../hydrate-helpers.ts";
import { extractUsage } from "../usage-stats.ts";

export function registerMessageHandlers(): void {
  registerHandler("message_start", (event, ctx) => {
    const msg = event.message;

    if (msg.role === "user") {
      const text = extractText(msg);
      if (ctx.actions.wasLastUserMessage(text)) {
        return;
      }
      const userMsg: UIMessage = {
        content: text,
        id: crypto.randomUUID(),
        isStreaming: false,
        parts: [{ type: "text", text }],
        role: "user",
        timestamp: getTimestamp(msg),
      };
      ctx.actions.startTurn(userMsg);
      return;
    }

    if (msg.role !== "assistant") {
      return;
    }

    const text = extractText(msg);
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
