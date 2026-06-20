import { desc, eq, sql } from "drizzle-orm";
import type { DrizzleDB } from "../init.ts";
import {
  costs,
  messages,
  modelConfigs,
  projects,
  sessions,
  settings,
} from "../schema.ts";

export class ProjectRepo {
  private readonly db: DrizzleDB;
  constructor(db: DrizzleDB) {
    this.db = db;
  }

  async create(name: string, cwd: string) {
    const id = crypto.randomUUID();
    const now = Date.now();
    await this.db
      .insert(projects)
      .values({ id, name, cwd, createdAt: now, updatedAt: now });
    const created = this.findById(id);
    if (!created) {
      throw new Error(`Not found after write: ${id}`);
    }
    return created;
  }

  findById(id: string) {
    return this.db.select().from(projects).where(eq(projects.id, id)).get();
  }

  findByCwd(cwd: string) {
    return this.db.select().from(projects).where(eq(projects.cwd, cwd)).get();
  }

  list() {
    return this.db
      .select()
      .from(projects)
      .orderBy(desc(projects.createdAt))
      .all();
  }

  async update(
    id: string,
    data: Partial<Pick<typeof projects.$inferInsert, "name" | "cwd">>
  ) {
    await this.db
      .update(projects)
      .set({ ...data, updatedAt: Date.now() })
      .where(eq(projects.id, id));
    const created = this.findById(id);
    if (!created) {
      throw new Error(`Not found after write: ${id}`);
    }
    return created;
  }

  async delete(id: string) {
    await this.db.delete(projects).where(eq(projects.id, id));
  }
}

export class SessionRepo {
  private readonly db: DrizzleDB;
  constructor(db: DrizzleDB) {
    this.db = db;
  }

  async create(
    projectId: string,
    modelId: string,
    options?: {
      title?: string;
      thinkingLevel?: string;
      parentSessionId?: string;
    }
  ) {
    const id = crypto.randomUUID();
    const now = Date.now();
    await this.db.insert(sessions).values({
      id,
      projectId,
      ...(options?.parentSessionId === undefined
        ? {}
        : { parentSessionId: options.parentSessionId }),
      title: options?.title ?? null,
      modelId,
      thinkingLevel: options?.thinkingLevel ?? "off",
      createdAt: now,
      updatedAt: now,
    });
    const created = this.findById(id);
    if (!created) {
      throw new Error(`Not found after write: ${id}`);
    }
    return created;
  }

  findById(id: string) {
    return this.db.select().from(sessions).where(eq(sessions.id, id)).get();
  }

  listByProject(projectId: string) {
    return this.db
      .select()
      .from(sessions)
      .where(eq(sessions.projectId, projectId))
      .orderBy(desc(sessions.createdAt))
      .all();
  }

  async update(
    id: string,
    data: Partial<
      Pick<typeof sessions.$inferInsert, "title" | "modelId" | "thinkingLevel">
    >
  ) {
    await this.db
      .update(sessions)
      .set({ ...data, updatedAt: Date.now() })
      .where(eq(sessions.id, id));
    const created = this.findById(id);
    if (!created) {
      throw new Error(`Not found after write: ${id}`);
    }
    return created;
  }

  findForkedChildren(parentId: string) {
    return this.db
      .select()
      .from(sessions)
      .where(eq(sessions.parentSessionId, parentId))
      .orderBy(desc(sessions.createdAt))
      .all();
  }

  async delete(id: string) {
    await this.db.delete(sessions).where(eq(sessions.id, id));
  }
}

export class MessageRepo {
  private readonly db: DrizzleDB;
  constructor(db: DrizzleDB) {
    this.db = db;
  }

  async append(
    sessionId: string,
    data: {
      id?: string;
      role: string;
      content: string;
      toolCalls?: string;
      toolCallId?: string;
      toolName?: string;
      toolArguments?: string;
      isError?: number;
      stopReason?: string;
      errorMessage?: string;
      usage?: string;
    }
  ) {
    const id = data.id ?? crypto.randomUUID();
    await this.db.insert(messages).values({
      id,
      sessionId,
      role: data.role,
      content: data.content,
      toolCalls: data.toolCalls ?? null,
      toolCallId: data.toolCallId ?? null,
      toolName: data.toolName ?? null,
      toolArguments: data.toolArguments ?? null,
      isError: data.isError ?? null,
      stopReason: data.stopReason ?? null,
      errorMessage: data.errorMessage ?? null,
      usage: data.usage ?? null,
      createdAt: Date.now(),
    });
    return id;
  }

  loadBySession(sessionId: string) {
    return this.db
      .select()
      .from(messages)
      .where(eq(messages.sessionId, sessionId))
      .orderBy(messages.createdAt)
      .all();
  }

