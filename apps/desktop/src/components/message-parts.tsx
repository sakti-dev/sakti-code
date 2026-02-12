/**
 * MessageParts - Parts-based rendering for UIMessage
 *
 * Renders message.parts array using <For> + <Switch> pattern.
 * Handles text, tool-call, tool-result, and custom data parts.
 *
 * This is the correct approach per AI SDK's UIMessage protocol:
 * - Render parts[], not content
 * - Each part type has its own component
 * - Custom data-* parts for RLM state, progress, etc.
 */
import { Markdown } from "@/components/shared/markdown";
import type {
  ProgressData,
  RLMStateData,
  ToolCallPartData,
  ToolResultPartData,
} from "@/core/chat/types/ui-message";
import { cn } from "@/utils";
import { Component, For, Match, Show, Switch, createSignal } from "solid-js";

/**
 * A generic message part type matching AI SDK's structure
 */
type MessagePart = {
  type: string;
  text?: string;
  toolCallId?: string;
  toolName?: string;
  args?: unknown;
  result?: unknown;
  error?: string;
  id?: string;
  data?: unknown;
  transient?: boolean;
};

function truncateText(value: string, maxLines = 8, maxChars = 1200): string {
  let text = value;
  if (text.length > maxChars) {
    text = `${text.slice(0, maxChars)}…`;
  }
  const lines = text.split("\n");
  if (lines.length > maxLines) {
    return `${lines.slice(0, maxLines).join("\n")}\n…`;
  }
  return text;
}

