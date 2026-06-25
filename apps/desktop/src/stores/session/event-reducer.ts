import type { AgentHarnessEvent, AgentMessage } from "@sakti-code/agent";
import type { Message } from "@sakti-code/llm";
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
  if (message.role === "user") {
    const text = extractTextContent(message);
    if (actions.wasLastUserMessage(text)) {
      return;
    }
    actions.addMessage({
      id: crypto.randomUUID(),
      role: "user",
      content: text,
      parts: [{ type: "text", text }],
      isStreaming: false,
      timestamp:
        typeof message.timestamp === "number" ? message.timestamp : Date.now(),
    });
    return;
  }

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

  const result = event.result;
  let resultText: string;
  let details: unknown;

  if (
    result !== null &&
    typeof result === "object" &&
    "content" in result &&
    Array.isArray((result as { content: unknown }).content)
  ) {
    const content = (result as { content: unknown[] }).content;
    resultText = content
      .filter(
        (c): c is { type: "text"; text: string } =>
          c !== null &&
          typeof c === "object" &&
          "type" in c &&
          c.type === "text"
      )
      .map((c) => c.text)
      .join("");
    details = (result as { details?: unknown }).details;
  } else if (typeof result === "object" && result !== null) {
    resultText = JSON.stringify(result);
  } else {
    resultText = String(result);
  }

  actions.completeToolCall(
    msgId,
    event.toolCallId,
    resultText,
    event.isError,
    details
  );
}

function handleTurnTiming(
  actions: SessionActions,
  event: AgentHarnessEvent,
  skipTiming: boolean
): void {
  if (skipTiming) {
    return;
  }
  if (event.type === "agent_start") {
    actions.startTurn(Date.now());
  } else if (event.type === "agent_end" || event.type === "abort") {
    actions.finalizeTurn(Date.now());
  }
}

export function dispatchEvent(
  actions: SessionActions,
  batcher: TokenBatcher,
  event: AgentHarnessEvent,
  options?: { skipTiming?: boolean }
): void {
  handleTurnTiming(actions, event, options?.skipTiming ?? false);

  switch (event.type) {
    case "agent_start":
      actions.setPhase("thinking");
      break;

    case "message_start":
      handleMessageStart(actions, event.message);
      break;

    case "message_update": {
      const msgId = actions.getCurrentMessageId();
      if (!msgId) {
        break;
      }
      if (event.delta.kind === "text") {
        batcher.append(msgId, event.delta.text);
      } else {
        actions.appendThinkingToken(msgId, event.delta.text);
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
      // Safety net: store.retry is normally cleared by auto_retry_end, but if
      // the run terminates abnormally (retry loop threw after emitting start,
      // or the harness aborted mid-turn without a clean end event) the banner
      // must not outlive the run. agent_end/abort mean the run is over.
      actions.setRetry(null);
      break;

    case "auto_retry_start":
      // Show the retry banner: error, attempt count, and backoff delay.
      actions.setRetry({
        attempt: event.attempt,
        delayMs: event.delayMs,
        errorMessage: event.errorMessage,
        maxAttempts: event.maxAttempts,
      });
      break;

    case "auto_retry_end":
      // Retry resolved (success or final failure) — hide the banner.
      actions.setRetry(null);
      break;
  }
}
