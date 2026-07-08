import { SqliteSessionStorage } from "@sakti-code/db";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { makeContext } from "../../__tests__/helpers.ts";
import { clearRunsForTesting } from "../runner.ts";
import * as runnerMod from "../runner.ts";
import { runAgentStream } from "../ws-handler.ts";

describe("runAgentStream auto-chain across auto-edges", () => {
  beforeEach(() => {
    clearRunsForTesting();
  });

  it("chains build→verify (auto) and delivers the <instruction> as the next run's message", async () => {
    const { ctx, db } = await makeContext();
    const project = await ctx.repos.projects.create("chain", "/tmp/chain");
    const session = await ctx.repos.sessions.create(project.id, { status: "building" });
    const storage = new SqliteSessionStorage(db, session.id, {
      id: session.id,
      createdAt: new Date().toISOString(),
    });

    let calls = 0;
    const messages: string[] = [];
    const spy = vi.spyOn(runnerMod, "runPrompt");
    spy.mockImplementation(async (ctx2: unknown, sid: string, msg: string) => {
      calls++;
      messages.push(msg);
      // First run simulates build calling transition({to:"verify"}).
      if (calls === 1) {
        const c = ctx2 as {
          repos: { sessions: { update: (id: string, d: object) => Promise<unknown> } };
        };
        await c.repos.sessions.update(sid, {
          pendingTransitionTo: "verify",
          pendingTransitionBody: "all done",
        });
      }
    });

    try {
      await runAgentStream(ctx, session.id, "go", storage, { send: () => {} });
      expect(calls).toBeGreaterThanOrEqual(2); // build run + auto-chained verify run
      // Status flipped building → review (build→verify edge).
      const after = ctx.repos.sessions.findById(session.id);
      expect(after?.status).toBe("review");
      // The chained verify run received the verify <instruction> as its message.
      expect(messages[1]).toContain("<instruction>");
      expect(messages[1]).toContain("verify mode");
    } finally {
      spy.mockRestore();
    }
  });

  it("chains verify→build (auto) when verify finds issues", async () => {
    const { ctx, db } = await makeContext();
    const project = await ctx.repos.projects.create("chain2", "/tmp/chain2");
    const session = await ctx.repos.sessions.create(project.id, { status: "review" });
    const storage = new SqliteSessionStorage(db, session.id, {
      id: session.id,
      createdAt: new Date().toISOString(),
    });

    let calls = 0;
    const spy = vi.spyOn(runnerMod, "runPrompt");
    spy.mockImplementation(async (ctx2: unknown, sid: string) => {
      calls++;
      if (calls === 1) {
        const c = ctx2 as {
          repos: { sessions: { update: (id: string, d: object) => Promise<unknown> } };
        };
        await c.repos.sessions.update(sid, {
          pendingTransitionTo: "build",
          pendingTransitionBody: "fixing plan",
        });
      }
    });

    try {
      await runAgentStream(ctx, session.id, "verify", storage, { send: () => {} });
      expect(calls).toBeGreaterThanOrEqual(2); // verify run + auto-chained build run
      expect(ctx.repos.sessions.findById(session.id)?.status).toBe("building");
    } finally {
      spy.mockRestore();
    }
  });

  it("pauses at a gate edge (verify→archive) — no auto-chain, pending stays", async () => {
    const { ctx, db } = await makeContext();
    const project = await ctx.repos.projects.create("gate", "/tmp/gate");
    const session = await ctx.repos.sessions.create(project.id, { status: "review" });
    const storage = new SqliteSessionStorage(db, session.id, {
      id: session.id,
      createdAt: new Date().toISOString(),
    });

    let calls = 0;
    const spy = vi.spyOn(runnerMod, "runPrompt");
    spy.mockImplementation(async (ctx2: unknown, sid: string) => {
      calls++;
      if (calls === 1) {
        const c = ctx2 as {
          repos: { sessions: { update: (id: string, d: object) => Promise<unknown> } };
        };
        await c.repos.sessions.update(sid, {
          pendingTransitionTo: "archive",
          pendingTransitionBody: "verify clean",
        });
      }
    });

    try {
      await runAgentStream(ctx, session.id, "verify", storage, { send: () => {} });
      expect(calls).toBe(1); // gate → no chained run
      const after = ctx.repos.sessions.findById(session.id);
      expect(after?.status).toBe("review"); // unchanged — gate doesn't flip
      expect(after?.pendingTransitionTo).toBe("archive"); // persists for confirm route
    } finally {
      spy.mockRestore();
    }
  });

  it("stops when a run ends without a transition", async () => {
    const { ctx, db } = await makeContext();
    const project = await ctx.repos.projects.create("stop", "/tmp/stop");
    const session = await ctx.repos.sessions.create(project.id, { status: "building" });
    const storage = new SqliteSessionStorage(db, session.id, {
      id: session.id,
      createdAt: new Date().toISOString(),
    });

    let calls = 0;
    const spy = vi.spyOn(runnerMod, "runPrompt");
    spy.mockImplementation(async () => {
      calls++; // no transition set
    });

    try {
      await runAgentStream(ctx, session.id, "go", storage, { send: () => {} });
      // Autonomous build stalls re-run with a reminder, up to the cap, then stop.
      // The exact count is the cap; assert it did NOT loop forever (bounded).
      expect(calls).toBeLessThan(6);
      expect(calls).toBeGreaterThanOrEqual(1);
    } finally {
      spy.mockRestore();
    }
  });

  it("injects a <reminder> when an autonomous build run stalls, then re-runs", async () => {
    const { ctx, db } = await makeContext();
    const project = await ctx.repos.projects.create("stall", "/tmp/stall");
    const session = await ctx.repos.sessions.create(project.id, { status: "building" });
    const storage = new SqliteSessionStorage(db, session.id, {
      id: session.id,
      createdAt: new Date().toISOString(),
    });

    let calls = 0;
    const messages: string[] = [];
    const spy = vi.spyOn(runnerMod, "runPrompt");
    spy.mockImplementation(async (_ctx: unknown, _sid: string, msg: string) => {
      calls++;
      messages.push(msg);
    });

    try {
      await runAgentStream(ctx, session.id, "go", storage, { send: () => {} });
      // The first stall injects a reminder as the next run's message.
      expect(calls).toBeGreaterThanOrEqual(2);
      expect(messages[1]).toContain("<reminder");
      expect(messages[1]).toContain('phase="build"');
    } finally {
      spy.mockRestore();
    }
  });

  it("does NOT inject reminders for interactive (specify) phases", async () => {
    const { ctx, db } = await makeContext();
    const project = await ctx.repos.projects.create("interactive", "/tmp/interactive");
    const session = await ctx.repos.sessions.create(project.id, { status: "specifying" });
    const storage = new SqliteSessionStorage(db, session.id, {
      id: session.id,
      createdAt: new Date().toISOString(),
    });

    let calls = 0;
    const spy = vi.spyOn(runnerMod, "runPrompt");
    spy.mockImplementation(async () => {
      calls++;
    });

    try {
      await runAgentStream(ctx, session.id, "design this", storage, { send: () => {} });
      // Specify is interactive — no reminder loop, exactly one run.
      expect(calls).toBe(1);
    } finally {
      spy.mockRestore();
    }
  });
});
