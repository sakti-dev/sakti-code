import type {
  Anchor,
  ApplyResult,
  Cursor,
  Edit,
} from "../../lib/hashline-utils/types";
import {
  afterInsertLandingShiftWarning,
  blockInsertLandingShiftWarning,
  UNRESOLVED_BLOCK_INTERNAL,
} from "./messages";
import { cloneCursor } from "./tokenizer";

type LineOrigin = "original" | "insert" | "replacement";

type InsertEdit = Extract<Edit, { kind: "insert" }>;
type DeleteEdit = Extract<Edit, { kind: "delete" }>;
type AppliedEdit = InsertEdit | DeleteEdit;

interface IndexedEdit {
  edit: AppliedEdit;
  idx: number;
}

function isReplacementInsert(
  edit: Edit
): edit is InsertEdit & { mode: "replacement" } {
  return edit.kind === "insert" && edit.mode === "replacement";
}

function getCursorAnchors(cursor: Cursor): Anchor[] {
  return cursor.kind === "before_anchor" || cursor.kind === "after_anchor"
    ? [cursor.anchor]
    : [];
}

function getEditAnchors(edit: AppliedEdit): Anchor[] {
  if (edit.kind === "delete") {
    return [edit.anchor];
  }
  return getCursorAnchors(edit.cursor);
}

function trailingPhantomLine(fileLines: readonly string[]): number {
  return fileLines.length > 1 && fileLines[fileLines.length - 1] === ""
    ? fileLines.length
    : 0;
}

function dropTrailingPhantomDeletes(
  edits: AppliedEdit[],
  fileLines: readonly string[]
): AppliedEdit[] {
  const phantomLine = trailingPhantomLine(fileLines);
  if (phantomLine === 0) {
    return edits;
  }
  return edits.filter(
    (edit) => edit.kind !== "delete" || edit.anchor.line !== phantomLine
  );
}

function validateLineBounds(
  edits: readonly AppliedEdit[],
  fileLines: readonly string[]
): void {
  for (const edit of edits) {
    for (const anchor of getEditAnchors(edit)) {
      if (anchor.line < 1 || anchor.line > fileLines.length) {
        throw new Error(
          `Line ${anchor.line} does not exist (file has ${fileLines.length} lines). Re-read the file to get current line numbers.`
        );
      }
    }
  }
}

function cloneAppliedEdit(edit: AppliedEdit, index: number): AppliedEdit {
  if (edit.kind === "delete") {
    return { ...edit, anchor: { ...edit.anchor }, index };
  }
  return { ...edit, cursor: cloneCursor(edit.cursor), index };
}

function insertAtStart(
  fileLines: string[],
  lineOrigins: LineOrigin[],
  lines: string[]
): void {
  if (lines.length === 0) {
    return;
  }
  const origins = lines.map((): LineOrigin => "insert");
  if (fileLines.length === 1 && fileLines[0] === "") {
    fileLines.splice(0, 1, ...lines);
    lineOrigins.splice(0, 1, ...origins);
    return;
  }
  fileLines.splice(0, 0, ...lines);
  lineOrigins.splice(0, 0, ...origins);
}

function insertAtEnd(
  fileLines: string[],
  lineOrigins: LineOrigin[],
  lines: string[]
): number | undefined {
  if (lines.length === 0) {
    return;
  }
  const origins = lines.map((): LineOrigin => "insert");
  if (fileLines.length === 1 && fileLines[0] === "") {
    fileLines.splice(0, 1, ...lines);
    lineOrigins.splice(0, 1, ...origins);
    return 1;
  }
  const hasTrailingNewline =
    fileLines.length > 0 && fileLines[fileLines.length - 1] === "";
  const insertIndex = hasTrailingNewline
    ? fileLines.length - 1
    : fileLines.length;
  fileLines.splice(insertIndex, 0, ...lines);
  lineOrigins.splice(insertIndex, 0, ...origins);
  return insertIndex + 1;
}

function bucketAnchorEditsByLine(
  edits: IndexedEdit[]
): Map<number, IndexedEdit[]> {
  const byLine = new Map<number, IndexedEdit[]>();
  for (const entry of edits) {
    const line =
      entry.edit.kind === "delete"
        ? entry.edit.anchor.line
        : entry.edit.cursor.kind === "before_anchor" ||
            entry.edit.cursor.kind === "after_anchor"
          ? entry.edit.cursor.anchor.line
          : 0;
    const bucket = byLine.get(line);
    if (bucket) {
      bucket.push(entry);
    } else {
      byLine.set(line, [entry]);
    }
  }
  return byLine;
}

export const STRUCTURAL_CLOSER_RE = /^\s*[)\]}]+[;,]?\s*$/;

const JSX_CLOSER_RE = /^\s*(?:<\/>|<\/[A-Za-z][\w.:-]*>|\/>)\s*[;,]?\s*$/;
const JSX_NAMED_CLOSER_RE = /^\s*<\/([A-Za-z][\w.:-]*)>\s*[;,]?\s*$/;
const JSX_FRAGMENT_CLOSER_RE = /^\s*<\/>\s*[;,]?\s*$/;

function isStructuralCloserLine(text: string): boolean {
  return STRUCTURAL_CLOSER_RE.test(text) || JSX_CLOSER_RE.test(text);
}

function jsxCloserName(text: string): string | undefined {
  if (JSX_FRAGMENT_CLOSER_RE.test(text)) {
    return "";
  }
  const match = JSX_NAMED_CLOSER_RE.exec(text);
  return match?.[1];
}

