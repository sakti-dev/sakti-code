import { beforeEach, describe, expect, it, mock, spyOn, vi } from "bun:test";

const MISSING_FIELDS_RE = /Missing sessionId or message/;
const NO_ACTIVE_RUN_RE = /No active run/;
const BUSY_RE = /A run is already active.*steer.*followUp.*abort/;

mock.module("@earendil-works/pi-ai/base", () => ({
  getModel: vi.fn(() => ({
    id: "test-model",
    name: "Test",
    api: "openai-completions",
    provider: "openai",
    baseUrl: "https://api.openai.com",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200_000,
    maxTokens: 4096,
  })),
}));

const streamSimpleMock = vi.fn();
const getModelMock = vi.fn(() => ({
  id: "test-model",
  name: "Test",
  api: "openai-completions",
  provider: "openai",
  baseUrl: "https://api.openai.com",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 200_000,
  maxTokens: 4096,
}));

mock.module("@earendil-works/pi-ai", () => ({
  streamSimple: streamSimpleMock,
  getModel: getModelMock,
  getEnvApiKey: vi.fn(() => "test-key"),
}));

import { handleMessage } from "../ws-handler.ts";
import {
  createMockCtx,
  createMockStore,
  createTestModel,
  createTextStream,
} from "./helpers.ts";

import "@earendil-works/pi-ai";
import "@earendil-works/pi-ai/base";

function makeFakeWs(): { sent: any[]; ws: { send: (d: string) => void } } {
  const sent: any[] = [];
  return {
    sent,
    ws: { send: (d: string) => sent.push(JSON.parse(d)) },
  };
}

function callFn(fn: (() => void) | null): void {
  if (fn) fn();
}

