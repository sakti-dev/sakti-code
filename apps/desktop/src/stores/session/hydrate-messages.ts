import type { AgentMessage } from "@sakti-code/agent";
import type { MessagePart, UIMessage } from "../types.ts";
import { convertAssistantMessage, convertUserMessage, mergeToolResult } from "./hydrate-helpers.ts";

export function hydrateSessionMessages(messages: AgentMessage[]): UIMessage[] {
  const result: UIMessage[] = [];

  for (const msg of messages) {
    if (msg.role === "user") {
      result.push(convertUserMessage(crypto.randomUUID(), msg));
    } else if (msg.role === "assistant") {
      result.push(convertAssistantMessage(crypto.randomUUID(), msg));
    } else if (msg.role === "toolResult") {
      mergeToolResult(result, msg);
    } else if (msg.role === "custom" && "customType" in msg && msg.customType === "om_marker") {
      const details = (msg as { details?: Record<string, unknown> }).details;
      if (!details) continue;

      // Find the last assistant UIMessage to attach the marker to.
      let lastAssistant: UIMessage | undefined;
      for (let i = result.length - 1; i >= 0; i--) {
        if (result[i]!.role === "assistant") {
          lastAssistant = result[i];
          break;
        }
      }
      if (!lastAssistant) continue;

      const rawStatus = details.status as string;
      const status =
        rawStatus === "loading" || rawStatus === "buffering" ? "disconnected" : rawStatus;

      lastAssistant.parts.push({
        type: "om_marker",
        cycleId: details.cycleId as string,
        operationType: details.operationType as "observation" | "reflection" | "buffering",
        status: status as MessagePart extends { type: "om_marker" } ? MessagePart["status"] : never,
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

  return result;
}
