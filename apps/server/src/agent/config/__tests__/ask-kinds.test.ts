import { describe, expect, it, vi } from "vite-plus/test";
import { ASK_KINDS, type AskCtx } from "../ask-kinds.ts";

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
