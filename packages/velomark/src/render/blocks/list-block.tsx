import { type Component, For } from "solid-js";
import type { ListBlockData } from "../../parser/block-boundaries";
import type {
  ReferenceDefinitionMap,
  RenderBlock,
  VelomarkContainerRendererProps,
} from "../../types";
import { RenderInline } from "../inline/render-inline";

export const ListBlock: Component<{
  block: RenderBlock<ListBlockData>;
  containers?: Record<string, Component<VelomarkContainerRendererProps>>;
  debug?: boolean;
  definitions?: ReferenceDefinitionMap;
  index: number;
}> = (props) => {
  const commonProps = {
    "data-velomark-block-id": props.debug ? props.block.id : undefined,
    "data-velomark-block-index": props.index,
    "data-velomark-block-kind": props.block.kind,
    "data-velomark-list-ordered": String(props.block.data.ordered),
  } as const;

  const items = () => props.block.data.items;
  const renderItemContent = (item: ListBlockData["items"][number]) => (
    <>
      {item.checked === undefined ? (
        <RenderInline
          containers={props.containers}
          definitions={props.definitions}
          text={item.text}
        />
      ) : (
        <label>
          <input checked={item.checked} disabled type="checkbox" />
          <span>
            <RenderInline
              containers={props.containers}
              definitions={props.definitions}
              text={item.text}
            />
          </span>
        </label>
      )}
      <For each={item.children ?? []}>
        {(child) => (
          <ListBlock
            block={{
              id: `${props.block.id}:${child.kind}:${item.text}`,
              kind: child.kind,
              sourceStart: props.block.sourceStart,
              sourceEnd: props.block.sourceEnd,
              status: props.block.status,
              fingerprint: `${props.block.fingerprint}:${child.kind}:${item.text}`,
              data: child.data,
            }}
            containers={props.containers}
            debug={props.debug}
            definitions={props.definitions}
            index={props.index}
          />
        )}
      </For>
    </>
  );

  if (props.block.data.ordered) {
    return (
      <ol {...commonProps}>
        <For each={items()}>{(item) => <li>{renderItemContent(item)}</li>}</For>
      </ol>
    );
  }

  return (
    <ul {...commonProps}>
      <For each={items()}>{(item) => <li>{renderItemContent(item)}</li>}</For>
    </ul>
  );
};
