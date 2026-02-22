import { Markdown } from "@/components/ui/markdown";
import {
  getMarkdownPerfSnapshot,
  resetMarkdownPerfTelemetry,
} from "@/core/chat/services/markdown-perf-telemetry";
import { render } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRecordedTextDeltaSequence } from "../fixtures/performance-fixtures";

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function createStressMarkdownBody(): string {
  const deltas = createRecordedTextDeltaSequence(120);
  const prose = deltas.join("");
  return `${prose}

\n## Streaming Load
\n\`\`\`ts
const fib = (n: number): number => (n < 2 ? n : fib(n - 1) + fib(n - 2));
console.log(fib(12));
\`\`\`

| step | action | note |
| --- | --- | --- |
| 1 | parse | heavy markdown parse |
| 2 | sanitize | html sanitizer |
| 3 | morph | dom patching |
`;
}

describe("Integration: markdown stream stress", () => {
  let container: HTMLDivElement;
  let dispose: (() => void) | undefined;

  beforeEach(() => {
    resetMarkdownPerfTelemetry();
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    dispose?.();
    container.remove();
    resetMarkdownPerfTelemetry();
  });

  it("stays responsive and records measurable renderer metrics under streaming load", async () => {
    const full = createStressMarkdownBody();
    const [text, setText] = createSignal("");
    const [streaming, setStreaming] = createSignal(true);
    const [scrollActive, setScrollActive] = createSignal(false);

    ({ unmount: dispose } = render(
      () => (
        <Markdown
          text={text()}
          isStreaming={streaming()}
          isScrollActive={scrollActive()}
          streamCadenceMs={90}
          deferHighlightUntilComplete={true}
        />
      ),
      { container }
    ));
    const lagSamples: number[] = [];
    let intervalActive = true;
    let prevTick = performance.now();
    const interval = setInterval(() => {
      const now = performance.now();
      lagSamples.push(Math.max(0, now - prevTick - 16));
      prevTick = now;
      if (!intervalActive) {
        clearInterval(interval);
      }
    }, 16);

    const chunkSize = 24;
    for (let i = 0; i < full.length; i += chunkSize) {
      setText(full.slice(0, i + chunkSize));
      if (i % (chunkSize * 8) === 0) {
        setScrollActive(true);
      } else if (i % (chunkSize * 8) === chunkSize * 4) {
        setScrollActive(false);
      }
      await sleep(2);
    }

    setStreaming(false);
    setScrollActive(false);
    await sleep(220);
    intervalActive = false;
    await sleep(20);

    expect(container.textContent).toContain("Streaming Load");

    const snapshot = getMarkdownPerfSnapshot();
    const maxLag = lagSamples.length > 0 ? Math.max(...lagSamples) : 0;

    expect(snapshot.counters.commits).toBeGreaterThan(0);
    expect(snapshot.stages.total.count).toBeGreaterThan(0);
    expect(snapshot.stages.parse.count).toBeGreaterThan(0);
    expect(snapshot.stages.morph.count).toBeGreaterThan(0);
    expect(snapshot.counters.finalizationBatches).toBeGreaterThan(0);
    expect(snapshot.stages.total.p95Ms).toBeLessThan(800);
    expect(maxLag).toBeLessThan(400);
  }, 15000);
});
