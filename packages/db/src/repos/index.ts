import { and, desc, eq, sql } from "drizzle-orm";
import type { DrizzleDB } from "../init.ts";
import { projects, sessions, settings } from "../schema.ts";

export class ProjectRepo {
  private readonly db: DrizzleDB;
  constructor(db: DrizzleDB) {
    this.db = db;
  }

  async create(name: string, cwd: string) {
    const id = crypto.randomUUID();
    const now = Date.now();
    await this.db.insert(projects).values({ id, name, cwd, createdAt: now, updatedAt: now });
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
    return this.db.select().from(projects).orderBy(desc(projects.createdAt)).all();
  }

  async update(id: string, data: Partial<Pick<typeof projects.$inferInsert, "name" | "cwd">>) {
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
    options?: {
      title?: string;
      modelId?: string;
      profileId?: string | null;
      thinkingLevel?: string;
      parentSessionId?: string;
      kind?: string;
      status?: string;
      changeName?: string | null;
      pendingTransitionTo?: string | null;
      pendingTransitionBody?: string | null;
    },
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
      ...(options?.modelId === undefined ? {} : { modelId: options.modelId }),
      ...(options?.profileId === undefined ? {} : { profileId: options.profileId }),
      kind: options?.kind ?? "mission",
      ...(options?.status === undefined ? {} : { status: options.status }),
      thinkingLevel: options?.thinkingLevel ?? "off",
      ...(options?.changeName === undefined ? {} : { changeName: options.changeName }),
      ...(options?.pendingTransitionTo === undefined
        ? {}
        : { pendingTransitionTo: options.pendingTransitionTo }),
      ...(options?.pendingTransitionBody === undefined
        ? {}
        : { pendingTransitionBody: options.pendingTransitionBody }),
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

  listChildPlansByProject(projectId: string) {
    return this.db
      .select()
      .from(sessions)
      .where(and(eq(sessions.projectId, projectId), eq(sessions.kind, "plan")))
      .orderBy(desc(sessions.createdAt))
      .all();
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
      Pick<
        typeof sessions.$inferInsert,
        | "title"
        | "modelId"
        | "thinkingLevel"
        | "kind"
        | "profileId"
        | "status"
        | "changeName"
        | "pendingTransitionTo"
        | "pendingTransitionBody"
      >
    >,
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

export class SettingsRepo {
  private readonly db: DrizzleDB;
  constructor(db: DrizzleDB) {
    this.db = db;
  }

  get(key: string) {
    const row = this.db.select().from(settings).where(eq(settings.key, key)).get();
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

  async delete(key: string): Promise<void> {
    await this.db.delete(settings).where(eq(settings.key, key));
  }

  getAll() {
    return this.db.select().from(settings).all();
  }
}
