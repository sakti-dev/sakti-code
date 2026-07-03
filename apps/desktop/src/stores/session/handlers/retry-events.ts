import { registerHandler } from "../event-handler.ts";

export function registerRetryHandlers(): void {
  registerHandler("auto_retry_start", (event, ctx) => {
    ctx.actions.setRetry({
      attempt: event.attempt,
      delayMs: event.delayMs,
      errorMessage: event.errorMessage,
      maxAttempts: event.maxAttempts,
    });
  });

  registerHandler("auto_retry_end", (_event, ctx) => {
    ctx.actions.setRetry(null);
  });
}
