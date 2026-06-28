import { describe, expect, it } from "vitest";
import { parseInline } from "../inline-parser";

describe("parseInline", () => {
  it("parses plain text as a single text token", () => {
    expect(parseInline("Hello world")).toEqual([
      { type: "text", text: "Hello world" },
    ]);
  });

  it("parses inline code", () => {
    expect(parseInline("Use `pnpm test` now")).toEqual([
      { type: "text", text: "Use " },
      { type: "code", text: "pnpm test" },
      { type: "text", text: " now" },
    ]);
  });

  it("parses emphasis and strong tokens", () => {
    expect(parseInline("Mix *em* and **strong** text")).toEqual([
      { type: "text", text: "Mix " },
      { type: "emphasis", children: [{ type: "text", text: "em" }] },
      { type: "text", text: " and " },
      { type: "strong", children: [{ type: "text", text: "strong" }] },
      { type: "text", text: " text" },
    ]);
  });

  it("parses underscore emphasis and strong tokens", () => {
    expect(parseInline("Mix _em_ and __strong__ text")).toEqual([
      { type: "text", text: "Mix " },
      { type: "emphasis", children: [{ type: "text", text: "em" }] },
      { type: "text", text: " and " },
      { type: "strong", children: [{ type: "text", text: "strong" }] },
      { type: "text", text: " text" },
    ]);
  });

  it("parses inline links", () => {
    expect(parseInline("Open [docs](https://example.com)")).toEqual([
      { type: "text", text: "Open " },
      {
        type: "link",
        href: "https://example.com",
        children: [{ type: "text", text: "docs" }],
      },
    ]);
  });

  it("parses inline images", () => {
    expect(
      parseInline("Logo ![alt text](https://example.com/logo.png)")
    ).toEqual([
      { type: "text", text: "Logo " },
      {
        type: "image",
        alt: "alt text",
        src: "https://example.com/logo.png",
      },
    ]);
  });

  it("resolves reference-style links with provided definitions", () => {
    expect(
      parseInline("Open [docs][guide]", {
        guide: { href: "https://example.com/guide" },
      })
    ).toEqual([
      { type: "text", text: "Open " },
      {
        type: "link",
        href: "https://example.com/guide",
        children: [{ type: "text", text: "docs" }],
      },
    ]);
  });

  it("resolves reference-style images with provided definitions", () => {
    expect(
      parseInline("Logo ![alt text][logo]", {
        logo: { href: "https://example.com/logo.png" },
      })
    ).toEqual([
      { type: "text", text: "Logo " },
      {
        type: "image",
        alt: "alt text",
        src: "https://example.com/logo.png",
      },
    ]);
  });

  it("resolves collapsed reference-style links with provided definitions", () => {
    expect(
      parseInline("Open [docs][]", {
        docs: { href: "https://example.com/guide" },
      })
    ).toEqual([
      { type: "text", text: "Open " },
      {
        type: "link",
        href: "https://example.com/guide",
        children: [{ type: "text", text: "docs" }],
      },
    ]);
  });

  it("resolves collapsed reference-style images with provided definitions", () => {
    expect(
      parseInline("Logo ![alt text][]", {
        "alt text": {
          href: "https://example.com/logo.png",
          title: "Brand logo",
        },
      })
    ).toEqual([
      { type: "text", text: "Logo " },
      {
        type: "image",
        alt: "alt text",
        src: "https://example.com/logo.png",
        title: "Brand logo",
      },
    ]);
  });

  it("resolves shortcut reference-style links only when a matching definition exists", () => {
    expect(
      parseInline("Open [docs]", {
        docs: {
          href: "https://example.com/guide",
          title: "Guide",
        },
      })
    ).toEqual([
      { type: "text", text: "Open " },
      {
        type: "link",
        href: "https://example.com/guide",
        title: "Guide",
        children: [{ type: "text", text: "docs" }],
      },
    ]);
  });

  it("resolves shortcut reference-style images only when a matching definition exists", () => {
    expect(
      parseInline("Logo ![logo]", {
        logo: { href: "https://example.com/logo.png" },
      })
    ).toEqual([
      { type: "text", text: "Logo " },
      {
        type: "image",
        alt: "logo",
        src: "https://example.com/logo.png",
      },
    ]);
  });

  it("falls back to plain text for unresolved collapsed references", () => {
    expect(parseInline("Open [docs][]")).toEqual([
      { type: "text", text: "Open [docs][]" },
    ]);
  });

  it("falls back to plain text for unresolved shortcut references", () => {
    expect(parseInline("Open [docs]")).toEqual([
      { type: "text", text: "Open [docs]" },
    ]);
  });

  it("preserves escaped punctuation as literal text", () => {
    expect(parseInline(String.raw`\*literal\* \[link\]`)).toEqual([
      { type: "text", text: "*literal* [link]" },
    ]);
  });

  it("parses mixed inline content deterministically", () => {
    expect(
      parseInline("See **docs** at [site](https://example.com) and `run`")
    ).toEqual([
      { type: "text", text: "See " },
      { type: "strong", children: [{ type: "text", text: "docs" }] },
      { type: "text", text: " at " },
      {
        type: "link",
        href: "https://example.com",
        children: [{ type: "text", text: "site" }],
      },
      { type: "text", text: " and " },
      { type: "code", text: "run" },
    ]);
  });

  it("parses strikethrough tokens", () => {
    expect(parseInline("Use ~~old~~ behavior")).toEqual([
      { type: "text", text: "Use " },
      { type: "delete", children: [{ type: "text", text: "old" }] },
      { type: "text", text: " behavior" },
    ]);
  });

  it("parses hard line breaks from trailing double spaces", () => {
    expect(parseInline("Alpha  \nBeta")).toEqual([
      { type: "text", text: "Alpha" },
      { type: "break" },
      { type: "text", text: "Beta" },
    ]);
  });

  it("parses hard line breaks from escaped newlines", () => {
    expect(parseInline("Alpha\\\nBeta")).toEqual([
      { type: "text", text: "Alpha" },
      { type: "break" },
      { type: "text", text: "Beta" },
    ]);
  });

  it("parses footnote references inline", () => {
    expect(parseInline("Alpha[^1] Beta")).toEqual([
      { type: "text", text: "Alpha" },
      { type: "footnote-reference", identifier: "1" },
      { type: "text", text: " Beta" },
    ]);
  });

  it("parses inline math with dollar delimiters", () => {
    expect(parseInline("Energy is $E = mc^2$ today")).toEqual([
      { type: "text", text: "Energy is " },
      { type: "inline-math", value: "E = mc^2" },
      { type: "text", text: " today" },
    ]);
  });

  it("does not parse unmatched price markers as inline math", () => {
    expect(parseInline("Price is $100")).toEqual([
      { type: "text", text: "Price is $100" },
    ]);
  });

  it("parses raw inline html as a dedicated token", () => {
    expect(parseInline("Text with <span>hi here")).toEqual([
      { type: "text", text: "Text with " },
      { type: "html", value: "<span>" },
      { type: "text", text: "hi here" },
    ]);
  });

  it("parses simple inline html elements as structured tokens", () => {
    expect(parseInline('Text with <span class="chip">hi</span> here')).toEqual([
      { type: "text", text: "Text with " },
      {
        type: "html-element",
        tagName: "span",
        attributes: { class: "chip" },
        children: [{ type: "text", text: "hi" }],
      },
      { type: "text", text: " here" },
    ]);
  });
});
