import { createMemo, Show } from "solid-js";
import { Velomark } from "velomark";
import { cn } from "~/lib/utils";
import {
  DESKTOP_MARKDOWN_COMPONENT,
  DESKTOP_MARKDOWN_SCOPE_CLASS,
} from "./markdown-integration/contract";
import { createDesktopVelomarkTheme } from "./markdown-integration/theme";

export interface MarkdownProps {
  class?: string;
  isStreaming?: boolean;
  text: string;
}

export function Markdown(props: MarkdownProps) {
  const theme = createMemo(() => createDesktopVelomarkTheme());

  return (
    <div
      class={cn(
        `${DESKTOP_MARKDOWN_SCOPE_CLASS} max-w-none text-[0.95rem]`,
        props.class
      )}
      data-component={DESKTOP_MARKDOWN_COMPONENT}
    >
      <Show when={props.text}>
        <Velomark markdown={props.text} theme={theme()} />
      </Show>
    </div>
  );
}
