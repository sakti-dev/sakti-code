import { zValidator as baseZValidator } from "@hono/zod-validator";
import type { ValidationTargets } from "hono";
import { HTTPException } from "hono/http-exception";
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
  baseZValidator(target, schema, (result, _c) => {
    if (!result.success) {
      throw new HTTPException(400, { cause: result.error });
    }
  });
