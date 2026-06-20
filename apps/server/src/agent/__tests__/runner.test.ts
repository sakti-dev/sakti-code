import { describe, expect, it, vi } from "vitest";

const SESSION_NOT_FOUND_RE = /Session not found/;

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

import type { AgentEvent } from "@sakti-code/agent";
import { abortRun, loadSessionSettings, runPrompt } from "../runner.ts";
import {
  createMockCtx,
  createMockStore,
  createTestModel,
  createTextStream,
} from "./helpers.ts";

// Re-wire the imported fns to our mock refs
const streamSimpleMock = streamSimple as ReturnType<typeof vi.fn>;
const getModelMock = getModel as ReturnType<typeof vi.fn>;

describe("runPrompt", () => {
  it("valid session run yields agent_start + agent_end and persists messages", async () => {
    const ctx = createMockCtx();
    const store = createMockStore();
    getModelMock.mockReturnValue(createTestModel());
    streamSimpleMock.mockReturnValue(createTextStream("Hello!"));

    const events: AgentEvent[] = [];
    for await (const event of runPrompt(ctx, "sess-1", "Say hello", store)) {
      events.push(event);
    }

    expect(events.some((e) => e.type === "agent_start")).toBe(true);
    expect(events.some((e) => e.type === "agent_end")).toBe(true);

    // Messages persisted via store
    const messages = await store.loadMessages("sess-1");
    expect(messages.length).toBeGreaterThanOrEqual(2); // user + assistant
    expect(messages.some((m) => m.role === "user")).toBe(true);
    expect(messages.some((m) => m.role === "assistant")).toBe(true);
  });

  it("unknown session throws Session not found", async () => {
    const ctx = createMockCtx();
    const store = createMockStore();
    getModelMock.mockReturnValue(createTestModel());

    await expect(
      (async () => {
        for await (const _event of runPrompt(
          ctx,
          "nonexistent-session-id",
          "test",
          store
        )) {
          // consume
        }
      })()
    ).rejects.toThrow(SESSION_NOT_FOUND_RE);
  });

  it("abortRun returns true for active run, false for missing", async () => {
    const ctx = createMockCtx();
    const store = createMockStore();
    getModelMock.mockReturnValue(createTestModel());

    // Stream that yields a start event then blocks until resolved
    // (simulates a long-running LLM call that checks signal)
    let hangResolve: (() => void) | null = null;
    const hangStream: AsyncIterable<any> = {
      [Symbol.asyncIterator]() {
        let started = false;
        return {
          async next() {
            if (!started) {
              started = true;
              return {
                done: false,
                value: {
                  type: "start",
                  partial: {
                    role: "assistant",
                    content: [],
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
                    api: "openai-completions",
                    provider: "openai",
                    model: "test",
                    timestamp: Date.now(),
                  },
                },
              };
            }
            // Block until abort resolves us
            await new Promise<void>((r) => {
              hangResolve = r;
            });
            return { done: true, value: undefined };
          },
        };
      },
    };
    streamSimpleMock.mockReturnValue(hangStream);

    const eventsPromise = (async () => {
      const events: AgentEvent[] = [];
      for await (const event of runPrompt(ctx, "sess-1", "test", store)) {
        events.push(event);
      }
      return events;
    })();

    // Give the generator time to start and register the run
    await new Promise((r) => setTimeout(r, 50));

    // Active run → returns true
    expect(abortRun("sess-1")).toBe(true);

    // Unblock the stream so the loop can finish and unregister
    (hangResolve as (() => void) | null)?.();

    const events = await eventsPromise;
    // Should have ended (not hung)
    expect(
      events.some((e) => e.type === "agent_end" || e.type === "error")
    ).toBe(true);

    // No more active run → returns false
    expect(abortRun("sess-1")).toBe(false);
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
    // override applied
    expect(settings.thinking_level).toBe("high");
    // defaults present for unset keys
    expect(settings.auto_retry).toBe("true");
    expect(settings.steering_mode).toBe("all");
  });

  it("W4: per-session thinking_level 'off' disables a session row's 'high'", async () => {
    const ctx = createMockCtx();
    // Session row wants thinking 'high'...
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
    // ...but the per-session setting explicitly overrides it to 'off'.
    (ctx.repos.settings.get as ReturnType<typeof vi.fn>).mockImplementation(
      (key: string) => (key.endsWith(":thinking_level") ? "off" : null)
    );

    const store = createMockStore();
    getModelMock.mockReturnValue(createTestModel());
    streamSimpleMock.mockReturnValue(createTextStream("ok"));

    for await (const _event of runPrompt(ctx, "sess-1", "hi", store)) {
      // consume
    }

    const opts = (streamSimpleMock.mock.calls[0] as unknown[])[2] as
      | Record<string, unknown>
      | undefined;
    const hasThinkingLevel = opts && "thinkingLevel" in opts;
    expect(hasThinkingLevel).toBe(false);
  });

  it("W3: loadSessionSettings defaults auto_compaction to false (matches the settings-route default, not 'true')", () => {
    const ctx = createMockCtx();
    const settings = loadSessionSettings(ctx, "sess-1");
    expect(settings.auto_compaction).toBe("false");
  });
});
