import { registerHandler } from "../event-handler.ts";
import type { OmMarkerInput } from "../session-store.ts";

export function registerOmHandlers(): void {
  registerHandler("om_start", (event, ctx) => {
    const msgId = ctx.actions.getCurrentMessageId() ?? ctx.actions.getLastAssistantMessageId();
    if (msgId) {
      const marker: OmMarkerInput = {
        cycleId: event.cycleId,
        operationType: event.operationType,
        status: event.operationType === "buffering" ? "buffering" : "loading",
        tokensProcessed: event.tokenCount,
      };
      ctx.actions.addOmMarker(msgId, marker);
    }
  });

  registerHandler("om_end", (event, ctx) => {
    const msgId = ctx.actions.getCurrentMessageId() ?? ctx.actions.getLastAssistantMessageId();
    if (msgId) {
      ctx.actions.updateOmMarker(msgId, event.cycleId, {
        durationMs: event.durationMs,
        observations: event.observations,
        status: "complete",
        ...(event.suggestedResponse !== undefined
          ? { suggestedResponse: event.suggestedResponse }
          : {}),
        tokensProduced: event.tokensProduced,
        tokensProcessed: event.tokensProcessed,
        ...(event.currentTask !== undefined ? { currentTask: event.currentTask } : {}),
      });
    }
  });

  registerHandler("om_failed", (event, ctx) => {
    const msgId = ctx.actions.getCurrentMessageId() ?? ctx.actions.getLastAssistantMessageId();
    if (msgId) {
      ctx.actions.updateOmMarker(msgId, event.cycleId, {
        durationMs: event.durationMs,
        error: event.error,
        status: "failed",
      });
    }
  });

  registerHandler("om_activation", (event, ctx) => {
    const msgId = ctx.actions.getCurrentMessageId() ?? ctx.actions.getLastAssistantMessageId();
    if (msgId) {
      ctx.actions.updateOmMarker(msgId, event.cycleId, { status: "activated" });
    }
  });

  registerHandler("om_status", (event, ctx) => {
    ctx.actions.updateOmStatus(event.windows);
  });
}
