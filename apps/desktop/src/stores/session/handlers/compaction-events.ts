import { registerHandler } from "../event-handler.ts";

export function registerCompactionHandlers(): void {
  registerHandler("compaction_start", (_event, ctx) => {
    const msgId = ctx.actions.getCurrentMessageId() ?? ctx.actions.getLastAssistantMessageId();
    if (msgId) {
      ctx.actions.setCurrentMessage(msgId);
      ctx.actions.addCompactionMarker(msgId);
    }
    ctx.actions.setPhase("thinking");
  });

  registerHandler("compaction_delta", (event, ctx) => {
    const msgId = ctx.actions.getCurrentMessageId();
    if (msgId) {
      ctx.actions.appendCompactionToken(msgId, event.text);
    }
  });

  registerHandler("compaction_end", (event, ctx) => {
    const msgId = ctx.actions.getCurrentMessageId();
    if (msgId) {
      if (event.errorMessage !== undefined) {
        ctx.actions.updateCompactionMarker(msgId, {
          endedAt: Date.now(),
          error: event.errorMessage,
          status: "failed",
        });
      } else if (event.result) {
        ctx.actions.updateCompactionMarker(msgId, {
          endedAt: Date.now(),
          status: "complete",
          tokensBefore: event.result.tokensBefore,
        });
      } else {
        ctx.actions.updateCompactionMarker(msgId, {
          endedAt: Date.now(),
          error: "Nothing to compact",
          status: "failed",
        });
      }
    }
    ctx.actions.clearCurrentMessage();
    ctx.actions.setPhase("idle");
  });
}
