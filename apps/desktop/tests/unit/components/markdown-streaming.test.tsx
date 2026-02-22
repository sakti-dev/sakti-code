import { render } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createHighlighterMock = vi.fn(async () => ({
  codeToHtml: (code: string) => `<pre><code>${code}</code></pre>`,
}));

vi.mock("shiki", () => ({
  createHighlighter: createHighlighterMock,
}));

describe("Markdown streaming behavior", () => {
  let container: HTMLDivElement;
  let dispose: (() => void) | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    createHighlighterMock.mockClear();
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    dispose?.();
    document.body.removeChild(container);
    vi.useRealTimers();
  });

  it("coalesces frequent streaming updates by cadence", async () => {
    const markedModule = await import("marked");
    const parseSpy = vi.spyOn(markedModule.marked, "parse");
    const { Markdown } = await import("@/components/ui/markdown");
    const [text, setText] = createSignal("start");

    ({ unmount: dispose } = render(
      () => <Markdown text={text()} isStreaming={true} streamCadenceMs={120} />,
      { container }
    ));
    for (let i = 0; i < 20; i++) {
      setText(`delta-${i}`);
    }

    await vi.advanceTimersByTimeAsync(20);
    const parseCallsBeforeFlush = parseSpy.mock.calls.length;

    await vi.advanceTimersByTimeAsync(140);
    await vi.waitFor(() => {
      expect(container.textContent).toContain("delta-19");
    });

    const totalCalls = parseSpy.mock.calls.length;
    expect(totalCalls - parseCallsBeforeFlush).toBeLessThanOrEqual(2);
    parseSpy.mockRestore();
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
    await vi.waitFor(() => {
      expect(createHighlighterMock).toHaveBeenCalledTimes(1);
    });
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
    setText("b");
    setText("c");
    await vi.advanceTimersByTimeAsync(200);
    expect(container.textContent).not.toContain("c");

    setScrollActive(false);
    await vi.advanceTimersByTimeAsync(100);
    await vi.waitFor(() => {
      expect(container.textContent).toContain("c");
    });
  });

  it("defers unstable code fence parsing until completion", async () => {
    const markedModule = await import("marked");
    const parseSpy = vi.spyOn(markedModule.marked, "parse");
    const { Markdown } = await import("@/components/ui/markdown");
    const [text, setText] = createSignal("Hello");
    const [streaming, setStreaming] = createSignal(true);

    ({ unmount: dispose } = render(() => (
      <Markdown text={text()} isStreaming={streaming()} streamCadenceMs={80} />
    )));
    await vi.advanceTimersByTimeAsync(100);
    const baselineCalls = parseSpy.mock.calls.length;

    setText("Hello\n```ts\nconst x = 1");
    await vi.advanceTimersByTimeAsync(200);

    expect(parseSpy.mock.calls.length).toBe(baselineCalls);

    setStreaming(false);
    await vi.waitFor(() => {
      expect(parseSpy.mock.calls.length).toBeGreaterThan(baselineCalls);
    });
    parseSpy.mockRestore();
  });

  it("uses streaming lite mode for large unstable text and full parse on completion", async () => {
    const markedModule = await import("marked");
    const parseSpy = vi.spyOn(markedModule.marked, "parse");
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
    expect(parseSpy).toHaveBeenCalledTimes(0);

    setStreaming(false);
    await vi.waitFor(() => {
      expect(parseSpy.mock.calls.length).toBeGreaterThan(0);
    });
    parseSpy.mockRestore();
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
    setText("scrolling-phase");
    await vi.advanceTimersByTimeAsync(120);
    expect(container.textContent).not.toContain("scrolling-phase");

    await vi.advanceTimersByTimeAsync(130);
    await vi.waitFor(() => {
      expect(container.textContent).toContain("scrolling-phase");
    });

    setScrolling(false);
    setText("idle-phase");
    await vi.advanceTimersByTimeAsync(80);
    await vi.waitFor(() => {
      expect(container.textContent).toContain("idle-phase");
    });
  });
});
