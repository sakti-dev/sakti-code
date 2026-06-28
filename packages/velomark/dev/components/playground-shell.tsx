import type { Component, JSX } from "solid-js";

export interface PlaygroundShellProps {
  controls: JSX.Element;
  renderer: JSX.Element;
}

export const PlaygroundShell: Component<PlaygroundShellProps> = (props) => {
  return (
    <div class="playground-shell flex min-h-screen flex-col gap-6 bg-background p-6 text-foreground">
      <header class="flex flex-col gap-2">
        <h1 class="font-semibold text-3xl tracking-tight">
          Velomark Playground
        </h1>
        <p class="max-w-3xl text-muted-foreground text-sm leading-6">
          Streaming-oriented renderer playground for append updates, tail
          rewrites, and DOM stability checks.
        </p>
      </header>
      <div class="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(20rem,24rem)_minmax(0,1fr)]">
        <aside class="min-w-0">{props.controls}</aside>
        <main class="min-w-0">{props.renderer}</main>
      </div>
    </div>
  );
};
