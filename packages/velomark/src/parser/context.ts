const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const BLOCKQUOTE_RE = /^>\s?(.*)$/;
const ORDERED_LIST_RE = /^\s*\d+\.\s+(.*)$/;
const UNORDERED_LIST_RE = /^\s*[-*+]\s+(.*)$/;
const ORDERED_LIST_DETAIL_RE = /^(\s*)\d+\.\s+(.*)$/;
const UNORDERED_LIST_DETAIL_RE = /^(\s*)[-*+]\s+(.*)$/;
const TASK_LIST_RE = /^\[( |x|X)\]\s+(.*)$/;
const FENCE_RE = /^```([A-Za-z0-9_-]+)?\s*$/;
const THEMATIC_BREAK_RE = /^(?:-{3,}|\*{3,}|_{3,})\s*$/;
const TABLE_SEPARATOR_RE = /^\|?[:\- ]+\|[:\-| ]+\|?$/;
const PIPE_RE = /\|/g;

export function isBlankLine(line: string): boolean {
  return line.trim().length === 0;
}

export function matchHeading(line: string): RegExpMatchArray | null {
  return line.match(HEADING_RE);
}

export function matchBlockquote(line: string): RegExpMatchArray | null {
  return line.match(BLOCKQUOTE_RE);
}

export function matchOrderedList(line: string): RegExpMatchArray | null {
  return line.match(ORDERED_LIST_RE);
}

export function matchUnorderedList(line: string): RegExpMatchArray | null {
  return line.match(UNORDERED_LIST_RE);
}

export function matchOrderedListDetail(
  line: string
): { indent: number; text: string } | null {
  const match = line.match(ORDERED_LIST_DETAIL_RE);
  if (!match) {
    return null;
  }
  return {
    indent: match[1]?.length ?? 0,
    text: match[2] ?? "",
  };
}

export function matchUnorderedListDetail(
  line: string
): { indent: number; text: string } | null {
  const match = line.match(UNORDERED_LIST_DETAIL_RE);
  if (!match) {
    return null;
  }
  return {
    indent: match[1]?.length ?? 0,
    text: match[2] ?? "",
  };
}

export function matchFence(line: string): RegExpMatchArray | null {
  return line.match(FENCE_RE);
}

export function matchTaskListItem(
  text: string
): { checked: boolean; text: string } | null {
  const match = text.match(TASK_LIST_RE);
  if (!match) {
    return null;
  }
  return {
    checked: (match[1] ?? " ") !== " ",
    text: match[2] ?? "",
  };
}

export function isThematicBreak(line: string): boolean {
  return THEMATIC_BREAK_RE.test(line.trim());
}

export function isTableSeparator(line: string): boolean {
  const trimmed = line.trim();
  return TABLE_SEPARATOR_RE.test(trimmed);
}

export function looksLikeTableRow(line: string): boolean {
  const trimmed = line.trim();
  return (
    trimmed.includes("|") && trimmed.replace(PIPE_RE, "").trim().length > 0
  );
}
