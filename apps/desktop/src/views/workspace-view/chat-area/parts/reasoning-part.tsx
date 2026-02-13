/**
 * ReasoningPart Component
 *
 * Renders reasoning/thinking content in a collapsible section.
 * Uses subtle/italic styling to differentiate from regular text.
 */

import { Collapsible } from "@/components/shared/collapsible";
import { Markdown } from "@/components/shared/markdown";
import { useThrottledValue } from "@/core/chat/hooks/use-throttled-value";
import { cn } from "@/utils";
import { createSignal, Show, type Accessor, type Component } from "solid-js";

export interface ReasoningPartProps {
  /** The reasoning part data */
  part: Record<string, unknown>;
  /** Whether the content is currently streaming */
  isStreaming?: boolean;
  /** Start expanded */
  defaultOpen?: boolean;
  /** Throttle duration in ms (default: 100ms during streaming) */
  throttleMs?: number;
  /** Additional CSS classes */
  class?: string;
}

/** Default throttle duration for streaming reasoning */
const REASONING_THROTTLE_MS = 100;

/**
 * ReasoningPart - Renders thinking/reasoning content in collapsible section
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

  const [isOpen, setIsOpen] = createSignal(props.defaultOpen ?? false);

  const isEmpty = () => {
    const text = throttledText();
    return !text || text.trim() === "";
  };

  return (
    <Show when={!isEmpty()}>
      <Collapsible
        data-component="reasoning-part"
        open={isOpen()}
        onOpenChange={setIsOpen}
        class={cn(
          "text-muted-foreground border-border/30 bg-muted/20 rounded-lg border",
          props.class
        )}
      >
        <Collapsible.Trigger
          data-slot="reasoning-trigger"
          class={cn(
            "flex w-full items-center gap-2 px-3 py-2 text-left",
            "text-sm italic",
            "hover:bg-muted/50 transition-colors",
            "focus:ring-primary/30 focus:outline-none focus:ring-2"
          )}
        >
          <span class="font-medium">Thinking</span>
          <Collapsible.Arrow />
        </Collapsible.Trigger>

        <Collapsible.Content
          data-slot="reasoning-content"
          class="data-[expanded]:animate-collapsible-down data-[closed]:animate-collapsible-up overflow-hidden"
        >
          <div class="border-border/30 border-t px-3 py-2 text-sm italic">
            <Markdown text={throttledText()} class="prose-p:m-0" />
          </div>
        </Collapsible.Content>
      </Collapsible>
    </Show>
  );
};
