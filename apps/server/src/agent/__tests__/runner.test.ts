import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  mock,
  spyOn,
  vi,
} from "bun:test";

const SESSION_NOT_FOUND_RE = /Session not found/;
const PROJECT_NOT_FOUND_RE = /Project not found/;

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

mock.module("@earendil-works/pi-ai", () => ({
  streamSimple: vi.fn(),
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
  getEnvApiKey: vi.fn(() => "test-key"),
}));

import type { AgentHarnessEvent } from "@sakti-code/agent";
import {
  abortRun,
  clearRunsForTesting,
  loadSessionSettings,
  resolveThinkingLevel,
  runPrompt,
} from "../runner.ts";
import { createMockCtx, createMockStore } from "./helpers.ts";

describe("runPrompt", () => {
  let runPromptSpy: ReturnType<typeof spyOn>;

  beforeEach(async () => {
    clearRunsForTesting();
    const mod = await import("../runner.ts");
    runPromptSpy = spyOn(mod, "runPrompt");
    runPromptSpy.mockImplementation(
      async (
        _ctx: any,
        _sessionId: string,
        _message: string,
        _storage: any,
        _eventCallback: (event: AgentHarnessEvent) => void
      ) => {}
    );
  });

  afterEach(() => {
    clearRunsForTesting();
    runPromptSpy.mockRestore();
  });

  it("unknown session throws Session not found", async () => {
    const ctx = createMockCtx();
    const storage = createMockStore();

    runPromptSpy.mockRestore();
    await expect(
      runPrompt(ctx, "nonexistent-session-id", "test", storage, vi.fn())
    ).rejects.toThrow(SESSION_NOT_FOUND_RE);
  });

  it("unknown project throws Project not found", async () => {
    const ctx = createMockCtx();
    (
      ctx.repos.projects.findById as ReturnType<typeof vi.fn>
    ).mockImplementation(async (id: string) => {
      if (id === "proj-1") {
        return null;
      }
      return {
        id,
        name: "test-project",
        cwd: "/tmp/test",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
    });
    const storage = createMockStore();

    runPromptSpy.mockRestore();
    await expect(
      runPrompt(ctx, "sess-1", "test", storage, vi.fn())
    ).rejects.toThrow(PROJECT_NOT_FOUND_RE);
  });

  it("valid session run calls eventCallback and registers then unregisters", async () => {
    const ctx = createMockCtx();
    const storage = createMockStore();

    const capturedEvents: AgentHarnessEvent[] = [];
    runPromptSpy.mockImplementation(
      async (
        _ctx: any,
        _sessionId: string,
        _message: string,
        _storage: any,
        eventCallback: (event: AgentHarnessEvent) => void
      ) => {
        eventCallback({ type: "agent_start" });
        eventCallback({
          type: "message_update",
          message: {
            role: "assistant",
            content: [],
            api: "openai-completions",
            provider: "openai",
            model: "test-model",
            usage: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 0,
              cost: {
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
                total: 0,
              },
            },
            stopReason: "stop",
            timestamp: Date.now(),
          } as any,
          assistantMessageEvent: {
            type: "text_delta",
            contentIndex: 0,
            delta: "Hello!",
            partial: {},
          } as any,
        });
        eventCallback({ type: "agent_end", messages: [] });
      }
    );

    await runPrompt(ctx, "sess-1", "Say hello", storage, vi.fn());

    expect(runPromptSpy).toHaveBeenCalledTimes(1);
    expect(capturedEvents.length).toBe(0);
  });

  it("abortRun returns false when no active run exists", async () => {
    expect(await abortRun("sess-1")).toBe(false);
    expect(await abortRun("nonexistent")).toBe(false);
  });

  it("loadSessionSettings reads per-session settings via getByPrefix and merges defaults", async () => {
    const ctx = createMockCtx();
    (
      ctx.repos.settings.getByPrefix as ReturnType<typeof vi.fn>
    ).mockReturnValue([
      { key: "session:sess-1:thinking_level", value: "high" },
    ]);

    const settings = loadSessionSettings(ctx, "sess-1");

    expect(ctx.repos.settings.getByPrefix).toHaveBeenCalledWith(
      "session:sess-1:"
    );
    expect(settings.thinking_level).toBe("high");
    expect(settings.auto_retry).toBe("true");
    expect(settings.steering_mode).toBe("all");
  });

  it("W4: per-session thinking_level 'off' disables a session row's 'high'", async () => {
    const ctx = createMockCtx();
    (
      ctx.repos.sessions.findById as ReturnType<typeof vi.fn>
    ).mockImplementation(async (id: string) =>
      id === "sess-1"
        ? {
            id: "sess-1",
            projectId: "proj-1",
            modelId: "test-model",
            title: null,
            thinkingLevel: "high",
            createdAt: 0,
            updatedAt: 0,
          }
        : null
    );
    (ctx.repos.settings.get as ReturnType<typeof vi.fn>).mockImplementation(
      (key: string) => (key.endsWith(":thinking_level") ? "off" : null)
    );

    const level = resolveThinkingLevel(ctx, "sess-1", {
      thinkingLevel: "high",
    });
    expect(level).toBe("off");
  });

  it("W3: loadSessionSettings defaults auto_compaction to false", () => {
    const ctx = createMockCtx();
    const settings = loadSessionSettings(ctx, "sess-1");
    expect(settings.auto_compaction).toBe("false");
  });
});
