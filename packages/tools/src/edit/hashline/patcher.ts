import * as path from "node:path";
import {
  computeFileHash,
  formatHashlineHeader,
} from "../../lib/hashline-utils/format";
import {
  detectLineEnding,
  type LineEnding,
  normalizeToLF,
  restoreLineEndings,
  stripBom,
} from "../../lib/hashline-utils/normalize";
import type { SnapshotStore } from "../../lib/hashline-utils/snapshots";
import type {
  ApplyResult,
  BlockResolution,
  BlockResolver,
  Edit,
  FileOp,
} from "../../lib/hashline-utils/types";
import { applyEdits } from "./apply";
import { hasBlockEdit, resolveBlockEdits } from "./block";
import { type Filesystem, isNotFound, type WriteResult } from "./fs";
import type { Patch, PatchSection } from "./input";
import {
  HEADTAIL_DRIFT_WARNING,
  missingSnapshotTagMessage,
  pathRecoveredFromTagMessage,
  unseenLinesMessage,
} from "./messages";
import { MismatchError } from "./mismatch";
import { Recovery, type RecoveryResult } from "./recovery";

export interface PatcherOptions {
  blockResolver?: BlockResolver;
  fs: Filesystem;
  snapshots: SnapshotStore;
}

export interface PatchSectionResult {
  after: string;
  before: string;
  blockResolutions?: BlockResolution[];
  canonicalPath: string;
  fileHash: string;
  firstChangedLine?: number;
  header: string;
  moveDest?: string;
  op: "create" | "update" | "delete" | "noop";
  path: string;
  persisted: string;
  warnings: string[];
  written: string;
}

export interface PatcherApplyResult {
  sections: PatchSectionResult[];
}

export class PreparedSection {
  readonly section: PatchSection;
  readonly canonicalPath: string;
  readonly exists: boolean;
  readonly rawContent: string;
  readonly bom: string;
  readonly lineEnding: LineEnding;
  readonly normalized: string;
  readonly applyResult: ApplyResult;
  readonly parseWarnings: readonly string[];
  readonly fileOp: FileOp | undefined;

  constructor(
    section: PatchSection,
    canonicalPath: string,
    exists: boolean,
    rawContent: string,
    bom: string,
    lineEnding: LineEnding,
    normalized: string,
    applyResult: ApplyResult,
    parseWarnings: readonly string[],
    fileOp: FileOp | undefined
  ) {
    this.section = section;
    this.canonicalPath = canonicalPath;
    this.exists = exists;
    this.rawContent = rawContent;
    this.bom = bom;
    this.lineEnding = lineEnding;
    this.normalized = normalized;
    this.applyResult = applyResult;
    this.parseWarnings = parseWarnings;
    this.fileOp = fileOp;
  }

  get isNoop(): boolean {
    return (
      this.fileOp === undefined && this.applyResult.text === this.normalized
    );
  }
}

function hasAnchorScopedEdit(edits: readonly Edit[]): boolean {
  return edits.some((edit) => {
    if (edit.kind === "delete") {
      return true;
    }
    if (edit.kind === "block") {
      return true;
    }
    return (
      edit.cursor.kind === "before_anchor" ||
      edit.cursor.kind === "after_anchor"
    );
  });
}

function assertSectionHashPresent(
  sectionPath: string,
  fileHash: string | undefined
): void {
  if (fileHash !== undefined) {
    return;
  }
  throw new Error(missingSnapshotTagMessage(sectionPath));
}

function recoveryToApplyResult(result: RecoveryResult): ApplyResult {
  return {
    text: result.text,
    ...(result.firstChangedLine === undefined
      ? {}
      : { firstChangedLine: result.firstChangedLine }),
    warnings: result.warnings,
  };
}

function mergeWarnings(
  ...sources: ReadonlyArray<readonly string[] | undefined>
): string[] {
  const out: string[] = [];
  for (const source of sources) {
    if (!source) {
      continue;
    }
    for (const warning of source) {
      out.push(warning);
    }
  }
  return out;
}

