import {
  access as fsAccess,
  readFile as fsReadFile,
  writeFile as fsWriteFile,
} from "node:fs/promises";
import type { AgentTool, AgentToolUpdateCallback } from "@sakti-code/agent";
import { type Static, type TSchema, Type } from "typebox";
import { withFileMutationQueue } from "../lib/file-mutation-queue.ts";
import type { SnapshotStore } from "../lib/hashline-utils/snapshots.ts";
import { resolveToCwd } from "../lib/path-utils.ts";
import {
  applyEditsToNormalizedContent,
  detectLineEnding,
  type Edit,
  generateDiffString,
  generateNumberedDiff,
  generateUnifiedPatch,
  normalizeToLF,
  restoreLineEndings,
  stripBom,
} from "./edit-diff.ts";
import { nativeBlockResolver } from "./hashline/block-resolver.ts";
import { buildCompactDiffPreview } from "./hashline/diff-preview.ts";
import { NodeFilesystem } from "./hashline/fs.ts";
import { Patch } from "./hashline/input.ts";
import {
  noChangeDiagnostic,
  noChangeLoopDiagnostic,
} from "./hashline/messages.ts";
import { Patcher } from "./hashline/patcher.ts";
import {
  hashPatchInput,
  type NoopLoopGuardOwner,
  recordNoopEdit,
  resetNoopEdit,
} from "./noop-loop-guard.ts";

const replaceEditSchema = Type.Object(
  {
    oldText: Type.String({
      description:
        "Exact text for one targeted replacement. It must be unique in the original file and must not overlap with any other edits[].oldText in the same call.",
    }),
    newText: Type.String({
      description: "Replacement text for this targeted edit.",
    }),
  },
  { additionalProperties: false }
);

const editSchema = Type.Object(
  {
    path: Type.String({
      description: "Path to the file to edit (relative or absolute)",
    }),
    edits: Type.Array(replaceEditSchema, {
      description:
        "One or more targeted replacements. Each edit is matched against the original file, not incrementally. Do not include overlapping or nested edits. If two changes touch the same block or nearby lines, merge them into one edit instead.",
    }),
  },
  { additionalProperties: false }
);

export type EditToolInput = Static<typeof editSchema>;
type LegacyEditToolInput = EditToolInput & {
  oldText?: unknown;
  newText?: unknown;
};

export const hashlineEditSchema = Type.Object({
  input: Type.String({
    description:
      "Hashline patch: section headers [path#HASH] followed by SWAP/DEL/INS/REM/MV ops with +payload lines",
  }),
});

export type HashlineEditInput = Static<typeof hashlineEditSchema>;

export interface EditToolDetails {
  diff: string;
  firstChangedLine?: number;
  patch?: string;
}

export interface EditOperations {
  access: (absolutePath: string) => Promise<void>;
  readFile: (absolutePath: string) => Promise<Buffer>;
  writeFile: (absolutePath: string, content: string) => Promise<void>;
}

const defaultEditOperations: EditOperations = {
  readFile: async (path) => fsReadFile(path),
  writeFile: async (path, content) => {
    await fsWriteFile(path, content);
  },
  access: async (path) => {
    try {
      await fsAccess(path);
    } catch {
      throw new Error(`File not found: ${path}`);
    }
  },
};

export type EditMode = "replace" | "hashline";

export interface EditToolOptions {
  mode?: EditMode;
  noopOwner?: NoopLoopGuardOwner;
  operations?: EditOperations;
  snapshotStore?: SnapshotStore;
}

function prepareEditArguments(input: unknown): EditToolInput {
  if (!input || typeof input !== "object") {
    return input as EditToolInput;
  }

  const args = input as Record<string, unknown>;

  if (typeof args.edits === "string") {
    try {
      const parsed = JSON.parse(args.edits);
      if (Array.isArray(parsed)) {
        args.edits = parsed;
      }
    } catch {}
  }

  const legacy = args as LegacyEditToolInput;
  if (
    typeof legacy.oldText !== "string" ||
    typeof legacy.newText !== "string"
  ) {
    return args as EditToolInput;
  }

  const edits = Array.isArray(legacy.edits) ? [...legacy.edits] : [];
  edits.push({ oldText: legacy.oldText, newText: legacy.newText });
  const { oldText: _oldText, newText: _newText, ...rest } = legacy;
  return { ...rest, edits } as EditToolInput;
}

