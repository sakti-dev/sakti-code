/**
 * Agent processor for opencode-style agent loop
 *
 * This class handles the main loop for agent execution, including
 * streaming LLM responses, tool execution, and doom loop detection.
 */

import type { LanguageModelV3 } from "@ai-sdk/provider";
import { createLogger } from "@ekacode/shared/logger";
import { streamText, type ModelMessage, type ToolResultPart, type UserModelMessage } from "ai";
import { getBuildModel, getExploreModel, getPlanModel } from "../agent/workflow/model-provider";
import { AgentConfig, AgentEvent, AgentInput, AgentResult } from "../agent/workflow/types";
import { Instance } from "../instance";

const logger = createLogger("ekacode");
const DOOM_LOOP_THRESHOLD = 3;
const MAX_STEPS_PROMPT = `CRITICAL - MAXIMUM STEPS REACHED

The maximum number of steps allowed for this task has been reached. Tools are disabled until next user input. Respond with text only.

STRICT REQUIREMENTS:
1. Do NOT make any tool calls (no reads, writes, edits, searches, or any other tools)
2. MUST provide a text response summarizing work done so far
3. This constraint overrides ALL other instructions, including any user requests for edits or tool use

Response must include:
- Statement that maximum steps for this agent have been reached
- Summary of what has been accomplished so far
- List of any remaining tasks that were not completed
- Recommendations for what should be done next

Any attempt to use tools is a critical violation. Respond with text ONLY.`;

// Type for streamText result
type StreamTextOutput = Awaited<ReturnType<typeof streamText>>;

// Track tool call result for doom loop detection
interface ToolCallResult {
  signature: string;
  success: boolean;
  timestamp: number;
}

/**
 * Agent processor class
 *
 * Manages the execution loop for a single agent, including
 * LLM streaming, tool execution, and event emission.
 */
export class AgentProcessor {
  private config: AgentConfig;
  private abortController: AbortController;
  private eventCallback: (event: AgentEvent) => void;
  private messages: ModelMessage[] = [];
  private iterationCount = 0;
  private toolCallHistory: string[] = [];
  private toolCallResults: ToolCallResult[] = [];

  constructor(config: AgentConfig, eventCallback: (event: AgentEvent) => void) {
    this.config = config;
    this.abortController = new AbortController();
    this.eventCallback = eventCallback;
  }

