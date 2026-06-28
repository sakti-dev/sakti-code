import { describe, expect, it } from "vitest";
import { formatNumberedLine } from "../../../lib/hashline-utils/format";
import type {
  BlockResolution,
  BlockResolver,
  BlockSpan,
  Edit,
} from "../../../lib/hashline-utils/types";
import { hasBlockEdit, resolveBlockEdits } from "../block";
import { parsePatch } from "../parser";

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
      stubResolver,
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
      "not available here",
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
    expect(() =>
      resolveBlockEdits(edits, "ignored", PATH, () => null),
    ).toThrow("could not resolve a syntactic block beginning on line 7");
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
      "could not resolve a syntactic block beginning on line 3",
    );
    expect(error?.message).toContain(formatNumberedLine(1, "alpha"));
    expect(error?.message).toContain(`*${formatNumberedLine(3, "charlie")}`);
    expect(error?.message).toContain(formatNumberedLine(5, "echo"));
    expect(error?.message).not.toContain("foxtrot");
  });

  it("fires onResolved with the resolved span for replace and delete blocks", () => {
    const seen: BlockResolution[] = [];
    resolveBlockEdits(parsePatch("SWAP.BLK 2:\n+A\n+B").edits, "ignored", PATH, stubResolver, {
      onResolved: (resolution) => seen.push(resolution),
    });
    resolveBlockEdits(parsePatch("DEL.BLK 5").edits, "ignored", PATH, stubResolver, {
      onResolved: (resolution) => seen.push(resolution),
    });

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
      },
    );
    expect(seen).toHaveLength(0);
  });

  it("rejects a SWAP.BLK that resolves to a single line", () => {
    const edits = parsePatch("SWAP.BLK 2:\n+X").edits;
    expect(() =>
      resolveBlockEdits(edits, "a\nb\nc", PATH, singleLineResolver),
    ).toThrow(/resolved a single-line block/);
  });

  it("rejects an INS.BLK.POST that resolves to a single line", () => {
    const edits = parsePatch("INS.BLK.POST 2:\n+X").edits;
    expect(() =>
      resolveBlockEdits(edits, "a\nb\nc", PATH, singleLineResolver),
    ).toThrow(/single-line block/);
  });

  it("drops a single-line block resolution on the lenient preview path", () => {
    const edits = parsePatch("SWAP.BLK 2:\n+X").edits;
    const resolved = resolveBlockEdits(edits, "a\nb\nc", PATH, singleLineResolver, {
      onUnresolved: "drop",
    });
    expect(resolved).toHaveLength(0);
  });
});

describe("DEL.BLK resolveBlockEdits", () => {
  it("expands a delete-block edit into pure deletes with no inserts", () => {
    const edits = parsePatch("DEL.BLK 2").edits;
    const resolved = resolveBlockEdits(edits, "ignored", PATH, stubResolver);

    expect(resolved.every((edit) => edit.kind === "delete")).toBe(true);
    expect(
      resolved.map((edit) => (edit.kind === "delete" ? edit.anchor.line : -1)),
    ).toEqual([2, 3]);
  });
});

describe("INS.BLK.POST resolveBlockEdits", () => {
  it("expands to after_anchor inserts at the resolved block's last line", () => {
    const blockEdits = parsePatch("INS.BLK.POST 2:\n+A\n+B").edits;
    const resolved = resolveBlockEdits(blockEdits, "ignored", PATH, stubResolver);
    const insertEdits = parsePatch("INS.POST 3:\n+A\n+B").edits;

    expect(resolved.some((edit) => edit.kind === "block")).toBe(false);
    expect(normalizeEdits(resolved)).toEqual(normalizeEdits(insertEdits));
  });

  it("tags lowered inserts with blockStart so the applier can correct landings", () => {
    const blockEdits = parsePatch("INS.BLK.POST 2:\n+A").edits;
    const resolved = resolveBlockEdits(blockEdits, "ignored", PATH, stubResolver);
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
      { onResolved: (resolution) => seen.push(resolution) },
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
      normalizeEdits(parsePatch("INS.POST 7:\n+X").edits),
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
      normalizeEdits(parsePatch("INS.POST 2:\n+X").edits),
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
