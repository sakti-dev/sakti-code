import type { Mermaid } from "mermaid";
import {
  type Component,
  createEffect,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";
import { isServer } from "solid-js/web";
import type { CodeBlockData } from "../../parser/block-boundaries";
import { toMermaidThemeVariables } from "../../theme/to-mermaid-theme";
import type { VelomarkTheme } from "../../theme/types";
import type { RenderBlock } from "../../types";

let mermaidChartSequence = 0;

const nextChartId = (): string => {
  mermaidChartSequence += 1;
  return `velomark-mermaid-${mermaidChartSequence}`;
};

export const MermaidBlock: Component<{
  block: RenderBlock<CodeBlockData>;
  debug?: boolean;
  index: number;
  theme: VelomarkTheme;
}> = (props) => {
  const [diagramSvg, setDiagramSvg] = createSignal<string>("");
  const [renderFailed, setRenderFailed] = createSignal<boolean>(false);
  const [mermaidInstance, setMermaidInstance] = createSignal<Mermaid | null>(
    null
  );
  let activeRenderToken = 0;

  const code = (): string => props.block.data.code;
  const isComplete = (): boolean => props.block.status === "complete";

  onMount(async () => {
    try {
      const { default: mermaid } = await import("mermaid");
      setMermaidInstance(mermaid);
    } catch {
      setRenderFailed(true);
    }
  });

  createEffect(() => {
    const instance = mermaidInstance();

    if (!instance) {
      return;
    }

    instance.initialize({
      securityLevel: "loose",
      startOnLoad: false,
      suppressErrorRendering: true,
      theme: "base",
      themeVariables: toMermaidThemeVariables(props.theme),
    });
  });

  createEffect(() => {
    const instance = mermaidInstance();
    const source = code();

    if (!instance || isServer || source.length === 0 || !isComplete()) {
      setDiagramSvg("");
      setRenderFailed(false);
      return;
    }

    const renderToken = activeRenderToken + 1;
    activeRenderToken = renderToken;
    setRenderFailed(false);

    instance
      .render(nextChartId(), source)
      .then(({ svg }) => {
        if (activeRenderToken !== renderToken) {
          return;
        }
        setDiagramSvg(svg);
      })
      .catch(() => {
        if (activeRenderToken !== renderToken) {
          return;
        }
        setDiagramSvg("");
        setRenderFailed(true);
      });
  });

  onCleanup(() => {
    activeRenderToken += 1;
  });

  return (
    <div
      data-velomark-block-id={props.debug ? props.block.id : undefined}
      data-velomark-block-index={props.index}
      data-velomark-block-kind={props.block.kind}
      data-velomark-language="mermaid"
      data-velomark-mermaid=""
    >
      {!renderFailed() && diagramSvg().length > 0 ? (
        <div data-velomark-mermaid-diagram="" innerHTML={diagramSvg()} />
      ) : (
        <pre>
          <code>{code()}</code>
        </pre>
      )}
    </div>
  );
};
