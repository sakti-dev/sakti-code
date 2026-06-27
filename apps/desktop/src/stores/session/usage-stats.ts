import type { AgentMessage } from "@sakti-code/agent";
import type { UIMessage } from "../types.ts";

/**
 * Extract our flat {@link UIMessage.usage} from an agent AssistantMessage's
 * nested usage (input/output/cost.total, plus optional reasoningTokens).
 * Returns `undefined` when the message carries no usage.
 */
export function extractUsage(msg: AgentMessage): UIMessage["usage"] {
  if (!("usage" in msg && msg.usage)) {
    return;
  }
  const raw = msg.usage as {
    cost: { total: number };
    input: number;
    output: number;
    reasoningTokens?: number;
  };
  return {
    cost: raw.cost.total,
    input: raw.input,
    output: raw.output,
    ...(raw.reasoningTokens === undefined
      ? {}
      : { reasoningTokens: raw.reasoningTokens }),
  };
}

/**
 * Aggregated token/cost totals across a session's messages, for the composer
 * footer summary. All fields are sums over assistant `usage`; `cost` is USD.
 */
export interface SessionUsageStats {
  cost: number;
  input: number;
  output: number;
  reasoningTokens: number;
}

export function aggregateUsage(
  messages: Record<string, UIMessage>
): SessionUsageStats {
  let cost = 0;
  let input = 0;
  let output = 0;
  let reasoningTokens = 0;
  for (const msg of Object.values(messages)) {
    if (msg.role !== "assistant" || !msg.usage) {
      continue;
    }
    cost += msg.usage.cost;
    input += msg.usage.input;
    output += msg.usage.output;
    reasoningTokens += msg.usage.reasoningTokens ?? 0;
  }
  return { cost, input, output, reasoningTokens };
}

/** Format a token count with thousands separators, e.g. 12345 → "12.3k". */
export function formatTokens(n: number): string {
  if (n < 1000) {
    return String(n);
  }
  return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
}

/** Format USD cost compactly: $0, $0.0012, $1.23. */
export function formatCost(usd: number): string {
  if (usd <= 0) {
    return "$0";
  }
  if (usd < 0.01) {
    return `$${usd.toFixed(4)}`;
  }
  return `$${usd.toFixed(2)}`;
}
