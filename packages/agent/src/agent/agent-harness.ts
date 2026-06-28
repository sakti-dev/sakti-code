import type {
  AssistantMessage,
  ImageContent,
  Model,
  UserMessage,
} from "@sakti-code/llm";
import type { Logger } from "@sakti-code/logger";
import { Effect } from "effect";
import { buildHarnessStreamRequest } from "../agent/build-stream-request";
import { DEFAULT_SYSTEM_PROMPT } from "../agents/builtin-agents";
import {
  collectEntriesForBranchSummaryEffect,
  generateBranchSummaryEffect,
} from "../compaction/branch-summarization";
import {
  DEFAULT_COMPACTION_SETTINGS,
  prepareCompaction,
  compactEffect as runCompactEffect,
} from "../compaction/compaction";
import { runAgentLoop, runAgentLoopContinue } from "../core/agent-loop";
import type {
  AbortResult,
  AgentDefinition,
  AgentHarnessEvent,
  AgentHarnessEventResultMap,
  AgentHarnessOptions,
  AgentHarnessOwnEvent,
  AgentHarnessPhase,
  AgentHarnessResources,
  AgentHarnessStreamOptions,
  AgentHarnessStreamOptionsPatch,
  ExecutionEnv,
  NavigateTreeResult,
  PendingSessionWrite,
  PromptTemplate,
  SessionError,
  Skill,
} from "../harness-types";
import {
  AgentHarnessError,
  type AgentHarnessErrorCode,
  isFailure,
  ok,
  toError,
} from "../harness-types";
import { formatPromptTemplateInvocation } from "../resources/prompt-templates";
import { formatSkillInvocation } from "../resources/skills";
import { formatSkillsAddedNotice } from "../resources/skills-added-notice";
import { convertToLlm } from "../session/messages";
import type { SessionShape } from "../session/session";
import type {
  AgentContext,
  AgentEvent,
  AgentLoopConfig,
  AgentMessage,
  AgentTool,
  PermissionAskRequest,
  QueueMode,
  StreamFn,
  ThinkingLevel,
} from "../types";

function createUserMessage(text: string, images?: ImageContent[]): UserMessage {
  const content: Array<{ type: "text"; text: string } | ImageContent> = [
    { type: "text", text },
  ];
  if (images) {
    content.push(...images);
  }
  return { role: "user", content, timestamp: Date.now() };
}

function createFailureMessage(
  model: Model,
  error: unknown,
  aborted: boolean
): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text: "" }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    stopReason: aborted ? "aborted" : "error",
    errorMessage: error instanceof Error ? error.message : String(error),
    timestamp: Date.now(),
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  };
}

function cloneStreamOptions(
  streamOptions?: AgentHarnessStreamOptions
): AgentHarnessStreamOptions {
  return {
    ...streamOptions,
    headers: streamOptions?.headers ? { ...streamOptions.headers } : undefined,
  };
}

function mergeHeaders(
  ...headers: Array<Record<string, string> | undefined>
): Record<string, string> | undefined {
  const merged: Record<string, string> = {};
  let hasHeaders = false;
  for (const entry of headers) {
    if (!entry) {
      continue;
    }
    Object.assign(merged, entry);
    hasHeaders = true;
  }
  return hasHeaders ? merged : undefined;
}

function findDuplicateNames(names: string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const name of names) {
    if (seen.has(name)) {
      duplicates.add(name);
    }
    seen.add(name);
  }
  return [...duplicates];
}

function applyStreamOptionsPatch(
  base: AgentHarnessStreamOptions,
  patch?: AgentHarnessStreamOptionsPatch
): AgentHarnessStreamOptions {
  const result = cloneStreamOptions(base);
  if (!patch) {
    return result;
  }

  if (Object.hasOwn(patch, "headers")) {
    if (patch.headers === undefined) {
      result.headers = undefined;
    } else {
      const headers = { ...(result.headers ?? {}) };
      for (const [key, value] of Object.entries(patch.headers)) {
        if (value === undefined) {
          delete headers[key];
        } else {
          headers[key] = value;
        }
      }
      result.headers = Object.keys(headers).length > 0 ? headers : undefined;
    }
  }

  return result;
}

const SUBSCRIBER_EVENT_TYPE = "*";

type AgentHarnessHandler = (
  event: AgentHarnessEvent,
  signal?: AbortSignal
) => Promise<unknown> | unknown;

function normalizeHarnessError(
  error: unknown,
  fallbackCode: AgentHarnessErrorCode
): AgentHarnessError {
  if (error instanceof AgentHarnessError) {
    return error;
  }
  const cause = toError(error);
  if (
    cause instanceof Error &&
    "_tag" in cause &&
    typeof cause._tag === "string"
  ) {
    switch (cause._tag) {
      case "SessionError":
        return new AgentHarnessError({
          code: "session",
          message: cause.message,
          cause,
        });
      case "CompactionError":
        return new AgentHarnessError({
          code: "compaction",
          message: cause.message,
          cause,
        });
      case "BranchSummaryError":
        return new AgentHarnessError({
          code: "branch_summary",
          message: cause.message,
          cause,
        });
    }
  }
  return new AgentHarnessError({
    code: fallbackCode,
    message: cause.message,
    cause,
  });
}

function normalizeHookError(error: unknown): AgentHarnessError {
  return normalizeHarnessError(error, "hook");
}

interface AgentHarnessTurnState<
  TSkill extends Skill = Skill,
  TPromptTemplate extends PromptTemplate = PromptTemplate,
  TTool extends AgentTool = AgentTool,
> {
  activeTools: TTool[];
  messages: AgentMessage[];
  model: Model;
  resources: AgentHarnessResources<TSkill, TPromptTemplate>;
  sessionId: string;
  streamOptions: AgentHarnessStreamOptions;
  systemPrompt: string;
  thinkingLevel: ThinkingLevel;
  tools: TTool[];
}

export class AgentHarness<
  TSkill extends Skill = Skill,
  TPromptTemplate extends PromptTemplate = PromptTemplate,
  TTool extends AgentTool = AgentTool,
