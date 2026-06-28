import type { Component } from "solid-js";
import { For, type JSX } from "solid-js";
import { Dynamic } from "solid-js/web";
import { parseInline } from "../parser/inline-parser";
import type {
  ReferenceDefinitionMap,
  VelomarkContainerRendererProps,
} from "../types";
import {
  type HtmlElementRenderChild,
  RenderInlineTokens,
} from "./inline/inline-token-view";

export function HtmlElementView(props: {
  attributes?: Record<string, string>;
  children: HtmlElementRenderChild[];
  containers?: Record<string, Component<VelomarkContainerRendererProps>>;
  definitions?: ReferenceDefinitionMap;
  tagName: string;
}) {
  return (
    <Dynamic
      component={props.tagName as keyof JSX.IntrinsicElements}
      {...props.attributes}
    >
      <For each={props.children}>
        {(child) => {
          if (child.type === "text") {
            return (
              <RenderInlineTokens
                containers={props.containers}
                definitions={props.definitions}
                tokens={parseInline(child.text, props.definitions)}
              />
            );
          }
          if (child.type === "inline-token") {
            return (
              <RenderInlineTokens
                containers={props.containers}
                definitions={props.definitions}
                tokens={[child.token]}
              />
            );
          }
          return (
            <HtmlElementView
              attributes={child.node.attributes}
              children={child.node.children}
              containers={props.containers}
              definitions={props.definitions}
              tagName={child.node.tagName}
            />
          );
        }}
      </For>
    </Dynamic>
  );
}
