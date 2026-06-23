import type { MessagePart, UIMessage } from "../types.ts";

export interface ChatTurn {
  assistantMessages: UIMessage[];
  error: string | null;
  userMessage: UIMessage | null;
  working: boolean;
}

function newTurn(userMessage: UIMessage | null): ChatTurn {
  return {
    userMessage,
    assistantMessages: [],
    working: false,
    error: null,
  };
}

function handleAssistantMessage(
  currentTurn: ChatTurn | null,
  msg: UIMessage
): ChatTurn {
  const turn = currentTurn ?? newTurn(null);
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
  streamingPhase: string
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
      currentTurn = newTurn(msg);
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
