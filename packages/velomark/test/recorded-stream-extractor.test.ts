import { describe, expect, it } from "vitest";
// @ts-expect-error local node script helper is imported only for test/runtime verification
import { extractMarkdownFromRecordedChunks } from "../scripts/extract-recorded-stream-markdown-lib.mjs";

describe("recorded stream markdown extractor", () => {
  it("reconstructs markdown from text-delta chunks only", () => {
    const markdown = extractMarkdownFromRecordedChunks([
      'data: {"type":"data-thought","id":"0","data":{"text":"thinking"}}\n\n',
      'data: {"type":"text-delta","id":"run","delta":"# Title\\n\\n"}\n\n',
      'data: {"type":"text-delta","id":"run","delta":"Hello"}\n\n',
      'data: {"type":"data-state","id":"state","data":{"state":"completed"}}\n\n',
      'data: {"type":"text-delta","id":"run","delta":" world"}\n\n',
    ]);

    expect(markdown).toBe("# Title\n\nHello world");
  });
});
