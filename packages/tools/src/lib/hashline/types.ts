export interface Anchor {
  line: number;
}

export type Cursor =
  | { kind: "bof" }
  | { kind: "eof" }
  | { kind: "before_anchor"; anchor: Anchor }
  | { kind: "after_anchor"; anchor: Anchor };

export type Edit =
  | {
      kind: "insert";
      cursor: Cursor;
      text: string;
      lineNum: number;
      index: number;
      mode?: "replacement";
      blockStart?: number;
    }
  | {
      kind: "delete";
      anchor: Anchor;
      lineNum: number;
      index: number;
      oldAssertion?: string;
    }
  | {
      kind: "block";
      anchor: Anchor;
      payloads: string[];
      mode?: "insert_after";
      lineNum: number;
      index: number;
    };

export type FileOp = { kind: "rem" } | { kind: "move"; dest: string };

export interface ApplyResult {
  blockResolutions?: BlockResolution[];
  firstChangedLine?: number;
  text: string;
  warnings?: string[];
}

export interface ParsedRange {
  end: Anchor;
  start: Anchor;
}

export interface SplitOptions {
  cwd?: string;
  path?: string;
}

export interface StreamOptions {
  maxChunkBytes?: number;
  maxChunkLines?: number;
  startLine?: number;
}

export interface CompactDiffPreview {
  addedLines: number;
  preview: string;
  removedLines: number;
}

export interface CompactDiffOptions {
  maxAddedRunContext?: number;
  maxUnchangedRun?: number;
}

export interface BlockSpan {
  end: number;
  start: number;
}

export interface BlockResolution {
  anchorLine: number;
  end: number;
  op: "replace" | "delete" | "insert_after";
  start: number;
}

export interface BlockResolverRequest {
  line: number;
  path: string;
  text: string;
}

export type BlockResolver = (request: BlockResolverRequest) => BlockSpan | null;
