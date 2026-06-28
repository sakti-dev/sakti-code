import { type Component, For } from "solid-js";
import type { BlockquoteBlockData } from "../../parser/block-boundaries";
import type {
  ReferenceDefinitionMap,
  RenderBlock,
  VelomarkContainerRendererProps,
} from "../../types";
import { RenderInline } from "../inline/render-inline";

export const BlockquoteBlock: Component<{
  block: RenderBlock<BlockquoteBlockData>;
  containers?: Record<string, Component<VelomarkContainerRendererProps>>;
  debug?: boolean;
  definitions?: ReferenceDefinitionMap;
  index: number;
}> = (props) => {
  return (
    <blockquote
      data-velomark-block-id={props.debug ? props.block.id : undefined}
      data-velomark-block-index={props.index}
      data-velomark-block-kind={props.block.kind}
    >
      <For each={props.block.data.paragraphs}>
        {(paragraph) => (
          <p>
            <RenderInline
              containers={props.containers}
              definitions={props.definitions}
              text={paragraph}
            />
          </p>
        )}
      </For>
    </blockquote>
  );
};
