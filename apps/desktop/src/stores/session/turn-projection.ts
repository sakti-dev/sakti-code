import type { MessagePart, TurnTiming, UIMessage } from "../types.ts";

export interface ChatTurn {
  assistantMessages: UIMessage[];
  endedAt: number | null;
  error: string | null;
  id: string;
  startedAt: number | null;
  userMessage: UIMessage | null;
  working: boolean;
}

function newTurn(userMessage: UIMessage | null, id: string): ChatTurn {
  return {
    id,
    userMessage,
    assistantMessages: [],
    working: false,
    error: null,
    startedAt: null,
    endedAt: null,
  };
}

function handleAssistantMessage(
  currentTurn: ChatTurn | null,
  msg: UIMessage
): ChatTurn {
  const turn = currentTurn ?? newTurn(null, msg.id);
  turn.assistantMessages.push(msg);
  if (msg.isStreaming) {
    turn.working = true;
  }
  if (msg.error) {
    turn.error = msg.error;
  }
  return turn;
}

export function buildChatTurns(
  messageOrder: string[],
  messages: Record<string, UIMessage>,
  streamingPhase: string,
  turnTimings: TurnTiming[] = []
): ChatTurn[] {
  const turns: ChatTurn[] = [];
  let currentTurn: ChatTurn | null = null;

  for (const msgId of messageOrder) {
    const msg = messages[msgId];
    if (!msg) {
      continue;
    }

    if (msg.role === "user") {
      if (currentTurn) {
        turns.push(currentTurn);
      }
      currentTurn = newTurn(msg, msg.id);
    } else if (msg.role === "assistant") {
      currentTurn = handleAssistantMessage(currentTurn, msg);
    }
  }

  if (currentTurn) {
    turns.push(currentTurn);
  }

  const lastTurn = turns.at(-1);
  if (lastTurn && streamingPhase !== "idle") {
    lastTurn.working = true;
  }

  const count = Math.min(turns.length, turnTimings.length);
  for (let i = 0; i < count; i++) {
    const turn = turns[i];
    const timing = turnTimings[i];
    if (turn && timing) {
      turn.startedAt = timing.startedAt;
      turn.endedAt = timing.endedAt;
    }
  }

  return turns;
}

export function getUserText(turn: ChatTurn): string {
  return turn.userMessage?.content ?? "";
}

export function getAssistantParts(turn: ChatTurn): MessagePart[] {
  const parts: MessagePart[] = [];
  for (const msg of turn.assistantMessages) {
    parts.push(...msg.parts);
  }
  return parts;
}
