/**
 * Observational Memory Observer.
 *
 * Ports Mastra's ObserverRunner to sakti's AgentMessage + @sakti-code/llm
 * complete() one-shot. Extracts new observations from un-observed messages.
 */

import { complete } from "@sakti-code/llm";
import type { AgentMessage } from "../types.ts";
import type { ObservationalMemoryDeps } from "./config.ts";
import {
  buildObserverHistoryMessage,
  buildObserverSystemPrompt,
  parseReflectorOutput,
} from "./prompts.ts";

export interface ObserverInput {
  readonly messagesToObserve: AgentMessage[];
  readonly existingObservations: string;
  readonly deps: ObservationalMemoryDeps;
  readonly abortSignal?: AbortSignal;
}

export interface ObserverResult {
  readonly observations: string;
  readonly suggestedContinuation?: string;
  readonly tokenCount: number;
}

export class ObservationError extends Error {
  readonly _tag = "ObservationError";
  constructor(message: string) {
    super(message);
    this.name = "ObservationError";
  }
}

/**
 * Run the Observer over a batch of un-observed messages.
 *
 * The observer prompt already bundles the task instructions inside the
 * history message, so the user message is just the formatted history.
 */
export async function runObserver(input: ObserverInput): Promise<ObserverResult> {
  const { messagesToObserve, deps, abortSignal } = input;

  const system = buildObserverSystemPrompt(deps.instruction);
  const historyMessage = buildObserverHistoryMessage(messagesToObserve);
  const messages = [
    { role: "user" as const, content: historyMessage.content, timestamp: Date.now() },
  ];

  const result = await complete({
    model: deps.observeModel,
    apiKey: deps.observeApiKey,
    messages,
    system,
    ...(deps.observeThinkingLevel === undefined
      ? {}
      : { thinkingLevel: deps.observeThinkingLevel }),
    ...(abortSignal ? { abortSignal } : {}),
  });

  if (result.finishReason === "error") {
    throw new ObservationError(result.errorMessage ?? "Observer completion failed");
  }

  const rawText = result.content.map((c) => (c.type === "text" ? c.text : "")).join("");
  const parsed = parseReflectorOutput(rawText);

  const observations = parsed.observations;
  const tokenCount = deps.tokenCounter.countObservations(observations);

  return {
    observations,
    ...(parsed.suggestedContinuation !== undefined
      ? { suggestedContinuation: parsed.suggestedContinuation }
      : {}),
    tokenCount,
  };
}
