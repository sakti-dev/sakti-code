import type { MessagePart } from "~/stores/types.ts";
import { normalizeToolName } from "./store.tsx";

export const PATH_MAX_LENGTH = 50;

const HASHLINE_PATH_RE = /^\[([^\]]+?)#[0-9A-Fa-f]{4}\]/m;

export type ToolCallPart = Extract<MessagePart, { type: "tool_call" }>;

export function getArgs(part: { args?: Record<string, unknown> }): Record<string, unknown> {
  return part.args ?? {};
}

/** Extract a filePath/path from a part's args (read, write, edit standard mode). */
export function extractPath(part: { args?: Record<string, unknown> }): string | undefined {
  const args = getArgs(part);
  return (
    (typeof args.filePath === "string" ? args.filePath : undefined) ??
    (typeof args.path === "string" ? args.path : undefined)
  );
}

export function extractHashlinePath(input: string): string | undefined {
  return HASHLINE_PATH_RE.exec(input)?.[1];
}

/**
 * Adapter from a store ToolCallPart proxy to the formatter-friendly shape.
 * Uses getters so reads of part.result/part.details stay reactive (Solid tracks
 * property access on the store proxy) — a single instance updates on completion
 * without remount.
 */
export function toToolPartData(part: ToolCallPart): {
  tool: string;
  args?: Record<string, unknown>;
  output?: unknown;
  details?: unknown;
} {
  return {
    get tool() {
      return normalizeToolName(part.toolName);
    },
    get args() {
      return (part.input ?? {}) as Record<string, unknown>;
    },
    get output() {
      return part.result;
    },
    get details() {
      return part.details;
    },
  };
}
