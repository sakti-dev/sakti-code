import type { Component } from "solid-js";
import type { HtmlBlockData } from "../../parser/block-boundaries";
import type { RenderBlock } from "../../types";

export const HtmlBlock: Component<{
  block: RenderBlock<HtmlBlockData>;
  debug?: boolean;
  index: number;
}> = (props) => {
  return (
    <div
      data-velomark-block-id={props.debug ? props.block.id : undefined}
      data-velomark-block-index={props.index}
      data-velomark-block-kind={props.block.kind}
    >
      <pre>
        <code>{props.block.data.value}</code>
      </pre>
    </div>
  );
};
