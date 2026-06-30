import { describe, expect, it } from "vite-plus/test";
import {
  computeFileHash,
  formatNumberedLine,
} from "../../../lib/hashline-utils/format";
import { InMemorySnapshotStore } from "../../../lib/hashline-utils/snapshots";
import type {
  BlockResolution,
  BlockResolver,
  BlockSpan,
  Edit,
} from "../../../lib/hashline-utils/types";
import { hasBlockEdit, resolveBlockEdits } from "../block";
import { InMemoryFilesystem } from "../fs";
import { Patch } from "../input";
import { MismatchError } from "../mismatch";
import { parsePatch } from "../parser";
import { Patcher } from "../patcher";

const PATH = "x.ts";

const stubResolver: BlockResolver = ({ line }): BlockSpan => ({
  start: line,
  end: line + 1,
});

const singleLineResolver: BlockResolver = ({ line }): BlockSpan => ({
  start: line,
  end: line,
});

function normalizeEdits(edits: readonly Edit[]): unknown[] {
  return edits.map((edit) => {
    if (edit.kind === "insert") {
      return {
        kind: edit.kind,
        cursor: edit.cursor,
        text: edit.text,
        ...(edit.mode === undefined ? {} : { mode: edit.mode }),
      };
    }
    if (edit.kind === "delete") {
      return { kind: edit.kind, anchor: edit.anchor };
    }
    return edit;
  });
}

describe("hasBlockEdit", () => {
  it("is true when at least one edit is a deferred block edit", () => {
    const { edits } = parsePatch("SWAP.BLK 2:\n+A\n+B");
    expect(hasBlockEdit(edits)).toBe(true);
  });

  it("is false when no block edits are present", () => {
    const { edits } = parsePatch("SWAP 2.=3:\n+A\n+B");
    expect(hasBlockEdit(edits)).toBe(false);
  });
});

