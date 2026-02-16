/**
 * WorkingMemoryStorage - CRUD operations for Working Memory
 *
 * Phase 4: Working Memory - persistent structured data for project context.
 */

import {
  getDb,
  workingMemory,
  type NewWorkingMemory,
  type WorkingMemory as WorkingMemoryType,
} from "@ekacode/server/db";
import { and, eq } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";

export type WorkingMemoryScope = "resource" | "thread";

export interface CreateWorkingMemoryInput {
  id?: string;
  resourceId: string;
  scope?: WorkingMemoryScope;
  content: string;
  createdAt?: number;
  updatedAt?: number;
}

export interface UpdateWorkingMemoryInput {
  content?: string;
  scope?: WorkingMemoryScope;
}

export class WorkingMemoryStorage {
  async getWorkingMemory(
    resourceId: string,
    scope: WorkingMemoryScope = "resource"
  ): Promise<WorkingMemoryType | null> {
    const db = await getDb();
    const result = await db
      .select()
      .from(workingMemory)
      .where(and(eq(workingMemory.resource_id, resourceId), eq(workingMemory.scope, scope)))
      .get();
    return result ?? null;
  }

  async createWorkingMemory(input: CreateWorkingMemoryInput): Promise<WorkingMemoryType> {
    const db = await getDb();
    const now = input.createdAt ?? Date.now();
    const [record] = await db
      .insert(workingMemory)
      .values({
        id: input.id ?? uuidv7(),
        resource_id: input.resourceId,
        scope: input.scope ?? "resource",
        content: input.content,
        created_at: new Date(now),
        updated_at: new Date(input.updatedAt ?? now),
      })
      .returning();

    return record;
  }

  async updateWorkingMemory(
    resourceId: string,
    input: UpdateWorkingMemoryInput,
    scope: WorkingMemoryScope = "resource"
  ): Promise<WorkingMemoryType | null> {
    const db = await getDb();
    const existing = await this.getWorkingMemory(resourceId, scope);

    if (!existing) {
      return null;
    }

    const updateData: Partial<NewWorkingMemory> = {};

    if (input.content !== undefined) {
      updateData.content = input.content;
    }
    if (input.scope !== undefined) {
      updateData.scope = input.scope;
    }
    updateData.updated_at = new Date();

    const [updated] = await db
      .update(workingMemory)
      .set(updateData)
      .where(and(eq(workingMemory.id, existing.id), eq(workingMemory.scope, scope)))
      .returning();

    return updated ?? null;
  }

  async upsertWorkingMemory(
    resourceId: string,
    input: CreateWorkingMemoryInput,
    scope: WorkingMemoryScope = "resource"
  ): Promise<WorkingMemoryType> {
    const existing = await this.getWorkingMemory(resourceId, scope);

    if (existing) {
      const updated = await this.updateWorkingMemory(resourceId, { content: input.content }, scope);
      return updated!;
    }

    return this.createWorkingMemory({
      resourceId,
      scope,
      content: input.content,
    });
  }

  async deleteWorkingMemory(
    resourceId: string,
    scope: WorkingMemoryScope = "resource"
  ): Promise<boolean> {
    const db = await getDb();
    const existing = await this.getWorkingMemory(resourceId, scope);

    if (!existing) {
      return false;
    }

    await db
      .delete(workingMemory)
      .where(and(eq(workingMemory.id, existing.id), eq(workingMemory.scope, scope)));

    return true;
  }

  async listWorkingMemoryByResource(resourceId: string): Promise<WorkingMemoryType[]> {
    const db = await getDb();
    return db.select().from(workingMemory).where(eq(workingMemory.resource_id, resourceId)).all();
  }
}

export const workingMemoryStorage = new WorkingMemoryStorage();
