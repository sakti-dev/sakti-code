import { SqliteSessionStorage } from "@sakti-code/db";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { makeApp, seedProfile } from "./helpers.ts";
import { teardownFauxLlm } from "./llm-helpers.ts";
import { chatRoutes } from "../routes/sessions/chat.ts";
import type { AgentMessage, SessionTreeEntry } from "@sakti-code/agent";

const TEST_MODEL_ID = "gpt-4";

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

describe("GET /api/sessions/:id/chat", () => {
  afterEach(() => {
    teardownFauxLlm();
  });

  it("returns turns with only user + summary messages, intermediates as ids", async () => {
    const { app, ctx, db } = await makeApp([chatRoutes]);
    const project = await ctx.repos.projects.create("chat-test", "/tmp/chat-test");
    const session = await ctx.repos.sessions.create(project.id);
    seedProfile(ctx, { provider: "openai", model: TEST_MODEL_ID });

    const storage = new SqliteSessionStorage(db, session.id, {
      id: session.id,
      createdAt: new Date().toISOString(),
    });
    const turn = ctx.repos.turns.create(session.id, 1000);
    storage.setCurrentTurnId(turn.id);
    await Effect.runPromise(storage.appendEntry(msgEntry("cu1", null, "user", "hello")));
    await Effect.runPromise(storage.appendEntry(msgEntry("ca1", "cu1", "assistant", "thinking")));
    await Effect.runPromise(storage.appendEntry(msgEntry("ct1", "ca1", "toolResult", "result")));
    await Effect.runPromise(
      storage.appendEntry(msgEntry("ca2", "ct1", "assistant", "final answer")),
    );
    storage.setCurrentTurnId(null);
    ctx.repos.turns.markSummary(turn.id);

    const res = await app.request(`http://localhost/api/sessions/${session.id}/chat`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { turns: Array<Record<string, unknown>> };
    expect(body.turns).toHaveLength(1);

    const chatTurn = body.turns[0]!;
    expect(chatTurn.id).toBe(turn.id);
    expect((chatTurn.userMessage as { message?: { role?: string } }).message?.role).toBe("user");
    expect((chatTurn.summaryMessage as { message?: { role?: string } }).message?.role).toBe(
      "assistant",
    );
    expect(chatTurn.intermediateIds).toHaveLength(2);
    expect(chatTurn.intermediateIds).toEqual(["ca1", "ct1"]);
  });

  it("returns 200 with empty turns for a session with no turns", async () => {
    const { app, ctx } = await makeApp([chatRoutes]);
    const project = await ctx.repos.projects.create("empty-chat", "/tmp/empty-chat");
    const session = await ctx.repos.sessions.create(project.id);

    const res = await app.request(`http://localhost/api/sessions/${session.id}/chat`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.turns).toEqual([]);
  });
});
