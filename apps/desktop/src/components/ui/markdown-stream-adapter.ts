import { computeStreamDelta } from "@/components/ui/markdown-stream-diff";
import { createMarkdownStreamQueue } from "@/components/ui/markdown-stream-queue";

export interface MarkdownStreamAdapter {
  stream: () => AsyncGenerator<string>;
  update: (snapshot: string, isStreaming: boolean) => void;
  finish: () => void;
  reset: () => void;
  dispose: () => void;
  getRunId: () => number;
}

export function createMarkdownStreamAdapter(): MarkdownStreamAdapter {
  let previous = "";
  let runId = 0;
  let queue = createMarkdownStreamQueue();
  let closed = false;

  const closeSafely = () => {
    if (closed) return;
    closed = true;
    queue.close();
  };

  const reset = () => {
    closeSafely();
    queue = createMarkdownStreamQueue();
    closed = false;
    previous = "";
    runId += 1;
  };

  return {
    stream: () => queue.stream(),
    update: (snapshot, isStreaming) => {
      const delta = computeStreamDelta(previous, snapshot);
      if (delta.type === "append") {
        if (delta.chunk) queue.push(delta.chunk);
      } else {
        reset();
        if (delta.snapshot) queue.push(delta.snapshot);
      }
      previous = snapshot;
      if (!isStreaming) closeSafely();
    },
    finish: () => closeSafely(),
    reset,
    dispose: () => closeSafely(),
    getRunId: () => runId,
  };
}
