import { registerHandler } from "../event-handler.ts";

export function registerLifecycleHandlers(): void {
  registerHandler("agent_start", (_event, ctx) => {
    ctx.actions.setPhase("thinking");
    ctx.actions.clearPendingTransition();
  });

  registerHandler("turn_start", (_event, ctx) => {
    ctx.actions.setPhase("thinking");
  });

  registerHandler("turn_end", (_event, ctx) => {
    ctx.actions.setPhase("idle");
    ctx.actions.clearCurrentMessage();
  });

  registerHandler("agent_end", (_event, ctx) => {
    ctx.actions.finalizeTurn(Date.now());
    ctx.actions.setPhase("idle");
    ctx.actions.clearCurrentMessage();
    ctx.actions.clearCurrentTool();
    ctx.actions.setRetry(null);
  });

  registerHandler("abort", (_event, ctx) => {
    ctx.actions.finalizeTurn(Date.now());
    ctx.actions.setPhase("idle");
    ctx.actions.clearCurrentMessage();
    ctx.actions.clearCurrentTool();
    ctx.actions.setRetry(null);
  });
}
