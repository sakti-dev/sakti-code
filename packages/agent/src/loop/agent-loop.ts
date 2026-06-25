/**
 * Agent loop that works with AgentMessage throughout.
 * Transforms to Message[] only at the LLM call boundary.
 */

import type {
  AssistantMessage,
  TextContent,
  ThinkingContent,
  ToolCall,
  ToolResultMessage,
  Usage,
} from "@sakti-code/llm";
import type {
  AgentContext,
  AgentEvent,
  AgentLoopConfig,
  AgentMessage,
  AgentTool,
  AgentToolCall,
  AgentToolResult,
  StreamFn,
} from "../types.ts";
import { EventStream } from "../utils/event-stream.ts";
import { validateToolArguments } from "../utils/validation.ts";

export type AgentEventSink = (event: AgentEvent) => Promise<void> | void;

/**
 * Start an agent loop with a new prompt message.
 * The prompt is added to the context and events are emitted for it.
 */
export function agentLoop(
  prompts: AgentMessage[],
  context: AgentContext,
  config: AgentLoopConfig,
  signal?: AbortSignal,
  streamFn?: StreamFn
): EventStream<AgentEvent, AgentMessage[]> {
  const stream = createAgentStream();

  void runAgentLoop(
    prompts,
    context,
    config,
    async (event) => {
      stream.push(event);
    },
    signal,
    streamFn
  ).then((messages) => {
    stream.end(messages);
  });

  return stream;
}

/**
 * Continue an agent loop from the current context without adding a new message.
 * Used for retries - context already has user message or tool results.
 *
 * **Important:** The last message in context must convert to a `user` or `toolResult` message
 * via `convertToLlm`. If it doesn't, the LLM provider will reject the request.
 * This cannot be validated here since `convertToLlm` is only called once per turn.
 */
export function agentLoopContinue(
  context: AgentContext,
  config: AgentLoopConfig,
  signal?: AbortSignal,
  streamFn?: StreamFn
): EventStream<AgentEvent, AgentMessage[]> {
  if (context.messages.length === 0) {
    throw new Error("Cannot continue: no messages in context");
  }

  if (context.messages[context.messages.length - 1]!.role === "assistant") {
    throw new Error("Cannot continue from message role: assistant");
  }

  const stream = createAgentStream();

  void runAgentLoopContinue(
    context,
    config,
    async (event) => {
      stream.push(event);
    },
    signal,
    streamFn
  ).then((messages) => {
    stream.end(messages);
  });

  return stream;
}

export async function runAgentLoop(
  prompts: AgentMessage[],
  context: AgentContext,
  config: AgentLoopConfig,
  emit: AgentEventSink,
  signal?: AbortSignal,
  streamFn?: StreamFn
): Promise<AgentMessage[]> {
  const newMessages: AgentMessage[] = [...prompts];
  const currentContext: AgentContext = {
    ...context,
    messages: [...context.messages, ...prompts],
  };

  await emit({ type: "agent_start" });
  await emit({ type: "turn_start" });
  for (const prompt of prompts) {
    await emit({ type: "message_start", message: prompt });
    await emit({ type: "message_end", message: prompt });
  }

  await runLoop(currentContext, newMessages, config, signal, emit, streamFn);
  return newMessages;
}

export async function runAgentLoopContinue(
  context: AgentContext,
  config: AgentLoopConfig,
  emit: AgentEventSink,
  signal?: AbortSignal,
  streamFn?: StreamFn
): Promise<AgentMessage[]> {
  if (context.messages.length === 0) {
    throw new Error("Cannot continue: no messages in context");
  }

  if (context.messages[context.messages.length - 1]!.role === "assistant") {
    throw new Error("Cannot continue from message role: assistant");
  }

  const newMessages: AgentMessage[] = [];
  const currentContext: AgentContext = { ...context };

  await emit({ type: "agent_start" });
  await emit({ type: "turn_start" });

  await runLoop(currentContext, newMessages, config, signal, emit, streamFn);
  return newMessages;
}

function createAgentStream(): EventStream<AgentEvent, AgentMessage[]> {
  return new EventStream<AgentEvent, AgentMessage[]>(
    (event: AgentEvent) => event.type === "agent_end",
    (event: AgentEvent) => (event.type === "agent_end" ? event.messages : [])
  );
}

