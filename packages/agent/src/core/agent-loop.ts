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
import { jsonSchema } from "@sakti-code/llm";
import { Cause, Effect, Exit, FiberSet, Queue, Stream } from "effect";
import type {
  AgentContext,
  AgentEvent,
  AgentLoopConfig,
  AgentMessage,
  AgentTool,
  AgentToolCall,
  AgentToolResult,
  PermissionAskRequest,
  StreamFn,
} from "../types";
import { captureShape, compareShape } from "./cache-shape.ts";
import { validateToolArguments } from "./validation.ts";

export type AgentEventSink = (event: AgentEvent) => Promise<void> | void;

/** Lift an AgentEventSink (sync or async) into an Effect. */
const emitEffect = (emit: AgentEventSink, event: AgentEvent): Effect.Effect<void> =>
  Effect.promise(() => Promise.resolve(emit(event)));

/**
 * Public agent event stream: an async-iterable sequence of {@link AgentEvent}s
 * plus a `result()` promise that resolves with the run's final messages.
 *
 * Backed by an Effect `Queue` → `Stream.fromQueue` → `toReadableStream`. The
 * producer (`runWithEmit`) runs as a fire-and-forget Effect that offers events
 * into the queue and terminates it (`Queue.end` on success / `Queue.fail` on
 * error), replacing the hand-rolled push/wait queue + dual error path of the
 * old EventStream. The queue's `E` channel carries the terminal signal
 * (`Cause.Done` = clean end, `Error` = failure).
 */
export type AgentEventStream = AsyncIterable<AgentEvent> & {
  result(): Promise<AgentMessage[]>;
};

function createAgentEventStream(
  runWithEmit: (emit: AgentEventSink) => Effect.Effect<AgentMessage[], unknown>,
): AgentEventStream {
  const queue = Effect.runSync(Queue.unbounded<AgentEvent, Cause.Done | Error>());

  let resolveResult!: (messages: AgentMessage[]) => void;
  let rejectResult!: (error: unknown) => void;
  const resultPromise = new Promise<AgentMessage[]>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });

  // Fire-and-forget producer: offer events, then terminate the queue so the
  // stream ends (Done) or fails (Error). Result promise resolves/rejects here.
  void Effect.runPromise(
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        runWithEmit((event) => {
          Queue.offerUnsafe(queue, event);
        }),
      );
      if (Exit.isSuccess(exit)) {
        resolveResult(exit.value);
        yield* Queue.end(queue);
      } else {
        const squashed = Cause.squash(exit.cause);
        const error = squashed instanceof Error ? squashed : new Error(String(squashed));
        rejectResult(error);
        yield* Queue.fail(queue, error);
      }
    }),
  ).catch(() => {
    /* errors surfaced via result() rejection and stream failure */
  });

  const readable = Stream.toReadableStream(Stream.fromQueue(queue));
  return {
    [Symbol.asyncIterator]: () =>
      (readable as unknown as AsyncIterable<AgentEvent>)[Symbol.asyncIterator](),
    result: () => resultPromise,
  };
}

/**
 * Find the index at which to insert resource-scope (read-only) observation
 * messages — right after the skill-injection pair (the synthetic
 * `[assistant(skill-read toolCall), toolResult]` pair), so observations sit
 * after the skill in the cache prefix. Returns 0 if no skill pair is found.
 *
 * The skill-read tool-call is identified by its tool-call ID prefix
 * `"skill-read"` (set by the skill-injection code in
 * `apps/server/src/agent/config/skill-injection.ts` as `skill-read:<name>`).
 * If this convention changes, update the prefix check below.
 */
function findObservationInsertionIndex(messages: AgentMessage[]): number {
  for (let i = 1; i < messages.length; i++) {
    const prev = messages[i - 1]!;
    const cur = messages[i]!;
    if (cur.role === "toolResult" && prev.role === "assistant") {
      const hasSkillCall =
        Array.isArray(prev.content) &&
        prev.content.some(
          (b) => b.type === "toolCall" && typeof b.id === "string" && b.id.startsWith("skill-read"),
        );
      if (hasSkillCall) return i + 1;
    }
  }
  return 0;
}

/**
 * Start an agent loop with a new prompt message.
 * The prompt is added to the context and events are emitted for it.
 */
