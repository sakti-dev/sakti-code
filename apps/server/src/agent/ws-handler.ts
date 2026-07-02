import {
  ObservationalMemoryEngine,
  type AgentHarnessEvent,
  type PermissionReply,
  type SessionStorageShape,
} from "@sakti-code/agent";
import { SqliteObservationalMemoryStorage } from "@sakti-code/db";
import Type from "typebox";
import { runCompact } from "./commands/compact.ts";
import { resolveOmConfig } from "./config/index.ts";
import type { ServerContext } from "../context.ts";
import { createSessionStorage } from "../context.ts";
import { getPermissionChannel } from "../lib/permission-channel.ts";
import {
  abortRun,
  busyMessage,
  getActiveHarness,
  isRunActive,
  pauseReplay,
  resumeReplay,
  runPrompt,
  startReplay,
  stopReplay,
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

export interface ReplayMessage {
  action: "start" | "pause" | "resume";
  sessionId: string;
  type: "replay";
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

export interface CommandMessage {
  /** Command name (currently only "compact"). */
  name: "compact";
  /** Optional custom instructions passed to compaction summarizer. */
  customInstructions?: string;
  sessionId: string;
  type: "command";
}

export type WsIn =
  | PromptMessage
  | AbortMessage
  | SteerMessage
  | FollowUpMessage
  | ReplayMessage
  | SwitchAgentMessage
  | PermissionReplyMessage
  | CommandMessage;

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
    type: Type.Literal("replay"),
    sessionId: Type.String(),
    action: Type.Union([Type.Literal("start"), Type.Literal("pause"), Type.Literal("resume")]),
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
  Type.Object({
    type: Type.Literal("command"),
    sessionId: Type.String(),
    name: Type.Literal("compact"),
    customInstructions: Type.Optional(Type.String()),
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

async function runAgentStream(
  ctx: ServerContext,
  sessionId: string,
  message: string,
  storage: SessionStorageShape,
  ws: WsHandle,
) {
  const log = ctx.log?.server;
  ctx.repos.turns.create(sessionId, Date.now());
  log?.info("agent run started", {
    sessionId,
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
    ctx.repos.turns.finalizeLatest(sessionId, Date.now());
    log?.debug("turn finalized", { sessionId });
  }
}

export function sendError(ws: WsHandle, sessionId: string, message: string) {
  ws.send({
    error: message,
    sessionId,
    type: "error",
  } satisfies ErrorFrame);
}

async function handleCompactCommand(
  ctx: ServerContext,
  sessionId: string,
  customInstructions: string | undefined,
  ws: WsHandle,
): Promise<void> {
  if (isRunActive(sessionId)) {
    sendError(ws, sessionId, busyMessage(sessionId));
    return;
  }

  const session = ctx.repos.sessions.findById(sessionId);
  if (!session) {
    sendError(ws, sessionId, "Session not found");
    return;
  }

  const omConfig = resolveOmConfig(ctx, {
    id: sessionId,
    kind: session.kind,
    projectId: session.projectId,
    profileId: session.profileId,
  });

  if (omConfig) {
    const omStorage = new SqliteObservationalMemoryStorage(ctx.db);
    const storage = createSessionStorage(ctx, sessionId);
    const abortController = new AbortController();
    const engine = new ObservationalMemoryEngine({
      deps: {
        ...omConfig,
        storage: omStorage,
        sessionId,
        projectId: session.projectId,
        sessionStorage: storage,
      },
      abortSignal: abortController.signal,
      onOmEvent: (event) => {
        ws.send({ event, sessionId, type: "event" } satisfies EventFrame);
      },
    });

    const result = await engine.forceReflect();
    if (!result.reflected) {
      sendError(ws, sessionId, `Nothing to reflect: ${result.reason ?? "unknown"}`);
    }
    return;
  }

  ws.send({
    event: { type: "compaction_start", reason: "manual" },
    sessionId,
    type: "event",
  } satisfies EventFrame);

  const result = await runCompact(ctx, sessionId, customInstructions);

  if ("notFound" in result) {
    sendError(ws, sessionId, "Session not found");
    return;
  }
  if ("error" in result) {
    ws.send({
      event: {
        type: "compaction_end",
        reason: "manual",
        aborted: false,
        willRetry: false,
        errorMessage: result.error,
      },
      sessionId,
      type: "event",
    } satisfies EventFrame);
    return;
  }

  ws.send({
    event: {
      type: "compaction_end",
      reason: "manual",
      ...("skipped" in result
        ? {}
        : {
            result: {
              summary: result.summary,
              firstKeptEntryId: result.firstKeptEntryId,
              tokensBefore: result.tokensBefore,
            },
          }),
      aborted: false,
      willRetry: false,
    },
    sessionId,
    type: "event",
  } satisfies EventFrame);
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
    ...(msg.type === "replay" ? { action: msg.action } : {}),
    ...(msg.type === "switchAgent" ? { agent: msg.name } : {}),
    ...(hasMessage ? { messageLength: msg.message.length } : {}),
  });

  if (msg.type === "replay") {
    if (msg.action === "start") {
      startReplay(msg.sessionId, ws).catch((err) => {
        log?.warn("replay start failed", { sessionId: msg.sessionId });
        sendError(ws, msg.sessionId, err instanceof Error ? err.message : String(err));
      });
    } else if (msg.action === "pause") {
      pauseReplay(msg.sessionId);
    } else if (msg.action === "resume") {
      resumeReplay(msg.sessionId);
    }
    return;
  }

  if (msg.type === "abort") {
    if (stopReplay(msg.sessionId)) {
      return;
    }
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

  if (msg.type === "command") {
    handleCompactCommand(ctx, msg.sessionId, msg.customInstructions, ws).catch((err) => {
      log?.warn("compact command failed", { sessionId: msg.sessionId });
      sendError(ws, msg.sessionId, err instanceof Error ? err.message : String(err));
    });
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