/**
 * Main loop logic shared by agentLoop and agentLoopContinue.
 */
async function runLoop(
  initialContext: AgentContext,
  newMessages: AgentMessage[],
  initialConfig: AgentLoopConfig,
  signal: AbortSignal | undefined,
  emit: AgentEventSink,
  streamFn?: StreamFn
): Promise<void> {
  let currentContext = initialContext;
  let config = initialConfig;
  let firstTurn = true;
  // Check for steering messages at start (user may have typed while waiting)
  let pendingMessages: AgentMessage[] =
    (await config.getSteeringMessages?.()) || [];

  // Outer loop: continues when queued follow-up messages arrive after agent would stop
  while (true) {
    let hasMoreToolCalls = true;

    // Inner loop: process tool calls and steering messages
    while (hasMoreToolCalls || pendingMessages.length > 0) {
      if (firstTurn) {
        firstTurn = false;
      } else {
        await emit({ type: "turn_start" });
      }

      // Process pending messages (inject before next assistant response)
      if (pendingMessages.length > 0) {
        for (const message of pendingMessages) {
          await emit({ type: "message_start", message });
          await emit({ type: "message_end", message });
          currentContext.messages.push(message);
          newMessages.push(message);
        }
        pendingMessages = [];
      }

      // Stream assistant response
      const message = await streamAssistantResponse(
        currentContext,
        config,
        signal,
        emit,
        streamFn
      );
      newMessages.push(message);

      if (message.stopReason === "error" || message.stopReason === "aborted") {
        await emit({ type: "turn_end", message, toolResults: [] });
        await emit({ type: "agent_end", messages: newMessages });
        return;
      }

      // Check for tool calls
      const toolCalls = message.content.filter((c) => c.type === "toolCall");

      const toolResults: ToolResultMessage[] = [];
      hasMoreToolCalls = false;
      if (toolCalls.length > 0) {
        const executedToolBatch = await executeToolCalls(
          currentContext,
          message,
          config,
          signal,
          emit
        );
        toolResults.push(...executedToolBatch.messages);
        hasMoreToolCalls = !executedToolBatch.terminate;

        for (const result of toolResults) {
          currentContext.messages.push(result);
          newMessages.push(result);
        }
      }

      await emit({ type: "turn_end", message, toolResults });

      const nextTurnContext = {
        message,
        toolResults,
        context: currentContext,
        newMessages,
      };
      const nextTurnSnapshot = await config.prepareNextTurn?.(nextTurnContext);
      if (nextTurnSnapshot) {
        currentContext = nextTurnSnapshot.context ?? currentContext;
        const reasoning =
          nextTurnSnapshot.thinkingLevel === undefined
            ? config.reasoning
            : nextTurnSnapshot.thinkingLevel === "off"
              ? undefined
              : nextTurnSnapshot.thinkingLevel;
        config = {
          ...config,
          model: nextTurnSnapshot.model ?? config.model,
          ...(reasoning === undefined ? {} : { reasoning }),
        };
      }

      if (
        await config.shouldStopAfterTurn?.({
          message,
          toolResults,
          context: currentContext,
          newMessages,
        })
      ) {
        await emit({ type: "agent_end", messages: newMessages });
        return;
      }

      pendingMessages = (await config.getSteeringMessages?.()) || [];
    }

    // Agent would stop here. Check for follow-up messages.
    const followUpMessages = (await config.getFollowUpMessages?.()) || [];
    if (followUpMessages.length > 0) {
      // Set as pending so inner loop processes them
      pendingMessages = followUpMessages;
      continue;
    }

    // No more messages, exit
    break;
  }

  await emit({ type: "agent_end", messages: newMessages });
}

/**
 * Stream an assistant response from the LLM.
 * This is where AgentMessage[] gets transformed to Message[] for the LLM.
 *
 * Consumes @ai-sdk's `fullStream` natively — accumulates text-delta, reasoning-delta,
 * and tool-call parts into an `AssistantMessage`, emitting slim per-token deltas.
 */