export function agentLoop(
  prompts: AgentMessage[],
  context: AgentContext,
  config: AgentLoopConfig,
  signal?: AbortSignal,
  streamFn?: StreamFn,
): AgentEventStream {
  return createAgentEventStream((emit) =>
    runAgentLoopEffect(prompts, context, config, emit, signal, streamFn),
  );
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
  streamFn?: StreamFn,
): AgentEventStream {
  if (context.messages.length === 0) {
    throw new Error("Cannot continue: no messages in context");
  }

  if (context.messages[context.messages.length - 1]!.role === "assistant") {
    throw new Error("Cannot continue from message role: assistant");
  }

  return createAgentEventStream((emit) =>
    runAgentLoopContinueEffect(context, config, emit, signal, streamFn),
  );
}

export async function runAgentLoop(
  prompts: AgentMessage[],
  context: AgentContext,
  config: AgentLoopConfig,
  emit: AgentEventSink,
  signal?: AbortSignal,
  streamFn?: StreamFn,
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

  await Effect.runPromise(
    runLoopEffect(currentContext, newMessages, config, signal, emit, streamFn),
  );
  return newMessages;
}

export async function runAgentLoopContinue(
  context: AgentContext,
  config: AgentLoopConfig,
  emit: AgentEventSink,
  signal?: AbortSignal,
  streamFn?: StreamFn,
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

  await Effect.runPromise(
    runLoopEffect(currentContext, newMessages, config, signal, emit, streamFn),
  );
  return newMessages;
}

/**
 * Effect-native variant of {@link runAgentLoop}.
 * Emits agent_start + prompts via yield*, then runs the loop.
 */
export const runAgentLoopEffect = (
  prompts: AgentMessage[],
  context: AgentContext,
  config: AgentLoopConfig,
  emit: AgentEventSink,
  signal?: AbortSignal,
  streamFn?: StreamFn,
): Effect.Effect<AgentMessage[], undefined, never> =>
  Effect.gen(function* () {
    const newMessages: AgentMessage[] = [...prompts];
    const currentContext: AgentContext = {
      ...context,
      messages: [...context.messages, ...prompts],
    };

    yield* emitEffect(emit, { type: "agent_start" });
    yield* emitEffect(emit, { type: "turn_start" });
    for (const prompt of prompts) {
      yield* emitEffect(emit, { type: "message_start", message: prompt });
      yield* emitEffect(emit, { type: "message_end", message: prompt });
    }

    yield* runLoopEffect(currentContext, newMessages, config, signal, emit, streamFn);
    return newMessages;
  });

/**
 * Effect-native variant of {@link runAgentLoopContinue}.
 */
export const runAgentLoopContinueEffect = (
  context: AgentContext,
  config: AgentLoopConfig,
  emit: AgentEventSink,
  signal?: AbortSignal,
  streamFn?: StreamFn,
): Effect.Effect<AgentMessage[], Error | undefined, never> =>
  Effect.gen(function* () {
    if (context.messages.length === 0) {
      return yield* Effect.fail(new Error("Cannot continue: no messages in context"));
    }

    if (context.messages[context.messages.length - 1]!.role === "assistant") {
      return yield* Effect.fail(new Error("Cannot continue from message role: assistant"));
    }

    const newMessages: AgentMessage[] = [];
    const currentContext: AgentContext = { ...context };

    yield* emitEffect(emit, { type: "agent_start" });
    yield* emitEffect(emit, { type: "turn_start" });

    yield* runLoopEffect(currentContext, newMessages, config, signal, emit, streamFn);
    return newMessages;
  });

/**
 * Main loop logic shared by agentLoop and agentLoopContinue. Effect-native.
 */
