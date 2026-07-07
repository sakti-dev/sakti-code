import { Effect } from "effect";
import { Hono } from "hono";
import { createSessionStorage, getCtx } from "../../context.ts";

export interface ChatOmMarker {
  id: string;
  summary: string;
  type: "observation" | "reflection";
}

export interface ChatTurnDTO {
  endedAt: number | null;
  id: string;
  intermediateIds: string[];
  sequence: number;
  startedAt: number;
  summaryMessage: Record<string, unknown> | null;
  userMessage: Record<string, unknown> | null;
}

export const chatRoutes = new Hono().basePath("/sessions").get("/:id/chat", async (c) => {
  const ctx = getCtx(c);
  const sessionId = c.req.param("id");
  const storage = createSessionStorage(ctx, sessionId);

  const turnRows = ctx.repos.turns.listBySession(sessionId);
  const entriesWithMeta = await Effect.runPromise(storage.getEntriesWithMeta());

  const byTurn = new Map<
    string,
    {
      intermediateIds: string[];
      summary: Record<string, unknown> | null;
      user: Record<string, unknown> | null;
    }
  >();

  const markers: ChatOmMarker[] = [];

  for (const e of entriesWithMeta) {
    if (e.entry.type === "observation" || e.entry.type === "reflection") {
      markers.push({
        id: e.entry.id,
        summary: e.entry.summary,
        type: e.entry.type,
      });
      continue;
    }
    if (e.turnId === null || e.entry.type !== "message") {
      continue;
    }
    const parsed = e.entry as unknown as Record<string, unknown> & {
      id?: string;
      message?: { role?: string };
    };
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

  return c.json({ turns, ...(markers.length > 0 ? { markers } : {}) });
});
