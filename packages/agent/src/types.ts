import type {
  AssistantMessage,
  ImageContent,
  Message,
  Model,
  StreamRequest,
  StreamResult,
  TextContent,
  Tool,
  ToolResultMessage,
} from "@sakti-code/llm";
import type { Logger } from "@sakti-code/logger";
import type { Static, TSchema } from "typebox";
import type { CacheDiagnostics } from "./core/cache-shape";

export type StreamFn = (req: StreamRequest) => Promise<StreamResult> | StreamResult;

export type ToolExecutionMode = "sequential" | "parallel";

export type QueueMode = "all" | "one-at-a-time";

export type AgentToolCall = Extract<AssistantMessage["content"][number], { type: "toolCall" }>;

export interface BeforeToolCallResult {
  block?: boolean | undefined;
  reason?: string | undefined;
}

export interface AfterToolCallResult {
  content?: (TextContent | ImageContent)[] | undefined;
  details?: unknown;
  isError?: boolean | undefined;
  terminate?: boolean | undefined;
}

export interface BeforeToolCallContext {
  args: unknown;
  assistantMessage: AssistantMessage;
  context: AgentContext;
  toolCall: AgentToolCall;
}

export interface AfterToolCallContext {
  args: unknown;
  assistantMessage: AssistantMessage;
  context: AgentContext;
  isError: boolean;
  result: AgentToolResult<any>;
  toolCall: AgentToolCall;
}

export interface ShouldStopAfterTurnContext {
  context: AgentContext;
  message: AssistantMessage;
  newMessages: AgentMessage[];
  toolResults: ToolResultMessage[];
}

export interface AgentLoopTurnUpdate {
  context?: AgentContext | undefined;
  model?: Model | undefined;
  thinkingLevel?: ThinkingLevel | undefined;
}

export interface PrepareNextTurnContext extends ShouldStopAfterTurnContext {}

export interface AgentLoopConfig {
  afterToolCall?:
    | ((
        context: AfterToolCallContext,
        signal?: AbortSignal,
      ) => Promise<AfterToolCallResult | undefined>)
    | undefined;

  apiKey?: string | undefined;

  /**
   * Optional observational-memory hook. When present, the loop runs
   * maybeObserve/maybeReflect at turn boundaries and injects <observations>
   * into the system prompt.
   */
  observationalMemory?:
    | {
        readonly engine: {
          getOrCreateRecord(): Promise<unknown>;
          maybeObserve(record: unknown): Promise<unknown>;
          maybeReflect(record: unknown): Promise<unknown>;
          buildContextSystemMessage(record: unknown): string | undefined;
        };
        readonly getBaseSystemPrompt: () => string;
      }
    | undefined;

  /**
   * Read-only OM: inject <observations> from existing history without
   * running observe/reflect. Set when OM is disabled but prior history exists.
   * The callback reads the latest OM record and returns the formatted
   * observations block, or undefined if no history.
   */
  observationalMemoryReadOnly?:
    | {
        readonly getObservationsBlock: () => Promise<string | undefined>;
      }
    | undefined;

  beforeToolCall?:
    | ((
        context: BeforeToolCallContext,
        signal?: AbortSignal,
      ) => Promise<BeforeToolCallResult | undefined>)
    | undefined;

  convertToLlm: (messages: AgentMessage[]) => Message[] | Promise<Message[]>;

  evaluatePermission?: (permission: string, pattern: string) => "allow" | "deny" | "ask";

  getApiKey?: ((provider: string) => Promise<string | undefined> | string | undefined) | undefined;

  getFollowUpMessages?: (() => Promise<AgentMessage[]>) | undefined;

  getSteeringMessages?: (() => Promise<AgentMessage[]>) | undefined;
  headers?: Record<string, string> | undefined;
  logger?: Logger | undefined;
  maxSteps?: number | undefined;
  model: Model;

  prepareNextTurn?:
    | ((
        context: PrepareNextTurnContext,
      ) => AgentLoopTurnUpdate | undefined | Promise<AgentLoopTurnUpdate | undefined>)
    | undefined;

  reasoning?: ThinkingLevel | undefined;

  resolvePermissionAsk?: (req: PermissionAskRequest) => Promise<"allow" | "deny">;
  sessionId?: string | undefined;

  shouldStopAfterTurn?:
    | ((context: ShouldStopAfterTurnContext) => boolean | Promise<boolean>)
    | undefined;

  toolExecution?: ToolExecutionMode | undefined;

  transformContext?:
    | ((messages: AgentMessage[], signal?: AbortSignal) => Promise<AgentMessage[]>)
    | undefined;
}

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

export type CustomAgentMessages = Record<string, never>;

export interface CustomMessage<T = unknown> {
  content: string | (TextContent | ImageContent)[];
  customType: string;
  details?: T;
  display: boolean;
  role: "custom";
  timestamp: number;
}

export interface BashExecutionMessage {
  cancelled: boolean;
  command: string;
  excludeFromContext?: boolean;
  exitCode: number | undefined;
  fullOutputPath?: string;
  output: string;
  role: "bashExecution";
  timestamp: number;
  truncated: boolean;
}

