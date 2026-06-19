import type { AgentEvent } from "../types.ts";

export function evt(
  type: AgentEvent["type"] & string,
  extra: Record<string, unknown> = {}
): AgentEvent {
  return {
    type: type as AgentEvent["type"],
    timestamp: Date.now(),
    ...extra,
  } as AgentEvent;
}

export interface ToolCallInfo {
  arguments: Record<string, unknown>;
  id: string;
  name: string;
}