function assertUniqueCanonicalPaths(
  prepared: readonly PreparedSection[]
): void {
  const seen = new Map<string, string>();
  for (const entry of prepared) {
    const previous = seen.get(entry.canonicalPath);
    if (previous !== undefined) {
      throw new Error(
        `Multiple hashline sections resolve to the same file (${previous} and ${entry.section.path}). Merge their ops under one header before applying.`
      );
    }
    seen.set(entry.canonicalPath, entry.section.path);
  }
}

export class Patcher {
  readonly fs: Filesystem;
  readonly snapshots: SnapshotStore;
  readonly recovery: Recovery;
  readonly blockResolver: BlockResolver | undefined;

  constructor(options: PatcherOptions) {
    if (!options.snapshots) {
      throw new Error(
        "Hashline Patcher requires a SnapshotStore; section tags are opaque store pointers."
      );
    }
    this.fs = options.fs;
    this.snapshots = options.snapshots;
    this.recovery = new Recovery(options.snapshots);
    this.blockResolver = options.blockResolver;
  }

  async apply(patch: Patch): Promise<PatcherApplyResult> {
    if (patch.sections.length === 1) {
      const section = patch.sections[0];
      if (!section) {
        throw new Error("Empty patch");
      }
      const prepared = await this.prepare(section);
      return { sections: [await this.commit(prepared)] };
    }

    const prepared: PreparedSection[] = [];
    for (const section of patch.sections) {
      prepared.push(await this.prepare(section));
    }
    assertUniqueCanonicalPaths(prepared);
    for (const entry of prepared) {
      if (entry.isNoop) {
        throw new Error(
          `Edits to ${entry.section.path} resulted in no changes being made.`
        );
      }
    }

    const results: PatchSectionResult[] = [];
    for (let index = 0; index < prepared.length; index++) {
      const entry = prepared[index];
      if (!entry) {
        continue;
      }
      try {
        results.push(await this.commit(entry));
      } catch (error) {
        const written = prepared
          .slice(0, index)
          .map((e) => e?.section.path)
          .filter((p): p is string => p !== undefined);
        const notWritten = prepared
          .slice(index + 1)
          .map((e) => e?.section.path)
          .filter((p): p is string => p !== undefined);
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
          `Failed to write ${entry.section.path}: ${message}` +
            (written.length > 0
              ? ` Sections already written: ${written.join(", ")}.`
              : "") +
            (notWritten.length > 0
              ? ` Sections not written: ${notWritten.join(", ")}.`
              : ""),
          { cause: error }
        );
      }
    }
    return { sections: results };
  }

  async preflight(patch: Patch): Promise<void> {
    const prepared: PreparedSection[] = [];
    for (const section of patch.sections) {
      prepared.push(await this.prepare(section));
    }
    assertUniqueCanonicalPaths(prepared);
    for (const entry of prepared) {
      if (entry.isNoop) {
        throw new Error(
          `Edits to ${entry.section.path} resulted in no changes being made.`
        );
      }
    }
  }

  async prepare(section: PatchSection): Promise<PreparedSection> {
    const parsed = section.parse();
    const parseWarnings = [...parsed.warnings];
    const fileOp = parsed.fileOp;
    assertSectionHashPresent(section.path, section.fileHash);

    let target = section;
    let canonicalPath = this.fs.canonicalPath(target.path);
    let read = await this.#tryRead(target.path);

    if (!read.exists) {
      const recovered = this.#recoverSectionPathFromTag(target, canonicalPath);
      if (
        recovered &&
        this.fs.allowTagPathRecovery(target.path, recovered.section.path)
      ) {
        parseWarnings.push(
          pathRecoveredFromTagMessage(
            target.path,
            recovered.section.path,
            target.fileHash as string
          )
        );
        target = recovered.section;
        canonicalPath = recovered.canonicalPath;
        read = await this.#tryRead(target.path);
      }
    }

    await this.fs.preflightWrite(
      target.path,
      fileOp === undefined ? {} : { fileOp }
    );

    if (!read.exists) {
      throw new Error(
        `File not found: ${target.path}. Use the write tool to create new files.`
      );
    }

    if (
      fileOp?.kind === "move" &&
      this.fs.canonicalPath(fileOp.dest) === canonicalPath
    ) {
      throw new Error(`MV destination is the same as ${target.path}.`);
    }

    const { bom, text } = stripBom(read.rawContent);
    const lineEnding = detectLineEnding(text);
    const normalized = normalizeToLF(text);

    const applyResult =
      fileOp?.kind === "rem"
        ? this.#applyWithRecovery({
            section: target,
            canonicalPath,
            exists: read.exists,
            normalized,
            edits: [],
          })
        : this.#applyWithRecovery({
            section: target,
            canonicalPath,
            exists: read.exists,
            normalized,
            edits: parsed.edits,
          });

    return new PreparedSection(
      target,
      canonicalPath,
      read.exists,
      read.rawContent,
      bom,
      lineEnding,
      normalized,
      applyResult,
      parseWarnings,
      fileOp
    );
  }

  #recoverSectionPathFromTag(
    section: PatchSection,
    originalCanonicalPath: string
  ): { section: PatchSection; canonicalPath: string } | null {
    if (section.fileHash === undefined) {
      return null;
    }
    const authoredName = path.basename(section.path);
    const candidates = [
      ...new Set(
        this.snapshots
          .findByHash(section.fileHash)
          .filter((snapshot) => path.basename(snapshot.path) === authoredName)
          .map((snapshot) => snapshot.path)
      ),
    ].filter(
      (candidate) => this.fs.canonicalPath(candidate) !== originalCanonicalPath
    );
    if (candidates.length !== 1) {
      return null;
    }
    const resolved = candidates[0];
    if (resolved === undefined) {
      return null;
    }
    return {
      section: section.withPath(resolved),
      canonicalPath: this.fs.canonicalPath(resolved),
    };
  }

  async commit(prepared: PreparedSection): Promise<PatchSectionResult> {
    const {
      section,
      normalized,
      bom,
      lineEnding,
      parseWarnings,
      exists,
      applyResult,
      canonicalPath,
      fileOp,
    } = prepared;
    const after = applyResult.text;
    const warnings = mergeWarnings(parseWarnings, applyResult.warnings);
    const moveDest = fileOp?.kind === "move" ? fileOp.dest : undefined;
    const resultPath = moveDest ?? section.path;

    if (fileOp?.kind === "rem") {
      await this.fs.delete(section.path);
      this.snapshots.invalidate(canonicalPath);
      return {
        path: section.path,
        canonicalPath,
        op: "delete",
        before: normalized,
        after: normalized,
        persisted: prepared.rawContent,
        written: prepared.rawContent,
        fileHash: computeFileHash(normalized),
        header: formatHashlineHeader(section.path, computeFileHash(normalized)),
        warnings,
      };
    }

    if (after === normalized && moveDest === undefined) {
      const hash = this.#recordFullSnapshot(canonicalPath, normalized);
      return {
        path: section.path,
        canonicalPath,
        op: "noop",
        before: normalized,
        after: normalized,
        persisted: prepared.rawContent,
        written: prepared.rawContent,
        fileHash: hash,
        header: formatHashlineHeader(section.path, hash),
        warnings,
      };
    }

    const persisted = bom + restoreLineEndings(after, lineEnding);

    if (moveDest !== undefined) {
      const destCanonical = this.fs.canonicalPath(moveDest);
      this.snapshots.relocate(canonicalPath, destCanonical);
      await this.fs.move(section.path, moveDest, persisted);
      const fileHash = this.#recordFullSnapshot(destCanonical, after);
      return {
        path: resultPath,
        canonicalPath: destCanonical,
        op: "update",
        before: normalized,
        after,
        persisted,
        written: persisted,
        fileHash,
        header: formatHashlineHeader(moveDest, fileHash),
        ...(applyResult.firstChangedLine === undefined
          ? {}
          : { firstChangedLine: applyResult.firstChangedLine }),
        ...(applyResult.blockResolutions === undefined
          ? {}
          : { blockResolutions: applyResult.blockResolutions }),
        moveDest,
        warnings,
      };
    }

    const write: WriteResult = await this.fs.writeText(section.path, persisted);
    const fileHash = this.#recordFullSnapshot(canonicalPath, after);
    const op = exists ? "update" : "create";

    return {
      path: section.path,
      canonicalPath,
      op,
      before: normalized,
      after,
      persisted,
      written: write.text,
      fileHash,
      header: formatHashlineHeader(section.path, fileHash),
      ...(applyResult.firstChangedLine === undefined
        ? {}
        : { firstChangedLine: applyResult.firstChangedLine }),
      ...(applyResult.blockResolutions === undefined
        ? {}
        : { blockResolutions: applyResult.blockResolutions }),
      warnings,
    };
  }

  async #tryRead(
    path: string
  ): Promise<{ exists: boolean; rawContent: string }> {
    try {
      const content = await this.fs.readText(path);
      return { exists: true, rawContent: content };
    } catch (error) {
      if (isNotFound(error)) {
        return { exists: false, rawContent: "" };
      }
      throw error;
    }
  }

  #recordFullSnapshot(canonicalPath: string, normalized: string): string {
    return this.snapshots.record(canonicalPath, normalized);
  }

  #assertSeenLines(
    section: PatchSection,
    canonicalPath: string,
    expected: string
  ): void {
    const seen = this.snapshots.byHash(canonicalPath, expected)?.seenLines;
    if (!seen || seen.size === 0) {
      return;
    }
    const unseen = section
      .collectAnchorLines()
      .filter((line) => !seen.has(line));
    if (unseen.length === 0) {
      return;
    }
    throw new Error(unseenLinesMessage(section.path, unseen, expected));
  }

  #mismatchError(
    section: PatchSection,
    canonicalPath: string,
    normalized: string,
    expected: string,
    hashRecognized: boolean
  ): MismatchError {
    const actualFileHash = this.#recordFullSnapshot(canonicalPath, normalized);
    return new MismatchError({
      path: section.path,
      expectedFileHash: expected,
      actualFileHash,
      fileLines: normalized.split("\n"),
      anchorLines: section.collectAnchorLines(),
      hashRecognized,
    });
  }

  #applyWithRecovery(args: {
    section: PatchSection;
    canonicalPath: string;
    exists: boolean;
    normalized: string;
    edits: readonly Edit[];
  }): ApplyResult {
    const { section, canonicalPath, exists, normalized, edits } = args;
    const expected = exists ? section.fileHash : undefined;
    const liveMatches =
      expected !== undefined && computeFileHash(normalized) === expected;

    const blockResolutions: BlockResolution[] = [];
    const resolveWarnings: string[] = [];
    let resolved: readonly Edit[] = edits;
    if (hasBlockEdit(edits)) {
      const baseText =
        expected === undefined || liveMatches
          ? normalized
          : this.snapshots.byHash(canonicalPath, expected)?.text;
      if (baseText === undefined) {
        throw this.#mismatchError(
          section,
          canonicalPath,
          normalized,
          expected ?? "",
          false
        );
      }
      resolved = resolveBlockEdits(
        edits,
        baseText,
        section.path,
        this.blockResolver,
        {
          onUnresolved: "throw",
          onResolved: (resolution) => blockResolutions.push(resolution),
          onWarning: (warning) => resolveWarnings.push(warning),
        }
      );
    }
    const withResolveWarnings = (result: ApplyResult): ApplyResult =>
      resolveWarnings.length === 0
        ? result
        : {
            ...result,
            warnings: [...resolveWarnings, ...(result.warnings ?? [])],
          };

    if (expected === undefined || liveMatches) {
      if (expected !== undefined) {
        this.#assertSeenLines(section, canonicalPath, expected);
      }
      const result = applyEdits(normalized, resolved);
      return withResolveWarnings(
        blockResolutions.length > 0 ? { ...result, blockResolutions } : result
      );
    }

    if (!hasAnchorScopedEdit(resolved)) {
      const result = applyEdits(normalized, resolved);
      return withResolveWarnings({
        ...result,
        warnings: [HEADTAIL_DRIFT_WARNING, ...(result.warnings ?? [])],
      });
    }

    const recovered = this.recovery.tryRecover({
      path: canonicalPath,
      currentText: normalized,
      fileHash: expected,
      edits: resolved,
    });
    if (recovered) {
      return withResolveWarnings(recoveryToApplyResult(recovered));
    }
    const hashRecognized =
      this.snapshots.byHash(canonicalPath, expected) !== null;
    throw this.#mismatchError(
      section,
      canonicalPath,
      normalized,
      expected,
      hashRecognized
    );
  }
}
