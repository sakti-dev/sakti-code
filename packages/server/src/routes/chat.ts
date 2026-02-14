/**
 * Chat API - AI chat endpoint with session management
 *
 * Handles chat requests with session bridge integration and UIMessage streaming.
 * Integrates with new SessionManager for simplified agent orchestration.
 * Supports multimodal (image) inputs that trigger vision model routing.
 *
 * Publishes Opencode-style part events to the Bus for SSE streaming.
 */

import { createLogger } from "@ekacode/shared/logger";
import { createUIMessageStream, createUIMessageStreamResponse } from "ai";
import { Hono } from "hono";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { MessagePartUpdated, MessageUpdated, publish, SessionStatus } from "../bus";
import type { Env } from "../index";
import { createSessionMessage, sessionBridge } from "../middleware/session-bridge";
import { resolveOAuthAccessToken } from "../provider/auth/oauth";
import { normalizeProviderError } from "../provider/errors";
import {
  getProviderRuntime,
  hasProviderEnvironmentCredential,
  providerCredentialEnvVar,
  resolveChatSelection,
} from "../provider/runtime";
import { getSessionManager } from "../runtime";
import { getSessionMessages } from "../state/session-message-store";

const app = new Hono<Env>();
const logger = createLogger("server");

// Apply session bridge middleware
app.use("*", sessionBridge);

/**
 * Custom stream event types for agent communication
 * These are not standard AI SDK UIMessageChunk types but custom protocol
 */
interface TextDeltaEvent {
  type: "text-delta";
  id: string;
  delta: string;
}

/**
 * Antigravity UI - Mode detection and data streaming
 */
type AgentMode = "planning" | "build" | "chat";
type AgentEventKind =
  | "thought"
  | "note"
  | "analyzed"
  | "created"
  | "edited"
  | "deleted"
  | "terminal"
  | "error"
  | "tool";

/**
 * Event actions for user interaction
 */
type AgentEventAction =
  | { type: "open-file"; path: string; line?: number }
  | { type: "open-diff"; path: string }
  | { type: "open-terminal"; id: string }
  | { type: "open-url"; url: string };

/**
 * Canonical agent event (used in both planning and build modes)
 */
interface AgentEvent {
  /** Unique event ID */
  id: string;
  /** Timestamp (ms since epoch) */
  ts: number;
  /** Event kind determines icon and styling */
  kind: AgentEventKind;
  /** Primary display text (e.g., "Read file.ts") */
  title: string;
  /** Secondary text (e.g., file path, command output preview) */
  subtitle?: string;
  /** File info for file-related events */
  file?: {
    path: string;
    range?: string;
  };
  /** Diff stats for edit events */
  diff?: {
    plus: number;
    minus: number;
  };
  /** Terminal info for shell events */
  terminal?: {
    command: string;
    cwd?: string;
    outputPreview: string;
    exitCode?: number;
    background?: boolean;
  };
  /** Error info */
  error?: {
    message: string;
    details?: string;
  };
  /** Available actions for this event */
  actions?: AgentEventAction[];
  /** Tool call ID for linking to tool-result */
  toolCallId?: string;
  /** Agent ID that produced this event */
  agentId?: string;
}

/**
 * Run Card data for planning mode aggregated view
 */
interface RunCardData {
  /** Unique run ID */
  runId: string;
  /** Run title (e.g., "Planning Authentication") */
  title: string;
  /** Subtitle/description */
  subtitle?: string;
  /** Current status */
  status: "planning" | "executing" | "done" | "error";
  /** Ordered list of edited file paths */
  filesEditedOrder: string[];
  /** Ordered list of progress group IDs */
  groupsOrder: string[];
  /** Whether all groups are collapsed */
  collapsedAll?: boolean;
  /** Start timestamp */
  startedAt?: number;
  /** First significant update timestamp */
  firstSignificantUpdateAt?: number;
  /** Finish timestamp */
  finishedAt?: number;
  /** Duration in ms */
  elapsedMs?: number;
}

interface RunFileData {
  path: string;
  tag?: "Task" | "Implementation Plan" | "Doc" | "Code" | "Config";
  diff?: { plus: number; minus: number };
  cta?: "open" | "open-diff";
}

interface RunGroupData {
  id: string;
  index: number;
  title: string;
  collapsed: boolean;
  itemsOrder: string[];
}

interface ModeState {
  mode: AgentMode;
  runId: string | null;
  hasToolCalls: boolean;
  hasReasoning: boolean;
  reasoningTexts: Map<string, string>; // Track reasoning text by ID
  runCardData: RunCardData | null;
  runGroupData: RunGroupData | null;
  toolCallTimestamps: Map<string, number>;
}

/**
 * Map tool name to AgentEventKind
 */
function mapToolToKind(toolName: string): AgentEventKind {
  if (toolName === "write_to_file") return "created";
  if (toolName === "replace_file_content") return "edited";
  if (toolName === "multi_replace_file_content") return "edited";
  if (toolName === "run_command") return "terminal";
  if (toolName === "grep_search") return "analyzed";
  if (toolName === "find_by_name") return "analyzed";
  if (toolName === "view_file") return "analyzed";
  return "tool";
}

/**
 * Format tool call as human-readable title
 */
function formatToolTitle(toolName: string, args: Record<string, unknown>): string {
  if (toolName === "write_to_file") {
    const path = (args.TargetFile as string) || "";
    return `Created ${path.split("/").pop()}`;
  }
  if (toolName === "replace_file_content" || toolName === "multi_replace_file_content") {
    const path = (args.TargetFile as string) || "";
    return `Edited ${path.split("/").pop()}`;
  }
  if (toolName === "run_command") {
    const cmd = (args.CommandLine as string) || "";
    return `Running: ${cmd.slice(0, 50)}${cmd.length > 50 ? "..." : ""}`;
  }
  if (toolName === "grep_search") {
    const query = (args.Query as string) || "";
    return `Searching for "${query}"`;
  }
  if (toolName === "view_file") {
    const path = (args.AbsolutePath as string) || "";
    return `Viewing ${path.split("/").pop()}`;
  }
  return toolName.replace(/_/g, " ");
}

