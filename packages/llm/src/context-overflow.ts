import type { AssistantMessage } from "./types.ts";

/**
 * Regex patterns that detect context-overflow errors from different providers.
 *
 * Ported `[PORT]` from `openspec/references/pi/packages/ai/src/utils/overflow.ts`.
 * A message whose `errorMessage` matches any of these (and none of the
 * {@link NON_OVERFLOW_PATTERNS}) is treated as a context overflow.
 *
 * Provider-specific examples are documented inline; the bank covers Anthropic,
 * OpenAI/LiteLLM, Bedrock, Gemini, xAI, Groq, OpenRouter, Together, llama.cpp,
 * LM Studio, Copilot, MiniMax, Kimi, Mistral, z.ai, Ollama, Cerebras, plus
 * generic fallbacks.
 */
const OVERFLOW_PATTERNS = [
  /prompt is too long/i,
  /request_too_large/i,
  /input is too long for requested model/i,
  /exceeds the context window/i,
  /exceeds (?:the )?(?:model'?s )?maximum context length(?: of [\d,]+ tokens?|\s*\([\d,]+\))/i,
  /input token count.*exceeds the maximum/i,
  /maximum prompt length is \d+/i,
  /reduce the length of the messages/i,
  /maximum context length is \d+ tokens/i,
  /exceeds (?:the )?maximum allowed input length of [\d,]+ tokens?/i,
  /input \(\d+ tokens\) is longer than the model'?s context length \(\d+ tokens\)/i,
  /exceeds the limit of \d+/i,
  /exceeds the available context size/i,
  /greater than the context length/i,
  /context window exceeds limit/i,
  /exceeded model token limit/i,
  /too large for model with \d+ maximum context length/i,
  /model_context_window_exceeded/i,
  /prompt too long; exceeded (?:max )?context length/i,
  /context[_ ]length[_ ]exceeded/i,
  /too many tokens/i,
  /token limit exceeded/i,
  /^4(?:00|13)\s*(?:status code)?\s*\(no body\)/i,
];

/**
 * Patterns indicating non-overflow errors (rate limiting / server errors). An
 * error matching any of these is excluded from overflow detection even if it
 * also matches an {@link OVERFLOW_PATTERNS} entry (e.g. Bedrock throttling
 * "Too many tokens, please wait").
 */
const NON_OVERFLOW_PATTERNS = [
  /^(Throttling error|Service unavailable):/i,
  /rate limit/i,
  /too many requests/i,
];

/**
 * Decide whether an assistant message represents a context overflow.
 *
 * Three detection cases `[PORT]` from pi's `isContextOverflow`:
 *
 * 1. **Error message** — `stopReason:"error"` whose `errorMessage` matches an
 *    overflow pattern and not a non-overflow pattern.
 * 2. **Silent overflow** (z.ai) — `stopReason:"stop"` with
 *    `usage.input + usage.cacheRead > contextWindow`. z.ai accepts oversized
 *    requests and returns success, so usage is the only signal.
 * 3. **Length-stop overflow** (Xiaomi MiMo) — `stopReason:"length"` with
 *    `usage.output === 0` and `input + cacheRead >= contextWindow * 0.99`
 *    (the server truncated input to fill the window, leaving no output room).
 *
 * @param contextWindow - The model's context window. Required for cases 2 & 3;
 *   omit to only detect case 1 (error-message patterns).
 */
export function isContextOverflow(
  message: AssistantMessage,
  contextWindow?: number
): boolean {
  // Case 1: error message patterns.
  if (message.stopReason === "error" && message.errorMessage) {
    const errorMessage = message.errorMessage;
    const isNonOverflow = NON_OVERFLOW_PATTERNS.some((p) =>
      p.test(errorMessage)
    );
    if (!isNonOverflow && OVERFLOW_PATTERNS.some((p) => p.test(errorMessage))) {
      return true;
    }
  }

  // Case 2: silent overflow (z.ai style) — successful but usage exceeds context.
  if (contextWindow && message.stopReason === "stop") {
    const inputTokens = message.usage.input + message.usage.cacheRead;
    if (inputTokens > contextWindow) {
      return true;
    }
  }

  // Case 3: length-stop overflow (Xiaomi MiMo) — truncated input fills the
  // window leaving no room for output.
  if (
    contextWindow &&
    message.stopReason === "length" &&
    message.usage.output === 0
  ) {
    const inputTokens = message.usage.input + message.usage.cacheRead;
    if (inputTokens >= contextWindow * 0.99) {
      return true;
    }
  }

  return false;
}
