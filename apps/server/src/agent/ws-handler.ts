import type { AgentHarnessEvent, SessionStorage } from "@sakti-code/agent";
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

export type WsOut = EventFrame | ErrorFrame;

export interface WsHandle {
  send(data: string): void;
}

async function runAgentStream(
  ctx: ServerContext,
  sessionId: string,
  message: string,
  storage: SessionStorage,
  ws: WsHandle
) {
  try {
    await runPrompt(ctx, sessionId, message, storage, (event) => {
      ws.send(
        JSON.stringify({
          event,
          sessionId,
          type: "event",
        } satisfies EventFrame)
      );
    });
  } catch (err) {
    ws.send(
      JSON.stringify({
        error: err instanceof Error ? err.message : String(err),
        sessionId,
        type: "error",
      } satisfies ErrorFrame)
    );
  }
}

export function sendError(ws: WsHandle, sessionId: string, message: string) {
  ws.send(
    JSON.stringify({
      error: message,
      sessionId,
      type: "error",
    } satisfies ErrorFrame)
  );
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
