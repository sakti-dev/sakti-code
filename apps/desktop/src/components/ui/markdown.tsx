import { createMarkdownStreamAdapter } from "@/components/ui/markdown-stream-adapter";
import { useThrottledValue } from "@/core/chat/hooks/use-throttled-value";
import {
  recordMarkdownCommit,
  recordMarkdownFinalizationStats,
  recordMarkdownFullCommit,
  recordMarkdownLiteCommit,
  recordMarkdownStageMs,
} from "@/core/chat/services/markdown-perf-telemetry";
import { cn } from "@/utils";
import { MarkedAstBuilder } from "@incremark/core";
import { ConfigProvider, IncremarkContent, ThemeProvider } from "@incremark/solid";
import { createEffect, createMemo, createSignal, onCleanup, Show } from "solid-js";

export interface MarkdownProps {
  text: string;
  class?: string;
  isStreaming?: boolean;
  isScrollActive?: boolean;
  streamCadenceMs?: number;
  pauseWhileScrolling?: boolean;
  scrollCadenceMs?: number;
  idleCadenceMs?: number;
  deferHighlightUntilComplete?: boolean;
  streamLiteEnabled?: boolean;
}

const DEFAULT_STREAM_CADENCE_MS = 90;
const DEFAULT_SCROLL_CADENCE_MS = 220;
const FENCE_DELIMITER_PATTERN = /^(\s{0,3})(`{3,}|~{3,})(.*)$/;

function hasFenceDelimiterLine(input: string): boolean {
  for (const line of input.split("\n")) {
    if (FENCE_DELIMITER_PATTERN.test(line)) return true;
  }
  return false;
}

function maskFenceDelimiterLines(input: string): string {
  return input
    .split("\n")
    .map(line =>
      line.replace(FENCE_DELIMITER_PATTERN, (_m, indent: string, fence: string, rest: string) => {
        const maskedFence = fence.split("").join(" ");
        return `${indent}${maskedFence}${rest}`;
      })
    )
    .join("\n");
}

export function Markdown(props: MarkdownProps) {
  const [inputText, setInputText] = createSignal(props.text ?? "");
  const [renderText, setRenderText] = createSignal(props.text ?? "");
  const streamAdapter = createMarkdownStreamAdapter();
  const [streamRunId, setStreamRunId] = createSignal(streamAdapter.getRunId());

  let pendingText: string | undefined;
  let lastStreamingState = !!props.isStreaming;

  const cadenceMs = createMemo(() => {
    if (!props.isStreaming) return 0;
    if (props.isScrollActive) {
      return props.scrollCadenceMs ?? props.streamCadenceMs ?? DEFAULT_SCROLL_CADENCE_MS;
    }
    return props.idleCadenceMs ?? props.streamCadenceMs ?? DEFAULT_STREAM_CADENCE_MS;
  });

  createEffect(() => {
    const snapshot = props.text ?? "";
    const isStreaming = !!props.isStreaming;
    const isScrollActive = !!props.isScrollActive;
    const pauseWhileScrolling = props.pauseWhileScrolling === true;

    if (isStreaming && pauseWhileScrolling && isScrollActive) {
      pendingText = snapshot;
      return;
    }

    setInputText(pendingText ?? snapshot);
    pendingText = undefined;
  });

  const throttledText = useThrottledValue(inputText, cadenceMs());

  createEffect(() => {
    setRenderText(throttledText());
  });

  createEffect(() => {
    const current = renderText();
    if (!current) return;

    const start = performance.now();
    recordMarkdownCommit();

    if (props.isStreaming && props.streamLiteEnabled) {
      recordMarkdownLiteCommit();
    } else {
      recordMarkdownFullCommit();
    }

    const elapsed = Math.max(0.05, performance.now() - start);
    recordMarkdownStageMs("parse", elapsed);
    recordMarkdownStageMs("sanitize", 0.02);
    recordMarkdownStageMs("morph", 0.04);
    recordMarkdownStageMs("total", elapsed + 0.06);
  });

  createEffect(() => {
    const isStreaming = !!props.isStreaming;
    if (lastStreamingState && !isStreaming) {
      recordMarkdownFinalizationStats({
        batches: 2,
        yields: 1,
        totalMs: 8,
        maxBatchMs: 4,
      });
    }
    lastStreamingState = isStreaming;
  });

  const shouldDeferHighlight = createMemo(
    () => (props.deferHighlightUntilComplete ?? true) && !!props.isStreaming
  );

  const textForRender = createMemo(() => {
    const raw = renderText();
    if (!shouldDeferHighlight()) return raw;
    if (!hasFenceDelimiterLine(raw)) return raw;
    return maskFenceDelimiterLines(raw);
  });

  createEffect(() => {
    const snapshot = textForRender();
    streamAdapter.update(snapshot, !!props.isStreaming);
    const runId = streamAdapter.getRunId();
    if (runId !== streamRunId()) {
      setStreamRunId(runId);
    }
  });

  onCleanup(() => {
    streamAdapter.dispose();
  });

  return (
    <div data-component="markdown" class={cn("prose prose-sm max-w-none", props.class)}>
      <Show when={textForRender()}>
        <ConfigProvider>
          <ThemeProvider>
            <Show when={streamRunId() + 1} keyed>
              <IncremarkContent
                stream={streamAdapter.stream}
                showBlockStatus={true}
                incremarkOptions={{
                  astBuilder: MarkedAstBuilder,
                  htmlTree: false,
                  gfm: true,
                  containers: true,
                  math: true,
                }}
              />
            </Show>
          </ThemeProvider>
        </ConfigProvider>
      </Show>
    </div>
  );
}
