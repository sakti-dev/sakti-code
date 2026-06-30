import type { SessionError, SessionMetadata, SessionTreeEntry } from "@sakti-code/agent";
import { eq, sql } from "drizzle-orm";
import { Effect } from "effect";
import type { DrizzleDB } from "./init.ts";
import { sessionEntries, sessions } from "./schema.ts";

/**
 * Effect-native SQLite-backed session storage. node:sqlite is fully
 * synchronous, so every op is wrapped in `Effect.sync` (sync resolvers
 * stay sync — no microtask overhead vs. `Effect.tryPromise`).
 *
 * Implements `SessionStorageShape` from `@sakti-code/agent` structurally:
 * the agent's `SessionStorage` Context tag and the `SessionLive` layer
 * consume it via `yield* SessionStorage`.
 */
export class SqliteSessionStorage<TMetadata extends SessionMetadata = SessionMetadata> {
  private readonly db: DrizzleDB;
  private readonly sessionId: string;
  private readonly metadata: TMetadata;

  constructor(db: DrizzleDB, sessionId: string, metadata: TMetadata) {
    this.db = db;
    this.sessionId = sessionId;
    this.metadata = metadata;
  }

  getMetadata(): Effect.Effect<TMetadata, SessionError> {
    return Effect.succeed(this.metadata);
  }

  getLeafId(): Effect.Effect<string | null, SessionError> {
    return Effect.sync(() => {
      const row = this.db
        .select({ leafId: sessions.leafId })
        .from(sessions)
        .where(eq(sessions.id, this.sessionId))
        .get();
      return row?.leafId ?? null;
    });
  }

  setLeafId(leafId: string | null): Effect.Effect<void, SessionError> {
    return Effect.sync(() => {
      this.db.update(sessions).set({ leafId }).where(eq(sessions.id, this.sessionId)).run();
    });
  }

  createEntryId(): Effect.Effect<string, SessionError> {
    return Effect.sync(() => crypto.randomUUID());
  }

  appendEntry(entry: SessionTreeEntry): Effect.Effect<void, SessionError> {
    return Effect.sync(() => {
      const content = JSON.stringify(entry);

      this.db.transaction((tx) => {
        const row = tx
          .select({ max: sql<number>`coalesce(max(sequence), -1)` })
          .from(sessionEntries)
          .where(eq(sessionEntries.sessionId, this.sessionId))
          .get();
        const sequence = (row?.max ?? -1) + 1;

        tx.insert(sessionEntries)
          .values({
            id: entry.id,
            sessionId: this.sessionId,
            parentId: entry.parentId,
            sequence,
            kind: entry.type,
            content,
            timestamp: entry.timestamp,
            createdAt: Date.now(),
          })
          .run();

        if (entry.type !== "leaf") {
          tx.update(sessions)
            .set({ leafId: entry.id })
            .where(eq(sessions.id, this.sessionId))
            .run();
        }
      });
    });
  }

  getEntry(id: string): Effect.Effect<SessionTreeEntry | undefined, SessionError> {
    return Effect.sync(() => {
      const row = this.db.select().from(sessionEntries).where(eq(sessionEntries.id, id)).get();
      return row ? parseEntry(row.content) : undefined;
    });
  }

  findEntries<TType extends SessionTreeEntry["type"]>(
    type: TType,
  ): Effect.Effect<Array<Extract<SessionTreeEntry, { type: TType }>>, SessionError> {
    return Effect.sync(() => {
      const rows = this.db
        .select()
        .from(sessionEntries)
        .where(eq(sessionEntries.kind, type))
        .orderBy(sessionEntries.sequence)
        .all();
      return rows.map((r) => parseEntry(r.content) as Extract<SessionTreeEntry, { type: TType }>);
    });
  }

  getLabel(id: string): Effect.Effect<string | undefined, SessionError> {
    return Effect.sync(() => {
      const row = this.db.select().from(sessionEntries).where(eq(sessionEntries.id, id)).get();
      if (!row) {
        return;
      }
      const entry = parseEntry(row.content);
      if (entry?.type !== "label") {
        return;
      }
      return entry.label;
    });
  }