function formatArgsList(args?: Record<string, unknown>): Array<{ key: string; value: string }> {
  if (!args) return [];
  const entries = Object.entries(args).map(([key, value]) => ({
    key,
    value: formatValue(value),
  }));
  const order = ["dirPath", "filePath", "path", "query", "command", "cmd", "pattern"];
  return entries.sort((a, b) => {
    const ai = order.indexOf(a.key);
    const bi = order.indexOf(b.key);
    if (ai === -1 && bi === -1) return a.key.localeCompare(b.key);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
}

function formatValue(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `${value.length} items`;
  if (typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>);
    return keys.length
      ? `object (${keys.slice(0, 4).join(", ")}${keys.length > 4 ? ", …" : ""})`
      : "object";
  }
  return String(value);
}

function formatResultDisplay(result: unknown): { label: string; text?: string; meta?: string[] } {
  if (result === null || result === undefined) {
    return { label: "Result", text: "No output" };
  }
  if (typeof result === "string") {
    return { label: "Output", text: truncateText(result) };
  }
  if (typeof result === "object") {
    const obj = result as Record<string, unknown>;
    if (typeof obj.output === "string") {
      return { label: "Output", text: truncateText(obj.output) };
    }
    if (typeof obj.content === "string") {
      return { label: "Content", text: truncateText(obj.content) };
    }
    if (typeof obj.text === "string") {
      return { label: "Text", text: truncateText(obj.text) };
    }
    if (typeof obj.message === "string") {
      return { label: "Message", text: truncateText(obj.message) };
    }
    const meta: string[] = [];
    if (typeof obj.count === "number") meta.push(`count: ${obj.count}`);
    if (typeof obj.truncated === "boolean") meta.push(`truncated: ${obj.truncated ? "yes" : "no"}`);
    if (Array.isArray(obj.items)) meta.push(`items: ${obj.items.length}`);
    return { label: "Result", meta: meta.length ? meta : ["Result received"] };
  }
  return { label: "Result", text: truncateText(String(result)) };
}

interface MessagePartsProps {
  /** Array of message parts to render */
  parts: readonly MessagePart[];
  /** Additional CSS classes */
  class?: string;
}

/**
 * MessageParts - Main component for rendering parts array
 *
 * @example
 * ```tsx
 * <MessageParts parts={message.parts} />
 * ```
 */
export const MessageParts: Component<MessagePartsProps> = props => {
  return (
    <div class={cn("message-parts space-y-2", props.class)}>
      <For each={props.parts}>
        {part => (
          <Switch fallback={<UnknownPart part={part} />}>
            <Match when={part.type === "text"}>
              <TextPart text={(part as { text: string }).text} />
            </Match>
            <Match when={part.type === "tool-call"}>
              <ToolCallPart part={part as unknown as ToolCallPartData} />
            </Match>
            <Match when={part.type === "tool-result"}>
              <ToolResultPart part={part as unknown as ToolResultPartData} />
            </Match>
            <Match when={part.type === "data-rlm-state"}>
              <RLMStatePart data={part.data as RLMStateData} transient={part.transient} />
            </Match>
            <Match when={part.type === "data-progress"}>
              <ProgressPart data={part.data as ProgressData} />
            </Match>
            <Match when={part.type.startsWith("data-")}>
              {/* Data parts are handled by mode-specific components (RunCard, ActivityFeed) */}
              {/* Don't render them inline to avoid duplication */}
              {null}
            </Match>
          </Switch>
        )}
      </For>
    </div>
  );
};

/**
 * TextPart - Render text content with whitespace preservation
 */
interface TextPartProps {
  text: string;
  class?: string;
}

export const TextPart: Component<TextPartProps> = props => {
  return <Markdown text={props.text} class={cn("text-part prose-p:m-0", props.class)} />;
};

/**
 * ToolCallPart - Display tool execution with status and streaming args
 */
interface ToolCallPartProps {
  part: ToolCallPartData;
  class?: string;
}

export const ToolCallPart: Component<ToolCallPartProps> = props => {
  const [isExpanded, setIsExpanded] = createSignal(false);
  const result = () =>
    (props.part as ToolCallPartData & { result?: unknown; error?: string }).result;
  const error = () => (props.part as ToolCallPartData & { result?: unknown; error?: string }).error;
  const argsList = () => formatArgsList(props.part.args);

  // Determine status based on presence of args
  const status = () => {
    if (props.part.status) return props.part.status;
    // Infer from args: empty = pending, non-empty = executing
    const args = props.part.args as Record<string, unknown> | undefined;
    return args && Object.keys(args).length > 0 ? "executing" : "pending";
  };

  const statusConfig = () => {
    switch (status()) {
      case "pending":
        return {
          icon: "clock",
          color: "text-muted-foreground/50",
          borderColor: "border-muted",
          label: "Pending",
        };
      case "executing":
        return {
          icon: "spinner",
          color: "text-primary",
          borderColor: "border-primary/50",
          label: "Executing",
        };
      case "completed":
        return {
          icon: "check",
          color: "text-green-500",
          borderColor: "border-green-500/50",
          label: "Completed",
        };
      case "failed":
        return {
          icon: "x",
          color: "text-destructive",
          borderColor: "border-destructive/50",
          label: "Failed",
        };
      default:
        return {
          icon: "help",
          color: "text-muted-foreground/50",
          borderColor: "border-muted",
          label: "Unknown",
        };
    }
  };

  const config = statusConfig();

  return (
    <div
      class={cn(
        "tool-call-part my-2 rounded-lg border-l-4 py-2 pl-4",
        "bg-card/30",
        config.borderColor,
        props.class
      )}
    >
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded())}
        class="flex w-full items-center gap-2 text-left"
      >
        {/* Status icon */}
        <span class={config.color}>
          {config.icon === "spinner" ? (
            <svg class="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle
                class="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                stroke-width="4"
              />
              <path
                class="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
          ) : config.icon === "check" ? (
            <svg class="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" />
            </svg>
          ) : config.icon === "x" ? (
            <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          ) : (
            <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width={2}
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          )}
        </span>

        {/* Tool name */}
        <span class="bg-primary/10 rounded px-2 py-0.5 font-mono text-xs">
          {props.part.toolName}
        </span>

        {/* Status label */}
        <span class="text-muted-foreground text-xs">{config.label}</span>

        {/* Expand indicator */}
        <svg
          class={cn(
            "text-muted-foreground ml-auto h-4 w-4 transition-transform",
            isExpanded() && "rotate-180"
          )}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      {/* Arguments + Result (expandable) */}
      <Show when={isExpanded()}>
        <Show when={argsList().length > 0}>
          <div class="mt-2 space-y-1 text-xs">
            <div class="text-muted-foreground font-medium">Arguments</div>
            <For each={argsList()}>
              {item => (
                <div class="flex gap-2">
                  <span class="text-muted-foreground/80 min-w-[84px]">{item.key}</span>
                  <span class="text-foreground/80 break-all">{item.value}</span>
                </div>
              )}
            </For>
          </div>
        </Show>

        <Show when={error()}>
          <div class="mt-3">
            <div class="text-destructive text-xs font-medium">Error</div>
            <div class="text-destructive/90 mt-1 text-xs">{error()}</div>
          </div>
        </Show>

        <Show when={!error() && result() !== undefined}>
          {(() => {
            const display = formatResultDisplay(result());
            return (
              <div class="mt-3">
                <div class="text-muted-foreground text-xs font-medium">{display.label}</div>
                <Show when={display.text}>
                  <pre class="mt-1 max-h-60 overflow-x-auto rounded bg-green-500/10 p-2 text-xs">
                    {display.text}
                  </pre>
                </Show>
                <Show when={!display.text && display.meta?.length}>
                  <div class="text-muted-foreground mt-1 text-xs">{display.meta!.join(" • ")}</div>
                </Show>
              </div>
            );
          })()}
        </Show>
      </Show>
    </div>
  );
};

/**
 * ToolResultPart - Display tool execution result
 */
interface ToolResultPartProps {
  part: ToolResultPartData;
  class?: string;
}

