import type { Component } from "solid-js";
import type { ParagraphBlockData } from "../../parser/block-boundaries";
import type {
  ReferenceDefinitionMap,
  RenderBlock,
  VelomarkContainerRendererProps,
} from "../../types";
import { RenderInline } from "../inline/render-inline";

export const ParagraphBlock: Component<{
  block: RenderBlock<ParagraphBlockData>;
  containers?: Record<string, Component<VelomarkContainerRendererProps>>;
  debug?: boolean;
  definitions?: ReferenceDefinitionMap;
  index: number;
}> = (props) => {
  return (
    <p
      data-velomark-block-id={props.debug ? props.block.id : undefined}
      data-velomark-block-index={props.index}
      data-velomark-block-kind={props.block.kind}
    >
      <RenderInline
        containers={props.containers}
        definitions={props.definitions}
        text={props.block.data.text}
      />
    </p>
  );
};
