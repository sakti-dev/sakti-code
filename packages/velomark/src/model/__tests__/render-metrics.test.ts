import { describe, expect, it } from "vitest";
import { parseMarkdownToBlocks } from "../../parser/block-parser";
import { collectRenderMetrics } from "../render-document";

describe("render metrics", () => {
  it("reports reused and appended blocks for append-only updates", () => {
    const previousBlocks = parseMarkdownToBlocks("Alpha").blocks;
    const nextBlocks = parseMarkdownToBlocks("Alpha\n\nBeta").blocks;

    const metrics = collectRenderMetrics(previousBlocks, nextBlocks);

    expect(metrics.blockCount).toBe(2);
    expect(metrics.reusedBlockCount).toBe(1);
    expect(metrics.appendedBlockCount).toBe(1);
    expect(metrics.replacedBlockCount).toBe(0);
  });

  it("reports replaced suffix blocks for tail rewrites", () => {
    const previousBlocks = parseMarkdownToBlocks("Alpha\n\nBeta").blocks;
    const nextBlocks = parseMarkdownToBlocks("Alpha\n\nGamma").blocks;

    const metrics = collectRenderMetrics(previousBlocks, nextBlocks);

    expect(metrics.blockCount).toBe(2);
    expect(metrics.reusedBlockCount).toBe(1);
    expect(metrics.replacedBlockCount).toBe(1);
    expect(metrics.appendedBlockCount).toBe(0);
  });
});
