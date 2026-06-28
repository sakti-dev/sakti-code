import { render } from "solid-js/web";
import { afterEach, describe, expect, it } from "vitest";
import type { VelomarkContainerRendererProps } from "../../../types";
import { RenderInline } from "../render-inline";

const mountedRoots: Array<() => void> = [];

afterEach(() => {
  while (mountedRoots.length > 0) {
    mountedRoots.pop()?.();
  }
  document.body.innerHTML = "";
});

describe("RenderInline", () => {
  it("renders links with safe external attributes", () => {
    const host = document.createElement("div");
    document.body.append(host);

    const dispose = render(
      () => <RenderInline text="Open [docs](https://example.com)" />,
      host
    );
    mountedRoots.push(dispose);

    const link = host.querySelector("a");
    expect(link?.getAttribute("href")).toBe("https://example.com");
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("renders strikethrough inline tokens", () => {
    const host = document.createElement("div");
    document.body.append(host);

    const dispose = render(
      () => <RenderInline text="Use ~~old~~ behavior" />,
      host
    );
    mountedRoots.push(dispose);

    const strike = host.querySelector("del");
    expect(strike?.textContent).toBe("old");
  });

  it("renders inline images with alt and lazy loading", () => {
    const host = document.createElement("div");
    document.body.append(host);

    const dispose = render(
      () => (
        <RenderInline text="Logo ![alt text](https://example.com/logo.png)" />
      ),
      host
    );
    mountedRoots.push(dispose);

    const image = host.querySelector("img");
    expect(image?.getAttribute("src")).toBe("https://example.com/logo.png");
    expect(image?.getAttribute("alt")).toBe("alt text");
    expect(image?.getAttribute("loading")).toBe("lazy");
  });

  it("renders resolved reference-style links", () => {
    const host = document.createElement("div");
    document.body.append(host);

    const dispose = render(
      () => (
        <RenderInline
          definitions={{ guide: { href: "https://example.com/guide" } }}
          text="Open [docs][guide]"
        />
      ),
      host
    );
    mountedRoots.push(dispose);

    const link = host.querySelector("a");
    expect(link?.getAttribute("href")).toBe("https://example.com/guide");
    expect(link?.textContent).toBe("docs");
  });

  it("renders collapsed reference-style links with titles", () => {
    const host = document.createElement("div");
    document.body.append(host);

    const dispose = render(
      () => (
        <RenderInline
          definitions={{
            docs: { href: "https://example.com/guide", title: "Guide" },
          }}
          text="Open [docs][]"
        />
      ),
      host
    );
    mountedRoots.push(dispose);

    const link = host.querySelector("a");
    expect(link?.getAttribute("href")).toBe("https://example.com/guide");
    expect(link?.getAttribute("title")).toBe("Guide");
    expect(link?.textContent).toBe("docs");
  });

  it("renders shortcut reference-style images with titles", () => {
    const host = document.createElement("div");
    document.body.append(host);

    const dispose = render(
      () => (
        <RenderInline
          definitions={{
            logo: {
              href: "https://example.com/logo.png",
              title: "Brand logo",
            },
          }}
          text="Logo ![logo]"
        />
      ),
      host
    );
    mountedRoots.push(dispose);

    const image = host.querySelector("img");
    expect(image?.getAttribute("src")).toBe("https://example.com/logo.png");
    expect(image?.getAttribute("alt")).toBe("logo");
    expect(image?.getAttribute("title")).toBe("Brand logo");
  });

  it("renders unresolved shortcut references as plain text", () => {
    const host = document.createElement("div");
    document.body.append(host);

    const dispose = render(() => <RenderInline text="Open [docs]" />, host);
    mountedRoots.push(dispose);

    expect(host.querySelector("a")).toBeNull();
    expect(host.textContent).toBe("Open [docs]");
  });

  it("renders footnote references as superscript backlinks", () => {
    const host = document.createElement("div");
    document.body.append(host);

    const dispose = render(() => <RenderInline text="Alpha[^1]" />, host);
    mountedRoots.push(dispose);

    const footnoteRef = host.querySelector("sup a");
    expect(footnoteRef?.getAttribute("href")).toBe("#fn-1");
    expect(footnoteRef?.getAttribute("id")).toBe("fnref-1");
    expect(footnoteRef?.textContent).toBe("[1]");
  });

  it("renders inline math with KaTeX when the formula is valid", async () => {
    const host = document.createElement("div");
    document.body.append(host);

    const dispose = render(
      () => <RenderInline text="Energy is $E = mc^2$ today" />,
      host
    );
    mountedRoots.push(dispose);

    const inlineMath = host.querySelector("[data-velomark-inline-math]");
    expect(inlineMath).not.toBeNull();

    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (inlineMath?.querySelector(".katex")) {
        break;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    }

    expect(inlineMath?.querySelector(".katex")).not.toBeNull();
    expect(inlineMath?.querySelector("code")).toBeNull();
  });

  it("falls back to source for invalid inline math", async () => {
    const host = document.createElement("div");
    document.body.append(host);

    const dispose = render(
      () => <RenderInline text={"Broken math $\\frac{1$"} />,
      host
    );
    mountedRoots.push(dispose);

    const inlineMath = host.querySelector("[data-velomark-inline-math]");
    expect(inlineMath).not.toBeNull();

    await new Promise((resolve) => window.setTimeout(resolve, 0));

    expect(inlineMath?.querySelector(".katex")).toBeNull();
    expect(inlineMath?.querySelector("code")?.textContent).toBe("\\frac{1");
  });

  it("renders raw inline html directly", () => {
    const host = document.createElement("div");
    document.body.append(host);

    const dispose = render(
      () => <RenderInline text="Text with <span>hi here" />,
      host
    );
    mountedRoots.push(dispose);

    const inlineHtml = host.querySelector("[data-velomark-inline-html]");
    expect(inlineHtml).not.toBeNull();
    expect(inlineHtml?.innerHTML).toBe("<span></span>");
  });

  it("renders structured inline html elements semantically", () => {
    const host = document.createElement("div");
    document.body.append(host);

    const dispose = render(
      () => <RenderInline text='Text with <span class="chip">hi</span> here' />,
      host
    );
    mountedRoots.push(dispose);

    const span = host.querySelector("span.chip");
    expect(span).not.toBeNull();
    expect(span?.textContent).toBe("hi");
    expect(host.querySelector("[data-velomark-inline-html]")).toBeNull();
  });

  it("renders markdown-like text inside structured inline html elements", async () => {
    const host = document.createElement("div");
    document.body.append(host);

    const dispose = render(
      () => (
        <RenderInline
          text={
            'Text with <span class="chip">**bold** and $E = mc^2$</span> here'
          }
        />
      ),
      host
    );
    mountedRoots.push(dispose);

    const chip = host.querySelector("span.chip");
    expect(chip).not.toBeNull();
    expect(chip?.querySelector("strong")?.textContent).toBe("bold");

    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (chip?.querySelector(".katex")) {
        break;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    }

    expect(chip?.querySelector(".katex")).not.toBeNull();
  });

  it("parses single-quoted html attributes on structured inline html elements", () => {
    const host = document.createElement("div");
    document.body.append(host);

    const dispose = render(
      () => (
        <RenderInline
          text={"Text with <span class='chip' data-tone='info'>hi</span> here"}
        />
      ),
      host
    );
    mountedRoots.push(dispose);

    const chip = host.querySelector("span.chip");
    expect(chip).not.toBeNull();
    expect(chip?.getAttribute("data-tone")).toBe("info");
    expect(chip?.textContent).toBe("hi");
  });

  it("renders text directives with inline content", () => {
    const host = document.createElement("div");
    document.body.append(host);

    const dispose = render(
      () => <RenderInline text='See :badge[Beta]{tone="info"} now' />,
      host
    );
    mountedRoots.push(dispose);

    const directive = host.querySelector(
      '[data-velomark-text-directive="badge"]'
    );
    expect(directive).not.toBeNull();
    expect(directive?.getAttribute("data-velomark-attr-tone")).toBe("info");
    expect(directive?.textContent).toBe("Beta");
  });

  it("parses mixed directive attribute quoting and preserves all default shell attributes", () => {
    const host = document.createElement("div");
    document.body.append(host);

    const dispose = render(
      () => (
        <RenderInline
          text={":badge[Beta]{tone='info' icon=bolt emphasis=\"high\"}"}
        />
      ),
      host
    );
    mountedRoots.push(dispose);

    const directive = host.querySelector(
      '[data-velomark-text-directive="badge"]'
    );
    expect(directive).not.toBeNull();
    expect(directive?.getAttribute("data-velomark-attr-tone")).toBe("info");
    expect(directive?.getAttribute("data-velomark-attr-icon")).toBe("bolt");
    expect(directive?.getAttribute("data-velomark-attr-emphasis")).toBe("high");
  });

  it("allows custom renderers for text directives", () => {
    const host = document.createElement("div");
    document.body.append(host);

    const Badge = (props: VelomarkContainerRendererProps) => (
      <mark data-custom-inline={props.name} data-tone={props.attributes?.tone}>
        {props.children}
      </mark>
    );

    const dispose = render(
      () => (
        <RenderInline
          containers={{ badge: Badge }}
          text='See :badge[Beta]{tone="info"} now'
        />
      ),
      host
    );
    mountedRoots.push(dispose);

    const custom = host.querySelector("[data-custom-inline]");
    expect(custom?.getAttribute("data-custom-inline")).toBe("badge");
    expect(custom?.getAttribute("data-tone")).toBe("info");
    expect(custom?.textContent).toBe("Beta");
  });

  it("renders hard line break tokens as br elements", () => {
    const host = document.createElement("div");
    document.body.append(host);

    const dispose = render(() => <RenderInline text={"Alpha  \nBeta"} />, host);
    mountedRoots.push(dispose);

    const br = host.querySelector("br");
    expect(br).not.toBeNull();
    expect(host.textContent).toBe("AlphaBeta");
  });
});
