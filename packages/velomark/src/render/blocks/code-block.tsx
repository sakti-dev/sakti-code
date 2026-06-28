import type { Component } from "solid-js";
import { Dynamic } from "solid-js/web";
import type { CodeBlockData } from "../../parser/block-boundaries";
import type { VelomarkTheme } from "../../theme/types";
import type {
  RenderBlock,
  VelomarkCodeBlockOptions,
  VelomarkCodeBlockRendererProps,
} from "../../types";
import {
  CodeBlockOverlayControls,
  resolveCodeBlockOptions,
} from "../code-blocks/default-code-block-shell";
import { HighlightedCodeBlock } from "../code-blocks/highlighted-code-block";
import { MermaidBlock } from "./mermaid-block";

export const CodeBlock: Component<{
  block: RenderBlock<CodeBlockData>;
  codeBlockRenderers?: Record<
    string,
    Component<VelomarkCodeBlockRendererProps>
  >;
  codeBlockOptions?: VelomarkCodeBlockOptions;
  debug?: boolean;
  index: number;
  theme: VelomarkTheme;
}> = (props) => {
  const language = () => props.block.data.language?.trim() || undefined;
  const customRenderer = () =>
    language() ? props.codeBlockRenderers?.[language() ?? ""] : undefined;
  const resolvedCustomRenderer = customRenderer();

  if (resolvedCustomRenderer) {
    return (
      <Dynamic
        code={props.block.data.code}
        component={resolvedCustomRenderer}
        language={language()}
      />
    );
  }

  if (language() === "mermaid") {
    return (
      <MermaidBlock
        block={props.block}
        debug={props.debug}
        index={props.index}
        theme={props.theme}
      />
    );
  }

  const options = () => resolveCodeBlockOptions(props.codeBlockOptions);

  return (
    <div
      data-velomark-block-id={props.debug ? props.block.id : undefined}
      data-velomark-block-index={props.index}
      data-velomark-block-kind={props.block.kind}
      data-velomark-language={language() ?? ""}
    >
      <CodeBlockOverlayControls
        code={props.block.data.code}
        language={language()}
        options={props.codeBlockOptions}
      />
      {options().highlight ? (
        <HighlightedCodeBlock
          code={props.block.data.code}
          language={language()}
          theme={options().highlightTheme}
        />
      ) : (
        <pre>
          <code>{props.block.data.code}</code>
        </pre>
      )}
    </div>
  );
};
