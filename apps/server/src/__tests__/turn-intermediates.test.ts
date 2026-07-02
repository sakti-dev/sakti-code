import { SqliteSessionStorage } from "@sakti-code/db";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";
import type { AgentMessage, SessionTreeEntry } from "@sakti-code/agent";
import { makeApp } from "./helpers.ts";
import { teardownFauxLlm } from "./llm-helpers.ts";
import { turnIntermediatesRoutes } from "../routes/sessions/turn-intermediates.ts";

function msgEntry(
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

describe("GET /api/sessions/:id/turns/:turnId/intermediates", () => {
  afterEach(() => {
    teardownFauxLlm();
  });

  it("returns the turn's non-summary entries in sequence order", async () => {
    const { app, ctx, db } = await makeApp([turnIntermediatesRoutes]);
    const project = await ctx.repos.projects.create("inter-test", "/tmp/inter-test");
    const session = await ctx.repos.sessions.create(project.id);

    const storage = new SqliteSessionStorage(db, session.id, {
      id: session.id,
      createdAt: new Date().toISOString(),
    });
    const turn = ctx.repos.turns.create(session.id, 1000);
    storage.setCurrentTurnId(turn.id);
    await Effect.runPromise(storage.appendEntry(msgEntry("iu1", null, "user", "hi")));
    await Effect.runPromise(storage.appendEntry(msgEntry("ia1", "iu1", "assistant", "step1")));
    await Effect.runPromise(storage.appendEntry(msgEntry("it1", "ia1", "toolResult", "res")));
    await Effect.runPromise(storage.appendEntry(msgEntry("ia2", "it1", "assistant", "final")));
    storage.setCurrentTurnId(null);
    ctx.repos.turns.markSummary(turn.id);

    const res = await app.request(
      `http://localhost/api/sessions/${session.id}/turns/${turn.id}/intermediates`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { entries: Array<{ id: string }> };
    expect(body.entries.map((e) => e.id)).toEqual(["iu1", "ia1", "it1"]);
  });

  it("returns empty for an unknown turn", async () => {
    const { app, ctx } = await makeApp([turnIntermediatesRoutes]);
    const project = await ctx.repos.projects.create("inter-empty", "/tmp/inter-empty");
    const session = await ctx.repos.sessions.create(project.id);

    const res = await app.request(
      `http://localhost/api/sessions/${session.id}/turns/nonexistent/intermediates`,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entries).toEqual([]);
  });
});