> {
  readonly env: ExecutionEnv;
  private session: SessionShape;
  private phase: AgentHarnessPhase = "idle";
  private runAbortController?: AbortController | undefined;
  private runPromise?: Promise<void> | undefined;
  private pendingSessionWrites: PendingSessionWrite[] = [];
  private model: Model;
  private maxSteps?: number;
  private thinkingLevel: ThinkingLevel;
  private systemPrompt: AgentHarnessOptions<
    TSkill,
    TPromptTemplate,
    TTool
  >["systemPrompt"];
  /**
   * Pending system-prompt swap scheduled by {@link scheduleSystemPromptRefresh}.
   * Drained by {@link compact} (compaction busts the cache anyway, so the swap
   * is free there) and cleared by {@link switchAgent} (which supersedes it).
   * Layer 2 (in-memory only); restart-safe because Layer 1 (disabled_skills
   * filter in the runner) recomposes the correct prompt at load.
   */
  private pendingSystemPromptRefresh: string | undefined;
  private streamOptions: AgentHarnessStreamOptions;
  private testStreamFn?: StreamFn;
  private getApiKeyAndHeaders?: AgentHarnessOptions["getApiKeyAndHeaders"];
  private logger?: Logger | undefined;
  private streamLogger?: Logger | undefined;
  private resources: AgentHarnessResources<TSkill, TPromptTemplate>;
  private tools = new Map<string, TTool>();
  private activeToolNames: string[];
  private currentAgent: AgentDefinition | undefined;
  private permissionEvaluator?:
    | ((permission: string, pattern: string) => "allow" | "deny" | "ask")
    | undefined;
  private permissionAskResolver?:
    | ((req: PermissionAskRequest) => Promise<"allow" | "deny">)
    | undefined;
  private steerQueue: UserMessage[] = [];
  private steeringQueueMode: QueueMode;
  private followUpQueue: UserMessage[] = [];
  private followUpQueueMode: QueueMode;
  private nextTurnQueue: AgentMessage[] = [];
  private handlers = new Map<string, Set<AgentHarnessHandler>>();

  constructor(options: AgentHarnessOptions<TSkill, TPromptTemplate, TTool>) {
    this.env = options.env;
    this.session = options.session;
    this.resources = options.resources ?? {};
    this.streamOptions = cloneStreamOptions(options.streamOptions);
    if (options.streamFn) {
      this.testStreamFn = options.streamFn;
    }
    this.systemPrompt = options.systemPrompt;
    this.getApiKeyAndHeaders = options.getApiKeyAndHeaders;
    this.logger = options.logger;
    this.streamLogger = options.streamLogger;
    this.validateUniqueNames(
      (options.tools ?? []).map((tool) => tool.name),
      "Duplicate tool name(s)"
    );
    for (const tool of options.tools ?? []) {
      this.tools.set(tool.name, tool);
    }
    this.model = options.model;
    if (options.maxSteps !== undefined) {
      this.maxSteps = options.maxSteps;
    }
    this.thinkingLevel = options.thinkingLevel ?? "off";
    this.activeToolNames = options.activeToolNames
      ? [...options.activeToolNames]
      : (options.tools ?? []).map((tool) => tool.name);
    this.validateUniqueNames(
      this.activeToolNames,
      "Duplicate active tool name(s)"
    );
    this.validateToolNames(this.activeToolNames);
    this.steeringQueueMode = options.steeringMode ?? "one-at-a-time";
    this.followUpQueueMode = options.followUpMode ?? "one-at-a-time";
  }

  private getHandlers(type: string): Set<AgentHarnessHandler> | undefined {
    return this.handlers.get(type);
  }

  private async emitOwn(
    event: AgentHarnessOwnEvent<TSkill, TPromptTemplate>,
    signal?: AbortSignal
  ): Promise<void> {
    const handlers = this.getHandlers(SUBSCRIBER_EVENT_TYPE);
    if (!handlers || handlers.size === 0) {
      return;
    }
    for (const listener of handlers) {
      try {
        await listener(event, signal);
      } catch (error) {
        throw normalizeHookError(error);
      }
    }
  }

  private async emitAny(
    event: AgentHarnessEvent<TSkill, TPromptTemplate>,
    signal?: AbortSignal
  ): Promise<void> {
    const handlers = this.getHandlers(SUBSCRIBER_EVENT_TYPE);
    if (!handlers || handlers.size === 0) {
      return;
    }
    for (const listener of handlers) {
      try {
        await listener(event, signal);
      } catch (error) {
        throw normalizeHookError(error);
      }
    }
  }

  private async emitHook<TType extends keyof AgentHarnessEventResultMap>(
    event: Extract<AgentHarnessOwnEvent, { type: TType }>
  ): Promise<AgentHarnessEventResultMap[TType] | undefined> {
    const handlers = this.getHandlers(event.type as TType);
    if (!handlers || handlers.size === 0) {
      return;
    }
    let lastResult: AgentHarnessEventResultMap[TType] | undefined;
    for (const handler of handlers) {
      try {
        const result = (await handler(event)) as
          | AgentHarnessEventResultMap[TType]
          | undefined;
        if (result !== undefined) {
          lastResult = result;
        }
      } catch (error) {
        throw normalizeHookError(error);
      }
    }
    return lastResult;
  }

  private async emitBeforeProviderRequest(
    model: Model,
    sessionId: string,
    streamOptions: AgentHarnessStreamOptions
  ): Promise<AgentHarnessStreamOptions> {
    const handlers = this.getHandlers("before_provider_request");
    let current = cloneStreamOptions(streamOptions);
    if (!handlers || handlers.size === 0) {
      return current;
    }
    for (const handler of handlers) {
      try {
        const result = (await handler({
          type: "before_provider_request",
          model,
          sessionId,
          streamOptions: current,
        })) as { streamOptions?: AgentHarnessStreamOptionsPatch } | undefined;
        if (result?.streamOptions) {
          current = applyStreamOptionsPatch(current, result.streamOptions);
        }
      } catch (error) {
        throw normalizeHookError(error);
      }
    }
    return current;
  }

  private async emitQueueUpdate(): Promise<void> {
    await this.emitOwn({
      type: "queue_update",
      steer: [...this.steerQueue],
      followUp: [...this.followUpQueue],
      nextTurn: [...this.nextTurnQueue],
    });
  }

  private startRunPromise(): () => void {
    let finish = () => {};
    this.runPromise = new Promise<void>((resolve) => {
      finish = resolve;
    });
    return () => {
      this.runPromise = undefined;
      finish();
    };
  }

  private async runAsTurn<T>(
    mode: string,
    fn: (
      turnState: AgentHarnessTurnState<TSkill, TPromptTemplate, TTool>
    ) => Promise<T>
  ): Promise<T> {
    if (this.phase !== "idle") {
      throw new AgentHarnessError({
        code: "busy",
        message: "AgentHarness is busy",
      });
    }
    this.phase = "turn";
    this.logger?.info("turn started", {
      mode,
      model: this.model.id,
      provider: this.model.provider,
    });
    const finishRunPromise = this.startRunPromise();
    try {
      const turnState = await this.createTurnState();
      return await fn(turnState);
    } catch (error) {
      this.phase = "idle";
      throw normalizeHarnessError(error, "unknown");
    } finally {
      finishRunPromise();
    }
  }

  private createTurnStateEffect = (): Effect.Effect<
    AgentHarnessTurnState<TSkill, TPromptTemplate, TTool>,
    SessionError
  > => {
    const self = this;
    return Effect.gen(function* () {
      const context = yield* self.session.buildContext();
      const resources = self.getResources();
      const sessionMetadata = yield* self.session.getMetadata();
      const tools = [...self.tools.values()];
      const activeTools = self.activeToolNames
        .map((name) => self.tools.get(name))
        .filter((tool): tool is TTool => tool !== undefined);
      let systemPrompt = DEFAULT_SYSTEM_PROMPT;
      const sp = self.systemPrompt;
      if (typeof sp === "string") {
        systemPrompt = sp;
      } else if (sp) {
        systemPrompt = yield* Effect.promise(() =>
          Promise.resolve(
            sp({
              env: self.env,
              session: self.session,
              model: self.model,
              thinkingLevel: self.thinkingLevel,
              activeTools,
              resources,
            })
          )
        );
      }
      return {
        messages: context.messages,
        resources,
        streamOptions: cloneStreamOptions(self.streamOptions),
        sessionId: sessionMetadata.id,
        systemPrompt,
        model: self.model,
        thinkingLevel: self.thinkingLevel,
        tools,
        activeTools,
      };
    });
  };

  private async createTurnState(): Promise<
    AgentHarnessTurnState<TSkill, TPromptTemplate, TTool>
  > {
    return Effect.runPromise(this.createTurnStateEffect());
  }

  private createContext(
    turnState: AgentHarnessTurnState<TSkill, TPromptTemplate, TTool>,
    systemPrompt?: string
  ): AgentContext {
    return {
      systemPrompt: systemPrompt ?? turnState.systemPrompt,
      messages: turnState.messages.slice(),
      tools: turnState.activeTools.slice(),
    };
  }

  private createStreamFn(
    getTurnState: () => AgentHarnessTurnState<TSkill, TPromptTemplate, TTool>
  ): StreamFn {
    return async (req) => {
      const turnState = getTurnState();
      const auth = await this.getApiKeyAndHeaders?.(req.model);
      // Stream errors route to the llm logger (llm.log) when supplied,
      // otherwise fall back to the agent logger.
      const streamLogger = this.streamLogger ?? this.logger;

      // Merge headers from turn state + auth + caller request
      const mergedHeaders = mergeHeaders(
        mergeHeaders(turnState.streamOptions.headers, auth?.headers),
        req.headers
      );

      // Emit before_provider_request hook (allows header patching)
      const requestOptions = await this.emitBeforeProviderRequest(
        req.model,
        turnState.sessionId,
        {
          ...turnState.streamOptions,
          headers: mergedHeaders,
        }
      );

      // Use test-injected streamFn if provided, otherwise call real stream()
      if (this.testStreamFn) {
        return this.testStreamFn(req);
      }
      this.logger?.debug("llm call starting", {
        messageCount: req.messages.length,
        maxTokens: req.maxOutputTokens,
        thinkingLevel: req.thinkingLevel,
        toolCount: req.tools ? Object.keys(req.tools).length : 0,
      });
      const { stream } = await import("@sakti-code/llm");
      // buildHarnessStreamRequest forwards the loop's full request (including
      // maxOutputTokens, toolChoice, temperature, topP — previously dropped)
      // while injecting harness-owned sessionId, resolved api key, hook-merged
      // headers, and the stream logger.
      return stream(
        buildHarnessStreamRequest(req, {
          sessionId: turnState.sessionId,
          ...(requestOptions.headers
            ? { headers: requestOptions.headers }
            : {}),
          ...(auth?.apiKey ? { apiKey: auth.apiKey } : {}),
          ...(streamLogger === undefined ? {} : { logger: streamLogger }),
        })
      );
    };
  }

  private async drainQueuedMessages(
    queue: AgentMessage[],
    mode: QueueMode
  ): Promise<AgentMessage[]> {
    const messages = mode === "all" ? queue.splice(0) : queue.splice(0, 1);
    if (messages.length === 0) {
      return messages;
    }
    try {
      await this.emitQueueUpdate();
      return messages;
    } catch (error) {
      queue.unshift(...messages);
      throw normalizeHookError(error);
    }
  }

  private createLoopConfig(
    getTurnState: () => AgentHarnessTurnState<TSkill, TPromptTemplate, TTool>,
    setTurnState: (
      turnState: AgentHarnessTurnState<TSkill, TPromptTemplate, TTool>
    ) => void
  ): AgentLoopConfig {
    const turnState = getTurnState();
    return {
      model: turnState.model,
      sessionId: turnState.sessionId,
      ...(this.maxSteps === undefined ? {} : { maxSteps: this.maxSteps }),
      ...(turnState.thinkingLevel === "off"
        ? {}
        : { reasoning: turnState.thinkingLevel }),
      ...(this.logger === undefined ? {} : { logger: this.logger }),
      ...(this.permissionEvaluator === undefined
        ? {}
        : {
            evaluatePermission: (permission: string, pattern: string) =>
              this.permissionEvaluator!(permission, pattern),
          }),
      ...(this.permissionAskResolver === undefined
        ? {}
        : {
            resolvePermissionAsk: (
              req: PermissionAskRequest
            ): Promise<"allow" | "deny"> => this.permissionAskResolver!(req),
          }),
      convertToLlm,
      transformContext: async (messages) => {
        const result = await this.emitHook({
          type: "context",
          messages: [...messages],
        });
        return result?.messages ?? messages;
      },
      beforeToolCall: async ({ toolCall, args }) => {
        const result = await this.emitHook({
          type: "tool_call",
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          input: args as Record<string, unknown>,
        });
        return result
          ? { block: result.block, reason: result.reason }
          : undefined;
      },
      afterToolCall: async ({ toolCall, args, result, isError }) => {
        const patch = await this.emitHook({
          type: "tool_result",
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          input: args as Record<string, unknown>,
          content: result.content,
          details: result.details,
          isError,
        });
        return patch
          ? {
              content: patch.content,
              details: patch.details,
              isError: patch.isError,
              terminate: patch.terminate,
            }
          : undefined;
      },
      prepareNextTurn: async () => {
        await this.flushPendingSessionWrites();
        const nextTurnState = await this.createTurnState();
        setTurnState(nextTurnState);
        return {
          context: this.createContext(nextTurnState),
          model: nextTurnState.model,
          thinkingLevel: nextTurnState.thinkingLevel,
        };
      },
      getSteeringMessages: async () =>
        this.drainQueuedMessages(this.steerQueue, this.steeringQueueMode),
      getFollowUpMessages: async () =>
        this.drainQueuedMessages(this.followUpQueue, this.followUpQueueMode),
    };
  }

  private validateUniqueNames(names: string[], message: string): void {
    const duplicates = findDuplicateNames(names);
    if (duplicates.length > 0) {
      throw new AgentHarnessError({
        code: "invalid_argument",
        message: `${message}: ${duplicates.join(", ")}`,
      });
    }
  }

  private validateToolNames(
    toolNames: string[],
    tools: Map<string, TTool> = this.tools
  ): void {
    this.validateUniqueNames(toolNames, "Duplicate active tool name(s)");
    const missing = toolNames.filter((name) => !tools.has(name));
    if (missing.length > 0) {
      throw new AgentHarnessError({
        code: "invalid_argument",
        message: `Unknown tool(s): ${missing.join(", ")}`,
      });
    }
  }

  private flushPendingSessionWritesEffect = (): Effect.Effect<
    void,
    SessionError
  > => {
    const self = this;
    return Effect.gen(function* () {
      while (self.pendingSessionWrites.length > 0) {
        const write = self.pendingSessionWrites[0]!;
        if (write.type === "message") {
          yield* self.session.appendMessage(write.message);
        } else if (write.type === "model_change") {
          yield* self.session.appendModelChange(write.provider, write.modelId);
        } else if (write.type === "thinking_level_change") {
          yield* self.session.appendThinkingLevelChange(write.thinkingLevel);
        } else if (write.type === "active_tools_change") {
          yield* self.session.appendActiveToolsChange(write.activeToolNames);
        } else if (write.type === "custom") {
          yield* self.session.appendCustomEntry(write.customType, write.data);
        } else if (write.type === "custom_message") {
          yield* self.session.appendCustomMessageEntry(
            write.customType,
            write.content,
            write.display,
            write.details
          );
        } else if (write.type === "label") {
          yield* self.session.appendLabel(write.targetId, write.label);
        } else if (write.type === "session_info") {
          yield* self.session.appendSessionName(write.name ?? "");
        } else if (write.type === "leaf") {
          yield* self.session.moveTo(write.targetId);
        }
        self.pendingSessionWrites.shift();
      }
    });
  };

  private async flushPendingSessionWrites(): Promise<void> {
    await Effect.runPromise(this.flushPendingSessionWritesEffect());
  }

  private async handleAgentEvent(
    event: AgentEvent,
    signal?: AbortSignal
  ): Promise<void> {
    if (
      event.type !== "message_end" &&
      event.type !== "turn_end" &&
      event.type !== "agent_end"
    ) {
      await this.emitAny(event, signal);
      return;
    }

    const self = this;
    await Effect.runPromise(
      Effect.gen(function* () {
        if (event.type === "message_end") {
          yield* self.session.appendMessage(event.message);
          yield* Effect.promise(() => self.emitAny(event, signal));
          return;
        }
        if (event.type === "turn_end") {
          const eventError = yield* Effect.promise(() =>
            self
              .emitAny(event, signal)
              .then(() => undefined)
              .catch((e: unknown) => e)
          );
          const hadPendingMutations = self.pendingSessionWrites.length > 0;
          yield* self.flushPendingSessionWritesEffect();
          if (eventError) {
            yield* Effect.fail(eventError);
          }
          yield* Effect.promise(() =>
            self.emitOwn({ type: "save_point", hadPendingMutations })
          );
          return;
        }
        if (event.type === "agent_end") {
          yield* self.flushPendingSessionWritesEffect();
          self.phase = "idle";
          yield* Effect.promise(() => self.emitAny(event, signal));
          yield* Effect.promise(() =>
            self.emitOwn(
              { type: "settled", nextTurnCount: self.nextTurnQueue.length },
              signal
            )
          );
          return;
        }
      })
    );
  }

  private async emitRunFailure(
    model: Model,
    error: unknown,
    aborted: boolean,
    signal: AbortSignal
  ): Promise<AgentMessage[]> {
    const failureMessage = createFailureMessage(model, error, aborted);
    await this.handleAgentEvent(
      { type: "message_start", message: failureMessage },
      signal
    );
    await this.handleAgentEvent(
      { type: "message_end", message: failureMessage },
      signal
    );
    await this.handleAgentEvent(
      { type: "turn_end", message: failureMessage, toolResults: [] },
      signal
    );
    await this.handleAgentEvent(
      { type: "agent_end", messages: [failureMessage] },
      signal
    );
    return [failureMessage];
  }

  private async executeTurn(
    turnState: AgentHarnessTurnState<TSkill, TPromptTemplate, TTool>,
    text: string,
    options?: { images?: ImageContent[] }
  ): Promise<AssistantMessage> {
    let activeTurnState = turnState;
    let messages: AgentMessage[] = [createUserMessage(text, options?.images)];
    if (this.nextTurnQueue.length > 0) {
      const queuedMessages = this.nextTurnQueue.splice(0);
      try {
        await this.emitQueueUpdate();
      } catch (error) {
        this.nextTurnQueue.unshift(...queuedMessages);
        throw normalizeHookError(error);
      }
      messages = [...queuedMessages, messages[0]!];
    }
    const beforeResult = await this.emitHook({
      type: "before_agent_start",
      prompt: text,
      images: options?.images,
      systemPrompt: turnState.systemPrompt,
      resources: turnState.resources,
    });
    if (beforeResult?.messages) {
      messages = [...messages, ...beforeResult.messages];
    }

    const abortController = new AbortController();
    const getTurnState = () => activeTurnState;
    const setTurnState = (
      nextTurnState: AgentHarnessTurnState<TSkill, TPromptTemplate, TTool>
    ) => {
      activeTurnState = nextTurnState;
    };
    this.runAbortController = abortController;
    const runResultPromise = (async () => {
      try {
        return await runAgentLoop(
          messages,
          this.createContext(turnState, beforeResult?.systemPrompt),
          this.createLoopConfig(getTurnState, setTurnState),
          (event) => this.handleAgentEvent(event, abortController.signal),
          abortController.signal,
          this.createStreamFn(getTurnState)
        );
      } catch (error) {
        this.logger?.error("turn failed", error, {
          model: activeTurnState.model.id,
          provider: activeTurnState.model.provider,
          aborted: String(abortController.signal.aborted),
        });
        try {
          return await this.emitRunFailure(
            activeTurnState.model,
            error,
            abortController.signal.aborted,
            abortController.signal
          );
        } catch (failureError) {
          const cause = new AggregateError(
            [toError(error), toError(failureError)],
            "Agent run failed and failure reporting failed"
          );
          throw new AgentHarnessError({
            code: "unknown",
            message: cause.message,
            cause,
          });
        }
      }
    })();
    try {
      const newMessages = await runResultPromise;
      for (let i = newMessages.length - 1; i >= 0; i--) {
        const message = newMessages[i]!;
        if (message.role === "assistant") {
          return message;
        }
      }
      throw new AgentHarnessError({
        code: "invalid_state",
        message: "AgentHarness prompt completed without an assistant message",
      });
    } finally {
      try {
        await this.flushPendingSessionWrites();
      } finally {
        this.runAbortController = undefined;
      }
    }
  }

  async prompt(
    text: string,
    options?: { images?: ImageContent[] }
  ): Promise<AssistantMessage> {
    return this.runAsTurn("prompt", (turnState) =>
      this.executeTurn(turnState, text, options)
    );
  }

  /**
   * Continue the agent loop from the current transcript WITHOUT adding a new
   * prompt message. Used by the server's retry loop: after a failed turn is
   * rolled back (session leaf moved past the failed assistant message), the
   * transcript ends in a user or toolResult message, and `continue()` re-runs
   * the loop to produce a fresh assistant response.
   *
   * Unlike {@link prompt} this does NOT:
   * - create a new user message,
   * - emit the `before_agent_start` hook (the prompt hasn't changed),
   * - drain the next-turn queue (retry reuses the existing tail).
   *
   * @returns The last assistant message produced by the continued turn.
   * @throws {AgentHarnessError} code `"busy"` if not idle, `"invalid_state"`
   *   if the transcript is empty or ends in an assistant message.
   */
  async continue(): Promise<AssistantMessage> {
    if (this.phase !== "idle") {
      throw new AgentHarnessError({
        code: "busy",
        message: "AgentHarness is busy",
      });
    }
    this.phase = "turn";
    this.logger?.info("turn started", {
      mode: "continue",
      model: this.model.id,
      provider: this.model.provider,
    });
    const finishRunPromise = this.startRunPromise();
    try {
      // Build the turn state from the CURRENT session (post-rollback in the
      // retry case). `messages` reflects the live leaf, not a fresh prompt.
      let activeTurnState = await this.createTurnState();
      const getTurnState = () => activeTurnState;
      const setTurnState = (
        nextTurnState: AgentHarnessTurnState<TSkill, TPromptTemplate, TTool>
      ) => {
        activeTurnState = nextTurnState;
      };

      // Validate the transcript tail before running. runAgentLoopContinue
      // re-checks, but failing here gives a cleaner error and avoids emitting
      // any agent_start events for a doomed run.
      if (activeTurnState.messages.length === 0) {
        throw new AgentHarnessError({
          code: "invalid_state",
          message: "No messages to continue from",
        });
      }
      const lastMessage =
        activeTurnState.messages[activeTurnState.messages.length - 1]!;
      if (lastMessage.role === "assistant") {
        throw new AgentHarnessError({
          code: "invalid_state",
          message: "Cannot continue from an assistant message",
        });
      }

      const abortController = new AbortController();
      this.runAbortController = abortController;
      const context = this.createContext(activeTurnState);

      // Wrap runAgentLoopContinue so loop/stream failures are converted into a
      // failure assistant message — the server retry loop then sees a
      // consistent error shape (mirrors executeTurn's failure handling).
      const runResultPromise = (async () => {
        try {
          return await runAgentLoopContinue(
            context,
            this.createLoopConfig(getTurnState, setTurnState),
            (event) => this.handleAgentEvent(event, abortController.signal),
            abortController.signal,
            this.createStreamFn(getTurnState)
          );
        } catch (error) {
          this.logger?.error("turn failed", error, {
            model: activeTurnState.model.id,
            provider: activeTurnState.model.provider,
            aborted: String(abortController.signal.aborted),
          });
          try {
            return await this.emitRunFailure(
              activeTurnState.model,
              error,
              abortController.signal.aborted,
              abortController.signal
            );
          } catch (failureError) {
            const cause = new AggregateError(
              [toError(error), toError(failureError)],
              "Agent continue failed and failure reporting failed"
            );
            throw new AgentHarnessError({
              code: "unknown",
              message: cause.message,
              cause,
            });
          }
        }
      })();

      try {
        const newMessages = await runResultPromise;
        for (let i = newMessages.length - 1; i >= 0; i--) {
          const message = newMessages[i]!;
          if (message.role === "assistant") {
            return message;
          }
        }
        throw new AgentHarnessError({
          code: "invalid_state",
          message: "Continue completed without an assistant message",
        });
      } finally {
        try {
          await this.flushPendingSessionWrites();
        } finally {
          this.runAbortController = undefined;
        }
      }
    } catch (error) {
      this.phase = "idle";
      throw normalizeHarnessError(error, "unknown");
    } finally {
      finishRunPromise();
    }
  }

  async skill(
    name: string,
    additionalInstructions?: string
  ): Promise<AssistantMessage> {
    return this.runAsTurn("skill", async (turnState) => {
      const skill = (turnState.resources.skills ?? []).find(
        (candidate) => candidate.name === name
      );
      if (!skill) {
        throw new AgentHarnessError({
          code: "invalid_argument",
          message: `Unknown skill: ${name}`,
        });
      }
      return this.executeTurn(
        turnState,
        formatSkillInvocation(skill, additionalInstructions)
      );
    });
  }

  async promptFromTemplate(
    name: string,
    args: string[] = []
  ): Promise<AssistantMessage> {
    return this.runAsTurn("promptFromTemplate", async (turnState) => {
      const template = (turnState.resources.promptTemplates ?? []).find(
        (candidate) => candidate.name === name
      );
      if (!template) {
        throw new AgentHarnessError({
          code: "invalid_argument",
          message: `Unknown prompt template: ${name}`,
        });
      }
      return this.executeTurn(
        turnState,
        formatPromptTemplateInvocation(template, args)
      );
    });
  }

  async steer(
    text: string,
    options?: { images?: ImageContent[] }
  ): Promise<void> {
    if (this.phase === "idle") {
      throw new AgentHarnessError({
        code: "invalid_state",
        message: "Cannot steer while idle",
      });
    }
    this.steerQueue.push(createUserMessage(text, options?.images));
    await this.emitQueueUpdate();
  }

  /**
   * Advertise one or more newly-installed skills on the next turn via a
   * `<skills-added>` block. The block rides the user message (transient tail),
   * not the system prompt — the prompt-cache prefix stays warm.
   *
   * Use this when a skill is installed mid-session. The model reads the skill
   * body on-demand via the `read` tool, so only the {name, description, location}
   * triple needs to reach it.
   *
   * Unlike {@link steer}, this is safe to call while idle — the notice lands on
   * the next turn's user-message tail via the steer queue, which is drained at
   * loop start (before the first LLM call).
   */
  announceSkillAdded(skills: readonly Skill[] | Skill): void {
    const arr = Array.isArray(skills) ? skills : [skills];
    const notice = formatSkillsAddedNotice(arr);
    if (notice === "") {
      return;
    }
    this.steerQueue.push(createUserMessage(notice));
  }

  async followUp(
    text: string,
    options?: { images?: ImageContent[] }
  ): Promise<void> {
    if (this.phase === "idle") {
      throw new AgentHarnessError({
        code: "invalid_state",
        message: "Cannot follow up while idle",
      });
    }
    this.followUpQueue.push(createUserMessage(text, options?.images));
    await this.emitQueueUpdate();
  }

  async nextTurn(
    text: string,
    options?: { images?: ImageContent[] }
  ): Promise<void> {
    this.nextTurnQueue.push(createUserMessage(text, options?.images));
    await this.emitQueueUpdate();
  }

  async appendMessage(message: AgentMessage): Promise<void> {
    const self = this;
    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          if (self.phase === "idle") {
            yield* self.session.appendMessage(message);
          } else {
            self.pendingSessionWrites.push({ type: "message", message });
          }
        })
      );
    } catch (error) {
      throw normalizeHarnessError(error, "session");
    }
  }

  async compact(customInstructions?: string): Promise<{
    summary: string;
    firstKeptEntryId: string;
    tokensBefore: number;
    details?: unknown;
  }> {
    if (this.phase !== "idle") {
      throw new AgentHarnessError({
        code: "busy",
        message: "compact() requires idle harness",
      });
    }
    this.phase = "compaction";
    const self = this;
    try {
      return await Effect.runPromise(
        Effect.gen(function* () {
          const auth = yield* Effect.promise(() =>
            Promise.resolve(
              self.getApiKeyAndHeaders?.(self.model) ??
                Promise.resolve(undefined)
            )
          );
          if (!auth) {
            yield* new AgentHarnessError({
              code: "auth",
              message: "No auth available for compaction",
            });
          }
          const branchEntries = yield* self.session.getBranch();
          const preparationResult = prepareCompaction(
            branchEntries,
            DEFAULT_COMPACTION_SETTINGS
          );
          if (isFailure(preparationResult)) {
            return yield* Effect.fail(preparationResult.failure);
          }
          const preparation = preparationResult.success;
          if (!preparation) {
            yield* new AgentHarnessError({
              code: "compaction",
              message: "Nothing to compact",
            });
          }
          const hookResult = yield* Effect.promise(() =>
            self.emitHook({
              type: "session_before_compact",
              preparation: preparation!,
              branchEntries,
              customInstructions,
              signal:
                self.runAbortController?.signal ?? new AbortController().signal,
            })
          );
          if (hookResult?.cancel) {
            yield* new AgentHarnessError({
              code: "compaction",
              message: "Compaction cancelled",
            });
          }
          const provided = hookResult?.compaction;
          const compactResult = provided
            ? ok(provided)
            : yield* runCompactEffect(
                preparation!,
                self.model,
                auth!.apiKey,
                auth!.headers,
                customInstructions,
                undefined,
                self.thinkingLevel
              );
          if (isFailure(compactResult)) {
            return yield* Effect.fail(compactResult.failure);
          }
          const result = compactResult.success;
          const entryId = yield* self.session.appendCompaction(
            result.summary,
            result.firstKeptEntryId,
            result.tokensBefore,
            result.details,
            provided !== undefined
          );
          const entry = yield* self.session.getEntry(entryId);
          if (entry?.type === "compaction") {
            yield* Effect.promise(() =>
              self.emitOwn({
                type: "session_compact",
                compactionEntry: entry,
                fromHook: provided !== undefined,
              })
            );
          }

          // Drain pending system-prompt refresh: compaction busts the cache
          // anyway, so this is the free moment to swap the prefix bytes.
          // Layer 2 only — on restart, Layer 1 (disabled_skills filter in the
          // runner) recomposes the correct prompt at load.
          if (self.pendingSystemPromptRefresh !== undefined) {
            self.systemPrompt = self.pendingSystemPromptRefresh;
            self.clearPendingSystemPromptRefresh();
          }

          return result;
        })
      );
    } catch (error) {
      throw normalizeHarnessError(error, "compaction");
    } finally {
      this.phase = "idle";
    }
  }

  async navigateTree(
    targetId: string,
    options?: {
      summarize?: boolean;
      customInstructions?: string;
      replaceInstructions?: boolean;
      label?: string;
    }
  ): Promise<NavigateTreeResult> {
    if (this.phase !== "idle") {
      throw new AgentHarnessError({
        code: "busy",
        message: "navigateTree() requires idle harness",
      });
    }
    this.phase = "branch_summary";
    const self = this;
    try {
      return await Effect.runPromise(
        Effect.gen(function* () {
          const oldLeafId = yield* self.session.getLeafId();
          if (oldLeafId === targetId) {
            return { cancelled: false };
          }
          const targetEntry = yield* self.session.getEntry(targetId);
          if (!targetEntry) {
            yield* new AgentHarnessError({
              code: "invalid_argument",
              message: `Entry ${targetId} not found`,
            });
          }
          const { entries, commonAncestorId } =
            yield* collectEntriesForBranchSummaryEffect(
              self.session,
              oldLeafId,
              targetId
            );
          const preparation = {
            targetId,
            oldLeafId,
            commonAncestorId,
            entriesToSummarize: entries,
            userWantsSummary: options?.summarize ?? false,
            customInstructions: options?.customInstructions,
            replaceInstructions: options?.replaceInstructions,
            label: options?.label,
          };
          const signal =
            self.runAbortController?.signal ?? new AbortController().signal;
          const hookResult = yield* Effect.promise(() =>
            self.emitHook({
              type: "session_before_tree",
              preparation,
              signal,
            })
          );
          if (hookResult?.cancel) {
            return { cancelled: true };
          }
          let summaryEntry: NavigateTreeResult["summaryEntry"];
          let summaryText: string | undefined = hookResult?.summary?.summary;
          let summaryDetails: unknown = hookResult?.summary?.details;
          if (!summaryText && options?.summarize && entries.length > 0) {
            const auth = yield* Effect.promise(() =>
              Promise.resolve(
                self.getApiKeyAndHeaders?.(self.model) ??
                  Promise.resolve(undefined)
              )
            );
            if (!auth) {
              yield* new AgentHarnessError({
                code: "auth",
                message: "No auth available for branch summary",
              });
            }
            const branchSummary = yield* generateBranchSummaryEffect(entries, {
              model: self.model,
              apiKey: auth!.apiKey,
              ...(auth!.headers === undefined
                ? {}
                : { headers: auth!.headers }),
              signal:
                self.runAbortController?.signal ?? new AbortController().signal,
              ...(hookResult?.customInstructions !== undefined ||
              options?.customInstructions !== undefined
                ? {
                    customInstructions:
                      hookResult?.customInstructions ??
                      options?.customInstructions,
                  }
                : {}),
              ...((hookResult?.replaceInstructions ??
                options?.replaceInstructions) === undefined
                ? {}
                : {
                    replaceInstructions:
                      hookResult?.replaceInstructions ??
                      options?.replaceInstructions,
                  }),
            });
            if (isFailure(branchSummary)) {
              if (branchSummary.failure.code === "aborted") {
                return { cancelled: true };
              }
              return yield* new AgentHarnessError({
                code: "branch_summary",
                message: branchSummary.failure.message,
                ...(branchSummary.failure === undefined
                  ? {}
                  : { cause: branchSummary.failure as Error }),
              });
            }
            summaryText = branchSummary.success.summary;
            summaryDetails = {
              readFiles: branchSummary.success.readFiles,
              modifiedFiles: branchSummary.success.modifiedFiles,
            };
          }
          let editorText: string | undefined;
          let newLeafId: string | null;
          if (
            targetEntry!.type === "message" &&
            targetEntry!.message.role === "user"
          ) {
            newLeafId = targetEntry!.parentId;
            const content = targetEntry!.message.content;
            editorText =
              typeof content === "string"
                ? content
                : content
                    .filter(
                      (
                        c
                      ): c is {
                        readonly type: "text";
                        readonly text: string;
                      } => c.type === "text"
                    )
                    .map((c) => c.text)
                    .join("");
          } else if (targetEntry!.type === "custom_message") {
            newLeafId = targetEntry!.parentId;
            editorText =
              typeof targetEntry!.content === "string"
                ? targetEntry!.content
                : targetEntry!.content
                    .filter(
                      (
                        c
                      ): c is {
                        readonly type: "text";
                        readonly text: string;
                      } => c.type === "text"
                    )
                    .map((c) => c.text)
                    .join("");
          } else {
            newLeafId = targetId;
          }
          const summaryId = yield* self.session.moveTo(
            newLeafId,
            summaryText
              ? {
                  summary: summaryText,
                  details: summaryDetails,
                  fromHook: hookResult?.summary !== undefined,
                }
              : undefined
          );
          if (summaryId) {
            const entry = yield* self.session.getEntry(summaryId);
            if (entry?.type === "branch_summary") {
              summaryEntry = entry;
            }
          }
          const finalLeafId = yield* self.session.getLeafId();
          yield* Effect.promise(() =>
            self.emitOwn({
              type: "session_tree",
              newLeafId: finalLeafId,
              oldLeafId,
              summaryEntry,
              fromHook: hookResult?.summary !== undefined,
            })
          );
          return { cancelled: false, editorText, summaryEntry };
        })
      );
    } catch (error) {
      throw normalizeHarnessError(error, "branch_summary");
    } finally {
      this.phase = "idle";
    }
  }

  getModel(): Model {
    return this.model;
  }

  async setModel(model: Model): Promise<void> {
    const self = this;
    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const previousModel = self.model;
          if (self.phase === "idle") {
            yield* self.session.appendModelChange(model.provider, model.id);
          } else {
            self.pendingSessionWrites.push({
              type: "model_change",
              provider: model.provider,
              modelId: model.id,
            });
          }
          self.model = model;
          yield* Effect.promise(() =>
            self.emitOwn({
              type: "model_update",
              model,
              previousModel,
              source: "set",
            })
          );
        })
      );
    } catch (error) {
      throw normalizeHarnessError(error, "session");
    }
  }

  getThinkingLevel(): ThinkingLevel {
    return this.thinkingLevel;
  }

  async setThinkingLevel(level: ThinkingLevel): Promise<void> {
    const self = this;
    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const previousLevel = self.thinkingLevel;
          if (self.phase === "idle") {
            yield* self.session.appendThinkingLevelChange(level);
          } else {
            self.pendingSessionWrites.push({
              type: "thinking_level_change",
              thinkingLevel: level,
            });
          }
          self.thinkingLevel = level;
          yield* Effect.promise(() =>
            self.emitOwn({
              type: "thinking_level_update",
              level,
              previousLevel,
            })
          );
        })
      );
    } catch (error) {
      throw normalizeHarnessError(error, "session");
    }
  }

  getTools(): TTool[] {
    return [...this.tools.values()];
  }

  async setTools(tools: TTool[], activeToolNames?: string[]): Promise<void> {
    const self = this;
    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          self.validateUniqueNames(
            tools.map((tool) => tool.name),
            "Duplicate tool name(s)"
          );
          const nextTools = new Map(tools.map((tool) => [tool.name, tool]));
          const nextActiveToolNames = activeToolNames
            ? [...activeToolNames]
            : self.activeToolNames;
          self.validateToolNames(nextActiveToolNames, nextTools);
          const previousToolNames = [...self.tools.keys()];
          const previousActiveToolNames = [...self.activeToolNames];
          if (self.phase === "idle") {
            yield* self.session.appendActiveToolsChange(nextActiveToolNames);
          } else {
            self.pendingSessionWrites.push({
              type: "active_tools_change",
              activeToolNames: [...nextActiveToolNames],
            });
          }
          self.tools = nextTools;
          self.activeToolNames = [...nextActiveToolNames];
          yield* Effect.promise(() =>
            self.emitOwn({
              type: "tools_update",
              toolNames: [...self.tools.keys()],
              previousToolNames,
              activeToolNames: [...self.activeToolNames],
              previousActiveToolNames,
              source: "set",
            })
          );
        })
      );
    } catch (error) {
      throw normalizeHarnessError(error, "invalid_argument");
    }
  }

  getActiveTools(): TTool[] {
    return this.activeToolNames
      .map((name) => this.tools.get(name))
      .filter((tool): tool is TTool => tool !== undefined);
  }

  async setActiveTools(toolNames: string[]): Promise<void> {
    const self = this;
    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          self.validateToolNames(toolNames);
          const previousToolNames = [...self.tools.keys()];
          const previousActiveToolNames = [...self.activeToolNames];
          if (self.phase === "idle") {
            yield* self.session.appendActiveToolsChange(toolNames);
          } else {
            self.pendingSessionWrites.push({
              type: "active_tools_change",
              activeToolNames: [...toolNames],
            });
          }
          self.activeToolNames = [...toolNames];
          yield* Effect.promise(() =>
            self.emitOwn({
              type: "tools_update",
              toolNames: [...self.tools.keys()],
              previousToolNames,
              activeToolNames: [...self.activeToolNames],
              previousActiveToolNames,
              source: "set",
            })
          );
        })
      );
    } catch (error) {
      throw normalizeHarnessError(error, "invalid_argument");
    }
  }

  getSteeringMode(): QueueMode {
    return this.steeringQueueMode;
  }

  async setSteeringMode(mode: QueueMode): Promise<void> {
    this.steeringQueueMode = mode;
  }

  getFollowUpMode(): QueueMode {
    return this.followUpQueueMode;
  }

  async setFollowUpMode(mode: QueueMode): Promise<void> {
    this.followUpQueueMode = mode;
  }

  getResources(): AgentHarnessResources<TSkill, TPromptTemplate> {
    return {
      skills: this.resources.skills?.slice(),
      promptTemplates: this.resources.promptTemplates?.slice(),
    };
  }

  async setResources(
    resources: AgentHarnessResources<TSkill, TPromptTemplate>
  ): Promise<void> {
    const previousResources = this.getResources();
    this.resources = {
      skills: resources.skills?.slice(),
      promptTemplates: resources.promptTemplates?.slice(),
    };
    await this.emitOwn({
      type: "resources_update",
      resources: this.getResources(),
      previousResources,
    });
  }

  /** Current switchable agent, set by {@link switchAgent}. */
  getCurrentAgent(): AgentDefinition | undefined {
    return this.currentAgent;
  }

  /**
   * Set the permission evaluator forwarded to the agent loop. The loop calls it
   * with each `(permission, pattern)` pair a tool declares before executing it;
   * any non-`"allow"` result blocks the call. Updating it mid-run takes effect
   * on the next tool call within the current turn.
   */
  setPermissionEvaluator(
    evaluator:
      | ((permission: string, pattern: string) => "allow" | "deny" | "ask")
      | undefined
  ): void {
    this.permissionEvaluator = evaluator;
  }

  /**
   * Set the async `"ask"` resolver forwarded to the loop. Invoked when
   * {@link setPermissionEvaluator} returns `"ask"`; the loop pauses until the
   * returned promise settles. Wire this to an interactive approval channel.
   */
  setPermissionAskResolver(
    resolver:
      | ((req: PermissionAskRequest) => Promise<"allow" | "deny">)
      | undefined
  ): void {
    this.permissionAskResolver = resolver;
  }

  /**
   * Atomically switch the active agent: records it (so a system-prompt callback
   * or {@link getCurrentAgent} can read it), overrides the system prompt, and
   * applies the agent's active-tool allowlist and thinking level. Model
   * overrides are resolved by the application (an `AgentDefinition.model` is a
   * coarse `{providerId, modelId}` pointer) and applied via {@link setModel}.
   * Permission rulesets are wired separately via {@link setPermissionEvaluator}.
   * Tool/model/prompt changes take effect on the next turn (prepareNextTurn
   * re-reads them); the permission evaluator takes effect immediately.
   *
   * Clears any pending {@link scheduleSystemPromptRefresh} — switchAgent is the
   * "apply now" path and supersedes a deferred swap.
   */
  async switchAgent(agent: AgentDefinition): Promise<void> {
    this.currentAgent = agent;
    this.systemPrompt = agent.systemPrompt;
    this.clearPendingSystemPromptRefresh();
    if (agent.thinkingLevel !== undefined) {
      await this.setThinkingLevel(agent.thinkingLevel);
    }
    if (agent.activeToolNames !== undefined) {
      await this.setActiveTools(agent.activeToolNames);
    }
  }

  /**
   * Schedule a system-prompt swap to take effect at the next compaction.
   *
   * The current session's cached prefix stays warm until compaction runs
   * (compaction busts the cache anyway, so the swap is free there). Use this
   * for any change that would otherwise rewrite the prompt mid-session:
   * disabling a skill, changing locale, changing output style. For changes the
   * user wants immediately, call {@link switchAgent} directly — that applies
   * now at the cost of one cold turn.
   *
   * Emits a `cache_bust_pending` event so the UI can show an alert recommending
   * compaction.
   */
  scheduleSystemPromptRefresh(next: string): void {
    this.pendingSystemPromptRefresh = next;
    void this.emitOwn({
      type: "cache_bust_pending",
      reason: "system_prompt_refresh",
      message:
        "System prompt change pending. Compact the session to apply it without busting the cache.",
    });
  }

  /** Returns the pending refresh string, if any. Test/debug hook. */
  getPendingSystemPromptRefresh(): string | undefined {
    return this.pendingSystemPromptRefresh;
  }

  /**
   * Clears the pending refresh. Internal; called when compaction drains it
   * or when {@link switchAgent} supersedes it.
   */
  clearPendingSystemPromptRefresh(): void {
    this.pendingSystemPromptRefresh = undefined;
  }

  /**
   * Returns the currently-effective system prompt when it is a plain string,
   * or `undefined` when it is unset or a callback. Useful for tests and for
   * the runner to recompose the base prompt (without the skills block) when
   * scheduling a refresh.
   */
  getSystemPrompt(): string | undefined {
    return typeof this.systemPrompt === "string"
      ? this.systemPrompt
      : undefined;
  }

  getStreamOptions(): AgentHarnessStreamOptions {
    return cloneStreamOptions(this.streamOptions);
  }

  async setStreamOptions(
    streamOptions: AgentHarnessStreamOptions
  ): Promise<void> {
    this.streamOptions = cloneStreamOptions(streamOptions);
  }

  async abort(): Promise<AbortResult> {
    const clearedSteer = [...this.steerQueue];
    const clearedFollowUp = [...this.followUpQueue];
    this.steerQueue = [];
    this.followUpQueue = [];
    this.runAbortController?.abort();
    this.logger?.warn("turn aborted");
    const errors: Error[] = [];
    try {
      await this.emitQueueUpdate();
    } catch (error) {
      errors.push(toError(error));
    }
    try {
      await this.waitForIdle();
    } catch (error) {
      errors.push(toError(error));
    }
    try {
      await this.emitOwn({ type: "abort", clearedSteer, clearedFollowUp });
    } catch (error) {
      errors.push(toError(error));
    }
    if (errors.length > 0) {
      const cause =
        errors.length === 1
          ? errors[0]!
          : new AggregateError(errors, "Abort completed with errors");
      throw normalizeHarnessError(cause, "hook");
    }
    return { clearedSteer, clearedFollowUp };
  }

  async waitForIdle(): Promise<void> {
    await this.runPromise;
  }

  subscribe(
    listener: (
      event: AgentHarnessEvent<TSkill, TPromptTemplate>,
      signal?: AbortSignal
    ) => Promise<void> | void
  ): () => void {
    let handlers = this.handlers.get(SUBSCRIBER_EVENT_TYPE);
    if (!handlers) {
      handlers = new Set();
      this.handlers.set(SUBSCRIBER_EVENT_TYPE, handlers);
    }
    handlers.add(listener as AgentHarnessHandler);
    return () => handlers!.delete(listener as AgentHarnessHandler);
  }

  on<TType extends keyof AgentHarnessEventResultMap>(
    type: TType,
    handler: (
      event: Extract<AgentHarnessOwnEvent, { type: TType }>
    ) =>
      | Promise<AgentHarnessEventResultMap[TType]>
      | AgentHarnessEventResultMap[TType]
  ): () => void {
    let handlers = this.handlers.get(type);
    if (!handlers) {
      handlers = new Set();
      this.handlers.set(type, handlers);
    }
    handlers.add(handler as AgentHarnessHandler);
    return () => handlers!.delete(handler as AgentHarnessHandler);
  }
}