  async replaceForSession(
    sessionId: string,
    newMessages: Array<{
      role: string;
      content: string;
      toolCalls?: string;
      toolCallId?: string;
      toolName?: string;
      toolArguments?: string;
      isError?: number;
      usage?: string;
    }>
  ) {
    // Use a transaction for atomicity
    await this.db.transaction(async (tx) => {
      await tx.delete(messages).where(eq(messages.sessionId, sessionId));
      if (newMessages.length > 0) {
        const now = Date.now();
        await tx.insert(messages).values(
          newMessages.map((m, i) => ({
            id: crypto.randomUUID(),
            sessionId,
            role: m.role,
            content: m.content,
            toolCalls: m.toolCalls ?? null,
            toolCallId: m.toolCallId ?? null,
            toolName: m.toolName ?? null,
            toolArguments: m.toolArguments ?? null,
            isError: m.isError ?? null,
            usage: m.usage ?? null,
            createdAt: now + i, // preserve order via timestamp
          }))
        );
      }
    });
  }

  countBySession(sessionId: string) {
    const row = this.db
      .select({ count: sql<number>`count(*)` })
      .from(messages)
      .where(eq(messages.sessionId, sessionId))
      .get();
    return row?.count ?? 0;
  }
}

export class CostRepo {
  private readonly db: DrizzleDB;
  constructor(db: DrizzleDB) {
    this.db = db;
  }

  async record(
    sessionId: string,
    projectId: string,
    usage: { inputTokens: number; outputTokens: number; costUsd: number },
    modelId: string
  ) {
    const id = crypto.randomUUID();
    await this.db.insert(costs).values({
      id,
      sessionId,
      projectId,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      costUsd: usage.costUsd,
      modelId,
      createdAt: Date.now(),
    });
    return id;
  }

  aggregateByProject(projectId: string) {
    return this.db
      .select({
        totalInputTokens: sql<number>`coalesce(sum(input_tokens), 0)`,
        totalOutputTokens: sql<number>`coalesce(sum(output_tokens), 0)`,
        totalCostUsd: sql<number>`coalesce(sum(cost_usd), 0)`,
      })
      .from(costs)
      .where(eq(costs.projectId, projectId))
      .get();
  }

  aggregateBySession(sessionId: string) {
    return this.db
      .select({
        totalInputTokens: sql<number>`coalesce(sum(input_tokens), 0)`,
        totalOutputTokens: sql<number>`coalesce(sum(output_tokens), 0)`,
        totalCostUsd: sql<number>`coalesce(sum(cost_usd), 0)`,
      })
      .from(costs)
      .where(eq(costs.sessionId, sessionId))
      .get();
  }
}

export class SettingsRepo {
  private readonly db: DrizzleDB;
  constructor(db: DrizzleDB) {
    this.db = db;
  }

  get(key: string) {
    const row = this.db
      .select()
      .from(settings)
      .where(eq(settings.key, key))
      .get();
    return row?.value ?? null;
  }

  getByPrefix(prefix: string): Array<{ key: string; value: string }> {
    return this.db
      .select()
      .from(settings)
      .where(sql`${settings.key} LIKE ${`${prefix}%`}`)
      .all();
  }

  async set(key: string, value: string) {
    const now = Date.now();
    await this.db
      .insert(settings)
      .values({ key, value, updatedAt: now })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value, updatedAt: now },
      });
  }

  getAll() {
    return this.db.select().from(settings).all();
  }
}

export class ModelConfigRepo {
  private readonly db: DrizzleDB;
  constructor(db: DrizzleDB) {
    this.db = db;
  }

  async set(data: {
    projectId?: string;
    provider: string;
    modelId: string;
    thinkingLevel?: string;
  }) {
    const id = crypto.randomUUID();
    const now = Date.now();
    await this.db.insert(modelConfigs).values({
      id,
      projectId: data.projectId ?? null,
      provider: data.provider,
      modelId: data.modelId,
      thinkingLevel: data.thinkingLevel ?? "off",
      createdAt: now,
      updatedAt: now,
    });
    return id;
  }

  getForProject(projectId: string) {
    // Try project-specific first, fall back to global (null projectId)
    const projectConfig = this.db
      .select()
      .from(modelConfigs)
      .where(eq(modelConfigs.projectId, projectId))
      .get();
    if (projectConfig) {
      return projectConfig;
    }

    return (
      this.db
        .select()
        .from(modelConfigs)
        .where(sql`${modelConfigs.projectId} IS NULL`)
        .get() ?? null
    );
  }

  getGlobalDefault() {
    return (
      this.db
        .select()
        .from(modelConfigs)
        .where(sql`${modelConfigs.projectId} IS NULL`)
        .get() ?? null
    );
  }
}
