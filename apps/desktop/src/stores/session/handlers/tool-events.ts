import { registerHandler } from "../event-handler.ts";

export function registerToolHandlers(): void {
  registerHandler("tool_execution_start", (event, ctx) => {
    const msgId = ctx.actions.getCurrentMessageId();
    if (msgId) {
      ctx.actions.addToolCall(msgId, event.toolCallId, event.toolName, event.args);
    }
    // NOTE: The transition confirmation card is NOT set here. The server
    // resolves gate-vs-auto after the run ends and emits a
    // transition_resolved WS frame. Only gate edges show a card — handled
    // in ws-client.ts's handleFrame switch.
  });

  registerHandler("tool_execution_end", (event, ctx) => {
    const msgId = ctx.actions.getCurrentMessageId();
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
            c !== null && typeof c === "object" && "type" in c && c.type === "text",
        )
        .map((c) => c.text)
        .join("");
      details = (result as { details?: unknown }).details;
    } else if (typeof result === "object" && result !== null) {
      resultText = JSON.stringify(result);
    } else {
      resultText = String(result);
    }

    ctx.actions.completeToolCall(msgId, event.toolCallId, resultText, event.isError, details);
  });
}
