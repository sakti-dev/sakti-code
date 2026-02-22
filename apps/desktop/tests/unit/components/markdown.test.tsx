import { render } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createHighlighterMock = vi.fn(async () => ({
  codeToHtml: (code: string) => `<pre><code>${code}</code></pre>`,
}));

vi.mock("shiki", () => ({
  createHighlighter: createHighlighterMock,
}));

describe("Markdown singleton/highlighter behavior", () => {
  let container: HTMLDivElement;
  let dispose: (() => void) | undefined;

  beforeEach(() => {
    vi.resetModules();
    createHighlighterMock.mockClear();
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    dispose?.();
    document.body.removeChild(container);
  });

  it("does not initialize shiki for plain text markdown", async () => {
    const { Markdown } = await import("@/components/ui/markdown");

    ({ unmount: dispose } = render(
      () => (
        <>
          <Markdown text="hello world" />
          <Markdown text="just plain content" />
          <Markdown text="**bold** _text_" />
        </>
      ),
      { container }
    ));
    await vi.waitFor(() => {
      expect(container.textContent).toContain("hello world");
      expect(container.textContent).toContain("plain content");
    });

    expect(createHighlighterMock).toHaveBeenCalledTimes(0);
  });

  it("initializes shiki only once for concurrent code-block markdown", async () => {
    const { Markdown } = await import("@/components/ui/markdown");
    const code = "```ts\nconst a = 1;\n```";

    ({ unmount: dispose } = render(
      () => (
        <>
          <Markdown text={code} />
          <Markdown text={code} />
          <Markdown text={code} />
        </>
      ),
      { container }
    ));
    await vi.waitFor(() => {
      expect(createHighlighterMock).toHaveBeenCalledTimes(1);
    });
  });
});
