import type { StreamRequest } from "@sakti-code/llm";
import type { Logger } from "@sakti-code/logger";

export function buildHarnessStreamRequest(
  req: StreamRequest,
  opts: {
    headers?: Record<string, string>;
    logger?: Logger;
    sessionId: string;
    apiKey?: string;
  }
): StreamRequest {
  const apiKey = opts.apiKey ?? req.apiKey;
  return {
    model: req.model,
    messages: req.messages,
    sessionId: opts.sessionId,
    ...(req.system ? { system: req.system } : {}),
    ...(req.tools ? { tools: req.tools } : {}),
    ...(req.thinkingLevel ? { thinkingLevel: req.thinkingLevel } : {}),
    ...(apiKey ? { apiKey } : {}),
    ...(opts.headers ? { headers: opts.headers } : {}),
    ...(req.maxOutputTokens ? { maxOutputTokens: req.maxOutputTokens } : {}),
    ...(req.toolChoice ? { toolChoice: req.toolChoice } : {}),
    ...(req.baseURL ? { baseURL: req.baseURL } : {}),
    ...(req.temperature === undefined ? {} : { temperature: req.temperature }),
    ...(req.topP === undefined ? {} : { topP: req.topP }),
    ...(req.abortSignal ? { abortSignal: req.abortSignal } : {}),
    ...(opts.logger === undefined ? {} : { logger: opts.logger }),
  };
}
