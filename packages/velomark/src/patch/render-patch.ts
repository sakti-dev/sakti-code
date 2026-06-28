import type { ParsedBlockData } from "../parser/block-boundaries";
import type { RenderBlock, RenderDocument } from "../types";

export interface RenderPatch {
  nextBlocks: RenderBlock<ParsedBlockData>[];
  replaceFromIndex: number;
  unchangedPrefixCount: number;
}

function areSameBlock(
  left: RenderBlock<ParsedBlockData> | undefined,
  right: RenderBlock<ParsedBlockData> | undefined
): boolean {
  return Boolean(left && right && left.id === right.id);
}

export function planRenderPatch(
  previous: RenderDocument<ParsedBlockData> | undefined,
  next: RenderDocument<ParsedBlockData>
): RenderPatch {
  const previousBlocks = previous?.blocks ?? [];
  const nextBlocks = next.blocks;

  let unchangedPrefixCount = 0;
  while (
    unchangedPrefixCount < previousBlocks.length &&
    unchangedPrefixCount < nextBlocks.length &&
    areSameBlock(
      previousBlocks[unchangedPrefixCount],
      nextBlocks[unchangedPrefixCount]
    )
  ) {
    unchangedPrefixCount += 1;
  }

  return {
    unchangedPrefixCount,
    replaceFromIndex: unchangedPrefixCount,
    nextBlocks: nextBlocks.slice(unchangedPrefixCount),
  };
}
