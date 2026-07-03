import type { MessagePart } from "~/stores/types.ts";
import { normalizeToolName } from "../tools/tool-name.ts";

export type ToolCallPart = Extract<MessagePart, { type: "tool_call" }>;

const EXPLORE_TOOLS = new Set(["read", "grep", "glob", "find", "ls"]);

function isExploreTool(part: MessagePart): boolean {
  if (part.type !== "tool_call") {
    return false;
  }
  return EXPLORE_TOOLS.has(normalizeToolName(part.toolName));
}

export type TimelineItem =
  | { kind: "single"; part: MessagePart }
  | { kind: "explore"; parts: ToolCallPart[] };

/**
 * Group consecutive explore tools (read, grep, glob, find, ls) into a single
 * "explore" item when 2+ appear in a row. Other parts break the run and become
 * "single" items. The exact part references are preserved (no cloning).
 */
export function groupTimelineParts(parts: MessagePart[]): TimelineItem[] {
  const items: TimelineItem[] = [];
  let i = 0;

  while (i < parts.length) {
    if (isExploreTool(parts[i]!)) {
      const group: ToolCallPart[] = [];
      while (i < parts.length && isExploreTool(parts[i]!)) {
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
