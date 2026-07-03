import { describe, expect, it } from "vite-plus/test";
import { setupCompletedTurn } from "./handler-helpers.ts";

describe("compaction handlers — the splitCache bug fix", () => {
  it("compaction_start after turn finalized adds marker to last assistant message", () => {
    const { session, dispatch } = setupCompletedTurn();
    expect(session.store.turns[0]!.endedAt).not.toBeNull();

    dispatch({ reason: "manual", type: "compaction_start" });

    const parts = session.store.turns[0]!.messages[0]!.parts;
    expect(parts.some((p) => p.type === "compaction")).toBe(true);
  });

  it("compaction_start pins currentMessageId to the target", () => {
    const { session, dispatch } = setupCompletedTurn();
    expect(session.store.streaming.currentMessageId).toBeNull();

    dispatch({ reason: "manual", type: "compaction_start" });

    expect(session.store.streaming.currentMessageId).not.toBeNull();
  });

  it("compaction_delta appends text to the compaction part", () => {
    const { session, dispatch } = setupCompletedTurn();
    dispatch({ reason: "manual", type: "compaction_start" });
    dispatch({ text: "Sum", type: "compaction_delta" });
    dispatch({ text: "mary", type: "compaction_delta" });

    const compactionPart = session.store.turns[0]!.messages[0]!.parts.find(
      (p) => p.type === "compaction",
    );
    expect(compactionPart).toMatchObject({ type: "compaction", text: "Summary" });
  });

  it("compaction_end with result marks complete with tokensBefore", () => {
    const { session, dispatch } = setupCompletedTurn();
    dispatch({ reason: "manual", type: "compaction_start" });
    dispatch({
      aborted: false,
      reason: "manual",
      result: { firstKeptEntryId: "x", summary: "...", tokensBefore: 50000 },
      type: "compaction_end",
      willRetry: false,
    });

    const compactionPart = session.store.turns[0]!.messages[0]!.parts.find(
      (p) => p.type === "compaction",
    );
    expect(compactionPart).toMatchObject({
      type: "compaction",
      status: "complete",
      tokensBefore: 50000,
    });
    expect(session.store.streaming.phase).toBe("idle");
    expect(session.store.streaming.currentMessageId).toBeNull();
  });

  it("compaction_end with errorMessage marks failed", () => {
    const { session, dispatch } = setupCompletedTurn();
    dispatch({ reason: "manual", type: "compaction_start" });
    dispatch({
      aborted: false,
      errorMessage: "API timeout",
      reason: "manual",
      type: "compaction_end",
      willRetry: false,
    });

    const compactionPart = session.store.turns[0]!.messages[0]!.parts.find(
      (p) => p.type === "compaction",
    );
    expect(compactionPart).toMatchObject({
      type: "compaction",
      status: "failed",
      error: "API timeout",
    });
  });

  it("compaction_end without result or error marks failed with 'Nothing to compact'", () => {
    const { session, dispatch } = setupCompletedTurn();
    dispatch({ reason: "manual", type: "compaction_start" });
    dispatch({
      aborted: false,
      reason: "manual",
      type: "compaction_end",
      willRetry: false,
    });

    const compactionPart = session.store.turns[0]!.messages[0]!.parts.find(
      (p) => p.type === "compaction",
    );
    expect(compactionPart).toMatchObject({
      type: "compaction",
      status: "failed",
      error: "Nothing to compact",
    });
  });

  it("second compaction_start on same message does not add duplicate marker", () => {
    const { session, dispatch } = setupCompletedTurn();
    dispatch({ reason: "manual", type: "compaction_start" });
    dispatch({
      aborted: false,
      reason: "manual",
      type: "compaction_end",
      willRetry: false,
    });
    dispatch({ reason: "threshold", type: "compaction_start" });

    const compactionParts = session.store.turns[0]!.messages[0]!.parts.filter(
      (p) => p.type === "compaction",
    );
    expect(compactionParts).toHaveLength(1);
  });
});
