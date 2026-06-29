import { describe, expect, it } from "vite-plus/test";
import { generateNumberedDiff } from "../../edit-diff";
import { buildCompactDiffPreview } from "../diff-preview";

describe("buildCompactDiffPreview", () => {
  describe("added-run elision", () => {
    it("keeps every line of a short added run (<= threshold) with no elision", () => {
      const result = buildCompactDiffPreview("+1|a\n+2|b\n+3|c");

      expect(result.preview).toBe("1:a\n2:b\n3:c");
      expect(result.preview).not.toContain("…");
      expect(result.addedLines).toBe(3);
      expect(result.removedLines).toBe(0);
    });

    it("elides the middle of a long added run (> threshold), keeping head and tail", () => {
      const result = buildCompactDiffPreview(
        "+1|a\n+2|b\n+3|c\n+4|d\n+5|e\n+6|f\n+7|g"
      );

      expect(result.preview).toBe("1:a\n2:b\n…\n6:f\n7:g");
      expect(result.addedLines).toBe(7);
      expect(result.removedLines).toBe(0);
      for (const dropped of ["3:c", "4:d", "5:e"]) {
        expect(result.preview).not.toContain(dropped);
      }
    });

    it("does not elide at exactly the threshold (edgeLines*2+1 = 5)", () => {
      const at = buildCompactDiffPreview("+1|a\n+2|b\n+3|c\n+4|d\n+5|e");
      expect(at.preview).toBe("1:a\n2:b\n3:c\n4:d\n5:e");
      expect(at.preview).not.toContain("…");

      const over = buildCompactDiffPreview(
        "+1|a\n+2|b\n+3|c\n+4|d\n+5|e\n+6|f"
      );
      expect(over.preview).toBe("1:a\n2:b\n…\n5:e\n6:f");
    });

    it("honors a custom maxAddedRunContext for the head/tail size", () => {
      const result = buildCompactDiffPreview("+1|a\n+2|b\n+3|c\n+4|d", {
        maxAddedRunContext: 1,
      });

      expect(result.preview).toBe("1:a\n…\n4:d");
      expect(result.addedLines).toBe(4);
    });
  });

  describe("removed lines", () => {
    it("counts removed lines but omits their content and renumbers trailing context", () => {
      const result = buildCompactDiffPreview("-1|foo\n-2|bar\n 3|ctx");

      expect(result.removedLines).toBe(2);
      expect(result.addedLines).toBe(0);
      expect(result.preview).not.toContain("foo");
      expect(result.preview).not.toContain("bar");
      expect(result.preview).toBe("1:ctx");
    });
  });

  describe("post-edit renumbering", () => {
    it("shifts a context line's number by addedLines - removedLines", () => {
      const result = buildCompactDiffPreview("+1|new\n 2|kept");

      expect(result.preview).toBe("1:new\n3:kept");
      expect(result.preview).toContain("3:kept");
      expect(result.preview).not.toContain("2:kept");
      expect(result.addedLines).toBe(1);
      expect(result.removedLines).toBe(0);
    });

    it("compensates when an add and a remove cancel out before a context line", () => {
      const result = buildCompactDiffPreview("+1|new\n-2|old\n 3|kept");

      expect(result.preview).toBe("1:new\n3:kept");
      expect(result.addedLines).toBe(1);
      expect(result.removedLines).toBe(1);
    });
  });

  describe("separators", () => {
    it("never stacks two separator rows adjacently across omitted removed lines", () => {
      const result = buildCompactDiffPreview("+1|a\n...\n-5|x\n...\n+9|z");

      const rows = result.preview.split("\n");
      const adjacent = rows.some(
        (row, i) =>
          i > 0 &&
          (row === "…" || row === "") &&
          (rows[i - 1] === "…" || rows[i - 1] === "")
      );
      expect(adjacent).toBe(false);
      expect(result.preview).toBe("1:a\n…\n9:z");
    });

    it("drops a leading separator when the diff starts with omitted removed lines", () => {
      const result = buildCompactDiffPreview("-1|foo\n-2|bar\n+1|baz");

      expect(result.preview.startsWith("…")).toBe(false);
      expect(result.preview).toBe("1:baz");
      expect(result.removedLines).toBe(2);
    });

    it("strips trailing separators left by a diff that ends on removed lines", () => {
      const result = buildCompactDiffPreview("+1|new\n-2|old");

      expect(result.preview).toBe("1:new");
      expect(result.removedLines).toBe(1);
    });
  });

  describe("edge cases", () => {
    it("returns an empty preview with zero counts for an empty diff", () => {
      const result = buildCompactDiffPreview("");

      expect(result.preview).toBe("");
      expect(result.addedLines).toBe(0);
      expect(result.removedLines).toBe(0);
    });
  });
});

describe("generateNumberedDiff", () => {
  it("emits pipe-format lines whose preview round-trips the new content", () => {
    const { diff } = generateNumberedDiff("a\nb\nc", "a\nX\nc");

    const preview = buildCompactDiffPreview(diff);
    expect(preview.preview).toContain("X");
    expect(preview.preview).toBe("1:a\n2:X\n3:c");
  });

  it("reports the first changed line (1-based, post-edit) for a mid-file change", () => {
    const { firstChangedLine } = generateNumberedDiff("a\nb\nc", "a\nX\nc");

    expect(firstChangedLine).toBe(2);
  });

  it("marks a pure insertion with a '+' line", () => {
    const { diff, firstChangedLine } = generateNumberedDiff("a\nb", "a\nb\nc");

    expect(diff).toMatch(/^\+.*$/m);
    expect(firstChangedLine).toBe(2);
  });

  it("marks a pure deletion with a '-' line", () => {
    const { diff, firstChangedLine } = generateNumberedDiff("a\nb\nc", "a\nc");

    expect(diff).toMatch(/^-.*$/m);
    expect(firstChangedLine).toBe(2);
  });
});
