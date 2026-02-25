import { render } from "@solidjs/testing-library";
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

describe("Markdown singleton/highlighter behavior", () => {
  let container: HTMLDivElement;
  let dispose: (() => void) | undefined;

  beforeEach(() => {
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
      expect(container.querySelectorAll("pre code").length).toBeGreaterThanOrEqual(3);
    });
    expect(createHighlighterMock.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it("loads incremark theme css", async () => {
    const themeModule = await import("@incremark/theme/styles.css");
    expect(themeModule).toBeDefined();
  });

  it("renders markdown with incremark base theme classes applied", async () => {
    const { Markdown } = await import("@/components/ui/markdown");
    ({ unmount: dispose } = render(() => <Markdown text="x" />, { container }));
    await vi.waitFor(() => {
      expect(container.querySelector('[data-component="markdown"]')).not.toBeNull();
    });
  });

  it("renders markdown correctly when app dark mode is active", async () => {
    const { Markdown } = await import("@/components/ui/markdown");
    document.documentElement.classList.add("dark");

    ({ unmount: dispose } = render(() => <Markdown text="x" />, { container }));

    await vi.waitFor(() => {
      const provider = container.querySelector(".incremark-theme-provider");
      expect(provider).not.toBeNull();
      expect(container.textContent).toContain("x");
    });

    document.documentElement.classList.remove("dark");
  });

  it("renders plain markdown through incremark", async () => {
    const { Markdown } = await import("@/components/ui/markdown");
    ({ unmount: dispose } = render(() => <Markdown text="Hello **world**" isStreaming={false} />, {
      container,
    }));
    await vi.waitFor(() => {
      expect(container.textContent).toContain("Hello");
      expect(container.textContent).toContain("world");
    });
  });

  it("blocks raw html node rendering by default", async () => {
    const { Markdown } = await import("@/components/ui/markdown");
    ({ unmount: dispose } = render(
      () => <Markdown text={'safe\n<div data-xss="1">unsafe</div>'} isStreaming={false} />,
      {
        container,
      }
    ));
    await vi.waitFor(() => {
      expect(container.textContent).toContain("safe");
    });
    expect(container.querySelector('[data-xss="1"]')).toBeNull();
  });

  it("renders fenced code blocks with pre and code nodes", async () => {
    const { Markdown } = await import("@/components/ui/markdown");
    ({ unmount: dispose } = render(
      () => <Markdown text={"```ts\nconst answer = 42\n```"} isStreaming={false} />,
      {
        container,
      }
    ));
    await vi.waitFor(() => {
      expect(container.querySelector("pre")).not.toBeNull();
      expect(container.querySelector("code")).not.toBeNull();
    });
  });

  it("preserves data-component attribute for selectors", async () => {
    const { Markdown } = await import("@/components/ui/markdown");
    ({ unmount: dispose } = render(() => <Markdown text="x" />, { container }));
    await vi.waitFor(() => {
      expect(container.querySelector('[data-component="markdown"]')).not.toBeNull();
    });
  });
});