const runLoopEffect = (
  initialContext: AgentContext,
  newMessages: AgentMessage[],
  initialConfig: AgentLoopConfig,
  signal: AbortSignal | undefined,
  emit: AgentEventSink,
  streamFn?: StreamFn,
): Effect.Effect<void, undefined, never> =>
  Effect.gen(function* () {
    let currentContext = initialContext;
    let config = initialConfig;
    let firstTurn = true;
    let lastAssistantMessage: AssistantMessage | undefined;
    let step = 0;
    let pendingMessages: AgentMessage[] =
      (yield* Effect.promise(() => config.getSteeringMessages?.() ?? Promise.resolve([]))) || [];

    // §10: wrap streamFn to capture prefix shape for cache diagnostics.
    let prevShape: ReturnType<typeof captureShape> | undefined;
    let lastShape: ReturnType<typeof captureShape> | undefined;
    const diagnosticStreamFn: StreamFn | undefined = streamFn
      ? async (req) => {
          lastShape = captureShape(req);
          return streamFn!(req);
        }
      : undefined;

    while (true) {
      let hasMoreToolCalls = true;

      while (hasMoreToolCalls || pendingMessages.length > 0) {
        if (firstTurn) {
          // §OM read-only: inject the project's resource-scope OM as a stream
          // message after the skill-pair (so the skill stays cached). This is
          // the cross-session memory (not in this session's tree). Ephemeral —
          // re-injected each turn from the record. Own-OM observations are
          // persisted tree entries (rendered by the context builder).
          if (config.observationalMemoryReadOnly) {
            const omReadOnlyBlocks = yield* Effect.promise(async () => {
              try {
                return await config.observationalMemoryReadOnly!.getObservationsBlocks();
              } catch {
                return undefined;
              }
            });
            if (omReadOnlyBlocks !== undefined && omReadOnlyBlocks.length > 0) {
              const insertAt = findObservationInsertionIndex(currentContext.messages);
              const obsMessages: AgentMessage[] = omReadOnlyBlocks.map((text) => ({
                role: "user" as const,
                content: [{ type: "text" as const, text }],
                timestamp: Date.now(),
              }));
              currentContext = {
                ...currentContext,
                messages: [
                  ...currentContext.messages.slice(0, insertAt),
                  ...obsMessages,
                  ...currentContext.messages.slice(insertAt),
                ],
              };
            }
          }
          firstTurn = false;
        } else {
          yield* emitEffect(emit, { type: "turn_start" });
        }

        if (pendingMessages.length > 0) {
          for (const message of pendingMessages) {
            yield* emitEffect(emit, { type: "message_start", message });
            yield* emitEffect(emit, { type: "message_end", message });
            currentContext.messages.push(message);
            newMessages.push(message);
          }
          pendingMessages = [];
        }

        const isLastStep = config.maxSteps !== undefined && step >= config.maxSteps - 1;
        const message = yield* streamAssistantResponse(
          currentContext,
          config,
          signal,
          emit,
          diagnosticStreamFn,
          isLastStep,
        );
        step++;
        newMessages.push(message);
        lastAssistantMessage = message;

        // §10: emit cache-shape diagnostics for the just-completed turn.
        if (lastShape) {
          const diagnostics = compareShape(prevShape, lastShape, message.usage);
          yield* emitEffect(emit, { type: "cache_shape", diagnostics });
          prevShape = lastShape;
        }

        if (message.stopReason === "error" || message.stopReason === "aborted") {
          config.logger?.info("turn finished", {
            stopReason: message.stopReason,
            usage: message.usage,
          });
          yield* emitEffect(emit, {
            type: "turn_end",
            message,
            toolResults: [],
          });
          yield* emitEffect(emit, { type: "agent_end", messages: newMessages });
          return;
        }

        const toolCalls = message.content.filter((c) => c.type === "toolCall");

        const toolResults: ToolResultMessage[] = [];
        hasMoreToolCalls = false;
        if (toolCalls.length > 0) {
          const executedToolBatch = yield* executeToolCalls(
            currentContext,
            message,
            toolCalls,
            config,
            signal,
            emit,
          );
          toolResults.push(...executedToolBatch.messages);
          hasMoreToolCalls = !executedToolBatch.terminate;

          for (const result of toolResults) {
            currentContext.messages.push(result);
            newMessages.push(result);
          }
        }

        yield* emitEffect(emit, { type: "turn_end", message, toolResults });

        const nextTurnContext = {
          message,
          toolResults,
          context: currentContext,
          newMessages,
        };
        const nextTurnSnapshot = yield* Effect.promise(() =>
          Promise.resolve(config.prepareNextTurn?.(nextTurnContext)),
        );
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

        // §OM: run observational-memory observe/reflect at turn boundary.
        // These append ObservationEntry/ReflectionEntry to the session tree
        // (rendered by the context builder into the message stream). The base
        // systemPrompt stays IMMUTABLE. Failures are best-effort and logged.
        if (config.observationalMemory) {
          yield* Effect.promise(async () => {
            try {
              const om = config.observationalMemory!;
              const record = await om.engine.getOrCreateRecord();
              const observedRecord = await om.engine.maybeObserve(record);
              await om.engine.maybeReflect(observedRecord);
            } catch (error: unknown) {
              config.logger?.error("observational memory turn hook failed", error, {
                sessionId: config.sessionId,
              });
            }
          });
        }
        // §OM read-only: inject the project's resource-scope OM as a stream
        // message after the skill-pair. Ephemeral — re-injected each turn.
        if (config.observationalMemoryReadOnly) {
          const omReadOnlyBlocks = yield* Effect.promise(async () => {
            try {
              return await config.observationalMemoryReadOnly!.getObservationsBlocks();
            } catch {
              return undefined;
            }
          });
          if (omReadOnlyBlocks !== undefined && omReadOnlyBlocks.length > 0) {
            const insertAt = findObservationInsertionIndex(currentContext.messages);
            const obsMessages: AgentMessage[] = omReadOnlyBlocks.map((text) => ({
              role: "user" as const,
              content: [{ type: "text" as const, text }],
              timestamp: Date.now(),
            }));
            currentContext = {
              ...currentContext,
              messages: [
                ...currentContext.messages.slice(0, insertAt),
                ...obsMessages,
                ...currentContext.messages.slice(insertAt),
              ],
            };
          }
        }

        const shouldStop = yield* Effect.promise(() =>
          Promise.resolve(
            config.shouldStopAfterTurn?.({
              message,
              toolResults,
              context: currentContext,
              newMessages,
            }),
          ),
        );
        if (shouldStop) {
          config.logger?.info("turn finished", {
            stopReason: message.stopReason,
            usage: message.usage,
          });
          yield* emitEffect(emit, { type: "agent_end", messages: newMessages });
          return;
        }

        config.logger?.debug("iteration complete", {
          messagesInContext: currentContext.messages.length,
          toolCallsInTurn: toolCalls.length,
          hasMoreToolCalls,
          pendingSteeringCount: pendingMessages.length,
        });

        pendingMessages =
          (yield* Effect.promise(() => config.getSteeringMessages?.() ?? Promise.resolve([]))) ||
          [];
      }

      const followUpMessages =
        (yield* Effect.promise(() => config.getFollowUpMessages?.() ?? Promise.resolve([]))) || [];
      if (followUpMessages.length > 0) {
        pendingMessages = followUpMessages;
        continue;
      }

      break;
    }

    config.logger?.info("turn finished", {
      stopReason: lastAssistantMessage?.stopReason,
      usage: lastAssistantMessage?.usage,
    });
    yield* emitEffect(emit, { type: "agent_end", messages: newMessages });
  });

