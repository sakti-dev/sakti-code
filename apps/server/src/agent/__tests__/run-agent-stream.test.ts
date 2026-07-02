import type { AgentMessage, SessionTreeEntry } from "@sakti-code/agent";
import { SqliteSessionStorage } from "@sakti-code/db";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
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
  let runPromptSpy: ReturnType<typeof vi.spyOn> | null = null;

  beforeEach(() => {
    clearRunsForTesting();
  });

  afterEach(() => {
    runPromptSpy?.mockRestore();
    runPromptSpy = null;
  });

  it("stamps turnId on entries and marks the last assistant as summary", async () => {
    const { ctx, db } = await makeContext();
    const project = await ctx.repos.projects.create("stamp", "/tmp/stamp");
    const session = await ctx.repos.sessions.create(project.id);

    const storage = new SqliteSessionStorage(db, session.id, {
      id: session.id,
      createdAt: new Date().toISOString(),
    });

    runPromptSpy = vi.spyOn(runnerMod, "runPrompt");
    runPromptSpy.mockImplementation(
      async (_ctx: unknown, _sid: string, _msg: string, stor: SqliteSessionStorage) => {
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
  });
});
