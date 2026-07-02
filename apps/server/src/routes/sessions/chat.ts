import { Effect } from "effect";
import { Hono } from "hono";
import { createSessionStorage, getCtx } from "../../context.ts";

export interface ChatTurnDTO {
  endedAt: number | null;
  id: string;
  intermediateIds: string[];
  sequence: number;
  startedAt: number;
  summaryMessage: unknown | null;
  userMessage: unknown | null;
}

export const chatRoutes = new Hono().basePath("/sessions").get("/:id/chat", async (c) => {
  const ctx = getCtx(c);
  const sessionId = c.req.param("id");
  const storage = createSessionStorage(ctx, sessionId);

  const turnRows = ctx.repos.turns.listBySession(sessionId);
  const entriesWithMeta = await Effect.runPromise(storage.getEntriesWithMeta());

  const byTurn = new Map<
    string,
    { intermediateIds: string[]; summary: unknown | null; user: unknown | null }
  >();

  for (const e of entriesWithMeta) {
    if (e.turnId === null) {
      continue;
    }
    const parsed = e.entry as { id?: string; message?: { role?: string } };
    const role = parsed.message?.role;
    const slot = byTurn.get(e.turnId) ?? {
      intermediateIds: [],
      summary: null,
      user: null,
    };
    if (role === "user" && slot.user === null) {
      slot.user = parsed;
    } else if (e.isTurnSummary) {
      slot.summary = parsed;
    } else {
      slot.intermediateIds.push(parsed.id ?? "");
    }
    byTurn.set(e.turnId, slot);
  }

  const turns: ChatTurnDTO[] = turnRows.map((t) => {
    const slot = byTurn.get(t.id) ?? { intermediateIds: [], summary: null, user: null };
    return {
      endedAt: t.endedAt,
      id: t.id,
      intermediateIds: slot.intermediateIds,
      sequence: t.sequence,
      startedAt: t.startedAt,
      summaryMessage: slot.summary,
      userMessage: slot.user,
    };
  });

  return c.json({ turns });
});
