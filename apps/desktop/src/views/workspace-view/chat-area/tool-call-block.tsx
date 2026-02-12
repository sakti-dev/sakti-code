/**
 * ToolCallBlock - Display tool execution with status indicators
 *
 * Design Features:
 * - Collapsible using @kobalte/core
 * - Status-based color coding (pending/running/completed/failed)
 * - Animated spinner for running state
 * - Checkmark for completed
 * - X for failed
 * - Expandable arguments with JSON syntax highlighting
 * - Expandable result with truncation
 * - Copy button for args/results
 */

import { Collapsible } from "@/components/shared/collapsible";
import { Icon } from "@/components/shared/icon";
import type { ToolCall } from "@/core/chat/types";
import { cn } from "@/utils";
import { Component, Show, createSignal } from "solid-js";

interface ToolCallBlockProps {
  /** Tool call data */
  toolCall: ToolCall;
  /** Additional CSS classes */
  class?: string;
}

/**
 * Status configuration for tool calls
 */
function getStatusConfig(status: ToolCall["status"]) {
  switch (status) {
    case "pending":
      return {
        icon: "clock" as const,
        iconClass: "text-muted-foreground/50",
        bgClass: "bg-muted/20",
        borderClass: "border-muted/50",
        label: "Pending",
        labelClass: "text-muted-foreground/60",
      };
    case "running":
      return {
        icon: "spinner" as const,
        iconClass: "text-primary animate-spin",
        bgClass: "bg-primary/10",
        borderClass: "border-primary/50",
        label: "Running",
        labelClass: "text-primary/70",
      };
    case "completed":
      return {
        icon: "check" as const,
        iconClass: "text-green-500",
        bgClass: "bg-green-500/10",
        borderClass: "border-green-500/50",
        label: "Completed",
        labelClass: "text-green-500/80",
      };
    case "failed":
      return {
        icon: "x" as const,
        iconClass: "text-destructive",
        bgClass: "bg-destructive/10",
        borderClass: "border-destructive/50",
        label: "Failed",
        labelClass: "text-destructive/80",
      };
    default:
      return {
        icon: "clock" as const,
        iconClass: "text-muted-foreground/50",
        bgClass: "bg-muted/20",
        borderClass: "border-muted/50",
        label: "Unknown",
        labelClass: "text-muted-foreground/60",
      };
  }
}

/**
 * CopyButton - Button to copy text to clipboard
 */
function CopyButton(props: { text: string; class?: string }) {
  const [copied, setCopied] = createSignal(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(props.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Ignore copy errors
    }
  };

  return (
    <button
      onClick={handleCopy}
      class={cn(
        "opacity-0 transition-opacity group-hover:opacity-100",
        "hover:bg-muted/50 rounded p-1",
        "text-muted-foreground hover:text-foreground",
        props.class
      )}
      aria-label={copied() ? "Copied!" : "Copy"}
    >
      <Icon name={copied() ? "check" : "copy"} class="h-3.5 w-3.5" />
    </button>
  );
}

/**
 * CodeBlock - Code block with copy button
 */
function CodeBlock(props: { code: string; language?: string; maxLines?: number; class?: string }) {
  const [isExpanded, setIsExpanded] = createSignal(false);
  const lines = () => props.code.split("\n");
  const shouldTruncate = () => props.maxLines && lines().length > props.maxLines;
  const truncatedCode = () => {
    if (!shouldTruncate() || isExpanded()) return props.code;
    return lines().slice(0, props.maxLines).join("\n") + "\n...";
  };

  return (
    <div class={cn("group relative", props.class)}>
      <div class="absolute right-2 top-2 flex items-center gap-1">
        <Show when={shouldTruncate()}>
          <button
            onClick={() => setIsExpanded(!isExpanded())}
            class="text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded px-1.5 py-0.5 text-xs"
          >
            {isExpanded() ? "Show less" : `Show more (${lines().length} lines)`}
          </button>
        </Show>
        <CopyButton text={props.code} />
      </div>
      <pre
        class={cn(
          "bg-black/5 dark:bg-white/5",
          "rounded p-3",
          "font-mono text-xs",
          "overflow-x-auto",
          "max-h-60 overflow-y-auto",
          "scrollbar-thin"
        )}
      >
        <code>{truncatedCode()}</code>
      </pre>
    </div>
  );
}

/**
 * ToolCallBlock - Main component
 */
export const ToolCallBlock: Component<ToolCallBlockProps> = props => {
  const [isOpen, setIsOpen] = createSignal(false);
  const config = () => getStatusConfig(props.toolCall.status);

  const hasArgs = () => {
    const args = props.toolCall.arguments;
    return args && Object.keys(args).length > 0;
  };

  const hasResult = () => props.toolCall.result !== undefined && props.toolCall.result !== null;

  return (
    <Collapsible open={isOpen()} onOpenChange={setIsOpen}>
      <div
        class={cn("my-2 rounded-lg border", config().bgClass, config().borderClass, props.class)}
      >
        {/* Trigger/Header */}
        <Collapsible.Trigger
          class={cn(
            "flex w-full items-center gap-2 px-3 py-2",
            "hover:bg-black/5 dark:hover:bg-white/5",
            "transition-colors duration-150",
            "text-left"
          )}
        >
          {/* Status icon */}
          <span class={config().iconClass}>
            <Icon name={config().icon} class="h-4 w-4" />
          </span>

          {/* Tool name */}
          <span
            class={cn(
              "font-mono text-sm font-medium",
              props.toolCall.status === "running" ? "text-foreground" : "text-foreground/80"
            )}
          >
            {props.toolCall.name}
          </span>

          {/* Status badge */}
          <span class={cn("text-xs", config().labelClass)}>{config().label}</span>

          {/* Spacer */}
          <div class="flex-1" />

          {/* Expand/collapse arrow */}
          <Collapsible.Arrow />
        </Collapsible.Trigger>

        {/* Collapsible content */}
        <Collapsible.Content class="overflow-hidden">
          <div class="space-y-3 px-3 pb-3">
            {/* Arguments */}
            <Show when={hasArgs()}>
              <div class="space-y-1">
                <div class="text-muted-foreground text-xs font-medium">Arguments</div>
                <CodeBlock
                  code={JSON.stringify(props.toolCall.arguments, null, 2)}
                  language="json"
                  maxLines={10}
                />
              </div>
            </Show>

            {/* Result */}
            <Show when={hasResult()}>
              <div class="space-y-1">
                <div class="text-muted-foreground text-xs font-medium">Result</div>
                <CodeBlock
                  code={
                    typeof props.toolCall.result === "string"
                      ? props.toolCall.result
                      : JSON.stringify(props.toolCall.result, null, 2)
                  }
                  language="json"
                  maxLines={10}
                />
              </div>
            </Show>

            {/* Error message */}
            <Show when={props.toolCall.status === "failed" && props.toolCall.error}>
              <div class="space-y-1">
                <div class="text-destructive text-xs font-medium">Error</div>
                <div
                  class={cn(
                    "bg-destructive/10 border-destructive/30 rounded border p-2",
                    "text-destructive font-mono text-xs",
                    "scrollbar-thin max-h-40 overflow-y-auto"
                  )}
                >
                  {props.toolCall.error}
                </div>
              </div>
            </Show>
          </div>
        </Collapsible.Content>
      </div>
    </Collapsible>
  );
};
