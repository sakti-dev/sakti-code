import type { AgentEvent, SessionStore } from "@sakti-code/agent";
import type { ServerContext } from "../context.ts";
import { abortRun, getActiveLoop, runPrompt } from "./runner.ts";

// ── Inbound message types ──

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

// ── Outbound frame types ──

export interface EventFrame {
  event: AgentEvent;
  sessionId: string;
  type: "event";
}

export interface ErrorFrame {
  error: string;
  sessionId: string;
  type: "error";
}

export type WsOut = EventFrame | ErrorFrame;

// ── Minimal WS handle interface ──
// ElysiaWS satisfies this; tests can pass a fake object.

export interface WsHandle {
  send(data: string): void;
}

// ── Agent stream runner (fire-and-forget) ──

async function runAgentStream(
  ctx: ServerContext,
  sessionId: string,
  message: string,
  store: SessionStore,
  ws: WsHandle
) {
  try {
    for await (const event of runPrompt(ctx, sessionId, message, store)) {
      ws.send(
        JSON.stringify({
          event,
          sessionId,
          type: "event",
        } satisfies EventFrame)
      );
    }
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

// ── Core message handler (testable without bun:sqlite) ──

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
  store: SessionStore,
  ws: WsHandle,
  msg: WsIn
) {
  if (msg.type === "abort") {
    abortRun(msg.sessionId);
    return;
  }

  if (msg.type === "steer" || msg.type === "followUp") {
    const loop = getActiveLoop(msg.sessionId);
    if (!loop) {
      sendError(
        ws,
        msg.sessionId,
        `No active run for session ${msg.sessionId}`
      );
      return;
    }
    if (msg.type === "steer") {
      loop.steer(msg.message);
    } else {
      loop.followUp(msg.message);
    }
    return;
  }

  // msg.type === "prompt" — validate required fields
  if (!(msg.sessionId && msg.message)) {
    sendError(ws, msg.sessionId ?? "", "Missing sessionId or message");
    return;
  }

  // Fire-and-forget — does NOT await the stream
  runAgentStream(ctx, msg.sessionId, msg.message, store, ws);
}
