import type { Component } from "solid-js";
import type { MathBlockData } from "../../parser/block-boundaries";
import type { RenderBlock } from "../../types";
import { MathView } from "../math/math-view";

export const MathBlock: Component<{
  block: RenderBlock<MathBlockData>;
  debug?: boolean;
  index: number;
}> = (props) => {
  return (
    <div
      data-velomark-block-id={props.debug ? props.block.id : undefined}
      data-velomark-block-index={props.index}
      data-velomark-block-kind={props.block.kind}
    >
      <MathView displayMode={true} formula={props.block.data.value} />
    </div>
  );
};
