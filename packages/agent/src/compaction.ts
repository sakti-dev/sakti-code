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