/**
 * Stream an assistant response from the LLM.
 * This is where AgentMessage[] gets transformed to Message[] for the LLM.
 *
 * Consumes @ai-sdk's `fullStream` natively — accumulates text-delta, reasoning-delta,
 * and tool-call parts into an `AssistantMessage`, emitting slim per-token deltas.
 */
const streamAssistantResponse = Effect.fn("agent-loop.streamAssistantResponse")(function* (
  context: AgentContext,
  config: AgentLoopConfig,
  signal: AbortSignal | undefined,
  emit: AgentEventSink,
  streamFn?: StreamFn,
  /** When true, send toolChoice: "none" so the model emits a final answer. */
  forbidTools = false,
) {
  // Apply context transform if configured (AgentMessage[] → AgentMessage[])
  let messages = context.messages;
  if (config.transformContext) {
    messages = yield* Effect.promise(() => config.transformContext!(messages, signal));
  }

  // Convert to LLM-compatible messages (AgentMessage[] → Message[])
  const llmMessages = yield* Effect.promise(() => Promise.resolve(config.convertToLlm(messages)));

  // Resolve API key (important for expiring tokens)
  const resolvedApiKey =
    (config.getApiKey
      ? yield* Effect.promise(() => Promise.resolve(config.getApiKey!(config.model.provider)))
      : undefined) || config.apiKey;

  // Build StreamRequest — @sakti-code/llm's single entry point
  const streamFunction = streamFn ?? defaultStreamFn;
  const { fullStream, result } = yield* Effect.promise(() =>
    Promise.resolve(
      streamFunction({
        model: config.model,
        messages: llmMessages,
        ...(context.systemPrompt ? { system: context.systemPrompt } : {}),
        ...(context.tools && context.tools.length > 0
          ? { tools: toStreamTools(context.tools) }
          : {}),
        ...(forbidTools ? { toolChoice: "none" as const } : {}),
        ...(config.reasoning === undefined ? {} : { thinkingLevel: config.reasoning }),
        ...(resolvedApiKey === undefined ? {} : { apiKey: resolvedApiKey }),
        ...(config.headers ? { headers: config.headers } : {}),
        ...(config.sessionId ? { sessionId: config.sessionId } : {}),
        maxOutputTokens: config.model.maxTokens,
        ...(signal ? { abortSignal: signal } : {}),
      }),
    ),
  );

  // ── Accumulator state ──────────────────────────────────────────────
  let textBuffer = "";
  let thinkingBuffer = "";
  // Timestamps for the "Thought for Xm Ys" UI — set on first reasoning-delta
  // and reasoning-end (or text-delta fallback). Persisted inside ThinkingContent.
  let thinkingStartedAt: number | undefined;
  let thinkingEndedAt: number | undefined;
  // Anthropic encrypted thinking signature from reasoning-end's
  // providerMetadata.anthropic.signature — captured so the messages layer can
  // replay it for multi-turn extended-thinking continuity (gated by the
  // sameModel guard in toModelMessages). Last block wins when several fire.
  let thinkingSignature: string | undefined;
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
  const ensureMessageStarted = (): Effect.Effect<void> =>
    Effect.gen(function* () {
      if (!messageStarted) {
        messageStarted = true;
        context.messages.push(placeholder);
        yield* emitEffect(emit, {
          type: "message_start",
          message: placeholder,
        });
      }
    });

  // ── Iterate fullStream parts ───────────────────────────────────────
  // `@ai-sdk`'s fullStream is an AsyncIterable; lift it into an Effect
  // Stream. Iteration errors (network/parse failures mid-stream) land in the
  // Stream's error channel; we run it under `Effect.exit` so we can capture
  // them into `streamError` and continue to build an error-valued message —
  // matching the previous try/catch semantics (errors are value-encoded as
  // stopReason "error", never thrown to the caller).
  let streamError: Error | undefined;
  const consumed = yield* Stream.runForEach(
    Stream.fromAsyncIterable(
      fullStream as AsyncIterable<Record<string, unknown>>,
      (e): Error => (e instanceof Error ? e : new Error(String(e))),
    ),
    (part) =>
      Effect.gen(function* () {
        const type = part.type as string;
        switch (type) {
          case "text-delta": {
            yield* ensureMessageStarted();
            if (thinkingBuffer && thinkingEndedAt === undefined) {
              thinkingEndedAt = Date.now();
            }
            const delta = part.text as string;
            textBuffer += delta;
            yield* emitEffect(emit, {
              type: "message_update",
              delta: { kind: "text", text: delta },
            });
            break;
          }
          case "reasoning-delta": {
            yield* ensureMessageStarted();
            if (thinkingStartedAt === undefined) {
              thinkingStartedAt = Date.now();
            }
            const delta = part.text as string;
            thinkingBuffer += delta;
            yield* emitEffect(emit, {
              type: "message_update",
              delta: { kind: "thinking", text: delta },
            });
            break;
          }
          case "reasoning-end": {
            thinkingEndedAt = Date.now();
            // Capture the Anthropic encrypted thinking signature for multi-turn
            // extended-thinking continuity (forwarded by toModelMessages when
            // the target model matches — see B4 sameModel guard).
            const signature = (
              part as {
                providerMetadata?: { anthropic?: { signature?: string } };
              }
            ).providerMetadata?.anthropic?.signature;
            if (signature) {
              thinkingSignature = signature;
            }
            break;
          }
          case "tool-call": {
            yield* ensureMessageStarted();
            toolCallBlocks.push({
              type: "toolCall",
              id: part.toolCallId as string,
              name: part.toolName as string,
              arguments: (part.input as Record<string, unknown>) ?? {},
            });
            break;
          }
          case "tool-input-delta": {
            // Live tool-call argument streaming — purely a UI feed. The
            // complete tool-call part (with parsed `input`) arrives via the
            // `tool-call` case below and is what we persist; these deltas
            // let the UI show "Writing toolcall…" instead of looking stuck.
            yield* ensureMessageStarted();
            yield* emitEffect(emit, {
              type: "message_update",
              delta: {
                kind: "tool_input",
                toolCallId: part.toolCallId as string,
                text: (part.input as string) ?? "",
              },
            });
            break;
          }
          case "error": {
            streamError = part.error instanceof Error ? part.error : new Error(String(part.error));
            config.logger?.error("llm stream error part", streamError, {
              model: config.model.id,
              provider: config.model.provider,
            });
            break;
          }
          // Other parts (text-start/end, reasoning-start/end, start-step,
          // finish-step, raw, source, file, start, finish, abort)
          // are ignored — we accumulate from *-delta and tool-call only.
        }
      }),
  ).pipe(Effect.exit);
  if (Exit.isFailure(consumed)) {
    const cause = Cause.squash(consumed.cause);
    streamError = cause instanceof Error ? cause : new Error(String(cause));
    // The llm layer logs `type:"error"` parts, but a thrown iteration error
    // (network/parse failure mid-stream) is only visible here — log it so it
    // never disappears silently.
    config.logger?.error("agent stream iteration failed", streamError, {
      model: config.model.id,
      provider: config.model.provider,
    });
  }

  // ── Build final AssistantMessage ───────────────────────────────────
  const content: (TextContent | ThinkingContent | ToolCall)[] = [];
  if (thinkingBuffer) {
    content.push({
      type: "thinking",
      thinking: thinkingBuffer,
      ...(thinkingSignature ? { thinkingSignature } : {}),
      ...(thinkingStartedAt !== undefined ? { startedAt: thinkingStartedAt } : {}),
      ...(thinkingEndedAt !== undefined ? { endedAt: thinkingEndedAt } : {}),
    });
  }
  if (textBuffer) {
    content.push({ type: "text", text: textBuffer });
  }
  content.push(...toolCallBlocks);

  const rawExit = yield* Effect.promise(() => result).pipe(Effect.exit);
  let finish: {
    usage: Usage;
    finishReason: AssistantMessage["stopReason"];
    responseId?: string;
    responseModel?: string;
  };
  if (Exit.isSuccess(rawExit)) {
    const raw = rawExit.value;
    finish = {
      usage: raw.usage,
      finishReason: raw.finishReason,
      ...(raw.responseId ? { responseId: raw.responseId } : {}),
      ...(raw.responseModel ? { responseModel: raw.responseModel } : {}),
    };
  } else {
    finish = { usage: EMPTY_USAGE, finishReason: "error" };
  }

  // Silent-empty hardening: a provider can return a successful stream that
  // finishes with zero content and zero output tokens (e.g. z.ai returning
  // finish "length" with input=0/output=0 on a request nowhere near the
  // context limit). That is a failed request, not a valid empty completion —
  // synthesize a retryable error so the retry loop backs off and retries,
  // instead of ending the turn with an empty message that leaves the UI
  // buffering forever. Mirrors the explicit stream-error path above.
  if (content.length === 0 && streamError === undefined) {
    streamError = new Error(
      `provider returned an empty response — stream ended without content (finish: ${finish.finishReason})`,
    );
    config.logger?.error("silent empty response", streamError, {
      model: config.model.id,
      provider: config.model.provider,
      finishReason: finish.finishReason,
      usage: finish.usage,
    });
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
    yield* emitEffect(emit, { type: "message_start", message: finalMessage });
  }
  yield* emitEffect(emit, { type: "message_end", message: finalMessage });

  // Diagnose silent-empty turns (e.g. a provider returning finish "stop" with
  // zero content): summarize what actually accumulated vs. the finish reason.
  // Paired with the llm layer's raw/mapped usage trace so a "nothing came
  // back" failure is pinappable from the logs alone.
  config.logger?.debug("stream response", {
    ...(finish.responseModel ? { responseModel: finish.responseModel } : {}),
    ...(finish.responseId ? { responseId: finish.responseId } : {}),
    finishReason: finish.finishReason,
    hadStreamError: streamError !== undefined,
    messageStarted,
    model: config.model.id,
    provider: config.model.provider,
    stopReason: finalMessage.stopReason,
    textLength: textBuffer.length,
    thinkingLength: thinkingBuffer.length,
    toolCallCount: toolCallBlocks.length,
    usage: finalMessage.usage,
  });

  return finalMessage;
});