describe("WS message handler", () => {
  beforeEach(async () => {
    const { clearRunsForTesting } = await import("../runner.ts");
    clearRunsForTesting();
    streamSimpleMock.mockClear();
    getModelMock.mockClear();
    getModelMock.mockReturnValue(createTestModel());
  });

  it("prompt produces event frames with correct sessionId and event type", async () => {
    const ctx = createMockCtx();
    const storage = createMockStore();
    streamSimpleMock.mockReturnValue(createTextStream("Hello!"));

    const { sent, ws } = makeFakeWs();
    handleMessage(ctx, storage, ws, {
      type: "prompt",
      sessionId: "sess-1",
      message: "Say hello",
    });

    await new Promise((r) => setTimeout(r, 200));

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
    const storage = createMockStore();
    streamSimpleMock.mockReturnValue(createTextStream("ok"));

    const { sent, ws } = makeFakeWs();
    handleMessage(ctx, storage, ws, {
      type: "prompt",
      sessionId: "nonexistent",
      message: "test",
    });

    await new Promise((r) => setTimeout(r, 200));

    const errorFrames = sent.filter((f: any) => f.type === "error");
    expect(errorFrames.length).toBeGreaterThan(0);
    expect(errorFrames[0]?.sessionId).toBe("nonexistent");
  });

  it("abort message returns synchronously without error", () => {
    const ctx = createMockCtx();
    const storage = createMockStore();

    handleMessage(
      ctx,
      storage,
      { send: () => {} },
      { type: "abort", sessionId: "sess-1" }
    );
  });

  it("prompt with missing sessionId sends error frame", () => {
    const ctx = createMockCtx();
    const storage = createMockStore();

    const { sent, ws } = makeFakeWs();
    handleMessage(ctx, storage, ws, {
      type: "prompt",
      sessionId: "",
      message: "test",
    });

    const errorFrames = sent.filter((f: any) => f.type === "error");
    expect(errorFrames.length).toBe(1);
    expect(errorFrames[0]?.error).toMatch(MISSING_FIELDS_RE);
  });

  it("steer with no active run sends an error frame carrying the sessionId", () => {
    const ctx = createMockCtx();
    const storage = createMockStore();
    const { sent, ws } = makeFakeWs();
    handleMessage(ctx, storage, ws, {
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
    const storage = createMockStore();
    const { sent, ws } = makeFakeWs();
    handleMessage(ctx, storage, ws, {
      type: "followUp",
      sessionId: "no-run",
      message: "again",
    });
    const errorFrames = sent.filter((f: any) => f.type === "error");
    expect(errorFrames.length).toBe(1);
    expect(errorFrames[0]?.sessionId).toBe("no-run");
    expect(errorFrames[0]?.error).toMatch(NO_ACTIVE_RUN_RE);
  });

  it("second prompt on active session is rejected with guidance", async () => {
    const ctx = createMockCtx();
    const storage = createMockStore();

    const testActiveRuns = new Set<string>();
    let promptResolve: (() => void) | null = null;
    const mockHarness = {
      abort: vi.fn(async () => {
        testActiveRuns.delete("sess-1");
        promptResolve?.();
      }),
    };

    const runnerMod = await import("../runner.ts");
    const runPromptSpy = spyOn(runnerMod, "runPrompt");
    const isRunActiveSpy = spyOn(runnerMod, "isRunActive");
    const abortRunSpy = spyOn(runnerMod, "abortRun");
    const getActiveHarnessSpy = spyOn(runnerMod, "getActiveHarness");

    isRunActiveSpy.mockImplementation((sessionId: string) =>
      testActiveRuns.has(sessionId)
    );
    abortRunSpy.mockImplementation(async (sessionId: string) => {
      if (testActiveRuns.has(sessionId)) {
        testActiveRuns.delete(sessionId);
        promptResolve?.();
        return true;
      }
      return false;
    });
    getActiveHarnessSpy.mockImplementation(() => mockHarness as any);
    runPromptSpy.mockImplementation(
      async (
        _ctx: any,
        sessionId: string,
        _message: string,
        _storage: any,
        eventCallback: (event: any) => void
      ) => {
        testActiveRuns.add(sessionId);
        eventCallback({
          type: "agent_start",
          sessionId,
          timestamp: Date.now(),
        });
        return new Promise<void>((resolve) => {
          promptResolve = () => resolve();
        });
      }
    );

    const { ws: ws1 } = makeFakeWs();
    handleMessage(ctx, storage, ws1, {
      type: "prompt",
      sessionId: "sess-1",
      message: "first prompt",
    });

    await new Promise((r) => setTimeout(r, 50));

    const { sent: sent2, ws: ws2 } = makeFakeWs();
    handleMessage(ctx, storage, ws2, {
      type: "prompt",
      sessionId: "sess-1",
      message: "second prompt",
    });

    await new Promise((r) => setTimeout(r, 50));

    const errorFrames2 = sent2.filter((f: any) => f.type === "error");
    expect(errorFrames2.length).toBe(1);
    expect(errorFrames2[0]?.error).toMatch(BUSY_RE);
    expect(errorFrames2[0]?.sessionId).toBe("sess-1");

    expect(await abortRunSpy("sess-1")).toBe(true);

    promptResolve = null;
    runPromptSpy.mockRestore();
    isRunActiveSpy.mockRestore();
    abortRunSpy.mockRestore();
    getActiveHarnessSpy.mockRestore();
  });

  it("race: two near-simultaneous prompts yield exactly one run", async () => {
    const ctx = createMockCtx();
    const storage = createMockStore();

    const testActiveRuns = new Set<string>();
    let promptResolve: (() => void) | null = null;
    const mockHarness = {
      abort: vi.fn(async () => {
        testActiveRuns.delete("sess-1");
        promptResolve?.();
      }),
    };

    const runnerMod = await import("../runner.ts");
    const runPromptSpy = spyOn(runnerMod, "runPrompt");
    const isRunActiveSpy = spyOn(runnerMod, "isRunActive");
    const abortRunSpy = spyOn(runnerMod, "abortRun");
    const getActiveHarnessSpy = spyOn(runnerMod, "getActiveHarness");

    isRunActiveSpy.mockImplementation((sessionId: string) =>
      testActiveRuns.has(sessionId)
    );
    abortRunSpy.mockImplementation(async (sessionId: string) => {
      if (testActiveRuns.has(sessionId)) {
        testActiveRuns.delete(sessionId);
        promptResolve?.();
        return true;
      }
      return false;
    });
    getActiveHarnessSpy.mockImplementation(() => mockHarness as any);
    runPromptSpy.mockImplementation(
      async (
        _ctx: any,
        sessionId: string,
        _message: string,
        _storage: any,
        eventCallback: (event: any) => void
      ) => {
        if (testActiveRuns.has(sessionId)) return;
        testActiveRuns.add(sessionId);
        eventCallback({
          type: "agent_start",
          sessionId,
          timestamp: Date.now(),
        });
        return new Promise<void>((resolve) => {
          promptResolve = () => resolve();
        });
      }
    );

    const { sent: sent1, ws: ws1 } = makeFakeWs();
    const { sent: sent2, ws: ws2 } = makeFakeWs();

    handleMessage(ctx, storage, ws1, {
      type: "prompt",
      sessionId: "sess-1",
      message: "prompt-a",
    });
    handleMessage(ctx, storage, ws2, {
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

    callFn(promptResolve);
    runPromptSpy.mockRestore();
    isRunActiveSpy.mockRestore();
    abortRunSpy.mockRestore();
    getActiveHarnessSpy.mockRestore();
  });

  it("steer while active run queues without error", async () => {
    const ctx = createMockCtx();
    const storage = createMockStore();

    const testActiveRuns = new Set<string>();
    let promptResolve: (() => void) | null = null;
    const mockHarness = {
      steer: vi.fn(async () => {}),
      followUp: vi.fn(async () => {}),
      abort: vi.fn(async () => {
        testActiveRuns.delete("sess-1");
        promptResolve?.();
      }),
    };

    const runnerMod = await import("../runner.ts");
    const runPromptSpy = spyOn(runnerMod, "runPrompt");
    const isRunActiveSpy = spyOn(runnerMod, "isRunActive");
    const getActiveHarnessSpy = spyOn(runnerMod, "getActiveHarness");

    isRunActiveSpy.mockImplementation((sessionId: string) =>
      testActiveRuns.has(sessionId)
    );
    getActiveHarnessSpy.mockImplementation(() => mockHarness as any);
    runPromptSpy.mockImplementation(
      async (
        _ctx: any,
        _sessionId: string,
        _message: string,
        _storage: any,
        _eventCallback: (event: any) => void
      ) => {
        testActiveRuns.add("sess-1");
        return new Promise<void>((resolve) => {
          promptResolve = () => resolve();
        });
      }
    );

    const { ws: ws1 } = makeFakeWs();
    handleMessage(ctx, storage, ws1, {
      type: "prompt",
      sessionId: "sess-1",
      message: "first",
    });
    await new Promise((r) => setTimeout(r, 50));

    expect(isRunActiveSpy("sess-1")).toBe(true);

    const { sent: sentSteer, ws: wsSteer } = makeFakeWs();
    handleMessage(ctx, storage, wsSteer, {
      type: "steer",
      sessionId: "sess-1",
      message: "change direction",
    });
    const steerErrors = sentSteer.filter((f: any) => f.type === "error");
    expect(steerErrors.length).toBe(0);
    expect(mockHarness.steer).toHaveBeenCalled();

    const { sent: sentFollow, ws: wsFollow } = makeFakeWs();
    handleMessage(ctx, storage, wsFollow, {
      type: "followUp",
      sessionId: "sess-1",
      message: "follow up",
    });
    const followErrors = sentFollow.filter((f: any) => f.type === "error");
    expect(followErrors.length).toBe(0);
    expect(mockHarness.followUp).toHaveBeenCalled();

    callFn(promptResolve);
    runPromptSpy.mockRestore();
    isRunActiveSpy.mockRestore();
    getActiveHarnessSpy.mockRestore();
  });

  it("abort during active run then new prompt succeeds", async () => {
    const ctx = createMockCtx();
    const storage = createMockStore();

    const testActiveRuns = new Set<string>();
    let promptResolve: (() => void) | null = null;
    const mockHarness = {
      abort: vi.fn(async () => {
        testActiveRuns.delete("sess-1");
        promptResolve?.();
      }),
    };

    const runnerMod = await import("../runner.ts");
    const runPromptSpy = spyOn(runnerMod, "runPrompt");
    const isRunActiveSpy = spyOn(runnerMod, "isRunActive");
    const abortRunSpy = spyOn(runnerMod, "abortRun");
    const getActiveHarnessSpy = spyOn(runnerMod, "getActiveHarness");

    isRunActiveSpy.mockImplementation((sessionId: string) =>
      testActiveRuns.has(sessionId)
    );
    abortRunSpy.mockImplementation(async (sessionId: string) => {
      if (testActiveRuns.has(sessionId)) {
        testActiveRuns.delete(sessionId);
        promptResolve?.();
        return true;
      }
      return false;
    });
    getActiveHarnessSpy.mockImplementation(() => mockHarness as any);
    runPromptSpy.mockImplementation(
      async (
        _ctx: any,
        sessionId: string,
        _message: string,
        _storage: any,
        eventCallback: (event: any) => void
      ) => {
        testActiveRuns.add(sessionId);
        eventCallback({
          type: "agent_start",
          sessionId,
          timestamp: Date.now(),
        });
        return new Promise<void>((resolve) => {
          promptResolve = () => resolve();
        });
      }
    );

    const { ws: ws1 } = makeFakeWs();
    handleMessage(ctx, storage, ws1, {
      type: "prompt",
      sessionId: "sess-1",
      message: "first",
    });
    await new Promise((r) => setTimeout(r, 50));

    expect(await abortRunSpy("sess-1")).toBe(true);

    promptResolve = null;
    await new Promise((r) => setTimeout(r, 50));

    runPromptSpy.mockImplementation(
      async (
        _ctx: any,
        sessionId: string,
        _message: string,
        _storage: any,
        eventCallback: (event: any) => void
      ) => {
        eventCallback({
          type: "agent_start",
          sessionId,
          timestamp: Date.now(),
        });
        eventCallback({
          type: "text_delta",
          delta: "after abort",
          sessionId,
          timestamp: Date.now(),
        });
        eventCallback({
          type: "agent_end",
          sessionId,
          timestamp: Date.now(),
        });
      }
    );

    const { sent, ws: ws2 } = makeFakeWs();
    handleMessage(ctx, storage, ws2, {
      type: "prompt",
      sessionId: "sess-1",
      message: "second after abort",
    });
    await new Promise((r) => setTimeout(r, 100));

    const errorFrames = sent.filter((f: any) => f.type === "error");
    expect(errorFrames.length).toBe(0);
    const eventFrames = sent.filter((f: any) => f.type === "event");
    expect(eventFrames.length).toBeGreaterThan(0);

    runPromptSpy.mockRestore();
    isRunActiveSpy.mockRestore();
    abortRunSpy.mockRestore();
    getActiveHarnessSpy.mockRestore();
  });
});
