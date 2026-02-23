/**
 * Agent processor for opencode-style agent loop
 *
 * This class handles the main loop for agent execution, including
 * streaming LLM responses, tool execution, and doom loop detection.
 */

import type { LanguageModelV3 } from "@ai-sdk/provider";
import { createLogger } from "@sakti-code/shared/logger";
import { streamText, type ModelMessage, type ToolResultPart, type UserModelMessage } from "ai";
import { createHash } from "node:crypto";
import { v7 as uuidv7 } from "uuid";
import {
  getBuildModel,
  getExploreModel,
  getModelByReference,
  getPlanModel,
} from "../agent/workflow/model-provider";
import { AgentConfig, AgentEvent, AgentInput, AgentResult } from "../agent/workflow/types";
import { Instance } from "../instance";
import {
  SimpleTokenCounter,
  createObserverAgent,
  formatObservationsForInjection,
  getAgentMode,
  getMemoryConfig,
  memoryProcessor,
  messageStorage,
  processInputStep,
} from "../memory";
import {
  applyToolDefinitionHook,
  resolveHookModel,
  triggerChatHeadersHook,
  triggerChatParamsHook,
} from "../plugin/hooks";
import { classifyAgentError } from "./error-classification";

import { injectSpecContextForModelMessages } from "../agent/spec-injector";
import { MAX_STEPS_PROMPT } from "../prompts/auto-compaction";

const logger = createLogger("sakti-code");
const DOOM_LOOP_THRESHOLD = 3;
const INTERACTIVE_TOOL_NAMES = new Set(["question"]);
const RETRY_INITIAL_DELAY_MS = 3000;
const RETRY_BACKOFF_FACTOR = 2;
const RETRY_MAX_RETRIES = 10;

// Type for streamText result
type StreamTextOutput = Awaited<ReturnType<typeof streamText>>;

// Track tool call result for doom loop detection
interface ToolCallResult {
  signature: string;
  success: boolean;
  timestamp: number;
}

interface MemoryContext {
  threadId: string;
  resourceId: string;
}

function extractToolName(signature: string): string {
  const separator = signature.indexOf(":");
  if (separator === -1) return signature;
  return signature.slice(0, separator);
}

function isInteractiveToolSignature(signature: string): boolean {
  return INTERACTIVE_TOOL_NAMES.has(extractToolName(signature));
}

function safeNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function toErrorObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function parseRetryAfterMs(value: string): number | undefined {
  const parsed = Number.parseFloat(value);
  if (!Number.isNaN(parsed) && parsed >= 0) return Math.ceil(parsed);
  const dateMs = Date.parse(value) - Date.now();
  if (!Number.isNaN(dateMs) && dateMs > 0) return Math.ceil(dateMs);
  return undefined;
}

export function retryDelayMs(attempt: number, error: unknown): number {
  const asObject = toErrorObject(error);
  const headers =
    asObject && typeof asObject.responseHeaders === "object" && asObject.responseHeaders
      ? (asObject.responseHeaders as Record<string, unknown>)
      : undefined;

  if (headers) {
    const retryAfterMsValue = headers["retry-after-ms"];
    if (typeof retryAfterMsValue === "string") {
      const parsed = parseRetryAfterMs(retryAfterMsValue);
      if (typeof parsed === "number") return parsed;
    }

    const retryAfterValue = headers["retry-after"];
    if (typeof retryAfterValue === "string") {
      const parsed = parseRetryAfterMs(retryAfterValue);
      if (typeof parsed === "number") {
        const fromSeconds = Number.parseFloat(retryAfterValue);
        if (!Number.isNaN(fromSeconds) && fromSeconds >= 0) {
          return Math.ceil(fromSeconds * 1000);
        }
        return parsed;
      }
    }
  }

  return RETRY_INITIAL_DELAY_MS * Math.pow(RETRY_BACKOFF_FACTOR, Math.max(0, attempt - 1));
}

export function canRetryStreamAttempt(streamAttempt: number, retryable: boolean): boolean {
  return retryable && streamAttempt < RETRY_MAX_RETRIES;
}

