import { describe, expect, it, vi } from "vitest";

const MISSING_FIELDS_RE = /Missing sessionId or message/;
const NO_ACTIVE_RUN_RE = /No active run/;

// Mock @earendil-works/pi-ai before importing anything that uses it
vi.mock("@earendil-works/pi-ai", async () => {
  const actual = await vi.importActual("@earendil-works/pi-ai");
  return {
    ...actual,
    streamSimple: vi.fn(),
    getModel: vi.fn(),
  };
});

const { streamSimple, getModel } = await import("@earendil-works/pi-ai");

import { handleMessage } from "../ws-handler.ts";
import {
  createMockCtx,
  createMockStore,
  createTestModel,
  createTextStream,
} from "./helpers.ts";

const streamSimpleMock = streamSimple as ReturnType<typeof vi.fn>;
const getModelMock = getModel as ReturnType<typeof vi.fn>;

function makeFakeWs(): { sent: any[]; ws: { send: (d: string) => void } } {
  const sent: any[] = [];
  return {
    sent,
    ws: { send: (d: string) => sent.push(JSON.parse(d)) },
  };
}

describe("WS message handler", () => {
  it("prompt produces event frames with correct sessionId and event type", async () => {
    const ctx = createMockCtx();
    const store = createMockStore();
    getModelMock.mockReturnValue(createTestModel());
    streamSimpleMock.mockReturnValue(createTextStream("Hello!"));

    const { sent, ws } = makeFakeWs();
    handleMessage(ctx, store, ws, {
      type: "prompt",
      sessionId: "sess-1",
      message: "Say hello",
    });

    await new Promise((r) => setTimeout(r, 100));

    const eventFrames = sent.filter((f: any) => f.type === "event");
    expect(eventFrames.length).toBeGreaterThan(0);

    const startFrame = eventFrames.find(
      (f: any) => f.event?.type === "agent_start"
    );
    expect(startFrame).toBeDefined();
    expect(startFrame?.sessionId).toBe("sess-1");
  });

  it("prompt for unknown session produces error frame", async () => {
    const ctx = createMockCtx();
    const store = createMockStore();
    getModelMock.mockReturnValue(createTestModel());

    const { sent, ws } = makeFakeWs();
    handleMessage(ctx, store, ws, {
      type: "prompt",
      sessionId: "nonexistent",
      message: "test",
    });

    await new Promise((r) => setTimeout(r, 100));

    const errorFrames = sent.filter((f: any) => f.type === "error");
    expect(errorFrames.length).toBeGreaterThan(0);
    expect(errorFrames[0]?.sessionId).toBe("nonexistent");
  });

  it("abort message calls abortRun and returns synchronously", async () => {
    const ctx = createMockCtx();
    const store = createMockStore();

    const abortSpy = vi.spyOn(await import("../runner.ts"), "abortRun");
    handleMessage(
      ctx,
      store,
      { send: () => {} },
      {
        type: "abort",
        sessionId: "sess-1",
      }
    );

    expect(abortSpy).toHaveBeenCalledWith("sess-1");
    abortSpy.mockRestore();
  });

  it("prompt with missing sessionId sends error frame", () => {
    const ctx = createMockCtx();
    const store = createMockStore();

    const { sent, ws } = makeFakeWs();
    handleMessage(ctx, store, ws, {
      type: "prompt",
      sessionId: "",
      message: "test",
    });

    // Validation error is synchronous — no need to wait
    const errorFrames = sent.filter((f: any) => f.type === "error");
    expect(errorFrames.length).toBe(1);
    expect(errorFrames[0]?.error).toMatch(MISSING_FIELDS_RE);
  });

  it("steer with no active run sends an error frame carrying the sessionId", () => {
    const ctx = createMockCtx();
    const store = createMockStore();
    const { sent, ws } = makeFakeWs();
    handleMessage(ctx, store, ws, {
      type: "steer",
      sessionId: "no-run",
      message: "change course",
    });
    const errorFrames = sent.filter((f: any) => f.type === "error");
    expect(errorFrames.length).toBe(1);
    expect(errorFrames[0]?.sessionId).toBe("no-run");
    expect(errorFrames[0]?.error).toMatch(NO_ACTIVE_RUN_RE);
  });

  it("followUp with no active run sends an error frame carrying the sessionId", () => {
    const ctx = createMockCtx();
    const store = createMockStore();
    const { sent, ws } = makeFakeWs();
    handleMessage(ctx, store, ws, {
      type: "followUp",
      sessionId: "no-run",
      message: "again",
    });
    const errorFrames = sent.filter((f: any) => f.type === "error");
    expect(errorFrames.length).toBe(1);
    expect(errorFrames[0]?.sessionId).toBe("no-run");
    expect(errorFrames[0]?.error).toMatch(NO_ACTIVE_RUN_RE);
  });
});
