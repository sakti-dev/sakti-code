import type { Component } from "solid-js";
import { Show } from "solid-js";
import { createCodePlugin } from "@velomark/code";
import { Velomark } from "@velomark/core";
import { createMathPlugin } from "@velomark/math";
import { createMermaidPlugin } from "@velomark/mermaid";
import { cn } from "~/lib/utils";
import {
  DESKTOP_MARKDOWN_COMPONENT,
  DESKTOP_MARKDOWN_SCOPE_CLASS,
} from "./markdown-integration/contract";

const codePlugin = createCodePlugin();
const mathPlugin = createMathPlugin();
const mermaidPlugin = createMermaidPlugin();

export interface MarkdownProps {
  class?: string;
  isStreaming?: boolean;
  text: string;
}

export const Markdown: Component<MarkdownProps> = (props) => {
  return (
    <div
      class={cn(`${DESKTOP_MARKDOWN_SCOPE_CLASS} max-w-none text-[0.95rem]`, props.class)}
      data-component={DESKTOP_MARKDOWN_COMPONENT}
    >
      <Show when={props.text}>
        <Velomark
          animated
          caret={props.isStreaming ? "block" : undefined}
          markdown={props.text}
          plugins={{ code: codePlugin, math: mathPlugin, mermaid: mermaidPlugin }}
          remend={{}}
        />
      </Show>
    </div>
  );
};
