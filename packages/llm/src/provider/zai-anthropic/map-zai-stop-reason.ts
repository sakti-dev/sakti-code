import type { LanguageModelV4FinishReason } from "@ai-sdk/provider";

/**
 * Map Z.ai's `stop_reason` (Anthropic-shaped) to the V4 unified finish reason.
 *
 * Ported from `@ai-sdk/anthropic/map-anthropic-stop-reason.ts`. `pause_turn`
 * (a compaction-related pause) is treated as `stop` — Z.ai surfaces it on
 * context-management boundaries.
 *
 * @see https://docs.anthropic.com/en/api/messages#response-stop-reason
 */
export function mapZaiStopReason({
  finishReason,
}: {
  finishReason: string | null | undefined;
}): LanguageModelV4FinishReason["unified"] {
  switch (finishReason) {
    case "pause_turn":
    case "end_turn":
    case "stop_sequence":
      return "stop";
    case "refusal":
      return "content-filter";
    case "tool_use":
      return "tool-calls";
    case "max_tokens":
    case "model_context_window_exceeded":
      return "length";
    default:
      return "other";
  }
}
