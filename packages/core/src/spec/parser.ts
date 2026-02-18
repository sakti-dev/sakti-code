/**
 * Spec Parser - Parse tasks.md files
 *
 * Phase 2 - Spec System
 * Provides:
 * - parseTasksMd: Parse tasks.md file into structured data
 * - validateTaskDagFromParsed: Detect cycles in task dependencies
 */

import { promises as fs } from "fs";

export interface ParsedTask {
  id: string;
  title: string;
  requirements: string[];
  dependencies: string[];
  outcome: string;
  notes: string;
  subtasks: string[];
}

export type ParsedTaskInput = Omit<ParsedTask, "dependencies"> & {
  dependencies?: string[];
};

/**
 * Parse tasks.md file
 */
export async function parseTasksMd(tasksFilePath: string): Promise<ParsedTask[]> {
  let content: string;
  try {
    content = await fs.readFile(tasksFilePath, "utf-8");
  } catch {
    return [];
  }

  const taskBlocks = content.split(/^#{2,3}\s+(T-\d+)\s*[—–-]\s+(.+)$/m);

  const tasks: ParsedTask[] = [];

  for (let i = 1; i < taskBlocks.length; i += 3) {
    const id = taskBlocks[i];
    const title = taskBlocks[i + 1]?.trim();
    const body = taskBlocks[i + 2] || "";

    if (!id || !title) continue;

    const task = parseTaskBlock(id, title, body);
    tasks.push(task);
  }

  return tasks;
}

function parseTaskBlock(id: string, title: string, body: string): ParsedTask {
  const task: ParsedTask = {
    id,
    title,
    requirements: [],
    dependencies: [],
    outcome: "",
    notes: "",
    subtasks: [],
  };

  const reqMatch = body.match(/\*\*Maps to requirements:\*\*\s*([\d,\sR\-]+)/i);
  if (reqMatch) {
    task.requirements = parseIdList(reqMatch[1], "R-");
  }

  const depMatch = body.match(/\*\*Dependencies:\*\*\s*([\d,\sT\-]+)/i);
  if (depMatch) {
    task.dependencies = parseIdList(depMatch[1], "T-");
  }

  const outcomeMatch = body.match(/\*\*Outcome:\*\*\s*\n?([\s\S]*?)(?=\n## |\n\*\*|- \[ \]|$)/i);
  if (outcomeMatch) {
    task.outcome = outcomeMatch[1].trim();
  }

  const subtaskMatches = body.matchAll(/^-\s*\[\s*\]\s+(.+)$/gm);
  for (const match of subtaskMatches) {
    task.subtasks.push(match[1].trim());
  }

  return task;
}

function parseIdList(text: string, prefix: string): string[] {
  const regex = new RegExp(`${prefix}(\\d+)`, "g");
  const ids: string[] = [];
  let match;

  while ((match = regex.exec(text)) !== null) {
    ids.push(`${prefix}${match[1]}`);
  }

  return ids;
}

/**
 * Validate DAG from parsed tasks.md (BEFORE DB compilation)
 */
export function validateTaskDagFromParsed(tasks: ParsedTaskInput[]): {
  valid: boolean;
  cycles: string[][];
  ready: string[];
} {
  const deps: Map<string, string[]> = new Map();

  for (const task of tasks) {
    deps.set(task.id, task.dependencies || []);
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

  for (const task of tasks) {
    const id = task.id;
    if (!visited.has(id)) {
      dfs(id, [id]);
    }
  }

  const ready = tasks.filter(t => !t.dependencies || t.dependencies.length === 0).map(t => t.id);

  return {
    valid: cycles.length === 0,
    cycles,
    ready,
  };
}
