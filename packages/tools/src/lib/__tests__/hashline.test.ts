import { describe, expect, it } from "vitest";
import {
  computeFileHash,
  formatHashlineHeader,
  formatNumberedLine,
} from "../hashline/format";
import type { Anchor, ApplyResult, Cursor, Edit } from "../hashline/types";

describe("computeFileHash", () => {
  it("produces a consistent 4-hex-char hash", () => {
    const hash = computeFileHash("hello\nworld\n");
    expect(hash).toMatch(/^[0-9A-F]{4}$/);
  });

  it("produces the same hash for identical content", () => {
    const a = computeFileHash("const x = 1;\n");
    const b = computeFileHash("const x = 1;\n");
    expect(a).toBe(b);
  });

  it("produces different hashes for different content", () => {
    const a = computeFileHash("hello\n");
    const b = computeFileHash("world\n");
    expect(a).not.toBe(b);
  });

  it("normalizes trailing whitespace before hashing", () => {
    const a = computeFileHash("hello\n");
    const b = computeFileHash("hello  \n");
    expect(a).toBe(b);
  });

  it("normalizes CRLF to LF before hashing", () => {
    const a = computeFileHash("hello\nworld\n");
    const b = computeFileHash("hello\r\nworld\r\n");
    expect(a).toBe(b);
  });
});

describe("formatHashlineHeader", () => {
  it("formats [path#HASH]", () => {
    expect(formatHashlineHeader("src/foo.ts", "A1B2")).toBe(
      "[src/foo.ts#A1B2]"
    );
  });
});

describe("formatNumberedLine", () => {
  it("formats LINE:text", () => {
    expect(formatNumberedLine(1, "hello")).toBe("1:hello");
  });
});

describe("Tokenizer", () => {
  const importTokenizer = () => import("../hashline/tokenizer");
  const tok = (...lines: string[]) =>
    importTokenizer().then((m) =>
      new m.Tokenizer().tokenizeAll(lines.join("\n"))
    );

  it("tokenizes header line with hash", async () => {
    const { Tokenizer } = await importTokenizer();
    const tokenizer = new Tokenizer();
    const tokens = tokenizer.tokenizeAll("[src/foo.ts#1A2B]");
    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.kind).toBe("header");
    if (tokens[0]?.kind === "header") {
      expect(tokens[0].path).toBe("src/foo.ts");
      expect(tokens[0].fileHash).toBe("1A2B");
    }
  });

  it("tokenizes header line without hash", async () => {
    const { Tokenizer } = await importTokenizer();
    const tokenizer = new Tokenizer();
    const tokens = tokenizer.tokenizeAll("[src/foo.ts]");
    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.kind).toBe("header");
    if (tokens[0]?.kind === "header") {
      expect(tokens[0].path).toBe("src/foo.ts");
      expect(tokens[0].fileHash).toBeUndefined();
    }
  });

  it("tokenizes SWAP op-block", async () => {
    const tokens = await tok("SWAP 5.=7:");
    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.kind).toBe("op-block");
    if (tokens[0]?.kind === "op-block") {
      expect(tokens[0].target.kind).toBe("replace");
    }
  });

  it("tokenizes DEL op-block", async () => {
    const tokens = await tok("DEL 10..12");
    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.kind).toBe("op-block");
    if (tokens[0]?.kind === "op-block") {
      expect(tokens[0].target.kind).toBe("delete");
    }
  });

  it("tokenizes INS.PRE and INS.POST op-blocks", async () => {
    const pre = await tok("INS.PRE 3:");
    expect(pre[0]?.kind).toBe("op-block");
    if (pre[0]?.kind === "op-block") {
      expect(pre[0].target.kind).toBe("insert_before");
    }

    const post = await tok("INS.POST 3:");
    expect(post[0]?.kind).toBe("op-block");
    if (post[0]?.kind === "op-block") {
      expect(post[0].target.kind).toBe("insert_after");
    }
  });

  it("tokenizes INS.HEAD and INS.TAIL", async () => {
    const head = await tok("INS.HEAD:");
    expect(head[0]?.kind).toBe("op-block");
    if (head[0]?.kind === "op-block") {
      expect(head[0].target.kind).toBe("bof");
    }

    const tail = await tok("INS.TAIL:");
    expect(tail[0]?.kind).toBe("op-block");
    if (tail[0]?.kind === "op-block") {
      expect(tail[0].target.kind).toBe("eof");
    }
  });

  it("tokenizes payload-literal line", async () => {
    const tokens = await tok("+literal body text");
    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.kind).toBe("payload-literal");
    if (tokens[0]?.kind === "payload-literal") {
      expect(tokens[0].text).toBe("literal body text");
    }
  });

  it("tokenizes blank line", async () => {
    const { Tokenizer } = await import("../hashline/tokenizer");
    const tokenizer = new Tokenizer();
    const tokens = tokenizer.tokenizeAll("\n");
    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.kind).toBe("blank");
  });

  it("tokenizes raw line as raw", async () => {
    const tokens = await tok("some raw content");
    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.kind).toBe("raw");
    if (tokens[0]?.kind === "raw") {
      expect(tokens[0].text).toBe("some raw content");
    }
  });

  it("tokenizes envelope-begin and envelope-end markers", async () => {
    const begin = await tok("*** Begin Patch");
    expect(begin[0]?.kind).toBe("envelope-begin");

    const end = await tok("*** End Patch");
    expect(end[0]?.kind).toBe("envelope-end");
  });

  it("parses multi-line input producing multiple tokens", async () => {
    const tokens = await tok("[src/foo.ts#1A2B]", "SWAP 5.=7:", "+new line");
    expect(tokens).toHaveLength(3);
    expect(tokens[0]?.kind).toBe("header");
    expect(tokens[1]?.kind).toBe("op-block");
    expect(tokens[2]?.kind).toBe("payload-literal");
  });
});

