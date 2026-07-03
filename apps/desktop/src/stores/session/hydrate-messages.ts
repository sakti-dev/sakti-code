import type { AgentMessage } from "@sakti-code/agent";
import type { MessagePart, Turn } from "../types.ts";
import { convertAssistantMessage, convertUserMessage, mergeToolResult } from "./hydrate-helpers.ts";

/**
 * Convert a flat AgentMessage[] (from GET /sessions/:id/messages) into
 * Turn[] by grouping on user messages. Each user message starts a new
 * turn; subsequent assistant/toolResult messages belong to that turn.
 */
export function hydrateSessionTurns(messages: AgentMessage[]): Turn[] {
  const turns: Turn[] = [];
  let current: Turn | null = null;

  for (const msg of messages) {
    if (msg.role === "user") {
      if (current) {
        turns.push(current);
      }
      current = {
        endedAt: null,
        error: null,
        id: crypto.randomUUID(),
        intermediateCount: 0,
        intermediates: [],
        intermediatesLoaded: false,
        loadedMessageIds: [],
        summary: null,
        startedAt: typeof msg.timestamp === "number" ? msg.timestamp : Date.now(),
        turnId: null,
        userMessage: convertUserMessage(crypto.randomUUID(), msg),
        working: false,
      };
    } else if (msg.role === "assistant") {
      if (!current) {
        current = {
          endedAt: null,
          error: null,
          id: crypto.randomUUID(),
          intermediateCount: 0,
          intermediates: [],
          intermediatesLoaded: false,
          loadedMessageIds: [],
          summary: null,
          startedAt: null,
          turnId: null,
          userMessage: null,
          working: false,
        };
      }
      // Demote current summary to intermediates, set new summary
      if (current.summary) {
        current.intermediates.push(current.summary);
      }
      current.summary = convertAssistantMessage(crypto.randomUUID(), msg);
    } else if (msg.role === "toolResult") {
      if (current) {
        // Try summary first, then intermediates in reverse (mergeToolResult searches backward)
        const candidates = [
          ...(current.summary ? [current.summary] : []),
          ...[...current.intermediates].reverse(),
        ];
        mergeToolResult(candidates, msg);
      }
    } else if (msg.role === "custom" && "customType" in msg && msg.customType === "om_marker") {
      const details = (msg as { details?: Record<string, unknown> }).details;
      if (!details || !current) {
        continue;
      }

      const lastAssistant = current.summary;
      if (!lastAssistant) {
        continue;
      }

      const rawStatus = details.status as string;
      const status =
        rawStatus === "loading" || rawStatus === "buffering" ? "disconnected" : rawStatus;

      lastAssistant.parts.push({
        type: "om_marker",
        cycleId: details.cycleId as string,
        operationType: details.operationType as "observation" | "reflection" | "buffering",
        status: status as Extract<MessagePart, { type: "om_marker" }>["status"],
        ...(details.durationMs !== undefined ? { durationMs: details.durationMs as number } : {}),
        ...(details.tokensProcessed !== undefined
          ? { tokensProcessed: details.tokensProcessed as number }
          : {}),
        ...(details.tokensProduced !== undefined
          ? { tokensProduced: details.tokensProduced as number }
          : {}),
        ...(details.observations !== undefined
          ? { observations: details.observations as string }
          : {}),
        ...(details.currentTask !== undefined
          ? { currentTask: details.currentTask as string }
          : {}),
        ...(details.suggestedResponse !== undefined
          ? { suggestedResponse: details.suggestedResponse as string }
          : {}),
        ...(details.error !== undefined ? { error: details.error as string } : {}),
      });
    }
  }

  if (current) {
    turns.push(current);
  }

  return turns;
}
