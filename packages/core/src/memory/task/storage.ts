/**
 * TaskStorage - CRUD operations for tasks and dependencies
 *
 * Phase 1 Memory System - Task storage implementation.
 */

import { and, eq, inArray, not, sql } from "drizzle-orm";
import {
  getDb,
  publishTaskUpdated,
  taskDependencies,
  tasks,
  type NewTask,
  type Task,
  type TaskDependency,
} from "../../server-bridge";

async function publishTaskUpdate(sessionId: string | null) {
  if (!sessionId) return;

  try {
    const sessionTasks = await taskStorage.listTasksBySession(sessionId);
    await publishTaskUpdated(sessionId, sessionTasks);
  } catch {
    // Bus may not be available in all contexts (e.g., tests without bus setup)
  }
}

export interface CreateTaskInput {
  id: string;
  title: string;
  description?: string;
  status?: "open" | "in_progress" | "closed";
  priority?: number;
  type?: "bug" | "feature" | "task" | "epic" | "chore";
  assignee?: string;
  sessionId?: string;
  createdAt: number;
  updatedAt: number;
  closedAt?: number;
  closeReason?: string;
  summary?: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string;
  status?: "open" | "in_progress" | "closed";
  priority?: number;
  type?: "bug" | "feature" | "task" | "epic" | "chore";
  assignee?: string;
  sessionId?: string;
  updatedAt?: number;
  closedAt?: number;
  closeReason?: string;
  summary?: string;
  metadata?: Record<string, unknown>;
}

export interface ListTasksOptions {
  status?: "open" | "in_progress" | "closed";
  limit?: number;
  titlePrefix?: string;
}

export interface BlockedStatus {
  isBlocked: boolean;
  blockingTasks: Task[];
}

export class TaskStorage {
  async createTask(input: CreateTaskInput): Promise<Task> {
    const db = await getDb();
    const [task] = await db
      .insert(tasks)
      .values({
        id: input.id,
        title: input.title,
        description: input.description ?? null,
        status: input.status ?? "open",
        priority: input.priority ?? 2,
        type: input.type ?? "task",
        assignee: input.assignee ?? null,
        session_id: input.sessionId ?? null,
        created_at: new Date(input.createdAt),
        updated_at: new Date(input.updatedAt),
        closed_at: input.closedAt ? new Date(input.closedAt) : null,
        close_reason: input.closeReason ?? null,
        summary: input.summary ?? null,
        metadata: input.metadata ?? null,
      })
      .returning();

    if (input.sessionId) {
      await publishTaskUpdate(input.sessionId);
    }

    return task;
  }

  async getTask(id: string): Promise<Task | null> {
    const db = await getDb();
    const result = await db.select().from(tasks).where(eq(tasks.id, id)).get();
    return result ?? null;
  }

  async updateTask(id: string, input: UpdateTaskInput): Promise<Task | null> {
    const db = await getDb();
    const updateData: Partial<NewTask> = {};

    if (input.title !== undefined) updateData.title = input.title;
    if (input.description !== undefined) updateData.description = input.description;
    if (input.status !== undefined) updateData.status = input.status;
    if (input.priority !== undefined) updateData.priority = input.priority;
    if (input.type !== undefined) updateData.type = input.type;
    if (input.assignee !== undefined) updateData.assignee = input.assignee;
    if (input.sessionId !== undefined) updateData.session_id = input.sessionId;
    if (input.updatedAt !== undefined) updateData.updated_at = new Date(input.updatedAt);
    if (input.closedAt !== undefined) updateData.closed_at = new Date(input.closedAt);
    if (input.closeReason !== undefined) updateData.close_reason = input.closeReason;
    if (input.summary !== undefined) updateData.summary = input.summary;
    if (input.metadata !== undefined) updateData.metadata = input.metadata;

    if (Object.keys(updateData).length === 0) {
      return this.getTask(id);
    }

    const [updated] = await db.update(tasks).set(updateData).where(eq(tasks.id, id)).returning();

    if (updated) {
      await publishTaskUpdate(updated.session_id);
    }

    return updated ?? null;
  }

  async deleteTask(id: string): Promise<void> {
    const db = await getDb();
    const task = await this.getTask(id);
    await db.delete(tasks).where(eq(tasks.id, id));

    if (task?.session_id) {
      await publishTaskUpdate(task.session_id);
    }
  }

  async listTasks(options?: ListTasksOptions): Promise<Task[]> {
    const db = await getDb();

    if (options?.status && options?.titlePrefix) {
      return db
        .select()
        .from(tasks)
        .where(
          and(
            eq(tasks.status, options.status!),
            sql`${tasks.title} LIKE ${options.titlePrefix + "%"}`
          )
        )
        .orderBy(tasks.created_at)
        .limit(options.limit ?? 100)
        .all();
    }

    if (options?.status) {
      return db
        .select()
        .from(tasks)
        .where(eq(tasks.status, options.status!))
        .orderBy(tasks.created_at)
        .limit(options.limit ?? 100)
        .all();
    }

    if (options?.titlePrefix) {
      return db
        .select()
        .from(tasks)
        .where(sql`${tasks.title} LIKE ${options.titlePrefix + "%"}`)
        .orderBy(tasks.created_at)
        .limit(options.limit ?? 100)
        .all();
    }

    return db
      .select()
      .from(tasks)
      .orderBy(tasks.created_at)
      .limit(options?.limit ?? 100)
      .all();
  }

