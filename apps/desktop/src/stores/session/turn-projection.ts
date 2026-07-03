import type { TurnMeta } from "./hydrate-chat.ts";
import type { MessagePart, TurnTiming, UIMessage } from "../types.ts";

export interface ChatTurn {
  assistantMessages: UIMessage[];
  endedAt: number | null;
  error: string | null;
  id: string;
  /** Server turn id — non-null for turns loaded via /chat (lazy), null for live. */
  turnId: string | null;
  /** Total intermediate entries (from server). Drives the collapse badge + canCollapse. */
  intermediateCount: number;
  startedAt: number | null;
  userMessage: UIMessage | null;
  working: boolean;
}

function newTurn(userMessage: UIMessage | null, id: string): ChatTurn {
  return {
    id,
    intermediateCount: 0,
    turnId: null,
    userMessage,
    assistantMessages: [],
    working: false,
    error: null,
    startedAt: null,
    endedAt: null,
  };
}

/**
 * Cache for thinking-split results, keyed by the original message proxy.
 *
 * Solid store proxies have stable references across property mutations, so a
 * completed message (never changes) always returns the same split objects.
 * This prevents `<For>` from seeing fresh references on every `buildChatTurns`
 * recompute (which fires per streamed token) and avoids re-rendering markdown
 * for messages that haven't changed.
 */
const splitCache = new WeakMap<UIMessage, UIMessage[]>();

function handleAssistantMessage(currentTurn: ChatTurn | null, msg: UIMessage): ChatTurn {
  const turn = currentTurn ?? newTurn(null, msg.id);

  // Split thinking from non-thinking parts so thinking renders inside the
  // collapsible accordion (as an intermediate) instead of inline with the
  // summary text. Skip streaming messages — the turn isn't collapsible while
  // streaming (endedAt === null), and splitting would churn references on
  // every token. The split is computed once when the message completes.
  if (!msg.isStreaming) {
    let split = splitCache.get(msg);
    if (!split) {
      const thinkingParts = msg.parts.filter((p) => p.type === "thinking");
      const otherParts = msg.parts.filter((p) => p.type !== "thinking");
      if (thinkingParts.length > 0 && otherParts.length > 0) {
        split = [
          { ...msg, id: `${msg.id}#thinking`, parts: thinkingParts, content: "" },
          { ...msg, parts: otherParts },
        ];
      } else {
        split = [msg];
      }
      splitCache.set(msg, split);
    }
    for (const m of split) {
      turn.assistantMessages.push(m);
    }
  } else {
    turn.assistantMessages.push(msg);
  }

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
  turnTimings: TurnTiming[] = [],
  turnsMeta: Record<string, TurnMeta> = {},
): ChatTurn[] {
  const turns: ChatTurn[] = [];
  let currentTurn: ChatTurn | null = null;

  const metaByUserMsg = new Map<string, TurnMeta>();
  for (const meta of Object.values(turnsMeta)) {
    if (meta.userMessageId) {
      metaByUserMsg.set(meta.userMessageId, meta);
    }
  }

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
      const meta = metaByUserMsg.get(msg.id);
      if (meta) {
        currentTurn.turnId = meta.id;
        currentTurn.startedAt = meta.startedAt;
        currentTurn.endedAt = meta.endedAt;
        currentTurn.intermediateCount = meta.intermediateIds.length;
      }
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

  let timingIdx = 0;
  for (const turn of turns) {
    if (turn.turnId !== null) {
      continue;
    }
    if (timingIdx < turnTimings.length) {
      const timing = turnTimings[timingIdx];
      if (timing) {
        turn.startedAt = timing.startedAt;
        turn.endedAt = timing.endedAt;
      }
    }
    timingIdx++;
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