async function streamAssistantResponse(
  context: AgentContext,
  config: AgentLoopConfig,
  signal: AbortSignal | undefined,
  emit: AgentEventSink,
  streamFn?: StreamFn
): Promise<AssistantMessage> {
  // Apply context transform if configured (AgentMessage[] → AgentMessage[])
  let messages = context.messages;
  if (config.transformContext) {
    messages = await config.transformContext(messages, signal);
  }

  // Convert to LLM-compatible messages (AgentMessage[] → Message[])
  const llmMessages = await config.convertToLlm(messages);

  // Resolve API key (important for expiring tokens)
  const resolvedApiKey =
    (config.getApiKey
      ? await config.getApiKey(config.model.provider)
      : undefined) || config.apiKey;

  // Build StreamRequest — @sakti-code/llm's single entry point
  const streamFunction = streamFn ?? defaultStreamFn;
  const { fullStream, result } = await streamFunction({
    model: config.model,
    messages: llmMessages,
    ...(context.systemPrompt ? { system: context.systemPrompt } : {}),
    ...(context.tools && context.tools.length > 0
      ? { tools: toStreamTools(context.tools) }
      : {}),
    ...(config.reasoning === undefined
      ? {}
      : { thinkingLevel: config.reasoning }),
    ...(resolvedApiKey === undefined ? {} : { apiKey: resolvedApiKey }),
    ...(config.headers ? { headers: config.headers } : {}),
    ...(config.sessionId ? { sessionId: config.sessionId } : {}),
    ...(signal ? { abortSignal: signal } : {}),
  });

  // ── Accumulator state ──────────────────────────────────────────────
  let textBuffer = "";
  let thinkingBuffer = "";
  const toolCallBlocks: ToolCall[] = [];
  let messageStarted = false;

  // Placeholder pushed to context.messages; replaced with final message at end.
  const placeholder: AssistantMessage = {
    role: "assistant",
    content: [],
    api: config.model.api,
    provider: config.model.provider,
    model: config.model.id,
    usage: EMPTY_USAGE,
    stopReason: "stop",
    timestamp: Date.now(),
  };

  /** Emit message_start once (on first content or at finalization). */
  const ensureMessageStarted = async (): Promise<void> => {
    if (!messageStarted) {
      messageStarted = true;
      context.messages.push(placeholder);
      await emit({ type: "message_start", message: placeholder });
    }
  };

  // ── Iterate fullStream parts ───────────────────────────────────────
  let streamError: Error | undefined;
  try {
    for await (const part of fullStream as AsyncIterable<
      Record<string, unknown>
    >) {
      const type = part.type as string;
      switch (type) {
        case "text-delta": {
          await ensureMessageStarted();
          const delta = part.text as string;
          textBuffer += delta;
          await emit({
            type: "message_update",
            delta: { kind: "text", text: delta },
          });
          break;
        }
        case "reasoning-delta": {
          await ensureMessageStarted();
          const delta = part.text as string;
          thinkingBuffer += delta;
          await emit({
            type: "message_update",
            delta: { kind: "thinking", text: delta },
          });
          break;
        }
        case "tool-call": {
          await ensureMessageStarted();
          toolCallBlocks.push({
            type: "toolCall",
            id: part.toolCallId as string,
            name: part.toolName as string,
            arguments: (part.input as Record<string, unknown>) ?? {},
          });
          break;
        }
        case "error": {
          streamError =
            part.error instanceof Error
              ? part.error
              : new Error(String(part.error));
          break;
        }
        // Other parts (text-start/end, reasoning-start/end, start-step,
        // finish-step, tool-input-*, raw, source, file, start, finish, abort)
        // are ignored — we accumulate from *-delta and tool-call only.
      }
    }
  } catch (iterationError) {
    streamError =
      iterationError instanceof Error
        ? iterationError
        : new Error(String(iterationError));
  }

  // ── Build final AssistantMessage ───────────────────────────────────
  const content: (TextContent | ThinkingContent | ToolCall)[] = [];
  if (thinkingBuffer) {
    content.push({ type: "thinking", thinking: thinkingBuffer });
  }
  if (textBuffer) {
    content.push({ type: "text", text: textBuffer });
  }
  content.push(...toolCallBlocks);

  let finish: {
    usage: Usage;
    finishReason: AssistantMessage["stopReason"];
    responseId?: string;
    responseModel?: string;
  };
  try {
    const raw = await result;
    finish = {
      usage: raw.usage,
      finishReason: raw.finishReason,
      ...(raw.responseId ? { responseId: raw.responseId } : {}),
      ...(raw.responseModel ? { responseModel: raw.responseModel } : {}),
    };
  } catch {
    finish = { usage: EMPTY_USAGE, finishReason: "error" };
  }

  const finalMessage: AssistantMessage = {
    role: "assistant",
    content: content.length > 0 ? content : [{ type: "text", text: "" }],
    api: config.model.api,
    provider: config.model.provider,
    model: config.model.id,
    usage: finish.usage,
    stopReason: streamError ? "error" : finish.finishReason,
    timestamp: Date.now(),
    ...(streamError ? { errorMessage: streamError.message } : {}),
    ...(finish.responseId ? { responseId: finish.responseId } : {}),
    ...(finish.responseModel ? { responseModel: finish.responseModel } : {}),
  };

  // Replace placeholder (or push if no content arrived)
  if (messageStarted) {
    context.messages[context.messages.length - 1] = finalMessage;
  } else {
    context.messages.push(finalMessage);
    await emit({ type: "message_start", message: finalMessage });
  }
  await emit({ type: "message_end", message: finalMessage });
  return finalMessage;
}

