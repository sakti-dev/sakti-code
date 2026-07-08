import type { AgentMessage, SessionStorageShape, SessionTreeEntry } from "@sakti-code/agent";
import { SqliteSessionStorage } from "@sakti-code/db";
import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { makeContext } from "../../__tests__/helpers.ts";
import { clearRunsForTesting } from "../runner.ts";
import * as runnerMod from "../runner.ts";
import { runAgentStream } from "../ws-handler.ts";

function messageEntry(
  id: string,
  parentId: string | null,
  role: string,
  content: string,
): SessionTreeEntry {
  return {
    type: "message",
    id,
    parentId,
    timestamp: new Date().toISOString(),
    message: {
      role,
      content,
      timestamp: Date.now(),
    } as unknown as AgentMessage,
  };
}

describe("runAgentStream turn stamping", () => {
  beforeEach(() => {
    clearRunsForTesting();
  });

  it("stamps turnId on entries and marks the last assistant as summary", async () => {
    const { ctx, db } = await makeContext();
    const project = await ctx.repos.projects.create("stamp", "/tmp/stamp");
    const session = await ctx.repos.sessions.create(project.id);

    const storage = new SqliteSessionStorage(db, session.id, {
      id: session.id,
      createdAt: new Date().toISOString(),
    });

    const runPromptSpy = vi.spyOn(runnerMod, "runPrompt");
    try {
      runPromptSpy.mockImplementation(
        async (_ctx: unknown, _sid: string, _msg: string, stor: SessionStorageShape) => {
          await Effect.runPromise(stor.appendEntry(messageEntry("ru1", null, "user", "hello")));
          await Effect.runPromise(
            stor.appendEntry(messageEntry("ra1", "ru1", "assistant", "hi there")),
          );
        },
      );

      await runAgentStream(ctx, session.id, "hello", storage, { send: () => {} });

      const turnRows = ctx.repos.turns.listBySession(session.id);
      expect(turnRows).toHaveLength(1);

      const entries = await Effect.runPromise(storage.getEntriesWithMeta());
      expect(entries).toHaveLength(2);
      for (const e of entries) {
        expect(e.turnId).toBe(turnRows[0]!.id);
      }

      const summary = entries.find((e) => e.isTurnSummary);
      expect(summary).toBeDefined();
      expect(summary?.entry.id).toBe("ra1");
      expect(turnRows[0]!.endedAt).not.toBeNull();
    } finally {
      runPromptSpy.mockRestore();
    }
  });

  it("rejects a run on a terminal (done) session without creating a turn", async () => {
    const { ctx, db } = await makeContext();
    const project = await ctx.repos.projects.create("done-proj", "/tmp/done");
    const session = await ctx.repos.sessions.create(project.id, {
      kind: "mission",
      status: "done",
    });
    const storage = new SqliteSessionStorage(db, session.id, {
      id: session.id,
      createdAt: new Date().toISOString(),
    });

    const runPromptSpy = vi.spyOn(runnerMod, "runPrompt");
    try {
      runPromptSpy.mockImplementation(async () => {});
      const sent: { type?: string }[] = [];
      await runAgentStream(ctx, session.id, "hi", storage, {
        send: (frame) => sent.push(frame as { type?: string }),
      });

      // No run, no turn.
      expect(runPromptSpy).not.toHaveBeenCalled();
      expect(ctx.repos.turns.listBySession(session.id)).toHaveLength(0);
      // An error frame was surfaced to the client.
      expect(sent.some((f) => f.type === "error")).toBe(true);
    } finally {
      runPromptSpy.mockRestore();
    }
  });
});
