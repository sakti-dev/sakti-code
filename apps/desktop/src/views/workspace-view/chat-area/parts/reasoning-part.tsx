/**
 * ReasoningPart Component
 *
 * Renders reasoning/thinking content inline.
 * Uses subtle/italic styling to differentiate from regular text.
 */

import { Markdown } from "@/components/shared/markdown";
import { useThrottledValue } from "@/core/chat/hooks/use-throttled-value";
import { cn } from "@/utils";
import { Show, type Accessor, type Component } from "solid-js";

export interface ReasoningPartProps {
  /** The reasoning part data */
  part: Record<string, unknown>;
  /** Whether the content is currently streaming */
  isStreaming?: boolean;
  /** Whether the user is actively scrolling the timeline */
  isScrollActive?: boolean;
  /** Maintained for compatibility with part renderer contract */
  defaultOpen?: boolean;
  /** Throttle duration in ms (default: 100ms during streaming) */
  throttleMs?: number;
  /** Additional CSS classes */
  class?: string;
}

/** Default throttle duration for streaming reasoning */
const REASONING_THROTTLE_MS = 100;

/**
 * ReasoningPart - Renders thinking/reasoning content inline
 *
 * @example
 * ```tsx
 * <ReasoningPart
 *   part={{ type: "reasoning", text: "Let me think..." }}
 *   isStreaming={false}
 * />
 * ```
 */
export const ReasoningPart: Component<ReasoningPartProps> = props => {
  const getText = (): string => {
    const text = props.part.text;
    return typeof text === "string" ? text : "";
  };

  const throttledText: Accessor<string> = useThrottledValue(
    getText,
    props.isStreaming ? (props.throttleMs ?? REASONING_THROTTLE_MS) : 0
  );

  const isEmpty = () => {
    const text = throttledText();
    return !text || text.trim() === "";
  };

  return (
    <Show when={!isEmpty()}>
      <div
        data-component="reasoning-part"
        class={cn(
          "text-muted-foreground border-border/30 bg-muted/20 rounded-lg border",
          props.class
        )}
      >
        <div
          data-slot="reasoning-content"
          class="border-border/30 border-t-0 px-3 py-2 text-sm italic"
        >
          <Markdown
            text={throttledText()}
            class="prose-p:m-0"
            isStreaming={props.isStreaming}
            isScrollActive={props.isScrollActive}
            deferHighlightUntilComplete={true}
            pauseWhileScrolling={true}
          />
        </div>
      </div>
    </Show>
  );
};
