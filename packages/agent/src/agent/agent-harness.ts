import type { AssistantMessage, ImageContent, Model, UserMessage } from "@sakti-code/llm";
import type { Logger } from "@sakti-code/logger";
import { Cause, Effect, Exit, PubSub, Stream } from "effect";
import { buildHarnessStreamRequest } from "../agent/build-stream-request";
import {
  collectEntriesForBranchSummaryEffect,
  generateBranchSummaryEffect,
} from "../compaction/branch-summarization";
import {
  DEFAULT_COMPACTION_SETTINGS,
  prepareCompaction,
  compactEffect as runCompactEffect,
} from "../compaction/compaction";
import type {
  BranchSummaryPrompts,
  CompactionPrompts,
  SkillsInstructions,
} from "../compaction/prompt-bundles";
import { runAgentLoopContinueEffect, runAgentLoopEffect } from "../core/agent-loop";
import {
  type AbortResult,
  type AgentDefinition,
  AgentHarnessError,
  type AgentHarnessErrorCode,
  type AgentHarnessEvent,
  type AgentHarnessEventResultMap,
  type AgentHarnessOptions,
  type AgentHarnessOwnEvent,
  type AgentHarnessPhase,
  type AgentHarnessResources,
  type AgentHarnessStreamOptions,
  type AgentHarnessStreamOptionsPatch,
  type ExecutionEnv,
  isFailure,
  type NavigateTreeResult,
  ok,
  type PendingSessionWrite,
  type PromptTemplate,
  type SessionError,
  type Skill,
  toError,
} from "../harness-types";
import { formatPromptTemplateInvocation } from "../resources/prompt-templates";
import { formatSkillInvocation } from "../resources/skills";
import { formatSkillsAddedNotice } from "../resources/skills-added-notice";
import {
  composeSystemPrompt,
  stripSkillsBlock,
  stripToolInventory,
} from "../resources/system-prompt";
import { renderToolSection } from "../resources/tool-inventory";
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
  const content: Array<{ type: "text"; text: string } | ImageContent> = [{ type: "text", text }];
  if (images) {
    content.push(...images);
  }
  return { role: "user", content, timestamp: Date.now() };
}

