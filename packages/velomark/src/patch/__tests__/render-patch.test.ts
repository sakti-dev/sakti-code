import { describe, expect, it } from "vitest";
import { buildRenderDocument } from "../../model/render-document";
import { planRenderPatch } from "../render-patch";

describe("planRenderPatch", () => {
  it("reuses the unchanged prefix for append-only growth", () => {
    const previous = buildRenderDocument(undefined, "First\n\nSecond");
    const next = buildRenderDocument(previous, "First\n\nSecond\n\nThird");

    const patch = planRenderPatch(previous, next);

    expect(patch.unchangedPrefixCount).toBe(2);
    expect(patch.replaceFromIndex).toBe(2);
    expect(patch.nextBlocks).toHaveLength(1);
    expect(patch.nextBlocks[0]?.data).toMatchObject({ text: "Third" });
  });

  it("replaces only the tail block when the prefix is unchanged", () => {
    const previous = buildRenderDocument(undefined, "First\n\nTail");
    const next = buildRenderDocument(previous, "First\n\nTail expanded");

    const patch = planRenderPatch(previous, next);

    expect(patch.unchangedPrefixCount).toBe(1);
    expect(patch.replaceFromIndex).toBe(1);
    expect(patch.nextBlocks).toHaveLength(1);
    expect(patch.nextBlocks[0]?.data).toMatchObject({ text: "Tail expanded" });
  });

  it("replaces from the first changed block onward for non-prefix rewrites", () => {
    const previous = buildRenderDocument(undefined, "One\n\nTwo\n\nThree");
    const next = buildRenderDocument(previous, "One changed\n\nTwo\n\nThree");

    const patch = planRenderPatch(previous, next);

    expect(patch.unchangedPrefixCount).toBe(0);
    expect(patch.replaceFromIndex).toBe(0);
    expect(patch.nextBlocks).toHaveLength(3);
  });

  it("returns a full replacement when there is no previous document", () => {
    const next = buildRenderDocument(undefined, "Solo");

    const patch = planRenderPatch(undefined, next);

    expect(patch.unchangedPrefixCount).toBe(0);
    expect(patch.replaceFromIndex).toBe(0);
    expect(patch.nextBlocks).toHaveLength(1);
  });
});