/**
 * Format tool subtitle with additional context
 */
function formatToolSubtitle(toolName: string, args: Record<string, unknown>): string | undefined {
  if (toolName === "write_to_file" || toolName.includes("replace")) {
    const path = (args.TargetFile as string) || "";
    const dir = path.split("/").slice(0, -1).join("/");
    return dir ? `in ${dir}` : undefined;
  }
  if (toolName === "run_command") {
    const cwd = (args.Cwd as string) || "";
    return cwd ? `in ${cwd}` : undefined;
  }
  return undefined;
}

/**
 * Create actions for tool events
 */
function createToolActions(toolName: string, args: Record<string, unknown>): AgentEventAction[] {
  const actions: AgentEventAction[] = [];

  if (toolName.includes("file") && args.TargetFile) {
    actions.push({
      type: "open-file",
      path: args.TargetFile as string,
      line: args.StartLine as number | undefined,
    });
  }

  if (toolName === "view_file" && args.AbsolutePath) {
    actions.push({
      type: "open-file",
      path: args.AbsolutePath as string,
      line: args.Offset as number | undefined,
    });
  }

  if (toolName === "run_command") {
    actions.push({
      type: "open-terminal",
      id: "terminal-1", // Would need actual terminal ID tracking
    });
  }

  return actions;
}

/**
 * Schema for multimodal chat messages
 *
 * Supports:
 * - Simple text messages
 * - Messages with image URLs
 * - Messages with base64-encoded images
 *
 * @example
 * // Simple text message
 * { message: "Hello" }
 *
 * // Multimodal message with image
 * { message: [{ type: "text", text: "What is this?" }, { type: "image", url: "..." }] }
 */
const chatMessageSchema = z.object({
  message: z.union([
    z.string(), // Simple text message
    z.object({
      // Multimodal message with content parts
      content: z.array(
        z.object({
          type: z.enum(["text", "image", "image_url", "file"]),
          text: z.string().optional(),
          url: z.string().optional(),
          image: z.union([z.string(), z.object({ url: z.string() })]).optional(),
          mediaType: z.string().optional(),
        })
      ),
    }),
  ]),
  messageId: z.string().optional(),
  retryOfAssistantMessageId: z.string().optional(),
  providerId: z.string().optional(),
  modelId: z.string().optional(),
  stream: z.boolean().optional().default(true),
});

// Export for validation use in middleware
export { chatMessageSchema };

interface TextPartState {
  id: string;
  text: string;
  startedAt: number;
}

interface ReasoningPartState {
  id: string;
  text: string;
  startedAt: number;
}

interface ToolPartState {
  id: string;
  tool: string;
  input: Record<string, unknown>;
  startedAt: number;
}

interface RetryPartState {
  id: string;
  createdAt: number;
}

interface PartPublishState {
  text?: TextPartState;
  retry?: RetryPartState;
  reasoning: Map<string, ReasoningPartState>;
  tools: Map<string, ToolPartState>;
}

interface AssistantInfoPayload {
  role: "assistant";
  id: string;
  sessionID: string;
  modelID: string;
  providerID: string;
  parentID: string;
  time: {
    created: number;
    completed?: number;
  };
  finish?: string;
  cost?: number;
  tokens?: {
    input: number;
    output: number;
    reasoning: number;
    cache: {
      read: number;
      write: number;
    };
  };
}

export function createPartPublishState(): PartPublishState {
  return {
    reasoning: new Map(),
    tools: new Map(),
  };
}

function cloneAssistantInfo(info: AssistantInfoPayload): AssistantInfoPayload {
  return {
    ...info,
    time: { ...info.time },
    tokens: info.tokens
      ? {
          ...info.tokens,
          cache: { ...info.tokens.cache },
        }
      : undefined,
  };
}

/**
 * Helper to publish Opencode-style part events to the Bus
 *
 * Converts agent events to Part format and publishes to Bus for SSE streaming.
 * This enables the new /event endpoint while maintaining backward compatibility.
 */
