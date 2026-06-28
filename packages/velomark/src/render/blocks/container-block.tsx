import { type Component, For } from "solid-js";
import { Dynamic } from "solid-js/web";
import type { ContainerBlockData } from "../../parser/block-boundaries";
import type { VelomarkTheme } from "../../theme/types";
import type {
  ReferenceDefinitionMap,
  RenderBlock,
  VelomarkCodeBlockRendererProps,
  VelomarkContainerRendererProps,
} from "../../types";
import { directiveAttributeProps } from "../directives/directive-attribute-props";
import { RenderBlockView } from "../render-block";

function withNestedId(
  parent: RenderBlock<ContainerBlockData>,
  index: number
): RenderBlock<ContainerBlockData["children"][number]["data"]> {
  const child = parent.data.children[index];
  if (!child) {
    throw new Error("Missing container child block");
  }

  return {
    ...child,
    id: `${parent.id}:container:${index}`,
  };
}

export const ContainerBlock: Component<{
  block: RenderBlock<ContainerBlockData>;
  codeBlockRenderers?: Record<
    string,
    Component<VelomarkCodeBlockRendererProps>
  >;
  containers?: Record<string, Component<VelomarkContainerRendererProps>>;
  debug?: boolean;
  definitions?: ReferenceDefinitionMap;
  index: number;
  theme: VelomarkTheme;
}> = (props) => {
  const customContainer = () => props.containers?.[props.block.data.name];
  const resolvedCustomContainer = customContainer();

  const renderedChildren = (
    <For each={props.block.data.children}>
      {(_, index) => (
        <RenderBlockView
          block={withNestedId(props.block, index())}
          codeBlockRenderers={props.codeBlockRenderers}
          containers={props.containers}
          debug={props.debug}
          definitions={props.definitions}
          index={index()}
          theme={props.theme}
        />
      )}
    </For>
  );

  if (resolvedCustomContainer) {
    return (
      <Dynamic
        attributes={props.block.data.attributes}
        component={resolvedCustomContainer}
        name={props.block.data.name}
      >
        {renderedChildren}
      </Dynamic>
    );
  }

  return (
    <div
      data-velomark-block-id={props.debug ? props.block.id : undefined}
      data-velomark-block-index={props.index}
      data-velomark-block-kind={props.block.kind}
      data-velomark-container={
        props.block.data.directiveType === "container"
          ? props.block.data.name
          : undefined
      }
      data-velomark-leaf-directive={
        props.block.data.directiveType === "leaf"
          ? props.block.data.name
          : undefined
      }
      {...directiveAttributeProps(props.block.data.attributes)}
    >
      {renderedChildren}
    </div>
  );
};