describe("resolveBlockEdits", () => {
  it("expands a SWAP.BLK exactly like the equivalent SWAP start.=end:", () => {
    const blockEdits = parsePatch("SWAP.BLK 2:\n+A\n+B").edits;
    const resolved = resolveBlockEdits(
      blockEdits,
      "ignored",
      PATH,
      stubResolver
    );
    const replaceEdits = parsePatch("SWAP 2.=3:\n+A\n+B").edits;

    expect(resolved.some((edit) => edit.kind === "block")).toBe(false);
    expect(normalizeEdits(resolved)).toEqual(normalizeEdits(replaceEdits));
  });

  it("returns the input untouched when there are no block edits (fast path)", () => {
    const edits = parsePatch("SWAP 1.=1:\n+X").edits;
    expect(resolveBlockEdits(edits, "ignored", PATH, stubResolver)).toBe(edits);
  });

  it("throws (default) when no resolver is wired", () => {
    const edits = parsePatch("SWAP.BLK 2:\n+X").edits;
    expect(() => resolveBlockEdits(edits, "ignored", PATH, undefined)).toThrow(
      "not available here"
    );
  });

  it("drops an unresolvable block edit in drop mode", () => {
    const edits = parsePatch("SWAP.BLK 2:\n+X").edits;
    const resolved = resolveBlockEdits(edits, "ignored", PATH, () => null, {
      onUnresolved: "drop",
    });
    expect(resolved).toHaveLength(0);
  });

  it("throws a block-unresolved error in throw mode when the resolver returns null", () => {
    const edits = parsePatch("SWAP.BLK 7:\n+X").edits;
    expect(() => resolveBlockEdits(edits, "ignored", PATH, () => null)).toThrow(
      "could not resolve a syntactic block beginning on line 7"
    );
  });

  it("includes a nearby-context preview in the block-unresolved error", () => {
    const edits = parsePatch("SWAP.BLK 3:\n+X").edits;
    const text = "alpha\nbravo\ncharlie\ndelta\necho\nfoxtrot";
    let error: Error | undefined;
    try {
      resolveBlockEdits(edits, text, PATH, () => null);
    } catch (err) {
      error = err as Error;
    }
    expect(error?.message).toContain(
      "could not resolve a syntactic block beginning on line 3"
    );
    expect(error?.message).toContain(formatNumberedLine(1, "alpha"));
    expect(error?.message).toContain(`*${formatNumberedLine(3, "charlie")}`);
    expect(error?.message).toContain(formatNumberedLine(5, "echo"));
    expect(error?.message).not.toContain("foxtrot");
  });

  it("fires onResolved with the resolved span for replace and delete blocks", () => {
    const seen: BlockResolution[] = [];
    resolveBlockEdits(
      parsePatch("SWAP.BLK 2:\n+A\n+B").edits,
      "ignored",
      PATH,
      stubResolver,
      {
        onResolved: (resolution) => seen.push(resolution),
      }
    );
    resolveBlockEdits(
      parsePatch("DEL.BLK 5").edits,
      "ignored",
      PATH,
      stubResolver,
      {
        onResolved: (resolution) => seen.push(resolution),
      }
    );

    expect(seen).toEqual([
      { anchorLine: 2, start: 2, end: 3, op: "replace" },
      { anchorLine: 5, start: 5, end: 6, op: "delete" },
    ]);
  });

  it("does not fire onResolved for a dropped unresolvable block", () => {
    const seen: BlockResolution[] = [];
    resolveBlockEdits(
      parsePatch("SWAP.BLK 2:\n+X").edits,
      "ignored",
      PATH,
      () => null,
      {
        onUnresolved: "drop",
        onResolved: (resolution) => seen.push(resolution),
      }
    );
    expect(seen).toHaveLength(0);
  });

  it("rejects a SWAP.BLK that resolves to a single line", () => {
    const edits = parsePatch("SWAP.BLK 2:\n+X").edits;
    expect(() =>
      resolveBlockEdits(edits, "a\nb\nc", PATH, singleLineResolver)
    ).toThrow(/resolved a single-line block/);
  });

  it("rejects an INS.BLK.POST that resolves to a single line", () => {
    const edits = parsePatch("INS.BLK.POST 2:\n+X").edits;
    expect(() =>
      resolveBlockEdits(edits, "a\nb\nc", PATH, singleLineResolver)
    ).toThrow(/single-line block/);
  });

  it("drops a single-line block resolution on the lenient preview path", () => {
    const edits = parsePatch("SWAP.BLK 2:\n+X").edits;
    const resolved = resolveBlockEdits(
      edits,
      "a\nb\nc",
      PATH,
      singleLineResolver,
      {
        onUnresolved: "drop",
      }
    );
    expect(resolved).toHaveLength(0);
  });
});

describe("DEL.BLK resolveBlockEdits", () => {
  it("expands a delete-block edit into pure deletes with no inserts", () => {
    const edits = parsePatch("DEL.BLK 2").edits;
    const resolved = resolveBlockEdits(edits, "ignored", PATH, stubResolver);

    expect(resolved.every((edit) => edit.kind === "delete")).toBe(true);
    expect(
      resolved.map((edit) => (edit.kind === "delete" ? edit.anchor.line : -1))
    ).toEqual([2, 3]);
  });
});

