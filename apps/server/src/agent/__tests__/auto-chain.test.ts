import { SqliteSessionStorage } from "@sakti-code/db";
import { mkdirSync, writeFileSync } from "node:fs";
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
    const session = await ctx.repos.sessions.create(project.id, { status: "build" });
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
      // Status flipped build → verify (build→verify edge).
      const after = ctx.repos.sessions.findById(session.id);
      expect(after?.status).toBe("verify");
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
    const session = await ctx.repos.sessions.create(project.id, { status: "verify" });
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
      expect(ctx.repos.sessions.findById(session.id)?.status).toBe("build");
    } finally {
      spy.mockRestore();
    }
  });

  it("pauses at a gate edge (verify→archive) — no auto-chain, pending stays", async () => {
    const { ctx, db } = await makeContext();
    const project = await ctx.repos.projects.create("gate", "/tmp/gate");
    const session = await ctx.repos.sessions.create(project.id, { status: "verify" });
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
      expect(after?.status).toBe("verify"); // unchanged — gate doesn't flip
      expect(after?.pendingTransitionTo).toBe("archive"); // persists for confirm route
    } finally {
      spy.mockRestore();
    }
  });

  it("stops when a run ends without a transition", async () => {
    const { ctx, db } = await makeContext();
    const project = await ctx.repos.projects.create("stop", "/tmp/stop");
    const session = await ctx.repos.sessions.create(project.id, { status: "build" });
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
    const session = await ctx.repos.sessions.create(project.id, { status: "build" });
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
    const session = await ctx.repos.sessions.create(project.id, { status: "specify" });
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

  it("build reminder is progress-aware — reads real task counts from tasks.md", async () => {
    const { ctx, db } = await makeContext();
    // Use a real temp cwd with a .sakti/changes/<name>/tasks.md so the sakti
    // library can resolve progress.
    const cwd = `/tmp/progress-test-${Date.now()}`;
    mkdirSync(`${cwd}/.sakti/changes/add-thing`, { recursive: true });
    writeFileSync(
      `${cwd}/.sakti/changes/add-thing/tasks.md`,
      "## 1. Area\n\n- [x] 1.1 done\n- [x] 1.2 done\n- [ ] 1.3 todo\n- [ ] 1.4 todo\n",
    );
    const project = await ctx.repos.projects.create("progress", cwd);
    const session = await ctx.repos.sessions.create(project.id, {
      status: "build",
      changeName: "add-thing",
    });
    const storage = new SqliteSessionStorage(db, session.id, {
      id: session.id,
      createdAt: new Date().toISOString(),
    });

    let messages: string[] = [];
    const spy = vi.spyOn(runnerMod, "runPrompt");
    spy.mockImplementation(async (_ctx: unknown, _sid: string, msg: string) => {
      messages.push(msg);
    });

    try {
      await runAgentStream(ctx, session.id, "go", storage, { send: () => {} });
      // The stall reminder for build carries the real count: 2 of 4 unchecked.
      const reminder = messages.find((m) => m.includes("<reminder"));
      expect(reminder).toBeDefined();
      expect(reminder).toContain("2 of 4 tasks still unchecked");
    } finally {
      spy.mockRestore();
    }
  });

  it("depth cap stops the auto-chain after MAX_CHAIN_DEPTH iterations", async () => {
    const { ctx, db } = await makeContext();
    const project = await ctx.repos.projects.create("depth", "/tmp/depth");
    const session = await ctx.repos.sessions.create(project.id, { status: "build" });
    const storage = new SqliteSessionStorage(db, session.id, {
      id: session.id,
      createdAt: new Date().toISOString(),
    });

    let calls = 0;
    const spy = vi.spyOn(runnerMod, "runPrompt");
    // Every run toggles between build→verify and verify→build, creating an
    // infinite auto-chain that only the depth cap can stop.
    spy.mockImplementation(async (ctx2: unknown, sid: string) => {
      calls++;
      const c = ctx2 as {
        repos: {
          sessions: {
            update: (id: string, d: object) => Promise<unknown>;
            findById: (id: string) => { status: string };
          };
        };
      };
      const currentStatus = c.repos.sessions.findById(sid).status;
      if (currentStatus === "build") {
        await c.repos.sessions.update(sid, {
          pendingTransitionTo: "verify",
          pendingTransitionBody: "done",
        });
      } else {
        await c.repos.sessions.update(sid, {
          pendingTransitionTo: "build",
          pendingTransitionBody: "fix it",
        });
      }
    });

    try {
      await runAgentStream(ctx, session.id, "go", storage, { send: () => {} });
      // MAX_CHAIN_DEPTH is 8; the initial run + 8 chained runs = 9 max.
      // The key assertion: it stopped (didn't infinite-loop).
      expect(calls).toBeLessThanOrEqual(10);
      expect(calls).toBeGreaterThanOrEqual(2);
    } finally {
      spy.mockRestore();
    }
  });

  it("emits transition_resolved {mode:gate} for verify→archive gate edge", async () => {
    const { ctx, db } = await makeContext();
    const project = await ctx.repos.projects.create("gate-frame", "/tmp/gate-frame");
    const session = await ctx.repos.sessions.create(project.id, { status: "verify" });
    const storage = new SqliteSessionStorage(db, session.id, {
      id: session.id,
      createdAt: new Date().toISOString(),
    });

    const spy = vi.spyOn(runnerMod, "runPrompt");
    spy.mockImplementation(async (ctx2: unknown, sid: string) => {
      const c = ctx2 as {
        repos: { sessions: { update: (id: string, d: object) => Promise<unknown> } };
      };
      await c.repos.sessions.update(sid, {
        pendingTransitionTo: "archive",
        pendingTransitionBody: "verify clean",
      });
    });

    const frames: unknown[] = [];
    try {
      await runAgentStream(ctx, session.id, "verify", storage, {
        send: (frame) => frames.push(frame),
      });
      const resolved = frames.find((f) => (f as { type?: string }).type === "transition_resolved");
      expect(resolved).toBeDefined();
      expect(resolved).toMatchObject({
        type: "transition_resolved",
        sessionId: session.id,
        to: "archive",
        mode: "gate",
        status: "verify",
        body: "verify clean",
      });
    } finally {
      spy.mockRestore();
    }
  });

  it("emits transition_resolved {mode:auto} for build→verify auto edge", async () => {
    const { ctx, db } = await makeContext();
    const project = await ctx.repos.projects.create("auto-frame", "/tmp/auto-frame");
    const session = await ctx.repos.sessions.create(project.id, { status: "build" });
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
          pendingTransitionTo: "verify",
          pendingTransitionBody: "done",
        });
      }
    });

    const frames: unknown[] = [];
    try {
      await runAgentStream(ctx, session.id, "go", storage, {
        send: (frame) => frames.push(frame),
      });
      const resolved = frames.find((f) => (f as { type?: string }).type === "transition_resolved");
      expect(resolved).toBeDefined();
      expect(resolved).toMatchObject({
        type: "transition_resolved",
        sessionId: session.id,
        to: "verify",
        mode: "auto",
        status: "verify",
      });
      expect(resolved).not.toHaveProperty("body");
    } finally {
      spy.mockRestore();
    }
  });

  it("does NOT emit transition_resolved when no transition was called", async () => {
    const { ctx, db } = await makeContext();
    const project = await ctx.repos.projects.create("no-trans", "/tmp/no-trans");
    const session = await ctx.repos.sessions.create(project.id, { status: "specify" });
    const storage = new SqliteSessionStorage(db, session.id, {
      id: session.id,
      createdAt: new Date().toISOString(),
    });

    const spy = vi.spyOn(runnerMod, "runPrompt");
    spy.mockImplementation(async () => {});

    const frames: unknown[] = [];
    try {
      await runAgentStream(ctx, session.id, "design", storage, {
        send: (frame) => frames.push(frame),
      });
      const resolved = frames.find((f) => (f as { type?: string }).type === "transition_resolved");
      expect(resolved).toBeUndefined();
    } finally {
      spy.mockRestore();
    }
  });
});
