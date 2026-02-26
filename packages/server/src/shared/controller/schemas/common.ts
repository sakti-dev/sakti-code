import { z } from "zod";

export const errorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string(),
    details: z.unknown().optional(),
  }),
});

export type ErrorResponseSchema = z.infer<typeof errorResponseSchema>;

export const healthResponseSchema = z.object({
  status: z.enum(["ok", "degraded", "down"]),
  uptime: z.number(),
  timestamp: z.string(),
  version: z.string(),
});

export type HealthResponseSchema = z.infer<typeof healthResponseSchema>;
