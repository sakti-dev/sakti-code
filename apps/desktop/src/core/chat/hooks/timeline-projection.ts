import type { Part } from "@sakti-code/shared/event-types";
import type { ChatMessage } from "./use-messages";

export type ChatTimelineItem =
  | {
      kind: "user";
      key: string;
      ts: number;
      messageId: string;
      sessionId: string;
      text: string;
    }
  | {
      kind: "assistant";
      key: string;
      ts: number;
      messageId: string;
      sessionId: string;
      parts: Part[];
    };

function safeTimestamp(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function messageTimestamp(message: ChatMessage): number {
  if (safeTimestamp(message.createdAt) > 0) return safeTimestamp(message.createdAt);
  for (const part of message.parts) {
    const time = typeof part.time === "object" && part.time !== null ? part.time : undefined;
    const start = safeTimestamp((time as { start?: unknown } | undefined)?.start);
    if (start > 0) return start;
  }
  return 0;
}

function textFromParts(parts: Part[]): string {
  return parts
    .filter(part => part.type === "text")
    .map(part => (typeof part.text === "string" ? part.text : ""))
    .join("");
}

export function toTimeline(messages: ChatMessage[]): ChatTimelineItem[] {
  const items: ChatTimelineItem[] = [];

  for (const message of messages) {
    const ts = messageTimestamp(message);
    if (message.role === "user") {
      items.push({
        kind: "user",
        key: `user:${message.id}`,
        ts,
        messageId: message.id,
        sessionId: message.sessionId,
        text: textFromParts(message.parts),
      });
      continue;
    }

    if (message.role === "assistant") {
      items.push({
        kind: "assistant",
        key: `assistant:${message.id}`,
        ts,
        messageId: message.id,
        sessionId: message.sessionId,
        parts: message.parts,
      });
    }
  }

  items.sort((a, b) => {
    if (a.ts !== b.ts) return a.ts - b.ts;
    return a.key.localeCompare(b.key);
  });

  return items;
}