interface JsxPayloadTag {
  readonly closing: boolean;
  readonly name: string;
  readonly selfClosing: boolean;
}

function isJsxTagStart(text: string, index: number): boolean {
  const next = text[index + 1];
  if (!next) {
    return false;
  }
  return (
    next === ">" ||
    next === "/" ||
    (next >= "A" && next <= "Z") ||
    (next >= "a" && next <= "z")
  );
}

function findJsxTagEnd(text: string, start: number): number {
  let quote: string | undefined;
  let braces = 0;
  for (let i = start + 1; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === "\\" && i + 1 < text.length) {
        i++;
      } else if (ch === quote) {
        quote = undefined;
      }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
    } else if (ch === "{") {
      braces++;
    } else if (ch === "}" && braces > 0) {
      braces--;
    } else if (ch === ">" && braces === 0) {
      return i;
    }
  }
  return -1;
}

function parseJsxPayloadTag(raw: string): JsxPayloadTag | undefined {
  if (raw === "<>") {
    return { name: "", closing: false, selfClosing: false };
  }
  if (raw === "</>") {
    return { name: "", closing: true, selfClosing: false };
  }
  const closing = raw.startsWith("</");
  const nameStart = closing ? 2 : 1;
  let nameEnd = nameStart;
  while (nameEnd < raw.length && /[\w.:-]/.test(raw[nameEnd] ?? "")) {
    nameEnd++;
  }
  if (nameEnd === nameStart) {
    return;
  }
  return {
    name: raw.slice(nameStart, nameEnd),
    closing,
    selfClosing: !closing && /\/>\s*$/.test(raw),
  };
}

function readJsxPayloadTags(text: string): JsxPayloadTag[] {
  const tags: JsxPayloadTag[] = [];
  for (
    let start = text.indexOf("<");
    start >= 0;
    start = text.indexOf("<", start + 1)
  ) {
    if (!isJsxTagStart(text, start)) {
      continue;
    }
    const end = findJsxTagEnd(text, start);
    if (end < 0) {
      break;
    }
    const tag = parseJsxPayloadTag(text.slice(start, end + 1));
    if (tag) {
      tags.push(tag);
    }
    start = end;
  }
  return tags;
}

function payloadHasJsxOpenerForEcho(
  payloadPrefix: readonly string[],
  echoLines: readonly string[]
): boolean {
  const openTags: string[] = [];
  for (const tag of readJsxPayloadTags(payloadPrefix.join("\n"))) {
    if (tag.closing) {
      if (openTags[openTags.length - 1] === tag.name) {
        openTags.pop();
      }
    } else if (!tag.selfClosing) {
      openTags.push(tag.name);
    }
  }
  for (const line of echoLines) {
    const name = jsxCloserName(line);
    if (name !== undefined && openTags.includes(name)) {
      return true;
    }
  }
  return false;
}

interface DelimiterBalance {
  brace: number;
  bracket: number;
  paren: number;
}

function computeDelimiterBalance(lines: readonly string[]): DelimiterBalance {
  const balance: DelimiterBalance = { paren: 0, bracket: 0, brace: 0 };
  let inBlockComment = false;
  let quote = "";
  for (const line of lines) {
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inBlockComment) {
        if (ch === "*" && line[i + 1] === "/") {
          inBlockComment = false;
          i++;
        }
        continue;
      }
      if (quote) {
        if (ch === "\\") {
          i++;
        } else if (ch === quote) {
          quote = "";
        }
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") {
        quote = ch;
        continue;
      }
      if (ch === "/" && line[i + 1] === "/") {
        break;
      }
      if (ch === "/" && line[i + 1] === "*") {
        inBlockComment = true;
        i++;
        continue;
      }
      switch (ch) {
        case "(":
          balance.paren++;
          break;
        case ")":
          balance.paren--;
          break;
        case "[":
          balance.bracket++;
          break;
        case "]":
          balance.bracket--;
          break;
        case "{":
          balance.brace++;
          break;
        case "}":
          balance.brace--;
          break;
      }
    }
    if (quote === '"' || quote === "'") {
      quote = "";
    }
  }
  return balance;
}

function balanceDelta(
  a: DelimiterBalance,
  b: DelimiterBalance
): DelimiterBalance {
  return {
    paren: a.paren - b.paren,
    bracket: a.bracket - b.bracket,
    brace: a.brace - b.brace,
  };
}

function balanceNegate(a: DelimiterBalance): DelimiterBalance {
  return { paren: -a.paren, bracket: -a.bracket, brace: -a.brace };
}

function balanceEqual(a: DelimiterBalance, b: DelimiterBalance): boolean {
  return a.paren === b.paren && a.bracket === b.bracket && a.brace === b.brace;
}

function balanceIsZero(a: DelimiterBalance): boolean {
  return a.paren === 0 && a.bracket === 0 && a.brace === 0;
}

function balanceSum(
  a: DelimiterBalance,
  b: DelimiterBalance
): DelimiterBalance {
  return {
    paren: a.paren + b.paren,
    bracket: a.bracket + b.bracket,
    brace: a.brace + b.brace,
  };
}

function balanceComponentCovers(candidate: number, target: number): boolean {
  if (target === 0) {
    return true;
  }
  return (
    candidate > 0 === target > 0 && Math.abs(candidate) >= Math.abs(target)
  );
}

