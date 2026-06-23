import { type Component, Show } from "solid-js";
import { Markdown } from "~/components/ui/markdown";
import { cn } from "~/lib/utils";
import type { PartProps } from "./part-registry.ts";

export const ThinkingPart: Component<PartProps> = (props) => {
  const text = () => (props.part.type === "thinking" ? props.part.text : "");

  const isEmpty = () => {
    const t = text();
    return !t || t.trim() === "";
  };

  return (
    <Show when={!isEmpty()}>
      <div
        class={cn(
          "relative overflow-hidden rounded-lg bg-muted/30 text-muted-foreground italic"
        )}
        data-component="thinking-part"
      >
        <div class="absolute top-0 bottom-0 left-0 w-1.5 bg-linear-to-b from-primary/40 via-primary/60 to-primary/40" />
        <div class="py-2.5 pr-3 pl-4 text-sm leading-relaxed">
          <Markdown
            class="prose-p:m-0"
            isStreaming={props.isStreaming}
            text={text()}
          />
        </div>
      </div>
    </Show>
  );
};
