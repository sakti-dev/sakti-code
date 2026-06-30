import type { CodeBlockData } from "../parser/block-boundaries";
import type { RenderBlock } from "../types";

export type DraftRenderBlock<TData = unknown> = Omit<RenderBlock<TData>, "id">;

function hashString(input: string): string {
  let hash = 2_166_136_261;

  for (let index = 0; index < input.length; index += 1) {
    // biome-ignore lint/suspicious/noBitwiseOperators: FNV-1a hashing intentionally uses bitwise XOR.
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }

  // biome-ignore lint/suspicious/noBitwiseOperators: Converting to an unsigned 32-bit value is part of the hash algorithm.
  return (hash >>> 0).toString(36).padStart(8, "0").slice(0, 8);
}

function buildDeterministicId<TData>(block: DraftRenderBlock<TData>): string {
  return `b_${hashString(
    [block.kind, block.sourceStart, block.sourceEnd, block.fingerprint].join(":"),
  )}`;
}

function isStableMatch<TData>(
  previous: RenderBlock<TData> | undefined,
  next: DraftRenderBlock<TData>,
): previous is RenderBlock<TData> {
  return Boolean(
    previous &&
    previous.kind === next.kind &&
    previous.sourceStart === next.sourceStart &&
    previous.sourceEnd === next.sourceEnd &&
    previous.fingerprint === next.fingerprint,
  );
}

function isCodeGrowthMatch<TData>(
  previous: RenderBlock<TData> | undefined,
  next: DraftRenderBlock<TData>,
): previous is RenderBlock<TData> {
  if (previous?.kind !== "code" || next.kind !== "code") {
    return false;
  }

  const previousData = previous.data as CodeBlockData;
  const nextData = next.data as CodeBlockData;

  return (
    previous.sourceStart === next.sourceStart &&
    previousData.language === nextData.language &&
    nextData.code.startsWith(previousData.code)
  );
}

export function assignStableBlockIds<TData>(
  previousBlocks: RenderBlock<TData>[],
  nextBlocks: DraftRenderBlock<TData>[],
): RenderBlock<TData>[] {
  return nextBlocks.map((nextBlock, index) => {
    const previousBlock = previousBlocks[index];

    if (isStableMatch(previousBlock, nextBlock) || isCodeGrowthMatch(previousBlock, nextBlock)) {
      return {
        ...nextBlock,
        id: previousBlock.id,
      };
    }

    return {
      ...nextBlock,
      id: buildDeterministicId(nextBlock),
    };
  });
}