function balanceCovers(
  candidate: DelimiterBalance,
  target: DelimiterBalance
): boolean {
  return (
    balanceComponentCovers(candidate.paren, target.paren) &&
    balanceComponentCovers(candidate.bracket, target.bracket) &&
    balanceComponentCovers(candidate.brace, target.brace)
  );
}

interface ReplacementGroup {
  deleteIndices: number[];
  endLine: number;
  insertIndices: number[];
  payload: string[];
  startLine: number;
}

function findReplacementGroup(
  edits: readonly AppliedEdit[],
  start: number
): ReplacementGroup | undefined {
  const first = edits[start];
  if (
    first?.kind !== "insert" ||
    first.mode !== "replacement" ||
    first.cursor.kind !== "before_anchor"
  ) {
    return;
  }
  const { lineNum } = first;
  const anchorLine = first.cursor.anchor.line;
  const insertIndices: number[] = [];
  const payload: string[] = [];
  let i = start;
  for (; i < edits.length; i++) {
    const edit = edits[i];
    if (!edit) {
      break;
    }
    if (
      edit.kind !== "insert" ||
      edit.mode !== "replacement" ||
      edit.lineNum !== lineNum
    ) {
      break;
    }
    if (
      edit.cursor.kind !== "before_anchor" ||
      edit.cursor.anchor.line !== anchorLine
    ) {
      break;
    }
    insertIndices.push(i);
    payload.push(edit.text);
  }
  const deleteIndices: number[] = [];
  let expectedLine = anchorLine;
  for (; i < edits.length; i++) {
    const edit = edits[i];
    if (!edit) {
      break;
    }
    if (
      edit.kind !== "delete" ||
      edit.lineNum !== lineNum ||
      edit.anchor.line !== expectedLine
    ) {
      break;
    }
    deleteIndices.push(i);
    expectedLine++;
  }
  if (deleteIndices.length === 0) {
    return;
  }
  return {
    insertIndices,
    deleteIndices,
    payload,
    startLine: anchorLine,
    endLine: anchorLine + deleteIndices.length - 1,
  };
}

function findDuplicateSuffix(
  group: ReplacementGroup,
  fileLines: readonly string[],
  delta: DelimiterBalance
): number {
  if (balanceIsZero(delta)) {
    return 0;
  }
  const { payload, endLine } = group;
  const maxK = Math.min(payload.length, fileLines.length - endLine);
  for (let k = maxK; k >= 1; k--) {
    let matches = true;
    for (let t = 0; t < k; t++) {
      if (payload[payload.length - k + t] !== fileLines[endLine + t]) {
        matches = false;
        break;
      }
    }
    if (!matches) {
      continue;
    }
    if (
      balanceEqual(
        computeDelimiterBalance(payload.slice(payload.length - k)),
        delta
      )
    ) {
      return k;
    }
  }
  return 0;
}

function findDuplicatePrefix(
  group: ReplacementGroup,
  fileLines: readonly string[],
  delta: DelimiterBalance
): number {
  if (balanceIsZero(delta)) {
    return 0;
  }
  const { payload, startLine } = group;
  const maxJ = Math.min(payload.length, startLine - 1);
  for (let j = maxJ; j >= 1; j--) {
    let matches = true;
    for (let t = 0; t < j; t++) {
      if (payload[t] !== fileLines[startLine - 1 - j + t]) {
        matches = false;
        break;
      }
    }
    if (!matches) {
      continue;
    }
    if (balanceEqual(computeDelimiterBalance(payload.slice(0, j)), delta)) {
      return j;
    }
  }
  return 0;
}

interface DroppedSuffixClosers {
  readonly balance: DelimiterBalance;
  readonly count: number;
  readonly startLine: number;
}

function countPayloadRestatedSuffixHead(
  payload: readonly string[],
  suffixLines: readonly string[]
): number {
  const maxCount = Math.min(payload.length, suffixLines.length);
  for (let count = maxCount; count >= 1; count--) {
    let matches = true;
    for (let offset = 0; offset < count; offset++) {
      if (payload[payload.length - count + offset] !== suffixLines[offset]) {
        matches = false;
        break;
      }
    }
    if (matches) {
      return count;
    }
  }
  return 0;
}

interface InsertedLineMaps {
  readonly after: ReadonlyMap<number, readonly string[]>;
  readonly before: ReadonlyMap<number, readonly string[]>;
}

function countProjectedBelowSuffixTail(
  group: ReplacementGroup,
  fileLines: readonly string[],
  deletedLines: ReadonlySet<number>,
  insertedLineMaps: InsertedLineMaps,
  suffixLines: readonly string[]
): number {
  const below: string[] = [];
  const appendCloserLines = (lines: readonly string[] | undefined): boolean => {
    if (!lines) {
      return true;
    }
    for (const text of lines) {
      if (!STRUCTURAL_CLOSER_RE.test(text)) {
        return false;
      }
      below.push(text);
    }
    return true;
  };
  if (!appendCloserLines(insertedLineMaps.after.get(group.endLine))) {
    return 0;
  }
  for (let line = group.endLine + 1; line <= fileLines.length; line++) {
    if (!appendCloserLines(insertedLineMaps.before.get(line))) {
      break;
    }
    if (!deletedLines.has(line)) {
      const text = fileLines[line - 1] ?? "";
      if (!STRUCTURAL_CLOSER_RE.test(text)) {
        break;
      }
      below.push(text);
    }
    if (!appendCloserLines(insertedLineMaps.after.get(line))) {
      break;
    }
  }
  const maxCount = Math.min(below.length, suffixLines.length);
  for (let count = maxCount; count >= 1; count--) {
    let matches = true;
    for (let offset = 0; offset < count; offset++) {
      if (below[offset] !== suffixLines[suffixLines.length - count + offset]) {
        matches = false;
        break;
      }
    }
    if (matches) {
      return count;
    }
  }
  return 0;
}

