import { type Component, For, Show } from "solid-js";
import type { ParsedBlockData } from "../../parser/block-boundaries";
import type { VelomarkTheme } from "../../theme/types";
import type {
  ReferenceDefinitionMap,
  RenderBlock,
  VelomarkCodeBlockRendererProps,
  VelomarkContainerRendererProps,
} from "../../types";
import { RenderBlockView } from "../render-block";

export const FootnotesSection: Component<{
  codeBlockRenderers?: Record<
    string,
    Component<VelomarkCodeBlockRendererProps>
  >;
  containers?: Record<string, Component<VelomarkContainerRendererProps>>;
  definitions: ReferenceDefinitionMap;
  footnoteDefinitions: Record<string, RenderBlock<ParsedBlockData>[]>;
  order: string[];
  theme: VelomarkTheme;
}> = (props) => {
  const orderedFootnotes = () =>
    props.order
      .map((identifier) => ({
        blocks: props.footnoteDefinitions[identifier],
        identifier,
      }))
      .filter((entry) => entry.blocks !== undefined);

  return (
    <Show when={orderedFootnotes().length > 0}>
      <section data-velomark-footnotes="">
        <hr />
        <ol>
          <For each={orderedFootnotes()}>
            {(entry) => (
              <li id={`fn-${entry.identifier}`}>
                <div>
                  <For each={entry.blocks}>
                    {(block, index) => (
                      <RenderBlockView
                        block={block}
                        codeBlockRenderers={props.codeBlockRenderers}
                        containers={props.containers}
                        definitions={props.definitions}
                        index={index()}
                        theme={props.theme}
                      />
                    )}
                  </For>
                </div>
                <a href={`#fnref-${entry.identifier}`}>↩</a>
              </li>
            )}
          </For>
        </ol>
      </section>
    </Show>
  );
};
