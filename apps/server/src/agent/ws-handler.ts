import {
  type AgentHarnessEvent,
  type PermissionReply,
  type SessionStorageShape,
} from "@sakti-code/agent";
import { SqliteSessionStorage } from "@sakti-code/db";
import Type from "typebox";
import { isKnownAskKind } from "./config/ask-kinds.ts";
import type { ServerContext } from "../context.ts";
import { getPermissionChannel } from "../lib/permission-channel.ts";
import {
  abortRun,
  busyMessage,
  getActiveHarness,
  isRunActive,
  runPrompt,
  switchAgentForSession,
} from "./runner.ts";

export interface PromptMessage {
  message: string;
  sessionId: string;
  type: "prompt";
}

export interface AbortMessage {
  sessionId: string;
  type: "abort";
}

export interface SteerMessage {
  message: string;
  sessionId: string;
  type: "steer";
}

export interface FollowUpMessage {
  message: string;
  sessionId: string;
  type: "followUp";
}

export interface SwitchAgentMessage {
  /** Agent name to activate (e.g. `build`, `explore`, `plan`). */
  name: string;
  sessionId: string;
  type: "switchAgent";
}

export interface PermissionReplyMessage {
  id: string;
  reply: PermissionReply;
  sessionId: string;
  type: "permission.reply";
}

export type WsIn =
  | PromptMessage
  | AbortMessage
  | SteerMessage
  | FollowUpMessage
  | SwitchAgentMessage
  | PermissionReplyMessage;

export interface EventFrame {
  event: AgentHarnessEvent;
  sessionId: string;
  type: "event";
}

export interface ErrorFrame {
  error: string;
  sessionId: string;
  type: "error";
}

export interface WelcomeFrame {
  cwd: string;
  type: "welcome";
  version: string;
}

export interface PushFrame {
  channel: "terminal.data" | "terminal.exit";
  data:
    | { terminalId: string; data: string }
    | { terminalId: string; exitCode: number; signal?: number | string };
  type: "push";
}

/** A tool is requesting permission; the user must reply (allow/always/deny). */
export interface PermissionAskedFrame {
  id: string;
  patterns: string[];
  permission: string;
  sessionId: string;
  toolCallId: string;
  toolName: string;
  type: "permission.asked";
}

/** Acknowledgement of a permission reply (for UX state cleanup). */
export interface PermissionRepliedFrame {
  id: string;
  reply: PermissionReply;
  sessionId: string;
  type: "permission.replied";
}

export type WsOut =
  | EventFrame
  | ErrorFrame
  | WelcomeFrame
  | PushFrame
  | PermissionAskedFrame
  | PermissionRepliedFrame;

export interface WsHandle {
  send(data: unknown): void;
}

// TypeBox schemas for runtime validation on the .ws() endpoint.
// These mirror the TS interfaces above. The TS interfaces stay as
// the compile-time source of truth; TypeBox is the runtime layer.

export const wsBodySchema = Type.Union([
  Type.Object({
    type: Type.Literal("prompt"),
    sessionId: Type.String(),
    message: Type.String(),
  }),
  Type.Object({
    type: Type.Literal("abort"),
    sessionId: Type.String(),
  }),
  Type.Object({
    type: Type.Literal("steer"),
    sessionId: Type.String(),
    message: Type.String(),
  }),
  Type.Object({
    type: Type.Literal("followUp"),
    sessionId: Type.String(),
    message: Type.String(),
  }),
  Type.Object({
    type: Type.Literal("switchAgent"),
    sessionId: Type.String(),
    name: Type.String(),
  }),
  Type.Object({
    type: Type.Literal("permission.reply"),
    sessionId: Type.String(),
    id: Type.String(),
    reply: Type.Union([Type.Literal("once"), Type.Literal("always"), Type.Literal("reject")]),
  }),
]);

export const wsResponseSchema = Type.Union([
  Type.Object({
    type: Type.Literal("welcome"),
    version: Type.String(),
    cwd: Type.String(),
  }),
  Type.Object({
    type: Type.Literal("event"),
    sessionId: Type.String(),
    event: Type.Unknown(),
  }),
  Type.Object({
    type: Type.Literal("error"),
    sessionId: Type.String(),
    error: Type.String(),
  }),
  Type.Object({
    type: Type.Literal("push"),
    channel: Type.Literal("terminal.data"),
    data: Type.Object({ terminalId: Type.String(), data: Type.String() }),
  }),
  Type.Object({
    type: Type.Literal("push"),
    channel: Type.Literal("terminal.exit"),
    data: Type.Object({
      terminalId: Type.String(),
      exitCode: Type.Number(),
      signal: Type.Optional(Type.Union([Type.Number(), Type.String()])),
    }),
  }),
]);