export interface BranchSummaryMessage {
  fromId: string;
  role: "branchSummary";
  summary: string;
  timestamp: number;
}

export interface CompactionSummaryMessage {
  role: "compactionSummary";
  summary: string;
  timestamp: number;
  tokensBefore: number;
}

export type AgentMessage =
  | Message
  | CustomMessage
  | BashExecutionMessage
  | BranchSummaryMessage
  | CompactionSummaryMessage;

export interface AgentState {
  readonly errorMessage?: string | undefined;
  readonly isStreaming: boolean;
  set messages(messages: AgentMessage[]);
  get messages(): AgentMessage[];
  model: Model;
  readonly pendingToolCalls: ReadonlySet<string>;
  readonly streamingMessage?: AgentMessage | undefined;
  systemPrompt: string;
  thinkingLevel: ThinkingLevel;
  set tools(tools: AgentTool<any>[]);
  get tools(): AgentTool<any>[];
}

export interface AgentToolResult<T> {
  content: (TextContent | ImageContent)[];
  details: T;
  terminate?: boolean | undefined;
}

export interface PermissionRequest {
  patterns: string[];
  permission: string;
}

export interface PermissionAskRequest {
  always: string[];
  patterns: string[];
  permission: string;
  sessionId: string;
  toolCallId: string;
  toolName: string;
}

export type PermissionReply = "once" | "always" | "reject";

export type AgentToolUpdateCallback<T = any> = (partialResult: AgentToolResult<T>) => void;

export interface AgentTool<
  TParameters extends TSchema = TSchema,
  TDetails = any,
> extends Tool<TParameters> {
  execute: (
    toolCallId: string,
    params: Static<TParameters>,
    signal?: AbortSignal,
    onUpdate?: AgentToolUpdateCallback<TDetails>,
  ) => Promise<AgentToolResult<TDetails>>;
  executionMode?: ToolExecutionMode | undefined;
  label: string;
  permissions?: (params: unknown) => PermissionRequest[] | undefined;
  prepareArguments?: ((args: unknown) => Static<TParameters>) | undefined;
}

export interface AgentContext {
  messages: AgentMessage[];
  systemPrompt: string;
  tools?: AgentTool<any>[] | undefined;
}

export type AgentEvent =
  | { type: "agent_start" }
  | { type: "agent_end"; messages: AgentMessage[] }
  | { type: "turn_start" }
  | {
      type: "turn_end";
      message: AgentMessage;
      toolResults: ToolResultMessage[];
    }
  | { type: "message_start"; message: AgentMessage }
  | {
      type: "message_update";
      delta:
        | { kind: "text"; text: string }
        | { kind: "thinking"; text: string }
        | { kind: "tool_input"; toolCallId: string; text: string };
    }
  | { type: "message_end"; message: AgentMessage }
  | {
      type: "tool_execution_start";
      toolCallId: string;
      toolName: string;
      args: any;
    }
  | {
      type: "tool_execution_update";
      toolCallId: string;
      toolName: string;
      args: any;
      partialResult: any;
    }
  | {
      type: "tool_execution_end";
      toolCallId: string;
      toolName: string;
      result: any;
      isError: boolean;
    }
  | {
      type: "auto_retry_start";
      attempt: number;
      maxAttempts: number;
      delayMs: number;
      errorMessage: string;
    }
  | {
      type: "auto_retry_end";
      success: boolean;
      attempt: number;
      finalError?: string;
    }
  | { type: "compaction_start"; reason: "threshold" | "overflow" }
  | {
      type: "compaction_end";
      reason: "threshold" | "overflow";
      result?: {
        summary: string;
        firstKeptEntryId: string;
        tokensBefore: number;
      };
      aborted: boolean;
      willRetry: boolean;
      errorMessage?: string;
    }
  | { type: "cache_shape"; diagnostics: CacheDiagnostics }
  // --- Observational Memory lifecycle events ---
  // Fired by ObservationalMemoryEngine via onOmEvent callback.
  // cycleId joins start/end/failed/activation for the same operation.
  | {
      type: "om_start";
      cycleId: string;
      operationType: "observation" | "reflection" | "buffering";
      tokenCount: number;
    }
  | {
      type: "om_end";
      cycleId: string;
      operationType: "observation" | "reflection" | "buffering";
      durationMs: number;
      tokensProcessed: number;
      tokensProduced: number;
      observations?: string;
      currentTask?: string;
      suggestedResponse?: string;
    }
  | {
      type: "om_failed";
      cycleId: string;
      operationType: "observation" | "reflection" | "buffering";
      error: string;
      durationMs: number;
    }
  | {
      type: "om_activation";
      cycleId: string;
      operationType: "observation" | "reflection";
      chunksActivated: number;
      tokensActivated: number;
      observationTokens: number;
    }
  | {
      type: "om_status";
      windows: {
        messages: { tokens: number; threshold: number };
        observations: { tokens: number; threshold: number };
      };
      recordId: string;
    };

/** Extract just the OM events from AgentEvent. */
export type OmAgentEvent = Extract<
  AgentEvent,
  { type: "om_start" | "om_end" | "om_failed" | "om_activation" | "om_status" }
>;