export async function publishPartEvent(
  sessionId: string,
  messageId: string,
  state: PartPublishState,
  assistantInfo: AssistantInfoPayload,
  event: { type: string; [key: string]: unknown }
): Promise<void> {
  const finalizeTextPart = async () => {
    if (!state.text) return;
    state.text.text = state.text.text.trimEnd();
    if (!state.text.text) {
      state.text = undefined;
      return;
    }
    await publish(MessagePartUpdated, {
      part: {
        id: state.text.id,
        sessionID: sessionId,
        messageID: messageId,
        type: "text",
        text: state.text.text,
        time: { start: state.text.startedAt, end: Date.now() },
      },
    });
    state.text = undefined;
  };

  switch (event.type) {
    case "text": {
      const delta = String(event.text ?? "");
      if (!delta) break;

      if (!state.text) {
        state.text = {
          id: uuidv7(),
          text: "",
          startedAt: Date.now(),
        };
      }
      state.text.text += delta;

      await publish(MessagePartUpdated, {
        part: {
          id: state.text.id,
          sessionID: sessionId,
          messageID: messageId,
          type: "text",
          text: state.text.text,
          time: { start: state.text.startedAt },
        },
        delta,
      });
      break;
    }

    case "reasoning-start": {
      await finalizeTextPart();
      const reasoningId = String(event.reasoningId ?? "");
      if (!reasoningId) break;
      if (state.reasoning.has(reasoningId)) break;

      const partState: ReasoningPartState = {
        id: uuidv7(),
        text: "",
        startedAt: Date.now(),
      };
      state.reasoning.set(reasoningId, partState);

      await publish(MessagePartUpdated, {
        part: {
          id: partState.id,
          sessionID: sessionId,
          messageID: messageId,
          type: "reasoning",
          text: partState.text,
          time: { start: partState.startedAt },
        },
      });
      break;
    }

    case "reasoning-delta": {
      const reasoningId = String(event.reasoningId ?? "");
      const delta = String(event.text ?? "");
      const reasoningState = state.reasoning.get(reasoningId);
      if (!reasoningState || !delta) break;

      reasoningState.text += delta;
      await publish(MessagePartUpdated, {
        part: {
          id: reasoningState.id,
          sessionID: sessionId,
          messageID: messageId,
          type: "reasoning",
          text: reasoningState.text,
          time: { start: reasoningState.startedAt },
        },
        delta,
      });
      break;
    }

    case "reasoning-end": {
      const reasoningId = String(event.reasoningId ?? "");
      const reasoningState = state.reasoning.get(reasoningId);
      if (!reasoningState) break;

      await publish(MessagePartUpdated, {
        part: {
          id: reasoningState.id,
          sessionID: sessionId,
          messageID: messageId,
          type: "reasoning",
          text: reasoningState.text.trimEnd(),
          time: {
            start: reasoningState.startedAt,
            end: Date.now(),
          },
        },
      });

      state.reasoning.delete(reasoningId);
      break;
    }

    case "step-start": {
      await finalizeTextPart();
      await publish(MessagePartUpdated, {
        part: {
          id: uuidv7(),
          sessionID: sessionId,
          messageID: messageId,
          type: "step-start",
          snapshot: typeof event.snapshot === "string" ? event.snapshot : undefined,
        },
      });
      break;
    }

    case "step-finish": {
      await finalizeTextPart();
      const rawTokens =
        event.tokens && typeof event.tokens === "object"
          ? (event.tokens as Record<string, unknown>)
          : {};
      const rawCache =
        rawTokens.cache && typeof rawTokens.cache === "object"
          ? (rawTokens.cache as Record<string, unknown>)
          : {};
      const toNumber = (value: unknown) =>
        typeof value === "number" && Number.isFinite(value) ? value : 0;

      await publish(MessagePartUpdated, {
        part: {
          id: uuidv7(),
          sessionID: sessionId,
          messageID: messageId,
          type: "step-finish",
          reason: String(event.reason ?? "stop"),
          snapshot: typeof event.snapshot === "string" ? event.snapshot : undefined,
          cost: toNumber(event.cost),
          tokens: {
            input: toNumber(rawTokens.input),
            output: toNumber(rawTokens.output),
            reasoning: toNumber(rawTokens.reasoning),
            cache: {
              read: toNumber(rawCache.read),
              write: toNumber(rawCache.write),
            },
          },
        },
      });
      break;
    }

    case "snapshot": {
      await finalizeTextPart();
      const snapshot = typeof event.snapshot === "string" ? event.snapshot : "";
      if (!snapshot) break;
      await publish(MessagePartUpdated, {
        part: {
          id: uuidv7(),
          sessionID: sessionId,
          messageID: messageId,
          type: "snapshot",
          snapshot,
        },
      });
      break;
    }

    case "patch": {
      await finalizeTextPart();
      const files = Array.isArray(event.files)
        ? event.files.filter((value): value is string => typeof value === "string")
        : [];
      if (files.length === 0) break;
      await publish(MessagePartUpdated, {
        part: {
          id: uuidv7(),
          sessionID: sessionId,
          messageID: messageId,
          type: "patch",
          hash: typeof event.hash === "string" ? event.hash : uuidv7(),
          files,
        },
      });
      break;
    }

    case "tool-call": {
      await finalizeTextPart();
      const toolCallId = String(event.toolCallId ?? "");
      const toolName = String(event.toolName ?? "");
      if (!toolCallId || !toolName) break;

      const input =
        event.args && typeof event.args === "object" ? (event.args as Record<string, unknown>) : {};
      const existingTool = state.tools.get(toolCallId);
      const toolState: ToolPartState = existingTool ?? {
        id: uuidv7(),
        tool: toolName,
        input,
        startedAt: Date.now(),
      };
      if (!existingTool) {
        state.tools.set(toolCallId, toolState);
        await publish(MessagePartUpdated, {
          part: {
            id: toolState.id,
            sessionID: sessionId,
            messageID: messageId,
            type: "tool",
            callID: toolCallId,
            tool: toolName,
            state: {
              status: "pending",
              input,
              raw: JSON.stringify(input),
            },
          },
        });
      }

      toolState.tool = toolName;
      toolState.input = input;
      if (!existingTool) {
        toolState.startedAt = Date.now();
      }

      await publish(MessagePartUpdated, {
        part: {
          id: toolState.id,
          sessionID: sessionId,
          messageID: messageId,
          type: "tool",
          callID: toolCallId,
          tool: toolName,
          state: {
            status: "running",
            input,
            time: { start: toolState.startedAt },
          },
        },
      });
      break;
    }

    case "tool-result": {
      await finalizeTextPart();
      const toolCallId = String(event.toolCallId ?? "");
      const toolName = String(event.toolName ?? "");
      const toolState = state.tools.get(toolCallId);
      if (!toolCallId || !toolName || !toolState) break;

      const result = event.result;
      const resultRecord =
        result && typeof result === "object" ? (result as Record<string, unknown>) : undefined;
      const errorValue = resultRecord?.error;
      const isError = typeof errorValue !== "undefined";
      const now = Date.now();
      const outputValue =
        typeof resultRecord?.output !== "undefined"
          ? resultRecord.output
          : typeof resultRecord?.result !== "undefined"
            ? resultRecord.result
            : result;
      const output =
        typeof outputValue === "string" ? outputValue : JSON.stringify(outputValue ?? "");
      const metadata = resultRecord?.metadata;
      const title = typeof resultRecord?.title === "string" ? resultRecord.title : toolName;

      await publish(MessagePartUpdated, {
        part: {
          id: toolState.id,
          sessionID: sessionId,
          messageID: messageId,
          type: "tool",
          callID: toolCallId,
          tool: toolName,
          state: isError
            ? {
                status: "error",
                input: toolState.input,
                error: String(errorValue ?? "Tool execution failed"),
                time: { start: toolState.startedAt, end: now },
              }
            : {
                status: "completed",
                input: toolState.input,
                output,
                title,
                metadata:
                  metadata && typeof metadata === "object"
                    ? (metadata as Record<string, unknown>)
                    : {},
                time: { start: toolState.startedAt, end: now },
              },
        },
      });

      state.tools.delete(toolCallId);
      break;
    }

    case "retry": {
      await finalizeTextPart();
      const attempt =
        typeof event.attempt === "number" && Number.isFinite(event.attempt) ? event.attempt : 1;
      const message =
        typeof event.message === "string" && event.message.length > 0
          ? event.message
          : "Retrying after transient error";
      const errorKind = typeof event.errorKind === "string" ? event.errorKind : undefined;
      const next = typeof event.next === "number" && Number.isFinite(event.next) ? event.next : 0;
      if (!state.retry) {
        state.retry = {
          id: uuidv7(),
          createdAt: Date.now(),
        };
      }

      await publish(MessagePartUpdated, {
        part: {
          id: state.retry.id,
          sessionID: sessionId,
          messageID: messageId,
          type: "retry",
          attempt,
          next,
          error: {
            message,
            isRetryable: true,
            ...(errorKind ? { metadata: { kind: errorKind } } : {}),
          },
          time: { created: state.retry.createdAt },
        },
      });
      break;
    }

    case "finish": {
      await finalizeTextPart();

      for (const reasoningState of state.reasoning.values()) {
        await publish(MessagePartUpdated, {
          part: {
            id: reasoningState.id,
            sessionID: sessionId,
            messageID: messageId,
            type: "reasoning",
            text: reasoningState.text.trimEnd(),
            time: { start: reasoningState.startedAt, end: Date.now() },
          },
        });
      }
      state.reasoning.clear();

      for (const [toolCallId, toolState] of state.tools.entries()) {
        await publish(MessagePartUpdated, {
          part: {
            id: toolState.id,
            sessionID: sessionId,
            messageID: messageId,
            type: "tool",
            callID: toolCallId,
            tool: toolState.tool,
            state: {
              status: "error",
              input: toolState.input,
              error: "Tool execution aborted",
              time: { start: toolState.startedAt, end: Date.now() },
            },
          },
        });
      }
      state.tools.clear();

      // Publish session status update
      await publish(SessionStatus, {
        sessionID: sessionId,
        status: { type: "idle" },
      });

      assistantInfo.finish = String(event.finishReason ?? "stop");
      assistantInfo.time.completed = Date.now();

      // Publish message updated event
      await publish(MessageUpdated, {
        info: cloneAssistantInfo(assistantInfo),
      });
      break;
    }
  }
}