/** Lazy import of the default stream function from @sakti-code/llm. */
async function defaultStreamFn(
  req: Parameters<StreamFn>[0]
): Promise<Awaited<ReturnType<StreamFn>>> {
  const { stream } = await import("@sakti-code/llm");
  return stream(req);
}

/** Convert AgentTool[] to @ai-sdk tool format (schema-only, no execute). */
function toStreamTools(tools: AgentTool[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const tool of tools) {
    result[tool.name] = {
      description: tool.description,
      parameters: tool.parameters,
    };
  }
  return result;
}

const EMPTY_USAGE: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

/**
 * Execute tool calls from an assistant message.
 */
async function executeToolCalls(
  currentContext: AgentContext,
  assistantMessage: AssistantMessage,
  config: AgentLoopConfig,
  signal: AbortSignal | undefined,
  emit: AgentEventSink
): Promise<ExecutedToolCallBatch> {
  const toolCalls = assistantMessage.content.filter(
    (c) => c.type === "toolCall"
  );
  const hasSequentialToolCall = toolCalls.some(
    (tc) =>
      currentContext.tools?.find((t) => t.name === tc.name)?.executionMode ===
      "sequential"
  );
  if (config.toolExecution === "sequential" || hasSequentialToolCall) {
    return executeToolCallsSequential(
      currentContext,
      assistantMessage,
      toolCalls,
      config,
      signal,
      emit
    );
  }
  return executeToolCallsParallel(
    currentContext,
    assistantMessage,
    toolCalls,
    config,
    signal,
    emit
  );
}

type ExecutedToolCallBatch = {
  messages: ToolResultMessage[];
  terminate: boolean;
};

async function executeToolCallsSequential(
  currentContext: AgentContext,
  assistantMessage: AssistantMessage,
  toolCalls: AgentToolCall[],
  config: AgentLoopConfig,
  signal: AbortSignal | undefined,
  emit: AgentEventSink
): Promise<ExecutedToolCallBatch> {
  const finalizedCalls: FinalizedToolCallOutcome[] = [];
  const messages: ToolResultMessage[] = [];

  for (const toolCall of toolCalls) {
    await emit({
      type: "tool_execution_start",
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      args: toolCall.arguments,
    });

    const preparation = await prepareToolCall(
      currentContext,
      assistantMessage,
      toolCall,
      config,
      signal
    );
    let finalized: FinalizedToolCallOutcome;
    if (preparation.kind === "immediate") {
      finalized = {
        toolCall,
        result: preparation.result,
        isError: preparation.isError,
      };
    } else {
      const executed = await executePreparedToolCall(preparation, signal, emit);
      finalized = await finalizeExecutedToolCall(
        currentContext,
        assistantMessage,
        preparation,
        executed,
        config,
        signal
      );
    }

    await emitToolExecutionEnd(finalized, emit);
    const toolResultMessage = createToolResultMessage(finalized);
    await emitToolResultMessage(toolResultMessage, emit);
    finalizedCalls.push(finalized);
    messages.push(toolResultMessage);

    if (signal?.aborted) {
      break;
    }
  }

  return {
    messages,
    terminate: shouldTerminateToolBatch(finalizedCalls),
  };
}

