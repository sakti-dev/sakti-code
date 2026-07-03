import { describe, expect, it } from "vite-plus/test";
import { assistantMsg, setupHandlers, userMsg } from "./handler-helpers.ts";

describe("om handlers", () => {
  it("om_start adds om_marker to current message", () => {
    const { session, dispatch } = setupHandlers();
    dispatch({ message: userMsg("hi"), type: "message_start" });
    dispatch({ message: assistantMsg(), type: "message_start" });
    dispatch({
      cycleId: "c1",
      operationType: "observation",
      tokenCount: 500,
      type: "om_start",
    });

    const parts = session.store.turns[0]!.summary!.parts;
    expect(parts.some((p) => p.type === "om_marker" && p.cycleId === "c1")).toBe(true);
  });

  it("om_end updates the marker with results", () => {
    const { session, dispatch } = setupHandlers();
    dispatch({ message: userMsg("hi"), type: "message_start" });
    dispatch({ message: assistantMsg(), type: "message_start" });
    dispatch({
      cycleId: "c1",
      operationType: "observation",
      tokenCount: 500,
      type: "om_start",
    });
    dispatch({
      cycleId: "c1",
      currentTask: "reading files",
      durationMs: 1500,
      observations: "Found 3 files",
      operationType: "observation",
      tokensProcessed: 500,
      tokensProduced: 200,
      type: "om_end",
    });

    const marker = session.store.turns[0]!.summary!.parts.find(
      (p) => p.type === "om_marker" && p.cycleId === "c1",
    );
    expect(marker).toMatchObject({
      type: "om_marker",
      status: "complete",
      durationMs: 1500,
      tokensProcessed: 500,
      tokensProduced: 200,
      observations: "Found 3 files",
      currentTask: "reading files",
    });
  });

  it("om_failed marks the marker as failed with error", () => {
    const { session, dispatch } = setupHandlers();
    dispatch({ message: userMsg("hi"), type: "message_start" });
    dispatch({ message: assistantMsg(), type: "message_start" });
    dispatch({
      cycleId: "c1",
      operationType: "observation",
      tokenCount: 100,
      type: "om_start",
    });
    dispatch({
      cycleId: "c1",
      durationMs: 100,
      error: "OOM",
      operationType: "observation",
      type: "om_failed",
    });

    const marker = session.store.turns[0]!.summary!.parts.find(
      (p) => p.type === "om_marker" && p.cycleId === "c1",
    );
    expect(marker).toMatchObject({
      type: "om_marker",
      status: "failed",
      error: "OOM",
    });
  });

  it("om_activation updates marker status to activated", () => {
    const { session, dispatch } = setupHandlers();
    dispatch({ message: userMsg("hi"), type: "message_start" });
    dispatch({ message: assistantMsg(), type: "message_start" });
    dispatch({
      cycleId: "c1",
      operationType: "observation",
      tokenCount: 100,
      type: "om_start",
    });
    dispatch({
      chunksActivated: 5,
      cycleId: "c1",
      observationTokens: 1000,
      operationType: "observation",
      tokensActivated: 500,
      type: "om_activation",
    });

    const marker = session.store.turns[0]!.summary!.parts.find(
      (p) => p.type === "om_marker" && p.cycleId === "c1",
    );
    expect(marker).toMatchObject({ type: "om_marker", status: "activated" });
  });

  it("om_status updates the omStatus window state", () => {
    const { session, dispatch } = setupHandlers();
    const windows = {
      messages: { tokens: 5000, threshold: 10000 },
      observations: { tokens: 2000, threshold: 5000 },
    };
    dispatch({ recordId: "r1", type: "om_status", windows });

    expect(session.store.omStatus).toEqual(windows);
  });

  it("duplicate om_start for same cycleId does not add second marker", () => {
    const { session, dispatch } = setupHandlers();
    dispatch({ message: userMsg("hi"), type: "message_start" });
    dispatch({ message: assistantMsg(), type: "message_start" });
    dispatch({
      cycleId: "c1",
      operationType: "observation",
      tokenCount: 100,
      type: "om_start",
    });
    dispatch({
      cycleId: "c1",
      operationType: "observation",
      tokenCount: 200,
      type: "om_start",
    });

    const markers = session.store.turns[0]!.summary!.parts.filter(
      (p) => p.type === "om_marker" && p.cycleId === "c1",
    );
    expect(markers).toHaveLength(1);
  });
});
