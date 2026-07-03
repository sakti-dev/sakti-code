import { registerHandler } from "../event-handler.ts";
import { createLogger } from "~/lib/utils";

const log = createLogger({ module: "compaction-events" });

export function registerCompactionHandlers(): void {
  let deltaCount = 0;

  registerHandler("compaction_start", (_event, ctx) => {
    const fromCurrent = ctx.actions.getCurrentMessageId();
    const fromLast = ctx.actions.getLastAssistantMessageId();
    const msgId = fromCurrent ?? fromLast;
    log.info("compaction_start", {
      msgId,
      resolvedFrom: fromCurrent ? "currentMessageId" : fromLast ? "lastAssistant" : "none",
    });
    if (msgId) {
      ctx.actions.setCurrentMessage(msgId);
      ctx.actions.addCompactionMarker(msgId);
    }
    ctx.actions.setPhase("thinking");
    deltaCount = 0;
  });

  registerHandler("compaction_delta", (event, ctx) => {
    const msgId = ctx.actions.getCurrentMessageId();
    deltaCount++;
    if (deltaCount <= 3 || deltaCount % 50 === 0) {
      log.debug("compaction_delta", {
        msgId,
        deltaCount,
        deltaLen: event.text.length,
      });
    }
    if (msgId) {
      ctx.actions.appendCompactionToken(msgId, event.text);
    } else {
      log.debug("compaction_delta — no currentMessageId, dropping delta", { deltaCount });
    }
  });

  registerHandler("compaction_end", (event, ctx) => {
    const msgId = ctx.actions.getCurrentMessageId();
    log.info("compaction_end", {
      msgId,
      deltaCount,
      hasResult: event.result !== undefined,
      hasError: event.errorMessage !== undefined,
    });
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
