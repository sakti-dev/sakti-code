/**
 * ReflectionStorage - Phase 3 Reflection Storage
 *
 * Provides CRUD operations for reflections table.
 */

import { and, eq, sql } from "drizzle-orm";
import { getDb, reflections, type Reflection } from "../../server-bridge";

const drizzleOrm = await import("drizzle-orm");
const { desc: descDesc } = drizzleOrm;

export type { Reflection as ReflectionType };
export interface CreateReflectionInput {
  id: string;
  threadId?: string;
  resourceId?: string;
  content: string;
  mergedFrom?: string[];
  originType?: string;
  generationCount: number;
  tokenCount?: number;
}

export class ReflectionStorage {
  async createReflection(input: CreateReflectionInput): Promise<Reflection> {
    const db = await getDb();
    const now = new Date();

    const [reflection] = await db
      .insert(reflections)
      .values({
        id: input.id,
        thread_id: input.threadId ?? null,
        resource_id: input.resourceId ?? null,
        content: input.content,
        merged_from: input.mergedFrom ?? [],
        origin_type: input.originType ?? "reflection",
        generation_count: input.generationCount,
        token_count: input.tokenCount ?? null,
        created_at: now,
        updated_at: now,
      })
      .returning();

    return reflection;
  }

  async getReflectionById(id: string): Promise<Reflection | null> {
    const db = await getDb();
    const result = await db.select().from(reflections).where(eq(reflections.id, id)).get();
    return result ?? null;
  }

  async getReflectionsByThread(threadId: string, limit?: number): Promise<Reflection[]> {
    const db = await getDb();
    return db
      .select()
      .from(reflections)
      .where(eq(reflections.thread_id, threadId))
      .orderBy(descDesc(reflections.generation_count))
      .limit(limit ?? 100)
      .all();
  }

  async getReflectionsByResource(resourceId: string, limit?: number): Promise<Reflection[]> {
    const db = await getDb();
    return db
      .select()
      .from(reflections)
      .where(eq(reflections.resource_id, resourceId))
      .orderBy(descDesc(reflections.generation_count))
      .limit(limit ?? 100)
      .all();
  }

  async getLatestReflections(limit: number = 5): Promise<Reflection[]> {
    const db = await getDb();
    return db
      .select()
      .from(reflections)
      .orderBy(descDesc(reflections.created_at))
      .limit(limit)
      .all();
  }

  async deleteReflection(id: string): Promise<void> {
    const db = await getDb();
    await db.delete(reflections).where(eq(reflections.id, id));
  }

  async getReflectionCount(threadId?: string, resourceId?: string): Promise<number> {
    const db = await getDb();

    let where;
    if (threadId && resourceId) {
      where = and(eq(reflections.thread_id, threadId), eq(reflections.resource_id, resourceId));
    } else if (threadId) {
      where = eq(reflections.thread_id, threadId);
    } else if (resourceId) {
      where = eq(reflections.resource_id, resourceId);
    }

    const result = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(reflections)
      .where(where)
      .get();

    return result?.count ?? 0;
  }
}

export const reflectionStorage = new ReflectionStorage();
