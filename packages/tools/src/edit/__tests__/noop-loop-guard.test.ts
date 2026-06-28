import { describe, expect, it } from "vitest";
import {
  hashPatchInput,
  NOOP_HARD_LIMIT,
  type NoopLoopGuardOwner,
  recordNoopEdit,
  resetNoopEdit,
} from "../noop-loop-guard";

describe("noop-loop-guard", () => {
  it("does not escalate on the first identical no-op", () => {
    const session: NoopLoopGuardOwner = {};
    expect(recordNoopEdit(session, "/a.ts", "h1")).toEqual({
      count: 1,
      escalate: false,
    });
  });

  it("escalates once count reaches NOOP_HARD_LIMIT for the same payload+path", () => {
    const session: NoopLoopGuardOwner = {};
    recordNoopEdit(session, "/a.ts", "h1");
    recordNoopEdit(session, "/a.ts", "h1");
    const r = recordNoopEdit(session, "/a.ts", "h1");
    expect(r.count).toBe(NOOP_HARD_LIMIT);
    expect(r.escalate).toBe(true);
  });

  it("resets the counter when the payload changes (progress earns another soft hint)", () => {
    const session: NoopLoopGuardOwner = {};
    recordNoopEdit(session, "/a.ts", "h1");
    recordNoopEdit(session, "/a.ts", "h1");
    expect(recordNoopEdit(session, "/a.ts", "h2")).toEqual({
      count: 1,
      escalate: false,
    });
  });

  it("tracks paths independently", () => {
    const session: NoopLoopGuardOwner = {};
    recordNoopEdit(session, "/a.ts", "h");
    recordNoopEdit(session, "/b.ts", "h");
    recordNoopEdit(session, "/a.ts", "h");
    expect(recordNoopEdit(session, "/b.ts", "h").count).toBe(2);
  });

  it("resetNoopEdit clears a path after a successful commit", () => {
    const session: NoopLoopGuardOwner = {};
    recordNoopEdit(session, "/a.ts", "h");
    resetNoopEdit(session, "/a.ts");
    expect(recordNoopEdit(session, "/a.ts", "h").count).toBe(1);
  });

  it("resetNoopEdit is a no-op when no guard exists yet", () => {
    const session: NoopLoopGuardOwner = {};
    expect(() => resetNoopEdit(session, "/a.ts")).not.toThrow();
  });

  it("hashPatchInput does not normalize trailing whitespace (progress is detected)", () => {
    expect(hashPatchInput("SWAP 1.=1:\nfoo")).not.toBe(
      hashPatchInput("SWAP 1.=1:\nfoo   ")
    );
  });

  it("hashPatchInput is deterministic for identical payloads", () => {
    expect(hashPatchInput("SWAP 1.=1:\nfoo")).toBe(
      hashPatchInput("SWAP 1.=1:\nfoo")
    );
  });
});