function validateEditInput(input: EditToolInput): {
  path: string;
  edits: Edit[];
} {
  if (!Array.isArray(input.edits) || input.edits.length === 0) {
    throw new Error(
      "Edit tool input is invalid. edits must contain at least one replacement."
    );
  }
  return { path: input.path, edits: input.edits };
}

const REPLACE_DESCRIPTION =
  "Edit a single file using exact text replacement. Every edits[].oldText must match a unique, non-overlapping region of the original file. If two changes affect the same block or nearby lines, merge them into one edit instead of emitting overlapping edits. Do not include large unchanged regions just to connect distant changes.";

const HASHLINE_DESCRIPTION = `Edit files using hashline patches. Line numbers are 1-indexed (line 1 = first line). Each section starts with [path#HASH] (copy from read/write/edit output) followed by line-anchored ops. Body rows go on lines BELOW the op header, each prefixed with +.

Line ops:
- SWAP N.=M:    replace lines N through M with +body rows below
- DEL N.=M      delete lines N through M (no body)
- INS.PRE N:    insert +body before line N
- INS.POST N:   insert +body after line N
- INS.HEAD:     insert +body at file start (NO line number)
- INS.TAIL:     insert +body at file end (NO line number)
- REM           delete the file entirely
- MV "dest"    move/rename (e.g. MV "src/utils/helpers.ts")

Block ops (anchor the OPENING line of a multi-line construct):
- SWAP.BLK N:       replace the whole block starting on line N
- DEL.BLK N         delete the whole block starting on line N
- INS.BLK.POST N:   insert +body AFTER the block's end (sibling depth)

Block ops work on: function, class, if/else, for, while, try, switch, markdown headings.
Do NOT use on single statements (return, const x = 5, break) — use SWAP/DEL instead.
Point N at the FIRST decorator to sweep decorators + body together.

Example — replace lines 3-4, delete line 7, append to end:
[src/app.ts#1A2B]
SWAP 3.=4:
+  const result = compute();
+  return result;
DEL 7
INS.TAIL:
+// EOF`;

function extractHashlinePaths(input: string): string[] {
  try {
    const patch = Patch.parse(input);
    return patch.sections.map((s) => s.path);
  } catch {
    return [];
  }
}

async function executeHashlineEdit(
  cwd: string,
  input: string,
  snapshotStore: SnapshotStore | undefined,
  noopOwner: NoopLoopGuardOwner | undefined,
  signal?: AbortSignal
): Promise<{
  content: [{ type: "text"; text: string }];
  details: EditToolDetails;
}> {
  if (!snapshotStore) {
    throw new Error(
      "Hashline edit mode requires a snapshotStore. Ensure the edit tool is configured with one."
    );
  }
  const patch = Patch.parse(input, { cwd });
  if (patch.sections.length === 0) {
    throw new Error(
      "No editable sections found. Each section needs a [path#HASH] header followed by at least one op (SWAP/DEL/INS) below it."
    );
  }
  const fs = new NodeFilesystem(cwd);
  const patcher = new Patcher({
    fs,
    snapshots: snapshotStore,
    blockResolver: nativeBlockResolver,
  });
  const result = await patcher.apply(patch);
  if (signal?.aborted) {
    throw new Error("Operation aborted");
  }
  const inputHash = noopOwner ? hashPatchInput(input) : "";
  // Multi-section noops are thrown by the patcher (Patcher.apply) before the
  // result reaches this map, so the graduated record/escalate/reset cycle
  // below only fires for single-section noops — the common case from issue
  // #2081. A multi-section noop still fails the tool (breaking the loop), but
  // without graduated counting.
  const rendered = result.sections.map((s) => {
    const warnings =
      s.warnings.length > 0 ? `\n\nWarnings:\n${s.warnings.join("\n")}` : "";
    if (s.op === "noop") {
      if (noopOwner) {
        const { count, escalate } = recordNoopEdit(
          noopOwner,
          s.canonicalPath,
          inputHash
        );
        if (escalate) {
          throw new Error(noChangeLoopDiagnostic(s.path, count));
        }
      }
      return {
        text: `${noChangeDiagnostic(s.path)}${warnings}`,
        diff: "",
        firstChangedLine: undefined,
      };
    }
    if (noopOwner) {
      resetNoopEdit(noopOwner, s.canonicalPath);
    }
    if (s.op === "delete") {
      return {
        text: `Deleted ${s.path}${warnings}`,
        diff: "",
        firstChangedLine: undefined,
      };
    }
    const diff = generateNumberedDiff(s.before, s.after);
    const preview = buildCompactDiffPreview(diff.diff);
    const previewBlock = preview.preview ? `\n${preview.preview}` : "";
    const firstChangedLine = s.firstChangedLine ?? diff.firstChangedLine;
    return {
      text: `Edited ${s.header}${previewBlock}${warnings}`,
      diff: preview.preview,
      firstChangedLine,
    };
  });
  const text = rendered.map((r) => r.text).join("\n\n");
  const diffParts = rendered.map((r) => r.diff).filter((p) => p.length > 0);
  const firstChanged = rendered
    .map((r) => r.firstChangedLine)
    .find((line): line is number => line !== undefined);
  return {
    content: [{ type: "text", text }],
    details: {
      diff: diffParts.join("\n"),
      ...(firstChanged === undefined ? {} : { firstChangedLine: firstChanged }),
    },
  };
}

