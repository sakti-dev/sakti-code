/**
 * Spec Helpers - Session and task spec management
 *
 * Phase 1 - Spec System
 * Provides helpers for:
 * - Managing active spec per session (via tool_sessions)
 * - Querying tasks by spec
 * - Getting ready tasks for a spec
 */

import { and, eq, inArray } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import {
  getDb,
  taskDependencies,
  tasks,
  toolSessions,
  type Task,
  type TaskDependency,
} from "../server-bridge";

const SPEC_TOOL_NAME = "spec";
const SPEC_TOOL_KEY = "activeSpec";
const CURRENT_TASK_KEY = "currentTask";
const SESSION_MODE_KEY = "runtimeMode";

export type RuntimeMode = "intake" | "plan" | "build";

function asRuntimeMode(value: unknown): RuntimeMode | null {
  return value === "intake" || value === "plan" || value === "build" ? value : null;
}

export interface SpecData {
  slug: string;
}

/**
 * Get the active spec slug for a session
 */
export async function getActiveSpec(sessionId: string): Promise<string | null> {
  const db = await getDb();

  const result = await db
    .select()
    .from(toolSessions)
    .where(
      and(
        eq(toolSessions.session_id, sessionId),
        eq(toolSessions.tool_name, SPEC_TOOL_NAME),
        eq(toolSessions.tool_key, SPEC_TOOL_KEY)
      )
    )
    .get();

  if (!result || !result.data || typeof result.data !== "object") {
    return null;
  }

  const specData = result.data as SpecData;
  return specData.slug ?? null;
}

/**
 * Update the active spec for a session (upsert)
 */
export async function updateSessionSpec(sessionId: string, specSlug: string): Promise<void> {
  const db = await getDb();
  const now = new Date();

  const existing = await db
    .select()
    .from(toolSessions)
    .where(
      and(
        eq(toolSessions.session_id, sessionId),
        eq(toolSessions.tool_name, SPEC_TOOL_NAME),
        eq(toolSessions.tool_key, SPEC_TOOL_KEY)
      )
    )
    .get();

  if (existing) {
    await db
      .update(toolSessions)
      .set({
        data: { slug: specSlug },
        last_accessed: now,
      })
      .where(eq(toolSessions.tool_session_id, existing.tool_session_id));
  } else {
    await db.insert(toolSessions).values({
      tool_session_id: uuidv7(),
      session_id: sessionId,
      tool_name: SPEC_TOOL_NAME,
      tool_key: SPEC_TOOL_KEY,
      data: { slug: specSlug },
      created_at: now,
      last_accessed: now,
    });
  }
}

export interface CurrentTaskData {
  taskId: string;
}

/**
 * Get the current task ID for a session
 */
export async function getCurrentTask(sessionId: string): Promise<string | null> {
  const db = await getDb();

  const result = await db
    .select()
    .from(toolSessions)
    .where(
      and(
        eq(toolSessions.session_id, sessionId),
        eq(toolSessions.tool_name, SPEC_TOOL_NAME),
        eq(toolSessions.tool_key, CURRENT_TASK_KEY)
      )
    )
    .get();

  if (!result || !result.data || typeof result.data !== "object") {
    return null;
  }

  const taskData = result.data as CurrentTaskData;
  return taskData.taskId ?? null;
}

/**
 * Update the current task for a session (upsert)
 */
export async function updateCurrentTask(sessionId: string, taskId: string): Promise<void> {
  const db = await getDb();
  const now = new Date();

  const existing = await db
    .select()
    .from(toolSessions)
    .where(
      and(
        eq(toolSessions.session_id, sessionId),
        eq(toolSessions.tool_name, SPEC_TOOL_NAME),
        eq(toolSessions.tool_key, CURRENT_TASK_KEY)
      )
    )
    .get();

  if (existing) {
    await db
      .update(toolSessions)
      .set({
        data: { taskId },
        last_accessed: now,
      })
      .where(eq(toolSessions.tool_session_id, existing.tool_session_id));
  } else {
    await db.insert(toolSessions).values({
      tool_session_id: uuidv7(),
      session_id: sessionId,
      tool_name: SPEC_TOOL_NAME,
      tool_key: CURRENT_TASK_KEY,
      data: { taskId },
      created_at: now,
      last_accessed: now,
    });
  }
}