function computeProjectedPrefixBalance(
  group: ReplacementGroup,
  fileLines: readonly string[],
  deletedLines: ReadonlySet<number>,
  insertedByLine: ReadonlyMap<number, readonly string[]>,
  insertedLineMaps: InsertedLineMaps
): DelimiterBalance {
  const prefix: string[] = [];
  for (let line = 1; line < group.startLine; line++) {
    const inserted = insertedByLine.get(line);
    if (inserted) {
      prefix.push(...inserted);
    }
    if (!deletedLines.has(line)) {
      prefix.push(fileLines[line - 1] ?? "");
    }
  }
  const insertedAtStart = insertedLineMaps.before.get(group.startLine);
  if (insertedAtStart) {
    prefix.push(...insertedAtStart);
  }
  prefix.push(...group.payload);
  return computeDelimiterBalance(prefix);
}

function prefixCanCoverSuffixClosers(
  group: ReplacementGroup,
  fileLines: readonly string[],
  suffixBalance: DelimiterBalance,
  coveredBelowBalance: DelimiterBalance,
  deletedLines: ReadonlySet<number>,
  insertedByLine: ReadonlyMap<number, readonly string[]>,
  insertedLineMaps: InsertedLineMaps
): boolean {
  const neededOpeners = balanceNegate(suffixBalance);
  const prefixBalance = computeProjectedPrefixBalance(
    group,
    fileLines,
    deletedLines,
    insertedByLine,
    insertedLineMaps
  );
  const uncoveredPrefixBalance = balanceSum(prefixBalance, coveredBelowBalance);
  return balanceCovers(uncoveredPrefixBalance, neededOpeners);
}

function findDroppedSuffixClosers(
  group: ReplacementGroup,
  fileLines: readonly string[],
  delta: DelimiterBalance,
  remainingDelta: DelimiterBalance,
  deletedPrefixBalance: DelimiterBalance,
  deletedLines: ReadonlySet<number>,
  insertedByLine: ReadonlyMap<number, readonly string[]>,
  insertedLineMaps: InsertedLineMaps
): DroppedSuffixClosers | undefined {
  let suffixLength = 0;
  while (
    suffixLength < group.deleteIndices.length &&
    STRUCTURAL_CLOSER_RE.test(fileLines[group.endLine - suffixLength - 1] ?? "")
  ) {
    suffixLength++;
  }
  if (suffixLength === 0) {
    return;
  }

  const suffixStartLine = group.endLine - suffixLength + 1;
  const suffixLines = fileLines.slice(
    group.endLine - suffixLength,
    group.endLine
  );
  const restatedHead = countPayloadRestatedSuffixHead(
    group.payload,
    suffixLines
  );
  const coveredTail = countProjectedBelowSuffixTail(
    group,
    fileLines,
    deletedLines,
    insertedLineMaps,
    suffixLines
  );
  const keepStart = restatedHead;
  const keepEnd = suffixLength - coveredTail;
  if (keepStart >= keepEnd) {
    return;
  }

  const keptLines = suffixLines.slice(keepStart, keepEnd);
  const keptBalance = computeDelimiterBalance(keptLines);
  const neededOpeners = balanceNegate(keptBalance);
  const coveredBelowBalance = computeDelimiterBalance(
    suffixLines.slice(keepEnd)
  );
  if (!balanceCovers(delta, neededOpeners)) {
    return;
  }
  if (balanceCovers(deletedPrefixBalance, neededOpeners)) {
    return;
  }
  if (!balanceCovers(remainingDelta, neededOpeners)) {
    return;
  }
  if (
    !prefixCanCoverSuffixClosers(
      group,
      fileLines,
      keptBalance,
      coveredBelowBalance,
      deletedLines,
      insertedByLine,
      insertedLineMaps
    )
  ) {
    return;
  }
  return {
    startLine: suffixStartLine + keepStart,
    count: keepEnd - keepStart,
    balance: keptBalance,
  };
}

interface BoundaryEcho {
  leading: number;
  trailing: number;
}

function hasNonWhitespace(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (
      code !== 9 &&
      code !== 10 &&
      code !== 11 &&
      code !== 12 &&
      code !== 13 &&
      code !== 32
    ) {
      return true;
    }
  }
  return false;
}

function countDuplicateLeadingBoundaryLines(
  group: ReplacementGroup,
  fileLines: readonly string[]
): number {
  const { payload, startLine } = group;
  const max = Math.min(payload.length, startLine - 1);
  for (let count = max; count >= 1; count--) {
    let matches = true;
    let hasContent = false;
    for (let offset = 0; offset < count; offset++) {
      const line = payload[offset] ?? "";
      if (line !== (fileLines[startLine - 1 - count + offset] ?? "")) {
        matches = false;
        break;
      }
      hasContent ||= hasNonWhitespace(line);
    }
    if (matches && hasContent) {
      return count;
    }
  }
  return 0;
}

