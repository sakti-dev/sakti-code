import type { AgentHarnessEvent, SessionStorage } from "@sakti-code/agent";
import Type from "typebox";
import type { ServerContext } from "../context.ts";
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

export type WsIn =
  | PromptMessage
  | AbortMessage
  | SteerMessage
  | FollowUpMessage
  | ReplayMessage;

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

export type WsOut = EventFrame | ErrorFrame | WelcomeFrame | PushFrame;

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
    action: Type.Union([
      Type.Literal("start"),
      Type.Literal("pause"),
      Type.Literal("resume"),
    ]),
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
  storage: SessionStorage,
  ws: WsHandle
) {
  try {
    await runPrompt(ctx, sessionId, message, storage, (event) => {
      ws.send({
        event,
        sessionId,
        type: "event",
      } satisfies EventFrame);
    });
  } catch (err) {
    ws.send({
      error: err instanceof Error ? err.message : String(err),
      sessionId,
      type: "error",
    } satisfies ErrorFrame);
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
  storage: SessionStorage,
  ws: WsHandle,
  msg: WsIn
) {
  if (msg.type === "replay") {
    if (msg.action === "start") {
      startReplay(msg.sessionId, ws).catch((err) => {
        sendError(
          ws,
          msg.sessionId,
          err instanceof Error ? err.message : String(err)
        );
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
      sendError(
        ws,
        msg.sessionId,
        err instanceof Error ? err.message : String(err)
      );
    });
    return;
  }

  if (msg.type === "steer" || msg.type === "followUp") {
    const harness = getActiveHarness(msg.sessionId);
    if (!harness) {
      sendError(
        ws,
        msg.sessionId,
        `No active run for session ${msg.sessionId}`
      );
      return;
    }
    const action =
      msg.type === "steer"
        ? harness.steer(msg.message)
        : harness.followUp(msg.message);
    action.catch((err) => {
      sendError(
        ws,
        msg.sessionId,
        err instanceof Error ? err.message : String(err)
      );
    });
    return;
  }

  if (!(msg.sessionId && msg.message)) {
    sendError(ws, msg.sessionId ?? "", "Missing sessionId or message");
    return;
  }

  if (isRunActive(msg.sessionId)) {
    sendError(ws, msg.sessionId, busyMessage(msg.sessionId));
    return;
  }
  runAgentStream(ctx, msg.sessionId, msg.message, storage, ws).catch((err) => {
    sendError(
      ws,
      msg.sessionId,
      err instanceof Error ? err.message : String(err)
    );
  });
}