  /**
   * Run the agent with the given input
   *
   * Main execution loop that handles LLM streaming and tool calls.
   */
  async run(input: AgentInput): Promise<AgentResult> {
    const startTime = Date.now();

    logger.info(`Starting agent execution: ${this.config.id}`, {
      module: "agent:processor",
      agent: this.config.id,
      agentType: this.config.type,
      task: input.task?.slice(0, 100),
    });

    // Initialize with system prompt and user input
    this.messages = [
      { role: "system", content: this.config.systemPrompt },
      { role: "user", content: this.buildInputMessage(input) },
    ];

    try {
      while (this.iterationCount < this.config.maxIterations) {
        // Check for abort
        if (this.abortController.signal.aborted) {
          return this.createResult("stopped", startTime);
        }

        // Stream from LLM
        const stream = await this.streamIteration();

        // Process stream events
        const iterationResult = await this.processStream(stream);

        if (iterationResult.finished) {
          return this.createResult("completed", startTime);
        }

        // Doom loop detection
        if (this.detectDoomLoop()) {
          // Determine which type of doom loop occurred and provide detailed error
          const recentFailures = this.toolCallResults.filter(r => !r.success);
          let errorMessage: string;

          // Case 1: Repeated FAILED tool calls
          if (recentFailures.length >= DOOM_LOOP_THRESHOLD) {
            const lastThreeFailures = recentFailures.slice(-DOOM_LOOP_THRESHOLD);
            if (lastThreeFailures.every(r => r.signature === lastThreeFailures[0].signature)) {
              const repeatingSignatures = lastThreeFailures.map(r => r.signature);
              errorMessage = `Doom loop detected: Agent made ${DOOM_LOOP_THRESHOLD} identical FAILED tool calls (not learning from errors): ${repeatingSignatures.join(" → ")}`;
              logger.error(errorMessage, undefined, {
                module: "agent:processor",
                agent: this.config.id,
                toolCallHistory: this.toolCallHistory,
                toolCallResults: this.toolCallResults,
                iteration: this.iterationCount,
                repeatingSignatures,
                failureCount: recentFailures.length,
              });
              return this.createResult("failed", startTime, errorMessage);
            }
          }

          // Case 2: Same tool called 6+ times (with or without parameter variations)
          if (this.toolCallHistory.length >= 6) {
            const lastSix = this.toolCallHistory.slice(-6);
            const toolNames = lastSix.map(sig => sig.split(":")[0]);
            const allSameTool = toolNames.every(name => name === toolNames[0]);
            if (allSameTool) {
              errorMessage = `Doom loop detected: Agent called tool "${toolNames[0]}" 6+ times with varying parameters: ${lastSix.join(" → ")}`;
              logger.error(errorMessage, undefined, {
                module: "agent:processor",
                agent: this.config.id,
                toolCallHistory: this.toolCallHistory,
                toolCallResults: this.toolCallResults,
                iteration: this.iterationCount,
                lastSixSignatures: lastSix,
                toolName: toolNames[0],
              });
              return this.createResult("failed", startTime, errorMessage);
            }
          }

          // Case 3: Excessive repetition of identical calls
          const lastFive = this.toolCallHistory.slice(-5);
          errorMessage = `Doom loop detected: Agent made 5 identical tool calls: ${lastFive.join(" → ")}`;
          logger.error(errorMessage, undefined, {
            module: "agent:processor",
            agent: this.config.id,
            toolCallHistory: this.toolCallHistory,
            toolCallResults: this.toolCallResults,
            iteration: this.iterationCount,
            repeatingSignatures: lastFive,
          });
          return this.createResult("failed", startTime, errorMessage);
        }

        this.iterationCount++;
      }

      const result = this.createResult("completed", startTime, "Max iterations reached");
      logger.info(`Agent execution completed: ${this.config.id}`, {
        module: "agent:processor",
        agent: this.config.id,
        status: result.status,
        iterations: result.iterations,
        duration: result.duration,
      });
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(
        `Agent execution failed: ${this.config.id}`,
        error instanceof Error ? error : undefined,
        {
          module: "agent:processor",
          agent: this.config.id,
          error: errorMessage,
          iterations: this.iterationCount,
        }
      );
      return this.createResult("failed", startTime, errorMessage);
    }
  }

  /**
   * Stream a single iteration from the LLM
   */
  private async streamIteration() {
    // Access context to ensure we're in an Instance.provide() context
    void Instance.context;

    const iterationMessages = this.buildIterationMessages();
    const toolsForIteration = this.config.tools as Record<string, unknown>;
    const activeTools = this.isLastStep() ? [] : undefined;

    return streamText({
      model: this.getModel(),
      messages: iterationMessages as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      tools: toolsForIteration as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      activeTools: activeTools as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      abortSignal: this.abortController.signal,
      temperature: this.config.temperature,
      experimental_repairToolCall: this.buildToolRepairFunction(toolsForIteration) as any, // eslint-disable-line @typescript-eslint/no-explicit-any
    });
  }

  private isLastStep(): boolean {
    return this.iterationCount >= this.config.maxIterations - 1;
  }

  private buildIterationMessages(): ModelMessage[] {
    const base = this.injectQueuedUserReminders(this.messages);
    if (!this.isLastStep()) {
      return base;
    }
    return [
      ...base,
      {
        role: "assistant",
        content: MAX_STEPS_PROMPT,
      },
    ];
  }