  async listTasksBySession(sessionId: string, options?: ListTasksOptions): Promise<Task[]> {
    const db = await getDb();
    if (options?.status && options?.titlePrefix) {
      const query = db
        .select()
        .from(tasks)
        .where(
          and(
            eq(tasks.session_id, sessionId),
            eq(tasks.status, options.status),
            sql`${tasks.title} LIKE ${options.titlePrefix + "%"}`
          )
        )
        .orderBy(tasks.created_at);
      return options.limit !== undefined ? query.limit(options.limit).all() : query.all();
    }

    if (options?.status) {
      const query = db
        .select()
        .from(tasks)
        .where(and(eq(tasks.session_id, sessionId), eq(tasks.status, options.status)))
        .orderBy(tasks.created_at);
      return options.limit !== undefined ? query.limit(options.limit).all() : query.all();
    }

    if (options?.titlePrefix) {
      const query = db
        .select()
        .from(tasks)
        .where(
          and(
            eq(tasks.session_id, sessionId),
            sql`${tasks.title} LIKE ${options.titlePrefix + "%"}`
          )
        )
        .orderBy(tasks.created_at);
      return options.limit !== undefined ? query.limit(options.limit).all() : query.all();
    }

    const query = db
      .select()
      .from(tasks)
      .where(eq(tasks.session_id, sessionId))
      .orderBy(tasks.created_at);
    return options?.limit !== undefined ? query.limit(options.limit).all() : query.all();
  }

  async addDependency(input: {
    taskId: string;
    dependsOnId: string;
    type?: string;
    createdAt: number;
  }): Promise<TaskDependency> {
    const db = await getDb();
    const [dep] = await db
      .insert(taskDependencies)
      .values({
        task_id: input.taskId,
        depends_on_id: input.dependsOnId,
        type: input.type ?? "blocks",
        created_at: new Date(input.createdAt),
      })
      .returning();

    return dep;
  }

  async removeDependency(taskId: string, dependsOnId: string, type: string): Promise<void> {
    const db = await getDb();
    await db
      .delete(taskDependencies)
      .where(
        and(
          eq(taskDependencies.task_id, taskId),
          eq(taskDependencies.depends_on_id, dependsOnId),
          eq(taskDependencies.type, type)
        )
      );
  }

  async getDependencies(taskId: string): Promise<TaskDependency[]> {
    const db = await getDb();
    return db.select().from(taskDependencies).where(eq(taskDependencies.task_id, taskId));
  }

  async computeBlockedStatus(taskId: string): Promise<BlockedStatus> {
    const deps = await this.getDependencies(taskId);

    const blockingDeps = deps.filter(d => d.type === "blocks");
    if (blockingDeps.length === 0) {
      return { isBlocked: false, blockingTasks: [] };
    }

    const db = await getDb();
    const dependsOnIds = blockingDeps.map(d => d.depends_on_id);
    const blockingTasks = await db
      .select()
      .from(tasks)
      .where(and(inArray(tasks.id, dependsOnIds), not(eq(tasks.status, "closed"))));

    return {
      isBlocked: blockingTasks.length > 0,
      blockingTasks,
    };
  }

  async getReadyTasks(): Promise<Task[]> {
    const db = await getDb();
    const openTasks: Task[] = await db.select().from(tasks).where(eq(tasks.status, "open"));

    if (openTasks.length === 0) {
      return [];
    }

    const taskIds = openTasks.map(t => t.id);

    const deps: TaskDependency[] = await db
      .select()
      .from(taskDependencies)
      .where(and(inArray(taskDependencies.task_id, taskIds), eq(taskDependencies.type, "blocks")));

    const blockedByOpen: Set<string> = new Set();
    for (const dep of deps) {
      const blockingTask = await this.getTask(dep.depends_on_id);
      if (blockingTask && blockingTask.status !== "closed") {
        blockedByOpen.add(dep.task_id);
      }
    }

    return openTasks.filter(t => !blockedByOpen.has(t.id));
  }

  async searchTasks(searchQuery: string, limit: number = 10): Promise<Task[]> {
    const db = await getDb();

    const results = await db.all(sql`
      SELECT t.* FROM tasks_fts fts
      JOIN tasks t ON t.rowid = fts.rowid
      WHERE tasks_fts MATCH ${searchQuery}
      LIMIT ${limit}
    `);

    return results as Task[];
  }
}

export const taskStorage = new TaskStorage();
