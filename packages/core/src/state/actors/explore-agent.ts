/**
 * Explore agent XState actor
 *
 * This module provides the explore subagent that runs during the
 * analyze_code phase to efficiently explore the codebase.
 *
 * Uses glm-4.7-flashx (cost-effective) for read-only codebase exploration.
 * Safety limit: 5 iterations (single-shot preferred).
 */

import type { LanguageModelV3Message } from "@ai-sdk/provider";
import { createLogger } from "@ekacode/shared/logger";
import { streamText } from "ai";
import { fromPromise } from "xstate";
import { exploreModel } from "../integration/model-provider";
import { getExploreToolMap } from "../tools/phase-tools";
import type { AgentRuntime, Message, MessageRole } from "../types";
import { PHASE_SAFETY_LIMITS, toCoreMessages } from "../types";
import { isTestMode, throwIfAborted } from "./runtime";

const logger = createLogger("core:explore-agent");

/**
 * Input interface for explore agent
 */
export interface ExploreAgentInput {
  messages: Array<Message>;
  runtime?: AgentRuntime;
}

/**
 * Output interface for explore agent
 */
export interface ExploreAgentOutput {
  output: string;
  finishReason: string | null | undefined;
  messages: Array<Message>;
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
 * Spawn explore agent actor
 *
 * Uses glm-4.7-flashx for cost-effective codebase exploration.
 * Safety limit: 5 iterations (intended as single-shot, multi-turn only if needed).
 *
 * @returns XState actor logic for the explore agent
 */
export const spawnExploreAgent = fromPromise(async ({ input }: { input: ExploreAgentInput }) => {
  const { messages, runtime } = input;

  if (isTestMode(runtime)) {
    return {
      output: "[Explore Agent] Test mode output",
      finishReason: "stop",
      messages: [],
    } as ExploreAgentOutput;
  }

  throwIfAborted(runtime);
  const safetyLimit = PHASE_SAFETY_LIMITS.analyze_code;

  // Get tool map from phase-tools
  const toolMap = getExploreToolMap();

  // System prompt for explore agent
  const systemPrompt = `## 🔍 EXPLORE SUBAGENT

SPAWNED BY: Plan agent during analyze_code phase
MODEL: glm-4.7-flashx (cost-effective exploration)
TOOLS: Read-only tools (read, grep, glob, ls, astParse)

PURPOSE: Efficiently explore the codebase to understand:
- Project structure and organization
- Key files and their purposes
- Dependencies and relationships
- Patterns and conventions used

CONSTRAINTS:
- Read-only access (no modifications)
- Safety limit: 5 iterations
- Provide clear, structured findings
- Focus on architectural understanding`;

  let currentMessages = [...messages, { role: "system" as const, content: systemPrompt }];
  let iterationCount = 0;
  let finishReason: string | null | undefined = null;
  let fullResponse = "";

  // Multi-turn loop with safety limit
  while (iterationCount < safetyLimit) {
    throwIfAborted(runtime);
    iterationCount++;

    // Convert our messages to CoreMessage format for AI SDK v6
    const coreMessages = toCoreMessages(currentMessages) as LanguageModelV3Message[];

    // Call the model with streamText
    const result = await streamText({
      model: exploreModel,
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

    // Check if we should continue
    if (finishReason === "stop") {
      logger.info(`Complete (${iterationCount} iterations)`);
      break;
    }
    if (finishReason === "tool-calls") {
      // Continue to next iteration for tool execution
      continue;
    }
    if (iterationCount >= safetyLimit) {
      logger.warn(`Safety limit reached (${safetyLimit} iterations)`);
      break;
    }
  }

  return {
    output: fullResponse,
    finishReason,
    messages: currentMessages,
  } as ExploreAgentOutput;
});
