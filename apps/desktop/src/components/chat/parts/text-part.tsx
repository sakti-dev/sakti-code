import { type Component, createSignal, Show } from "solid-js";
import { Markdown } from "~/components/ui/markdown";
import { cn } from "~/lib/utils";
import type { PartProps } from "./part-registry.ts";

export const TextPart: Component<PartProps> = (props) => {
  const text = () => (props.part.type === "text" ? props.part.text : "");

  const [copied, setCopied] = createSignal(false);

  const isEmpty = () => {
    const t = text();
    return !t || t.trim() === "";
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore clipboard errors
    }
  };

  return (
    <Show when={!isEmpty()}>
      <div class="group relative w-full min-w-0" data-component="text-part">
        <Markdown isStreaming={props.isStreaming} text={text()} />
        <Show when={!props.isStreaming}>
          <button
            class={cn(
              "absolute top-0 right-0 -translate-y-0.5",
              "opacity-0 transition-opacity group-hover:opacity-100",
              "rounded border border-border/40 bg-card/80 px-2 py-1 text-xs",
              "hover:border-primary/30 hover:bg-card"
            )}
            data-slot="text-part-copy"
            onClick={handleCopy}
            type="button"
          >
            {copied() ? "Copied" : "Copy"}
          </button>
        </Show>
      </div>
    </Show>
  );
};