  getPathToRoot(leafId: string | null): Effect.Effect<SessionTreeEntry[], SessionError> {
    return Effect.sync(() => {
      if (!leafId) {
        return this.getAllEntriesSync();
      }

      const rows = this.db.all<{
        content: string;
      }>(sql`
        WITH RECURSIVE path AS (
          SELECT * FROM ${sessionEntries}
          WHERE id = ${leafId} AND session_id = ${this.sessionId}
          UNION ALL
          SELECT e.* FROM ${sessionEntries} e
          JOIN path p ON e.id = p.parent_id
        )
        SELECT content FROM path ORDER BY sequence
      `);
      return rows.map((r) => parseEntry(r.content));
    });
  }

  getEntries(): Effect.Effect<SessionTreeEntry[], SessionError> {
    return Effect.sync(() => this.getAllEntriesSync());
  }

  private getAllEntriesSync(): SessionTreeEntry[] {
    const rows = this.db
      .select()
      .from(sessionEntries)
      .where(eq(sessionEntries.sessionId, this.sessionId))
      .orderBy(sessionEntries.sequence)
      .all();
    return rows.map((r) => parseEntry(r.content));
  }

  /**
   * Copy entries from a source session into this session, preserving the tree.
   * If upToEntryId is provided, only copies entries up to and including that entry.
   * Entry IDs and parentIds are regenerated so the fork is independent.
   */
  forkFrom(sourceSessionId: string, upToEntryId?: string): Effect.Effect<void, SessionError> {
    return Effect.sync(() => this.forkFromSync(sourceSessionId, upToEntryId));
  }

  private forkFromSync(sourceSessionId: string, upToEntryId?: string): void {
    const sourceRows = this.db
      .select()
      .from(sessionEntries)
      .where(eq(sessionEntries.sessionId, sourceSessionId))
      .orderBy(sessionEntries.sequence)
      .all();

    let entriesToCopy = sourceRows;
    if (upToEntryId) {
      const cutIndex = sourceRows.findIndex((r) => r.id === upToEntryId);
      if (cutIndex >= 0) {
        entriesToCopy = sourceRows.slice(0, cutIndex + 1);
      }
    }

    if (entriesToCopy.length === 0) {
      return;
    }

    const idMap = new Map<string, string>();
    for (const row of entriesToCopy) {
      idMap.set(row.id, crypto.randomUUID());
    }

    const sourceSessionRow = this.db
      .select({ leafId: sessions.leafId })
      .from(sessions)
      .where(eq(sessions.id, sourceSessionId))
      .get();
    const sourceLeafId = sourceSessionRow?.leafId ?? null;

    this.db.transaction((tx) => {
      const row = tx
        .select({ max: sql<number>`coalesce(max(sequence), -1)` })
        .from(sessionEntries)
        .where(eq(sessionEntries.sessionId, this.sessionId))
        .get();
      let nextSequence = (row?.max ?? -1) + 1;

      for (const src of entriesToCopy) {
        const newId = idMap.get(src.id);
        if (!newId) {
          continue;
        }
        const newParentId = src.parentId ? (idMap.get(src.parentId) ?? null) : null;

        const entry = JSON.parse(src.content) as SessionTreeEntry;
        const forkedEntry = {
          ...entry,
          id: newId,
          parentId: newParentId,
        } as SessionTreeEntry;

        tx.insert(sessionEntries)
          .values({
            id: newId,
            sessionId: this.sessionId,
            parentId: newParentId,
            sequence: nextSequence++,
            kind: forkedEntry.type,
            content: JSON.stringify(forkedEntry),
            timestamp: forkedEntry.timestamp,
            createdAt: Date.now(),
          })
          .run();
      }

      let newLeafId: string | null;
      if (sourceLeafId && idMap.has(sourceLeafId)) {
        newLeafId = idMap.get(sourceLeafId) ?? null;
      } else {
        const lastSourceRow = entriesToCopy.at(-1);
        newLeafId = lastSourceRow ? (idMap.get(lastSourceRow.id) ?? null) : null;
      }

      tx.update(sessions).set({ leafId: newLeafId }).where(eq(sessions.id, this.sessionId)).run();
    });
  }
}

function parseEntry(content: string): SessionTreeEntry {
  return JSON.parse(content) as SessionTreeEntry;
}