/**
 * Chat endpoint
 *
 * Accepts chat messages and streams AI responses using UIMessage format.
 * Uses SessionManager and SessionController for simplified agent orchestration.
 * Supports multimodal (image) inputs that trigger vision model routing.
 *
 * Usage:
 * POST /api/chat
 * Headers:
 *   - X-Session-ID: <session-id> (optional, will be created if missing)
 * Query:
 *   - directory: <absolute path> (preferred workspace selector)
 *   - Content-Type: application/json
 * Body (simple text):
 *   {
 *     "message": "Create a function that adds two numbers",
 *     "stream": true
 *   }
 * Body (with image):
 *   {
 *     "message": {
 *       "content": [
 *         { "type": "text", "text": "What does this image show?" },
 *         { "type": "image", "image": { "url": "https://example.com/image.jpg" } }
 *       ]
 *     },
 *     "stream": true
 *   }
 * Body (base64 image):
 *   {
 *     "message": {
 *       "content": [
 *         { "type": "text", "text": "Analyze this screenshot" },
 *         { "type": "file", "mediaType": "image/png", "data": "base64..." }
 *       ]
 *     }
 *   }
 */
app.post("/api/chat", async c => {
  const requestId = c.get("requestId");
  const session = c.get("session");
  const sessionIsNew = c.get("sessionIsNew") ?? false;
  const instanceContext = c.get("instanceContext");

  if (!session) {
    return c.json({ error: "Session not available" }, 500);
  }

  const body = await c.req.json();
  const rawMessage = body.message;
  const clientMessageId =
    typeof body.messageId === "string" && body.messageId.length > 0 ? body.messageId : undefined;
  const retryOfAssistantMessageId =
    typeof body.retryOfAssistantMessageId === "string" && body.retryOfAssistantMessageId.length > 0
      ? body.retryOfAssistantMessageId
      : undefined;
  const shouldStream = body.stream !== false;
  const selection = resolveChatSelection({
    providerId: body.providerId,
    modelId: body.modelId,
  });

  // Parse message - support both simple string and multimodal formats
  let messageText = "";
  if (typeof rawMessage === "string") {
    messageText = rawMessage;
  } else if (rawMessage && typeof rawMessage === "object" && "content" in rawMessage) {
    // Multimodal message with content parts
    const content = (rawMessage as { content: unknown }).content;
    if (Array.isArray(content)) {
      // Extract text from multimodal message for logging
      messageText = content
        .filter((part: { type: string; [key: string]: unknown }) => part.type === "text")
        .map((part: { type: string; [key: string]: unknown }) => {
          const textPart = part as { text?: string };
          return String(textPart.text ?? "");
        })
        .join(" ");
    } else {
      messageText = String(content);
    }
  } else {
    messageText = String(rawMessage ?? "");
  }

  let retryUserMessageId: string | undefined;
  if (retryOfAssistantMessageId) {
    const sessionMessages = getSessionMessages(session.sessionId);
    const retryAssistant = sessionMessages.find(
      message => message.info.id === retryOfAssistantMessageId
    );
    if (!retryAssistant || retryAssistant.info.role !== "assistant") {
      return c.json(
        { error: `Retry target assistant message not found: ${retryOfAssistantMessageId}` },
        400
      );
    }

    const parentID =
      "parentID" in retryAssistant.info &&
      typeof (retryAssistant.info as { parentID?: unknown }).parentID === "string"
        ? ((retryAssistant.info as { parentID?: string }).parentID ?? undefined)
        : undefined;
    if (!parentID) {
      return c.json(
        {
          error: `Retry target assistant has no parent user message: ${retryOfAssistantMessageId}`,
        },
        400
      );
    }

    const parentUser = sessionMessages.find(message => message.info.id === parentID);
    if (!parentUser || parentUser.info.role !== "user") {
      return c.json(
        { error: `Retry target parent user message not found: ${retryOfAssistantMessageId}` },
        400
      );
    }

    retryUserMessageId = parentID;
    const userText = parentUser.parts
      .filter(part => part.type === "text")
      .map(part => {
        const candidate = part as { text?: unknown };
        return typeof candidate.text === "string" ? candidate.text : "";
      })
      .join("")
      .trim();
    if (!messageText.trim() && userText) {
      messageText = userText;
    }
    if (!messageText.trim()) {
      return c.json(
        { error: `Retry target has no retryable user text: ${retryOfAssistantMessageId}` },
        400
      );
    }
  }

  logger.info("Chat request received", {
    module: "chat",
    requestId,
    sessionId: session.sessionId,
    messageLength: messageText.length,
    hasMultimodal: typeof rawMessage === "object" && "content" in rawMessage,
  });

  // Get workspace directory from Instance context
  const directory = instanceContext?.directory;
  if (!directory) {
    return c.json({ error: "No workspace directory" }, 400);
  }

  const providerRuntime = getProviderRuntime();
  const provider = providerRuntime.registry.adapters.get(selection.providerId);
  if (!provider) {
    const normalized = normalizeProviderError(
      new Error(`Unknown provider: ${selection.providerId}`)
    );
    return c.json(normalized, normalized.status);
  }

  const authState = await providerRuntime.authService.getState(selection.providerId);
  const hasEnvCredential = hasProviderEnvironmentCredential(selection.providerId);
  const storedCredential = await providerRuntime.authService.getCredential(selection.providerId);
  if (
    selection.explicit &&
    authState.status !== "connected" &&
    !hasEnvCredential &&
    !storedCredential
  ) {
    const normalized = normalizeProviderError(
      new Error(`Provider ${selection.providerId} is not authenticated`)
    );
    return c.json(normalized, normalized.status);
  }

  logger.debug("Getting or creating session controller", {
    module: "chat",
    directory,
    sessionId: session.sessionId,
  });

  // Get SessionManager and retrieve or create SessionController
  const sessionManager = getSessionManager();
  let controller = await sessionManager.getSession(session.sessionId);

  if (!controller) {
    // Create new SessionController for this session
    await sessionManager.createSession({
      resourceId: session.resourceId,
      task: messageText || "[Multimodal message]",
      workspace: directory,
    });

    // Get the newly created controller
    controller = await sessionManager.getSession(session.sessionId);

    if (!controller) {
      return c.json({ error: "Failed to create session controller" }, 500);
    }

    logger.debug("Created new session controller", {
      module: "chat",
      sessionId: session.sessionId,
      controllerId: controller.sessionId,
    });
  }

  // Create UIMessage stream
  if (shouldStream) {
    logger.info("Creating UIMessage stream", {
      module: "chat",
      sessionId: session.sessionId,
      messageId: session.sessionId,
    });

    const stream = createUIMessageStream({
      execute: async ({ writer }) => {
        logger.info("Stream execute started", {
          module: "chat",
          sessionId: session.sessionId,
        });
        const logChatStreamEvents = process.env.EKACODE_LOG_CHAT_STREAM_EVENTS === "true";
        const writeStreamEvent = (event: Parameters<typeof writer.write>[0]) => {
          writer.write(event);

          if (!logChatStreamEvents || typeof event !== "object" || event === null) {
            return;
          }

          const typed = event as Record<string, unknown>;
          const streamEventType = typeof typed.type === "string" ? typed.type : "unknown";
          const streamEventId = typeof typed.id === "string" ? typed.id : undefined;
          const finishReason =
            typeof typed.finishReason === "string" ? typed.finishReason : undefined;
          const delta = typeof typed.delta === "string" ? typed.delta : undefined;
          const errorText =
            typeof typed.errorText === "string"
              ? typed.errorText
              : typeof typed.error === "string"
                ? typed.error
                : undefined;

          logger.debug("stream event", {
            module: "chat",
            sessionId: session.sessionId,
            streamEventType,
            streamEventId,
            finishReason,
            delta,
            data: typed.data,
            errorText,
          });
        };

        // Send session message if new session
        if (sessionIsNew) {
          logger.info("Sending session message", { module: "chat", sessionId: session.sessionId });
          writeStreamEvent(createSessionMessage(session));
        }

        const messageId = uuidv7();
        const userMessageId = retryUserMessageId ?? clientMessageId ?? uuidv7();
        let hasTextDeltas = false;
        const partPublishState = createPartPublishState();
        const userCreatedAt = Date.now();
        const assistantInfo: AssistantInfoPayload = {
          role: "assistant",
          id: messageId,
          sessionID: session.sessionId,
          parentID: userMessageId,
          modelID: selection.modelId,
          providerID: selection.providerId,
          time: {
            created: Date.now(),
          },
          cost: 0,
          tokens: {
            input: 0,
            output: 0,
            reasoning: 0,
            cache: {
              read: 0,
              write: 0,
            },
          },
        };

        // Publish canonical user message/part first (opencode parity)
        if (!retryOfAssistantMessageId) {
          await publish(MessageUpdated, {
            info: {
              role: "user",
              id: userMessageId,
              sessionID: session.sessionId,
              time: {
                created: userCreatedAt,
              },
            },
          });
          await publish(MessagePartUpdated, {
            part: {
              id: `${userMessageId}-text`,
              sessionID: session.sessionId,
              messageID: userMessageId,
              type: "text",
              text: messageText,
              time: {
                start: userCreatedAt,
                end: userCreatedAt,
              },
            },
          });
        }
        await publish(MessageUpdated, {
          info: cloneAssistantInfo(assistantInfo),
        });

        // Check if selected provider is configured
        if (!hasEnvCredential && !storedCredential) {
          logger.error("No AI provider configured", undefined, {
            module: "chat",
            sessionId: session.sessionId,
          });
          writeStreamEvent({
            type: "error",
            errorText: `Provider ${selection.providerId} is not configured. Connect it in Settings or set environment credentials.`,
          });
          writeStreamEvent({
            type: "finish",
            finishReason: "error",
          });
          return;
        }

        logger.info("Starting agent execution", {
          module: "chat",
          sessionId: session.sessionId,
          messageId,
          task: messageText,
        });

        try {
          // Initialize mode state for Antigravity UI
          const modeState: ModeState = {
            mode: "chat",
            runId: null,
            hasToolCalls: false,
            hasReasoning: false,
            reasoningTexts: new Map(),
            runCardData: null,
            runGroupData: null,
            toolCallTimestamps: new Map(),
          };
          let partPublishQueue: Promise<void> = Promise.resolve();
          const queuePartEvent = (event: { type: string; [key: string]: unknown }) => {
            partPublishQueue = partPublishQueue
              .then(() =>
                publishPartEvent(
                  session.sessionId,
                  messageId,
                  partPublishState,
                  assistantInfo,
                  event
                )
              )
              .catch(error => {
                logger.error("Failed to publish part event", error as Error, {
                  module: "chat",
                  sessionId: session.sessionId,
                  eventType: event.type,
                });
              });
          };

          // Send initial state update
          writeStreamEvent({
            type: "data-state",
            id: "state",
            data: {
              state: "running",
              iteration: 0,
              toolExecutionCount: 0,
            },
          });

          // Helper function to detect agent mode based on events
          const detectMode = (state: ModeState, eventType: string): AgentMode => {
            // Planning mode: reasoning without tool execution
            if (eventType === "reasoning-start" && !state.hasToolCalls) {
              return "planning";
            }

            // Build mode: tool execution detected
            if (eventType === "tool-call") {
              return "build";
            }

            // Chat mode: simple text response (default)
            return state.mode || "chat";
          };

          // Helper function to create AgentEvent from tool call
          const createAgentEvent = (
            event: { toolCallId: string; toolName: string; args: unknown },
            agentId?: string
          ): AgentEvent => {
            const args = (event.args as Record<string, unknown>) || {};
            const kind = mapToolToKind(event.toolName);
            const title = formatToolTitle(event.toolName, args);
            const subtitle = formatToolSubtitle(event.toolName, args);

            const agentEvent: AgentEvent = {
              id: event.toolCallId,
              ts: Date.now(),
              kind,
              title,
              subtitle,
              toolCallId: event.toolCallId,
              agentId,
            };

            // Add file info for file-related events
            if (event.toolName.includes("file") && args.TargetFile) {
              agentEvent.file = {
                path: args.TargetFile as string,
              };
            } else if (event.toolName === "view_file" && args.AbsolutePath) {
              agentEvent.file = {
                path: args.AbsolutePath as string,
              };
            }

            // Add terminal info for shell events
            if (event.toolName === "run_command") {
              agentEvent.terminal = {
                command: (args.CommandLine as string) || "",
                cwd: (args.Cwd as string) || undefined,
                outputPreview: "",
              };
            }

            // Add actions for user interaction
            agentEvent.actions = createToolActions(event.toolName, args);

            return agentEvent;
          };

          // Publish session busy status
          await publish(SessionStatus, {
            sessionID: session.sessionId,
            status: { type: "busy" },
          });

          const processAgentMessage = () =>
            controller.processMessage(messageText, {
              onEvent: event => {
                // Publish Opencode-style part event to Bus (for SSE streaming)
                queuePartEvent(event);

                // Forward agent events to the stream
                logger.debug("Agent event received", {
                  module: "chat",
                  sessionId: session.sessionId,
                  eventType: event.type,
                });

                // Update mode detection
                const newMode = detectMode(modeState, event.type);
                if (newMode !== modeState.mode) {
                  const previousMode = modeState.mode;
                  modeState.mode = newMode;
                  logger.info(`Mode transition: ${previousMode} → ${newMode}`, {
                    module: "chat",
                    sessionId: session.sessionId,
                  });

                  // Initialize run card if entering planning mode
                  if (newMode === "planning" && !modeState.runId) {
                    modeState.runId = uuidv7();
                    const groupId = `${modeState.runId}-group-1`;
                    modeState.runCardData = {
                      runId: modeState.runId,
                      title: "Planning Session",
                      status: "planning",
                      subtitle: messageText.slice(0, 100),
                      filesEditedOrder: [],
                      groupsOrder: [groupId],
                      startedAt: Date.now(),
                    };
                    modeState.runGroupData = {
                      id: groupId,
                      index: 1,
                      title: "Progress Updates",
                      collapsed: false,
                      itemsOrder: [],
                    };

                    writeStreamEvent({
                      type: "data-run",
                      id: modeState.runId,
                      data: modeState.runCardData,
                    } as unknown as Parameters<typeof writer.write>[0]);

                    writeStreamEvent({
                      type: "data-run-group",
                      id: groupId,
                      data: modeState.runGroupData,
                    } as unknown as Parameters<typeof writer.write>[0]);
                  }

                  // Send mode change metadata (after runId init when planning)
                  writeStreamEvent({
                    type: "data-mode-metadata",
                    id: messageId,
                    data: {
                      mode: newMode,
                      runId: modeState.runId,
                      startedAt: Date.now(),
                    },
                  } as unknown as Parameters<typeof writer.write>[0]);
                }

                // Handle text content from agent
                if (event.type === "text") {
                  hasTextDeltas = true;
                  writeStreamEvent({
                    type: "text-delta",
                    id: messageId,
                    delta: event.text,
                  } as TextDeltaEvent);
                }

                // Handle reasoning events → data-thought
                if (event.type === "reasoning-start") {
                  modeState.hasReasoning = true;
                  const reasoningId = event.reasoningId as string;
                  modeState.reasoningTexts.set(reasoningId, "");

                  writeStreamEvent({
                    type: "data-thought",
                    id: reasoningId,
                    data: {
                      id: reasoningId,
                      status: "thinking",
                      text: "",
                      agentId: event.agentId as string | undefined,
                    },
                  } as unknown as Parameters<typeof writer.write>[0]);
                }

                if (event.type === "reasoning-delta") {
                  const reasoningId = event.reasoningId as string;
                  const currentText = modeState.reasoningTexts.get(reasoningId) || "";
                  const newText = currentText + (event.text as string);
                  modeState.reasoningTexts.set(reasoningId, newText);

                  writeStreamEvent({
                    type: "data-thought",
                    id: reasoningId,
                    data: {
                      id: reasoningId,
                      status: "thinking",
                      text: newText,
                      agentId: event.agentId as string | undefined,
                    },
                  } as unknown as Parameters<typeof writer.write>[0]);
                }

                if (event.type === "reasoning-end") {
                  const reasoningId = event.reasoningId as string;
                  modeState.reasoningTexts.delete(reasoningId);

                  writeStreamEvent({
                    type: "data-thought",
                    id: reasoningId,
                    data: {
                      id: reasoningId,
                      status: "complete",
                      durationMs: event.durationMs as number,
                      agentId: event.agentId,
                    },
                  } as unknown as Parameters<typeof writer.write>[0]);
                }

                // Handle tool-call events → data-action (build mode)
                if (event.type === "tool-call") {
                  modeState.hasToolCalls = true;

                  logger.info(`Tool call: ${event.toolName}`, {
                    module: "chat",
                    sessionId: session.sessionId,
                    toolName: event.toolName,
                    toolCallId: event.toolCallId,
                  });

                  // Send tool call as data-tool-call event
                  writeStreamEvent({
                    type: "data-tool-call",
                    id: event.toolCallId as string,
                    data: {
                      toolCallId: event.toolCallId as string,
                      toolName: event.toolName as string,
                      args: event.args,
                    },
                  } as unknown as Parameters<typeof writer.write>[0]);

                  // Create and send AgentEvent as data-action
                  const agentEvent = createAgentEvent(
                    {
                      toolCallId: event.toolCallId as string,
                      toolName: event.toolName as string,
                      args: event.args,
                    },
                    event.agentId as string | undefined
                  );
                  modeState.toolCallTimestamps.set(agentEvent.id, agentEvent.ts);
                  writeStreamEvent({
                    type: "data-action",
                    id: agentEvent.id,
                    data: agentEvent,
                  } as unknown as Parameters<typeof writer.write>[0]);

                  // Also emit as data-run-item for planning mode
                  if (modeState.mode === "planning" && modeState.runId) {
                    writeStreamEvent({
                      type: "data-run-item",
                      id: agentEvent.id,
                      data: agentEvent,
                    } as unknown as Parameters<typeof writer.write>[0]);

                    // Update run card with file info if applicable
                    if (agentEvent.file?.path && modeState.runCardData) {
                      if (!modeState.runCardData.filesEditedOrder.includes(agentEvent.file.path)) {
                        modeState.runCardData.filesEditedOrder.push(agentEvent.file.path);
                        writeStreamEvent({
                          type: "data-run",
                          id: modeState.runId,
                          data: modeState.runCardData,
                        } as unknown as Parameters<typeof writer.write>[0]);

                        const runFile: RunFileData = {
                          path: agentEvent.file.path,
                          cta: agentEvent.diff ? "open-diff" : "open",
                          diff: agentEvent.diff,
                        };
                        writeStreamEvent({
                          type: "data-run-file",
                          id: agentEvent.file.path,
                          data: runFile,
                        } as unknown as Parameters<typeof writer.write>[0]);
                      }
                    }

                    if (modeState.runGroupData) {
                      if (!modeState.runGroupData.itemsOrder.includes(agentEvent.id)) {
                        modeState.runGroupData.itemsOrder.push(agentEvent.id);
                        writeStreamEvent({
                          type: "data-run-group",
                          id: modeState.runGroupData.id,
                          data: modeState.runGroupData,
                        } as unknown as Parameters<typeof writer.write>[0]);
                      }
                    }
                  }
                }

                // Handle tool-result events → update action
                if (event.type === "tool-result") {
                  logger.info(`Tool result: ${event.toolName}`, {
                    module: "chat",
                    sessionId: session.sessionId,
                    toolName: event.toolName,
                    toolCallId: event.toolCallId,
                  });

                  // Send tool result as data-tool-result event
                  writeStreamEvent({
                    type: "data-tool-result",
                    id: event.toolCallId as string,
                    data: {
                      toolCallId: event.toolCallId as string,
                      result: event.result,
                    },
                  } as unknown as Parameters<typeof writer.write>[0]);

                  // Update action with result info
                  const resultText =
                    typeof event.result === "string" ? event.result : JSON.stringify(event.result);
                  const originalTs =
                    modeState.toolCallTimestamps.get(event.toolCallId as string) ?? Date.now();
                  writeStreamEvent({
                    type: "data-action",
                    id: event.toolCallId as string,
                    data: {
                      id: event.toolCallId as string,
                      ts: originalTs,
                      kind: "tool",
                      title: `${event.toolName as string} completed`,
                      subtitle: resultText.slice(0, 100),
                      toolCallId: event.toolCallId as string,
                      agentId: event.agentId as string | undefined,
                    },
                  } as unknown as Parameters<typeof writer.write>[0]);
                  modeState.toolCallTimestamps.delete(event.toolCallId as string);
                }

                // Handle finish events
                if (event.type === "retry") {
                  const attempt =
                    typeof event.attempt === "number" && Number.isFinite(event.attempt)
                      ? event.attempt
                      : 1;
                  const message =
                    typeof event.message === "string" && event.message.length > 0
                      ? event.message
                      : "Retrying";
                  const next =
                    typeof event.next === "number" && Number.isFinite(event.next)
                      ? event.next
                      : Date.now();
                  void publish(SessionStatus, {
                    sessionID: session.sessionId,
                    status: {
                      type: "retry",
                      attempt,
                      message,
                      next,
                    },
                  });
                }

                // Handle finish events
                if (event.type === "finish") {
                  logger.debug(`Agent finish: ${event.finishReason}`, {
                    module: "chat",
                    sessionId: session.sessionId,
                    finishReason: event.finishReason,
                  });

                  // Update run card status if in planning mode
                  if (modeState.mode === "planning" && modeState.runCardData) {
                    modeState.runCardData.status = "done";
                    modeState.runCardData.finishedAt = Date.now();
                    if (modeState.runCardData.startedAt) {
                      modeState.runCardData.elapsedMs =
                        Date.now() - modeState.runCardData.startedAt;
                    }
                    writeStreamEvent({
                      type: "data-run",
                      id: modeState.runId,
                      data: modeState.runCardData,
                    } as unknown as Parameters<typeof writer.write>[0]);
                  }
                }
              },
            });

          // Process the message with agent and stream events
          const result = await (async () => {
            if (hasEnvCredential || !storedCredential) {
              return processAgentMessage();
            }

            const envVar = providerCredentialEnvVar(selection.providerId);
            const token =
              storedCredential.kind === "oauth"
                ? await resolveOAuthAccessToken(selection.providerId, providerRuntime.authService)
                : storedCredential.token;
            if (!envVar || !token) {
              return processAgentMessage();
            }

            const previous = process.env[envVar];
            process.env[envVar] = token;
            try {
              return await processAgentMessage();
            } finally {
              if (previous === undefined) delete process.env[envVar];
              else process.env[envVar] = previous;
            }
          })();
          await partPublishQueue;

          if (result.status === "failed") {
            logger.error("Agent execution failed", undefined, {
              module: "chat",
              sessionId: session.sessionId,
              messageId,
              error: result.error,
              hasContent: !!result.finalContent,
            });
          } else {
            logger.info("Agent execution completed", {
              module: "chat",
              sessionId: session.sessionId,
              status: result.status,
              hasContent: !!result.finalContent,
            });
          }

          // Send final content if available
          if (!hasTextDeltas && typeof result.finalContent === "string") {
            writeStreamEvent({
              type: "text-delta",
              id: messageId,
              delta: result.finalContent,
            });
          }

          // Send final status message
          writeStreamEvent({
            type: "data-state",
            id: "state",
            data: {
              state: result.status === "completed" ? "completed" : "failed",
              iteration: 0,
              toolExecutionCount: 0,
            },
          });

          // Send finish message
          writeStreamEvent({
            type: "finish",
            finishReason: result.status === "completed" ? "stop" : "error",
          });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);

          logger.error("Agent execution error", error instanceof Error ? error : undefined, {
            sessionId: session.sessionId,
            error: errorMessage,
          });

          writeStreamEvent({
            type: "error",
            errorText: errorMessage,
          });

          const errorPartID = uuidv7();
          await publish(MessagePartUpdated, {
            part: {
              id: errorPartID,
              sessionID: session.sessionId,
              messageID: messageId,
              type: "error",
              message: errorMessage,
            },
          });

          await publishPartEvent(session.sessionId, messageId, partPublishState, assistantInfo, {
            type: "finish",
            finishReason: "error",
          });

          writeStreamEvent({
            type: "finish",
            finishReason: "error",
          });
        }
      },
    });

    return createUIMessageStreamResponse({
      stream,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "x-vercel-ai-ui-message-stream": "v1",
        "Content-Encoding": "none",
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers":
          "Content-Type, Authorization, X-Session-ID, X-Workspace, X-Directory",
      },
    });
  } else {
    // Non-streaming mode (for simple requests)
    return c.json({
      sessionId: session.sessionId,
      message: "Streaming is required for agent responses",
    });
  }
});