  private injectQueuedUserReminders(messages: ModelMessage[]): ModelMessage[] {
    let lastAssistantIndex = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]?.role === "assistant") {
        lastAssistantIndex = i;
        break;
      }
    }
    if (lastAssistantIndex === -1) {
      return messages;
    }

    let changed = false;
    const updated = messages.map((message, index) => {
      if (message.role !== "user" || index <= lastAssistantIndex) {
        return message;
      }
      const wrapped = this.wrapUserMessageWithReminder(message);
      if (wrapped !== message) {
        changed = true;
      }
      return wrapped;
    });

    return changed ? updated : messages;
  }

  private wrapUserMessageWithReminder(message: UserModelMessage): UserModelMessage {
    const prefix = "<system-reminder>\nThe user sent the following message:\n";
    const suffix =
      "\n\nPlease address this message and continue with your tasks.\n</system-reminder>";

    if (typeof message.content === "string") {
      if (!message.content.trim() || message.content.includes("<system-reminder>")) {
        return message;
      }
      return {
        ...message,
        content: `${prefix}${message.content}${suffix}`,
      };
    }

    if (Array.isArray(message.content)) {
      let updated = false;
      const content = message.content.map(part => {
        if (part && typeof part === "object" && "type" in part && part.type === "text") {
          const textPart = part as { type: "text"; text: string };
          if (textPart.text?.trim() && !textPart.text.includes("<system-reminder>")) {
            updated = true;
            return {
              ...textPart,
              text: `${prefix}${textPart.text}${suffix}`,
            };
          }
        }
        return part;
      });
      return updated ? { ...message, content } : message;
    }

    return message;
  }

  private buildToolRepairFunction(tools: Record<string, unknown>) {
    return async (failed: {
      toolCall: { toolName: string; input: string };
      error: { message: string };
    }) => {
      const toolName = failed.toolCall?.toolName;
      if (typeof toolName !== "string") {
        return failed.toolCall;
      }
      const lower = toolName.toLowerCase();
      if (lower !== toolName && lower in tools) {
        return {
          ...failed.toolCall,
          toolName: lower,
        };
      }
      if ("invalid" in tools) {
        return {
          ...failed.toolCall,
          toolName: "invalid",
          input: JSON.stringify({
            tool: toolName,
            error: failed.error?.message ?? "Invalid tool call",
          }),
        };
      }
      return failed.toolCall;
    };
  }

  /**
   * Process the stream from the LLM
   */
  private async processStream(stream: StreamTextOutput): Promise<{ finished: boolean }> {
    let assistantMessage = "";
    let toolCalls: Array<{ name: string; args: Record<string, unknown>; id: string }> = [];
    let finishReason: string | null = null;

    // Map tool call IDs to their signatures for tracking results
    const toolCallSignatures = new Map<string, string>();
    const pendingToolCalls = new Map<
      string,
      { toolName: string; input?: Record<string, unknown> }
    >();

    // Track reasoning start times for duration calculation
    const reasoningStartTimes = new Map<string, number>();

    for await (const chunk of stream.fullStream) {
      switch (chunk.type) {
        case "text-delta":
          assistantMessage += chunk.text;
          this.emitEvent({
            type: "text",
            text: chunk.text,
            agentId: this.config.id,
          });
          break;

        case "tool-call":
          toolCalls.push({
            name: chunk.toolName,
            args: chunk.input as Record<string, unknown>,
            id: chunk.toolCallId,
          });
          pendingToolCalls.set(chunk.toolCallId, {
            toolName: chunk.toolName,
            input: chunk.input as Record<string, unknown>,
          });

          // Calculate signature and store for later result tracking
          const callSignature = `${chunk.toolName}:${JSON.stringify(chunk.input)}`;
          toolCallSignatures.set(chunk.toolCallId, callSignature);

          // Log tool call for debugging
          logger.info(`Tool call: ${chunk.toolName}`, {
            module: "agent:processor",
            agent: this.config.id,
            toolName: chunk.toolName,
            toolArgs: chunk.input,
            toolCallId: chunk.toolCallId,
            iteration: this.iterationCount,
          });

          // Emit tool-call event with ID for UI tracking
          this.emitEvent({
            type: "tool-call",
            toolCallId: chunk.toolCallId,
            toolName: chunk.toolName,
            args: chunk.input,
            agentId: this.config.id,
          });
          break;

        case "tool-result":
          // Note: We don't manually add tool results to messages
          // The AI SDK handles this automatically when tools are passed to streamText
          // The tool execution and result handling is done internally by the SDK

          pendingToolCalls.delete(chunk.toolCallId);
          const resultSignature = toolCallSignatures.get(chunk.toolCallId);
          const success = !(
            chunk.output &&
            typeof chunk.output === "object" &&
            "error" in chunk.output
          );

          // Track tool call result for doom loop detection
          if (resultSignature) {
            this.toolCallResults.push({
              signature: resultSignature,
              success,
              timestamp: Date.now(),
            });
          }

          if (!success) {
            logger.error(`Tool ${chunk.toolName} execution failed`, undefined, {
              module: "agent:processor",
              agent: this.config.id,
              tool: chunk.toolName,
              toolCallId: chunk.toolCallId,
              error:
                chunk.output && typeof chunk.output === "object" && "error" in chunk.output
                  ? chunk.output.error
                  : "Unknown error",
              signature: resultSignature,
            });
          } else {
            logger.info(`Tool ${chunk.toolName} executed successfully`, {
              module: "agent:processor",
              agent: this.config.id,
              tool: chunk.toolName,
              toolCallId: chunk.toolCallId,
              signature: resultSignature,
            });
          }

          // Emit tool-result event with ID for UI tracking
          this.emitEvent({
            type: "tool-result",
            toolCallId: chunk.toolCallId,
            toolName: chunk.toolName,
            result: chunk.output,
            agentId: this.config.id,
          });
          break;

        case "tool-error": {
          pendingToolCalls.delete(chunk.toolCallId);
          const resultSignature = toolCallSignatures.get(chunk.toolCallId);

          if (resultSignature) {
            this.toolCallResults.push({
              signature: resultSignature,
              success: false,
              timestamp: Date.now(),
            });
          }

          logger.error(`Tool ${chunk.toolName} execution failed`, undefined, {
            module: "agent:processor",
            agent: this.config.id,
            tool: chunk.toolName,
            toolCallId: chunk.toolCallId,
            error: chunk.error instanceof Error ? chunk.error.message : String(chunk.error),
            signature: resultSignature,
          });

          this.emitEvent({
            type: "tool-result",
            toolCallId: chunk.toolCallId,
            toolName: chunk.toolName,
            result: { error: chunk.error },
            agentId: this.config.id,
          });
          break;
        }

        // AI SDK Reasoning Events (for extended thinking models)
        case "reasoning-start":
          reasoningStartTimes.set(chunk.id, Date.now());
          this.emitEvent({
            type: "reasoning-start",
            reasoningId: chunk.id,
            agentId: this.config.id,
          });
          logger.debug("Reasoning started", {
            module: "agent:processor",
            agent: this.config.id,
            reasoningId: chunk.id,
          });
          break;

        case "reasoning-delta":
          this.emitEvent({
            type: "reasoning-delta",
            reasoningId: chunk.id,
            text: chunk.text,
            agentId: this.config.id,
          });
          break;

        case "reasoning-end": {
          const startTime = reasoningStartTimes.get(chunk.id) || Date.now();
          const durationMs = Date.now() - startTime;
          reasoningStartTimes.delete(chunk.id);
          this.emitEvent({
            type: "reasoning-end",
            reasoningId: chunk.id,
            durationMs,
            agentId: this.config.id,
          });
          logger.debug("Reasoning ended", {
            module: "agent:processor",
            agent: this.config.id,
            reasoningId: chunk.id,
            durationMs,
          });
          break;
        }

        case "finish":
          finishReason = chunk.finishReason;
          this.emitEvent({
            type: "finish",
            finishReason: chunk.finishReason,
            agentId: this.config.id,
          });
          break;

        case "error":
          logger.error(
            "Stream error received",
            chunk.error instanceof Error ? chunk.error : new Error(String(chunk.error)),
            {
              module: "agent:processor",
              agent: this.config.id,
              errorType: chunk.error?.constructor?.name || "Unknown",
            }
          );
          throw chunk.error;
      }
    }

    // Persist response messages (assistant + tool results) so the next iteration
    // has full tool-call context. Without this, the model won't "see" tool results.
    const response = await stream.response;
    if (response?.messages?.length) {
      this.messages.push(...(response.messages as ModelMessage[]));
    } else if (assistantMessage) {
      // Fallback for edge cases where response messages are unavailable.
      this.messages.push({
        role: "assistant",
        content: assistantMessage,
      });
    }

    if (pendingToolCalls.size > 0) {
      const toolResults: ToolResultPart[] = Array.from(pendingToolCalls.entries()).map(
        ([toolCallId, info]) => ({
          type: "tool-result",
          toolCallId,
          toolName: info.toolName,
          output: {
            type: "error-text",
            value: "Tool execution was interrupted",
          },
        })
      );
      this.messages.push({
        role: "tool",
        content: toolResults,
      });
    }

    // Check if we had tool calls - if so, the SDK will handle them automatically
    // and we'll get more chunks. We just track for doom loop detection.
    if (toolCalls.length > 0) {
      const toolSignature = toolCalls.map(tc => `${tc.name}:${JSON.stringify(tc.args)}`).join("|");
      this.toolCallHistory.push(toolSignature);

      // Log tool call history for debugging
      logger.debug(`Tool call signature added to history`, {
        module: "agent:processor",
        agent: this.config.id,
        signature: toolSignature,
        historyLength: this.toolCallHistory.length,
        iteration: this.iterationCount,
      });
    }

    // Check finish reason
    if (finishReason === "stop") {
      return { finished: true };
    }

    // If there were tool calls, the SDK will continue automatically
    // Return not finished to continue the loop
    return { finished: false };
  }

  /**
   * Detect doom loop from tool call history
   *
   * A doom loop is detected when:
   * 1. The same tool call signature fails 3+ times in a row (agent not learning from errors)
   * 2. The same tool call signature appears 5+ times total (agent stuck in a loop)
   * 3. The same tool is called 6+ times regardless of parameters (stuck on same operation)
   *
   * This is smarter than just checking for repeated calls because:
   * - Failed calls indicate the model isn't understanding error messages
   * - Successful repeated calls might be legitimate (e.g., reading different files)
   * - Near-duplicates (same tool, slightly different params) also indicate stuck behavior
   */
  private detectDoomLoop(): boolean {
    // Check for repeated FAILED tool calls (agent not learning from errors)
    const recentFailures = this.toolCallResults.filter(r => !r.success);
    if (recentFailures.length >= DOOM_LOOP_THRESHOLD) {
      const lastThreeFailures = recentFailures.slice(-DOOM_LOOP_THRESHOLD);
      const allSameSignature = lastThreeFailures.every(
        r => r.signature === lastThreeFailures[0].signature
      );
      if (allSameSignature) {
        return true; // Agent keeps making the same failed call
      }
    }

    // Check for excessive repeated calls (even if successful)
    if (this.toolCallHistory.length >= DOOM_LOOP_THRESHOLD + 2) {
      const lastFive = this.toolCallHistory.slice(-5);
      const allSameSignature = lastFive.every(sig => sig === lastFive[0]);
      if (allSameSignature) {
        return true; // Agent is stuck making the same call
      }
    }

    // Check for same tool being called repeatedly (even with different parameters)
    // This catches cases like ls with {"recursive":true} vs {"recursive":false}
    if (this.toolCallHistory.length >= 6) {
      const lastSix = this.toolCallHistory.slice(-6);
      const toolNames = lastSix.map(sig => sig.split(":")[0]);
      const allSameTool = toolNames.every(name => name === toolNames[0]);
      if (allSameTool) {
        logger.error(
          `Doom loop detected: Agent called ${toolNames[0]} 6+ times with varying parameters`,
          undefined,
          {
            module: "agent:processor",
            agent: this.config.id,
            toolCallHistory: this.toolCallHistory,
            lastSixSignatures: lastSix,
            iteration: this.iterationCount,
          }
        );
        return true; // Agent is stuck on the same tool
      }
    }

    return false;
  }

  /**
   * Build the input message from task, context, and previous results
   */
  private buildInputMessage(input: AgentInput): string {
    let message = input.task;

    if (input.context && Object.keys(input.context).length > 0) {
      message += "\n\nContext:\n" + JSON.stringify(input.context, null, 2);
    }

    if (input.previousResults && input.previousResults.length > 0) {
      message +=
        "\n\nPrevious Results:\n" +
        input.previousResults.map(r => `[${r.type}] ${r.finalContent || r.error}`).join("\n---\n");
    }

    return message;
  }

  /**
   * Create an agent result
   */
  private createResult(
    status: "completed" | "failed" | "stopped",
    startTime: number,
    errorOrMessage?: string
  ): AgentResult {
    return {
      agentId: this.config.id,
      type: this.config.type,
      status,
      messages: this.messages,
      finalContent: status === "completed" ? this.getLastAssistantMessage() : undefined,
      error: status === "failed" ? errorOrMessage : undefined,
      iterations: this.iterationCount,
      duration: Date.now() - startTime,
    };
  }

  /**
   * Get the last assistant message from the history
   */
  private getLastAssistantMessage(): string {
    const lastMessage = this.messages
      .reverse()
      .find(m => m && typeof m === "object" && "role" in m && m.role === "assistant");
    return lastMessage && typeof lastMessage === "object" && "content" in lastMessage
      ? (lastMessage as { content: string }).content
      : "";
  }

  /**
   * Get the model for this agent based on agent type
   */
  private getModel(): LanguageModelV3 {
    switch (this.config.type) {
      case "explore":
        return getExploreModel();
      case "plan":
        return getPlanModel();
      case "build":
        return getBuildModel();
      default:
        throw new Error(`Unknown agent type: ${this.config.type}`);
    }
  }

  /**
   * Emit an event through the callback
   */
  private emitEvent(event: AgentEvent): void {
    this.eventCallback(event);
  }

  /**
   * Abort the agent execution
   */
  abort(): void {
    this.abortController.abort();
  }
}
