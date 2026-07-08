import { describe, expect, it, vi } from "vite-plus/test";
import type { AgentHarnessEvent } from "@sakti-code/agent";
import { persistTransitionSideEffect, type PendingTransitionToolCalls } from "../ws-handler.ts";

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
  } as unknown as Parameters<typeof persistTransitionSideEffect>[0];
  return { ctx, updates };
}

const transitionStart = (args: Record<string, unknown>): AgentHarnessEvent =>
  ({
    type: "tool_execution_start",
    toolCallId: "tc1",
    toolName: "transition",
    args,
  }) as unknown as AgentHarnessEvent;

const transitionEnd = (result: Record<string, unknown>, isError = false): AgentHarnessEvent =>
  ({
    type: "tool_execution_end",
    toolCallId: "tc1",
    toolName: "transition",
    result,
    isError,
  }) as unknown as AgentHarnessEvent;

describe("persistTransitionSideEffect", () => {
  it("no-ops for non-transition events", async () => {
    const { ctx, updates } = makeCtx();
    const pending = new Map() as PendingTransitionToolCalls;
    await persistTransitionSideEffect(
      ctx,
      "s1",
      {
        type: "tool_execution_end",
        toolCallId: "tc1",
        toolName: "read",
        result: null,
        isError: false,
      } as unknown as AgentHarnessEvent,
      pending,
    );
    expect(updates).toHaveLength(0);
  });

  it("no-ops when body is missing", async () => {
    const { ctx, updates } = makeCtx();
    const pending = new Map() as PendingTransitionToolCalls;
    await persistTransitionSideEffect(ctx, "s1", transitionStart({ to: "verify" }), pending);
    await persistTransitionSideEffect(ctx, "s1", transitionEnd({ terminate: true }), pending);
    expect(updates).toHaveLength(0);
  });

  it("no-ops when `to` is missing", async () => {
    const { ctx, updates } = makeCtx();
    const pending = new Map() as PendingTransitionToolCalls;
    await persistTransitionSideEffect(ctx, "s1", transitionStart({ body: "brief" }), pending);
    await persistTransitionSideEffect(ctx, "s1", transitionEnd({ terminate: true }), pending);
    expect(updates).toHaveLength(0);
  });

  it("does not persist a transition at tool start", async () => {
    const { ctx, updates } = makeCtx();
    const pending = new Map() as PendingTransitionToolCalls;

    await persistTransitionSideEffect(
      ctx,
      "s1",
      transitionStart({ to: "verify", body: "all tasks done" }),
      pending,
    );

    expect(updates).toHaveLength(0);
  });

  it("persists raw {to, body} only after a successful terminating transition result", async () => {
    const { ctx, updates } = makeCtx();
    const pending = new Map() as PendingTransitionToolCalls;
    await persistTransitionSideEffect(
      ctx,
      "s1",
      transitionStart({ to: "verify", body: "all tasks done" }),
      pending,
    );
    await persistTransitionSideEffect(ctx, "s1", transitionEnd({ terminate: true }), pending);
    expect(updates).toHaveLength(1);
    expect(updates[0]?.data).toEqual({
      pendingTransitionTo: "verify",
      pendingTransitionBody: "all tasks done",
    });
  });

  it("does not persist rejected transition tool results", async () => {
    const { ctx, updates } = makeCtx();
    const pending = new Map() as PendingTransitionToolCalls;

    await persistTransitionSideEffect(
      ctx,
      "s1",
      transitionStart({ to: "mission", body: "brief" }),
      pending,
    );
    await persistTransitionSideEffect(ctx, "s1", transitionEnd({ terminate: false }), pending);

    expect(updates).toHaveLength(0);
  });

  it("does NOT flip status — the runner owns mode resolution", async () => {
    const { ctx, updates } = makeCtx();
    const pending = new Map() as PendingTransitionToolCalls;
    await persistTransitionSideEffect(
      ctx,
      "s1",
      transitionStart({ to: "build", body: "fixing plan" }),
      pending,
    );
    await persistTransitionSideEffect(ctx, "s1", transitionEnd({ terminate: true }), pending);
    expect(updates[0]?.data).not.toHaveProperty("status");
  });

  it("records the destination for every phase edge (no kind filtering)", async () => {
    const { ctx, updates } = makeCtx();
    for (const to of ["specify", "build", "verify", "archive", "mission"]) {
      const pending = new Map() as PendingTransitionToolCalls;
      await persistTransitionSideEffect(ctx, "s1", transitionStart({ to, body: "b" }), pending);
      await persistTransitionSideEffect(ctx, "s1", transitionEnd({ terminate: true }), pending);
    }
    expect(updates.map((u) => u.data.pendingTransitionTo)).toEqual([
      "specify",
      "build",
      "verify",
      "archive",
      "mission",
    ]);
  });

  it("swallows update errors (never throws off the event stream)", async () => {
    const errorFn = vi.fn();
    const ctx = {
      repos: { sessions: { update: vi.fn().mockRejectedValue(new Error("db locked")) } },
      log: { server: { error: errorFn } },
    } as unknown as Parameters<typeof persistTransitionSideEffect>[0];
    const pending = new Map() as PendingTransitionToolCalls;
    await persistTransitionSideEffect(
      ctx,
      "s1",
      transitionStart({ to: "verify", body: "x" }),
      pending,
    );
    await expect(
      persistTransitionSideEffect(ctx, "s1", transitionEnd({ terminate: true }), pending),
    ).resolves.toBeUndefined();
    expect(errorFn).toHaveBeenCalled();
  });
});
