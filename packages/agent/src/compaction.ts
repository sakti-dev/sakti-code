export function shouldCompact(
  tokens: number,
  contextWindow: number,
  reserveTokens: number
): boolean {
  return tokens >= contextWindow - reserveTokens;
}

function contentTokenEstimate(content: string | unknown[]): number {
  if (typeof content === "string") {
    return content.length;
  }
  if (!Array.isArray(content)) {
    return 0;
  }

  let total = 0;
  for (const block of content) {
    if (typeof block === "string") {
      total += block.length;
    } else if (block !== null && typeof block === "object") {
      const b = block as Record<string, unknown>;
      if (typeof b.text === "string") {
        total += b.text.length;
      } else if (typeof b.thinking === "string") {
        total += b.thinking.length;
      } else if (b.arguments) {
        total += JSON.stringify(b.arguments).length;
      }
    }
  }
  return total;
}

export function estimateTokens(
  messages: Array<{ content: string | unknown[] }>
): number {
  let total = 0;
  for (const msg of messages) {
    total += contentTokenEstimate(msg.content);
  }
  // Rough: 4 chars per token
  return Math.ceil(total / 4);
}

import { completeSimple } from "@earendil-works/pi-ai";
import type { AgentMessage } from "./types.ts";

/**
 * Estimate the current context size using the provider-reported usage from the
 * most recent assistant message when available, plus a char/4 estimate for any
 * messages appended after it. Falls back to a pure char/4 estimate over all
 * messages when no assistant usage exists (e.g. the first turn). Mirrors the
 * proven pi agent's `estimateContextTokens` so the auto-compaction threshold
 * keys off a real token count rather than a systematic char/4 guess.
 */
export function estimateContextTokens(messages: AgentMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && m.role === "assistant") {
      // Skip errored or aborted turns — their usage is garbage
      // (pi getAssistantUsage: compaction.ts:144-152)
      if (m.stopReason === "error" || m.stopReason === "aborted") {
        continue;
      }
      const u = m.usage;
      const usageTokens =
        u?.totalTokens ||
        (u ? u.input + u.output + u.cacheRead + u.cacheWrite : 0);
      if (usageTokens > 0) {
        return usageTokens + estimateTokens(messages.slice(i + 1));
      }
    }
  }
  return estimateTokens(messages);
}

const SUMMARIZE_SYSTEM_PROMPT =
  "You are a context summarization assistant. Produce a structured summary. Do NOT continue the conversation.";

const SUMMARIZE_PROMPT = `Create a structured context checkpoint summary:

## Goal
[What is the user trying to accomplish?]

## Progress
### Done
- [x] [Completed tasks]

### In Progress
- [ ] [Current work]

## Key Decisions
- **[Decision]**: [Rationale]

## Next Steps
1. [What should happen next]

## Critical Context
- [File paths, function names, error messages needed to continue]

Keep each section concise. Preserve exact file paths, function names, and error messages.`;

export interface CompactionResult {
  messages: AgentMessage[];
  tokensAfter: number;
  tokensBefore: number;
}

export interface CompactionOptions {
  apiKey: string;
  contextWindow: number;
  keepRecentTokens?: number;
  messages: AgentMessage[];
  // biome-ignore lint/suspicious/noExplicitAny: Model<TApi> is generic over provider API; AnyModel intentionally accepts any
  model: import("@earendil-works/pi-ai").Model<any>;
  reserveTokens?: number;
  signal?: AbortSignal;
}

const TOOL_RESULT_MAX_CHARS = 2000;

function truncateForSummary(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  const truncatedChars = text.length - maxChars;
  return `${text.slice(0, maxChars)}\n\n[... ${truncatedChars} more characters truncated]`;
}

function serializeAssistant(msg: AgentMessage): string {
  const blocks = msg.content as Array<
    | { type: "text"; text: string }
    | { type: "thinking"; thinking: string }
    | { type: "toolCall"; name: string; arguments: Record<string, unknown> }
  >;
  const thinkingParts: string[] = [];
  const textParts: string[] = [];
  const toolCalls: string[] = [];

  for (const block of blocks) {
    if (block.type === "text") {
      textParts.push(block.text);
    } else if (block.type === "thinking") {
      thinkingParts.push(block.thinking);
    } else if (block.type === "toolCall") {
      const args = block.arguments as Record<string, unknown>;
      const argsStr = Object.entries(args)
        .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
        .join(", ");
      toolCalls.push(`${block.name}(${argsStr})`);
    }
  }

  const parts: string[] = [];
  if (thinkingParts.length > 0) {
    parts.push(`[Assistant thinking]: ${thinkingParts.join("\n")}`);
  }
  if (textParts.length > 0) {
    parts.push(`[Assistant]: ${textParts.join("\n")}`);
  }
  if (toolCalls.length > 0) {
    parts.push(`[Assistant tool calls]: ${toolCalls.join("; ")}`);
  }
  return parts.join("\n\n");
}

export function messageToText(msg: AgentMessage): string {
  if (msg.role === "user") {
    if (!msg.content) {
      return "";
    }
    return `[User]: ${msg.content}`;
  }
  if (msg.role === "assistant") {
    return serializeAssistant(msg);
  }
  if (msg.role === "tool") {
    const content = (msg.content as Array<{ text: string }>)
      .map((c) => c.text)
      .join("");
    if (!content) {
      return "";
    }
    return `[Tool result]: ${truncateForSummary(content, TOOL_RESULT_MAX_CHARS)}`;
  }
  return "";
}

export async function compactMessages(
  options: CompactionOptions
): Promise<CompactionResult> {
  const {
    model,
    apiKey,
    messages,
    reserveTokens = 16_000,
    keepRecentTokens = 20_000,
    signal,
  } = options;

  const tokensBefore = estimateTokens(messages);

  // Find cut point: keep recent messages up to keepRecentTokens
  let cutIndex = messages.length;
  let recentTokens = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!msg) {
      continue;
    }
    recentTokens += estimateTokens([msg]);
    if (recentTokens >= keepRecentTokens) {
      cutIndex = i;
      break;
    }
  }
  // Advance past any tool results to avoid orphaning (pi findValidCutPoints)
  while (cutIndex < messages.length && messages[cutIndex]?.role === "tool") {
    cutIndex++;
  }

  if (cutIndex <= 1 || cutIndex >= messages.length) {
    return { messages, tokensBefore, tokensAfter: tokensBefore };
  }

  const historyMessages = messages.slice(0, cutIndex);
  const recentMessages = messages.slice(cutIndex);

  const conversationText = historyMessages.map(messageToText).join("\n\n");
  const summaryPrompt = `<conversation>\n${conversationText}\n</conversation>\n\n${SUMMARIZE_PROMPT}`;

  const response = await completeSimple(
    model,
    {
      systemPrompt: SUMMARIZE_SYSTEM_PROMPT,
      messages: [
        { role: "user", content: summaryPrompt, timestamp: Date.now() },
      ],
    },
    {
      maxTokens: Math.floor(reserveTokens * 0.8),
      apiKey,
      ...(signal ? { signal } : {}),
    }
  );

  if (response.stopReason === "error" || response.stopReason === "aborted") {
    return { messages, tokensBefore, tokensAfter: tokensBefore };
  }

  const summaryText = response.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("\n");

  const summaryMessage: AgentMessage = {
    role: "user",
    content: `[Session Summary]\n\n${summaryText}`,
    timestamp: Date.now(),
  };

  const compacted = [summaryMessage, ...recentMessages];
  const tokensAfter = estimateTokens(compacted);

  return { messages: compacted, tokensBefore, tokensAfter };
}
