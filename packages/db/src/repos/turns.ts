import { eq } from "drizzle-orm";
import type { DrizzleDB } from "../init.ts";
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

  copyForFork(sourceSessionId: string, targetSessionId: string): void {
    const source = this.listBySession(sourceSessionId);
    for (const turn of source) {
      this.db
        .insert(turns)
        .values({
          id: crypto.randomUUID(),
          sessionId: targetSessionId,
          sequence: turn.sequence,
          startedAt: turn.startedAt,
          endedAt: turn.endedAt,
          createdAt: Date.now(),
        })
        .run();
    }
  }
}