/**
 * Get session info endpoint
 *
 * Returns the current session information.
 *
 * Usage:
 * GET /api/chat/session
 */
app.get("/api/chat/session", c => {
  const session = c.get("session");

  if (!session) {
    return c.json({ error: "Session not available" }, 500);
  }

  return c.json({
    sessionId: session.sessionId,
    resourceId: session.resourceId,
    threadId: session.threadId,
    createdAt: session.createdAt.toISOString(),
    lastAccessed: session.lastAccessed.toISOString(),
  });
});

/**
 * Get session status endpoint
 *
 * Returns the current status of a session including phase and progress.
 * Used by UI to show hints about incomplete work.
 *
 * Usage:
 * GET /api/session/:sessionId/status
 */
app.get("/api/session/:sessionId/status", async c => {
  const sessionId = c.req.param("sessionId");
  const sessionManager = getSessionManager();

  const controller = await sessionManager.getSession(sessionId);

  if (!controller) {
    return c.json({ error: "Session not found" }, 404);
  }

  const status = controller.getStatus();

  return c.json({
    sessionId: status.sessionId,
    phase: status.phase,
    progress: status.progress,
    hasIncompleteWork: controller.hasIncompleteWork(),
    summary: status.summary,
    lastActivity: status.lastActivity,
    activeAgents: status.activeAgents,
  });
});

export default app;