async function executeToolCallsParallel(
  currentContext: AgentContext,
  assistantMessage: AssistantMessage,
  toolCalls: AgentToolCall[],
  config: AgentLoopConfig,
  signal: AbortSignal | undefined,
  emit: AgentEventSink
): Promise<ExecutedToolCallBatch> {
  const finalizedCalls: FinalizedToolCallEntry[] = [];

  for (const toolCall of toolCalls) {
    await emit({
      type: "tool_execution_start",
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      args: toolCall.arguments,
    });

    const preparation = await prepareToolCall(
      currentContext,
      assistantMessage,
      toolCall,
      config,
      signal
    );
    if (preparation.kind === "immediate") {
      const finalized = {
        toolCall,
        result: preparation.result,
        isError: preparation.isError,
      } satisfies FinalizedToolCallOutcome;
      await emitToolExecutionEnd(finalized, emit);
      finalizedCalls.push(finalized);
      if (signal?.aborted) {
        break;
      }
      continue;
    }

    finalizedCalls.push(async () => {
      const executed = await executePreparedToolCall(preparation, signal, emit);
      const finalized = await finalizeExecutedToolCall(
        currentContext,
        assistantMessage,
        preparation,
        executed,
        config,
        signal
      );
      await emitToolExecutionEnd(finalized, emit);
      return finalized;
    });
    if (signal?.aborted) {
      break;
    }
  }

  const orderedFinalizedCalls = await Promise.all(
    finalizedCalls.map((entry) =>
      typeof entry === "function" ? entry() : Promise.resolve(entry)
    )
  );
  const messages: ToolResultMessage[] = [];
  for (const finalized of orderedFinalizedCalls) {
    const toolResultMessage = createToolResultMessage(finalized);
    await emitToolResultMessage(toolResultMessage, emit);
    messages.push(toolResultMessage);
  }

  return {
    messages,
    terminate: shouldTerminateToolBatch(orderedFinalizedCalls),
  };
}

type PreparedToolCall = {
  kind: "prepared";
  toolCall: AgentToolCall;
  tool: AgentTool<any>;
  args: unknown;
};

type ImmediateToolCallOutcome = {
  kind: "immediate";
  result: AgentToolResult<any>;
  isError: boolean;
};

type ExecutedToolCallOutcome = {
  result: AgentToolResult<any>;
  isError: boolean;
};

type FinalizedToolCallOutcome = {
  toolCall: AgentToolCall;
  result: AgentToolResult<any>;
  isError: boolean;
};

type FinalizedToolCallEntry =
  | FinalizedToolCallOutcome
  | (() => Promise<FinalizedToolCallOutcome>);

function shouldTerminateToolBatch(
  finalizedCalls: FinalizedToolCallOutcome[]
): boolean {
  return (
    finalizedCalls.length > 0 &&
    finalizedCalls.every((finalized) => finalized.result.terminate === true)
  );
}

function prepareToolCallArguments(
  tool: AgentTool<any>,
  toolCall: AgentToolCall
): AgentToolCall {
  if (!tool.prepareArguments) {
    return toolCall;
  }
  const preparedArguments = tool.prepareArguments(toolCall.arguments);
  if (preparedArguments === toolCall.arguments) {
    return toolCall;
  }
  return {
    ...toolCall,
    arguments: preparedArguments as Record<string, any>,
  };
}