export function createEditTool(
  cwd: string,
  options?: EditToolOptions
): AgentTool<TSchema, EditToolDetails | undefined> {
  const mode: EditMode = options?.mode ?? "replace";
  const ops = options?.operations ?? defaultEditOperations;

  if (mode === "hashline") {
    return {
      name: "edit",
      label: "edit",
      description: HASHLINE_DESCRIPTION,
      parameters: hashlineEditSchema,
      permissions: (params) => {
        const input = (params as HashlineEditInput).input ?? "";
        const paths = extractHashlinePaths(input);
        return paths.length > 0
          ? paths.map((p) => ({ permission: "edit" as const, patterns: [p] }))
          : [{ permission: "edit" as const, patterns: ["**"] }];
      },
      async execute(
        _toolCallId: string,
        params: unknown,
        signal?: AbortSignal,
        _onUpdate?: AgentToolUpdateCallback<EditToolDetails | undefined>
      ) {
        const { input } = params as HashlineEditInput;
        const result = await executeHashlineEdit(
          cwd,
          input,
          options?.snapshotStore,
          options?.noopOwner,
          signal
        );
        return result;
      },
    };
  }

  return {
    name: "edit",
    label: "edit",
    description: REPLACE_DESCRIPTION,
    parameters: editSchema,
    permissions: (params) => [
      { permission: "edit", patterns: [(params as EditToolInput).path] },
    ],
    prepareArguments: prepareEditArguments,
    async execute(
      _toolCallId: string,
      params: unknown,
      signal?: AbortSignal,
      _onUpdate?: AgentToolUpdateCallback<EditToolDetails | undefined>
    ) {
      const input = params as Static<typeof editSchema>;
      const { path, edits } = validateEditInput(input);
      const absolutePath = resolveToCwd(path, cwd);

      return withFileMutationQueue(absolutePath, async () => {
        const throwIfAborted = (): void => {
          if (signal?.aborted) {
            throw new Error("Operation aborted");
          }
        };

        throwIfAborted();

        try {
          await ops.access(absolutePath);
        } catch (error: unknown) {
          throwIfAborted();
          const errorMessage =
            error instanceof Error && "code" in error
              ? `Error code: ${error.code}`
              : String(error);
          throw new Error(`Could not edit file: ${path}. ${errorMessage}.`);
        }
        throwIfAborted();

        const buffer = await ops.readFile(absolutePath);
        const rawContent = buffer.toString("utf-8");
        throwIfAborted();

        const { bom, text: content } = stripBom(rawContent);
        const originalEnding = detectLineEnding(content);
        const normalizedContent = normalizeToLF(content);
        const { baseContent, newContent } = applyEditsToNormalizedContent(
          normalizedContent,
          edits,
          path
        );
        throwIfAborted();

        const finalContent =
          bom + restoreLineEndings(newContent, originalEnding);
        await ops.writeFile(absolutePath, finalContent);
        throwIfAborted();

        const diffResult = generateDiffString(baseContent, newContent);
        const patch = generateUnifiedPatch(path, baseContent, newContent);
        return {
          content: [
            {
              type: "text",
              text: `Successfully replaced ${edits.length} block(s) in ${path}.`,
            },
          ],
          details: {
            diff: diffResult.diff,
            patch,
            ...(diffResult.firstChangedLine === undefined
              ? {}
              : { firstChangedLine: diffResult.firstChangedLine }),
          },
        };
      });
    },
  };
}
