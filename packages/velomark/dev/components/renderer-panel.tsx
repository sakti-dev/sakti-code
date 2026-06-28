import type { Component } from "solid-js";
import { Velomark } from "../../src";
import type { VelomarkThemeName } from "../../src/theme/types";
import type { VelomarkDebugMetrics } from "../../src/types";

export interface RendererPanelProps {
  markdown: string;
  onDebugMetrics?: (metrics: VelomarkDebugMetrics) => void;
  onSurfaceReady?: (element: HTMLDivElement) => void;
  theme: VelomarkThemeName;
}

export const RendererPanel: Component<RendererPanelProps> = (props) => {
  return (
    <section class="flex min-w-0 flex-col gap-4 rounded-xl border border-border bg-card p-4 shadow-xs">
      <header class="flex flex-col gap-1">
        <h2 class="font-semibold text-foreground text-lg tracking-tight">
          Renderer Viewport
        </h2>
        <p class="text-muted-foreground text-sm leading-6">
          Rendered output updates here as presets and stream controls change.
        </p>
      </header>
      <div
        class="renderer-surface min-h-[28rem] rounded-lg border border-border bg-background p-4"
        ref={(element) => {
          props.onSurfaceReady?.(element);
        }}
      >
        <div class="markdown-content" data-component="markdown">
          <Velomark
            debug={false}
            markdown={props.markdown}
            onDebugMetrics={props.onDebugMetrics}
            theme={props.theme}
          />
        </div>
      </div>
    </section>
  );
};
