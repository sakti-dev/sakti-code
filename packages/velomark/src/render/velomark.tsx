import {
  type Component,
  createEffect,
  createMemo,
  createSignal,
  For,
} from "solid-js";
import {
  buildRenderDocument,
  collectRenderMetrics,
} from "../model/render-document";
import type { ParsedBlockData } from "../parser/block-boundaries";
import { resolveTheme } from "../theme/apply-theme";
import { generateCssVars } from "../theme/generate-css-vars";
import type { PartialVelomarkTheme } from "../theme/merge-theme";
import type { VelomarkTheme, VelomarkThemeName } from "../theme/types";
import type {
  RenderDocument,
  VelomarkCodeBlockOptions,
  VelomarkCodeBlockRendererProps,
  VelomarkContainerRendererProps,
  VelomarkDebugMetrics,
} from "../types";
import { FootnotesSection } from "./footnotes/footnotes-section";
import { RenderBlockView } from "./render-block";

export interface VelomarkProps {
  class?: string;
  codeBlockOptions?: VelomarkCodeBlockOptions;
  codeBlockRenderers?: Record<
    string,
    Component<VelomarkCodeBlockRendererProps>
  >;
  containers?: Record<string, Component<VelomarkContainerRendererProps>>;
  debug?: boolean;
  markdown: string;
  onDebugMetrics?: (metrics: VelomarkDebugMetrics) => void;
  theme?: VelomarkThemeName | PartialVelomarkTheme;
}

const BlockSlot: Component<{
  blockId: string;
  blockLookup: () => Map<
    string,
    RenderDocument<ParsedBlockData>["blocks"][number]
  >;
  codeBlockOptions?: VelomarkCodeBlockOptions;
  codeBlockRenderers?: Record<
    string,
    Component<VelomarkCodeBlockRendererProps>
  >;
  containers?: Record<string, Component<VelomarkContainerRendererProps>>;
  debug?: boolean;
  definitions: () => RenderDocument<ParsedBlockData>["definitions"];
  index: () => number;
  theme: () => VelomarkTheme;
}> = (props) => {
  const block = createMemo(() => {
    const resolvedBlock = props.blockLookup().get(props.blockId);
    if (!resolvedBlock) {
      throw new Error(`Missing block for id ${props.blockId}`);
    }

    return resolvedBlock;
  });

  return (
    <RenderBlockView
      block={block()}
      codeBlockOptions={props.codeBlockOptions}
      codeBlockRenderers={props.codeBlockRenderers}
      containers={props.containers}
      debug={props.debug}
      definitions={props.definitions()}
      index={props.index()}
      theme={props.theme()}
    />
  );
};

export function Velomark(props: VelomarkProps) {
  const [document, setDocument] = createSignal<RenderDocument<ParsedBlockData>>(
    buildRenderDocument(undefined, props.markdown)
  );
  const resolvedTheme = createMemo(() => resolveTheme(props.theme));
  const themeStyle = createMemo<Record<string, string>>(() =>
    generateCssVars(resolvedTheme())
  );
  const blockIds = createMemo(() => document().blocks.map((block) => block.id));
  const blockLookup = createMemo(
    () => new Map(document().blocks.map((block) => [block.id, block] as const))
  );

  createEffect(() => {
    setDocument((previous) => {
      const nextDocument = buildRenderDocument(previous, props.markdown);

      props.onDebugMetrics?.(
        collectRenderMetrics(previous.blocks, nextDocument.blocks)
      );

      return nextDocument;
    });
  });

  return (
    <div
      class={props.class ? `velomark ${props.class}` : "velomark"}
      data-velomark-root=""
      style={themeStyle()}
    >
      <For each={blockIds()}>
        {(blockId, index) => (
          <BlockSlot
            blockId={blockId}
            blockLookup={blockLookup}
            codeBlockOptions={props.codeBlockOptions}
            codeBlockRenderers={props.codeBlockRenderers}
            containers={props.containers}
            debug={props.debug}
            definitions={() => document().definitions}
            index={index}
            theme={resolvedTheme}
          />
        )}
      </For>
      <FootnotesSection
        codeBlockRenderers={props.codeBlockRenderers}
        containers={props.containers}
        definitions={document().definitions}
        footnoteDefinitions={document().footnoteDefinitions}
        order={document().footnoteReferenceOrder}
        theme={resolvedTheme()}
      />
    </div>
  );
}
