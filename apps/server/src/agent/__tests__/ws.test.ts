import { beforeEach, describe, expect, it, vi } from "vitest";

const MISSING_FIELDS_RE = /Missing sessionId or message/;
const NO_ACTIVE_RUN_RE = /No active run/;
const BUSY_RE = /A run is already active.*steer.*followUp.*abort/;

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
  MockStream,
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
  beforeEach(async () => {
    const { clearRunsForTesting } = await import("../runner.ts");
    clearRunsForTesting();
    streamSimpleMock.mockClear();
    getModelMock.mockClear();
  });

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

  it("second prompt on active session is rejected with guidance and preserves first run", async () => {
    const ctx = createMockCtx();
    const store = createMockStore();
    getModelMock.mockReturnValue(createTestModel());
    const hanging = new MockStream<any>();
    hanging.hang();
    streamSimpleMock.mockReturnValue(hanging);

    const { ws: ws1 } = makeFakeWs();
    handleMessage(ctx, store, ws1, {
      type: "prompt",
      sessionId: "sess-1",
      message: "first prompt",
    });

    await new Promise((r) => setTimeout(r, 50));

    const { sent: sent2, ws: ws2 } = makeFakeWs();
    handleMessage(ctx, store, ws2, {
      type: "prompt",
      sessionId: "sess-1",
      message: "second prompt",
    });

    await new Promise((r) => setTimeout(r, 50));

    const errorFrames2 = sent2.filter((f: any) => f.type === "error");
    expect(errorFrames2.length).toBe(1);
    expect(errorFrames2[0]?.error).toMatch(BUSY_RE);
    expect(errorFrames2[0]?.sessionId).toBe("sess-1");

    const { abortRun } = await import("../runner.ts");
    expect(abortRun("sess-1")).toBe(true);

    hanging.push({
      type: "done",
      reason: "stop",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "done" }],
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop",
        api: "openai-completions",
        provider: "openai",
        model: "test",
        timestamp: Date.now(),
      },
    });
  });

  it("race: two near-simultaneous prompts yield exactly one run", async () => {
    const ctx = createMockCtx();
    const store = createMockStore();
    getModelMock.mockReturnValue(createTestModel());
    const hanging = new MockStream<any>();
    hanging.hang();
    streamSimpleMock.mockReturnValue(hanging);

    const { sent: sent1, ws: ws1 } = makeFakeWs();
    const { sent: sent2, ws: ws2 } = makeFakeWs();

    handleMessage(ctx, store, ws1, {
      type: "prompt",
      sessionId: "sess-1",
      message: "prompt-a",
    });
    handleMessage(ctx, store, ws2, {
      type: "prompt",
      sessionId: "sess-1",
      message: "prompt-b",
    });

    await new Promise((r) => setTimeout(r, 100));

    const errors1 = sent1.filter((f: any) => f.type === "error");
    const errors2 = sent2.filter((f: any) => f.type === "error");
    const totalErrors = errors1.length + errors2.length;
    expect(totalErrors).toBe(1);

    const allErrors = [...errors1, ...errors2];
    expect(allErrors[0]?.error).toMatch(BUSY_RE);

    const totalEvents =
      sent1.filter((f: any) => f.type === "event").length +
      sent2.filter((f: any) => f.type === "event").length;
    expect(totalEvents).toBeGreaterThan(0);

    hanging.push({
      type: "done",
      reason: "stop",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "done" }],
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop",
        api: "openai-completions",
        provider: "openai",
        model: "test",
        timestamp: Date.now(),
      },
    });
  });

  it("steer while active run queues without error", async () => {
    const ctx = createMockCtx();
    const store = createMockStore();
    getModelMock.mockReturnValue(createTestModel());
    const hanging = new MockStream<any>();
    hanging.hang();
    streamSimpleMock.mockReturnValue(hanging);

    const { ws: ws1 } = makeFakeWs();
    handleMessage(ctx, store, ws1, {
      type: "prompt",
      sessionId: "sess-1",
      message: "first",
    });
    await new Promise((r) => setTimeout(r, 50));

    const { isRunActive } = await import("../runner.ts");
    expect(isRunActive("sess-1")).toBe(true);

    const { sent: sentSteer, ws: wsSteer } = makeFakeWs();
    handleMessage(ctx, store, wsSteer, {
      type: "steer",
      sessionId: "sess-1",
      message: "change direction",
    });
    const steerErrors = sentSteer.filter((f: any) => f.type === "error");
    expect(steerErrors.length).toBe(0);

    const { sent: sentFollow, ws: wsFollow } = makeFakeWs();
    handleMessage(ctx, store, wsFollow, {
      type: "followUp",
      sessionId: "sess-1",
      message: "follow up",
    });
    const followErrors = sentFollow.filter((f: any) => f.type === "error");
    expect(followErrors.length).toBe(0);

    hanging.push({
      type: "done",
      reason: "stop",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "done" }],
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop",
        api: "openai-completions",
        provider: "openai",
        model: "test",
        timestamp: Date.now(),
      },
    });
  });

  it("abort during active run then new prompt succeeds", async () => {
    const ctx = createMockCtx();
    const store = createMockStore();
    getModelMock.mockReturnValue(createTestModel());
    const hanging = new MockStream<any>();
    hanging.hang();
    streamSimpleMock.mockReturnValue(hanging);

    const { ws: ws1 } = makeFakeWs();
    handleMessage(ctx, store, ws1, {
      type: "prompt",
      sessionId: "sess-1",
      message: "first",
    });
    await new Promise((r) => setTimeout(r, 50));

    const { abortRun } = await import("../runner.ts");
    expect(abortRun("sess-1")).toBe(true);

    hanging.push({
      type: "done",
      reason: "stop",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "done" }],
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop",
        api: "openai-completions",
        provider: "openai",
        model: "test",
        timestamp: Date.now(),
      },
    });
    hanging.unhang();

    await new Promise((r) => setTimeout(r, 50));

    streamSimpleMock.mockReturnValue(createTextStream("after abort"));
    const { sent, ws: ws2 } = makeFakeWs();
    handleMessage(ctx, store, ws2, {
      type: "prompt",
      sessionId: "sess-1",
      message: "second after abort",
    });
    await new Promise((r) => setTimeout(r, 100));

    const errorFrames = sent.filter((f: any) => f.type === "error");
    expect(errorFrames.length).toBe(0);
    const eventFrames = sent.filter((f: any) => f.type === "event");
    expect(eventFrames.length).toBeGreaterThan(0);
  });
});