function countDuplicateTrailingBoundaryLines(
  group: ReplacementGroup,
  fileLines: readonly string[]
): number {
  const { payload, endLine } = group;
  const max = Math.min(payload.length, fileLines.length - endLine);
  for (let count = max; count >= 1; count--) {
    let matches = true;
    let hasContent = false;
    for (let offset = 0; offset < count; offset++) {
      const line = payload[payload.length - count + offset] ?? "";
      if (line !== (fileLines[endLine + offset] ?? "")) {
        matches = false;
        break;
      }
      hasContent ||= hasNonWhitespace(line);
    }
    if (matches && hasContent) {
      return count;
    }
  }
  return 0;
}

function findBoundaryEcho(
  group: ReplacementGroup,
  fileLines: readonly string[]
): BoundaryEcho | undefined {
  const leadingMax = countDuplicateLeadingBoundaryLines(group, fileLines);
  if (leadingMax === 0) {
    return;
  }
  const trailingMax = countDuplicateTrailingBoundaryLines(group, fileLines);
  if (trailingMax === 0) {
    return;
  }
  if (leadingMax + trailingMax >= group.payload.length) {
    return;
  }
  const leadingBalance = computeDelimiterBalance(
    group.payload.slice(0, leadingMax)
  );
  const trailingBalance = computeDelimiterBalance(
    group.payload.slice(group.payload.length - trailingMax)
  );
  const droppedBalance = balanceDelta(
    leadingBalance,
    balanceNegate(trailingBalance)
  );
  if (!balanceIsZero(droppedBalance)) {
    const delta = balanceDelta(
      computeDelimiterBalance(group.payload),
      computeDelimiterBalance(
        fileLines.slice(group.startLine - 1, group.endLine)
      )
    );
    if (!balanceEqual(droppedBalance, delta)) {
      return;
    }
  }
  return { leading: leadingMax, trailing: trailingMax };
}

function describeBoundaryEchoRepair(
  group: ReplacementGroup,
  echo: BoundaryEcho
): string {
  return (
    `Auto-repaired a replacement boundary echo at line ${group.startLine}: ` +
    `dropped ${echo.leading} leading and ${echo.trailing} trailing payload line(s) already present outside the range. ` +
    "Issue the payload as the final desired content for the selected range only — never restate unchanged lines bordering the range."
  );
}

function describeBoundaryRepair(
  group: ReplacementGroup,
  action: string
): string {
  return (
    `Auto-repaired a delimiter-balance mismatch in the replacement at line ${group.startLine}: ${action}. ` +
    "Issue the payload as the final desired content only — never restate or omit a closing bracket bordering the range."
  );
}

function findOneSidedBoundaryEcho(
  group: ReplacementGroup,
  fileLines: readonly string[]
): { side: "leading" | "trailing"; count: number } | undefined {
  const leading = countDuplicateLeadingBoundaryLines(group, fileLines);
  const trailing = countDuplicateTrailingBoundaryLines(group, fileLines);
  if (leading > 0 === trailing > 0) {
    return;
  }
  const side = leading > 0 ? "leading" : "trailing";
  const count = leading > 0 ? leading : trailing;
  if (count >= group.payload.length) {
    return;
  }
  const echoLines =
    side === "leading"
      ? group.payload.slice(0, count)
      : group.payload.slice(group.payload.length - count);
  if (!balanceIsZero(computeDelimiterBalance(echoLines))) {
    return;
  }
  if (group.deleteIndices.length <= 1) {
    if (side !== "trailing" || !echoLines.every(isStructuralCloserLine)) {
      return;
    }
    const payloadPrefix = group.payload.slice(0, group.payload.length - count);
    if (payloadHasJsxOpenerForEcho(payloadPrefix, echoLines)) {
      return;
    }
  }
  return { side, count };
}

function describeOneSidedEchoRepair(
  group: ReplacementGroup,
  side: "leading" | "trailing",
  count: number
): string {
  const where = side === "leading" ? "above" : "below";
  return (
    `Auto-repaired a replacement boundary echo at line ${group.startLine}: ` +
    `dropped ${count} ${side} payload line(s) identical to the surviving line(s) just ${where} the range. ` +
    "The range was one line short of the content you retyped — issue the payload as the final content for the " +
    "selected range only, and widen the range to consume any keeper you restate."
  );
}

type RepairSlot =
  | { kind: "edits"; edits: AppliedEdit[]; warning?: string }
  | {
      kind: "candidate";
      group: ReplacementGroup;
      inserts: AppliedEdit[];
      deletes: AppliedEdit[];
      delta: DelimiterBalance;
    };

function netDeletedPrefixBalance(
  group: ReplacementGroup,
  deletedLines: ReadonlySet<number>,
  insertedByLine: ReadonlyMap<number, readonly string[]>,
  fileLines: readonly string[]
): DelimiterBalance {
  const deleted: string[] = [];
  const inserted: string[] = [];
  for (
    let line = group.startLine - 1;
    line >= 1 && deletedLines.has(line);
    line--
  ) {
    deleted.unshift(fileLines[line - 1] ?? "");
    const insertedAtLine = insertedByLine.get(line);
    if (insertedAtLine) {
      inserted.unshift(...insertedAtLine);
    }
  }
  return balanceDelta(
    computeDelimiterBalance(deleted),
    computeDelimiterBalance(inserted)
  );
}

function slotPatchDelta(
  slot: RepairSlot,
  fileLines: readonly string[]
): DelimiterBalance {
  if (slot.kind === "candidate") {
    return slot.delta;
  }
  const inserted: string[] = [];
  const deleted: string[] = [];
  for (const edit of slot.edits) {
    if (edit.kind === "insert") {
      inserted.push(edit.text);
    } else {
      deleted.push(fileLines[edit.anchor.line - 1] ?? "");
    }
  }
  return balanceDelta(
    computeDelimiterBalance(inserted),
    computeDelimiterBalance(deleted)
  );
}

