import { describe, expect, it } from "vite-plus/test";
import type { MessageEntry } from "../../../session/entries.ts";
import type { AgentMessage } from "../../../types.ts";
import { getObservedEntryIdsForCleanup, resolveRetentionFloor } from "../cleanup.ts";

function makeMsg(content: string, timestamp = 1): AgentMessage {
  return { role: "user", content, timestamp } as AgentMessage;
}

function makeEntry(id: string, content: string): MessageEntry {
  return {
    type: "message",
    id,
    parentId: null,
    timestamp: new Date().toISOString(),
    message: makeMsg(content),
  };
}

/** Simple token counter: 1 token per character. */
const charCounter = {
  countMessages(messages: AgentMessage[]): number {
    return messages.reduce((sum, m) => {
      const content = "content" in m && typeof m.content === "string" ? m.content : "";
      return sum + content.length;
    }, 0);
  },
};

describe("resolveRetentionFloor", () => {
  it("ratio mode: threshold * (1 - ratio)", () => {
    expect(resolveRetentionFloor(0.8, 30_000)).toBe(6_000);
    expect(resolveRetentionFloor(0.5, 10_000)).toBe(5_000);
  });

  it("absolute mode when >= 1000", () => {
    expect(resolveRetentionFloor(5_000, 30_000)).toBe(5_000);
  });

  it("zero floor when ratio = 1.0", () => {
    expect(resolveRetentionFloor(1.0, 30_000)).toBe(0);
  });
});

describe("getObservedEntryIdsForCleanup", () => {
  it("returns all observed IDs when floor is 0", () => {
    const entries = [makeEntry("m1", "aaa"), makeEntry("m2", "bbb"), makeEntry("m3", "ccc")];
    const result = getObservedEntryIdsForCleanup({
      entries,
      observedEntryIds: ["m1", "m2"],
      retentionFloor: 0,
      tokenCounter: charCounter,
    });
    expect(result).toEqual(expect.arrayContaining(["m1", "m2"]));
    expect(result).toHaveLength(2);
  });

  it("stops removing when floor would be violated (LIFO restore)", () => {
    // Each entry = 3 tokens (3 chars). Total = 9.
    // Observed: m1, m2. Floor: 5 tokens.
    // After removing m1: remaining = m2(3) + m3(3) = 6 ≥ 5 ✓
    // After removing m1+m2: remaining = m3(3) = 3 < 5 ✗ → restore m2
    const entries = [makeEntry("m1", "aaa"), makeEntry("m2", "bbb"), makeEntry("m3", "ccc")];
    const result = getObservedEntryIdsForCleanup({
      entries,
      observedEntryIds: ["m1", "m2"],
      retentionFloor: 5,
      tokenCounter: charCounter,
    });
    expect(result).toEqual(["m1"]); // m2 restored by LIFO
  });

  it("keeps all observed when floor would remove everything", () => {
    // Only 3 tokens total. Floor = 10. Nothing can be removed.
    const entries = [makeEntry("m1", "aaa")];
    const result = getObservedEntryIdsForCleanup({
      entries,
      observedEntryIds: ["m1"],
      retentionFloor: 10,
      tokenCounter: charCounter,
    });
    expect(result).toEqual([]);
  });

  it("returns empty for empty observed IDs", () => {
    expect(
      getObservedEntryIdsForCleanup({
        entries: [makeEntry("m1", "aaa")],
        observedEntryIds: [],
        retentionFloor: 1000,
        tokenCounter: charCounter,
      }),
    ).toEqual([]);
  });

  it("handles observed IDs not in entries (already pruned)", () => {
    const entries = [makeEntry("m3", "ccc")];
    const result = getObservedEntryIdsForCleanup({
      entries,
      observedEntryIds: ["m1", "m2"], // not in entries
      retentionFloor: 0,
      tokenCounter: charCounter,
    });
    expect(result).toEqual([]);
  });

  it("removes all observed when remaining well above floor", () => {
    // m1(100 tokens observed), m2(100 tokens observed), m3(1000 tokens unobserved)
    // Floor: 500. After removing m1+m2: remaining = 1000 ≥ 500 ✓
    const entries = [
      makeEntry("m1", "a".repeat(100)),
      makeEntry("m2", "b".repeat(100)),
      makeEntry("m3", "c".repeat(1000)),
    ];
    const result = getObservedEntryIdsForCleanup({
      entries,
      observedEntryIds: ["m1", "m2"],
      retentionFloor: 500,
      tokenCounter: charCounter,
    });
    expect(result).toEqual(expect.arrayContaining(["m1", "m2"]));
  });
});
