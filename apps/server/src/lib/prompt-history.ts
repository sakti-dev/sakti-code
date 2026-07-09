import type { AgentMessage } from "@sakti-code/agent";

function extractUserText(message: AgentMessage): string {
  if (!("content" in message)) {
    return "";
  }
  const { content } = message;
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .filter(
        (c): c is { type: "text"; text: string } =>
          c !== null && typeof c === "object" && "type" in c && c.type === "text",
      )
      .map((c) => c.text)
      .join("");
  }
  return "";
}

interface MessageLike {
  type: string;
  message?: AgentMessage;
}

/**
 * Parse message-entry content rows (already ordered newest-first by the repo)
 * into a deduped list of user prompt texts. Non-user and non-message rows are
 * skipped; empty/whitespace-only text is dropped; exact duplicates collapse to
 * their newest occurrence (the first seen, since rows arrive newest-first).
 */
export function extractPromptsFromEntries(rows: { content: string }[]): string[] {
  const seen = new Set<string>();
  const prompts: string[] = [];
  for (const row of rows) {
    let entry: MessageLike;
    try {
      entry = JSON.parse(row.content) as MessageLike;
    } catch {
      continue;
    }
    if (entry.type !== "message") {
      continue;
    }
    const msg = entry.message;
    if (!msg || msg.role !== "user") {
      continue;
    }
    const text = extractUserText(msg).trim();
    if (!text || seen.has(text)) {
      continue;
    }
    seen.add(text);
    prompts.push(text);
  }
  return prompts;
}
