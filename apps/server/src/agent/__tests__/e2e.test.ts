import { describe, expect, it, vi } from "vitest";

// Mock the runner module to avoid pi-ai dependency in vitest
vi.mock("../runner.ts", () => ({
  runPrompt: vi.fn(),
  abortRun: vi.fn(),
  registerRun: vi.fn(),
  unregisterRun: vi.fn(),
  isRunActive: vi.fn(() => false),
  busyMessage: vi.fn(
    (id: string) =>
      `A run is already active for session ${id}. Send a 'steer' or 'followUp' message to queue input, or 'abort' to cancel the active run first.`
  ),
  clearRunsForTesting: vi.fn(),
}));

const { runPrompt: mockRunPrompt } = await import("../runner.ts");
const { handleMessage } = await import("../ws-handler.ts");

import type { SessionStore } from "@sakti-code/agent";
import { createMockStore, createMultiSessionCtx } from "./helpers.ts";

describe("Multi-session e2e", () => {
  it("two concurrent sessions don't cross-contaminate messages", async () => {
    const ctx = createMultiSessionCtx({
      "sess-a": "proj-1",
      "sess-b": "proj-2",
    });
    const storeA = createMockStore();
    const storeB = createMockStore();

    // Track which store is passed to runPrompt for each session
    const calls: Array<{
      sessionId: string;
      store: SessionStore;
      message: string;
    }> = [];
    vi.mocked(mockRunPrompt).mockImplementation(async function* (
      _ctx: any,
      sessionId: any,
      message: any,
      store: any
    ) {
      calls.push({ sessionId, store, message });
      yield { type: "agent_start", sessionId, timestamp: Date.now() };
      yield { type: "text_delta", delta: "response", timestamp: Date.now() };
      yield { type: "agent_end", sessionId, timestamp: Date.now() };
    } as any);

    const framesA: any[] = [];
    const framesB: any[] = [];
    const wsA = { send: (d: string) => framesA.push(JSON.parse(d)) };
    const wsB = { send: (d: string) => framesB.push(JSON.parse(d)) };

    // Send prompts concurrently
    handleMessage(ctx, storeA, wsA, {
      type: "prompt",
      sessionId: "sess-a",
      message: "Hello from A",
    });
    handleMessage(ctx, storeB, wsB, {
      type: "prompt",
      sessionId: "sess-b",
      message: "Hello from B",
    });

    // Wait for fire-and-forget to complete
    await new Promise((r) => setTimeout(r, 100));

    // Verify runPrompt was called for each session
    expect(calls.length).toBe(2);
    expect(calls[0]?.sessionId).toBe("sess-a");
    expect(calls[0]?.message).toBe("Hello from A");
    expect(calls[1]?.sessionId).toBe("sess-b");
    expect(calls[1]?.message).toBe("Hello from B");

    // Verify stores are not mixed — each session uses its own store
    expect(calls[0]?.store).toBe(storeA);
    expect(calls[1]?.store).toBe(storeB);

    // Verify WS frames carry correct sessionId each
    const framesBySessionA = framesA.filter(
      (f: any) => f.sessionId === "sess-a"
    );
    const framesBySessionB = framesB.filter(
      (f: any) => f.sessionId === "sess-b"
    );

    expect(framesBySessionA.length).toBeGreaterThan(0);
    expect(framesBySessionB.length).toBeGreaterThan(0);

    // No cross-contamination: A's frames should never have B's sessionId
    expect(framesA.every((f: any) => f.sessionId === "sess-a")).toBe(true);
    expect(framesB.every((f: any) => f.sessionId === "sess-b")).toBe(true);
  });
});
