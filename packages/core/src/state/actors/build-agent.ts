/**
 * Build agent XState actor
 *
 * This module provides the build agent that runs during the
 * implement and validate phases for code generation and testing.
 *
 * Uses glm-4.7-flash (fast, optimized for code) for implementation.
 * Safety limits: implement 50, validate 100 iterations (intent-based).
 */

import type { LanguageModelV3Message } from "@ai-sdk/provider";
import { createLogger } from "@ekacode/shared/logger";
import { streamText } from "ai";
import { fromPromise } from "xstate";
import { buildModel } from "../integration/model-provider";
import { BUILD_PHASE_NOTICES } from "../prompts/build-prompts";
import { getImplementToolMap, getValidateToolMap } from "../tools/phase-tools";
import type { AgentRuntime, BuildPhase, Message, MessageRole } from "../types";
import { PHASE_SAFETY_LIMITS, toCoreMessages } from "../types";
import { isTestMode, throwIfAborted } from "./runtime";

const logger = createLogger("core:build-agent");

/**
 * Input interface for build agent
 */
export interface BuildAgentInput {
  messages: Array<Message>;
  phase: BuildPhase;
  runtime?: AgentRuntime;
}

/**
 * Output interface for build agent
 */
export interface BuildAgentOutput {
  output: string;
  finishReason: string | null | undefined;
  messages: Array<Message>;
}

/**
 * Get tool map for a specific build phase
 */
function getToolMapForPhase(phase: BuildPhase): Record<string, unknown> {
  switch (phase) {
    case "implement":
      return getImplementToolMap();
    case "validate":
      return getValidateToolMap();
  }
}

/**
 * Convert CoreMessage back to our Message type
 * Handles both LanguageModelV3Message and ResponseMessage types
 */
function fromCoreMessages(messages: unknown): Array<Message> {
  const msgs = messages as Array<{
    role: string;
    content: string | unknown;
    toolCalls?: Array<{ toolCallId: string; toolName: string; args: Record<string, unknown> }>;
    toolCallId?: string;
    result?: unknown;
  }>;

  return msgs.map(msg => {
    const base = {
      role: msg.role as MessageRole,
      content: String(msg.content ?? ""),
    };

    if (base.role === "assistant" && msg.toolCalls && msg.toolCalls.length > 0) {
      return {
        ...base,
        role: "assistant" as const,
        toolCalls: msg.toolCalls.map(toolCall => ({
          toolCallId: toolCall.toolCallId,
          toolName: toolCall.toolName,
          args: toolCall.args,
        })),
      };
    }

    if (base.role === "tool") {
      return {
        ...base,
        role: "tool" as const,
        toolCallId: String(msg.toolCallId ?? ""),
        result: msg.result,
      };
    }

    return base;
  });
}

/**
 * Run build agent actor
 *
 * Uses glm-4.7-flash for fast, high-quality code generation.
 * Safety limits: implement 50, validate 100 iterations (intent-based).
 *
 * @returns XState actor logic for the build agent
 */
export const runBuildAgent = fromPromise(async ({ input }: { input: BuildAgentInput }) => {
  const { messages, phase, runtime } = input;

  if (isTestMode(runtime)) {
    const output =
      phase === "validate"
        ? "Build successful (test mode)"
        : `[Build Agent:${phase}] Test mode output`;
    return {
      output,
      finishReason: "stop",
      messages: [],
    } as BuildAgentOutput;
  }

  throwIfAborted(runtime);
  const safetyLimit = PHASE_SAFETY_LIMITS[phase];

  // Get tool map for the phase
  const toolMap = getToolMapForPhase(phase);

  // Get system prompt for the phase
  const systemPrompt = BUILD_PHASE_NOTICES[phase];

  let currentMessages = [...messages, { role: "system" as const, content: systemPrompt }];
  let iterationCount = 0;
  let finishReason: string | null | undefined = null;
  let fullResponse = "";

  // Multi-turn loop with intent-based completion
  while (iterationCount < safetyLimit) {
    throwIfAborted(runtime);
    iterationCount++;

    // Convert our messages to CoreMessage format for AI SDK v6
    const coreMessages = toCoreMessages(currentMessages) as LanguageModelV3Message[];

    // Call the model with streamText
    const result = await streamText({
      model: buildModel,
      messages: coreMessages,
      tools: toolMap as any, // eslint-disable-line @typescript-eslint/no-explicit-any -- AI SDK ToolSet type incompatibility
    });

    // Consume the text stream
    for await (const chunk of result.textStream) {
      fullResponse += chunk;
    }

    // Get final response with finishReason and messages
    // finishReason and response are promises that resolve
    finishReason = await result.finishReason;
    const finalResponse = await result.response;

    // Convert CoreMessage back to our Message type
    currentMessages = fromCoreMessages(finalResponse.messages);

    // Check if we should continue (intent-based)
    if (finishReason === "stop") {
      logger.info(`${phase} phase complete (${iterationCount} iterations)`, { phase });
      break;
    }
    if (finishReason === "tool-calls") {
      // Continue to next iteration for more tool calls
      continue;
    }
    if (iterationCount >= safetyLimit) {
      logger.warn(`${phase} phase safety limit reached (${safetyLimit} iterations)`, { phase });
      break;
    }
  }

  return {
    output: fullResponse,
    finishReason,
    messages: currentMessages,
  } as BuildAgentOutput;
});