describe("Parser", () => {
  it("parses a simple SWAP with body", async () => {
    const { parsePatch } = await import("../hashline/parser");
    const result = parsePatch("SWAP 5.=7:\n+one\n+two\n+three");
    expect(result.edits).toHaveLength(6);
    expect(result.warnings).toEqual([]);
    const inserts = result.edits.filter((e) => e.kind === "insert");
    const deletes = result.edits.filter((e) => e.kind === "delete");
    expect(inserts).toHaveLength(3);
    expect(deletes).toHaveLength(3);
  });

  it("parses DEL range", async () => {
    const { parsePatch } = await import("../hashline/parser");
    const result = parsePatch("DEL 10..12");
    expect(result.edits).toHaveLength(3);
    expect(result.fileOp).toBeUndefined();
  });

  it("parses INS.POST with body", async () => {
    const { parsePatch } = await import("../hashline/parser");
    const result = parsePatch("INS.POST 3:\n+extra line");
    expect(result.edits).toHaveLength(1);
    expect(result.edits[0]?.kind).toBe("insert");
  });

  it("parses INS.HEAD with body", async () => {
    const { parsePatch } = await import("../hashline/parser");
    const result = parsePatch("INS.HEAD:\n+preamble");
    expect(result.edits).toHaveLength(1);
    expect(result.edits[0]?.kind).toBe("insert");
    if (result.edits[0]?.kind === "insert") {
      expect(result.edits[0].cursor.kind).toBe("bof");
    }
  });

  it("parses REM op", async () => {
    const { parsePatch } = await import("../hashline/parser");
    const result = parsePatch("REM");
    expect(result.fileOp?.kind).toBe("rem");
  });

  it("parses MV op with destination", async () => {
    const { parsePatch } = await import("../hashline/parser");
    const result = parsePatch('MV "dest.ts"');
    expect(result.fileOp?.kind).toBe("move");
    if (result.fileOp?.kind === "move") {
      expect(result.fileOp.dest).toBe("dest.ts");
    }
  });
});

