import { describe, expect, it, vi } from "vite-plus/test";
import { getEdge } from "../transition-table.ts";
import { applyTransition } from "../transition-apply.ts";

// Minimal session shape applyTransition needs.
function session(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "s1",
    kind: "mission",
    projectId: "p1",
    profileId: null,
    status: "build",
    ...overrides,
  };
}

function makeCtx() {
  const updates: Array<{ id: string; data: Record<string, unknown> }> = [];
  const forceReset = vi.fn(async () => {});
  const graduate = vi.fn(async () => {});
  const ctx = {
    repos: {
      sessions: {
        update: vi.fn(async (id: string, data: Record<string, unknown>) => {
          updates.push({ id, data });
          return { id, ...data } as never;
        }),
      },
    },
    // injected side-effect builders; applyTransition receives them already bound
    forceReset,
    graduate,
    log: { agent: { warn: vi.fn(), info: vi.fn() } },
  } as unknown as Parameters<typeof applyTransition>[0];
  return { ctx, updates, forceReset, graduate };
}

describe("applyTransition", () => {
  it("specify→build: flips status to build, no observe/graduation", async () => {
    const { ctx, updates, forceReset, graduate } = makeCtx();
    const edge = getEdge("specify", "build");
    await applyTransition(ctx, session({ status: "specify" }), edge);
    expect(updates[0]?.data).toEqual({ status: "build" });
    expect(forceReset).not.toHaveBeenCalled();
    expect(graduate).not.toHaveBeenCalled();
  });

  it("build→verify: forced observe runs BEFORE the status flip", async () => {
    const order: string[] = [];
    const ctx = {
      repos: {
        sessions: {
          update: vi.fn(async (_id: string, data: Record<string, unknown>) => {
            order.push(`status:${JSON.stringify(data)}`);
          }),
        },
      },
      forceReset: vi.fn(async () => {
        order.push("observe");
      }),
      graduate: vi.fn(async () => {}),
      log: { agent: { warn: vi.fn(), info: vi.fn() } },
    } as unknown as Parameters<typeof applyTransition>[0];
    const edge = getEdge("build", "verify");
    await applyTransition(ctx, session({ status: "build" }), edge);
    expect(order).toEqual(["observe", 'status:{"status":"verify"}']);
  });

  it("plan→mission: runs graduation, no status flip on the plan session", async () => {
    const { ctx, updates, graduate, forceReset } = makeCtx();
    const edge = getEdge("plan", "mission");
    await applyTransition(ctx, session({ kind: "plan", status: "specify" }), edge);
    expect(graduate).toHaveBeenCalledWith("s1");
    expect(forceReset).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
  });

  it("verify→archive: flips status to archive", async () => {
    const { ctx, updates } = makeCtx();
    const edge = getEdge("verify", "archive");
    await applyTransition(ctx, session({ status: "verify" }), edge);
    expect(updates[0]?.data).toEqual({ status: "archive" });
  });

  it("swallows a forced-observe failure (status flip still lands)", async () => {
    const ctx = {
      repos: {
        sessions: {
          update: vi.fn(async (id: string, data: Record<string, unknown>) => ({
            id,
            ...data,
          })),
        },
      },
      forceReset: vi.fn(async () => {
        throw new Error("om offline");
      }),
      graduate: vi.fn(async () => {}),
      log: { agent: { warn: vi.fn(), info: vi.fn() } },
    } as unknown as Parameters<typeof applyTransition>[0];
    const edge = getEdge("build", "verify");
    await expect(applyTransition(ctx, session({ status: "build" }), edge)).resolves.toBeUndefined();
    expect(ctx.repos.sessions.update).toHaveBeenCalledWith("s1", { status: "verify" });
  });

  it("fires worktreeTeardown on a requiresWorktreeTeardown edge", async () => {
    const calls: string[] = [];
    const repos = { sessions: { update: async () => {} } };
    await applyTransition(
      {
        repos: repos as never,
        worktreeTeardown: async () => {
          calls.push("teardown");
        },
      },
      { id: "s1" },
      {
        from: "archive",
        to: "done",
        mode: "gate",
        instruction: "",
        statusTarget: "done",
        requiresWorktreeTeardown: true,
      },
    );
    expect(calls).toEqual(["teardown"]);
  });
});
