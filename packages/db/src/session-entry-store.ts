import type {
  SessionMetadata,
  SessionStorage,
  SessionTreeEntry,
} from "@sakti-code/agent";
import { eq, sql } from "drizzle-orm";
import type { DrizzleDB } from "./init.ts";
import { sessionEntries, sessions } from "./schema.ts";

export class SqliteSessionStorage<
  TMetadata extends SessionMetadata = SessionMetadata,
> implements SessionStorage<TMetadata>
{
  private readonly db: DrizzleDB;
  private readonly sessionId: string;
  private readonly metadata: TMetadata;

  constructor(db: DrizzleDB, sessionId: string, metadata: TMetadata) {
    this.db = db;
    this.sessionId = sessionId;
    this.metadata = metadata;
  }

  async getMetadata(): Promise<TMetadata> {
    return this.metadata;
  }

  async getLeafId(): Promise<string | null> {
    const row = this.db
      .select({ leafId: sessions.leafId })
      .from(sessions)
      .where(eq(sessions.id, this.sessionId))
      .get();
    return row?.leafId ?? null;
  }

  async setLeafId(leafId: string | null): Promise<void> {
    await this.db
      .update(sessions)
      .set({ leafId })
      .where(eq(sessions.id, this.sessionId));
  }

  async createEntryId(): Promise<string> {
    return crypto.randomUUID();
  }

  async appendEntry(entry: SessionTreeEntry): Promise<void> {
    const sequence = await this.getNextSequence();

    const content = JSON.stringify(entry);

    await this.db.insert(sessionEntries).values({
      id: entry.id,
      sessionId: this.sessionId,
      parentId: entry.parentId,
      sequence,
      kind: entry.type,
      content,
      timestamp: entry.timestamp,
      createdAt: Date.now(),
    });

    if (entry.type !== "leaf") {
      await this.setLeafId(entry.id);
    }
  }

  async getEntry(id: string): Promise<SessionTreeEntry | undefined> {
    const row = this.db
      .select()
      .from(sessionEntries)
      .where(eq(sessionEntries.id, id))
      .get();
    return row ? parseEntry(row.content) : undefined;
  }

  async findEntries<TType extends SessionTreeEntry["type"]>(
    type: TType
  ): Promise<Array<Extract<SessionTreeEntry, { type: TType }>>> {
    const rows = this.db
      .select()
      .from(sessionEntries)
      .where(eq(sessionEntries.kind, type))
      .orderBy(sessionEntries.sequence)
      .all();
    return rows.map(
      (r) => parseEntry(r.content) as Extract<SessionTreeEntry, { type: TType }>
    );
  }

  async getLabel(id: string): Promise<string | undefined> {
    const row = this.db
      .select()
      .from(sessionEntries)
      .where(eq(sessionEntries.id, id))
      .get();
    if (!row) {
      return;
    }
    const entry = parseEntry(row.content);
    if (entry?.type !== "label") {
      return;
    }
    return entry.label;
  }

  async getPathToRoot(leafId: string | null): Promise<SessionTreeEntry[]> {
    if (!leafId) {
      return this.getEntries();
    }

    const allEntries = await this.getEntries();
    const entryMap = new Map(allEntries.map((e) => [e.id, e]));

    const path: SessionTreeEntry[] = [];
    let current: string | null = leafId;
    const visited = new Set<string>();

    while (current && !visited.has(current)) {
      visited.add(current);
      const entry = entryMap.get(current);
      if (!entry) {
        break;
      }
      path.push(entry);
      current = entry.parentId ?? null;
    }

    path.reverse();
    return path;
  }

  async getEntries(): Promise<SessionTreeEntry[]> {
    const rows = this.db
      .select()
      .from(sessionEntries)
      .where(eq(sessionEntries.sessionId, this.sessionId))
      .orderBy(sessionEntries.sequence)
      .all();
    return rows.map((r) => parseEntry(r.content));
  }

  private async getNextSequence(): Promise<number> {
    const row = this.db
      .select({ max: sql<number>`coalesce(max(sequence), -1)` })
      .from(sessionEntries)
      .where(eq(sessionEntries.sessionId, this.sessionId))
      .get();
    return (row?.max ?? -1) + 1;
  }

  /**
   * Copy entries from a source session into this session, preserving the tree.
   * If upToEntryId is provided, only copies entries up to and including that entry.
   * Entry IDs and parentIds are regenerated so the fork is independent.
   */
  async forkFrom(sourceSessionId: string, upToEntryId?: string): Promise<void> {
    // Load source entries in sequence order
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

    // Build a mapping from old entry IDs to new (regenerated) IDs
    const idMap = new Map<string, string>();
    for (const row of entriesToCopy) {
      idMap.set(row.id, crypto.randomUUID());
    }

    // Read the source session's leaf to know the effective leaf entry
    const sourceSessionRow = this.db
      .select({ leafId: sessions.leafId })
      .from(sessions)
      .where(eq(sessions.id, sourceSessionId))
      .get();
    const sourceLeafId = sourceSessionRow?.leafId ?? null;

    // Insert copied entries with re-chained parentId.
    // appendEntry updates the leaf on each insert; we overwrite the leaf once
    // at the end so it points at the right spot (source leaf, or last copied
    // entry if the source leaf was beyond the cut point).
    for (const row of entriesToCopy) {
      const newId = idMap.get(row.id);
      if (!newId) {
        continue;
      }
      const newParentId = row.parentId
        ? (idMap.get(row.parentId) ?? null)
        : null;

      // Parse the entry content and rewrite id/parentId so the JSON blob is
      // consistent with the new DB columns.
      const entry = JSON.parse(row.content) as SessionTreeEntry;
      const forkedEntry = {
        ...entry,
        id: newId,
        parentId: newParentId,
      } as SessionTreeEntry;

      await this.appendEntry(forkedEntry);
    }

    // Pick the new leaf: the copied equivalent of the source leaf if it was in
    // the copied range; otherwise the last copied entry.
    let newLeafId: string | null;
    if (sourceLeafId && idMap.has(sourceLeafId)) {
      newLeafId = idMap.get(sourceLeafId) ?? null;
    } else {
      const lastSourceRow = entriesToCopy.at(-1);
      newLeafId = lastSourceRow ? (idMap.get(lastSourceRow.id) ?? null) : null;
    }
    await this.setLeafId(newLeafId);
  }
}

function parseEntry(content: string): SessionTreeEntry {
  return JSON.parse(content) as SessionTreeEntry;
}
