import * as Diff from "diff";
import type {
  Snapshot,
  SnapshotStore,
} from "../../lib/hashline-utils/snapshots";
import type { Anchor, ApplyResult, Edit } from "../../lib/hashline-utils/types";
import { applyEdits } from "./apply";
import {
  RECOVERY_EXTERNAL_WARNING,
  RECOVERY_SESSION_CHAIN_WARNING,
  RECOVERY_SESSION_REPLAY_WARNING,
} from "./messages";

const RECOVERY_FUZZ_FACTOR = 0;

export interface RecoveryArgs {
  currentText: string;
  edits: readonly Edit[];
  fileHash: string;
  path: string;
}

export interface RecoveryResult {
  firstChangedLine: number | undefined;
  text: string;
  warnings: string[];
}

function applyEditsToSnapshot(
  previousText: string,
  currentText: string,
  edits: readonly Edit[],
  recoveryWarning: string
): RecoveryResult | null {
  let applied: ApplyResult;
  try {
    applied = applyEdits(previousText, [...edits]);
  } catch {
    return null;
  }
  if (applied.text === previousText) {
    return null;
  }

  const patch = Diff.structuredPatch(
    "file",
    "file",
    previousText,
    applied.text,
    "",
    "",
    { context: 3 }
  );
  const merged = Diff.applyPatch(currentText, patch, {
    fuzzFactor: RECOVERY_FUZZ_FACTOR,
  });
  if (typeof merged !== "string" || merged === currentText) {
    return null;
  }

  const firstChangedLine =
    findFirstChangedLine(currentText, merged) ?? applied.firstChangedLine;
  const hasNetChange = firstChangedLine !== undefined;
  const warnings = hasNetChange
    ? [recoveryWarning, ...(applied.warnings ?? [])]
    : [...(applied.warnings ?? [])];

  return { text: merged, firstChangedLine, warnings };
}

function collectAnchorLines(edits: readonly Edit[]): number[] {
  const lines: number[] = [];
  for (const edit of edits) {
    for (const anchor of getEditAnchors(edit)) {
      lines.push(anchor.line);
    }
  }
  return lines;
}

function getEditAnchors(edit: Edit): Anchor[] {
  if (edit.kind === "delete") {
    return [edit.anchor];
  }
  if (edit.kind === "block") {
    return [edit.anchor];
  }
  return edit.cursor.kind === "before_anchor" ||
    edit.cursor.kind === "after_anchor"
    ? [edit.cursor.anchor]
    : [];
}

function verifyAnchorContent(
  previousText: string,
  currentText: string,
  edits: readonly Edit[]
): boolean {
  const lines = collectAnchorLines(edits);
  if (lines.length === 0) {
    return true;
  }
  const prev = previousText.split("\n");
  const curr = currentText.split("\n");
  for (const line of lines) {
    const idx = line - 1;
    if (idx < 0 || idx >= prev.length || idx >= curr.length) {
      return false;
    }
    if (prev[idx] !== curr[idx]) {
      return false;
    }
  }
  return true;
}

function replaySessionChainOnCurrent(
  previousText: string,
  currentText: string,
  edits: readonly Edit[]
): RecoveryResult | null {
  if (previousText.split("\n").length !== currentText.split("\n").length) {
    return null;
  }
  if (!verifyAnchorContent(previousText, currentText, edits)) {
    return null;
  }
  let applied: ApplyResult;
  try {
    applied = applyEdits(currentText, [...edits]);
  } catch {
    return null;
  }
  if (applied.text === currentText) {
    return null;
  }
  return {
    text: applied.text,
    firstChangedLine: applied.firstChangedLine,
    warnings: [RECOVERY_SESSION_REPLAY_WARNING, ...(applied.warnings ?? [])],
  };
}

function findFirstChangedLine(a: string, b: string): number | undefined {
  if (a === b) {
    return;
  }
  const aLines = a.split("\n");
  const bLines = b.split("\n");
  const max = Math.max(aLines.length, bLines.length);
  for (let i = 0; i < max; i++) {
    if (aLines[i] !== bLines[i]) {
      return i + 1;
    }
  }
  return;
}

function isHeadSnapshot(head: Snapshot | null, snapshot: Snapshot): boolean {
  return head === snapshot;
}

export function recoverWithThreeWayMerge(
  previousText: string,
  currentText: string,
  _patch: { edits: readonly Edit[] }
): { success: true; text: string; warnings: string[] } | { success: false } {
  let applied: ApplyResult;
  try {
    applied = applyEdits(previousText, [..._patch.edits]);
  } catch {
    return { success: false };
  }
  if (applied.text === previousText) {
    return { success: false };
  }

  const patch = Diff.structuredPatch(
    "file",
    "file",
    previousText,
    applied.text,
    "",
    "",
    { context: 3 }
  );
  const merged = Diff.applyPatch(currentText, patch, {
    fuzzFactor: RECOVERY_FUZZ_FACTOR,
  });
  if (typeof merged !== "string" || merged === currentText) {
    return { success: false };
  }

  return {
    success: true,
    text: merged,
    warnings: [RECOVERY_EXTERNAL_WARNING, ...(applied.warnings ?? [])],
  };
}

export class Recovery {
  readonly store: SnapshotStore;

  constructor(store: SnapshotStore) {
    this.store = store;
  }

  tryRecover(args: RecoveryArgs): RecoveryResult | null {
    const { path, currentText, fileHash, edits } = args;
    const snapshot = this.store.byHash(path, fileHash);
    if (!snapshot) {
      return null;
    }
    const isHead = isHeadSnapshot(this.store.head(path), snapshot);
    const recoveryWarning = isHead
      ? RECOVERY_EXTERNAL_WARNING
      : RECOVERY_SESSION_CHAIN_WARNING;
    const merged = applyEditsToSnapshot(
      snapshot.text,
      currentText,
      edits,
      recoveryWarning
    );
    if (merged !== null) {
      return merged;
    }
    if (!isHead) {
      return replaySessionChainOnCurrent(snapshot.text, currentText, edits);
    }
    return null;
  }
}
