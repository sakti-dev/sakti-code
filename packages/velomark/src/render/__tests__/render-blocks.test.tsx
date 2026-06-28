import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { VelomarkContainerRendererProps } from "../../types";
import { Velomark } from "../velomark";

const mountedRoots: Array<() => void> = [];

const waitFor = async (
  predicate: () => boolean,
  attempts = 100
): Promise<void> => {
  for (let index = 0; index < attempts; index += 1) {
    if (predicate()) {
      return;
    }

    await new Promise((resolve) => window.setTimeout(resolve, 0));
  }

  throw new Error("Condition was not met before waitFor timed out.");
};

afterEach(() => {
  vi.useRealTimers();
  while (mountedRoots.length > 0) {
    mountedRoots.pop()?.();
  }
  document.body.innerHTML = "";
});

describe("Velomark block rendering", () => {
  it("renders supported block kinds with semantic elements", () => {
    const host = document.createElement("div");
    document.body.append(host);

    const markdown = [
      "# Heading",
      "",
      "Paragraph with **strong** and `code`.",
      "",
      "> Quote line",
      "",
      "1. One",
      "2. Two",
      "",
      "```ts",
      "const x = 1;",
      "```",
      "",
      "---",
      "",
      "| Name | Value |",
      "| --- | --- |",
      "| A | 1 |",
    ].join("\n");

    const dispose = render(() => <Velomark markdown={markdown} />, host);
    mountedRoots.push(dispose);

    expect(host.querySelector("h1")?.textContent).toBe("Heading");
    expect(host.querySelector("p strong")?.textContent).toBe("strong");
    expect(host.querySelector("p code")?.textContent).toBe("code");
    expect(host.querySelector("blockquote")?.textContent).toBe("Quote line");
    expect(host.querySelectorAll("blockquote > p")).toHaveLength(1);
    expect(host.querySelector("ol")).not.toBeNull();
    expect(host.querySelectorAll("ol > li")).toHaveLength(2);
    expect(host.querySelector("pre > code")?.textContent).toBe("const x = 1;");
    expect(host.querySelector("hr")).not.toBeNull();
    expect(host.querySelectorAll("table thead th")).toHaveLength(2);
    expect(host.querySelectorAll("table tbody tr")).toHaveLength(1);
    expect(host.querySelector("[data-velomark-block-id]")).toBeNull();
  });

  it("preserves an unchanged heading node across later tail updates", async () => {
    const host = document.createElement("div");
    document.body.append(host);

    const [markdown, setMarkdown] = createSignal("# Heading");
    const dispose = render(() => <Velomark markdown={markdown()} />, host);
    mountedRoots.push(dispose);

    const headingBefore = host.querySelector("h1");
    expect(headingBefore?.textContent).toBe("Heading");

    setMarkdown("# Heading\n\nTail paragraph");
    await Promise.resolve();

    const headingAfter = host.querySelector("h1");
    expect(headingAfter).toBe(headingBefore);
    expect(headingAfter?.textContent).toBe("Heading");
  });

  it("renders blockquotes as paragraph children instead of inline line breaks", () => {
    const host = document.createElement("div");
    document.body.append(host);

    const markdown = [
      "> First quoted paragraph",
      ">",
      "> Second quoted paragraph",
    ].join("\n");

    const dispose = render(() => <Velomark markdown={markdown} />, host);
    mountedRoots.push(dispose);

    const paragraphs = Array.from(host.querySelectorAll("blockquote > p"));
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0]?.textContent).toBe("First quoted paragraph");
    expect(paragraphs[1]?.textContent).toBe("Second quoted paragraph");
    expect(host.querySelector("blockquote br")).toBeNull();
  });

  it("renders task list items with disabled checkboxes", () => {
    const host = document.createElement("div");
    document.body.append(host);

    const dispose = render(
      () => <Velomark markdown={["- [ ] Todo", "- [x] Done"].join("\n")} />,
      host
    );
    mountedRoots.push(dispose);

    const checkboxes = Array.from(
      host.querySelectorAll('ul input[type="checkbox"]')
    ) as HTMLInputElement[];
    expect(checkboxes).toHaveLength(2);
    expect(checkboxes[0]?.disabled).toBe(true);
    expect(checkboxes[0]?.checked).toBe(false);
    expect(checkboxes[1]?.disabled).toBe(true);
    expect(checkboxes[1]?.checked).toBe(true);
    expect(host.textContent).toContain("Todo");
    expect(host.textContent).toContain("Done");
  });

  it("renders code blocks with overlay controls and a floating language badge", () => {
    const host = document.createElement("div");
    document.body.append(host);

    const dispose = render(
      () => <Velomark markdown={"```ts\nconst answer = 42;\n```"} />,
      host
    );
    mountedRoots.push(dispose);

    const shell = host.querySelector('[data-velomark-block-kind="code"]');
    expect(shell?.tagName).toBe("DIV");
    expect(shell?.querySelector("[data-velomark-code-header]")).toBeNull();
    expect(
      shell?.querySelector("[data-velomark-code-language]")?.textContent
    ).toBe("ts");
    expect(shell?.querySelector("pre > code")?.textContent).toBe(
      "const answer = 42;"
    );
    const copyButton = shell?.querySelector(
      "[data-velomark-code-copy]"
    ) as HTMLButtonElement | null;
    expect(copyButton).not.toBeNull();
    expect(copyButton?.getAttribute("aria-label")).toBe("Copy code");
    expect(
      copyButton?.querySelector('[data-velomark-code-copy-icon="copy"]')
    ).not.toBeNull();
  });

  it("renders highlighted code tokens for supported languages", async () => {
    const host = document.createElement("div");
    document.body.append(host);

    const dispose = render(
      () => <Velomark markdown={"```ts\nconst answer = 42;\n```"} />,
      host
    );
    mountedRoots.push(dispose);

    await waitFor(
      () =>
        (host.querySelectorAll("[data-velomark-code-highlighted] span")
          .length ?? 0) > 0,
      500
    );

    const shell = host.querySelector('[data-velomark-block-kind="code"]');
    const highlighted = shell?.querySelector(
      "[data-velomark-code-highlighted]"
    );
    expect(highlighted).not.toBeNull();
    expect(
      shell?.querySelectorAll("[data-velomark-code-highlighted] span").length
    ).toBeGreaterThan(0);
    expect(
      highlighted?.querySelectorAll(":scope > span").length
    ).toBeGreaterThan(1);
  });

  it("omits the language badge and header for unlabeled code fences", () => {
    const host = document.createElement("div");
    document.body.append(host);

    const dispose = render(
      () => <Velomark markdown={"```\nplain text\n```"} />,
      host
    );
    mountedRoots.push(dispose);

    const shell = host.querySelector('[data-velomark-block-kind="code"]');
    expect(shell?.querySelector("[data-velomark-code-header]")).toBeNull();
    expect(shell?.querySelector("[data-velomark-code-language]")).toBeNull();
    expect(shell?.querySelector("pre > code")?.textContent).toBe("plain text");
    expect(shell?.querySelector("[data-velomark-code-copy]")).not.toBeNull();
  });

  it("allows default code block copy controls to be disabled", () => {
    const host = document.createElement("div");
    document.body.append(host);

    const dispose = render(
      () => (
        <Velomark
          codeBlockOptions={{ copyButton: false }}
          markdown={"```ts\nconst answer = 42;\n```"}
        />
      ),
      host
    );
    mountedRoots.push(dispose);

    const shell = host.querySelector('[data-velomark-block-kind="code"]');
    expect(
      shell?.querySelector("[data-velomark-code-language]")?.textContent
    ).toBe("ts");
    expect(shell?.querySelector("[data-velomark-code-copy]")).toBeNull();
  });

  it("shows copied feedback after the copy action succeeds", async () => {
    vi.useFakeTimers();
    const clipboard = {
      writeText: vi.fn(async () => undefined),
    };
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: clipboard,
    });

    const host = document.createElement("div");
    document.body.append(host);

    const dispose = render(
      () => <Velomark markdown={"```ts\nconst answer = 42;\n```"} />,
      host
    );
    mountedRoots.push(dispose);

    const copyButton = host.querySelector(
      "[data-velomark-code-copy]"
    ) as HTMLButtonElement | null;
    expect(
      copyButton?.querySelector('[data-velomark-code-copy-icon="copy"]')
    ).not.toBeNull();

    copyButton?.click();
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1);

    expect(clipboard.writeText).toHaveBeenCalledWith("const answer = 42;");
    expect(
      host
        .querySelector("[data-velomark-code-copy]")
        ?.getAttribute("aria-label")
    ).toBe("Copied code");
    expect(
      host.querySelector('[data-velomark-code-copy-icon="check"]')
    ).not.toBeNull();

    await vi.advanceTimersByTimeAsync(2000);

    expect(
      host
        .querySelector("[data-velomark-code-copy]")
        ?.getAttribute("aria-label")
    ).toBe("Copy code");
    expect(
      host.querySelector('[data-velomark-code-copy-icon="copy"]')
    ).not.toBeNull();
  });

  it("renders tables with a generic wrapper and column alignment", () => {
    const host = document.createElement("div");
    document.body.append(host);

    const dispose = render(
      () => (
        <Velomark
          markdown={[
            "| Left | Center | Right |",
            "| :--- | :----: | ---: |",
            "| A | B | C |",
          ].join("\n")}
        />
      ),
      host
    );
    mountedRoots.push(dispose);

    const wrapper = host.querySelector("[data-velomark-table-wrapper]");
    expect(wrapper).not.toBeNull();

    const headers = Array.from(host.querySelectorAll("thead th"));
    expect(headers).toHaveLength(3);
    expect(headers[0]?.getAttribute("data-velomark-align")).toBe("left");
    expect(headers[1]?.getAttribute("data-velomark-align")).toBe("center");
    expect(headers[2]?.getAttribute("data-velomark-align")).toBe("right");

    const cells = Array.from(host.querySelectorAll("tbody td"));
    expect(cells).toHaveLength(3);
    expect(cells[0]?.getAttribute("data-velomark-align")).toBe("left");
    expect(cells[1]?.getAttribute("data-velomark-align")).toBe("center");
    expect(cells[2]?.getAttribute("data-velomark-align")).toBe("right");
  });

  it("renders nested unordered lists inside list items", () => {
    const host = document.createElement("div");
    document.body.append(host);

    const dispose = render(
      () => (
        <Velomark
          markdown={[
            "- Parent",
            "  - Child A",
            "  - Child B",
            "- Sibling",
          ].join("\n")}
        />
      ),
      host
    );
    mountedRoots.push(dispose);

    const topLevelItems = host.querySelectorAll(":scope > .velomark > ul > li");
    expect(topLevelItems).toHaveLength(2);

    const nestedItems = host.querySelectorAll("ul ul > li");
    expect(nestedItems).toHaveLength(2);
    expect(nestedItems[0]?.textContent).toContain("Child A");
    expect(nestedItems[1]?.textContent).toContain("Child B");
  });

  it("resolves reference-style links and images at the document level", () => {
    const host = document.createElement("div");
    document.body.append(host);

    const dispose = render(
      () => (
        <Velomark
          markdown={[
            "See [docs][guide] and ![logo][brand].",
            "",
            "[guide]: https://example.com/guide",
            "[brand]: https://example.com/logo.png",
          ].join("\n")}
        />
      ),
      host
    );
    mountedRoots.push(dispose);

    const link = host.querySelector("p a");
    expect(link?.getAttribute("href")).toBe("https://example.com/guide");
    expect(link?.textContent).toBe("docs");

    const image = host.querySelector("p img");
    expect(image?.getAttribute("src")).toBe("https://example.com/logo.png");
    expect(image?.getAttribute("alt")).toBe("logo");
    expect(host.textContent).not.toContain("[guide]:");
    expect(host.textContent).not.toContain("[brand]:");
  });

  it("resolves collapsed and shortcut references at the document level with titles", () => {
    const host = document.createElement("div");
    document.body.append(host);

    const dispose = render(
      () => (
        <Velomark
          markdown={[
            "Open [docs][] and ![logo].",
            "",
            '[docs]: https://example.com/guide "Guide"',
            '[logo]: https://example.com/logo.png "Brand logo"',
          ].join("\n")}
        />
      ),
      host
    );
    mountedRoots.push(dispose);

    const link = host.querySelector("p a");
    expect(link?.getAttribute("href")).toBe("https://example.com/guide");
    expect(link?.getAttribute("title")).toBe("Guide");
    expect(link?.textContent).toBe("docs");

    const image = host.querySelector("p img");
    expect(image?.getAttribute("src")).toBe("https://example.com/logo.png");
    expect(image?.getAttribute("title")).toBe("Brand logo");
    expect(image?.getAttribute("alt")).toBe("logo");
  });

  it("renders footnotes in first-reference order with backlinks", () => {
    const host = document.createElement("div");
    document.body.append(host);

    const dispose = render(
      () => (
        <Velomark
          markdown={[
            "Alpha[^b] and beta[^a].",
            "",
            "[^a]: First footnote body.",
            "[^b]: Second footnote body.",
          ].join("\n")}
        />
      ),
      host
    );
    mountedRoots.push(dispose);

    const footnotes = host.querySelector("[data-velomark-footnotes]");
    expect(footnotes).not.toBeNull();

    const items = Array.from(
      host.querySelectorAll("[data-velomark-footnotes] ol > li")
    );
    expect(items).toHaveLength(2);
    expect(items[0]?.getAttribute("id")).toBe("fn-b");
    expect(items[0]?.textContent).toContain("Second footnote body.");
    expect(items[1]?.getAttribute("id")).toBe("fn-a");
    expect(items[1]?.textContent).toContain("First footnote body.");

    const backref = items[0]?.querySelector('a[href="#fnref-b"]');
    expect(backref?.textContent).toBe("↩");
  });

  it("renders multiline footnote bodies with nested lists", () => {
    const host = document.createElement("div");
    document.body.append(host);

    const dispose = render(
      () => (
        <Velomark
          markdown={[
            "Alpha[^list].",
            "",
            "[^list]: Intro paragraph.",
            "",
            "    - Item one",
            "    - Item two",
            "",
            "    Closing paragraph.",
          ].join("\n")}
        />
      ),
      host
    );
    mountedRoots.push(dispose);

    const footnoteItem = host.querySelector("#fn-list");
    expect(footnoteItem).not.toBeNull();
    expect(footnoteItem?.querySelectorAll("p")).toHaveLength(2);
    expect(footnoteItem?.querySelectorAll("ul > li")).toHaveLength(2);
    expect(footnoteItem?.textContent).toContain("Intro paragraph.");
    expect(footnoteItem?.textContent).toContain("Closing paragraph.");
  });

  it("renders block math with KaTeX when the formula is valid", async () => {
    const host = document.createElement("div");
    document.body.append(host);

    const dispose = render(
      () => (
        <Velomark
          markdown={["$$", "E = mc^2 + \\frac{a}{b}", "$$"].join("\n")}
        />
      ),
      host
    );
    mountedRoots.push(dispose);

    const mathBlock = host.querySelector('[data-velomark-block-kind="math"]');
    expect(mathBlock).not.toBeNull();

    await waitFor(() => mathBlock?.querySelector(".katex-display") !== null);

    expect(mathBlock?.querySelector(".katex-display")).not.toBeNull();
    expect(mathBlock?.querySelector("pre > code")).toBeNull();
  });

  it("renders single-line block math", async () => {
    const host = document.createElement("div");
    document.body.append(host);

    const dispose = render(() => <Velomark markdown={"$$E = mc^2$$"} />, host);
    mountedRoots.push(dispose);

    const mathBlock = host.querySelector('[data-velomark-block-kind="math"]');
    expect(mathBlock).not.toBeNull();
    await waitFor(() => mathBlock?.querySelector(".katex-display") !== null);
    expect(mathBlock?.querySelector(".katex-display")).not.toBeNull();
  });

  it("falls back to source for invalid block math", async () => {
    const host = document.createElement("div");
    document.body.append(host);

    const dispose = render(() => <Velomark markdown={"$$\\frac{1$$"} />, host);
    mountedRoots.push(dispose);

    const mathBlock = host.querySelector('[data-velomark-block-kind="math"]');
    expect(mathBlock).not.toBeNull();

    await Promise.resolve();

    expect(mathBlock?.querySelector(".katex-display")).toBeNull();
    expect(mathBlock?.querySelector("pre > code")?.textContent).toBe(
      "\\frac{1"
    );
  });

  it("renders mermaid code blocks directly as diagram blocks", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const svgPrototype = window.SVGElement.prototype as SVGElement & {
      getBBox?: () => DOMRect;
    };

    if (typeof svgPrototype.getBBox !== "function") {
      svgPrototype.getBBox = () =>
        ({
          bottom: 24,
          height: 24,
          left: 0,
          right: 96,
          toJSON: () => ({}),
          top: 0,
          width: 96,
          x: 0,
          y: 0,
        }) as DOMRect;
    }

    const dispose = render(
      () => <Velomark markdown={"```mermaid\ngraph TD\nA-->B\n```"} />,
      host
    );
    mountedRoots.push(dispose);

    const mermaidBlock = host.querySelector("[data-velomark-mermaid]");
    expect(mermaidBlock).not.toBeNull();
    expect(mermaidBlock?.getAttribute("data-velomark-language")).toBe(
      "mermaid"
    );
    await waitFor(() => {
      const diagram = mermaidBlock?.querySelector(
        "[data-velomark-mermaid-diagram]"
      );
      return Boolean(diagram?.querySelector("svg"));
    }, 200);

    expect(
      mermaidBlock?.querySelector("[data-velomark-mermaid-diagram]")
    ).not.toBeNull();
    expect(mermaidBlock?.querySelector("svg")).not.toBeNull();
    expect(mermaidBlock?.querySelector("pre > code")).toBeNull();
    expect(mermaidBlock?.querySelector("pre")).toBeNull();
    expect(mermaidBlock?.querySelector("code")).toBeNull();
    expect(
      mermaidBlock?.querySelector("[data-velomark-code-header]")
    ).toBeNull();
    expect(
      mermaidBlock?.querySelector("[data-velomark-code-view-toggle]")
    ).toBeNull();
    expect(mermaidBlock?.querySelector("[data-velomark-code-copy]")).toBeNull();
  });

  it("keeps mermaid fences as source blocks until the stream closes the fence", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const svgPrototype = window.SVGElement.prototype as SVGElement & {
      getBBox?: () => DOMRect;
    };

    if (typeof svgPrototype.getBBox !== "function") {
      svgPrototype.getBBox = () =>
        ({
          bottom: 24,
          height: 24,
          left: 0,
          right: 96,
          toJSON: () => ({}),
          top: 0,
          width: 96,
          x: 0,
          y: 0,
        }) as DOMRect;
    }

    const [markdown, setMarkdown] = createSignal("```mermaid\ngraph TD\nA-->B");
    const dispose = render(() => <Velomark markdown={markdown()} />, host);
    mountedRoots.push(dispose);

    const mermaidBlock = host.querySelector("[data-velomark-mermaid]");
    expect(mermaidBlock).not.toBeNull();
    expect(
      mermaidBlock?.querySelector("[data-velomark-mermaid-diagram]")
    ).toBeNull();
    expect(mermaidBlock?.querySelector("pre > code")?.textContent).toContain(
      "graph TD"
    );

    setMarkdown("```mermaid\ngraph TD\nA-->B\n```");

    await waitFor(() => {
      const diagram = mermaidBlock?.querySelector(
        "[data-velomark-mermaid-diagram]"
      );
      return Boolean(diagram?.querySelector("svg"));
    }, 200);

    expect(
      mermaidBlock?.querySelector("[data-velomark-mermaid-diagram]")
    ).not.toBeNull();
    expect(mermaidBlock?.querySelector("pre")).toBeNull();
  });

  it("falls back to bare source when mermaid rendering fails", async () => {
    const host = document.createElement("div");
    document.body.append(host);

    const dispose = render(
      () => <Velomark markdown={"```mermaid\nnot a valid diagram\n```"} />,
      host
    );
    mountedRoots.push(dispose);

    await Promise.resolve();
    await Promise.resolve();

    const mermaidBlock = host.querySelector("[data-velomark-mermaid]");
    expect(mermaidBlock).not.toBeNull();
    expect(
      mermaidBlock?.querySelector("[data-velomark-mermaid-diagram]")
    ).toBeNull();
    expect(
      mermaidBlock?.querySelector("[data-velomark-code-header]")
    ).toBeNull();
    expect(mermaidBlock?.querySelector("[data-velomark-code-copy]")).toBeNull();
    expect(mermaidBlock?.querySelector("pre > code")?.textContent).toContain(
      "not a valid diagram"
    );
  });

  it("allows language-specific custom code block renderers", () => {
    const host = document.createElement("div");
    document.body.append(host);

    const MermaidOverride = (props: { code: string; language?: string }) => (
      <div data-custom-mermaid={props.language ?? ""}>{props.code}</div>
    );

    const dispose = render(
      () => (
        <Velomark
          codeBlockRenderers={{ mermaid: MermaidOverride }}
          markdown={"```mermaid\ngraph TD\nA-->B\n```"}
        />
      ),
      host
    );
    mountedRoots.push(dispose);

    const custom = host.querySelector("[data-custom-mermaid]");
    expect(custom?.getAttribute("data-custom-mermaid")).toBe("mermaid");
    expect(custom?.textContent).toContain("graph TD");
    expect(host.querySelector("[data-velomark-mermaid]")).toBeNull();
  });

  it("renders raw html blocks as explicit source shells", () => {
    const host = document.createElement("div");
    document.body.append(host);

    const dispose = render(
      () => <Velomark markdown={"<div>Alpha</div><div>Beta</div>"} />,
      host
    );
    mountedRoots.push(dispose);

    const htmlBlock = host.querySelector('[data-velomark-block-kind="html"]');
    expect(htmlBlock).not.toBeNull();
    expect(htmlBlock?.querySelector("pre > code")?.textContent).toBe(
      "<div>Alpha</div><div>Beta</div>"
    );
  });

  it("renders simple html element blocks structurally", () => {
    const host = document.createElement("div");
    document.body.append(host);

    const dispose = render(
      () => <Velomark markdown={'<div class="note"><p>Alpha</p></div>'} />,
      host
    );
    mountedRoots.push(dispose);

    const element = host.querySelector(
      '[data-velomark-block-kind="html-element"]'
    );
    expect(element).not.toBeNull();
    expect(element?.querySelector("div.note")).not.toBeNull();
    expect(element?.querySelector("div.note > p")?.textContent).toBe("Alpha");
    expect(element?.querySelector("pre")).toBeNull();
  });

  it("renders markdown-like text inside structured html element blocks", async () => {
    const host = document.createElement("div");
    document.body.append(host);

    const dispose = render(
      () => (
        <Velomark
          markdown={
            "<div class='note'><p>Use **bold** and [docs](https://example.com) with $E = mc^2$.</p></div>"
          }
        />
      ),
      host
    );
    mountedRoots.push(dispose);

    const element = host.querySelector(
      '[data-velomark-block-kind="html-element"]'
    );
    expect(element).not.toBeNull();
    expect(element?.querySelector("div.note p strong")?.textContent).toBe(
      "bold"
    );
    expect(element?.querySelector("div.note p a")?.getAttribute("href")).toBe(
      "https://example.com"
    );

    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (element?.querySelector(".katex")) {
        break;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    }

    expect(element?.querySelector(".katex")).not.toBeNull();
  });

  it("renders container directives with nested markdown content", () => {
    const host = document.createElement("div");
    document.body.append(host);

    const dispose = render(
      () => (
        <Velomark
          markdown={[
            ':::info{title="Information"}',
            "Alpha paragraph.",
            "",
            "- Item one",
            "- Item two",
            ":::",
          ].join("\n")}
        />
      ),
      host
    );
    mountedRoots.push(dispose);

    const container = host.querySelector('[data-velomark-container="info"]');
    expect(container).not.toBeNull();
    expect(container?.getAttribute("data-velomark-attr-title")).toBe(
      "Information"
    );
    expect(container?.querySelector("p")?.textContent).toBe("Alpha paragraph.");
    expect(container?.querySelectorAll("ul > li")).toHaveLength(2);
  });

  it("preserves mixed quoted directive attributes on default block shells", () => {
    const host = document.createElement("div");
    document.body.append(host);

    const dispose = render(
      () => (
        <Velomark
          markdown={[
            ":::info{title='Information' tone=info emphasis=\"high\"}",
            "Alpha paragraph.",
            ":::",
            "",
            "::callout{title='Heads up' tone=warn}",
          ].join("\n")}
        />
      ),
      host
    );
    mountedRoots.push(dispose);

    const container = host.querySelector('[data-velomark-container="info"]');
    expect(container).not.toBeNull();
    expect(container?.getAttribute("data-velomark-attr-title")).toBe(
      "Information"
    );
    expect(container?.getAttribute("data-velomark-attr-tone")).toBe("info");
    expect(container?.getAttribute("data-velomark-attr-emphasis")).toBe("high");

    const leaf = host.querySelector('[data-velomark-leaf-directive="callout"]');
    expect(leaf).not.toBeNull();
    expect(leaf?.getAttribute("data-velomark-attr-title")).toBe("Heads up");
    expect(leaf?.getAttribute("data-velomark-attr-tone")).toBe("warn");
  });

  it("allows custom container renderers by directive name", () => {
    const host = document.createElement("div");
    document.body.append(host);

    const InfoContainer = (props: VelomarkContainerRendererProps) => (
      <section
        data-custom-container={props.name}
        data-title={props.attributes?.title}
      >
        {props.children}
      </section>
    );

    const dispose = render(
      () => (
        <Velomark
          containers={{ info: InfoContainer }}
          markdown={[
            ':::info{title="Information"}',
            "Alpha paragraph.",
            ":::",
          ].join("\n")}
        />
      ),
      host
    );
    mountedRoots.push(dispose);

    const custom = host.querySelector("[data-custom-container]");
    expect(custom?.getAttribute("data-custom-container")).toBe("info");
    expect(custom?.getAttribute("data-title")).toBe("Information");
    expect(custom?.textContent).toContain("Alpha paragraph.");
    expect(host.querySelector('[data-velomark-container="info"]')).toBeNull();
  });

  it("renders leaf directives as standalone container shells", () => {
    const host = document.createElement("div");
    document.body.append(host);

    const dispose = render(
      () => <Velomark markdown={'::callout{title="Heads up"}'} />,
      host
    );
    mountedRoots.push(dispose);

    const directive = host.querySelector(
      '[data-velomark-leaf-directive="callout"]'
    );
    expect(directive).not.toBeNull();
    expect(directive?.getAttribute("data-velomark-attr-title")).toBe(
      "Heads up"
    );
  });
});
