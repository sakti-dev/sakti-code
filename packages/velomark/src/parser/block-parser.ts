import type { DraftRenderBlock } from "../model/stable-id";
import type { ReferenceDefinitionMap } from "../types";
import { type ParsedBlockData, parseBlockBoundaries } from "./block-boundaries";

const REFERENCE_DEFINITION_RE =
  /^\[([^\]]+)\]:\s+(\S+?)(?:\s+(?:"([^"]*)"|'([^']*)'|\(([^)]*)\)))?\s*$/;
const FOOTNOTE_DEFINITION_RE = /^\[\^([^\]]+)\]:\s?(.*)$/;

function normalizeReferenceId(identifier: string): string {
  return identifier.trim().toLowerCase();
}

export function extractReferenceDefinitions(markdown: string): {
  content: string;
  definitions: ReferenceDefinitionMap;
} {
  const definitions: ReferenceDefinitionMap = {};
  const keptLines: string[] = [];

  for (const line of markdown.split("\n")) {
    const match = line.match(REFERENCE_DEFINITION_RE);
    if (!match) {
      keptLines.push(line);
      continue;
    }

    const identifier = match[1];
    const href = match[2];
    if (!(identifier && href)) {
      keptLines.push(line);
      continue;
    }

    const title = match[3] ?? match[4] ?? match[5];
    definitions[normalizeReferenceId(identifier)] = title
      ? { href, title }
      : { href };
  }

  return {
    content: keptLines.join("\n"),
    definitions,
  };
}

function stripContinuationIndent(line: string): string {
  if (line.startsWith("\t")) {
    return line.slice(1);
  }
  if (line.startsWith("    ")) {
    return line.slice(4);
  }
  return line;
}

function extractFootnoteDefinitions(markdown: string): {
  content: string;
  footnoteDefinitions: Record<string, DraftRenderBlock<ParsedBlockData>[]>;
} {
  const footnoteDefinitions: Record<
    string,
    DraftRenderBlock<ParsedBlockData>[]
  > = {};
  const lines = markdown.split("\n");
  const keptLines: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const match = line.match(FOOTNOTE_DEFINITION_RE);
    if (!match) {
      keptLines.push(line);
      continue;
    }

    const identifier = match[1];
    const firstLine = match[2] ?? "";
    if (!identifier) {
      keptLines.push(line);
      continue;
    }

    const bodyLines = [firstLine];
    let scanIndex = index + 1;

    while (scanIndex < lines.length) {
      const continuationLine = lines[scanIndex] ?? "";
      if (FOOTNOTE_DEFINITION_RE.test(continuationLine)) {
        break;
      }
      if (continuationLine.trim().length === 0) {
        bodyLines.push("");
        scanIndex += 1;
        continue;
      }
      if (
        continuationLine.startsWith("    ") ||
        continuationLine.startsWith("\t")
      ) {
        bodyLines.push(stripContinuationIndent(continuationLine));
        scanIndex += 1;
        continue;
      }
      break;
    }

    footnoteDefinitions[identifier] = parseBlockBoundaries(
      bodyLines.join("\n")
    );
    index = scanIndex - 1;
  }

  return {
    content: keptLines.join("\n"),
    footnoteDefinitions,
  };
}

export function parseMarkdownToBlocks(markdown: string): {
  blocks: DraftRenderBlock<ParsedBlockData>[];
  definitions: ReferenceDefinitionMap;
  footnoteDefinitions: Record<string, DraftRenderBlock<ParsedBlockData>[]>;
} {
  const extractedReferences = extractReferenceDefinitions(markdown);
  const extractedFootnotes = extractFootnoteDefinitions(
    extractedReferences.content
  );
  return {
    blocks: parseBlockBoundaries(extractedFootnotes.content),
    definitions: extractedReferences.definitions,
    footnoteDefinitions: extractedFootnotes.footnoteDefinitions,
  };
}
