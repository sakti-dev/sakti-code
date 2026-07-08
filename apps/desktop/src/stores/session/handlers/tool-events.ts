import { registerHandler } from "../event-handler.ts";

export function registerToolHandlers(): void {
  registerHandler("tool_execution_start", (event, ctx) => {
    const msgId = ctx.actions.getCurrentMessageId();
    if (msgId) {
      ctx.actions.addToolCall(msgId, event.toolCallId, event.toolName, event.args);
    }
    if (event.toolName === "transition") {
      const args = event.args as { to?: unknown; body?: unknown };
      if (typeof args.to === "string" && typeof args.body === "string") {
        // A transition tool-call surfaces a confirmation card (for gate edges)
        // or auto-chains (for auto edges, handled server-side). The card
        // carries the destination phase + body.
        ctx.actions.setPendingTransition({ to: args.to, body: args.body });
      }
    }
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
