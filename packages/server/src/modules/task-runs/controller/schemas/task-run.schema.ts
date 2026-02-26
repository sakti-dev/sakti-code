import { z } from "zod";

export const TaskRunRuntimeModeSchema = z.enum(["intake", "plan", "build"]);

export const TaskRunStateSchema = z.enum([
  "queued",
  "running",
  "cancel_requested",
  "completed",
  "failed",
  "canceled",
  "stale",
  "dead",
]);

export const CreateTaskRunSchema = z.object({
  runtimeMode: TaskRunRuntimeModeSchema,
  input: z.record(z.string(), z.unknown()).optional(),
  clientRequestKey: z.string().min(1).max(256).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  maxAttempts: z.number().int().min(1).max(20).optional(),
});

export const TaskRunParamsSchema = z.object({
  runId: z.string().uuid(),
});

export const TaskSessionTaskRunsParamsSchema = z.object({
  taskSessionId: z.string().uuid(),
});

export const TaskRunEventSchema = z.object({
  eventId: z.string().uuid(),
  runId: z.string().uuid(),
  taskSessionId: z.string().uuid(),
  eventSeq: z.number().int(),
  eventType: z.string(),
  dedupeKey: z.string().nullable(),
  payload: z.record(z.string(), z.unknown()),
  createdAt: z.string().datetime(),
});

export const migrationCheckpoint = {
  task: "Create task-run schemas",
  status: "implemented-minimally",
} as const;