describe("applyEdits", () => {
  it("replaces a single line", async () => {
    const { applyEdits } = await import("../hashline/apply");
    const { parsePatch } = await import("../hashline/parser");
    const result = parsePatch("SWAP 2.=2:\n+hello world");
    const applied = applyEdits("line1\nline2\nline3\n", result.edits);
    expect(applied.text).toBe("line1\nhello world\nline3\n");
    expect(applied.firstChangedLine).toBe(2);
  });

  it("replaces a multi-line range", async () => {
    const { applyEdits } = await import("../hashline/apply");
    const { parsePatch } = await import("../hashline/parser");
    const result = parsePatch("SWAP 2.=3:\n+newA\n+newB");
    const applied = applyEdits("a\nb\nc\nd\n", result.edits);
    expect(applied.text).toBe("a\nnewA\nnewB\nd\n");
    expect(applied.firstChangedLine).toBe(2);
  });

  it("deletes lines", async () => {
    const { applyEdits } = await import("../hashline/apply");
    const { parsePatch } = await import("../hashline/parser");
    const result = parsePatch("DEL 2..3");
    const applied = applyEdits("a\nb\nc\nd\n", result.edits);
    expect(applied.text).toBe("a\nd\n");
    expect(applied.firstChangedLine).toBe(2);
  });

  it("inserts before a line", async () => {
    const { applyEdits } = await import("../hashline/apply");
    const { parsePatch } = await import("../hashline/parser");
    const result = parsePatch("INS.PRE 2:\n+before");
    const applied = applyEdits("a\nb\nc\n", result.edits);
    expect(applied.text).toBe("a\nbefore\nb\nc\n");
    expect(applied.firstChangedLine).toBe(2);
  });

  it("inserts after a line", async () => {
    const { applyEdits } = await import("../hashline/apply");
    const { parsePatch } = await import("../hashline/parser");
    const result = parsePatch("INS.POST 2:\n+after");
    const applied = applyEdits("a\nb\nc\n", result.edits);
    expect(applied.text).toBe("a\nb\nafter\nc\n");
    // The applier reports the anchor line itself as changed
    expect(applied.firstChangedLine).toBe(2);
  });

  it("inserts at head", async () => {
    const { applyEdits } = await import("../hashline/apply");
    const { parsePatch } = await import("../hashline/parser");
    const result = parsePatch("INS.HEAD:\n+top");
    const applied = applyEdits("a\nb\n", result.edits);
    expect(applied.text).toBe("top\na\nb\n");
    expect(applied.firstChangedLine).toBe(1);
  });

  it("inserts at tail", async () => {
    const { applyEdits } = await import("../hashline/apply");
    const { parsePatch } = await import("../hashline/parser");
    const result = parsePatch("INS.TAIL:\n+bottom");
    const applied = applyEdits("a\nb\n", result.edits);
    expect(applied.text).toBe("a\nb\nbottom\n");
    expect(applied.firstChangedLine).toBe(3);
  });

  it("inserts at BOF on empty file", async () => {
    const { applyEdits } = await import("../hashline/apply");
    const { parsePatch } = await import("../hashline/parser");
    const result = parsePatch("INS.HEAD:\n+content");
    const applied = applyEdits("", result.edits);
    // Empty file has no trailing newline, so output has none either
    expect(applied.text).toBe("content");
    expect(applied.firstChangedLine).toBe(1);
  });

  it("throws on out-of-bounds anchor", async () => {
    const { applyEdits } = await import("../hashline/apply");
    const { parsePatch } = await import("../hashline/parser");
    const result = parsePatch("SWAP 10.=10:\n+x");
    expect(() => applyEdits("a\nb\n", result.edits)).toThrow(
      "Line 10 does not exist"
    );
  });

  it("returns noop for empty edits", async () => {
    const { applyEdits } = await import("../hashline/apply");
    const result = applyEdits("hello\n", []);
    expect(result.text).toBe("hello\n");
    expect(result.firstChangedLine).toBeUndefined();
  });
});

describe("Patch", () => {
  it("parses a single-section patch", async () => {
    const { Patch } = await import("../hashline/input");
    const patch = Patch.parse("[src/foo.ts#1A2B]\nSWAP 5.=7:\n+new\n+stuff\n");
    expect(patch.sections).toHaveLength(1);
    expect(patch.sections[0]?.path).toBe("src/foo.ts");
    expect(patch.sections[0]?.fileHash).toBe("1A2B");
  });

  it("parses a multi-section patch", async () => {
    const { Patch } = await import("../hashline/input");
    const patch = Patch.parse(
      "[a.ts#1A2B]\nSWAP 1.=1:\n+x\n[b.ts#3C4D]\nDEL 2\n"
    );
    expect(patch.sections).toHaveLength(2);
    expect(patch.sections[0]?.path).toBe("a.ts");
    expect(patch.sections[1]?.path).toBe("b.ts");
  });

  it("parses a section without hash tag", async () => {
    const { Patch } = await import("../hashline/input");
    const patch = Patch.parse("[src/foo.ts]\nSWAP 1.=1:\n+x\n");
    expect(patch.sections).toHaveLength(1);
    expect(patch.sections[0]?.fileHash).toBeUndefined();
  });

  it("provides parsed edits via PatchSection.parse()", async () => {
    const { Patch } = await import("../hashline/input");
    const patch = Patch.parse("[src/foo.ts#1A2B]\nSWAP 5.=7:\n+new\n+stuff\n");
    const parsed = patch.sections[0]?.parse();
    expect(parsed?.edits).toBeDefined();
    expect(parsed?.edits.length).toBeGreaterThan(0);
  });

  it("returns parsed edits lazily (cached)", async () => {
    const { Patch } = await import("../hashline/input");
    const patch = Patch.parse("[x.ts#1A2B]\nDEL 1\n");
    const section = patch.sections[0];
    if (!section) throw new Error("No section");
    const a = section.parse();
    const b = section.parse();
    expect(a.edits).toBe(b.edits);
  });
});

