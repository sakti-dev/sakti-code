import type { MessagePart, UIMessage } from "~/stores/types.ts";

export type ThinkingPart = Extract<MessagePart, { type: "thinking" }>;

/**
 * Extract all thinking parts with non-empty text from a list of messages,
 * preserving message order.
 */
export function getThinkingParts(messages: UIMessage[]): ThinkingPart[] {
  return messages.flatMap((msg) =>
    msg.parts.filter((p): p is ThinkingPart => p.type === "thinking" && p.text.trim() !== ""),
  );
}

/** Filter out thinking parts, returning only the parts that should render inline. */
export function getNonThinkingParts(parts: MessagePart[]): MessagePart[] {
  return parts.filter((p) => p.type !== "thinking");
}
