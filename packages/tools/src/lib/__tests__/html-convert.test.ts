import { describe, expect, it } from "vite-plus/test";
import { convertHTMLToMarkdown, extractTextFromHTML } from "../html-convert.ts";

describe("convertHTMLToMarkdown", () => {
  it("converts headings to atx", () => {
    expect(convertHTMLToMarkdown("<h1>Title</h1><h2>Sub</h2>")).toBe("# Title\n\n## Sub");
  });

  it("converts bold to **", () => {
    expect(convertHTMLToMarkdown("<p>Hello <b>world</b></p>")).toBe("Hello **world**");
  });

  it("strips script bodies", () => {
    expect(convertHTMLToMarkdown("<p>x</p><script>alert(1)</script>")).toBe("x");
  });

  it("strips style/meta/link", () => {
    expect(convertHTMLToMarkdown('<meta charset="utf-8"><style>p{}</style><p>y</p>')).toBe("y");
  });
});

describe("extractTextFromHTML", () => {
  it("strips tags and keeps text", () => {
    expect(extractTextFromHTML("<p>Hello <b>world</b></p>")).toBe("Hello world");
  });

  it("excludes script/style/noscript/iframe content", () => {
    const html =
      "<p>visible</p><script>s1</script><style>s2</style><noscript>s3</noscript><iframe>s4</iframe>";
    expect(extractTextFromHTML(html)).toBe("visible");
  });

  it("trims surrounding whitespace", () => {
    expect(extractTextFromHTML("  <p>  hi  </p>  ")).toBe("hi");
  });
});
