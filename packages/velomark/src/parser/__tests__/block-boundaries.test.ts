import { describe, expect, it } from "vitest";
import { parseBlockBoundaries } from "../block-boundaries";

describe("parseBlockBoundaries", () => {
  it("parses headings, paragraphs, blockquotes, lists, code fences, thematic breaks, and tables", () => {
    const markdown = [
      "# Heading",
      "",
      "Paragraph text",
      "",
      "> Quote line 1",
      "> Quote line 2",
      "",
      "- First item",
      "- Second item",
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

    const blocks = parseBlockBoundaries(markdown);

    expect(blocks.map((block) => block.kind)).toEqual([
      "heading",
      "paragraph",
      "blockquote",
      "list",
      "code",
      "thematic-break",
      "table",
    ]);

    expect(blocks[0]?.data).toMatchObject({
      depth: 1,
      text: "Heading",
    });
    expect(blocks[1]?.data).toMatchObject({
      text: "Paragraph text",
    });
    expect(blocks[2]?.data).toMatchObject({
      paragraphs: ["Quote line 1\nQuote line 2"],
      text: "Quote line 1\nQuote line 2",
    });
    expect(blocks[3]?.data).toMatchObject({
      ordered: false,
      items: [{ text: "First item" }, { text: "Second item" }],
    });
    expect(blocks[4]?.data).toMatchObject({
      language: "ts",
      code: "const x = 1;",
    });
    expect(blocks[5]?.data).toMatchObject({});
    expect(blocks[6]?.data).toMatchObject({
      align: ["left", "left"],
      rows: [
        ["Name", "Value"],
        ["A", "1"],
      ],
    });
  });

  it("parses ordered lists separately from unordered lists", () => {
    const blocks = parseBlockBoundaries(["1. One", "2. Two"].join("\n"));

    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.kind).toBe("list");
    expect(blocks[0]?.data).toMatchObject({
      ordered: true,
      items: [{ text: "One" }, { text: "Two" }],
    });
  });

  it("marks an unterminated code fence as streaming", () => {
    const blocks = parseBlockBoundaries(["```ts", "const x = 1;"].join("\n"));

    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.kind).toBe("code");
    expect(blocks[0]?.status).toBe("streaming");
  });

  it("preserves quoted paragraph boundaries", () => {
    const blocks = parseBlockBoundaries(
      ["> First quoted paragraph", ">", "> Second quoted paragraph"].join("\n")
    );

    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.kind).toBe("blockquote");
    expect(blocks[0]?.data).toMatchObject({
      paragraphs: ["First quoted paragraph", "Second quoted paragraph"],
      text: "First quoted paragraph\n\nSecond quoted paragraph",
    });
  });

  it("parses task list item state", () => {
    const blocks = parseBlockBoundaries(
      ["- [ ] Todo", "- [x] Done"].join("\n")
    );

    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.kind).toBe("list");
    expect(blocks[0]?.data).toMatchObject({
      ordered: false,
      items: [
        { checked: false, text: "Todo" },
        { checked: true, text: "Done" },
      ],
    });
  });

  it("parses nested unordered lists inside list items", () => {
    const blocks = parseBlockBoundaries(
      ["- Parent", "  - Child A", "  - Child B", "- Sibling"].join("\n")
    );

    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.kind).toBe("list");
    expect(blocks[0]?.data).toMatchObject({
      ordered: false,
      items: [
        {
          text: "Parent",
          children: [
            {
              kind: "list",
              data: {
                ordered: false,
                items: [{ text: "Child A" }, { text: "Child B" }],
              },
            },
          ],
        },
        { text: "Sibling" },
      ],
    });
  });

  it("parses table column alignment from the separator row", () => {
    const blocks = parseBlockBoundaries(
      [
        "| Left | Center | Right |",
        "| :--- | :----: | ---: |",
        "| A | B | C |",
      ].join("\n")
    );

    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.kind).toBe("table");
    expect(blocks[0]?.data).toMatchObject({
      align: ["left", "center", "right"],
      rows: [
        ["Left", "Center", "Right"],
        ["A", "B", "C"],
      ],
    });
  });
});
