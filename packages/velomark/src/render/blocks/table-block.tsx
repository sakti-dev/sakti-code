import { type Component, For } from "solid-js";
import type { TableBlockData } from "../../parser/block-boundaries";
import type {
  ReferenceDefinitionMap,
  RenderBlock,
  VelomarkContainerRendererProps,
} from "../../types";
import { RenderInline } from "../inline/render-inline";

export const TableBlock: Component<{
  block: RenderBlock<TableBlockData>;
  containers?: Record<string, Component<VelomarkContainerRendererProps>>;
  debug?: boolean;
  definitions?: ReferenceDefinitionMap;
  index: number;
}> = (props) => {
  const header = () => props.block.data.rows[0] ?? [];
  const bodyRows = () => props.block.data.rows.slice(1);
  const align = (index: number) => props.block.data.align[index] ?? "left";

  return (
    <div data-velomark-table-wrapper="">
      <table
        data-velomark-block-id={props.debug ? props.block.id : undefined}
        data-velomark-block-index={props.index}
        data-velomark-block-kind={props.block.kind}
      >
        <thead>
          <tr>
            <For each={header()}>
              {(cell, index) => (
                <th data-velomark-align={align(index())}>
                  <RenderInline
                    containers={props.containers}
                    definitions={props.definitions}
                    text={cell}
                  />
                </th>
              )}
            </For>
          </tr>
        </thead>
        <tbody>
          <For each={bodyRows()}>
            {(row) => (
              <tr>
                <For each={row}>
                  {(cell, index) => (
                    <td data-velomark-align={align(index())}>
                      <RenderInline
                        containers={props.containers}
                        definitions={props.definitions}
                        text={cell}
                      />
                    </td>
                  )}
                </For>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </div>
  );
};
