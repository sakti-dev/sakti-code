import { createJsonErrorResponseHandler } from "@ai-sdk/provider-utils";
import { zaiErrorDataSchema } from "./zai-api.ts";

/**
 * Anthropic-style failed-response handler. Z.ai surfaces the same
 * `{type:"error", error:{type, message}}` envelope as Anthropic.
 */
export const zaiFailedResponseHandler = createJsonErrorResponseHandler({
  errorSchema: zaiErrorDataSchema,
  errorToMessage: (data) => data.error.message,
});
