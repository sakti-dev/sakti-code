import { describe, expect, it, vi } from "vite-plus/test";
import { ASK_KINDS, type AskCtx, isKnownAskKind } from "../ask-kinds.ts";

function makeCtx(overrides?: {
  graduate?: (sessionId: string) => Promise<void>;
  forceReset?: (sessionId: string) => Promise<void>;
}): AskCtx {
  const sessions = { update: vi.fn(async () => {}) };
  return {
    sessions,
    ...(overrides?.graduate !== undefined ? { graduate: overrides.graduate } : {}),
    ...(overrides?.forceReset !== undefined ? { forceReset: overrides.forceReset } : {}),
    log: { agent: { warn: vi.fn(), info: vi.fn() } },
  } as unknown as AskCtx;
}

describe("session.onApprove (graduation)", () => {
  it("calls graduate with the session id when bound", async () => {
    const graduate = vi.fn(async () => {});
    const ctx = makeCtx({ graduate });
    await ASK_KINDS.session.onApprove?.("s1", "brief", ctx);
    expect(graduate).toHaveBeenCalledWith("s1");
  });

  it("does not throw when graduate is not bound (still a no-op-safe path)", async () => {
    const ctx = makeCtx();
    await expect(ASK_KINDS.session.onApprove?.("s1", "brief", ctx)).resolves.toBeUndefined();
  });

  it("swallows a graduation failure (best-effort — must not strand the mission)", async () => {
    const graduate = vi.fn(async () => {
      throw new Error("boom");
    });
    const ctx = makeCtx({ graduate });
    await expect(ASK_KINDS.session.onApprove?.("s1", "brief", ctx)).resolves.toBeUndefined();
    expect(ctx.log?.agent?.warn).toHaveBeenCalled();
  });
});

describe("spec ask-kind onApprove", () => {
  it("flips status to building but does NOT call forceReset", async () => {
    const forceReset = vi.fn(async () => {});
    const ctx = makeCtx({ forceReset });

    await ASK_KINDS.spec.onApprove?.("sess-1", "the spec body", ctx);

    expect(ctx.sessions.update).toHaveBeenCalledWith("sess-1", { status: "building" });
    expect(forceReset).not.toHaveBeenCalled();
  });
});

describe("completion ask-kind onApprove", () => {
  it("flips status to review (not merged)", async () => {
    const ctx = makeCtx();

    await ASK_KINDS.completion.onApprove?.("sess-1", "what I built", ctx);

    expect(ctx.sessions.update).toHaveBeenCalledWith("sess-1", { status: "review" });
  });

  it("onReject flips status back to building", async () => {
    const ctx = makeCtx();

    await ASK_KINDS.completion.onReject?.("sess-1", "what I built", ctx);

    expect(ctx.sessions.update).toHaveBeenCalledWith("sess-1", { status: "building" });
  });
});

describe("verify-complete ask-kind", () => {
  it("is a known ask kind", () => {
    expect(isKnownAskKind("verify-complete")).toBe(true);
  });

  it("card is proposed-completion", () => {
    expect(ASK_KINDS["verify-complete"].card).toBe("proposed-completion");
  });

  it("onApprove flips status to merged", async () => {
    const ctx = makeCtx();

    await ASK_KINDS["verify-complete"].onApprove?.("sess-1", "verify report", ctx);

    expect(ctx.sessions.update).toHaveBeenCalledWith("sess-1", { status: "merged" });
  });

  it("onReject flips status to building", async () => {
    const ctx = makeCtx();

    await ASK_KINDS["verify-complete"].onReject?.("sess-1", "verify report", ctx);

    expect(ctx.sessions.update).toHaveBeenCalledWith("sess-1", { status: "building" });
  });
});
