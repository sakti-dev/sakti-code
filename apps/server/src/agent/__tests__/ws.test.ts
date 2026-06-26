import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const MISSING_FIELDS_RE = /Missing sessionId or message/;
const NO_ACTIVE_RUN_RE = /No active run/;
const BUSY_RE = /A run is already active.*steer.*followUp.*abort/;

import {
  fauxAssistantMessage,
  teardownFauxLlm,
  useFauxLlm,
} from "../../__tests__/llm-helpers.ts";
import { getPermissionChannel } from "../../lib/permission-channel.ts";
import { clearReplaysForTesting, clearRunsForTesting } from "../runner.ts";
import { handleMessage } from "../ws-handler.ts";
import { createMockCtx, createMockStore } from "./helpers.ts";

interface FakeWsHandle {
  send: (d: unknown) => void;
}

function makeFakeWs(): { sent: unknown[]; ws: FakeWsHandle } {
  const sent: unknown[] = [];
  return {
    sent,
    ws: { send: (d: unknown) => sent.push(d) },
  };
}

function asErrorFrames(
  frames: unknown[]
): Array<{ error?: string; sessionId?: string }> {
  return frames.filter(
    (f) => (f as { type?: string }).type === "error"
  ) as Array<{ error?: string; sessionId?: string }>;
}

function asEventFrames(
  frames: unknown[]
): Array<{ event?: { type?: string }; sessionId?: string }> {
  return frames.filter(
    (f) => (f as { type?: string }).type === "event"
  ) as Array<{ event?: { type?: string }; sessionId?: string }>;
}

interface MockHarness {
  abort: ReturnType<typeof vi.fn>;
  followUp: ReturnType<typeof vi.fn>;
  steer: ReturnType<typeof vi.fn>;
}

function makeMockHarness(
  testActiveRuns: Set<string>,
  getPromptResolve: () => (() => void) | null
): MockHarness {
  return {
    steer: vi.fn(async () => {}),
    followUp: vi.fn(async () => {}),
    abort: vi.fn(async () => {
      testActiveRuns.delete("sess-1");
      getPromptResolve()?.();
    }),
  };
}

function runResolver(fn: (() => void) | null): void {
  fn?.();
}

