/**
 * Spec Compiler - Compile tasks.md to database
 *
 * Phase 2 - Spec System
 * Provides:
 * - compileSpecToDb: Idempotent compilation of spec to DB
 */

import { eq } from "drizzle-orm";
import { promises as fs } from "fs";
import path from "path";
import { getDb, taskDependencies, tasks } from "../server-bridge";
import { generateTaskId, getTaskBySpecAndId, listTasksBySpec } from "./helpers";
import { parseTasksMd } from "./parser";

export interface SpecMetadata {
  spec: {
    slug: string;
    taskId: string;
    requirements: string[];
    parallel?: boolean;
    subtasks?: Array<{ text: string; optional: boolean }>;
  };
}

function extractIds(content: string, prefix: string): string[] {
  const regex = new RegExp(`${prefix}(\\d+)`, "g");
  const ids: string[] = [];
  let match;
  while ((match = regex.exec(content)) !== null) {
    ids.push(`${prefix}${match[1]}`);
  }
  return ids;
}

async function upsertTaskDependencies(
  specSlug: string,
  taskId: string,
  dependencies: string[]
): Promise<void> {
  const db = await getDb();

  const task = await getTaskBySpecAndId(specSlug, taskId);
  if (!task) return;

  await db.delete(taskDependencies).where(eq(taskDependencies.task_id, task.id));

  for (const depId of dependencies) {
    const depTask = await getTaskBySpecAndId(specSlug, depId);
    if (!depTask) continue;

    await db.insert(taskDependencies).values({
      task_id: task.id,
      depends_on_id: depTask.id,
      type: "blocks",
      created_at: new Date(),
    });
  }
}

/**
 * Compile spec to Task Memory DB
 * Idempotent - safe to run multiple times
 */
export async function compileSpecToDb(
  specDir: string,
  specSlug: string
): Promise<{
  created: number;
  updated: number;
  errors: string[];
}> {
  const tasksFile = path.join(specDir, "tasks.md");
  const parsedTasks = await parseTasksMd(tasksFile);

  let created = 0;
  let updated = 0;
  const errors: string[] = [];

  const requirementsFile = path.join(specDir, "requirements.md");
  let requirementsContent = "";
  try {
    requirementsContent = await fs.readFile(requirementsFile, "utf-8");
  } catch {
    errors.push("requirements.md not found");
    return { created: 0, updated: 0, errors };
  }

  const validRequirements = extractIds(requirementsContent, "R-");

  for (const task of parsedTasks) {
    const invalidReqs = task.requirements.filter(r => !validRequirements.includes(r));
    if (invalidReqs.length > 0) {
      errors.push(`${task.id}: Invalid requirements: ${invalidReqs.join(", ")}`);
      continue;
    }

    const taskIds = parsedTasks.map(t => t.id);
    const invalidDeps = task.dependencies.filter(d => !taskIds.includes(d));
    if (invalidDeps.length > 0) {
      errors.push(`${task.id}: Invalid dependencies: ${invalidDeps.join(", ")}`);
      continue;
    }

    const existing = await getTaskBySpecAndId(specSlug, task.id);
    const db = await getDb();
    const now = Date.now();

    if (existing) {
      const existingSpec = (existing.metadata as SpecMetadata | null)?.spec ?? null;

      const hasChanges =
        existing.title !== task.title ||
        existing.description !== task.outcome ||
        existingSpec?.requirements?.join(",") !== task.requirements.join(",");

      if (hasChanges) {
        await db
          .update(tasks)
          .set({
            title: task.title,
            description: task.outcome,
            metadata: {
              ...(existing.metadata as Record<string, unknown>),
              spec: {
                slug: specSlug,
                taskId: task.id,
                requirements: task.requirements,
                parallel: task.parallel,
                subtasks: task.subtasksDetailed,
              },
            },
            updated_at: new Date(now),
          })
          .where(eq(tasks.id, existing.id));
        updated++;
      }
    } else {
      const taskId = generateTaskId(specSlug, task.id);
      await db.insert(tasks).values({
        id: taskId,
        title: task.title,
        description: task.outcome,
        status: "open",
        priority: 2,
        type: "feature",
        metadata: {
          spec: {
            slug: specSlug,
            taskId: task.id,
            requirements: task.requirements,
            parallel: task.parallel,
            subtasks: task.subtasksDetailed,
          },
        },
        created_at: new Date(now),
        updated_at: new Date(now),
      });
      created++;
    }

    await upsertTaskDependencies(specSlug, task.id, task.dependencies);
  }

  return { created, updated, errors };
}

/**
 * Validate DAG (no cycles) and compute ready tasks from DB
 */
export async function validateTaskDependenciesFromDb(specSlug: string): Promise<{
  valid: boolean;
  cycles: string[][];
  ready: string[];
}> {
  const tasksList = await listTasksBySpec(specSlug);

  const db = await getDb();
  const depsFromDb: Array<{ taskId: string; dependsOnId: string; type: string }> = await db
    .select({
      taskId: taskDependencies.task_id,
      dependsOnId: taskDependencies.depends_on_id,
      type: taskDependencies.type,
    })
    .from(taskDependencies);

  const deps: Map<string, string[]> = new Map();
  for (const task of tasksList) {
    const taskMetadata = task.metadata as SpecMetadata | null;
    const taskSpecId = taskMetadata?.spec?.taskId ?? "";
    const taskDeps = depsFromDb
      .filter(d => d.taskId === task.id && d.type === "blocks")
      .map(d => {
        const depTask = tasksList.find(t => t.id === d.dependsOnId);
        return (depTask?.metadata as SpecMetadata | null)?.spec?.taskId ?? "";
      })
      .filter((id): id is string => !!id);
    deps.set(taskSpecId, taskDeps);
  }

  const cycles: string[][] = [];
  const visited = new Set<string>();
  const recursionStack = new Set<string>();

  function dfs(node: string, path: string[]): void {
    visited.add(node);
    recursionStack.add(node);

    const neighbors = deps.get(node) || [];
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        dfs(neighbor, [...path, neighbor]);
      } else if (recursionStack.has(neighbor)) {
        cycles.push([...path, neighbor]);
      }
    }

    recursionStack.delete(node);
  }

  for (const task of tasksList) {
    const taskMetadata = task.metadata as SpecMetadata | null;
    const id = taskMetadata?.spec?.taskId ?? "";
    if (!visited.has(id)) {
      dfs(id, [id]);
    }
  }

  const ready: string[] = [];
  for (const task of tasksList) {
    const taskMetadata = task.metadata as SpecMetadata | null;
    const taskSpecId = taskMetadata?.spec?.taskId ?? "";
    const blockingDeps = deps.get(taskSpecId) || [];

    const allDepsClosed = blockingDeps.every(depSpecId => {
      const depTask = tasksList.find(
        t => (t.metadata as SpecMetadata | null)?.spec?.taskId === depSpecId
      );
      return depTask?.status === "closed";
    });

    if (allDepsClosed && task.status === "open") {
      ready.push(taskSpecId);
    }
  }

  return {
    valid: cycles.length === 0,
    cycles,
    ready,
  };
}