function createFailureMessage(model: Model, error: unknown, aborted: boolean): AssistantMessage {
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

function cloneStreamOptions(streamOptions?: AgentHarnessStreamOptions): AgentHarnessStreamOptions {
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
  patch?: AgentHarnessStreamOptionsPatch,
): AgentHarnessStreamOptions {
  const result = cloneStreamOptions(base);
  if (!patch) {
    return result;
  }

  if (Object.hasOwn(patch, "headers")) {
    if (patch.headers === undefined) {
      result.headers = undefined;
    } else {
      const headers = { ...result.headers };
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

/**
 * Last-resort system prompt fallback used when no agent system prompt is
 * configured on the harness at stream-build time. The agent package ships
 * this minimal placeholder so the harness has a valid prompt even before
 * switchAgent is called; consumers (apps/server) always supply their own
 * via {@link AgentHarnessOptions.systemPrompt} or switchAgent.
 *
 * To be removed in Change B when the harness requires an explicit prompt
 * (no shipped content).
 */
const HARNESS_DEFAULT_SYSTEM_PROMPT = "You are a helpful assistant.";

type AgentHarnessHandler = (
  event: AgentHarnessEvent,
  signal?: AbortSignal,
) => Promise<unknown> | unknown;

function normalizeHarnessError(
  error: unknown,
  fallbackCode: AgentHarnessErrorCode,
): AgentHarnessError {
  if (error instanceof AgentHarnessError) {
    return error;
  }
  const cause = toError(error);
  if (cause instanceof Error && "_tag" in cause && typeof cause._tag === "string") {
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
  /**
   * Harness-lifetime event bus. Every event published via {@link handleAgentEvent}
   * is also published here so {@link subscribeStream} consumers see live
   * updates without going through the legacy per-listener `await` path.
   * Decouples emit from persist (per the design doc, Phase D).
   */
  private readonly eventBus: PubSub.PubSub<AgentHarnessEvent<TSkill, TPromptTemplate>> =
    Effect.runSync(PubSub.unbounded());
  private model: Model;
  private compactionPrompts: CompactionPrompts;
  private branchSummaryPrompts: BranchSummaryPrompts;
  private skillsInstructions: SkillsInstructions;
  private maxSteps?: number;
  private thinkingLevel: ThinkingLevel;
  private systemPrompt: AgentHarnessOptions<TSkill, TPromptTemplate, TTool>["systemPrompt"];
  /**
   * Pending system-prompt swap scheduled by {@link scheduleSystemPromptRefresh}.
   * Drained by {@link compact} (compaction busts the cache anyway, so the swap
   * is free there) and cleared by {@link switchAgent} (which supersedes it).
   * Layer 2 (in-memory only); restart-safe because Layer 1 (disabled_skills
   * filter in the runner) recomposes the correct prompt at load.
   */
  private pendingSystemPromptRefresh: string | undefined;
  /**
   * Tools whose schema stays in the request (cache-stable) but whose execution
   * is blocked at the beforeToolCall gate. Maps tool name to the reason returned
   * to the model as a tool-error result.
   */
  private softDisabledTools = new Map<string, string>();
  /**
   * File paths (typically skill SKILL.md paths) the `read` tool should refuse.
   * Populated by {@link removeSkill} so the model can't re-load a disabled
   * skill's body from disk after the advertisement was removed from the prompt.
   */
  private softDisabledPaths = new Set<string>();
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
  private cacheHitTokens = 0;
  private cacheMissTokens = 0;
  private cacheShapeTurnCount = 0;

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
      "Duplicate tool name(s)",
    );
    for (const tool of options.tools ?? []) {
      this.tools.set(tool.name, tool);
    }
    this.model = options.model;
    this.compactionPrompts = options.compactionPrompts;
    this.branchSummaryPrompts = options.branchSummaryPrompts;
    this.skillsInstructions = options.skillsInstructions;
    if (options.maxSteps !== undefined) {
      this.maxSteps = options.maxSteps;
    }
    this.thinkingLevel = options.thinkingLevel ?? "off";
    this.activeToolNames = options.activeToolNames
      ? [...options.activeToolNames]
      : (options.tools ?? []).map((tool) => tool.name);
    this.validateUniqueNames(this.activeToolNames, "Duplicate active tool name(s)");
    this.validateToolNames(this.activeToolNames);
    this.steeringQueueMode = options.steeringMode ?? "one-at-a-time";
    this.followUpQueueMode = options.followUpMode ?? "one-at-a-time";
  }

  private getHandlers(type: string): Set<AgentHarnessHandler> | undefined {
    return this.handlers.get(type);
  }

  private emitOwn(
    event: AgentHarnessOwnEvent<TSkill, TPromptTemplate>,
    signal?: AbortSignal,
  ): Promise<void> {
    return Effect.runPromise(this.emitOwnEffect(event, signal));
  }

  private emitHook<TType extends keyof AgentHarnessEventResultMap>(
    event: Extract<AgentHarnessOwnEvent, { type: TType }>,
  ): Promise<AgentHarnessEventResultMap[TType] | undefined> {
    return Effect.runPromise(this.emitHookEffect(event));
  }

  private emitBeforeProviderRequest(
    model: Model,
    sessionId: string,
    streamOptions: AgentHarnessStreamOptions,
  ): Promise<AgentHarnessStreamOptions> {
    return Effect.runPromise(this.emitBeforeProviderRequestEffect(model, sessionId, streamOptions));
  }

  private emitQueueUpdate(): Promise<void> {
    return Effect.runPromise(this.emitQueueUpdateEffect());
  }

  // ── Effect-typed emit helpers ───────────────────────────────────────
  // Phase H2: these are the Effect cores. The Promise variants above are
  // one-line wrappers so existing Promise callers (steer/followUp/nextTurn/
  // swapTool/scheduleSystemPromptRefresh/etc.) stay unchanged. The run/emit
  // path (executeTurn/handleAgentEvent) uses these directly.

  private emitOwnEffect(
    event: AgentHarnessOwnEvent<TSkill, TPromptTemplate>,
    signal?: AbortSignal,
  ): Effect.Effect<void, AgentHarnessError> {
    const handlers = this.getHandlers(SUBSCRIBER_EVENT_TYPE);
    if (!handlers || handlers.size === 0) {
      return Effect.void;
    }
    return Effect.gen(function* () {
      for (const listener of handlers) {
        yield* Effect.tryPromise({
          try: () => Promise.resolve(listener(event, signal)),
          catch: (error: unknown) => normalizeHookError(error),
        });
      }
    });
  }

  private emitAnyEffect(
    event: AgentHarnessEvent<TSkill, TPromptTemplate>,
    signal?: AbortSignal,
  ): Effect.Effect<void, AgentHarnessError> {
    const handlers = this.getHandlers(SUBSCRIBER_EVENT_TYPE);
    if (!handlers || handlers.size === 0) {
      return Effect.void;
    }
    return Effect.gen(function* () {
      for (const listener of handlers) {
        yield* Effect.tryPromise({
          try: () => Promise.resolve(listener(event, signal)),
          catch: (error: unknown) => normalizeHookError(error),
        });
      }
    });
  }

  private emitHookEffect<TType extends keyof AgentHarnessEventResultMap>(
    event: Extract<AgentHarnessOwnEvent, { type: TType }>,
  ): Effect.Effect<AgentHarnessEventResultMap[TType] | undefined, AgentHarnessError> {
    const handlers = this.getHandlers(event.type as TType);
    if (!handlers || handlers.size === 0) {
      return Effect.succeed(undefined);
    }
    return Effect.gen(function* () {
      let lastResult: AgentHarnessEventResultMap[TType] | undefined;
      for (const handler of handlers) {
        const result = yield* Effect.tryPromise({
          try: () =>
            Promise.resolve(handler(event) as AgentHarnessEventResultMap[TType] | undefined),
          catch: (error: unknown) => normalizeHookError(error),
        });
        if (result !== undefined) {
          lastResult = result;
        }
      }
      return lastResult;
    });
  }

  private emitBeforeProviderRequestEffect(
    model: Model,
    sessionId: string,
    streamOptions: AgentHarnessStreamOptions,
  ): Effect.Effect<AgentHarnessStreamOptions, AgentHarnessError> {
    const handlers = this.getHandlers("before_provider_request");
    let current = cloneStreamOptions(streamOptions);
    if (!handlers || handlers.size === 0) {
      return Effect.succeed(current);
    }
    return Effect.gen(function* () {
      for (const handler of handlers) {
        const result = yield* Effect.tryPromise({
          try: () =>
            Promise.resolve(
              handler({
                type: "before_provider_request",
                model,
                sessionId,
                streamOptions: current,
              }) as
                | {
                    streamOptions?: AgentHarnessStreamOptionsPatch;
                  }
                | undefined,
            ),
          catch: (error: unknown) => normalizeHookError(error),
        });
        if (result?.streamOptions) {
          current = applyStreamOptionsPatch(current, result.streamOptions);
        }
      }
      return current;
    });
  }

  private emitQueueUpdateEffect(): Effect.Effect<void, AgentHarnessError> {
    return this.emitOwnEffect({
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

  private runAsTurnEffect<T>(
    mode: string,
    fn: (
      turnState: AgentHarnessTurnState<TSkill, TPromptTemplate, TTool>,
    ) => Effect.Effect<T, AgentHarnessError | SessionError>,
  ): Effect.Effect<T, AgentHarnessError | SessionError> {
    const self = this;
    let finishRunPromise: () => void = () => {};
    return Effect.gen(function* () {
      if (self.phase !== "idle") {
        return yield* Effect.fail(
          new AgentHarnessError({
            code: "busy",
            message: "AgentHarness is busy",
          }),
        );
      }
      self.phase = "turn";
      self.logger?.info("turn started", {
        mode,
        model: self.model.id,
        provider: self.model.provider,
      });
      finishRunPromise = self.startRunPromise();
      const turnState = yield* self.createTurnStateEffect();
      return yield* fn(turnState);
    }).pipe(
      Effect.ensuring(Effect.sync(() => finishRunPromise())),
      Effect.mapError((error) => {
        // On any failure mid-turn, reset phase to idle (mirrors the original
        // catch block) and normalize.
        if (self.phase === "turn") {
          self.phase = "idle";
        }
        return normalizeHarnessError(error, "unknown");
      }),
    );
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
      let systemPrompt = HARNESS_DEFAULT_SYSTEM_PROMPT;
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
            }),
          ),
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

  private async createTurnState(): Promise<AgentHarnessTurnState<TSkill, TPromptTemplate, TTool>> {
    return Effect.runPromise(this.createTurnStateEffect());
  }

  private createContext(
    turnState: AgentHarnessTurnState<TSkill, TPromptTemplate, TTool>,
    systemPrompt?: string,
  ): AgentContext {
    return {
      systemPrompt: systemPrompt ?? turnState.systemPrompt,
      messages: turnState.messages.slice(),
      tools: turnState.activeTools.slice(),
    };
  }

  private createStreamFn(
    getTurnState: () => AgentHarnessTurnState<TSkill, TPromptTemplate, TTool>,
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
        req.headers,
      );

      // Emit before_provider_request hook (allows header patching)
      const requestOptions = await this.emitBeforeProviderRequest(req.model, turnState.sessionId, {
        ...turnState.streamOptions,
        headers: mergedHeaders,
      });

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
          ...(requestOptions.headers ? { headers: requestOptions.headers } : {}),
          ...(auth?.apiKey ? { apiKey: auth.apiKey } : {}),
          ...(streamLogger === undefined ? {} : { logger: streamLogger }),
        }),
      );
    };
  }

  private async drainQueuedMessages(
    queue: AgentMessage[],
    mode: QueueMode,
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
    setTurnState: (turnState: AgentHarnessTurnState<TSkill, TPromptTemplate, TTool>) => void,
  ): AgentLoopConfig {
    const turnState = getTurnState();
    return {
      model: turnState.model,
      sessionId: turnState.sessionId,
      ...(this.maxSteps === undefined ? {} : { maxSteps: this.maxSteps }),
      ...(turnState.thinkingLevel === "off" ? {} : { reasoning: turnState.thinkingLevel }),
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
            resolvePermissionAsk: (req: PermissionAskRequest): Promise<"allow" | "deny"> =>
              this.permissionAskResolver!(req),
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
        // Soft-disable gate (by tool name): the schema stays in the request
        // (cache-stable) but execution is blocked with a clear reason.
        const softBlock = this.softDisabledTools.get(toolCall.name);
        if (softBlock !== undefined) {
          return { block: true, reason: softBlock };
        }
        // Soft-disable gate (by path on the read tool): prevents the model
        // from reloading a removed skill's SKILL.md body from disk.
        if (
          toolCall.name === "read" &&
          typeof args === "object" &&
          args !== null &&
          "path" in args
        ) {
          const path = (args as { path?: unknown }).path;
          if (typeof path === "string" && this.softDisabledPaths.has(path)) {
            return {
              block: true,
              reason: `path ${path} is soft-disabled (likely a removed skill's SKILL.md)`,
            };
          }
        }
        const result = await this.emitHook({
          type: "tool_call",
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          input: args as Record<string, unknown>,
        });
        return result ? { block: result.block, reason: result.reason } : undefined;
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

  private validateToolNames(toolNames: string[], tools: Map<string, TTool> = this.tools): void {
    this.validateUniqueNames(toolNames, "Duplicate active tool name(s)");
    const missing = toolNames.filter((name) => !tools.has(name));
    if (missing.length > 0) {
      throw new AgentHarnessError({
        code: "invalid_argument",
        message: `Unknown tool(s): ${missing.join(", ")}`,
      });
    }
  }

  private flushPendingSessionWritesEffect = (): Effect.Effect<void, SessionError> => {
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
            write.details,
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

  private handleAgentEventEffect(
    event: AgentEvent,
    signal?: AbortSignal,
  ): Effect.Effect<void, AgentHarnessError | SessionError> {
    // Phase D: broadcast to PubSub subscribers (subscribeStream). Non-blocking
    // for unbounded PubSub; if the bus is shut down (e.g. after dispose), ignore.
    try {
      PubSub.publishUnsafe(this.eventBus, event);
    } catch {
      // bus closed — drop.
    }

    if (event.type === "cache_shape") {
      this.cacheHitTokens += event.diagnostics.cacheHitTokens;
      this.cacheMissTokens += event.diagnostics.cacheMissTokens;
      this.cacheShapeTurnCount++;
      return this.emitAnyEffect(event, signal);
    }

    if (event.type !== "message_end" && event.type !== "turn_end" && event.type !== "agent_end") {
      return this.emitAnyEffect(event, signal);
    }

    const self = this;
    return Effect.gen(function* () {
      if (event.type === "message_end") {
        yield* self.session.appendMessage(event.message);
        yield* self.emitAnyEffect(event, signal);
        return;
      }
      if (event.type === "turn_end") {
        // Preserve the deferred-error semantics of the original: emit, but
        // capture any listener error so the pending-writes flush + save_point
        // still run before we re-throw.
        const eventError = yield* Effect.exit(self.emitAnyEffect(event, signal));
        const hadPendingMutations = self.pendingSessionWrites.length > 0;
        yield* self.flushPendingSessionWritesEffect();
        if (Exit.isFailure(eventError)) {
          yield* Effect.fail(normalizeHookError(Cause.squash(eventError.cause)));
        }
        yield* self.emitOwnEffect({ type: "save_point", hadPendingMutations });
        return;
      }
      // event.type === "agent_end"
      yield* self.flushPendingSessionWritesEffect();
      self.phase = "idle";
      yield* self.emitAnyEffect(event, signal);
      yield* self.emitOwnEffect(
        { type: "settled", nextTurnCount: self.nextTurnQueue.length },
        signal,
      );
    });
  }

  private emitRunFailureEffect(
    model: Model,
    error: unknown,
    aborted: boolean,
    signal: AbortSignal,
  ): Effect.Effect<AgentMessage[], AgentHarnessError | SessionError> {
    const self = this;
    return Effect.gen(function* () {
      const failureMessage = createFailureMessage(model, error, aborted);
      yield* self.handleAgentEventEffect(
        { type: "message_start", message: failureMessage },
        signal,
      );
      yield* self.handleAgentEventEffect({ type: "message_end", message: failureMessage }, signal);
      yield* self.handleAgentEventEffect(
        { type: "turn_end", message: failureMessage, toolResults: [] },
        signal,
      );
      yield* self.handleAgentEventEffect({ type: "agent_end", messages: [failureMessage] }, signal);
      return [failureMessage];
    });
  }

  private executeTurnEffect(
    turnState: AgentHarnessTurnState<TSkill, TPromptTemplate, TTool>,
    text: string,
    options?: { images?: ImageContent[] },
  ): Effect.Effect<AssistantMessage, AgentHarnessError | SessionError> {
    const self = this;
    let activeTurnState = turnState;
    let messages: AgentMessage[] = [createUserMessage(text, options?.images)];

    return Effect.gen(function* () {
      if (self.nextTurnQueue.length > 0) {
        const queuedMessages = self.nextTurnQueue.splice(0);
        try {
          yield* self.emitQueueUpdateEffect();
        } catch (error) {
          self.nextTurnQueue.unshift(...queuedMessages);
          return yield* Effect.fail(normalizeHookError(error));
        }
        messages = [...queuedMessages, messages[0]!];
      }
      const beforeResult = yield* self.emitHookEffect({
        type: "before_agent_start",
        prompt: text,
        ...(options?.images === undefined ? {} : { images: options.images }),
        systemPrompt: turnState.systemPrompt,
        resources: turnState.resources,
      });
      if (beforeResult?.messages) {
        messages = [...messages, ...beforeResult.messages];
      }

      const abortController = new AbortController();
      const getTurnState = () => activeTurnState;
      const setTurnState = (
        nextTurnState: AgentHarnessTurnState<TSkill, TPromptTemplate, TTool>,
      ) => {
        activeTurnState = nextTurnState;
      };
      self.runAbortController = abortController;

      const newMessages = yield* (function* () {
        const exit = yield* Effect.exit(
          runAgentLoopEffect(
            messages,
            self.createContext(turnState, beforeResult?.systemPrompt),
            self.createLoopConfig(getTurnState, setTurnState),
            (event) =>
              Effect.runPromise(self.handleAgentEventEffect(event, abortController.signal)),
            abortController.signal,
            self.createStreamFn(getTurnState),
          ),
        );
        if (Exit.isSuccess(exit)) {
          return exit.value;
        }
        const error = Cause.squash(exit.cause);
        self.logger?.error("turn failed", error, {
          model: activeTurnState.model.id,
          provider: activeTurnState.model.provider,
          aborted: String(abortController.signal.aborted),
        });
        // Mirror the original double-fail path: if emitRunFailure itself
        // throws, wrap both errors in a single AgentHarnessError.
        const failureExit = yield* Effect.exit(
          self.emitRunFailureEffect(
            activeTurnState.model,
            error,
            abortController.signal.aborted,
            abortController.signal,
          ),
        );
        if (Exit.isSuccess(failureExit)) {
          return failureExit.value;
        }
        const failureError = Cause.squash(failureExit.cause);
        const aggregated = new AggregateError(
          [toError(error), toError(failureError)],
          "Agent run failed and failure reporting failed",
        );
        return yield* Effect.fail(
          new AgentHarnessError({
            code: "unknown",
            message: aggregated.message,
            cause: aggregated,
          }),
        );
      })();

      for (let i = newMessages.length - 1; i >= 0; i--) {
        const message = newMessages[i]!;
        if (message.role === "assistant") {
          return message;
        }
      }
      return yield* Effect.fail(
        new AgentHarnessError({
          code: "invalid_state",
          message: "AgentHarness prompt completed without an assistant message",
        }),
      );
    }).pipe(
      Effect.ensuring(
        Effect.gen(function* () {
          yield* self.flushPendingSessionWritesEffect().pipe(Effect.ignore);
          self.runAbortController = undefined;
        }),
      ),
    );
  }

  promptEffect(
    text: string,
    options?: { images?: ImageContent[] },
  ): Effect.Effect<AssistantMessage, AgentHarnessError | SessionError> {
    return this.runAsTurnEffect("prompt", (turnState) =>
      this.executeTurnEffect(turnState, text, options),
    );
  }

  async prompt(text: string, options?: { images?: ImageContent[] }): Promise<AssistantMessage> {
    return Effect.runPromise(this.promptEffect(text, options));
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
  continueEffect(): Effect.Effect<AssistantMessage, AgentHarnessError | SessionError> {
    const self = this;
    // Hoisted so Effect.ensuring (outside the gen) can reference it; assigned
    // inside the gen after the busy check passes (preserves original semantics
    // where startRunPromise wasn't called on the busy-fail path).
    let finishRunPromise: () => void = () => {};
    return Effect.gen(function* () {
      if (self.phase !== "idle") {
        return yield* Effect.fail(
          new AgentHarnessError({
            code: "busy",
            message: "AgentHarness is busy",
          }),
        );
      }
      self.phase = "turn";
      self.logger?.info("turn started", {
        mode: "continue",
        model: self.model.id,
        provider: self.model.provider,
      });
      finishRunPromise = self.startRunPromise();

      // Build the turn state from the CURRENT session (post-rollback in the
      // retry case). `messages` reflects the live leaf, not a fresh prompt.
      const initialTurnState = yield* self.createTurnStateEffect();
      let activeTurnState = initialTurnState;
      const getTurnState = () => activeTurnState;
      const setTurnState = (
        nextTurnState: AgentHarnessTurnState<TSkill, TPromptTemplate, TTool>,
      ) => {
        activeTurnState = nextTurnState;
      };

      // Validate the transcript tail before running. runAgentLoopContinue
      // re-checks, but failing here gives a cleaner error and avoids emitting
      // any agent_start events for a doomed run.
      if (activeTurnState.messages.length === 0) {
        return yield* Effect.fail(
          new AgentHarnessError({
            code: "invalid_state",
            message: "No messages to continue from",
          }),
        );
      }
      const lastMessage = activeTurnState.messages[activeTurnState.messages.length - 1]!;
      if (lastMessage.role === "assistant") {
        return yield* Effect.fail(
          new AgentHarnessError({
            code: "invalid_state",
            message: "Cannot continue from an assistant message",
          }),
        );
      }

      const abortController = new AbortController();
      self.runAbortController = abortController;
      const context = self.createContext(activeTurnState);

      const newMessages = yield* (function* () {
        const exit = yield* Effect.exit(
          runAgentLoopContinueEffect(
            context,
            self.createLoopConfig(getTurnState, setTurnState),
            (event) =>
              Effect.runPromise(self.handleAgentEventEffect(event, abortController.signal)),
            abortController.signal,
            self.createStreamFn(getTurnState),
          ),
        );
        if (Exit.isSuccess(exit)) {
          return exit.value;
        }
        const error = Cause.squash(exit.cause);
        self.logger?.error("turn failed", error, {
          model: activeTurnState.model.id,
          provider: activeTurnState.model.provider,
          aborted: String(abortController.signal.aborted),
        });
        const failureExit = yield* Effect.exit(
          self.emitRunFailureEffect(
            activeTurnState.model,
            error,
            abortController.signal.aborted,
            abortController.signal,
          ),
        );
        if (Exit.isSuccess(failureExit)) {
          return failureExit.value;
        }
        const failureError = Cause.squash(failureExit.cause);
        const aggregated = new AggregateError(
          [toError(error), toError(failureError)],
          "Agent continue failed and failure reporting failed",
        );
        return yield* Effect.fail(
          new AgentHarnessError({
            code: "unknown",
            message: aggregated.message,
            cause: aggregated,
          }),
        );
      })();

      for (let i = newMessages.length - 1; i >= 0; i--) {
        const message = newMessages[i]!;
        if (message.role === "assistant") {
          return message;
        }
      }
      return yield* Effect.fail(
        new AgentHarnessError({
          code: "invalid_state",
          message: "Continue completed without an assistant message",
        }),
      );
    }).pipe(
      Effect.ensuring(
        Effect.gen(function* () {
          yield* self.flushPendingSessionWritesEffect().pipe(Effect.ignore);
          self.runAbortController = undefined;
        }),
      ),
      Effect.ensuring(Effect.sync(() => finishRunPromise())),
      Effect.mapError((error) => {
        // On any failure mid-continue, reset phase to idle (the original
        // catch did this) and normalize.
        if (self.phase === "turn") {
          self.phase = "idle";
        }
        return normalizeHarnessError(error, "unknown");
      }),
    );
  }

  async continue(): Promise<AssistantMessage> {
    return Effect.runPromise(this.continueEffect());
  }

  skillEffect(
    name: string,
    additionalInstructions?: string,
  ): Effect.Effect<AssistantMessage, AgentHarnessError | SessionError> {
    const self = this;
    return self.runAsTurnEffect("skill", (turnState) =>
      Effect.gen(function* () {
        const skill = (turnState.resources.skills ?? []).find(
          (candidate) => candidate.name === name,
        );
        if (!skill) {
          return yield* Effect.fail(
            new AgentHarnessError({
              code: "invalid_argument",
              message: `Unknown skill: ${name}`,
            }),
          );
        }
        return yield* self.executeTurnEffect(
          turnState,
          formatSkillInvocation(skill, additionalInstructions),
        );
      }),
    );
  }

  async skill(name: string, additionalInstructions?: string): Promise<AssistantMessage> {
    return Effect.runPromise(this.skillEffect(name, additionalInstructions));
  }

  promptFromTemplateEffect(
    name: string,
    args: string[] = [],
  ): Effect.Effect<AssistantMessage, AgentHarnessError | SessionError> {
    const self = this;
    return self.runAsTurnEffect("promptFromTemplate", (turnState) =>
      Effect.gen(function* () {
        const template = (turnState.resources.promptTemplates ?? []).find(
          (candidate) => candidate.name === name,
        );
        if (!template) {
          return yield* Effect.fail(
            new AgentHarnessError({
              code: "invalid_argument",
              message: `Unknown prompt template: ${name}`,
            }),
          );
        }
        return yield* self.executeTurnEffect(
          turnState,
          formatPromptTemplateInvocation(template, args),
        );
      }),
    );
  }

  async promptFromTemplate(name: string, args: string[] = []): Promise<AssistantMessage> {
    return Effect.runPromise(this.promptFromTemplateEffect(name, args));
  }

  async steer(text: string, options?: { images?: ImageContent[] }): Promise<void> {
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

  /**
   * Push a `<tool-schema-changed>` notice onto the steer queue so the model
   * knows a tool's format has changed. The notice includes the full
   * {@link renderToolSection} output — identical to what the system prompt
   * will show after compaction.
   *
   * Safe to call while idle (same as {@link announceSkillAdded}).
   */
  private announceToolChange(tool: TTool): void {
    const notice = [
      "<tool-schema-changed>",
      `The "${tool.name}" tool has been updated. The previous format is no longer active. Use the updated format below:`,
      "",
      renderToolSection(tool),
      "</tool-schema-changed>",
    ].join("\n");
    this.steerQueue.push(createUserMessage(notice));
  }

  async followUp(text: string, options?: { images?: ImageContent[] }): Promise<void> {
    if (this.phase === "idle") {
      throw new AgentHarnessError({
        code: "invalid_state",
        message: "Cannot follow up while idle",
      });
    }
    this.followUpQueue.push(createUserMessage(text, options?.images));
    await this.emitQueueUpdate();
  }

  async nextTurn(text: string, options?: { images?: ImageContent[] }): Promise<void> {
    this.nextTurnQueue.push(createUserMessage(text, options?.images));
    await this.emitQueueUpdate();
  }

  appendMessageEffect(
    message: AgentMessage,
  ): Effect.Effect<void, AgentHarnessError | SessionError> {
    const self = this;
    return Effect.gen(function* () {
      if (self.phase === "idle") {
        yield* self.session.appendMessage(message);
      } else {
        self.pendingSessionWrites.push({ type: "message", message });
      }
    }).pipe(Effect.mapError((error) => normalizeHarnessError(error, "session")));
  }

  async appendMessage(message: AgentMessage): Promise<void> {
    await Effect.runPromise(this.appendMessageEffect(message));
  }

  compactEffect(customInstructions?: string): Effect.Effect<
    {
      summary: string;
      firstKeptEntryId: string;
      tokensBefore: number;
      details?: unknown;
    },
    AgentHarnessError | SessionError
  > {
    const self = this;
    return Effect.gen(function* () {
      if (self.phase !== "idle") {
        return yield* Effect.fail(
          new AgentHarnessError({
            code: "busy",
            message: "compact() requires idle harness",
          }),
        );
      }
      self.phase = "compaction";
      const auth = yield* Effect.promise(() =>
        Promise.resolve(self.getApiKeyAndHeaders?.(self.model) ?? Promise.resolve(undefined)),
      );
      if (!auth) {
        yield* new AgentHarnessError({
          code: "auth",
          message: "No auth available for compaction",
        });
      }
      const branchEntries = yield* self.session.getBranch();
      const preparationResult = prepareCompaction(branchEntries, DEFAULT_COMPACTION_SETTINGS);
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
          signal: self.runAbortController?.signal ?? new AbortController().signal,
        }),
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
        : yield* runCompactEffect(preparation!, self.model, auth!.apiKey, {
            ...(auth?.headers === undefined ? {} : { headers: auth.headers }),
            ...(customInstructions === undefined ? {} : { customInstructions }),
            ...(self.thinkingLevel === undefined ? {} : { thinkingLevel: self.thinkingLevel }),
            prompts: self.compactionPrompts,
          });
      if (isFailure(compactResult)) {
        return yield* Effect.fail(compactResult.failure);
      }
      const result = compactResult.success;
      const entryId = yield* self.session.appendCompaction(
        result.summary,
        result.firstKeptEntryId,
        result.tokensBefore,
        result.details,
        provided !== undefined,
      );
      const entry = yield* self.session.getEntry(entryId);
      if (entry?.type === "compaction") {
        yield* Effect.promise(() =>
          self.emitOwn({
            type: "session_compact",
            compactionEntry: entry,
            fromHook: provided !== undefined,
          }),
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
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          if (self.phase === "compaction") {
            self.phase = "idle";
          }
        }),
      ),
      Effect.mapError((error) => normalizeHarnessError(error, "compaction")),
    );
  }

  async compact(customInstructions?: string): Promise<{
    summary: string;
    firstKeptEntryId: string;
    tokensBefore: number;
    details?: unknown;
  }> {
    return Effect.runPromise(this.compactEffect(customInstructions));
  }

  navigateTreeEffect(
    targetId: string,
    options?: {
      summarize?: boolean;
      customInstructions?: string;
      replaceInstructions?: boolean;
      label?: string;
    },
  ): Effect.Effect<NavigateTreeResult, AgentHarnessError | SessionError> {
    const self = this;
    return Effect.gen(function* () {
      if (self.phase !== "idle") {
        return yield* Effect.fail(
          new AgentHarnessError({
            code: "busy",
            message: "navigateTree() requires idle harness",
          }),
        );
      }
      self.phase = "branch_summary";
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
      const { entries, commonAncestorId } = yield* collectEntriesForBranchSummaryEffect(
        self.session,
        oldLeafId,
        targetId,
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
      const signal = self.runAbortController?.signal ?? new AbortController().signal;
      const hookResult = yield* Effect.promise(() =>
        self.emitHook({
          type: "session_before_tree",
          preparation,
          signal,
        }),
      );
      if (hookResult?.cancel) {
        return { cancelled: true };
      }
      let summaryEntry: NavigateTreeResult["summaryEntry"];
      let summaryText: string | undefined = hookResult?.summary?.summary;
      let summaryDetails: unknown = hookResult?.summary?.details;
      if (!summaryText && options?.summarize && entries.length > 0) {
        const auth = yield* Effect.promise(() =>
          Promise.resolve(self.getApiKeyAndHeaders?.(self.model) ?? Promise.resolve(undefined)),
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
          prompts: self.branchSummaryPrompts,
          ...(auth!.headers === undefined ? {} : { headers: auth!.headers }),
          signal: self.runAbortController?.signal ?? new AbortController().signal,
          ...(hookResult?.customInstructions !== undefined ||
          options?.customInstructions !== undefined
            ? {
                customInstructions: hookResult?.customInstructions ?? options?.customInstructions,
              }
            : {}),
          ...((hookResult?.replaceInstructions ?? options?.replaceInstructions) === undefined
            ? {}
            : {
                replaceInstructions:
                  hookResult?.replaceInstructions ?? options?.replaceInstructions,
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
      if (targetEntry!.type === "message" && targetEntry!.message.role === "user") {
        newLeafId = targetEntry!.parentId;
        const content = targetEntry!.message.content;
        editorText =
          typeof content === "string"
            ? content
            : content
                .filter(
                  (
                    c,
                  ): c is {
                    readonly type: "text";
                    readonly text: string;
                  } => c.type === "text",
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
                    c,
                  ): c is {
                    readonly type: "text";
                    readonly text: string;
                  } => c.type === "text",
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
          : undefined,
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
        }),
      );
      return { cancelled: false, editorText, summaryEntry };
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          if (self.phase === "branch_summary") {
            self.phase = "idle";
          }
        }),
      ),
      Effect.mapError((error) => normalizeHarnessError(error, "branch_summary")),
    );
  }

  async navigateTree(
    targetId: string,
    options?: {
      summarize?: boolean;
      customInstructions?: string;
      replaceInstructions?: boolean;
      label?: string;
    },
  ): Promise<NavigateTreeResult> {
    return Effect.runPromise(this.navigateTreeEffect(targetId, options));
  }

  getModel(): Model {
    return this.model;
  }

  /** Session-cumulative cache counters (§10). Survive compaction. */
  getCacheCounters(): {
    cacheHitTokens: number;
    cacheMissTokens: number;
    turnCount: number;
    hitRate: number;
  } {
    const total = this.cacheHitTokens + this.cacheMissTokens;
    return {
      cacheHitTokens: this.cacheHitTokens,
      cacheMissTokens: this.cacheMissTokens,
      turnCount: this.cacheShapeTurnCount,
      hitRate: total === 0 ? 0 : Math.floor((this.cacheHitTokens * 100) / total),
    };
  }

  setModelEffect(model: Model): Effect.Effect<void, AgentHarnessError | SessionError> {
    const self = this;
    return Effect.gen(function* () {
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
        }),
      );
    }).pipe(Effect.mapError((error) => normalizeHarnessError(error, "session")));
  }

  async setModel(model: Model): Promise<void> {
    await Effect.runPromise(this.setModelEffect(model));
  }

  getThinkingLevel(): ThinkingLevel {
    return this.thinkingLevel;
  }

  setThinkingLevelEffect(
    level: ThinkingLevel,
  ): Effect.Effect<void, AgentHarnessError | SessionError> {
    const self = this;
    return Effect.gen(function* () {
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
        }),
      );
    }).pipe(Effect.mapError((error) => normalizeHarnessError(error, "session")));
  }

  async setThinkingLevel(level: ThinkingLevel): Promise<void> {
    await Effect.runPromise(this.setThinkingLevelEffect(level));
  }

  getTools(): TTool[] {
    return [...this.tools.values()];
  }

  setToolsEffect(
    tools: TTool[],
    activeToolNames?: string[],
  ): Effect.Effect<void, AgentHarnessError | SessionError> {
    const self = this;
    return Effect.gen(function* () {
      self.validateUniqueNames(
        tools.map((tool) => tool.name),
        "Duplicate tool name(s)",
      );
      const nextTools = new Map(tools.map((tool) => [tool.name, tool]));
      const nextActiveToolNames = activeToolNames ? [...activeToolNames] : self.activeToolNames;
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
        }),
      );
    }).pipe(Effect.mapError((error) => normalizeHarnessError(error, "invalid_argument")));
  }

  async setTools(tools: TTool[], activeToolNames?: string[]): Promise<void> {
    await Effect.runPromise(this.setToolsEffect(tools, activeToolNames));
  }

  /**
   * Replace a single tool's implementation while preserving activeToolNames.
   *
   * The new tool must have the same `name` as the one being replaced. The
   * tools-tier cache busts on the next request (new parameters schema), but
   * the system prompt cache survives — the `# Tool:` description stays frozen
   * until the next compaction applies the scheduled refresh.
   *
   * Announces the change via a `<tool-schema-changed>` user message on the
   * steer queue so the model knows the format changed.
   *
   * Use this for mid-session tool reconfiguration (e.g. switching edit mode
   * from hashline to replace) where the tool stays active but its contract
   * changes.
   */
  async swapTool(name: string, newTool: TTool): Promise<void> {
    if (newTool.name !== name) {
      throw new AgentHarnessError({
        code: "invalid_argument",
        message: `swapTool: newTool.name "${newTool.name}" must match "${name}"`,
      });
    }
    if (!this.tools.has(name)) {
      throw new AgentHarnessError({
        code: "invalid_argument",
        message: `swapTool: tool "${name}" not found in registry`,
      });
    }
    const previousToolNames = [...this.tools.keys()];
    const previousActiveToolNames = [...this.activeToolNames];
    this.tools.set(name, newTool);
    this.scheduleSystemPromptRefresh(this.recomposeSystemPrompt());
    this.announceToolChange(newTool);
    void this.emitOwn({
      type: "tools_update",
      toolNames: [...this.tools.keys()],
      previousToolNames,
      activeToolNames: [...this.activeToolNames],
      previousActiveToolNames,
      source: "swap",
    });
  }

  getActiveTools(): TTool[] {
    return this.activeToolNames
      .map((name) => this.tools.get(name))
      .filter((tool): tool is TTool => tool !== undefined);
  }

  /**
   * Rebuild the system prompt from the base agent instructions + the current
   * tool inventory (excluding soft-disabled tools) + the current skills block.
   *
   * Used by {@link softDisableTool}, {@link softEnableTool}, and
   * {@link removeSkill} to schedule a cache-stable prompt refresh: the
   * recomposed prompt is handed to {@link scheduleSystemPromptRefresh} and
   * applied at the next compaction (when the cache is busted anyway).
   */
  private recomposeSystemPrompt(): string {
    const current = this.getSystemPrompt() ?? "";
    const base = stripToolInventory(stripSkillsBlock(current, this.skillsInstructions));
    const activeTools = this.getActiveTools().filter(
      (tool) => !this.softDisabledTools.has(tool.name),
    );
    const skills = this.resources.skills ?? [];
    const hasRead = this.activeToolNames.includes("read");
    return composeSystemPrompt(base, activeTools, skills, hasRead, this.skillsInstructions);
  }

  /**
   * Block execution of `toolName` while keeping its schema in the request.
   *
   * The tool's schema stays in `activeToolNames` so the cacheable tools-prefix
   * is unchanged; when the model calls the tool, the `beforeToolCall` gate
   * returns `{block: true, reason}` and the model receives `reason` as a
   * tool-error result it can adapt to.
   *
   * Additionally schedules a {@link scheduleSystemPromptRefresh} so the tool's
   * description is removed from the system prompt at the next compaction.
   * The live prompt stays frozen until then (cache-stable).
   *
   * Use this when the user disables an MCP server or side-effecting tool
   * mid-session and wants it gone *now* — `setActiveTools` would rewrite the
   * tools array and bust the cache.
   */
  softDisableTool(toolName: string, reason: string): void {
    this.softDisabledTools.set(toolName, reason);
    this.scheduleSystemPromptRefresh(this.recomposeSystemPrompt());
  }

  /**
   * Re-enable a previously soft-disabled tool.
   *
   * Removes the execution gate and schedules a prompt refresh so the tool's
   * description reappears in the system prompt at the next compaction.
   */
  softEnableTool(toolName: string): void {
    this.softDisabledTools.delete(toolName);
    this.scheduleSystemPromptRefresh(this.recomposeSystemPrompt());
  }

  /** Returns true iff `toolName` is currently soft-disabled. Test/debug hook. */
  isToolSoftDisabled(toolName: string): boolean {
    return this.softDisabledTools.has(toolName);
  }

  setActiveToolsEffect(toolNames: string[]): Effect.Effect<void, AgentHarnessError | SessionError> {
    const self = this;
    return Effect.gen(function* () {
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
        }),
      );
    }).pipe(Effect.mapError((error) => normalizeHarnessError(error, "invalid_argument")));
  }

  async setActiveTools(toolNames: string[]): Promise<void> {
    await Effect.runPromise(this.setActiveToolsEffect(toolNames));
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

  async setResources(resources: AgentHarnessResources<TSkill, TPromptTemplate>): Promise<void> {
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

  /**
   * Install a skill mid-session.
   *
   * Updates `resources.skills` and pushes a `<skills-added>` steering notice
   * so the model learns the skill exists on the next turn. The system prompt
   * stays frozen (the skill's advertisement is NOT added to the prompt's
   * `<available_skills>` block until the next session) — cache stays warm.
   *
   * To materialize the new skill in the prompt's `<available_skills>` block,
   * either restart the session or trigger compaction (which is a no-op
   * cache-wise since you'd compact anyway).
   *
   * Idempotent: adding a skill whose name already exists is a no-op.
   */
  async addSkill(skill: TSkill): Promise<void> {
    const currentSkills = this.resources.skills ?? [];
    if (currentSkills.some((s) => s.name === skill.name)) {
      return;
    }
    await this.setResources({
      ...this.resources,
      skills: [...currentSkills, skill],
    });
    this.announceSkillAdded(skill);
  }

  /**
   * Disable a skill mid-session without immediately rewriting the prompt.
   *
   * Three effects, all cache-friendly:
   *   1. Removes the skill from `resources.skills` (in-memory only).
   *   2. Schedules a `systemPromptRefresh` with the skill removed from the
   *      `<available_skills>` block. Applied at next compaction.
   *   3. Soft-disables the `read` tool on the skill's `filePath`, so the
   *      model can't reload the body from disk until compaction swaps the
   *      prompt.
   *
   * Emits `cache_bust_pending` so the UI can recommend compaction.
   *
   * Idempotent: removing an unknown skill is a no-op.
   */
  async removeSkill(name: string): Promise<void> {
    const currentSkills = this.resources.skills ?? [];
    const skill = currentSkills.find((s) => s.name === name);
    if (!skill) {
      return;
    }
    const remaining = currentSkills.filter((s) => s.name !== name);
    await this.setResources({
      ...this.resources,
      skills: remaining,
    });

    // Recompose the system prompt with the remaining skills and schedule it
    // for compaction. recomposeSystemPrompt recovers the base prompt (stripping
    // both the tool inventory and skills block), then rebuilds from the current
    // tools (minus soft-disabled) and remaining skills.
    this.scheduleSystemPromptRefresh(this.recomposeSystemPrompt());

    // Soft-disable read on the skill path so the model can't reload the body.
    if (skill.filePath) {
      this.softDisabledPaths.add(skill.filePath);
    }
  }

  /** Test/debug hook for skill-path soft-disable. */
  isToolPathSoftDisabled(path: string): boolean {
    return this.softDisabledPaths.has(path);
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
    evaluator: ((permission: string, pattern: string) => "allow" | "deny" | "ask") | undefined,
  ): void {
    this.permissionEvaluator = evaluator;
  }

  /**
   * Set the async `"ask"` resolver forwarded to the loop. Invoked when
   * {@link setPermissionEvaluator} returns `"ask"`; the loop pauses until the
   * returned promise settles. Wire this to an interactive approval channel.
   */
  setPermissionAskResolver(
    resolver: ((req: PermissionAskRequest) => Promise<"allow" | "deny">) | undefined,
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
  switchAgentEffect(agent: AgentDefinition): Effect.Effect<void, AgentHarnessError | SessionError> {
    const self = this;
    return Effect.gen(function* () {
      self.currentAgent = agent;
      self.systemPrompt = agent.systemPrompt;
      self.clearPendingSystemPromptRefresh();
      if (agent.thinkingLevel !== undefined) {
        yield* self.setThinkingLevelEffect(agent.thinkingLevel);
      }
      if (agent.activeToolNames !== undefined) {
        yield* self.setActiveToolsEffect(agent.activeToolNames);
      }
    });
  }

  async switchAgent(agent: AgentDefinition): Promise<void> {
    await Effect.runPromise(this.switchAgentEffect(agent));
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
    return typeof this.systemPrompt === "string" ? this.systemPrompt : undefined;
  }

  getStreamOptions(): AgentHarnessStreamOptions {
    return cloneStreamOptions(this.streamOptions);
  }

  async setStreamOptions(streamOptions: AgentHarnessStreamOptions): Promise<void> {
    this.streamOptions = cloneStreamOptions(streamOptions);
  }

  abortEffect(): Effect.Effect<AbortResult, AgentHarnessError | SessionError> {
    const self = this;
    return Effect.gen(function* () {
      const clearedSteer = [...self.steerQueue];
      const clearedFollowUp = [...self.followUpQueue];
      self.steerQueue = [];
      self.followUpQueue = [];
      self.runAbortController?.abort();
      self.logger?.warn("turn aborted");
      const errors: Error[] = [];
      const drainExit = (exit: Exit.Exit<unknown, unknown>) => {
        if (Exit.isFailure(exit)) {
          errors.push(toError(Cause.squash(exit.cause)));
        }
      };

      drainExit(yield* Effect.exit(self.emitQueueUpdateEffect()));
      drainExit(yield* Effect.exit(self.waitForIdleEffect()));
      drainExit(
        yield* Effect.exit(self.emitOwnEffect({ type: "abort", clearedSteer, clearedFollowUp })),
      );

      if (errors.length > 0) {
        const cause =
          errors.length === 1
            ? errors[0]!
            : new AggregateError(errors, "Abort completed with errors");
        return yield* Effect.fail(normalizeHarnessError(cause, "hook"));
      }
      return { clearedSteer, clearedFollowUp };
    });
  }

  async abort(): Promise<AbortResult> {
    return Effect.runPromise(this.abortEffect());
  }

  waitForIdleEffect(): Effect.Effect<void, AgentHarnessError | SessionError> {
    return Effect.promise(() => this.runPromise ?? Promise.resolve());
  }

  async waitForIdle(): Promise<void> {
    await Effect.runPromise(this.waitForIdleEffect());
  }

  subscribe(
    listener: (
      event: AgentHarnessEvent<TSkill, TPromptTemplate>,
      signal?: AbortSignal,
    ) => Promise<void> | void,
  ): () => void {
    let handlers = this.handlers.get(SUBSCRIBER_EVENT_TYPE);
    if (!handlers) {
      handlers = new Set();
      this.handlers.set(SUBSCRIBER_EVENT_TYPE, handlers);
    }
    handlers.add(listener as AgentHarnessHandler);
    return () => handlers!.delete(listener as AgentHarnessHandler);
  }

  /**
   * Effect-native stream subscription over the harness event bus.
   *
   * Returns a `Stream.Stream<AgentHarnessEvent>` whose subscribers see every
   * agent event (agent_start, message_update, message_end, turn_end, agent_end,
   * tool_execution_*, auto_retry_*, compaction_*, cache_shape) emitted by the
   * harness. Decouples emit from persist: publishing is non-blocking, and each
   * subscriber drains at its own pace.
   *
   * Multiple calls return independent streams (PubSub broadcast). The stream
   * ends when the underlying PubSub is shut down (harness disposal).
   */
  subscribeStream(): Stream.Stream<AgentHarnessEvent<TSkill, TPromptTemplate>> {
    return Stream.fromPubSub(this.eventBus);
  }

  on<TType extends keyof AgentHarnessEventResultMap>(
    type: TType,
    handler: (
      event: Extract<AgentHarnessOwnEvent, { type: TType }>,
    ) => Promise<AgentHarnessEventResultMap[TType]> | AgentHarnessEventResultMap[TType],
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