async function sleepWithAbort(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", onAbort);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  }).catch(error => {
    const name =
      error && typeof error === "object" && "name" in error
        ? String((error as { name?: unknown }).name)
        : "";
    if (name !== "AbortError") throw error;
  });
}

function normalizeUsage(usage: unknown): {
  cost: number;
  tokens: {
    input: number;
    output: number;
    reasoning: number;
    cache: {
      read: number;
      write: number;
    };
  };
} {
  const data = usage && typeof usage === "object" ? (usage as Record<string, unknown>) : {};

  return {
    cost: safeNumber(data.cost ?? data.totalCost),
    tokens: {
      input: safeNumber(data.inputTokens ?? data.promptTokens ?? data.input),
      output: safeNumber(data.outputTokens ?? data.completionTokens ?? data.output),
      reasoning: safeNumber(data.reasoningTokens ?? data.reasoning),
      cache: {
        read: safeNumber(data.cacheReadInputTokens ?? data.cachedInputTokens ?? data.cacheRead),
        write: safeNumber(data.cacheWriteInputTokens ?? data.cacheWrite),
      },
    },
  };
}

function maybeAddPath(paths: Set<string>, value: unknown) {
  if (typeof value !== "string") return;
  const trimmed = value.trim();
  if (!trimmed) return;
  if (trimmed.length > 512) return;
  if (!trimmed.includes("/") && !trimmed.includes("\\")) return;
  paths.add(trimmed);
}

