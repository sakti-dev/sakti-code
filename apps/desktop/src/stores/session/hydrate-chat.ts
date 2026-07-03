import type { AgentMessage } from "@sakti-code/agent";
import type { Turn, UIMessage } from "../types.ts";
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

/**
 * Convert the summaries-only `/chat` response into Turn[] for the store.
 * Each turn gets its user message + summary assistant message.
 */
export function hydrateChatTurns(chatTurns: ChatTurnDTO[]): Turn[] {
  const turns: Turn[] = [];

  for (const ct of chatTurns) {
    const userEntry = asEntry(ct.userMessage);
    const summaryEntry = asEntry(ct.summaryMessage);

    const userMessageId = userEntry?.id ?? null;

    let userMessage: UIMessage | null = null;
    if (userEntry) {
      userMessage = convertUserMessage(userEntry.id, userEntry.message);
    }

    const messages: UIMessage[] = [];
    if (summaryEntry) {
      messages.push(convertAssistantMessage(summaryEntry.id, summaryEntry.message));
    }

    turns.push({
      endedAt: ct.endedAt,
      error: null,
      id: ct.id,
      intermediateCount: ct.intermediateIds.length,
      intermediatesLoaded: false,
      loadedMessageIds: [],
      messages,
      startedAt: ct.startedAt,
      turnId: ct.id,
      userMessage,
      working: false,
    });

    // Suppress unused var warning
    void userMessageId;
  }

  return turns;
}

/**
 * Convert one turn's intermediate entries (from
 * `/turns/:turnId/intermediates`) into UIMessages. User messages are
 * skipped (shipped via `/chat`); tool results are merged into preceding
 * assistant tool-call parts. Entry ids are reused as UIMessage ids so
 * {@link evictIntermediates} can remove them precisely.
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
