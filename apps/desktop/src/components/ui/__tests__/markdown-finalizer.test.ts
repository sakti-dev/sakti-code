import { finalizeMarkdownInChunks, splitMarkdownBlocks } from "@/components/ui/markdown-finalizer";
import { describe, expect, it } from "vitest";

describe("markdown-finalizer", () => {
  it("splits markdown into stable blocks preserving fenced code", () => {
    const blocks = splitMarkdownBlocks("line 1\n\n```ts\nconst x = 1\n```\n\nline 2");
    expect(blocks.length).toBe(3);
    expect(blocks[1]).toContain("```ts");
    expect(blocks[1]).toContain("const x = 1");
  });

  it("finalizes markdown in multiple chunks under frame budget", async () => {
    const markdown = Array.from({ length: 20 }, (_, i) => `paragraph ${i}`).join("\n\n");
    const result = await finalizeMarkdownInChunks(
      markdown,
      async block => {
        const start = performance.now();
        while (performance.now() - start < 2) {
          // busy work
        }
        return `<p>${block}</p>`;
      },
      async html => html,
      { chunkSize: 1, frameBudgetMs: 1 }
    );

    expect(result.html).toContain("paragraph 0");
    expect(result.batches).toBeGreaterThan(1);
    expect(result.yields).toBeGreaterThan(0);
  });
});