function collectFilePaths(value: unknown, out: Set<string>, depth = 0): void {
  if (depth > 4) return;
  if (typeof value === "string") {
    maybeAddPath(out, value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectFilePaths(item, out, depth + 1);
    }
    return;
  }
  if (!value || typeof value !== "object") return;

  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (/(^|_|-)(path|file|filename|filepath|targetfile|absolutepath|relativepath)s?$/i.test(key)) {
      if (Array.isArray(entry)) {
        for (const item of entry) {
          maybeAddPath(out, item);
        }
      } else {
        maybeAddPath(out, entry);
      }
    }
    collectFilePaths(entry, out, depth + 1);
  }
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
  private latestInput: AgentInput | null = null;

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
    this.latestInput = input;

    logger.info(`Starting agent execution: ${this.config.id}`, {
      module: "agent:processor",
      agent: this.config.id,
      agentType: this.config.type,
      task: input.task?.slice(0, 100),
    });

    const resolvedMemoryContext = this.resolveMemoryContext(input);
    const inputMessage = this.buildInputMessage(input);

    if (resolvedMemoryContext) {
      try {
        // First, get basic memory context (working memory + recent messages)
        const memoryInput = await memoryProcessor.input({
          message: inputMessage,
          threadId: resolvedMemoryContext.threadId,
          resourceId: resolvedMemoryContext.resourceId,
        });

        // Then, enhance with observational memory (observations from Observer Agent)
        const tokenCounter = new SimpleTokenCounter();
        const observerModel = this.getModel();
        const agentMode = getAgentMode(this.config.type);
        const modeConfig = getMemoryConfig(agentMode);
        const observerAgent = createObserverAgent(observerModel, agentMode, 30000);

        const requestedScope = this.getString(input.context?.memoryScope);
        const observationScope: "thread" | "resource" =
          requestedScope === "resource" ? "resource" : "thread";

        // Get messages from storage for observation
        const messagesForObservation = await messageStorage.listMessages(
          observationScope === "resource"
            ? { resourceId: resolvedMemoryContext.resourceId, limit: 50 }
            : { threadId: resolvedMemoryContext.threadId, limit: 50 }
        );

        const observationMessages = messagesForObservation.map(msg => ({
          id: msg.id,
          role: msg.role as "user" | "assistant" | "system",
          content: msg.raw_content ?? "",
          createdAt: msg.created_at.getTime(),
        }));

        // Process through observational memory orchestration
        const observationResult = await processInputStep({
          messages: observationMessages,
          context: {
            threadId: resolvedMemoryContext.threadId,
            resourceId: resolvedMemoryContext.resourceId,
            scope: observationScope,
          },
          stepNumber: 0,
          tokenCounter,
          observerAgent,
          reflectorModel: observerModel,
          config: modeConfig,
        });

        const messages = memoryProcessor.formatForAgentInput(memoryInput, this.config.systemPrompt);

        // Add observations as system message if available
        if (observationResult.record.active_observations) {
          const formattedObservations = formatObservationsForInjection(
            observationResult.record.active_observations
          );
          if (formattedObservations) {
            const insertAt = messages.findIndex(message => message.role !== "system");
            messages.splice(insertAt === -1 ? messages.length : insertAt, 0, {
              role: "system",
              content: formattedObservations,
            });
          }
        }

        this.messages = await injectSpecContextForModelMessages(
          messages as ModelMessage[],
          resolvedMemoryContext.threadId
        );
      } catch (error) {
        logger.warn("Failed to load memory context, falling back to default initialization", {
          module: "agent:processor",
          agent: this.config.id,
          error: error instanceof Error ? error.message : String(error),
        });
        this.messages = [
          { role: "system", content: this.config.systemPrompt },
          { role: "user", content: inputMessage },
        ];
      }
    } else {
      // Initialize with system prompt and user input
      this.messages = [
        { role: "system", content: this.config.systemPrompt },
        { role: "user", content: inputMessage },
      ];
    }

    try {
      while (this.iterationCount < this.config.maxIterations) {
        // Check for abort
        if (this.abortController.signal.aborted) {
          return await this.finalizeResult(this.createResult("stopped", startTime), input);
        }

        let iterationResult: { finished: boolean };
        let streamAttempt = 0;
        while (true) {
          try {
            // Stream from LLM
            const stream = await this.streamIteration();
            // Process stream events
            iterationResult = await this.processStream(stream);
            break;
          } catch (error) {
            const classified = classifyAgentError(error);
            const retryable = canRetryStreamAttempt(streamAttempt, classified.retryable);

            if (!retryable || this.abortController.signal.aborted) {
              throw error;
            }

            streamAttempt += 1;
            const delay = retryDelayMs(streamAttempt, error);
            const next = Date.now() + delay;
            this.emitEvent({
              type: "retry",
              attempt: streamAttempt,
              message: classified.userMessage,
              next,
              errorKind: classified.kind,
              agentId: this.config.id,
            });
            logger.warn("Retrying stream iteration after transient error", {
              module: "agent:processor",
              agent: this.config.id,
              attempt: streamAttempt,
              next,
              delay,
              errorKind: classified.kind,
              message: classified.rawMessage,
            });
            await sleepWithAbort(delay, this.abortController.signal);
          }
        }

        if (iterationResult.finished) {
          return await this.finalizeResult(this.createResult("completed", startTime), input);
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
              return await this.finalizeResult(
                this.createResult("failed", startTime, errorMessage),
                input
              );
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
              return await this.finalizeResult(
                this.createResult("failed", startTime, errorMessage),
                input
              );
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
          return await this.finalizeResult(
            this.createResult("failed", startTime, errorMessage),
            input
          );
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
      return await this.finalizeResult(result, input);
    } catch (error) {
      const classified = classifyAgentError(error);
      const errorMessage = classified.userMessage;
      logger.error(
        `Agent execution failed: ${this.config.id}`,
        error instanceof Error ? error : undefined,
        {
          module: "agent:processor",
          agent: this.config.id,
          error: errorMessage,
          errorKind: classified.kind,
          retryable: classified.retryable,
          rawError: classified.rawMessage,
          iterations: this.iterationCount,
        }
      );
      return await this.finalizeResult(this.createResult("failed", startTime, errorMessage), input);
    }
  }

  /**
   * Stream a single iteration from the LLM
   */
  private async streamIteration() {
    // Access context to ensure we're in an Instance.provide() context
    void Instance.context;

    const iterationMessages = this.buildIterationMessages();
    const hookModel = resolveHookModel({
      configuredModelID: this.config.model,
      agentType: this.config.type,
      runtimeProviderID: Instance.context.providerRuntime?.providerId,
      runtimeModelID: Instance.context.providerRuntime?.modelId,
    });
    const hookInput = {
      sessionID: Instance.context.sessionID,
      agent: this.config.id,
      model: hookModel,
      provider: { id: hookModel.providerID },
      message: { role: "user" as const, content: this.latestInput?.task ?? "" },
    };
    const chatParams = await triggerChatParamsHook(hookInput, {
      temperature: this.config.temperature,
      topP: undefined,
      topK: undefined,
      options: {},
    });
    const chatHeaders = await triggerChatHeadersHook(hookInput, { headers: {} });
    if (Object.keys(chatHeaders.headers).length > 0 && Instance.context.providerRuntime) {
      Instance.context.providerRuntime.headers = {
        ...(Instance.context.providerRuntime.headers ?? {}),
        ...chatHeaders.headers,
      };
    }

    const toolsForIteration = await applyToolDefinitionHook({
      tools: this.config.tools as Record<string, unknown>,
    });
    const activeTools = this.isLastStep() ? [] : undefined;

    return streamText({
      model: this.getModel(),
      messages: iterationMessages as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      tools: toolsForIteration as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      activeTools: activeTools as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      abortSignal: this.abortController.signal,
      temperature: chatParams.temperature,
      topP: chatParams.topP,
      topK: chatParams.topK,
      ...(chatParams.options as Record<string, unknown>),
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
    const touchedFiles = new Set<string>();
    const fallbackStepID = `step-${this.iterationCount + 1}`;
    const fallbackSnapshot = uuidv7();
    let fallbackStepStarted = false;
    let fallbackStepFinished = false;

    // Map tool call IDs to their signatures for tracking results
    const toolCallSignatures = new Map<string, string>();
    const pendingToolCalls = new Map<
      string,
      { toolName: string; input?: Record<string, unknown> }
    >();

    // Track reasoning start times for duration calculation
    const reasoningStartTimes = new Map<string, number>();

    const beginFallbackStep = () => {
      if (fallbackStepStarted) return;
      fallbackStepStarted = true;
      this.emitEvent({
        type: "step-start",
        stepId: fallbackStepID,
        snapshot: fallbackSnapshot,
        agentId: this.config.id,
      });
    };

    const finishFallbackStep = (reason: string, usage?: unknown) => {
      if (!fallbackStepStarted || fallbackStepFinished) return;
      fallbackStepFinished = true;
      const normalized = normalizeUsage(usage);
      this.emitEvent({
        type: "step-finish",
        stepId: fallbackStepID,
        reason,
        snapshot: fallbackSnapshot,
        cost: normalized.cost,
        tokens: normalized.tokens,
        agentId: this.config.id,
      });
      this.emitEvent({
        type: "snapshot",
        snapshot: fallbackSnapshot,
        stepId: fallbackStepID,
        agentId: this.config.id,
      });
      if (touchedFiles.size > 0) {
        const files = Array.from(touchedFiles).sort();
        const hash = createHash("sha1").update(files.join("\n")).digest("hex");
        this.emitEvent({
          type: "patch",
          hash,
          files,
          stepId: fallbackStepID,
          agentId: this.config.id,
        });
      }
    };

    for await (const chunk of stream.fullStream) {
      const chunkType = (chunk as { type: string }).type;
      if (chunkType === "start-step" || chunkType === "step-start") {
        beginFallbackStep();
        continue;
      }
      if (chunkType === "finish-step" || chunkType === "step-finish") {
        const data = chunk as { finishReason?: string; reason?: string; usage?: unknown };
        finishFallbackStep(
          typeof data.finishReason === "string"
            ? data.finishReason
            : typeof data.reason === "string"
              ? data.reason
              : "stop",
          data.usage
        );
        continue;
      }

      switch (chunk.type) {
        case "text-delta":
          beginFallbackStep();
          assistantMessage += chunk.text;
          this.emitEvent({
            type: "text",
            text: chunk.text,
            agentId: this.config.id,
          });
          break;

        case "tool-call":
          beginFallbackStep();
          collectFilePaths(chunk.input, touchedFiles);
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
          beginFallbackStep();
          collectFilePaths(chunk.output, touchedFiles);
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
          beginFallbackStep();
          collectFilePaths((chunk as { input?: unknown }).input, touchedFiles);
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
          beginFallbackStep();
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
          beginFallbackStep();
          this.emitEvent({
            type: "reasoning-delta",
            reasoningId: chunk.id,
            text: chunk.text,
            agentId: this.config.id,
          });
          break;

        case "reasoning-end": {
          beginFallbackStep();
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
          beginFallbackStep();
          finishFallbackStep(chunk.finishReason);
          finishReason = chunk.finishReason;
          this.emitEvent({
            type: "finish",
            finishReason: chunk.finishReason,
            agentId: this.config.id,
          });
          break;

        case "error":
          beginFallbackStep();
          finishFallbackStep("error");
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

    if (fallbackStepStarted && !fallbackStepFinished) {
      finishFallbackStep(finishReason ?? "stop");
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
        if (isInteractiveToolSignature(lastThreeFailures[0].signature)) {
          return false;
        }
        return true; // Agent keeps making the same failed call
      }
    }

    // Check for excessive repeated calls (even if successful)
    if (this.toolCallHistory.length >= DOOM_LOOP_THRESHOLD + 2) {
      const lastFive = this.toolCallHistory.slice(-5);
      const allSameSignature = lastFive.every(sig => sig === lastFive[0]);
      if (allSameSignature) {
        if (isInteractiveToolSignature(lastFive[0]!)) {
          return false;
        }
        return true; // Agent is stuck making the same call
      }
    }

    // Check for same tool being called repeatedly (even with different parameters)
    // This catches cases like ls with {"recursive":true} vs {"recursive":false}
    if (this.toolCallHistory.length >= 6) {
      const lastSix = this.toolCallHistory.slice(-6);
      const toolNames = lastSix.map(sig => extractToolName(sig));
      const allSameTool = toolNames.every(name => name === toolNames[0]);
      if (allSameTool) {
        if (INTERACTIVE_TOOL_NAMES.has(toolNames[0]!)) {
          return false;
        }
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

  private resolveMemoryContext(input: AgentInput): MemoryContext | null {
    const context = input.context ?? {};
    const threadIdCandidate =
      this.getString(context.threadId) ??
      this.getString(context.sessionId) ??
      (Instance.inContext ? this.getString(Instance.context.sessionID) : undefined);
    if (!threadIdCandidate) return null;

    const resourceIdCandidate = this.getString(context.resourceId) ?? "local";
    return {
      threadId: threadIdCandidate,
      resourceId: resourceIdCandidate,
    };
  }

  private getString(value: unknown): string | undefined {
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  private async finalizeResult(result: AgentResult, input: AgentInput): Promise<AgentResult> {
    await this.persistMemoryOutput(input, result);
    return result;
  }

  private async persistMemoryOutput(input: AgentInput, result: AgentResult): Promise<void> {
    const memoryContext = this.resolveMemoryContext(input);
    if (!memoryContext) return;

    const userContent = this.getString(input.task);
    const assistantContent =
      typeof result.finalContent === "string" ? this.getString(result.finalContent) : undefined;

    const messagesToPersist: Array<{ role: "user" | "assistant" | "system"; content: string }> = [];
    if (userContent) {
      messagesToPersist.push({ role: "user", content: userContent });
    }
    if (assistantContent) {
      messagesToPersist.push({ role: "assistant", content: assistantContent });
    }
    if (messagesToPersist.length === 0) return;

    try {
      await memoryProcessor.output({
        messages: messagesToPersist,
        threadId: memoryContext.threadId,
        resourceId: memoryContext.resourceId,
      });
    } catch (error) {
      logger.warn("Failed to persist output messages to memory storage", {
        module: "agent:processor",
        agent: this.config.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
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
    const lastMessage = [...this.messages]
      .reverse()
      .find(m => m && typeof m === "object" && "role" in m && m.role === "assistant");
    return lastMessage && typeof lastMessage === "object" && "content" in lastMessage
      ? (lastMessage as { content: string }).content
      : "";
  }

  /**
   * Get the model for this agent based on agent type.
   */
  private getModel(): LanguageModelV3 {
    if (this.config.model.includes("/")) {
      return getModelByReference(this.config.model);
    }

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
