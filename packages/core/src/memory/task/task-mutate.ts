/**
 * task-mutate tool
 *
 * Modify tasks, link messages, and update context.
 *
 * Actions:
 * - create: Create a new task
 * - claim: Take ownership of a task to work on it
 * - close: Mark task as completed (ALWAYS provide summary)
 * - dep: Add/remove task dependencies
 * - link: Connect a message to a task (relationType: 'output' for generated content, 'reference' for context)
 * - update_context: Update working memory (project context, tech stack, preferences)
 */

import { getDb, taskMessages, threads } from "@ekacode/server/db";
import { tool } from "ai";
import { eq, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { Instance } from "../../instance";
import { workingMemoryStorage } from "../working-memory/storage";
import { taskStorage } from "./storage";

interface TaskMutateDispatchInput {
  action: "create" | "claim" | "close" | "dep" | "link" | "update_context";
  id?: string;
  title?: string;
  description?: string;
  reason?: "completed" | "wontfix" | "duplicate";
  summary?: string;
  taskId?: string;
  dependsOn?: string;
  messageId?: string;
  relationType?: "output" | "reference";
  content?: string;
  scope?: "resource" | "thread";
  resourceId?: string;
  threadId?: string;
  sessionId?: string;
  add?: boolean;
}

async function executeTaskMutateTool(input: TaskMutateDispatchInput) {
  return executeTaskMutate(input as unknown as Parameters<typeof executeTaskMutate>[0]);
}

export const taskMutateTool = tool({
  description: `Modify tasks, link messages, and update working memory.

Actions:
- create: Create a new task
- claim: Take ownership of a task to work on it
- close: Mark task as completed (ALWAYS provide summary)
- dep: Add/remove task dependencies
- link: Connect a message to a task (relationType: 'output' | 'reference')
- update_context: Update working memory (project context, tech stack, preferences)

Examples:
- Create task: { "action": "create", "title": "Fix auth bug" }
- Claim task: { "action": "claim", "id": "task-1", "threadId": "thread-123" }
- Close with summary: { "action": "close", "id": "task-1", reason: "completed", summary: "Added JWT auth" }
- Add dependency: { "action": "dep", taskId: "task-2", dependsOn: "task-1" }
- Link message: { "action": "link", taskId: "task-1", messageId: "msg-123" }
- Link as reference: { "action": "link", taskId: "task-1", messageId: "msg-123", relationType: "reference" }
- Update context: { "action": "update_context", content: "## Tech Stack\\n- Testing: Vitest", scope: "resource" }`,
  inputSchema: z.object({
    action: z.enum(["create", "claim", "close", "dep", "link", "update_context"]),
    id: z.string().optional(),
    title: z.string().optional(),
    description: z.string().optional(),
    reason: z.enum(["completed", "wontfix", "duplicate"]).optional(),
    summary: z.string().optional(),
    taskId: z.string().optional(),
    dependsOn: z.string().optional(),
    messageId: z.string().optional(),
    relationType: z.enum(["output", "reference"]).default("output"),
    content: z.string().optional(),
    scope: z.enum(["resource", "thread"]).default("resource"),
    resourceId: z.string().optional(),
    threadId: z.string().optional(),
    sessionId: z.string().optional(),
    add: z.boolean().default(true),
  }),
  execute: async input => executeTaskMutateTool(input),
});

export async function executeTaskMutate(input: {
  action: "create";
  title: string;
  description?: string;
}): Promise<{ success: true; task: Task } | { success: false; error: string }>;
export async function executeTaskMutate(input: {
  action: "claim";
  id: string;
  threadId?: string;
  sessionId?: string;
}): Promise<{ success: true; task: Task } | { success: false; error: string }>;
export async function executeTaskMutate(input: {
  action: "close";
  id: string;
  reason: "completed" | "wontfix" | "duplicate";
  summary: string;
  threadId?: string;
}): Promise<{ success: true; task: Task } | { success: false; error: string }>;
export async function executeTaskMutate(input: {
  action: "dep";
  taskId: string;
  dependsOn: string;
  add?: boolean;
}): Promise<{ success: true } | { success: false; error: string }>;
export async function executeTaskMutate(input: {
  action: "link";
  taskId: string;
  messageId: string;
  relationType?: "output" | "reference";
}): Promise<{ success: true } | { success: false; error: string }>;
export async function executeTaskMutate(input: {
  action: "update_context";
  content: string;
  scope?: "resource" | "thread";
  resourceId?: string;
  threadId?: string;
}): Promise<{ success: true } | { success: false; error: string }>;
export async function executeTaskMutate(input: {
  action: string;
  id?: string;
  title?: string;
  description?: string;
  reason?: string;
  summary?: string;
  taskId?: string;
  dependsOn?: string;
  messageId?: string;
  relationType?: "output" | "reference";
  content?: string;
  scope?: "resource" | "thread";
  resourceId?: string;
  threadId?: string;
  sessionId?: string;
  add?: boolean;
}): Promise<unknown> {
  try {
    const now = Date.now();

    switch (input.action) {
      case "create": {
        if (!input.title) {
          return { success: false, error: "Title is required for 'create' action" };
        }
        const taskId = uuidv7();
        const task = await taskStorage.createTask({
          id: taskId,
          title: input.title,
          description: input.description,
          createdAt: now,
          updatedAt: now,
        });
        return { success: true, task };
      }

      case "claim": {
        if (!input.id) {
          return { success: false, error: "Task ID is required for 'claim' action" };
        }
        const task = await taskStorage.getTask(input.id);
        if (!task) {
          return { success: false, error: `Task not found: ${input.id}` };
        }
        if (task.status === "closed") {
          return { success: false, error: "Cannot claim a closed task" };
        }
        const blockedStatus = await taskStorage.computeBlockedStatus(input.id);
        if (blockedStatus.isBlocked) {
          return { success: false, error: "Task is blocked by open dependencies" };
        }

        // Update task status and session
        const updated = await taskStorage.updateTask(input.id, {
          status: "in_progress",
          sessionId: input.sessionId,
          updatedAt: now,
        });

        // Store activeTaskId in thread metadata for auto-linking
        if (input.threadId) {
          const db = await getDb();
          const thread = await db
            .select()
            .from(threads)
            .where(eq(threads.id, input.threadId))
            .get();
          if (thread) {
            await db
              .update(threads)
              .set({
                metadata: {
                  ...thread.metadata,
                  activeTaskId: input.id,
                },
                updated_at: new Date(now),
              })
              .where(eq(threads.id, input.threadId));
          }
        }

        return { success: true, task: updated };
      }

      case "close": {
        if (!input.id) {
          return { success: false, error: "Task ID is required for 'close' action" };
        }
        if (!input.reason) {
          return { success: false, error: "Close reason is required for 'close' action" };
        }
        if (!input.summary) {
          return { success: false, error: "Summary is required for 'close' action" };
        }
        const task = await taskStorage.getTask(input.id);
        if (!task) {
          return { success: false, error: `Task not found: ${input.id}` };
        }

        const updated = await taskStorage.updateTask(input.id, {
          status: "closed",
          closeReason: input.reason,
          summary: input.summary,
          closedAt: now,
          updatedAt: now,
        });

        const db = await getDb();

        if (input.threadId) {
          const thread = await db
            .select()
            .from(threads)
            .where(eq(threads.id, input.threadId))
            .get();
          if (thread && thread.metadata?.activeTaskId === input.id) {
            const { activeTaskId: _, ...restMetadata } = thread.metadata as Record<string, unknown>;
            await db
              .update(threads)
              .set({
                metadata: restMetadata,
                updated_at: new Date(now),
              })
              .where(eq(threads.id, input.threadId));
          }
        } else {
          const threadsWithActiveTask = await db
            .select()
            .from(threads)
            .where(sql`json_extract(metadata, '$.activeTaskId') = ${input.id}`)
            .all();

          for (const thread of threadsWithActiveTask) {
            const { activeTaskId: _, ...restMetadata } = thread.metadata as Record<string, unknown>;
            await db
              .update(threads)
              .set({
                metadata: restMetadata,
                updated_at: new Date(now),
              })
              .where(eq(threads.id, thread.id));
          }
        }

        return { success: true, task: updated };
      }

      case "dep": {
        if (!input.taskId || !input.dependsOn) {
          return { success: false, error: "taskId and dependsOn are required for 'dep' action" };
        }
        const task = await taskStorage.getTask(input.taskId);
        if (!task) {
          return { success: false, error: `Task not found: ${input.taskId}` };
        }
        const dependsOnTask = await taskStorage.getTask(input.dependsOn);
        if (!dependsOnTask) {
          return { success: false, error: `Dependency task not found: ${input.dependsOn}` };
        }
        if (input.add ?? true) {
          await taskStorage.addDependency({
            taskId: input.taskId,
            dependsOnId: input.dependsOn,
            type: "blocks",
            createdAt: now,
          });
        } else {
          await taskStorage.removeDependency(input.taskId, input.dependsOn, "blocks");
        }
        return { success: true };
      }

      case "link": {
        if (!input.taskId || !input.messageId) {
          return { success: false, error: "taskId and messageId are required for 'link' action" };
        }

        // Verify task exists
        const task = await taskStorage.getTask(input.taskId);
        if (!task) {
          return { success: false, error: `Task not found: ${input.taskId}` };
        }

        // Insert into task_messages junction table
        const db = await getDb();
        await db.insert(taskMessages).values({
          task_id: input.taskId,
          message_id: input.messageId,
          relation_type: input.relationType ?? "output",
          created_at: new Date(now),
        });

        return { success: true };
      }

      case "update_context": {
        if (!input.content) {
          return { success: false, error: "content is required for 'update_context' action" };
        }

        const scope = input.scope ?? "resource";
        const contextThreadId =
          Instance.inContext && Instance.context.sessionID ? Instance.context.sessionID : undefined;
        const memoryResourceId =
          scope === "thread" ? (input.threadId ?? contextThreadId) : (input.resourceId ?? "local");

        if (!memoryResourceId) {
          return {
            success: false,
            error:
              "Unable to resolve memory target for update_context. Provide threadId for thread scope.",
          };
        }

        await workingMemoryStorage.upsertWorkingMemory(
          memoryResourceId,
          {
            resourceId: memoryResourceId,
            scope,
            content: input.content,
          },
          scope
        );

        return { success: true };
      }

      default:
        return { success: false, error: `Unknown action: ${input.action}` };
    }
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

type Task = Awaited<ReturnType<typeof taskStorage.getTask>>;