describe("WS message handler", () => {
  beforeEach(() => {
    clearRunsForTesting();
    clearReplaysForTesting();
  });

  afterEach(() => {
    teardownFauxLlm();
  });

  it("prompt produces event frames with correct sessionId and event type", async () => {
    useFauxLlm([fauxAssistantMessage("Hello!")]);
    const ctx = createMockCtx();
    const storage = createMockStore();

    const { sent, ws } = makeFakeWs();
    handleMessage(ctx, storage, ws, {
      type: "prompt",
      sessionId: "sess-1",
      message: "Say hello",
    });

    await new Promise((r) => setTimeout(r, 100));

    const eventFrames = asEventFrames(sent);
    expect(eventFrames.length).toBeGreaterThan(0);

    const startFrame = eventFrames.find((f) => f.event?.type === "agent_start");
    expect(startFrame).toBeDefined();
    expect(startFrame?.sessionId).toBe("sess-1");
  });

  it("prompt for unknown session produces error frame", async () => {
    const ctx = createMockCtx();
    const storage = createMockStore();

    const { sent, ws } = makeFakeWs();
    handleMessage(ctx, storage, ws, {
      type: "prompt",
      sessionId: "nonexistent",
      message: "test",
    });

    await new Promise((r) => setTimeout(r, 200));

    const errorFrames = asErrorFrames(sent);
    expect(errorFrames.length).toBeGreaterThan(0);
    expect(errorFrames[0]?.sessionId).toBe("nonexistent");
  });

  it("permission.reply resolves the pending ask and emits a replied frame", async () => {
    const ctx = createMockCtx();
    const storage = createMockStore();
    const channel = getPermissionChannel("sess-perm");
    channel.setSink(() => {});
    const pending = channel.ask({
      sessionId: "sess-perm",
      permission: "read",
      patterns: ["a.env"],
      always: ["a.env"],
      toolName: "read",
      toolCallId: "c1",
    });
    const id = channel.listPending()[0]!.id;

    const { sent, ws } = makeFakeWs();
    handleMessage(ctx, storage, ws, {
      type: "permission.reply",
      sessionId: "sess-perm",
      id,
      reply: "once",
    });

    expect(await pending).toBe("allow");
    const replied = sent.find(
      (f) =>
        (f as { type?: string }).type === "permission.replied" &&
        (f as { id?: string }).id === id
    );
    expect(replied).toBeDefined();
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

    const errorFrames = asErrorFrames(sent);
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
    const errorFrames = asErrorFrames(sent);
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
    const errorFrames = asErrorFrames(sent);
    expect(errorFrames.length).toBe(1);
    expect(errorFrames[0]?.sessionId).toBe("no-run");
    expect(errorFrames[0]?.error).toMatch(NO_ACTIVE_RUN_RE);
  });

  it("second prompt on active session is rejected with guidance", async () => {
    const ctx = createMockCtx();
    const storage = createMockStore();

    const testActiveRuns = new Set<string>();
    let promptResolve: (() => void) | null = null;
    const mockHarness = makeMockHarness(testActiveRuns, () => promptResolve);

    const runnerMod = await import("../runner.ts");
    const runPromptSpy = vi.spyOn(runnerMod, "runPrompt");
    const isRunActiveSpy = vi.spyOn(runnerMod, "isRunActive");
    const abortRunSpy = vi.spyOn(runnerMod, "abortRun");
    const getActiveHarnessSpy = vi.spyOn(runnerMod, "getActiveHarness");

    try {
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
      getActiveHarnessSpy.mockImplementation(() => mockHarness as never);
      runPromptSpy.mockImplementation(
        async (_ctx, sessionId, _message, _storage, eventCallback) => {
          testActiveRuns.add(sessionId);
          eventCallback({ type: "agent_start" });
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

      const errorFrames2 = asErrorFrames(sent2);
      expect(errorFrames2.length).toBe(1);
      expect(errorFrames2[0]?.error).toMatch(BUSY_RE);
      expect(errorFrames2[0]?.sessionId).toBe("sess-1");

      expect(await abortRunSpy("sess-1")).toBe(true);
    } finally {
      promptResolve = null;
      runPromptSpy.mockRestore();
      isRunActiveSpy.mockRestore();
      abortRunSpy.mockRestore();
      getActiveHarnessSpy.mockRestore();
    }
  });

  it("race: two near-simultaneous prompts yield exactly one run", async () => {
    const ctx = createMockCtx();
    const storage = createMockStore();

    const testActiveRuns = new Set<string>();
    let promptResolve: (() => void) | null = null;
    const mockHarness = makeMockHarness(testActiveRuns, () => promptResolve);

    const runnerMod = await import("../runner.ts");
    const runPromptSpy = vi.spyOn(runnerMod, "runPrompt");
    const isRunActiveSpy = vi.spyOn(runnerMod, "isRunActive");
    const abortRunSpy = vi.spyOn(runnerMod, "abortRun");
    const getActiveHarnessSpy = vi.spyOn(runnerMod, "getActiveHarness");

    try {
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
      getActiveHarnessSpy.mockImplementation(() => mockHarness as never);
      runPromptSpy.mockImplementation(
        async (_ctx, sessionId, _message, _storage, eventCallback) => {
          if (testActiveRuns.has(sessionId)) return;
          testActiveRuns.add(sessionId);
          eventCallback({ type: "agent_start" });
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

      const errors1 = asErrorFrames(sent1);
      const errors2 = asErrorFrames(sent2);
      const totalErrors = errors1.length + errors2.length;
      expect(totalErrors).toBe(1);

      const allErrors = [...errors1, ...errors2];
      expect(allErrors[0]?.error).toMatch(BUSY_RE);

      const totalEvents =
        asEventFrames(sent1).length + asEventFrames(sent2).length;
      expect(totalEvents).toBeGreaterThan(0);

      const resolve: (() => void) | null = promptResolve;
      runResolver(resolve);
    } finally {
      runPromptSpy.mockRestore();
      isRunActiveSpy.mockRestore();
      abortRunSpy.mockRestore();
      getActiveHarnessSpy.mockRestore();
    }
  });

  it("steer while active run queues without error", async () => {
    const ctx = createMockCtx();
    const storage = createMockStore();

    const testActiveRuns = new Set<string>();
    let promptResolve: (() => void) | null = null;
    const mockHarness = makeMockHarness(testActiveRuns, () => promptResolve);

    const runnerMod = await import("../runner.ts");
    const runPromptSpy = vi.spyOn(runnerMod, "runPrompt");
    const isRunActiveSpy = vi.spyOn(runnerMod, "isRunActive");
    const getActiveHarnessSpy = vi.spyOn(runnerMod, "getActiveHarness");

    try {
      isRunActiveSpy.mockImplementation((sessionId: string) =>
        testActiveRuns.has(sessionId)
      );
      getActiveHarnessSpy.mockImplementation(() => mockHarness as never);
      runPromptSpy.mockImplementation(async () => {
        testActiveRuns.add("sess-1");
        return new Promise<void>((resolve) => {
          promptResolve = () => resolve();
        });
      });

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
      const steerErrors = asErrorFrames(sentSteer);
      expect(steerErrors.length).toBe(0);
      expect(mockHarness.steer).toHaveBeenCalled();

      const { sent: sentFollow, ws: wsFollow } = makeFakeWs();
      handleMessage(ctx, storage, wsFollow, {
        type: "followUp",
        sessionId: "sess-1",
        message: "follow up",
      });
      const followErrors = asErrorFrames(sentFollow);
      expect(followErrors.length).toBe(0);
      expect(mockHarness.followUp).toHaveBeenCalled();

      const resolve: (() => void) | null = promptResolve;
      runResolver(resolve);
    } finally {
      runPromptSpy.mockRestore();
      isRunActiveSpy.mockRestore();
      getActiveHarnessSpy.mockRestore();
    }
  });

  it("abort during active run then new prompt succeeds", async () => {
    const ctx = createMockCtx();
    const storage = createMockStore();

    const testActiveRuns = new Set<string>();
    let promptResolve: (() => void) | null = null;
    const mockHarness = makeMockHarness(testActiveRuns, () => promptResolve);

    const runnerMod = await import("../runner.ts");
    const runPromptSpy = vi.spyOn(runnerMod, "runPrompt");
    const isRunActiveSpy = vi.spyOn(runnerMod, "isRunActive");
    const abortRunSpy = vi.spyOn(runnerMod, "abortRun");
    const getActiveHarnessSpy = vi.spyOn(runnerMod, "getActiveHarness");

    try {
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
      getActiveHarnessSpy.mockImplementation(() => mockHarness as never);
      runPromptSpy.mockImplementation(
        async (_ctx, sessionId, _message, _storage, eventCallback) => {
          testActiveRuns.add(sessionId);
          eventCallback({ type: "agent_start" });
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
        async (_ctx, _sessionId, _message, _storage, eventCallback) => {
          eventCallback({ type: "agent_start" });
          eventCallback({ type: "agent_end", messages: [] });
        }
      );

      const { sent, ws: ws2 } = makeFakeWs();
      handleMessage(ctx, storage, ws2, {
        type: "prompt",
        sessionId: "sess-1",
        message: "second after abort",
      });
      await new Promise((r) => setTimeout(r, 100));

      const errorFrames = asErrorFrames(sent);
      expect(errorFrames.length).toBe(0);
      const eventFrames = asEventFrames(sent);
      expect(eventFrames.length).toBeGreaterThan(0);
    } finally {
      runPromptSpy.mockRestore();
      isRunActiveSpy.mockRestore();
      abortRunSpy.mockRestore();
      getActiveHarnessSpy.mockRestore();
    }
  });
});

describe("WS replay handler", () => {
  beforeEach(() => {
    clearRunsForTesting();
    clearReplaysForTesting();
  });

  afterEach(() => {
    clearReplaysForTesting();
  });

  it("replay start emits event frames", async () => {
    const ctx = createMockCtx();
    const storage = createMockStore();
    const { sent, ws } = makeFakeWs();

    handleMessage(ctx, storage, ws, {
      type: "replay",
      sessionId: "sess-replay-1",
      action: "start",
    });

    await new Promise((r) => setTimeout(r, 500));

    const eventFrames = asEventFrames(sent);
    expect(eventFrames.length).toBeGreaterThan(0);

    const startFrame = eventFrames.find((f) => f.event?.type === "agent_start");
    expect(startFrame).toBeDefined();
  });

  it("replay pause/resume controls emission", async () => {
    const ctx = createMockCtx();
    const storage = createMockStore();
    const { sent, ws } = makeFakeWs();

    handleMessage(ctx, storage, ws, {
      type: "replay",
      sessionId: "sess-pause",
      action: "start",
    });

    await new Promise((r) => setTimeout(r, 100));

    handleMessage(ctx, storage, ws, {
      type: "replay",
      sessionId: "sess-pause",
      action: "pause",
    });

    await new Promise((r) => setTimeout(r, 200));
    const countAfterPause = asEventFrames(sent).length;

    handleMessage(ctx, storage, ws, {
      type: "replay",
      sessionId: "sess-pause",
      action: "resume",
    });

    await new Promise((r) => setTimeout(r, 500));
    const countAfterResume = asEventFrames(sent).length;

    expect(countAfterResume).toBeGreaterThan(countAfterPause);
  });

  it("abort stops replay and emits agent_end", async () => {
    const ctx = createMockCtx();
    const storage = createMockStore();
    const { sent, ws } = makeFakeWs();

    handleMessage(ctx, storage, ws, {
      type: "replay",
      sessionId: "sess-abort-replay",
      action: "start",
    });

    await new Promise((r) => setTimeout(r, 100));

    handleMessage(ctx, storage, ws, {
      type: "abort",
      sessionId: "sess-abort-replay",
    });

    await new Promise((r) => setTimeout(r, 300));

    const eventFrameTypes = asEventFrames(sent).map((f) => f.event?.type);
    expect(eventFrameTypes.at(-1)).toBe("agent_end");
  });
});
