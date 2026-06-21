import type { AgentHarnessEvent, SessionStorage } from "@sakti-code/agent";
import { t } from "elysia";
import type { ServerContext } from "../context.ts";
import {
  abortRun,
  busyMessage,
  getActiveHarness,
  isRunActive,
  runPrompt,
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

export type WsIn =
  | PromptMessage
  | AbortMessage
  | SteerMessage
  | FollowUpMessage;

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

export const wsBodySchema = t.Union([
  t.Object({
    type: t.Literal("prompt"),
    sessionId: t.String(),
    message: t.String(),
  }),
  t.Object({
    type: t.Literal("abort"),
    sessionId: t.String(),
  }),
  t.Object({
    type: t.Literal("steer"),
    sessionId: t.String(),
    message: t.String(),
  }),
  t.Object({
    type: t.Literal("followUp"),
    sessionId: t.String(),
    message: t.String(),
  }),
]);

export const wsResponseSchema = t.Union([
  t.Object({
    type: t.Literal("welcome"),
    version: t.String(),
    cwd: t.String(),
  }),
  t.Object({
    type: t.Literal("event"),
    sessionId: t.String(),
    event: t.Unknown(),
  }),
  t.Object({
    type: t.Literal("error"),
    sessionId: t.String(),
    error: t.String(),
  }),
  t.Object({
    type: t.Literal("push"),
    channel: t.Literal("terminal.data"),
    data: t.Object({ terminalId: t.String(), data: t.String() }),
  }),
  t.Object({
    type: t.Literal("push"),
    channel: t.Literal("terminal.exit"),
    data: t.Object({
      terminalId: t.String(),
      exitCode: t.Number(),
      signal: t.Optional(t.Union([t.Number(), t.String()])),
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
  if (msg.type === "abort") {
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
