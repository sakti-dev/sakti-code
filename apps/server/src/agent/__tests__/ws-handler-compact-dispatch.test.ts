import { beforeEach, describe, expect, it } from "vite-plus/test";

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

function asErrorFrames(frames: unknown[]): Array<{ error?: string; sessionId?: string }> {
  return frames.filter((f) => (f as { type?: string }).type === "error") as Array<{
    error?: string;
    sessionId?: string;
  }>;
}

describe("WS command dispatch", () => {
  beforeEach(() => {
    clearRunsForTesting();
    clearReplaysForTesting();
  });

  it("dispatches command message (not treated as prompt — no 'missing message' error)", () => {
    const ctx = createMockCtx();
    const storage = createMockStore();
    const { sent, ws } = makeFakeWs();

    // A command message has no `message` field. If it fell through to the
    // prompt path, it would emit a "Missing sessionId or message" error.
    handleMessage(ctx, storage, ws, {
      type: "command",
      sessionId: "sess-1",
      name: "compact",
    });

    const errors = asErrorFrames(sent);
    const missingMsgErrors = errors.filter((e) => e.error?.includes("Missing"));
    expect(missingMsgErrors).toHaveLength(0);
  });

  it("returns error for unknown session", async () => {
    const ctx = createMockCtx();
    const storage = createMockStore();
    const { sent, ws } = makeFakeWs();

    handleMessage(ctx, storage, ws, {
      type: "command",
      sessionId: "nonexistent",
      name: "compact",
    });

    // handleCompactCommand is async — wait for it to settle.
    await new Promise((resolve) => setTimeout(resolve, 50));

    const errors = asErrorFrames(sent);
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors.some((e) => e.error?.toLowerCase().includes("not found"))).toBe(true);
  });

  it("blocks /compact when run is active", async () => {
    const ctx = createMockCtx();
    const storage = createMockStore();
    const { sent, ws } = makeFakeWs();

    // Register a fake active run.
    const { registerRun } = await import("../runner.ts");
    registerRun("sess-1", { abort: async () => {} } as never, () => {});

    handleMessage(ctx, storage, ws, {
      type: "command",
      sessionId: "sess-1",
      name: "compact",
    });

    // handleCompactCommand is async — wait for it to settle.
    await new Promise((resolve) => setTimeout(resolve, 50));

    const errors = asErrorFrames(sent);
    expect(errors.some((e) => e.error?.includes("run is already active"))).toBe(true);
  });
});