/**
 * Authoritative side-effect of an `ask` tool-call: persist the pending ask
 * (kind+body) so the confirm card survives reload, and flip status → `review`
 * on a completion ask (the design's auto-transition building → review). Known
 * kinds only; an open question (no kind) is transient and stays in the
 * transcript. No-ops for non-ask events. Errors are logged, never thrown —
 * this runs as a fire-and-forget off the WS event stream.
 */
export async function persistAskSideEffect(
  ctx: ServerContext,
  sessionId: string,
  event: AgentHarnessEvent,
): Promise<void> {
  if (event.type !== "tool_execution_start" || event.toolName !== "ask") {
    return;
  }
  const args = event.args as { kind?: unknown; body?: unknown };
  if (typeof args.body !== "string") {
    return;
  }
  const kind = typeof args.kind === "string" && isKnownAskKind(args.kind) ? args.kind : null;
  if (!kind) {
    return;
  }
  try {
    await ctx.repos.sessions.update(sessionId, {
      pendingAskKind: kind,
      pendingAskBody: args.body,
      ...(kind === "completion" ? { status: "review" } : {}),
    });
  } catch (err) {
    ctx.log?.server.error?.("failed to persist pending ask", err, { sessionId, kind });
  }
}

/**
 * Authoritative side-effect of a `transition` tool-call: persist the raw
 * {to, body} so a pending gate card survives reload, and so the runner can
 * resolve the edge (gate vs auto) and act. Unlike the ask hook, this does NOT
 * resolve gating or flip status — the runner owns mode resolution (it has the
 * transition table + can chain/auto-start). Records every transition call with
 * a string `to` + `body`; no-ops otherwise. Errors are logged, never thrown.
 */
export async function persistTransitionSideEffect(
  ctx: ServerContext,
  sessionId: string,
  event: AgentHarnessEvent,
): Promise<void> {
  if (event.type !== "tool_execution_start" || event.toolName !== "transition") {
    return;
  }
  const args = event.args as { to?: unknown; body?: unknown };
  if (typeof args.to !== "string" || typeof args.body !== "string") {
    return;
  }
  try {
    await ctx.repos.sessions.update(sessionId, {
      pendingTransitionTo: args.to,
      pendingTransitionBody: args.body,
    });
  } catch (err) {
    ctx.log?.server.error?.("failed to persist pending transition", err, {
      sessionId,
      to: args.to,
    });
  }
}