function repairReplacementBoundaries(
  edits: readonly AppliedEdit[],
  fileLines: readonly string[]
): {
  edits: AppliedEdit[];
  warnings: string[];
} {
  const slots: RepairSlot[] = [];
  let i = 0;
  while (i < edits.length) {
    const group = findReplacementGroup(edits, i);
    const current = edits[i];
    if (!(group && current)) {
      if (current) {
        slots.push({ kind: "edits", edits: [current] });
      }
      i++;
      continue;
    }
    const inserts = group.insertIndices
      .map((idx) => edits[idx])
      .filter((e): e is AppliedEdit => e !== undefined);
    const deletes = group.deleteIndices
      .map((idx) => edits[idx])
      .filter((e): e is AppliedEdit => e !== undefined);
    i = group.deleteIndices[group.deleteIndices.length - 1]! + 1;

    const boundaryEcho = findBoundaryEcho(group, fileLines);
    if (boundaryEcho) {
      slots.push({
        kind: "edits",
        edits: [
          ...inserts.slice(
            boundaryEcho.leading,
            inserts.length - boundaryEcho.trailing
          ),
          ...deletes,
        ],
        warning: describeBoundaryEchoRepair(group, boundaryEcho),
      });
      continue;
    }

    const delta = balanceDelta(
      computeDelimiterBalance(group.payload),
      computeDelimiterBalance(
        fileLines.slice(group.startLine - 1, group.endLine)
      )
    );
    if (balanceIsZero(delta)) {
      const oneSided = findOneSidedBoundaryEcho(group, fileLines);
      if (oneSided) {
        const trimmed =
          oneSided.side === "leading"
            ? inserts.slice(oneSided.count)
            : inserts.slice(0, inserts.length - oneSided.count);
        slots.push({
          kind: "edits",
          edits: [...trimmed, ...deletes],
          warning: describeOneSidedEchoRepair(
            group,
            oneSided.side,
            oneSided.count
          ),
        });
        continue;
      }
      slots.push({ kind: "edits", edits: [...inserts, ...deletes] });
      continue;
    }

    const dupSuffix = findDuplicateSuffix(group, fileLines, delta);
    if (dupSuffix > 0) {
      slots.push({
        kind: "edits",
        edits: [...inserts.slice(0, inserts.length - dupSuffix), ...deletes],
        warning: describeBoundaryRepair(
          group,
          `dropped ${dupSuffix} duplicated trailing payload line(s) already present below the range`
        ),
      });
      continue;
    }
    const dupPrefix = findDuplicatePrefix(group, fileLines, delta);
    if (dupPrefix > 0) {
      slots.push({
        kind: "edits",
        edits: [...inserts.slice(dupPrefix), ...deletes],
        warning: describeBoundaryRepair(
          group,
          `dropped ${dupPrefix} duplicated leading payload line(s) already present above the range`
        ),
      });
      continue;
    }
    slots.push({ kind: "candidate", group, inserts, deletes, delta });
  }

  const projected: AppliedEdit[] = [];
  for (const slot of slots) {
    projected.push(
      ...(slot.kind === "candidate"
        ? [...slot.inserts, ...slot.deletes]
        : slot.edits)
    );
  }
  const deletedLines = new Set<number>();
  for (const edit of projected) {
    if (edit.kind === "delete") {
      deletedLines.add(edit.anchor.line);
    }
  }
  const insertedByLine = new Map<number, string[]>();
  const insertedLineMaps: {
    before: Map<number, string[]>;
    after: Map<number, string[]>;
  } = { before: new Map(), after: new Map() };
  for (const edit of projected) {
    if (edit.kind !== "insert") {
      continue;
    }
    for (const anchor of getCursorAnchors(edit.cursor)) {
      const lines = insertedByLine.get(anchor.line);
      if (lines) {
        lines.push(edit.text);
      } else {
        insertedByLine.set(anchor.line, [edit.text]);
      }
    }
    if (
      edit.cursor.kind === "before_anchor" ||
      edit.cursor.kind === "after_anchor"
    ) {
      const bySide =
        edit.cursor.kind === "before_anchor"
          ? insertedLineMaps.before
          : insertedLineMaps.after;
      const lines = bySide.get(edit.cursor.anchor.line);
      if (lines) {
        lines.push(edit.text);
      } else {
        bySide.set(edit.cursor.anchor.line, [edit.text]);
      }
    }
  }
  let remainingDelta: DelimiterBalance = { paren: 0, bracket: 0, brace: 0 };
  for (const slot of slots) {
    remainingDelta = balanceSum(
      remainingDelta,
      slotPatchDelta(slot, fileLines)
    );
  }

  const out: AppliedEdit[] = [];
  const warnings: string[] = [];
  for (const slot of slots) {
    if (slot.kind !== "candidate") {
      if (slot.warning !== undefined) {
        warnings.push(slot.warning);
      }
      out.push(...slot.edits);
      continue;
    }
    const deletedPrefixBalance = netDeletedPrefixBalance(
      slot.group,
      deletedLines,
      insertedByLine,
      fileLines
    );
    const droppedClosers = findDroppedSuffixClosers(
      slot.group,
      fileLines,
      slot.delta,
      remainingDelta,
      deletedPrefixBalance,
      deletedLines,
      insertedByLine,
      insertedLineMaps
    );
    if (droppedClosers) {
      warnings.push(
        describeBoundaryRepair(
          slot.group,
          `kept ${droppedClosers.count} structural closing line(s) the range deleted without restating`
        )
      );
      out.push(
        ...slot.inserts,
        ...slot.deletes.filter(
          (edit) =>
            edit.kind !== "delete" ||
            edit.anchor.line < droppedClosers.startLine ||
            edit.anchor.line >= droppedClosers.startLine + droppedClosers.count
        )
      );
      for (
        let line = droppedClosers.startLine;
        line < droppedClosers.startLine + droppedClosers.count;
        line++
      ) {
        deletedLines.delete(line);
      }
      remainingDelta = balanceSum(remainingDelta, droppedClosers.balance);
      continue;
    }
    out.push(...slot.inserts, ...slot.deletes);
  }
  return { edits: out, warnings };
}

