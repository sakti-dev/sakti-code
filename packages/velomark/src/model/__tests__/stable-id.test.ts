import { describe, expect, it } from "vitest";
import type { RenderBlock } from "../../types";
import { assignStableBlockIds } from "../stable-id";

const BLOCK_ID_RE = /^b_[a-z0-9]{8}$/;

function createDraftBlock(
  overrides: Partial<Omit<RenderBlock, "id">> = {}
): Omit<RenderBlock, "id"> {
  return {
    kind: "paragraph",
    sourceStart: 0,
    sourceEnd: 12,
    status: "complete",
    fingerprint: "paragraph:hello-world",
    data: { text: "Hello world" },
    ...overrides,
  };
}

describe("assignStableBlockIds", () => {
  it("keeps unchanged prefix block ids during append-only growth", () => {
    const previous = assignStableBlockIds(
      [],
      [
        createDraftBlock({
          sourceStart: 0,
          sourceEnd: 12,
          fingerprint: "paragraph:intro",
          data: { text: "Intro" },
        }),
        createDraftBlock({
          sourceStart: 14,
          sourceEnd: 29,
          fingerprint: "paragraph:details",
          data: { text: "More details" },
        }),
      ]
    );

    const next = assignStableBlockIds(previous, [
      createDraftBlock({
        sourceStart: 0,
        sourceEnd: 12,
        fingerprint: "paragraph:intro",
        data: { text: "Intro" },
      }),
      createDraftBlock({
        sourceStart: 14,
        sourceEnd: 29,
        fingerprint: "paragraph:details",
        data: { text: "More details" },
      }),
      createDraftBlock({
        sourceStart: 31,
        sourceEnd: 46,
        fingerprint: "paragraph:tail",
        status: "streaming",
        data: { text: "Tail" },
      }),
    ]);

    expect(next[0]?.id).toBe(previous[0]?.id);
    expect(next[1]?.id).toBe(previous[1]?.id);
    expect(next[2]?.id).not.toBe(previous[1]?.id);
  });

  it("replaces the id when the tail block fingerprint changes", () => {
    const previous = assignStableBlockIds(
      [],
      [
        createDraftBlock({
          sourceStart: 0,
          sourceEnd: 12,
          fingerprint: "paragraph:intro",
          data: { text: "Intro" },
        }),
        createDraftBlock({
          sourceStart: 14,
          sourceEnd: 25,
          fingerprint: "paragraph:tail-v1",
          status: "streaming",
          data: { text: "Tail v1" },
        }),
      ]
    );

    const next = assignStableBlockIds(previous, [
      createDraftBlock({
        sourceStart: 0,
        sourceEnd: 12,
        fingerprint: "paragraph:intro",
        data: { text: "Intro" },
      }),
      createDraftBlock({
        sourceStart: 14,
        sourceEnd: 31,
        fingerprint: "paragraph:tail-v2",
        status: "streaming",
        data: { text: "Tail v2 expanded" },
      }),
    ]);

    expect(next[0]?.id).toBe(previous[0]?.id);
    expect(next[1]?.id).not.toBe(previous[1]?.id);
  });

  it("creates different ids for identical fingerprints at different source spans", () => {
    const blocks = assignStableBlockIds(
      [],
      [
        createDraftBlock({
          sourceStart: 0,
          sourceEnd: 5,
          fingerprint: "paragraph:repeat",
          data: { text: "Repeat" },
        }),
        createDraftBlock({
          sourceStart: 10,
          sourceEnd: 15,
          fingerprint: "paragraph:repeat",
          data: { text: "Repeat" },
        }),
      ]
    );

    expect(blocks[0]?.id).not.toBe(blocks[1]?.id);
  });

  it("uses short opaque ids instead of embedding raw fingerprint text", () => {
    const blocks = assignStableBlockIds(
      [],
      [
        createDraftBlock({
          sourceStart: 30,
          sourceEnd: 185,
          fingerprint:
            "paragraph:This preset is intentionally long and shaped like a coding-agent response.",
          data: {
            text: "This preset is intentionally long and shaped like a coding-agent response.",
          },
        }),
      ]
    );

    expect(blocks[0]?.id).toMatch(BLOCK_ID_RE);
    expect(blocks[0]?.id).not.toContain("coding-agent");
    expect(blocks[0]?.id).not.toContain("paragraph:");
  });
});