/** Lazy import of the default stream function from @sakti-code/llm. */
async function defaultStreamFn(
  req: Parameters<StreamFn>[0],
): Promise<Awaited<ReturnType<StreamFn>>> {
  const { stream } = await import("@sakti-code/llm");
  return stream(req);
}

/** Convert AgentTool[] to @ai-sdk tool format (schema-only, no execute).
 *  Sorted by name so tool order is deterministic and cache-stable — a new
 *  tool or MCP plugin connecting mid-session won't shift indices and bust
 *  the prefix. Mirrors Reasonix cache_shape.go:51-64. */
function toStreamTools(tools: AgentTool[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const tool of [...tools].sort((a, b) => a.name.localeCompare(b.name))) {
    result[tool.name] = {
      description: tool.description,
      inputSchema: jsonSchema(tool.parameters),
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
 *
 * Effect-native: sequential execution is lifted via `Effect.promise`, parallel
 * execution runs under `Effect.scoped` to provide the `Scope` that FiberSet
 * requires (Phase 4 will thread the lifecycle scope through directly).
 */
const executeToolCalls = Effect.fn("agent-loop.executeToolCalls")(function* (
  currentContext: AgentContext,
  assistantMessage: AssistantMessage,
  toolCalls: ToolCall[],
  config: AgentLoopConfig,
  signal: AbortSignal | undefined,
  emit: AgentEventSink,
) {
  const hasSequentialToolCall = toolCalls.some(
    (tc) => currentContext.tools?.find((t) => t.name === tc.name)?.executionMode === "sequential",
  );
  if (config.toolExecution === "sequential" || hasSequentialToolCall) {
    return yield* Effect.promise(() =>
      executeToolCallsSequential(currentContext, assistantMessage, toolCalls, config, signal, emit),
    );
  }
  return yield* Effect.scoped(
    executeToolCallsParallel(currentContext, assistantMessage, toolCalls, config, signal, emit),
  );
});

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
  emit: AgentEventSink,
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
      signal,
    );
    let finalized: FinalizedToolCallOutcome;
    if (preparation.kind === "immediate") {
      finalized = {
        toolCall,
        result: preparation.result,
        isError: preparation.isError,
      };
    } else {
      if (config.logger) {
        config.logger.debug("tool call", {
          toolName: toolCall.name,
          toolCallId: toolCall.id,
          argsPreview: JSON.stringify(toolCall.arguments).slice(0, 200),
        });
      }
      const executed = await executePreparedToolCall(preparation, signal, emit);
      finalized = await finalizeExecutedToolCall(
        currentContext,
        assistantMessage,
        preparation,
        executed,
        config,
        signal,
      );
      if (config.logger) {
        config.logger.debug("tool result", {
          toolName: finalized.toolCall.name,
          isError: finalized.isError,
          resultLength: JSON.stringify(finalized.result.content).length,
        });
      }
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

const executeToolCallsParallel = Effect.fn("agent-loop.executeToolCallsParallel")(function* (
  currentContext: AgentContext,
  assistantMessage: AssistantMessage,
  toolCalls: AgentToolCall[],
  config: AgentLoopConfig,
  signal: AbortSignal | undefined,
  emit: AgentEventSink,
) {
  // Indexed outcomes collected from each fiber; FiberSet.join returns void, so
  // results are stashed here and sorted back to source order after joining.
  const finalOutcomes: Array<{
    index: number;
    outcome: FinalizedToolCallOutcome;
  }> = [];
  const set = yield* FiberSet.make<void, never>();

  for (const [i, toolCall] of toolCalls.entries()) {
    yield* emitEffect(emit, {
      type: "tool_execution_start",
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      args: toolCall.arguments,
    });

    const preparation = yield* Effect.promise(() =>
      prepareToolCall(currentContext, assistantMessage, toolCall, config, signal),
    );

    if (preparation.kind === "immediate") {
      const finalized = {
        toolCall,
        result: preparation.result,
        isError: preparation.isError,
      } satisfies FinalizedToolCallOutcome;
      yield* Effect.promise(() => emitToolExecutionEnd(finalized, emit));
      finalOutcomes.push({ index: i, outcome: finalized });
      if (signal?.aborted) {
        break;
      }
      continue;
    }

    // Fork execution into the set. Each fiber emits its own
    // tool_execution_end in completion order; the result is stashed by index
    // and reordered to source order after the set drains.
    yield* Effect.gen(function* () {
      if (config.logger) {
        config.logger.debug("tool call", {
          toolName: preparation.toolCall.name,
          toolCallId: preparation.toolCall.id,
          argsPreview: JSON.stringify(preparation.toolCall.arguments).slice(0, 200),
        });
      }
      const executed = yield* Effect.promise(() =>
        executePreparedToolCall(preparation, signal, emit),
      );
      const finalized = yield* Effect.promise(() =>
        finalizeExecutedToolCall(
          currentContext,
          assistantMessage,
          preparation,
          executed,
          config,
          signal,
        ),
      );
      if (config.logger) {
        config.logger.debug("tool result", {
          toolName: finalized.toolCall.name,
          isError: finalized.isError,
          resultLength: JSON.stringify(finalized.result.content).length,
        });
      }
      yield* Effect.promise(() => emitToolExecutionEnd(finalized, emit));
      finalOutcomes.push({ index: i, outcome: finalized });
    }).pipe(FiberSet.run(set));
    if (signal?.aborted) {
      break;
    }
  }

  // Wait for every forked tool fiber. `join` surfaces the first failure (its
  // deferred completes on error or scope close); `awaitEmpty` completes once
  // all fibers have drained. `raceFirst` resolves on whichever fires first —
  // without this race a bare `join` would hang when every tool succeeds.
  // Mirrors opencode's session runner (session/runner/llm.ts).
  yield* Effect.raceFirst(FiberSet.join(set), FiberSet.awaitEmpty(set));

  const ordered = finalOutcomes.sort((a, b) => a.index - b.index).map((r) => r.outcome);
  const messages: ToolResultMessage[] = [];
  for (const finalized of ordered) {
    const toolResultMessage = createToolResultMessage(finalized);
    yield* Effect.promise(() => emitToolResultMessage(toolResultMessage, emit));
    messages.push(toolResultMessage);
  }

  return {
    messages,
    terminate: shouldTerminateToolBatch(ordered),
  };
});

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

function shouldTerminateToolBatch(finalizedCalls: FinalizedToolCallOutcome[]): boolean {
  return (
    finalizedCalls.length > 0 &&
    finalizedCalls.every((finalized) => finalized.result.terminate === true)
  );
}

function prepareToolCallArguments(tool: AgentTool<any>, toolCall: AgentToolCall): AgentToolCall {
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
  signal: AbortSignal | undefined,
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
    if (config.evaluatePermission && tool.permissions) {
      const requests = tool.permissions(validatedArgs) ?? [];
      let deny = false;
      const askQueue: PermissionAskRequest[] = [];
      for (const request of requests) {
        if (deny) {
          break;
        }
        for (const pattern of request.patterns) {
          const action = config.evaluatePermission(request.permission, pattern);
          if (action === "deny") {
            deny = true;
            break;
          }
          if (action === "ask") {
            askQueue.push({
              sessionId: config.sessionId ?? "",
              permission: request.permission,
              patterns: request.patterns,
              always: request.patterns,
              toolName: toolCall.name,
              toolCallId: toolCall.id,
            });
            break;
          }
        }
      }
      if (deny) {
        return {
          kind: "immediate",
          result: createErrorToolResult(`Permission denied for tool "${tool.name}"`),
          isError: true,
        };
      }
      if (askQueue.length > 0) {
        const resolver = config.resolvePermissionAsk;
        if (resolver) {
          for (const ask of askQueue) {
            if (signal?.aborted) {
              break;
            }
            const verdict = await resolver(ask);
            if (verdict === "deny") {
              return {
                kind: "immediate",
                result: createErrorToolResult(`Permission denied for tool "${tool.name}"`),
                isError: true,
              };
            }
          }
        } else {
          return {
            kind: "immediate",
            result: createErrorToolResult(`Permission denied for tool "${tool.name}"`),
            isError: true,
          };
        }
      }
    }
    if (config.beforeToolCall) {
      const beforeResult = await config.beforeToolCall(
        {
          assistantMessage,
          toolCall,
          args: validatedArgs,
          context: currentContext,
        },
        signal,
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
          result: createErrorToolResult(beforeResult.reason || "Tool execution was blocked"),
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
      result: createErrorToolResult(error instanceof Error ? error.message : String(error)),
      isError: true,
    };
  }
}

async function executePreparedToolCall(
  prepared: PreparedToolCall,
  signal: AbortSignal | undefined,
  emit: AgentEventSink,
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
            }),
          ),
        );
      },
    );
    acceptingUpdates = false;
    await Promise.all(updateEvents);
    return { result, isError: false };
  } catch (error) {
    acceptingUpdates = false;
    await Promise.all(updateEvents);
    return {
      result: createErrorToolResult(error instanceof Error ? error.message : String(error)),
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
  signal: AbortSignal | undefined,
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
        signal,
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
      result = createErrorToolResult(error instanceof Error ? error.message : String(error));
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
  emit: AgentEventSink,
): Promise<void> {
  await emit({
    type: "tool_execution_end",
    toolCallId: finalized.toolCall.id,
    toolName: finalized.toolCall.name,
    result: finalized.result,
    isError: finalized.isError,
  });
}

function createToolResultMessage(finalized: FinalizedToolCallOutcome): ToolResultMessage {
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
  emit: AgentEventSink,
): Promise<void> {
  await emit({ type: "message_start", message: toolResultMessage });
  await emit({ type: "message_end", message: toolResultMessage });
}
