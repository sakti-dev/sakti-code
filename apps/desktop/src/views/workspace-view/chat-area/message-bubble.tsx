import { Component, For, Match, mergeProps, Show, Switch } from "solid-js";
import { Markdown } from "/@/components/markdown";
import { cn } from "/@/lib/utils";
import type { ChatUIMessage } from "/@/types/ui-message";

interface MessageBubbleProps {
  /** Message data */
  message: ChatUIMessage;
  /** Additional CSS classes */
  class?: string;
  /** Animation delay for stagger effect */
  delay?: number;
}

/**
 * MessageBubble - Individual message component with support for user/assistant messages
 *
 * Design Features:
 * - User messages: right-aligned, primary background
 * - Assistant messages: left-aligned, card background with border
 * - Fade-in animation with slide up
 * - Renders message.parts array (AI SDK UIMessage format)
 */
export const MessageBubble: Component<MessageBubbleProps> = props => {
  const merged = mergeProps(
    {
      delay: 0,
    },
    props
  );

  const isUser = () => props.message.role === "user";

  // Get text content from parts
  const getTextContent = () => {
    const parts = props.message.parts || [];
    return parts
      .filter((part): part is { type: "text"; text: string } => part.type === "text")
      .map(part => part.text)
      .join("");
  };

  return (
    <div
      class={cn(
        "animate-message-in mb-4 flex w-full",
        isUser() ? "justify-end" : "justify-start",
        merged.class
      )}
      style={{
        "animation-delay": `${merged.delay}ms`,
      }}
    >
      {/* Message bubble */}
      <div
        class={cn(
          "max-w-[85%] p-4 shadow-sm",
          "rounded-2xl",
          isUser()
            ? [
                "bg-primary text-primary-foreground",
                "rounded-tr-sm",
                // Glow effect for user messages
                "shadow-[0_0_20px_-5px_rgba(var(--primary),0.2)]",
              ]
            : ["bg-card/30 border-border/30 border", "text-foreground rounded-tl-sm"]
        )}
      >
        {/* Message content - render parts */}
        <div class="break-words text-sm leading-relaxed">
          <For each={props.message.parts}>
            {part => (
              <Switch>
                <Match when={part.type === "text"}>
                  <Markdown
                    text={(part as { text: string }).text}
                    class={cn(
                      isUser()
                        ? "text-primary-foreground/90 prose-p:m-0 prose-invert"
                        : "prose-p:m-0"
                    )}
                  />
                </Match>
                <Match when={part.type === "tool-call"}>
                  <span class="text-muted-foreground italic">
                    [Tool: {(part as { toolName: string }).toolName}]
                  </span>
                </Match>
                <Match when={part.type === "tool-result"}>
                  <span class="text-muted-foreground italic">[Tool result]</span>
                </Match>
              </Switch>
            )}
          </For>
          <Show when={props.message.parts?.length === 0}>
            <span>{getTextContent()}</span>
          </Show>
        </div>
      </div>
    </div>
  );
};

/**
 * ThinkingBubble - Collapsible thought chain component
 */
interface ThinkingBubbleProps {
  /** Thinking content */
  content: string;
  /** Whether thinking is collapsed */
  isCollapsed?: boolean;
  /** Toggle collapse handler */
  onToggle?: () => void;
  /** Additional CSS classes */
  class?: string;
}

export const ThinkingBubble: Component<ThinkingBubbleProps> = props => {
  return (
    <div class={cn("mb-3 flex w-full justify-start", "animate-fade-in-up", props.class)}>
      <div
        class={cn(
          "max-w-[80%] rounded-xl",
          "bg-primary/5 border-primary/20 border",
          "overflow-hidden"
        )}
      >
        {/* Header - always visible */}
        <button
          onClick={props.onToggle}
          class={cn(
            "flex w-full items-center gap-2 px-3 py-2",
            "hover:bg-primary/10 transition-colors duration-150"
          )}
        >
          <svg
            class={cn(
              "text-primary/60 h-4 w-4 transition-transform duration-200",
              !props.isCollapsed && "rotate-90"
            )}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width={2}
              d="M9 5l7 7-7 7"
            />
          </svg>
          <span class="text-primary/70 text-xs font-medium">Thinking</span>
          <div class="ml-auto flex gap-1">
            <span class="typing-dot bg-primary/40 h-1 w-1 rounded-full" />
            <span class="typing-dot bg-primary/40 h-1 w-1 rounded-full" />
            <span class="typing-dot bg-primary/40 h-1 w-1 rounded-full" />
          </div>
        </button>

        {/* Collapsible content */}
        <Show when={!props.isCollapsed}>
          <div class="px-3 pb-3">
            <div class="text-muted-foreground/70 whitespace-pre-wrap text-xs">{props.content}</div>
          </div>
        </Show>
      </div>
    </div>
  );
};
