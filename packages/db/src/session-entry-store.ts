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
}

function parseEntry(content: string): SessionTreeEntry {
  return JSON.parse(content) as SessionTreeEntry;
}
