import { createChunkSequence } from "@/../tests/helpers/markdown-stream-fixtures";
import {
  getMarkdownPerfSnapshot,
  resetMarkdownPerfTelemetry,
} from "@/core/chat/services/markdown-perf-telemetry";
import { render } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createHighlighterMock = vi.fn(async () => ({
  codeToHtml: (code: string) => `<pre><code>${code}</code></pre>`,
  codeToTokens: () => ({
    tokens: [[{ content: "", offset: 0 }]],
    grammarState: undefined,
  }),
}));

vi.mock("shiki", () => ({
  createHighlighter: createHighlighterMock,
}));

describe("Markdown streaming behavior", () => {
  let container: HTMLDivElement;
  let dispose: (() => void) | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    createHighlighterMock.mockClear();
    resetMarkdownPerfTelemetry();
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    dispose?.();
    document.body.removeChild(container);
    resetMarkdownPerfTelemetry();
    vi.useRealTimers();
  });

  it("coalesces frequent streaming updates by cadence", async () => {
    const { Markdown } = await import("@/components/ui/markdown");
    const [text, setText] = createSignal("start");

    ({ unmount: dispose } = render(
      () => <Markdown text={text()} isStreaming={true} streamCadenceMs={120} />,
      { container }
    ));
    let next = "start";
    for (let i = 0; i < 20; i++) {
      next += ` delta-${i}`;
      setText(next);
    }

    await vi.advanceTimersByTimeAsync(20);
    const snapshotBeforeFlush = getMarkdownPerfSnapshot();

    await vi.advanceTimersByTimeAsync(140);
    await vi.waitFor(() => {
      expect(container.textContent).toContain("delta-19");
    });

    const snapshotAfterFlush = getMarkdownPerfSnapshot();
    expect(
      snapshotAfterFlush.counters.commits - snapshotBeforeFlush.counters.commits
    ).toBeLessThanOrEqual(2);
  });

  it("defers shiki while streaming and enables on completion", async () => {
    const { Markdown } = await import("@/components/ui/markdown");
    const [streaming, setStreaming] = createSignal(true);
    const codeMd = "```ts\nconst answer = 42\n```";

    ({ unmount: dispose } = render(() => <Markdown text={codeMd} isStreaming={streaming()} />, {
      container,
    }));

    await vi.advanceTimersByTimeAsync(220);
    expect(createHighlighterMock).toHaveBeenCalledTimes(0);

    setStreaming(false);
    await vi.advanceTimersByTimeAsync(120);
    expect(createHighlighterMock).toHaveBeenCalledTimes(1);
  });

  it("pauses updates while scrolling and flushes when scrolling stops", async () => {
    const { Markdown } = await import("@/components/ui/markdown");
    const [text, setText] = createSignal("a");
    const [scrollActive, setScrollActive] = createSignal(true);

    ({ unmount: dispose } = render(
      () => (
        <Markdown
          text={text()}
          isStreaming={true}
          isScrollActive={scrollActive()}
          streamCadenceMs={80}
          pauseWhileScrolling={true}
        />
      ),
      { container }
    ));
    setText("ab");
    setText("abc");
    await vi.advanceTimersByTimeAsync(200);
    expect(container.textContent).not.toContain("abc");

    setScrollActive(false);
    await vi.advanceTimersByTimeAsync(100);
    await vi.waitFor(() => {
      expect(container.textContent).toContain("abc");
    });
  });

  it("defers unstable code fence highlighting until completion", async () => {
    const { Markdown } = await import("@/components/ui/markdown");
    const [text, setText] = createSignal("Hello");
    const [streaming, setStreaming] = createSignal(true);

    ({ unmount: dispose } = render(() => (
      <Markdown text={text()} isStreaming={streaming()} streamCadenceMs={80} />
    )));
    await vi.advanceTimersByTimeAsync(100);

    setText("Hello\n```ts\nconst x = 1");
    await vi.advanceTimersByTimeAsync(200);

    expect(createHighlighterMock).toHaveBeenCalledTimes(0);

    setStreaming(false);
    await vi.advanceTimersByTimeAsync(120);
    expect(createHighlighterMock).toHaveBeenCalledTimes(0);
  });

  it("uses streaming lite mode and full finalization on completion", async () => {
    const { Markdown } = await import("@/components/ui/markdown");
    const [text, setText] = createSignal("x".repeat(260));
    const [streaming, setStreaming] = createSignal(true);

    ({ unmount: dispose } = render(
      () => (
        <Markdown
          text={text()}
          isStreaming={streaming()}
          streamLiteEnabled={true}
          streamCadenceMs={60}
        />
      ),
      { container }
    ));
    setText("x".repeat(340));
    await vi.advanceTimersByTimeAsync(120);
    await vi.waitFor(() => {
      expect(container.textContent).toContain("x");
    });

    setStreaming(false);
    await vi.advanceTimersByTimeAsync(120);

    const completed = getMarkdownPerfSnapshot();
    expect(completed.counters.commits).toBeGreaterThan(0);
    expect(completed.counters.fullCommits).toBeGreaterThan(0);
    expect(completed.counters.finalizationBatches).toBeGreaterThan(0);
  });

  it("applies slower cadence while scrolling and faster cadence when idle", async () => {
    const { Markdown } = await import("@/components/ui/markdown");
    const [text, setText] = createSignal("start");
    const [streaming] = createSignal(true);
    const [scrolling, setScrolling] = createSignal(true);

    ({ unmount: dispose } = render(
      () => (
        <Markdown
          text={text()}
          isStreaming={streaming()}
          isScrollActive={scrolling()}
          pauseWhileScrolling={false}
          scrollCadenceMs={220}
          idleCadenceMs={70}
        />
      ),
      { container }
    ));
    setText("start scrolling-phase");
    await vi.advanceTimersByTimeAsync(120);
    expect(container.textContent).not.toContain("start scrolling-phase");

    await vi.advanceTimersByTimeAsync(130);
    await vi.waitFor(() => {
      expect(container.textContent).toContain("scrolling-phase");
    });

    setScrolling(false);
    setText("start scrolling-phase idle-phase");
    await vi.advanceTimersByTimeAsync(80);
    await vi.waitFor(() => {
      expect(container.textContent).toContain("idle-phase");
    });
  });

  it("cleans up stream adapter on unmount during active streaming", async () => {
    const { Markdown } = await import("@/components/ui/markdown");
    const [text, setText] = createSignal("x");

    ({ unmount: dispose } = render(
      () => <Markdown text={text()} isStreaming={true} streamCadenceMs={80} />,
      { container }
    ));
    setText("xy");
    await vi.advanceTimersByTimeAsync(90);
    expect(container.textContent).toContain("xy");

    expect(() => dispose?.()).not.toThrow();
    dispose = undefined;
  });
});

describe("markdown-stream-fixtures", () => {
  it("builds deterministic chunk sequences", () => {
    const chunks = createChunkSequence("abcdef", 2);
    expect(chunks).toEqual(["ab", "cd", "ef"]);
  });
});
