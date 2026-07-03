import type { MessagePart, UIMessage } from "~/stores/types.ts";

export type ThinkingMessagePart = Extract<MessagePart, { type: "thinking" }>;

/** Filter out thinking parts, returning only the parts that should render inline. */
export function getNonThinkingParts(parts: MessagePart[]): MessagePart[] {
  return parts.filter((p) => p.type !== "thinking");
}

/**
 * Flatten all parts from all messages into a single ordered array.
 * The individual part references are preserved (no cloning), so a list keyed
 * by `<For>` over these parts keeps stable identity per part.
 */
export function flattenParts(messages: UIMessage[]): MessagePart[] {
  return messages.flatMap((msg) => msg.parts);
}
