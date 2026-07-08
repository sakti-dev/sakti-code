import {
  type AgentHarnessEvent,
  type PermissionReply,
  type SessionStorageShape,
} from "@sakti-code/agent";
import { SqliteSessionStorage } from "@sakti-code/db";
import { getTaskProgressForChange, SAKTI_CHANGES_DIR } from "@sakti-code/sakti";
import path from "node:path";
import Type from "typebox";
import type { ServerContext } from "../context.ts";
import { getPermissionChannel } from "../lib/permission-channel.ts";
import { applyTransition } from "./config/transition-apply.ts";
import { buildForceReset } from "./config/force-reset.ts";
import { buildGraduation } from "./config/graduation.ts";
import { getEdge, hasEdge, phaseFromSession, type Phase } from "./config/transition-table.ts";
import { autonomousPhaseForSession, buildReminder } from "./reminder.ts";
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
 * Authoritative side-effect of a `transition` tool-call: persist the raw
 * {to, body} so a pending gate card survives reload, and so the runner can
 * resolve the edge (gate vs auto) and act. This does NOT resolve gating or
 * flip status — the runner owns mode resolution (it has the transition table
 * + can chain/auto-start). Records every transition call with a string `to`
 * + `body`; no-ops otherwise. Errors are logged, never thrown.
 *
 * **Why fire-and-forget is safe:** `node:sqlite` writes are synchronous —
 * the SQL executes during the microtask, before the `await runPrompt(...)`
 * continuation runs. If the DB layer ever becomes async, this MUST be
 * awaited (the transition signal would be lost silently).
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
  // Defensive cap: a buggy skill could otherwise infinite-loop build⇄verify.
  // The verify→archive gate is the natural terminator; this is a backstop.
  const MAX_CHAIN_DEPTH = 8;
  // After this many consecutive stalls (no transition) in an autonomous phase,
  // stop re-running and surface to the user instead of looping forever.
  const MAX_REMINDERS = 2;
  let currentMessage = message;
  let depth = 0;
  let stalls = 0;

  while (true) {
    const turn = ctx.repos.turns.create(sessionId, Date.now());
    if (storage instanceof SqliteSessionStorage) {
      storage.setCurrentTurnId(turn.id);
    }
    // A new run supersedes any pending transition: clear the persisted pending
    // state so a reload during this run doesn't resurface a stale card. If the
    // agent calls `transition` again this turn, the side-effect below re-sets
    // it. Best-effort — a clear failure must never block a run.
    try {
      await ctx.repos.sessions.update(sessionId, {
        pendingTransitionTo: null,
        pendingTransitionBody: null,
      });
    } catch (err) {
      ctx.log?.server.warn?.("failed to clear pending transition on run start", {
        sessionId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    log?.info("agent run started", {
      sessionId,
      turnId: turn.id,
      messageLength: currentMessage.length ?? 0,
    });
    try {
      await runPrompt(
        ctx,
        sessionId,
        currentMessage,
        storage,
        (event) => {
          ws.send({
            event,
            sessionId,
            type: "event",
          } satisfies EventFrame);
          // Authoritative pending-transition persistence: record the raw {to,
          // body} of a `transition` tool-call. The runner resolves gate/auto and
          // either chains (auto) or leaves it pending for the confirm route.
          // Fire-and-forget; the helper logs its own errors.
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
      return;
    } finally {
      ctx.repos.turns.finalize(turn.id, Date.now());
      ctx.repos.turns.markSummary(turn.id);
      if (storage instanceof SqliteSessionStorage) {
        storage.setCurrentTurnId(null);
      }
      log?.debug("turn finalized + summary marked", { sessionId, turnId: turn.id });
    }

    // ---- Post-turn: auto-chain across auto-edges, pause at gates -----------
    // After a run, inspect whether the agent called `transition`. AUTO edges
    // (build→verify, verify→build) apply side-effects and immediately start the
    // next phase's run (the <instruction> is its first message). GATE edges
    // (specify→build, verify→archive, plan→mission) pause here — the pending
    // transition persists for the confirm route.
    const session = ctx.repos.sessions.findById(sessionId);
    if (!session) return;
    const dest = session.pendingTransitionTo;
    if (!dest) {
      // No transition — the run ended. In an autonomous phase this is a stall:
      // inject a phase-aware <reminder> and re-run, up to a cap, so a stuck
      // agent gets nudged (oh-my-pi style) without looping forever. Interactive
      // phases (specify/plan) legitimately pause — no reminder.
      const phase = autonomousPhaseForSession(session);
      if (phase && stalls < MAX_REMINDERS) {
        stalls++;
        currentMessage = await buildProgressAwareReminder(ctx, session, phase, stalls);
        continue;
      }
      return; // interactive phase, or stall cap reached — surface to the user
    }
    // A transition happened — reset the stall counter for the new phase.
    stalls = 0;
    const from = phaseFromSession(session);
    const destPhase = dest as Phase;
    if (!hasEdge(from, destPhase)) {
      // Unknown edge — clear the stale pending and stop.
      await clearPendingTransition(ctx, sessionId);
      return;
    }
    const edge = getEdge(from, destPhase);
    if (edge.mode === "gate") return; // pause for the confirm route

    // AUTO edge: apply side-effects (status flip, forced observe, graduation),
    // clear pending, and chain into the next phase's run.
    if (depth++ >= MAX_CHAIN_DEPTH) {
      log?.warn?.("auto-chain depth cap reached — stopping", { sessionId, depth });
      await clearPendingTransition(ctx, sessionId);
      return;
    }
    const forceReset = edge.requiresForcedObserve ? buildForceReset(ctx, session) : undefined;
    const graduate =
      edge.requiresGraduation && session.kind === "plan"
        ? buildGraduation(ctx, session)
        : undefined;
    try {
      await applyTransition(
        {
          repos: ctx.repos,
          ...(forceReset !== undefined ? { forceReset } : {}),
          ...(graduate !== undefined ? { graduate } : {}),
          ...(ctx.log !== undefined ? { log: ctx.log } : {}),
        },
        session,
        edge,
      );
    } catch (err) {
      log?.error?.("auto-chain: applyTransition failed — stopping", err, { sessionId });
      await clearPendingTransition(ctx, sessionId);
      return;
    }
    // The <instruction> block orients the next phase's run; the transition
    // body (fixing plan / completion summary) is already in the transcript
    // from the tool call.
    currentMessage = edge.instruction;
  }
}

/** Best-effort clear of the pending transition state. */
async function clearPendingTransition(ctx: ServerContext, sessionId: string): Promise<void> {
  try {
    await ctx.repos.sessions.update(sessionId, {
      pendingTransitionTo: null,
      pendingTransitionBody: null,
    });
  } catch {
    // Swallow — clearing is best-effort.
  }
}

/**
 * Build a phase-aware reminder, making it progress-aware for the build phase
 * when the session is linked to a change (reads tasks.md via the sakti
 * library). Falls back to phase-aware (no counts) when changeName is null, the
 * change dir is missing, or tasks.md is unreadable — never crashes.
 */
async function buildProgressAwareReminder(
  ctx: ServerContext,
  session: { changeName: string | null; projectId: string },
  phase: "build" | "verify",
  stallCount: number,
): Promise<string> {
  if (phase !== "build" || !session.changeName) {
    return buildReminder(phase, undefined, stallCount);
  }
  try {
    const project = ctx.repos.projects.findById(session.projectId);
    if (!project) return buildReminder(phase, undefined, stallCount);
    const progress = await getTaskProgressForChange(
      path.join(project.cwd, SAKTI_CHANGES_DIR),
      session.changeName,
      project.cwd,
    );
    return buildReminder(phase, progress, stallCount);
  } catch {
    return buildReminder(phase, undefined, stallCount);
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