describe("INS.BLK.POST resolveBlockEdits", () => {
  it("expands to after_anchor inserts at the resolved block's last line", () => {
    const blockEdits = parsePatch("INS.BLK.POST 2:\n+A\n+B").edits;
    const resolved = resolveBlockEdits(
      blockEdits,
      "ignored",
      PATH,
      stubResolver
    );
    const insertEdits = parsePatch("INS.POST 3:\n+A\n+B").edits;

    expect(resolved.some((edit) => edit.kind === "block")).toBe(false);
    expect(normalizeEdits(resolved)).toEqual(normalizeEdits(insertEdits));
  });

  it("tags lowered inserts with blockStart so the applier can correct landings", () => {
    const blockEdits = parsePatch("INS.BLK.POST 2:\n+A").edits;
    const resolved = resolveBlockEdits(
      blockEdits,
      "ignored",
      PATH,
      stubResolver
    );
    const insert = resolved[0];
    expect(insert?.kind).toBe("insert");
    if (insert?.kind === "insert") {
      expect(insert.cursor).toEqual({
        kind: "after_anchor",
        anchor: { line: 3 },
      });
      expect(insert.blockStart).toBe(2);
    }
  });

  it("fires onResolved with op insert_after", () => {
    const seen: BlockResolution[] = [];
    resolveBlockEdits(
      parsePatch("INS.BLK.POST 2:\n+A").edits,
      "ignored",
      PATH,
      stubResolver,
      {
        onResolved: (resolution) => seen.push(resolution),
      }
    );
    expect(seen).toEqual([
      { anchorLine: 2, start: 2, end: 3, op: "insert_after" },
    ]);
  });

  it("lowers an unresolvable anchor to plain INS.POST N: with a warning", () => {
    const edits = parsePatch("INS.BLK.POST 7:\n+X").edits;
    const warnings: string[] = [];

    const resolved = resolveBlockEdits(edits, "ignored", PATH, () => null, {
      onWarning: (warning) => warnings.push(warning),
    });

    expect(normalizeEdits(resolved)).toEqual(
      normalizeEdits(parsePatch("INS.POST 7:\n+X").edits)
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("applied as plain `INS.POST 7:`");
  });

  it("lowers INS.BLK.POST even when no resolver is wired", () => {
    const edits = parsePatch("INS.BLK.POST 2:\n+X").edits;
    const warnings: string[] = [];

    const resolved = resolveBlockEdits(edits, "ignored", PATH, undefined, {
      onWarning: (warning) => warnings.push(warning),
    });

    expect(normalizeEdits(resolved)).toEqual(
      normalizeEdits(parsePatch("INS.POST 2:\n+X").edits)
    );
    expect(warnings).toHaveLength(1);
  });
});

describe("resolveBlockEdits passthrough", () => {
  it("passes non-block edits through untouched alongside a block edit", () => {
    const edits = parsePatch("SWAP 1.=1:\n+keep\nSWAP.BLK 3:\n+X").edits;
    const resolved = resolveBlockEdits(edits, "ignored", PATH, stubResolver);
    const first = resolved[0];
    expect(first?.kind).toBe("insert");
    if (first?.kind === "insert") {
      expect(first.text).toBe("keep");
    }
  });
});

describe("PatchSection.applyTo / applyPartialTo with block edits", () => {
  const text = "function x() {\n  if (y) {\n  }\n}\n";

  it("applyTo resolves a block edit and matches the equivalent replace", () => {
    const blockSection = Patch.parseSingle(
      `[${PATH}#1A2B]\nSWAP.BLK 2:\n+  if (y || z) {\n+  }`
    );
    const replaceSection = Patch.parseSingle(
      `[${PATH}#1A2B]\nSWAP 2.=3:\n+  if (y || z) {\n+  }`
    );

    const blockResult = blockSection.applyTo(text, stubResolver);
    const replaceResult = replaceSection.applyTo(text);

    expect(blockResult.text).toBe("function x() {\n  if (y || z) {\n  }\n}\n");
    expect(blockResult.text).toBe(replaceResult.text);
  });

  it("applyTo throws when a block edit has no resolver", () => {
    const section = Patch.parseSingle(`[${PATH}#1A2B]\nSWAP.BLK 2:\n+X`);
    expect(() => section.applyTo(text)).toThrow("no block resolver configured");
  });

  it("applyPartialTo drops an unresolvable block edit instead of throwing", () => {
    const section = Patch.parseSingle(`[${PATH}#1A2B]\nSWAP.BLK 2:\n+X`);
    const result = section.applyPartialTo(text);
    expect(result.text).toBe(text);
  });
});

describe("Patcher with a block resolver", () => {
  const text = "function x() {\n  if (y) {\n  }\n}\n";

  it("applies a block edit on the hash-match path", async () => {
    const fs = new InMemoryFilesystem([[PATH, text]]);
    const snapshots = new InMemorySnapshotStore();
    const tag = snapshots.record(PATH, text);
    const patcher = new Patcher({ fs, snapshots, blockResolver: stubResolver });

    const result = await patcher.apply(
      Patch.parse(`[${PATH}#${tag}]\nSWAP.BLK 2:\n+  if (y || z) {\n+  }`)
    );

    expect(result.sections[0]?.op).toBe("update");
    expect(fs.get(PATH)).toBe("function x() {\n  if (y || z) {\n  }\n}\n");
  });

  it("surfaces the resolved span on the section result (hash-match path)", async () => {
    const fs = new InMemoryFilesystem([[PATH, text]]);
    const snapshots = new InMemorySnapshotStore();
    const tag = snapshots.record(PATH, text);
    const patcher = new Patcher({ fs, snapshots, blockResolver: stubResolver });

    const result = await patcher.apply(
      Patch.parse(`[${PATH}#${tag}]\nSWAP.BLK 2:\n+  if (y || z) {\n+  }`)
    );

    expect(result.sections[0]?.blockResolutions).toEqual([
      { anchorLine: 2, start: 2, end: 3, op: "replace" },
    ]);
  });

  it("resolves against the tagged snapshot and recovers onto drifted content", async () => {
    const snapshotText = "line0\nline1\nline2\nline3\nline4\n";
    // The live file gained a trailing line after the read minted the tag.
    const liveText = "line0\nline1\nline2\nline3\nline4\nline5\n";
    const fs = new InMemoryFilesystem([[PATH, liveText]]);
    const snapshots = new InMemorySnapshotStore();
    const tag = snapshots.record(PATH, snapshotText);
    const patcher = new Patcher({ fs, snapshots, blockResolver: stubResolver });

    // `block 2` resolves against the SNAPSHOT → span [2,3] → replace
    // "line1","line2"; recovery 3-way-merges the change onto the live file.
    const result = await patcher.apply(
      Patch.parse(`[${PATH}#${tag}]\nSWAP.BLK 2:\n+NEW`)
    );

    expect(result.sections[0]?.op).toBe("update");
    expect(fs.get(PATH)).toBe("line0\nNEW\nline3\nline4\nline5\n");
    expect(result.sections[0]?.warnings.some((w) => /Recovered/.test(w))).toBe(
      true
    );
    // Drift routed the resolution through recovery, where line numbers shift,
    // so the (now-misleading) span is intentionally not surfaced.
    expect(result.sections[0]?.blockResolutions).toBeUndefined();
  });

  it("rejects a block edit whose tag was never recorded for this path", async () => {
    const liveText = "line0\nline1\nline2\n";
    const fs = new InMemoryFilesystem([[PATH, liveText]]);
    const snapshots = new InMemorySnapshotStore();
    const live = computeFileHash(liveText);
    const bogus = live === "FFFF" ? "0000" : "FFFF";
    const patcher = new Patcher({ fs, snapshots, blockResolver: stubResolver });

    await expect(
      patcher.apply(Patch.parse(`[${PATH}#${bogus}]\nSWAP.BLK 2:\n+NEW`))
    ).rejects.toBeInstanceOf(MismatchError);
    expect(fs.get(PATH)).toBe(liveText);
  });

  it("throws a block-unresolved error when the resolver returns null", async () => {
    const fs = new InMemoryFilesystem([[PATH, text]]);
    const snapshots = new InMemorySnapshotStore();
    const tag = snapshots.record(PATH, text);
    const patcher = new Patcher({ fs, snapshots, blockResolver: () => null });

    await expect(
      patcher.apply(Patch.parse(`[${PATH}#${tag}]\nSWAP.BLK 2:\n+X`))
    ).rejects.toThrow("could not resolve a syntactic block");
    expect(fs.get(PATH)).toBe(text);
  });
});

describe("DEL.BLK Patcher integration", () => {
  const text = "function x() {\n  if (y) {\n  }\n}\n";

  it("Patcher applies a delete-block edit on the hash-match path", async () => {
    const fs = new InMemoryFilesystem([[PATH, text]]);
    const snapshots = new InMemorySnapshotStore();
    const tag = snapshots.record(PATH, text);
    const patcher = new Patcher({ fs, snapshots, blockResolver: stubResolver });

    const result = await patcher.apply(
      Patch.parse(`[${PATH}#${tag}]\nDEL.BLK 2`)
    );

    expect(result.sections[0]?.op).toBe("update");
    expect(fs.get(PATH)).toBe("function x() {\n}\n");
  });
});

describe("INS.BLK.POST applyTo + Patcher integration", () => {
  const text = "function x() {\n  if (y) {\n  }\n}\n";

  it("lowers a closing-delimiter anchor to plain INS.POST N: with a warning", () => {
    const section = Patch.parseSingle(
      `[${PATH}#1A2B]\nINS.BLK.POST 3:\n+  done();`
    );
    const resolver: BlockResolver = ({ line }) =>
      line === 2 ? { start: 2, end: 3 } : null;

    const result = section.applyTo(text, resolver);

    // line 3 is `  }` — no block begins there, but it ends one; the body
    // lands after it, exactly where `insert_after_block` would have put it.
    expect(result.text).toBe("function x() {\n  if (y) {\n  }\n  done();\n}\n");
    expect(
      result.warnings?.some((w) => /applied as plain `INS.POST 3:`/.test(w))
    ).toBe(true);
  });

  it("lowers an unresolvable blank-line anchor to plain INS.POST N: instead of failing", () => {
    const blankAnchored = Patch.parseSingle(
      "[notes.md#1A2B]\nINS.BLK.POST 2:\n+- new entry"
    );

    const result = blankAnchored.applyTo(
      "### Changed\n\n- old entry\n",
      () => null
    );

    expect(result.text).toBe("### Changed\n\n- new entry\n- old entry\n");
    expect(
      result.warnings?.some((w) =>
        /could not resolve a syntactic block.*applied as plain `INS.POST 2:`/.test(
          w
        )
      )
    ).toBe(true);
  });

  it("Patcher surfaces the closer-anchor lowering warning", async () => {
    const fs = new InMemoryFilesystem([[PATH, text]]);
    const snapshots = new InMemorySnapshotStore();
    const tag = snapshots.record(PATH, text);
    const resolver: BlockResolver = ({ line }) =>
      line === 2 ? { start: 2, end: 3 } : null;
    const patcher = new Patcher({ fs, snapshots, blockResolver: resolver });

    const result = await patcher.apply(
      Patch.parse(`[${PATH}#${tag}]\nINS.BLK.POST 3:\n+  done();`)
    );

    expect(fs.get(PATH)).toBe(
      "function x() {\n  if (y) {\n  }\n  done();\n}\n"
    );
    expect(
      result.sections[0]?.warnings.some((w) =>
        /applied as plain `INS.POST 3:`/.test(w)
      )
    ).toBe(true);
  });

  it("applyTo inserts the body after the resolved block's last line", () => {
    const section = Patch.parseSingle(
      `[${PATH}#1A2B]\nINS.BLK.POST 2:\n+  done();`
    );
    // stub span [2,3] → body lands after "  }" (line 3), before the final "}".
    expect(section.applyTo(text, stubResolver).text).toBe(
      "function x() {\n  if (y) {\n  }\n  done();\n}\n"
    );
  });

  it("Patcher applies an insert-after-block edit and surfaces the resolution", async () => {
    const fs = new InMemoryFilesystem([[PATH, text]]);
    const snapshots = new InMemorySnapshotStore();
    const tag = snapshots.record(PATH, text);
    const patcher = new Patcher({ fs, snapshots, blockResolver: stubResolver });

    const result = await patcher.apply(
      Patch.parse(`[${PATH}#${tag}]\nINS.BLK.POST 2:\n+  done();`)
    );

    expect(result.sections[0]?.op).toBe("update");
    expect(fs.get(PATH)).toBe(
      "function x() {\n  if (y) {\n  }\n  done();\n}\n"
    );
    expect(result.sections[0]?.blockResolutions).toEqual([
      { anchorLine: 2, start: 2, end: 3, op: "insert_after" },
    ]);
  });
});
