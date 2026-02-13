/**
 * TextPart Component
 *
 * Renders text content with Markdown support and copy functionality.
 * Uses throttled updates during streaming for better performance.
 */

import { Markdown } from "@/components/shared/markdown";
import { useThrottledValue } from "@/core/chat/hooks/use-throttled-value";
import { cn } from "@/utils";
import { createSignal, Show, type Accessor, type Component } from "solid-js";

export interface TextPartProps {
  /** The text part data */
  part: Record<string, unknown>;
  /** Whether the text is currently streaming */
  isStreaming?: boolean;
  /** Whether the user is actively scrolling the timeline */
  isScrollActive?: boolean;
  /** Throttle duration in ms (default: 100ms during streaming) */
  throttleMs?: number;
  /** Additional CSS classes */
  class?: string;
}

/** Default throttle duration for streaming text */
export const TEXT_RENDER_THROTTLE_MS = 100;

/**
 * TextPart - Renders text content with Markdown and copy button
 *
 * @example
 * ```tsx
 * <TextPart
 *   part={{ type: "text", text: "Hello **world**" }}
 *   isStreaming={false}
 * />
 * ```
 */
export const TextPart: Component<TextPartProps> = props => {
  const getText = (): string => {
    const text = props.part.text;
    return typeof text === "string" ? text : "";
  };

  const throttledText: Accessor<string> = useThrottledValue(
    getText,
    props.isStreaming ? (props.throttleMs ?? TEXT_RENDER_THROTTLE_MS) : 0
  );

  const [copied, setCopied] = createSignal(false);

  const isEmpty = () => {
    const text = throttledText();
    return !text || text.trim() === "";
  };

  const handleCopy = async () => {
    const text = throttledText();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: select text
      const selection = window.getSelection();
      const range = document.createRange();
      const element = containerRef;
      if (element && selection) {
        range.selectNodeContents(element);
        selection.removeAllRanges();
        selection.addRange(range);
      }
    }
  };

  let containerRef: HTMLDivElement | undefined;

  return (
    <Show when={!isEmpty()}>
      <div
        ref={containerRef}
        data-component="text-part"
        class={cn("group relative w-full min-w-0", props.class)}
      >
        <Markdown
          text={throttledText()}
          isStreaming={props.isStreaming}
          isScrollActive={props.isScrollActive}
          deferHighlightUntilComplete={true}
          pauseWhileScrolling={true}
        />
        <Show when={!props.isStreaming}>
          <button
            type="button"
            data-slot="text-part-copy"
            onClick={handleCopy}
            class={cn(
              "absolute right-0 top-0 -translate-y-0.5",
              "opacity-0 transition-opacity group-hover:opacity-100",
              "border-border/40 bg-card/80 rounded border px-2 py-1 text-xs",
              "hover:bg-card hover:border-primary/30"
            )}
          >
            {copied() ? "Copied" : "Copy"}
          </button>
        </Show>
      </div>
    </Show>
  );
};
