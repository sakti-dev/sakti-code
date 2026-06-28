import type {
  BlockquoteBlockData,
  HeadingBlockData,
  ListBlockData,
  ParagraphBlockData,
  ParsedBlockData,
  TableBlockData,
} from "../parser/block-boundaries";
import { parseMarkdownToBlocks } from "../parser/block-parser";
import { parseInline } from "../parser/inline-parser";
import type {
  InlineToken,
  RenderBlock,
  RenderDocument,
  VelomarkDebugMetrics,
} from "../types";
import type { DraftRenderBlock } from "./stable-id";
import { assignStableBlockIds } from "./stable-id";

function canReuseBlock<TData>(
  previous: RenderBlock<TData> | undefined,
  next: RenderBlock<TData>
): previous is RenderBlock<TData> {
  return Boolean(
    previous &&
      previous.id === next.id &&
      previous.kind === next.kind &&
      previous.sourceStart === next.sourceStart &&
      previous.sourceEnd === next.sourceEnd &&
      previous.fingerprint === next.fingerprint
  );
}

export function buildRenderDocument(
  previousDocument: RenderDocument<ParsedBlockData> | undefined,
  markdown: string
): RenderDocument<ParsedBlockData> {
  const previousBlocks = previousDocument?.blocks ?? [];
  const previousFootnoteDefinitions =
    previousDocument?.footnoteDefinitions ?? {};
  const {
    blocks: draftBlocks,
    definitions,
    footnoteDefinitions: draftFootnoteDefinitions,
  } = parseMarkdownToBlocks(markdown);
  const nextBlocksWithIds = assignStableBlockIds(previousBlocks, draftBlocks);
  const blocks = nextBlocksWithIds.map((block, index) => {
    const previousBlock = previousBlocks[index];
    return canReuseBlock(previousBlock, block) ? previousBlock : block;
  });
  const footnoteDefinitions = Object.fromEntries(
    Object.entries(draftFootnoteDefinitions).map(
      ([identifier, draftBlocks]) => {
        const previousFootnoteBlocks =
          previousFootnoteDefinitions[identifier] ?? [];
        const nextBlocks = assignStableBlockIds(
          previousFootnoteBlocks,
          draftBlocks
        ).map((block, index) => {
          const previousBlock = previousFootnoteBlocks[index];
          return canReuseBlock(previousBlock, block) ? previousBlock : block;
        });

        return [identifier, nextBlocks];
      }
    )
  );
  const footnoteReferenceOrder = collectFootnoteReferenceOrder(
    blocks,
    definitions
  );

  return {
    blocks,
    definitions,
    footnoteDefinitions,
    footnoteReferenceOrder,
    version: (previousDocument?.version ?? 0) + 1,
  };
}

function collectInlineFootnoteReferences(
  tokens: InlineToken[],
  seen: Set<string>,
  order: string[]
): void {
  for (const token of tokens) {
    switch (token.type) {
      case "footnote-reference":
        if (!seen.has(token.identifier)) {
          seen.add(token.identifier);
          order.push(token.identifier);
        }
        break;
      case "delete":
      case "emphasis":
      case "strong":
        collectInlineFootnoteReferences(token.children, seen, order);
        break;
      case "link":
        collectInlineFootnoteReferences(token.children, seen, order);
        break;
      default:
        break;
    }
  }
}

function collectTextFragmentsFromList(
  block: ListBlockData,
  fragments: string[]
): void {
  for (const item of block.items) {
    fragments.push(item.text);
    for (const child of item.children ?? []) {
      collectTextFragmentsFromList(child.data, fragments);
    }
  }
}

function collectBlockTextFragments(
  block: RenderBlock<ParsedBlockData>,
  fragments: string[]
): void {
  switch (block.kind) {
    case "paragraph":
    case "heading":
      fragments.push(
        (block as RenderBlock<ParagraphBlockData | HeadingBlockData>).data.text
      );
      break;
    case "blockquote":
      fragments.push(
        ...(block as RenderBlock<BlockquoteBlockData>).data.paragraphs
      );
      break;
    case "list":
      collectTextFragmentsFromList(
        (block as RenderBlock<ListBlockData>).data,
        fragments
      );
      break;
    case "table":
      for (const row of (block as RenderBlock<TableBlockData>).data.rows) {
        fragments.push(...row);
      }
      break;
    default:
      break;
  }
}

function collectFootnoteReferenceOrder(
  blocks: RenderBlock<ParsedBlockData>[],
  definitions: RenderDocument<ParsedBlockData>["definitions"]
): string[] {
  const seen = new Set<string>();
  const order: string[] = [];
  const fragments: string[] = [];

  for (const block of blocks) {
    fragments.length = 0;
    collectBlockTextFragments(block, fragments);
    for (const fragment of fragments) {
      collectInlineFootnoteReferences(
        parseInline(fragment, definitions),
        seen,
        order
      );
    }
  }

  return order;
}

export function collectRenderMetrics<TData>(
  previousBlocks: Array<DraftRenderBlock<TData> | RenderBlock<TData>>,
  nextBlocks: Array<DraftRenderBlock<TData> | RenderBlock<TData>>
): VelomarkDebugMetrics {
  let reusedBlockCount = 0;
  let appendedBlockCount = 0;
  let replacedBlockCount = 0;

  for (let index = 0; index < nextBlocks.length; index += 1) {
    const previousBlock = previousBlocks[index];
    const nextBlock = nextBlocks[index];

    if (!nextBlock) {
      continue;
    }

    if (
      previousBlock &&
      previousBlock.kind === nextBlock.kind &&
      previousBlock.sourceStart === nextBlock.sourceStart &&
      previousBlock.sourceEnd === nextBlock.sourceEnd &&
      previousBlock.fingerprint === nextBlock.fingerprint
    ) {
      reusedBlockCount += 1;
      continue;
    }

    if (!previousBlock) {
      appendedBlockCount += 1;
      continue;
    }

    replacedBlockCount += 1;
  }

  return {
    appendedBlockCount,
    blockCount: nextBlocks.length,
    replacedBlockCount,
    reusedBlockCount,
  };
}
