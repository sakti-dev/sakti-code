import {
  type Component,
  createEffect,
  createSignal,
  onCleanup,
  Show,
} from "solid-js";

let katexModulePromise: Promise<typeof import("katex")["default"]> | null =
  null;

const DEFAULT_RENDER_DELAY_MS = 0;

const loadKatex = (): Promise<typeof import("katex")["default"]> => {
  if (!katexModulePromise) {
    katexModulePromise = import("katex").then((module) => module.default);
  }

  return katexModulePromise;
};

export const MathView: Component<{
  displayMode: boolean;
  formula: string;
  renderDelayMs?: number;
}> = (props) => {
  const [renderedHtml, setRenderedHtml] = createSignal("");
  const [isRendering, setIsRendering] = createSignal(false);
  let requestId = 0;
  let renderTimer: ReturnType<typeof setTimeout> | undefined;

  const clearScheduledRender = (): void => {
    if (renderTimer) {
      clearTimeout(renderTimer);
      renderTimer = undefined;
    }
  };

  const renderFormula = async (
    formula: string,
    currentRequestId: number
  ): Promise<void> => {
    try {
      const katex = await loadKatex();
      const html = katex.renderToString(formula, {
        displayMode: props.displayMode,
        output: "html",
        strict: false,
        throwOnError: true,
      });

      if (currentRequestId !== requestId) {
        return;
      }

      setRenderedHtml(html);
    } catch {
      if (currentRequestId !== requestId) {
        return;
      }

      setRenderedHtml("");
    } finally {
      if (currentRequestId === requestId) {
        setIsRendering(false);
      }
    }
  };

  createEffect(() => {
    const formula = props.formula.trim();
    requestId += 1;
    const currentRequestId = requestId;
    clearScheduledRender();

    if (!formula) {
      setRenderedHtml("");
      setIsRendering(false);
      return;
    }

    setIsRendering(true);
    renderTimer = setTimeout(() => {
      renderFormula(formula, currentRequestId);
    }, props.renderDelayMs ?? DEFAULT_RENDER_DELAY_MS);
  });

  onCleanup(() => {
    requestId += 1;
    clearScheduledRender();
  });

  return (
    <Show
      fallback={
        props.displayMode ? (
          <pre data-velomark-math-fallback="">
            <code>{props.formula}</code>
          </pre>
        ) : (
          <code data-velomark-math-fallback="">{props.formula}</code>
        )
      }
      when={renderedHtml() && !isRendering()}
    >
      <span data-velomark-math-rendered="" innerHTML={renderedHtml()} />
    </Show>
  );
};