/**
 * Get the runtime mode for a session (plan | build)
 */
export async function getSessionRuntimeMode(sessionId: string): Promise<RuntimeMode | null> {
  const db = await getDb();

  const result = await db
    .select()
    .from(toolSessions)
    .where(
      and(
        eq(toolSessions.session_id, sessionId),
        eq(toolSessions.tool_name, SPEC_TOOL_NAME),
        eq(toolSessions.tool_key, SESSION_MODE_KEY)
      )
    )
    .get();

  if (!result || !result.data || typeof result.data !== "object") {
    return null;
  }

  const modeData = result.data as { mode?: unknown };
  return asRuntimeMode(modeData?.mode);
}

/**
 * Update the runtime mode for a session (upsert)
 */
export async function updateSessionRuntimeMode(
  sessionId: string,
  mode: RuntimeMode
): Promise<void> {
  const db = await getDb();
  const now = new Date();

  const existing = await db
    .select()
    .from(toolSessions)
    .where(
      and(
        eq(toolSessions.session_id, sessionId),
        eq(toolSessions.tool_name, SPEC_TOOL_NAME),
        eq(toolSessions.tool_key, SESSION_MODE_KEY)
      )
    )
    .get();

  if (existing) {
    await db
      .update(toolSessions)
      .set({
        data: { mode },
        last_accessed: now,
      })
      .where(eq(toolSessions.tool_session_id, existing.tool_session_id));
  } else {
    await db.insert(toolSessions).values({
      tool_session_id: uuidv7(),
      session_id: sessionId,
      tool_name: SPEC_TOOL_NAME,
      tool_key: SESSION_MODE_KEY,
      data: { mode },
      created_at: now,
      last_accessed: now,
    });
  }
}

/**
 * Generate task ID from spec slug and task ID
 */
export function generateTaskId(specSlug: string, taskId: string): string {
  return `spec-${specSlug}_${taskId}`;
}

/**
 * Get task by spec slug and task ID (e.g., "user-auth", "T-001")
 */
export async function getTaskBySpecAndId(specSlug: string, taskId: string): Promise<Task | null> {
  const db = await getDb();
  const allTasks: Task[] = await db.select().from(tasks).all();

  const task = allTasks.find(t => {
    const specMeta = t.metadata as Record<string, unknown> | null;
    if (!specMeta || typeof specMeta !== "object") return false;
    const spec = specMeta.spec as Record<string, unknown> | null;
    return spec?.slug === specSlug && spec?.taskId === taskId;
  });

  return task ?? null;
}

/**
 * List all tasks for a spec
 */
export async function listTasksBySpec(specSlug: string): Promise<Task[]> {
  const db = await getDb();
  const allTasks: Task[] = await db.select().from(tasks).all();

  return allTasks.filter(t => {
    const specMeta = t.metadata as Record<string, unknown> | null;
    if (!specMeta || typeof specMeta !== "object") return false;
    const spec = specMeta.spec as Record<string, unknown> | null;
    return spec?.slug === specSlug;
  });
}

/**
 * Get tasks that are ready to work on (no unclosed blocking dependencies), filtered by spec
 */
export async function getReadyTasks(specSlug: string): Promise<Task[]> {
  const db = await getDb();

  const allTasks: Task[] = await db.select().from(tasks).all();
  const specTasks = allTasks.filter(t => {
    const specMeta = t.metadata as Record<string, unknown> | null;
    if (!specMeta || typeof specMeta !== "object") return false;
    const spec = specMeta.spec as Record<string, unknown> | null;
    return spec?.slug === specSlug;
  });

  const openTasks = specTasks.filter(t => t.status === "open");
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
    const blockingTask = await db.select().from(tasks).where(eq(tasks.id, dep.depends_on_id)).get();

    if (blockingTask && blockingTask.status !== "closed") {
      blockedByOpen.add(dep.task_id);
    }
  }

  return openTasks.filter(t => !blockedByOpen.has(t.id));
}
