import type { Component } from "solid-js";

export const ThematicBreakBlock: Component<{
  blockId: string;
  debug?: boolean;
  index: number;
}> = (props) => {
  return (
    <hr
      data-velomark-block-id={props.debug ? props.blockId : undefined}
      data-velomark-block-index={props.index}
      data-velomark-block-kind="thematic-break"
    />
  );
};
