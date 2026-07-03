import type { MessagePart } from "~/stores/types.ts";
import { isExploreTool, normalizeToolName } from "../tools/index.ts";

export type ToolCallPart = Extract<MessagePart, { type: "tool_call" }>;

function isExplorePart(part: MessagePart): boolean {
  return part.type === "tool_call" && isExploreTool(normalizeToolName(part.toolName));
}

export type TimelineItem =
  | { kind: "single"; part: MessagePart }
  | { kind: "explore"; parts: ToolCallPart[] };

/**
 * Group consecutive explore tools (read, grep, find) into a single "explore"
 * item when 2+ appear in a row. Other parts break the run and become "single"
 * items. Exact part references are preserved (no cloning).
 */
export function groupTimelineParts(parts: MessagePart[]): TimelineItem[] {
  const items: TimelineItem[] = [];
  let i = 0;

  while (i < parts.length) {
    if (isExplorePart(parts[i]!)) {
      const group: ToolCallPart[] = [];
      while (i < parts.length && isExplorePart(parts[i]!)) {
        group.push(parts[i] as ToolCallPart);
        i++;
      }
      if (group.length >= 2) {
        items.push({ kind: "explore", parts: group });
      } else {
        items.push({ kind: "single", part: group[0]! });
      }
    } else {
      items.push({ kind: "single", part: parts[i]! });
      i++;
    }
  }

  return items;
}