async function prepareToolCall(
  currentContext: AgentContext,
  assistantMessage: AssistantMessage,
  toolCall: AgentToolCall,
  config: AgentLoopConfig,
  signal: AbortSignal | undefined
): Promise<PreparedToolCall | ImmediateToolCallOutcome> {
  const tool = currentContext.tools?.find((t) => t.name === toolCall.name);
  if (!tool) {
    return {
      kind: "immediate",
      result: createErrorToolResult(`Tool ${toolCall.name} not found`),
      isError: true,
    };
  }

  try {
    const preparedToolCall = prepareToolCallArguments(tool, toolCall);
    const validatedArgs = validateToolArguments(tool, preparedToolCall);
    if (config.beforeToolCall) {
      const beforeResult = await config.beforeToolCall(
        {
          assistantMessage,
          toolCall,
          args: validatedArgs,
          context: currentContext,
        },
        signal
      );
      if (signal?.aborted) {
        return {
          kind: "immediate",
          result: createErrorToolResult("Operation aborted"),
          isError: true,
        };
      }
      if (beforeResult?.block) {
        return {
          kind: "immediate",
          result: createErrorToolResult(
            beforeResult.reason || "Tool execution was blocked"
          ),
          isError: true,
        };
      }
    }
    if (signal?.aborted) {
      return {
        kind: "immediate",
        result: createErrorToolResult("Operation aborted"),
        isError: true,
      };
    }
    return {
      kind: "prepared",
      toolCall,
      tool,
      args: validatedArgs,
    };
  } catch (error) {
    return {
      kind: "immediate",
      result: createErrorToolResult(
        error instanceof Error ? error.message : String(error)
      ),
      isError: true,
    };
  }
}

async function executePreparedToolCall(
  prepared: PreparedToolCall,
  signal: AbortSignal | undefined,
  emit: AgentEventSink
): Promise<ExecutedToolCallOutcome> {
  const updateEvents: Promise<void>[] = [];
  let acceptingUpdates = true;

  try {
    const result = await prepared.tool.execute(
      prepared.toolCall.id,
      prepared.args as never,
      signal,
      (partialResult) => {
        if (!acceptingUpdates) {
          return;
        }
        updateEvents.push(
          Promise.resolve(
            emit({
              type: "tool_execution_update",
              toolCallId: prepared.toolCall.id,
              toolName: prepared.toolCall.name,
              args: prepared.toolCall.arguments,
              partialResult,
            })
          )
        );
      }
    );
    acceptingUpdates = false;
    await Promise.all(updateEvents);
    return { result, isError: false };
  } catch (error) {
    acceptingUpdates = false;
    await Promise.all(updateEvents);
    return {
      result: createErrorToolResult(
        error instanceof Error ? error.message : String(error)
      ),
      isError: true,
    };
  } finally {
    acceptingUpdates = false;
  }
}

async function finalizeExecutedToolCall(
  currentContext: AgentContext,
  assistantMessage: AssistantMessage,
  prepared: PreparedToolCall,
  executed: ExecutedToolCallOutcome,
  config: AgentLoopConfig,
  signal: AbortSignal | undefined
): Promise<FinalizedToolCallOutcome> {
  let result = executed.result;
  let isError = executed.isError;

  if (config.afterToolCall) {
    try {
      const afterResult = await config.afterToolCall(
        {
          assistantMessage,
          toolCall: prepared.toolCall,
          args: prepared.args,
          result,
          isError,
          context: currentContext,
        },
        signal
      );
      if (afterResult) {
        result = {
          content: afterResult.content ?? result.content,
          details: afterResult.details ?? result.details,
          terminate: afterResult.terminate ?? result.terminate,
        };
        isError = afterResult.isError ?? isError;
      }
    } catch (error) {
      result = createErrorToolResult(
        error instanceof Error ? error.message : String(error)
      );
      isError = true;
    }
  }

  return {
    toolCall: prepared.toolCall,
    result,
    isError,
  };
}

function createErrorToolResult(message: string): AgentToolResult<any> {
  return {
    content: [{ type: "text", text: message }],
    details: {},
  };
}

async function emitToolExecutionEnd(
  finalized: FinalizedToolCallOutcome,
  emit: AgentEventSink
): Promise<void> {
  await emit({
    type: "tool_execution_end",
    toolCallId: finalized.toolCall.id,
    toolName: finalized.toolCall.name,
    result: finalized.result,
    isError: finalized.isError,
  });
}

function createToolResultMessage(
  finalized: FinalizedToolCallOutcome
): ToolResultMessage {
  return {
    role: "toolResult",
    toolCallId: finalized.toolCall.id,
    toolName: finalized.toolCall.name,
    content: finalized.result.content,
    details: finalized.result.details,
    isError: finalized.isError,
    timestamp: Date.now(),
  };
}

async function emitToolResultMessage(
  toolResultMessage: ToolResultMessage,
  emit: AgentEventSink
): Promise<void> {
  await emit({ type: "message_start", message: toolResultMessage });
  await emit({ type: "message_end", message: toolResultMessage });
}