export async function runAgentStream(
  ctx: ServerContext,
  sessionId: string,
  message: string,
  storage: SessionStorageShape,
  ws: WsHandle,
) {
  const log = ctx.log?.server;
  const turn = ctx.repos.turns.create(sessionId, Date.now());
  if (storage instanceof SqliteSessionStorage) {
    storage.setCurrentTurnId(turn.id);
  }
  // A new run supersedes any pending ask/transition: clear the persisted
  // pending state so a reload during this run doesn't resurface a stale card.
  // If the agent calls `ask`/`transition` again this turn, the side-effects
  // below re-set them. Best-effort — a clear failure must never block a run.
  try {
    await ctx.repos.sessions.update(sessionId, {
      pendingAskKind: null,
      pendingAskBody: null,
      pendingTransitionTo: null,
      pendingTransitionBody: null,
    });
  } catch (err) {
    ctx.log?.server.warn?.("failed to clear pending state on run start", {
      sessionId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  log?.info("agent run started", {
    sessionId,
    turnId: turn.id,
    messageLength: message.length ?? 0,
  });
  try {
    await runPrompt(
      ctx,
      sessionId,
      message,
      storage,
      (event) => {
        ws.send({
          event,
          sessionId,
          type: "event",
        } satisfies EventFrame);
        // Authoritative pending-ask persistence: when an `ask` tool-call of a
        // known gate kind starts, persist kind+body so the card survives
        // reload. For `completion`, also flip status → review (the
        // design's auto-transition on ask(completion)). Fire-and-forget; the
        // helper logs its own errors so it can never break the event stream.
        void persistAskSideEffect(ctx, sessionId, event);
        // Parallel pending-transition persistence: record the raw {to, body}
        // of a `transition` tool-call. The runner resolves gate/auto and
        // either chains (auto) or leaves it pending for the confirm route.
        void persistTransitionSideEffect(ctx, sessionId, event);
      },
      (frame) => {
        ws.send({
          type: "permission.asked",
          sessionId,
          id: frame.id,
          permission: frame.permission,
          patterns: frame.patterns,
          toolName: frame.toolName,
          toolCallId: frame.toolCallId,
        } satisfies PermissionAskedFrame);
      },
    );
    log?.info("agent run finished", { sessionId });
  } catch (err) {
    log?.error("agent run failed", err, { sessionId });
    ws.send({
      error: err instanceof Error ? err.message : String(err),
      sessionId,
      type: "error",
    } satisfies ErrorFrame);
  } finally {
    ctx.repos.turns.finalize(turn.id, Date.now());
    ctx.repos.turns.markSummary(turn.id);
    if (storage instanceof SqliteSessionStorage) {
      storage.setCurrentTurnId(null);
    }
    log?.debug("turn finalized + summary marked", { sessionId, turnId: turn.id });
  }
}

export function sendError(ws: WsHandle, sessionId: string, message: string) {
  ws.send({
    error: message,
    sessionId,
    type: "error",
  } satisfies ErrorFrame);
}

export function handleMessage(
  ctx: ServerContext,
  storage: SessionStorageShape,
  ws: WsHandle,
  msg: WsIn,
) {
  const log = ctx.log?.server;
  const hasMessage = msg.type === "prompt" || msg.type === "steer" || msg.type === "followUp";
  log?.info("incoming message", {
    type: msg.type,
    sessionId: msg.sessionId,
    ...(msg.type === "switchAgent" ? { agent: msg.name } : {}),
    ...(hasMessage ? { messageLength: msg.message.length } : {}),
  });

  if (msg.type === "abort") {
    abortRun(msg.sessionId).catch((err) => {
      log?.warn("abort failed", { sessionId: msg.sessionId });
      sendError(ws, msg.sessionId, err instanceof Error ? err.message : String(err));
    });
    return;
  }

  if (msg.type === "steer" || msg.type === "followUp") {
    const harness = getActiveHarness(msg.sessionId);
    if (!harness) {
      log?.warn("no active harness for steer/followUp", {
        sessionId: msg.sessionId,
      });
      sendError(ws, msg.sessionId, `No active run for session ${msg.sessionId}`);
      return;
    }
    const action =
      msg.type === "steer" ? harness.steer(msg.message) : harness.followUp(msg.message);
    action.catch((err) => {
      log?.warn("steer/followUp action failed", { sessionId: msg.sessionId });
      sendError(ws, msg.sessionId, err instanceof Error ? err.message : String(err));
    });
    return;
  }

  if (msg.type === "switchAgent") {
    switchAgentForSession(ctx, msg.sessionId, msg.name).catch((err) => {
      log?.warn("switchAgent failed", { sessionId: msg.sessionId });
      sendError(ws, msg.sessionId, err instanceof Error ? err.message : String(err));
    });
    return;
  }

  if (msg.type === "permission.reply") {
    getPermissionChannel(msg.sessionId).reply(msg.id, msg.reply);
    ws.send({
      id: msg.id,
      reply: msg.reply,
      sessionId: msg.sessionId,
      type: "permission.replied",
    } satisfies PermissionRepliedFrame);
    return;
  }

  if (!(msg.sessionId && msg.message)) {
    log?.warn("invalid message: missing sessionId or message", {
      sessionId: msg.sessionId ?? "",
    });
    sendError(ws, msg.sessionId ?? "", "Missing sessionId or message");
    return;
  }

  if (isRunActive(msg.sessionId)) {
    log?.warn("busy — cannot start new run", { sessionId: msg.sessionId });
    sendError(ws, msg.sessionId, busyMessage(msg.sessionId));
    return;
  }
  runAgentStream(ctx, msg.sessionId, msg.message, storage, ws).catch((err) => {
    log?.warn("runAgentStream failed unexpectedly", {
      sessionId: msg.sessionId,
    });
    sendError(ws, msg.sessionId, err instanceof Error ? err.message : String(err));
  });
}
