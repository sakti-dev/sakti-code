import { describe, expect, it, vi } from "vite-plus/test";
import { ASK_KINDS, type AskCtx } from "../ask-kinds.ts";

function makeCtx(): AskCtx {
  const updates: Array<{ id: string; data: Record<string, unknown> }> = [];
  return {
    sessions: {
      update: vi.fn(async (id: string, data: Record<string, unknown>) => {
        updates.push({ id, data });
        return { id, ...data } as never;
      }),
    },
    forceReset: vi.fn(async () => {}),
    appliedUpdates: updates,
  } as unknown as AskCtx;
}

describe("ASK_KINDS — session", () => {
  it("card is 'proposed-session'", () => {
    expect(ASK_KINDS.session.card).toBe("proposed-session");
  });

  it("onApprove is a no-op (the card's Create button calls session-create REST directly)", async () => {
    const ctx = makeCtx();
    await ASK_KINDS.session.onApprove?.("s1", "brief", ctx);
    expect((ctx as unknown as { appliedUpdates: unknown[] }).appliedUpdates).toHaveLength(0);
  });
});

describe("ASK_KINDS — plan", () => {
  it("card is 'proposed-plan'", () => {
    expect(ASK_KINDS.plan.card).toBe("proposed-plan");
  });

  it("onApprove sets status to building", async () => {
    const ctx = makeCtx();
    await ASK_KINDS.plan.onApprove?.("s1", "the plan body", ctx);
    expect(ctx.sessions.update).toHaveBeenCalledWith("s1", { status: "building" });
  });

  it("onApprove triggers a forced context reset (compact/observe)", async () => {
    const ctx = makeCtx();
    await ASK_KINDS.plan.onApprove?.("s1", "the plan body", ctx);
    expect(ctx.forceReset).toHaveBeenCalledWith("s1");
  });

  it("onReject is a no-op (stay in planning)", async () => {
    const ctx = makeCtx();
    await ASK_KINDS.plan.onReject?.("s1", "body", ctx);
    expect(ctx.sessions.update).not.toHaveBeenCalled();
  });
});

describe("ASK_KINDS — completion", () => {
  it("card is 'proposed-completion'", () => {
    expect(ASK_KINDS.completion.card).toBe("proposed-completion");
  });

  it("onApprove sets status to merged", async () => {
    const ctx = makeCtx();
    await ASK_KINDS.completion.onApprove?.("s1", "completion body", ctx);
    expect(ctx.sessions.update).toHaveBeenCalledWith("s1", { status: "merged" });
  });

  it("onReject sets status to building (request changes)", async () => {
    const ctx = makeCtx();
    await ASK_KINDS.completion.onReject?.("s1", "body", ctx);
    expect(ctx.sessions.update).toHaveBeenCalledWith("s1", { status: "building" });
  });
});
