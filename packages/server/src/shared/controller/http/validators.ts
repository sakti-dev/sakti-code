import { zValidator as baseZValidator } from "@hono/zod-validator";
import type { ValidationTargets } from "hono";
import { z } from "zod";

export const paginationSchema = z.object({
  limit: z.coerce.number().int().positive().max(1000).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});

export type PaginationInput = z.infer<typeof paginationSchema>;

export const uuidSchema = z.string().uuid();

export const uuidParamSchema = z.object({
  id: uuidSchema,
});

export type UuidParamInput = z.infer<typeof uuidParamSchema>;

export const zValidator = <TSchema extends z.ZodSchema, TTarget extends keyof ValidationTargets>(
  target: TTarget,
  schema: TSchema
) =>
  baseZValidator(target, schema, (result, c) => {
    if (!result.success) {
      const firstIssue = result.error.issues[0];
      const firstPathSegment =
        typeof firstIssue?.path?.[0] === "string" ? firstIssue.path[0] : undefined;

      let message = "Invalid request";
      if (firstPathSegment === "limit" || firstPathSegment === "offset") {
        message = `invalid ${firstPathSegment} parameter`;
      } else if (firstPathSegment) {
        message = `Invalid ${firstPathSegment}`;
      }

      return c.json(
        {
          error: message,
          issues: result.error.issues,
        },
        400
      );
    }
  });
