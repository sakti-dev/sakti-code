import type { Message } from "@earendil-works/pi-ai/base";
import type { AgentHarnessEvent, AgentMessage } from "@sakti-code/agent";
import type { SessionActions } from "./session-store.ts";
import type { TokenBatcher } from "./token-batcher.ts";

function isMessageWithContent(
  msg: AgentMessage
): msg is Message & { content: Message["content"] } {
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

function handleMessageStart(
  actions: SessionActions,
  message: AgentMessage
): void {
  if (message.role !== "assistant") {
    return;
  }
  const msgId = crypto.randomUUID();
  const text = extractTextContent(message);
  actions.addMessage({
    id: msgId,
    role: "assistant",
    content: text,
    parts: text ? [{ type: "text", text }] : [],
    isStreaming: true,
    timestamp: Date.now(),
  });
  actions.setCurrentMessage(msgId);
  actions.setPhase("writing");
}

function handleToolExecutionEnd(
  actions: SessionActions,
  event: Extract<AgentHarnessEvent, { type: "tool_execution_end" }>
): void {
  const msgId = actions.getCurrentMessageId();
  if (!msgId) {
    return;
  }
  const resultText =
    typeof event.result === "object" && event.result !== null
      ? JSON.stringify(event.result)
      : String(event.result);
  actions.completeToolCall(msgId, event.toolCallId, resultText, event.isError);
}

export function dispatchEvent(
  actions: SessionActions,
  batcher: TokenBatcher,
  event: AgentHarnessEvent
): void {
  switch (event.type) {
    case "agent_start":
      actions.setPhase("thinking");
      break;

    case "message_start":
      handleMessageStart(actions, event.message);
      break;

    case "message_update": {
      const msgId = actions.getCurrentMessageId();
      if (msgId && event.assistantMessageEvent.type === "text_delta") {
        batcher.append(msgId, event.assistantMessageEvent.delta);
      }
      break;
    }

    case "message_end": {
      const msgId = actions.getCurrentMessageId();
      if (msgId) {
        actions.finalizeMessage(msgId);
      }
      break;
    }

    case "tool_execution_start": {
      const msgId = actions.getCurrentMessageId();
      if (msgId) {
        actions.addToolCall(
          msgId,
          event.toolCallId,
          event.toolName,
          event.args
        );
      }
      if (event.toolName === "propose_session") {
        const args = event.args as { title?: unknown; message?: unknown };
        if (
          typeof args.title === "string" &&
          typeof args.message === "string"
        ) {
          actions.setProposedSession({
            title: args.title,
            message: args.message,
          });
        }
      }
      break;
    }

    case "tool_execution_end":
      handleToolExecutionEnd(actions, event);
      break;

    case "turn_end":
      actions.setPhase("idle");
      actions.clearCurrentMessage();
      break;

    case "turn_start":
      actions.setPhase("thinking");
      break;

    case "agent_end":
    case "abort":
      actions.setPhase("idle");
      actions.clearCurrentMessage();
      actions.clearCurrentTool();
      break;
  }
}
