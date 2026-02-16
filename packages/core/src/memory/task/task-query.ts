/**
 * task-query tool
 *
 * Query tasks for work management.
 *
 * Actions:
 * - ready: Find claimable tasks (not blocked, not closed)
 * - show: Get full details of a specific task
 * - list: List tasks by status
 * - search: Search tasks by title (uses FTS)
 */

import { tool } from "ai";
import { z } from "zod";
import { taskStorage } from "./storage";

interface TaskQueryDispatchInput {
  action: "ready" | "show" | "list" | "search";
  id?: string;
  status?: "open" | "in_progress" | "closed";
  query?: string;
  limit?: number;
}

async function executeTaskQueryTool(input: TaskQueryDispatchInput) {
  return executeTaskQuery(input as unknown as Parameters<typeof executeTaskQuery>[0]);
}

export const taskQueryTool = tool({
  description: `Query tasks for work management.

Actions:
- ready: Find claimable tasks (not blocked, not closed)
- show: Get full details of a specific task
- list: List tasks by status
- search: Search tasks by title/description (uses FTS)

Examples:
- Find work: { "action": "ready", "limit": 5 }
- Show task: { "action": "show", "id": "task-123" }
- List closed: { "action": "list", "status": "closed" }
- Search tasks: { "action": "search", query: "login", limit: 3 }`,
  inputSchema: z.object({
    action: z.enum(["ready", "show", "list", "search"]),
    id: z.string().optional(),
    status: z.enum(["open", "in_progress", "closed"]).optional(),
    query: z.string().optional(),
    limit: z.number().default(5),
  }),
  execute: async input => executeTaskQueryTool(input),
});

export async function executeTaskQuery(
  input: { action: "ready" } & { limit?: number }
): Promise<
  | { success: true; tasks: Task[]; readyCount: number; blockedCount: number }
  | { success: false; error: string }
>;
export async function executeTaskQuery(
  input: { action: "show" } & { id: string }
): Promise<
  | { success: true; task: Task | null; isBlocked: boolean; blockingTasks: Task[] }
  | { success: false; error: string }
>;
export async function executeTaskQuery(
  input: { action: "list" } & { status?: "open" | "in_progress" | "closed"; limit?: number }
): Promise<{ success: true; tasks: Task[] } | { success: false; error: string }>;
export async function executeTaskQuery(
  input: { action: "search" } & { query: string; limit?: number }
): Promise<{ success: true; tasks: Task[] } | { success: false; error: string }>;
export async function executeTaskQuery(input: {
  action: string;
  id?: string;
  status?: string;
  query?: string;
  limit?: number;
}): Promise<unknown> {
  try {
    switch (input.action) {
      case "ready": {
        const allOpenTasks = await taskStorage.listTasks({ status: "open" });
        const readyTasks = await taskStorage.getReadyTasks();
        const limit = input.limit ?? 5;
        const limitedTasks = readyTasks.slice(0, limit);

        const blockedCount = allOpenTasks.length - readyTasks.length;

        return {
          success: true,
          tasks: limitedTasks,
          readyCount: readyTasks.length,
          blockedCount,
        };
      }

      case "show": {
        if (!input.id) {
          return { success: false, error: "Task ID is required for 'show' action" };
        }
        const task = await taskStorage.getTask(input.id);
        if (!task) {
          return { success: false, error: `Task not found: ${input.id}` };
        }
        const blockedStatus = await taskStorage.computeBlockedStatus(input.id);
        return {
          success: true,
          task,
          isBlocked: blockedStatus.isBlocked,
          blockingTasks: blockedStatus.blockingTasks,
        };
      }

      case "list": {
        const tasks = await taskStorage.listTasks({
          status: input.status as "open" | "in_progress" | "closed" | undefined,
          limit: input.limit,
        });
        return { success: true, tasks };
      }

      case "search": {
        if (!input.query) {
          return { success: false, error: "Query is required for 'search' action" };
        }
        const tasks = await taskStorage.searchTasks(input.query, input.limit ?? 10);
        return { success: true, tasks };
      }

      default:
        return { success: false, error: `Unknown action: ${input.action}` };
    }
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

type Task = Awaited<ReturnType<typeof taskStorage.getTask>>;
