import { type Component, Show } from "solid-js";
import { Markdown } from "~/components/ui/markdown";
import type { PartProps } from "./part-registry.ts";

export const TextPart: Component<PartProps> = (props) => {
  const text = () => (props.part.type === "text" ? props.part.text : "");

  const isEmpty = () => {
    const t = text();
    return !t || t.trim() === "";
  };

  return (
    <Show when={!isEmpty()}>
      <div class="w-full min-w-0" data-component="text-part">
        <Markdown isStreaming={props.isStreaming} text={text()} />
      </div>
    </Show>
  );
};
