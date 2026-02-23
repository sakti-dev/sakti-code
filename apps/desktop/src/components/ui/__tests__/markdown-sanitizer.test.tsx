import { sanitizeMarkdownHtml } from "@/components/ui/markdown-sanitizer";
import { describe, expect, it } from "vitest";

describe("markdown-sanitizer", () => {
  it("sanitizes unsafe attributes and javascript hrefs", async () => {
    const sanitized = await sanitizeMarkdownHtml(
      '<img src=x onerror="alert(1)"><a href="javascript:alert(1)">x</a><p>ok</p>'
    );

    expect(sanitized).toContain("<p>ok</p>");
    expect(sanitized).not.toContain("onerror");
    expect(sanitized).not.toContain("javascript:");
  });

  it("keeps allowed markdown html", async () => {
    const sanitized = await sanitizeMarkdownHtml(
      '<pre data-language="ts"><code>const x = 1;</code></pre><span style="color:red">x</span>'
    );

    expect(sanitized).toContain("<pre");
    expect(sanitized).toContain("data-language=");
    expect(sanitized).toContain("style=");
  });
});
