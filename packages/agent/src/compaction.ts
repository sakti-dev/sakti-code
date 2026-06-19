export function shouldCompact(tokens: number, contextWindow: number, reserveTokens: number): boolean {
  return tokens >= contextWindow - reserveTokens;
}

export function estimateTokens(messages: Array<{ content: string | any[] }>): number {
  let total = 0;
  for (const msg of messages) {
    if (typeof msg.content === "string") {
      total += msg.content.length;
    } else if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (typeof block === "string") total += block.length;
        else if ("text" in block && typeof block.text === "string") total += block.text.length;
        else if ("thinking" in block && typeof block.thinking === "string") total += block.thinking.length;
        else if ("arguments" in block && block.arguments) total += JSON.stringify(block.arguments).length;
      }
    }
  }
  // Rough: 4 chars per token
  return Math.ceil(total / 4);
}

import { completeSimple } from "@earendil-works/pi-ai";
import type { AgentMessage } from "./types.ts";

const SUMMARIZE_SYSTEM_PROMPT = `You are a context summarization assistant. Produce a structured summary. Do NOT continue the conversation.`;

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
  tokensBefore: number;
  tokensAfter: number;
}

export interface CompactionOptions {
  model: import("@earendil-works/pi-ai").Model<any>;
  apiKey: string;
  messages: AgentMessage[];
  contextWindow: number;
  reserveTokens?: number;
  keepRecentTokens?: number;
  signal?: AbortSignal;
}

function messageToText(msg: AgentMessage): string {
  if (msg.role === "user") return `User: ${msg.content}`;
  if (msg.role === "assistant") {
    const text = (msg.content as Array<{ type: string; text?: string }>)
      .filter((b) => b.type === "text" && b.text)
      .map((b) => b.text)
      .join("\n");
    return `Assistant: ${text}`;
  }
  if (msg.role === "tool") {
    return `Tool (${msg.toolName}): ${(msg.content as Array<{ text: string }>).map((c) => c.text).join("")}`;
  }
  return "";
}

export async function compactMessages(options: CompactionOptions): Promise<CompactionResult> {
  const {
    model, apiKey, messages,
    reserveTokens = 16_000, keepRecentTokens = 20_000, signal,
  } = options;

  const tokensBefore = estimateTokens(messages);

  // Find cut point: keep recent messages up to keepRecentTokens
  let cutIndex = messages.length;
  let recentTokens = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    recentTokens += estimateTokens([messages[i]!]);
    if (recentTokens >= keepRecentTokens) {
      cutIndex = i;
      break;
    }
  }

  if (cutIndex <= 1) {
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
      messages: [{ role: "user", content: summaryPrompt, timestamp: Date.now() }],
    },
    {
      maxTokens: Math.floor(reserveTokens * 0.8),
      apiKey,
      ...(signal ? { signal } : {}),
    },
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
