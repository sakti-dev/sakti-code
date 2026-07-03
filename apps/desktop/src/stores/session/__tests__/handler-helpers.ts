import type { AgentHarnessEvent, AgentMessage } from "@sakti-code/agent";
import { dispatchEvent, ensureHandlersRegistered, type HandlerContext } from "../event-handler.ts";
import { createSessionStore } from "../session-store.ts";
import { createTokenBatcher } from "../token-batcher.ts";

// Register all handlers once for the test suite.
ensureHandlersRegistered();

export interface HandlerTestSetup {
  batcher: ReturnType<typeof createTokenBatcher>;
  ctx: HandlerContext;
  dispatch: (event: AgentHarnessEvent) => void;
  session: ReturnType<typeof createSessionStore>;
}

/**
 * Create a real session store + batcher (batch:false for synchronous flush)
 * wired to the module-level handler registry.
 */
export function setupHandlers(): HandlerTestSetup {
  const session = createSessionStore();
  const batcher = createTokenBatcher(
    (msgId, text) => session.actions.appendTextToken(msgId, text),
    { batch: false },
  );
  const ctx: HandlerContext = {
    actions: session.actions,
    batcher,
    store: session.store,
  };
  return {
    batcher,
    ctx,
    dispatch: (event: AgentHarnessEvent) => dispatchEvent(event, ctx),
    session,
  };
}

// ── AgentMessage fixtures ──────────────────────────────────────────

export function userMsg(text: string): AgentMessage {
  return {
    role: "user",
    content: text,
    timestamp: Date.now(),
  } as unknown as AgentMessage;
}

export function assistantMsg(text = ""): AgentMessage {
  return {
    role: "assistant",
    content: text,
    timestamp: Date.now(),
  } as unknown as AgentMessage;
}

export function assistantMsgWithUsage(): AgentMessage {
  return {
    role: "assistant",
    content: "final answer",
    timestamp: Date.now(),
    usage: {
      input: 100,
      output: 50,
      cost: { total: 0.01 },
    },
  } as unknown as AgentMessage;
}

/**
 * Drive a complete turn through the event stream:
 * user → assistant → text delta → message_end → agent_end.
 * After this, the turn is finalized and currentMessageId is null.
 */
export function setupCompletedTurn(): HandlerTestSetup {
  const s = setupHandlers();
  s.dispatch({ type: "message_start", message: userMsg("do something") });
  s.dispatch({ type: "message_start", message: assistantMsg() });
  s.dispatch({ type: "message_update", delta: { kind: "text", text: "Done!" } });
  s.dispatch({ type: "message_end", message: assistantMsg("Done!") });
  s.dispatch({ type: "agent_end", messages: [] });
  return s;
}