describe("Recovery", () => {
  it("recovers from hash mismatch via 3-way merge", async () => {
    const { Patch } = await import("../hashline/input");
    const { recoverWithThreeWayMerge } = await import("../hashline/recovery");
    const original = "keep\nkeep\nchange\nkeep\n";
    const live = "keep\nkeep\nchange\nkeep\nadded\n";
    const patch = Patch.parseSingle("[foo.ts#ABCD]\nSWAP 3:\nreplaced\n");
    const result = recoverWithThreeWayMerge(original, live, patch);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.text).toBe("keep\nkeep\nreplaced\nkeep\nadded\n");
    }
  });

  it("returns failed result when conflict is unresolvable", async () => {
    const { Patch } = await import("../hashline/input");
    const { recoverWithThreeWayMerge } = await import("../hashline/recovery");
    const original = "a\nb\nc\n";
    const live = "x\ny\nz\n";
    const patch = Patch.parseSingle("[foo.ts#ABCD]\nSWAP 1:\nq\n");
    const result = recoverWithThreeWayMerge(original, live, patch);
    expect(result.success).toBe(false);
  });
});

describe("InMemorySnapshotStore", () => {
  it("records and retrieves by hash", async () => {
    const { InMemorySnapshotStore } = await import("../hashline/snapshots");
    const store = new InMemorySnapshotStore();
    const hash = store.record("foo.ts", "hello\nworld\n");
    expect(hash).toMatch(/^[0-9A-F]{4}$/);
    const snapshot = store.byHash("foo.ts", hash);
    expect(snapshot).not.toBeNull();
    expect(snapshot?.text).toBe("hello\nworld\n");
  });

  it("returns head snapshot", async () => {
    const { InMemorySnapshotStore } = await import("../hashline/snapshots");
    const store = new InMemorySnapshotStore();
    store.record("foo.ts", "version1\n");
    store.record("foo.ts", "version2\n");
    const head = store.head("foo.ts");
    expect(head?.text).toBe("version2\n");
  });

  it("deduplicates identical content", async () => {
    const { InMemorySnapshotStore } = await import("../hashline/snapshots");
    const store = new InMemorySnapshotStore();
    const a = store.record("foo.ts", "hello\n");
    const b = store.record("foo.ts", "hello\n");
    expect(a).toBe(b);
  });

  it("recordSeenLines merges into existing snapshot", async () => {
    const { InMemorySnapshotStore } = await import("../hashline/snapshots");
    const store = new InMemorySnapshotStore();
    const hash = store.record("foo.ts", "a\nb\nc\n", [1, 2]);
    store.recordSeenLines("foo.ts", hash, [3]);
    const snapshot = store.byHash("foo.ts", hash);
    expect(snapshot?.seenLines?.has(1)).toBe(true);
    expect(snapshot?.seenLines?.has(3)).toBe(true);
  });

  it("findByHash returns snapshots across paths", async () => {
    const { InMemorySnapshotStore } = await import("../hashline/snapshots");
    const store = new InMemorySnapshotStore();
    const hash = store.record("a.ts", "shared\n");
    store.record("b.ts", "other\n");
    const matches = store.findByHash(hash);
    expect(matches).toHaveLength(1);
    expect(matches[0]?.path).toBe("a.ts");
  });

  it("invalidate clears path history", async () => {
    const { InMemorySnapshotStore } = await import("../hashline/snapshots");
    const store = new InMemorySnapshotStore();
    store.record("foo.ts", "content\n");
    expect(store.head("foo.ts")).not.toBeNull();
    store.invalidate("foo.ts");
    expect(store.head("foo.ts")).toBeNull();
  });

  it("relocate moves history to new path", async () => {
    const { InMemorySnapshotStore } = await import("../hashline/snapshots");
    const store = new InMemorySnapshotStore();
    const hash = store.record("old.ts", "content\n");
    store.relocate("old.ts", "new.ts");
    expect(store.head("old.ts")).toBeNull();
    expect(store.head("new.ts")?.text).toBe("content\n");
    expect(store.byHash("new.ts", hash)).not.toBeNull();
  });
});

describe("Hashline types", () => {
  it("Anchor is a 1-indexed line number", () => {
    const anchor: Anchor = { line: 1 };
    expect(anchor.line).toBe(1);
  });

  it("Cursor can be bof, eof, before_anchor, or after_anchor", () => {
    const bof: Cursor = { kind: "bof" };
    expect(bof.kind).toBe("bof");

    const before: Cursor = {
      kind: "before_anchor",
      anchor: { line: 5 },
    };
    expect(before.kind).toBe("before_anchor");
    expect(before.anchor.line).toBe(5);
  });

  it("Edit can be insert, delete, or block", () => {
    const insert: Edit = {
      kind: "insert",
      cursor: { kind: "bof" },
      text: "hello",
      lineNum: 1,
      index: 0,
    };
    expect(insert.kind).toBe("insert");

    const del: Edit = {
      kind: "delete",
      anchor: { line: 3 },
      lineNum: 2,
      index: 1,
    };
    expect(del.kind).toBe("delete");
  });

  it("ApplyResult has text and optional firstChangedLine", () => {
    const result: ApplyResult = { text: "hello\nworld", firstChangedLine: 1 };
    expect(result.text).toBe("hello\nworld");
    expect(result.firstChangedLine).toBe(1);
  });
});
