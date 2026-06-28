import type { Component } from "solid-js";
import type { HeadingBlockData } from "../../parser/block-boundaries";
import type {
  ReferenceDefinitionMap,
  RenderBlock,
  VelomarkContainerRendererProps,
} from "../../types";
import { RenderInline } from "../inline/render-inline";

export const HeadingBlock: Component<{
  block: RenderBlock<HeadingBlockData>;
  containers?: Record<string, Component<VelomarkContainerRendererProps>>;
  debug?: boolean;
  definitions?: ReferenceDefinitionMap;
  index: number;
}> = (props) => {
  const depth = () => props.block.data.depth;
  const commonProps = {
    "data-velomark-block-id": props.debug ? props.block.id : undefined,
    "data-velomark-block-index": props.index,
    "data-velomark-block-kind": props.block.kind,
    "data-velomark-heading-depth": depth(),
  } as const;

  if (depth() === 1) {
    return (
      <h1 {...commonProps}>
        <RenderInline
          containers={props.containers}
          definitions={props.definitions}
          text={props.block.data.text}
        />
      </h1>
    );
  }
  if (depth() === 2) {
    return (
      <h2 {...commonProps}>
        <RenderInline
          containers={props.containers}
          definitions={props.definitions}
          text={props.block.data.text}
        />
      </h2>
    );
  }
  if (depth() === 3) {
    return (
      <h3 {...commonProps}>
        <RenderInline
          containers={props.containers}
          definitions={props.definitions}
          text={props.block.data.text}
        />
      </h3>
    );
  }
  if (depth() === 4) {
    return (
      <h4 {...commonProps}>
        <RenderInline
          containers={props.containers}
          definitions={props.definitions}
          text={props.block.data.text}
        />
      </h4>
    );
  }
  if (depth() === 5) {
    return (
      <h5 {...commonProps}>
        <RenderInline
          containers={props.containers}
          definitions={props.definitions}
          text={props.block.data.text}
        />
      </h5>
    );
  }
  return (
    <h6 {...commonProps}>
      <RenderInline
        containers={props.containers}
        definitions={props.definitions}
        text={props.block.data.text}
      />
    </h6>
  );
};
