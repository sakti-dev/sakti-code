import { desc, eq } from "drizzle-orm";
import type { DrizzleDB } from "../init.ts";
import { sessionEntries } from "../schema.ts";
import { turns } from "../schema.ts";

export interface TurnRow {
  createdAt: number;
  endedAt: number | null;
  id: string;
  sequence: number;
  sessionId: string;
  startedAt: number;
}

export class TurnRepo {
  private readonly db: DrizzleDB;

  constructor(db: DrizzleDB) {
    this.db = db;
  }

  create(sessionId: string, startedAt: number): TurnRow {
    const existing = this.listBySession(sessionId);
    const lastSeq = existing.at(-1)?.sequence ?? -1;
    const sequence = lastSeq + 1;
    const id = crypto.randomUUID();
    const createdAt = Date.now();
    this.db
      .insert(turns)
      .values({ id, sessionId, sequence, startedAt, endedAt: null, createdAt })
      .run();
    return { id, sessionId, sequence, startedAt, endedAt: null, createdAt };
  }

  finalize(id: string, endedAt: number): void {
    this.db.update(turns).set({ endedAt }).where(eq(turns.id, id)).run();
  }

  finalizeLatest(sessionId: string, endedAt: number): void {
    const list = this.listBySession(sessionId);
    const latest = list.at(-1);
    if (latest && latest.endedAt === null) {
      this.finalize(latest.id, endedAt);
    }
  }

  listBySession(sessionId: string): TurnRow[] {
    return this.db
      .select()
      .from(turns)
      .where(eq(turns.sessionId, sessionId))
      .orderBy(turns.sequence)
      .all();
  }

  getLatest(sessionId: string): TurnRow | null {
    return this.listBySession(sessionId).at(-1) ?? null;
  }

  /**
   * Mark the turn's final assistant message entry as the summary (the
   * "is_turn_summary" flag). Walks the turn's entries newest-first and
   * picks the last assistant message. No-op if the turn has no assistant
   * entry (e.g. aborted before any model response).
   */
  markSummary(turnId: string): void {
    const rows = this.db
      .select({ id: sessionEntries.id, content: sessionEntries.content })
      .from(sessionEntries)
      .where(eq(sessionEntries.turnId, turnId))
      .orderBy(desc(sessionEntries.sequence))
      .all();

    const lastAssistant = rows.find((r) => {
      try {
        const parsed = JSON.parse(r.content) as { message?: { role?: string } };
        return parsed.message?.role === "assistant";
      } catch {
        return false;
      }
    });

    if (lastAssistant) {
      this.db
        .update(sessionEntries)
        .set({ isTurnSummary: true })
        .where(eq(sessionEntries.id, lastAssistant.id))
        .run();
    }
  }
}