function leadingIndent(line: string): string {
  let end = 0;
  while (end < line.length) {
    const code = line.charCodeAt(end);
    if (code !== 9 && code !== 32) {
      break;
    }
    end++;
  }
  return line.slice(0, end);
}

function isIndentDeeper(deeper: string, shallower: string): boolean {
  return deeper.length > shallower.length && deeper.startsWith(shallower);
}

interface AfterInsertGroup {
  anchor: number;
  blockStart?: number;
  members: number[];
}

function bodyTargetIndent(rows: readonly string[]): string | undefined {
  const nonBlank = rows.filter(hasNonWhitespace);
  if (nonBlank.length === 0) {
    return;
  }
  if (nonBlank.every((row) => STRUCTURAL_CLOSER_RE.test(row))) {
    return;
  }
  let target = leadingIndent(nonBlank[0] ?? "");
  for (const row of nonBlank) {
    const indent = leadingIndent(row);
    if (indent.startsWith(target)) {
      continue;
    }
    if (target.startsWith(indent)) {
      target = indent;
    } else {
      return;
    }
  }
  return target;
}

function resolveShiftedLanding(
  group: AfterInsertGroup,
  target: string,
  fileLines: readonly string[],
  targetedLines: ReadonlySet<number>
): { line: number; crossed: number } | undefined {
  const anchorText = fileLines[group.anchor - 1];
  if (anchorText === undefined || !hasNonWhitespace(anchorText)) {
    return;
  }
  if (!isIndentDeeper(leadingIndent(anchorText), target)) {
    return;
  }

  let landing = group.anchor;
  let crossed = 0;
  for (let line = group.anchor + 1; line <= fileLines.length; line++) {
    const text = fileLines[line - 1] ?? "";
    if (!hasNonWhitespace(text)) {
      continue;
    }
    if (!STRUCTURAL_CLOSER_RE.test(text)) {
      break;
    }
    const indent = leadingIndent(text);
    if (!indent.startsWith(target)) {
      break;
    }
    if (targetedLines.has(line)) {
      return;
    }
    landing = line;
    crossed++;
    if (indent.length === target.length) {
      break;
    }
  }
  return landing === group.anchor ? undefined : { line: landing, crossed };
}

function resolveInwardLanding(
  group: AfterInsertGroup,
  target: string,
  blockStart: number,
  fileLines: readonly string[],
  targetedLines: ReadonlySet<number>
): number | undefined {
  const anchorText = fileLines[group.anchor - 1];
  if (anchorText === undefined || !hasNonWhitespace(anchorText)) {
    return;
  }
  if (!STRUCTURAL_CLOSER_RE.test(anchorText)) {
    return;
  }
  if (!isIndentDeeper(target, leadingIndent(anchorText))) {
    return;
  }

  let landing = group.anchor;
  for (let line = group.anchor; line > blockStart; line--) {
    const text = fileLines[line - 1] ?? "";
    if (!hasNonWhitespace(text)) {
      landing = line - 1;
      continue;
    }
    if (!STRUCTURAL_CLOSER_RE.test(text)) {
      break;
    }
    const indent = leadingIndent(text);
    if (!isIndentDeeper(target, indent)) {
      break;
    }
    if (line !== group.anchor && targetedLines.has(line)) {
      return;
    }
    landing = line - 1;
  }
  return landing === group.anchor ? undefined : landing;
}

