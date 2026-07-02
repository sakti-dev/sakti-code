import type { AgentMessage } from "@sakti-code/agent";
import type { UIMessage } from "../types.ts";
import { convertAssistantMessage, convertUserMessage, mergeToolResult } from "./hydrate-helpers.ts";

/** Shape of one turn returned by GET /sessions/:id/chat. */
export interface ChatTurnDTO {
  endedAt: number | null;
  id: string;
  intermediateIds: string[];
  sequence: number;
  startedAt: number;
  summaryMessage: Record<string, unknown> | null;
  userMessage: Record<string, unknown> | null;
}

/** Per-turn metadata stored alongside the resident summary messages. */
export interface TurnMeta {
  endedAt: number | null;
  id: string;
  intermediateIds: string[];
  intermediatesLoaded: boolean;
  sequence: number;
  startedAt: number;
  summaryMessageId: string | null;
  userMessageId: string | null;
}

interface ParsedEntry {
  id: string;
  message: AgentMessage;
}

function asEntry(raw: Record<string, unknown> | null): ParsedEntry | null {
  if (!raw) {
    return null;
  }
  const id = raw.id as string | undefined;
  const message = raw.message as AgentMessage | undefined;
  if (id === undefined || message === undefined) {
    return null;
  }
  return { id, message };
}

export interface HydratedChat {
  messages: UIMessage[];
  turns: TurnMeta[];
}

/**
 * Convert the summaries-only `/chat` response into resident UIMessages
 * (user + summary per turn) plus turn metadata. Intermediate content is
 * NOT included — loaded on expand via {@link hydrateIntermediates}.
 */
export function hydrateChatSummaries(chatTurns: ChatTurnDTO[]): HydratedChat {
  const messages: UIMessage[] = [];
  const turns: TurnMeta[] = [];

  for (const ct of chatTurns) {
    const userEntry = asEntry(ct.userMessage);
    const summaryEntry = asEntry(ct.summaryMessage);

    const userMessageId = userEntry?.id ?? null;
    const summaryMessageId = summaryEntry?.id ?? null;

    if (userEntry) {
      messages.push(convertUserMessage(userEntry.id, userEntry.message));
    }
    if (summaryEntry) {
      messages.push(convertAssistantMessage(summaryEntry.id, summaryEntry.message));
    }

    turns.push({
      endedAt: ct.endedAt,
      id: ct.id,
      intermediateIds: ct.intermediateIds,
      intermediatesLoaded: false,
      sequence: ct.sequence,
      startedAt: ct.startedAt,
      summaryMessageId,
      userMessageId,
    });
  }

  return { messages, turns };
}

/**
 * Convert one turn's intermediate entries (from
 * `/turns/:turnId/intermediates`) into UIMessages. User messages are
 * skipped (shipped via `/chat`); tool results are merged into preceding
 * assistant tool-call parts. Entry ids are reused as UIMessage ids so
 * {@link evictTurnIntermediates} can remove them precisely.
 */
export function hydrateIntermediates(entries: Array<Record<string, unknown>>): UIMessage[] {
  const result: UIMessage[] = [];
  for (const raw of entries) {
    if (raw.type !== "message") {
      continue;
    }
    const id = raw.id as string | undefined;
    const msg = raw.message as AgentMessage | undefined;
    if (id === undefined || !msg) {
      continue;
    }
    if (msg.role === "user") {
      continue;
    }
    if (msg.role === "assistant") {
      result.push(convertAssistantMessage(id, msg));
    } else if (msg.role === "toolResult") {
      mergeToolResult(result, msg);
    }
  }
  return result;
}