export const ToolResultPart: Component<ToolResultPartProps> = props => {
  const [isExpanded, setIsExpanded] = createSignal(false);
  const hasError = () => !!props.part.error;
  const display = () => formatResultDisplay(props.part.result);

  return (
    <div
      class={cn(
        "tool-result-part my-2 rounded-lg border-l-4 py-2 pl-4",
        hasError()
          ? "border-destructive/50 bg-destructive/5"
          : "border-green-500/50 bg-green-500/5",
        props.class
      )}
    >
      {/* Error display */}
      <Show when={hasError()}>
        <div class="text-destructive flex items-center gap-2">
          <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width={2}
              d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <span class="text-sm font-medium">Error</span>
        </div>
        <pre class="text-destructive bg-destructive/10 mt-2 overflow-x-auto rounded p-2 text-xs">
          {props.part.error}
        </pre>
      </Show>

      {/* Result display */}
      <Show when={!hasError() && props.part.result !== undefined}>
        <button
          onClick={() => setIsExpanded(!isExpanded())}
          class="flex w-full items-center gap-2 text-left text-green-600 dark:text-green-400"
        >
          <svg class="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
            <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" />
          </svg>
          <span class="text-sm font-medium">Result</span>
          <svg
            class={cn("ml-auto h-4 w-4 transition-transform", isExpanded() && "rotate-180")}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width={2}
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </button>

        <Show when={isExpanded()}>
          <Show when={display().text}>
            <pre class="mt-2 max-h-60 overflow-x-auto rounded bg-green-500/10 p-2 text-xs">
              {display().text}
            </pre>
          </Show>
          <Show when={!display().text && display().meta?.length}>
            <div class="text-muted-foreground mt-2 text-xs">{display().meta!.join(" • ")}</div>
          </Show>
        </Show>
      </Show>
    </div>
  );
};

/**
 * RLMStatePart - Display current RLM workflow state (transient)
 */
interface RLMStatePartProps {
  data: RLMStateData;
  transient?: boolean;
  class?: string;
}

export const RLMStatePart: Component<RLMStatePartProps> = props => {
  // Don't render if transient is true (status updates only)
  if (props.transient) return null;

  const phaseConfig = () => {
    switch (props.data.phase) {
      case "explore":
        return { color: "text-blue-500", label: "Exploring" };
      case "plan":
        return { color: "text-amber-500", label: "Planning" };
      case "build":
        return { color: "text-green-500", label: "Building" };
      case "completed":
        return { color: "text-green-600", label: "Completed" };
      case "failed":
        return { color: "text-destructive", label: "Failed" };
      default:
        return { color: "text-muted-foreground", label: "Processing" };
    }
  };

  const config = phaseConfig();

  return (
    <div class={cn("rlm-state-part flex items-center gap-2 py-1", props.class)}>
      {/* Phase indicator */}
      <div class={cn("flex items-center gap-1.5", config.color)}>
        <div class="h-2 w-2 animate-pulse rounded-full bg-current" />
        <span class="text-xs font-medium">{config.label}</span>
      </div>

      {/* Step info */}
      <Show when={props.data.step}>
        <span class="text-muted-foreground text-xs">• {props.data.step}</span>
      </Show>

      {/* Progress bar */}
      <Show when={props.data.progress !== undefined}>
        <div class="ml-auto flex items-center gap-2">
          <div class="bg-muted h-1.5 w-20 overflow-hidden rounded-full">
            <div
              class="bg-primary h-full transition-all duration-300"
              style={{ width: `${(props.data.progress || 0) * 100}%` }}
            />
          </div>
          <span class="text-muted-foreground text-xs">
            {Math.round((props.data.progress || 0) * 100)}%
          </span>
        </div>
      </Show>
    </div>
  );
};

/**
 * ProgressPart - Display operation progress
 */
interface ProgressPartProps {
  data: ProgressData;
  class?: string;
}

export const ProgressPart: Component<ProgressPartProps> = props => {
  const percentage = () =>
    props.data.total > 0 ? (props.data.current / props.data.total) * 100 : 0;

  return (
    <div class={cn("progress-part py-2", props.class)}>
      <div class="mb-1 flex items-center justify-between text-xs">
        <span class="text-muted-foreground">{props.data.operation}</span>
        <span class="text-muted-foreground">
          {props.data.current}/{props.data.total}
        </span>
      </div>
      <div class="bg-muted h-1.5 overflow-hidden rounded-full">
        <div
          class="bg-primary h-full transition-all duration-300"
          style={{ width: `${percentage()}%` }}
        />
      </div>
      <Show when={props.data.message}>
        <p class="text-muted-foreground mt-1 text-xs">{props.data.message}</p>
      </Show>
    </div>
  );
};

/**
 * UnknownPart - Fallback for unrecognized part types
 */
interface UnknownPartProps {
  part: MessagePart;
  class?: string;
}

export const UnknownPart: Component<UnknownPartProps> = props => {
  // Don't render transient parts
  if (props.part.transient) return null;

  return (
    <div class={cn("unknown-part text-muted-foreground text-xs italic", props.class)}>
      Unknown part type: {props.part.type}
    </div>
  );
};

export default MessageParts;
