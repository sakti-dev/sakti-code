import { z } from "zod";

export const TaskSessionStatusSchema = z.enum([
  "researching",
  "specifying",
  "implementing",
  "completed",
  "failed",
]);

export const TaskSessionKindSchema = z.enum(["intake", "task"]);

export const TaskSpecTypeSchema = z.enum(["comprehensive", "quick"]).nullable();

export const RuntimeModeSchema = z.enum(["intake", "plan", "build"]).nullable();

export const TaskSessionSchema = z.object({
  taskSessionId: z.string().uuid(),
  resourceId: z.string(),
  threadId: z.string().uuid(),
  workspaceId: z.string().uuid().nullable(),
  title: z.string().nullable(),
  status: TaskSessionStatusSchema,
  specType: TaskSpecTypeSchema,
  sessionKind: TaskSessionKindSchema,
  runtimeMode: RuntimeModeSchema,
  createdAt: z.string().datetime(),
  lastAccessed: z.string().datetime(),
  lastActivityAt: z.string().datetime(),
});

export const CreateTaskSessionSchema = z.object({
  resourceId: z.string().min(1, "resourceId is required"),
  workspaceId: z.string().uuid().optional(),
  sessionKind: TaskSessionKindSchema.optional().default("task"),
});

export const UpdateTaskSessionSchema = z.object({
  status: TaskSessionStatusSchema.optional(),
  specType: TaskSpecTypeSchema.optional(),
  title: z.string().optional(),
});

export const ListTaskSessionsQuerySchema = z.object({
  workspaceId: z.string().uuid().optional(),
  kind: TaskSessionKindSchema.optional(),
});

export const TaskSessionParamsSchema = z.object({
  taskSessionId: z.string().min(1),
});