function repairAfterInsertLandings(
  edits: readonly AppliedEdit[],
  fileLines: readonly string[]
): { edits: readonly AppliedEdit[]; warnings: string[] } {
  const groups = new Map<string, AfterInsertGroup>();
  edits.forEach((edit, idx) => {
    if (edit.kind !== "insert" || edit.mode === "replacement") {
      return;
    }
    if (edit.cursor.kind !== "after_anchor") {
      return;
    }
    const key = `${edit.cursor.anchor.line}:${edit.lineNum}`;
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, {
        anchor: edit.cursor.anchor.line,
        members: [idx],
        ...(edit.blockStart === undefined
          ? {}
          : { blockStart: edit.blockStart }),
      });
    } else {
      group.members.push(idx);
    }
  });
  if (groups.size === 0) {
    return { edits, warnings: [] };
  }

  const targetedLines = new Set<number>();
  for (const edit of edits) {
    if (edit.kind === "delete") {
      targetedLines.add(edit.anchor.line);
    } else if (
      edit.cursor.kind === "before_anchor" ||
      edit.cursor.kind === "after_anchor"
    ) {
      targetedLines.add(edit.cursor.anchor.line);
    }
  }

  let out: AppliedEdit[] | undefined;
  const warnings: string[] = [];
  const retarget = (group: AfterInsertGroup, line: number): void => {
    out ??= [...edits];
    for (const idx of group.members) {
      const edit = out[idx] as InsertEdit;
      out[idx] = {
        ...edit,
        cursor: { kind: "after_anchor", anchor: { line } },
      };
    }
  };
  for (const group of groups.values()) {
    const target = bodyTargetIndent(
      group.members.map((idx) => (edits[idx] as InsertEdit).text)
    );
    if (target === undefined) {
      continue;
    }
    const outward = resolveShiftedLanding(
      group,
      target,
      fileLines,
      targetedLines
    );
    if (outward !== undefined) {
      retarget(group, outward.line);
      warnings.push(
        afterInsertLandingShiftWarning(
          group.anchor,
          outward.line,
          outward.crossed
        )
      );
      continue;
    }
    if (group.blockStart === undefined) {
      continue;
    }
    const inward = resolveInwardLanding(
      group,
      target,
      group.blockStart,
      fileLines,
      targetedLines
    );
    if (inward === undefined) {
      continue;
    }
    retarget(group, inward);
    warnings.push(
      blockInsertLandingShiftWarning(group.blockStart, group.anchor, inward)
    );
  }
  return { edits: out ?? edits, warnings };
}

export function applyEdits(text: string, edits: readonly Edit[]): ApplyResult {
  if (edits.length === 0) {
    return { text };
  }

  for (const edit of edits) {
    if (edit.kind === "block") {
      throw new Error(UNRESOLVED_BLOCK_INTERNAL);
    }
  }
  const appliedEdits = edits as readonly AppliedEdit[];

  const fileLines = text.split("\n");
  const lineOrigins: LineOrigin[] = fileLines.map(() => "original");

  let firstChangedLine: number | undefined;
  const trackFirstChanged = (line: number) => {
    if (firstChangedLine === undefined || line < firstChangedLine) {
      firstChangedLine = line;
    }
  };

  const targetEdits = dropTrailingPhantomDeletes(
    appliedEdits.map((edit, index) => cloneAppliedEdit(edit, index)),
    fileLines
  );
  validateLineBounds(targetEdits, fileLines);
  const { edits: repaired, warnings: boundaryWarnings } =
    repairReplacementBoundaries(targetEdits, fileLines);
  const { edits: landed, warnings: landingWarnings } =
    repairAfterInsertLandings(repaired, fileLines);
  const warnings = [...boundaryWarnings, ...landingWarnings];

  const bofLines: string[] = [];
  const eofLines: string[] = [];
  const anchorEdits: IndexedEdit[] = [];
  landed.forEach((edit, idx) => {
    if (edit.kind === "insert" && edit.cursor.kind === "bof") {
      bofLines.push(edit.text);
    } else if (edit.kind === "insert" && edit.cursor.kind === "eof") {
      eofLines.push(edit.text);
    } else {
      anchorEdits.push({ edit, idx });
    }
  });

  const byLine = bucketAnchorEditsByLine(anchorEdits);
  for (const line of [...byLine.keys()].sort((a, b) => b - a)) {
    const bucket = byLine.get(line);
    if (!bucket) {
      continue;
    }
    bucket.sort((a, b) => a.idx - b.idx);

    const idx = line - 1;
    const currentLine = fileLines[idx] ?? "";
    const beforeInsertLines: string[] = [];
    const afterInsertLines: string[] = [];
    const replacementLines: string[] = [];
    let deleteLine = false;

    for (const { edit } of bucket) {
      if (isReplacementInsert(edit)) {
        replacementLines.push(edit.text);
      } else if (
        edit.kind === "insert" &&
        edit.cursor.kind === "after_anchor"
      ) {
        afterInsertLines.push(edit.text);
      } else if (edit.kind === "insert") {
        beforeInsertLines.push(edit.text);
      } else if (edit.kind === "delete") {
        deleteLine = true;
      }
    }
    if (
      beforeInsertLines.length === 0 &&
      replacementLines.length === 0 &&
      afterInsertLines.length === 0 &&
      !deleteLine
    ) {
      continue;
    }

    const replacement = deleteLine
      ? [...beforeInsertLines, ...replacementLines, ...afterInsertLines]
      : [
          ...beforeInsertLines,
          ...replacementLines,
          currentLine,
          ...afterInsertLines,
        ];
    const origins: LineOrigin[] = [];
    for (let i = 0; i < beforeInsertLines.length; i++) {
      origins.push("insert");
    }
    for (let i = 0; i < replacementLines.length; i++) {
      origins.push(deleteLine ? "replacement" : "insert");
    }
    if (!deleteLine) {
      origins.push(lineOrigins[idx] ?? "original");
    }
    for (let i = 0; i < afterInsertLines.length; i++) {
      origins.push("insert");
    }

    fileLines.splice(idx, 1, ...replacement);
    lineOrigins.splice(idx, 1, ...origins);
    trackFirstChanged(line);
  }

  if (bofLines.length > 0) {
    insertAtStart(fileLines, lineOrigins, bofLines);
    trackFirstChanged(1);
  }
  const eofChangedLine = insertAtEnd(fileLines, lineOrigins, eofLines);
  if (eofChangedLine !== undefined) {
    trackFirstChanged(eofChangedLine);
  }

  return {
    text: fileLines.join("\n"),
    ...(firstChangedLine === undefined ? {} : { firstChangedLine }),
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}
