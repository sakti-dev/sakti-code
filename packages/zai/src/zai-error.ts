import { createJsonErrorResponseHandler } from "@ai-sdk/provider-utils";
import { z } from "zod";

export const zaiErrorDataSchema = z.object({
  error: z.object({
    message: z.string(),
    code: z.union([z.string(), z.number()]).nullish(),
    type: z.string().nullish(),
    param: z.unknown().nullish(),
  }),
});

export type ZaiErrorData = z.infer<typeof zaiErrorDataSchema>;

export const zaiFailedResponseHandler = createJsonErrorResponseHandler({
  errorSchema: zaiErrorDataSchema,
  errorToMessage: data => data.error.message,
});
