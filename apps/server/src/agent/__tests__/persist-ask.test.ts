import { describe, expect, it, vi } from "vite-plus/test";
import type { AgentHarnessEvent } from "@sakti-code/agent";
import { persistAskSideEffect } from "../ws-handler.ts";

function makeCtx() {
  const updates: Array<{ id: string; data: Record<string, unknown> }> = [];
  const ctx = {
    repos: {
      sessions: {
        update: vi.fn(async (id: string, data: Record<string, unknown>) => {
          updates.push({ id, data });
          return { id, ...data } as never;
        }),
      },
    },
    log: {
      server: { error: vi.fn() },
    },
  } as unknown as Parameters<typeof persistAskSideEffect>[0];
  return { ctx, updates };
}

const askStart = (args: Record<string, unknown>): AgentHarnessEvent =>
  ({
    type: "tool_execution_start",
    toolCallId: "tc1",
    toolName: "ask",
    args,
  }) as unknown as AgentHarnessEvent;

describe("persistAskSideEffect", () => {
  it("no-ops for non-ask events", async () => {
    const { ctx, updates } = makeCtx();
    await persistAskSideEffect(ctx, "s1", {
      type: "tool_execution_end",
      toolCallId: "tc1",
      toolName: "read",
      result: null,
      isError: false,
    } as unknown as AgentHarnessEvent);
    expect(updates).toHaveLength(0);
  });

  it("no-ops for ask with an unknown kind (open question)", async () => {
    const { ctx, updates } = makeCtx();
    await persistAskSideEffect(ctx, "s1", askStart({ kind: "bogus", body: "hi" }));
    expect(updates).toHaveLength(0);
  });

  it("no-ops when body is missing", async () => {
    const { ctx, updates } = makeCtx();
    await persistAskSideEffect(ctx, "s1", askStart({ kind: "plan" }));
    expect(updates).toHaveLength(0);
  });

  it("plan ask → persists pendingAsk, leaves status untouched", async () => {
    const { ctx, updates } = makeCtx();
    await persistAskSideEffect(ctx, "s1", askStart({ kind: "plan", body: "the plan" }));
    expect(updates).toHaveLength(1);
    expect(updates[0]?.data).toEqual({ pendingAskKind: "plan", pendingAskBody: "the plan" });
  });

  it("session ask → persists pendingAsk, leaves status untouched", async () => {
    const { ctx, updates } = makeCtx();
    await persistAskSideEffect(ctx, "s1", askStart({ kind: "session", body: "brief" }));
    expect(updates[0]?.data).toEqual({
      pendingAskKind: "session",
      pendingAskBody: "brief",
    });
  });

  it("completion ask → persists pendingAsk AND flips status to review", async () => {
    const { ctx, updates } = makeCtx();
    await persistAskSideEffect(ctx, "s1", askStart({ kind: "completion", body: "done" }));
    expect(updates[0]?.data).toEqual({
      pendingAskKind: "completion",
      pendingAskBody: "done",
      status: "review",
    });
  });

  it("swallows update errors (never throws off the event stream)", async () => {
    const errorFn = vi.fn();
    const ctx = {
      repos: { sessions: { update: vi.fn().mockRejectedValue(new Error("db locked")) } },
      log: { server: { error: errorFn } },
    } as unknown as Parameters<typeof persistAskSideEffect>[0];
    await expect(
      persistAskSideEffect(ctx, "s1", askStart({ kind: "plan", body: "x" })),
    ).resolves.toBeUndefined();
    expect(errorFn).toHaveBeenCalled();
  });
});
