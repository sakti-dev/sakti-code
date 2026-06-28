import type { Component } from "solid-js";
import { parseInline } from "../../parser/inline-parser";
import type {
  ReferenceDefinitionMap,
  VelomarkContainerRendererProps,
} from "../../types";
import { RenderInlineTokens } from "./inline-token-view";

export const RenderInline: Component<{
  containers?: Record<string, Component<VelomarkContainerRendererProps>>;
  definitions?: ReferenceDefinitionMap;
  text?: string;
}> = (props) => {
  const tokens = () => parseInline(props.text ?? "", props.definitions);

  return (
    <RenderInlineTokens
      containers={props.containers}
      definitions={props.definitions}
      tokens={tokens()}
    />
  );
};
