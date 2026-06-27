import { Effect, Schema } from "effect";
import type { CompleteRequest, CompleteResult } from "./complete.ts";
import { complete } from "./complete.ts";
import type { StreamRequest, StreamResult } from "./stream.ts";
import { stream } from "./stream.ts";

/**
 * Effect-native LLM error. Wraps any failure from the underlying provider
 * (network, auth, abort, provider-side error). Catchable via
 * `Effect.catchTag("LLMError", ...)`.
 */
export class LLMError extends Schema.TaggedErrorClass<LLMError>()("LLMError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

/**
 * Effect-native variant of {@link stream}.
 * Wraps the Promise-based stream in `Effect.tryPromise`, mapping any
 * rejection to {@link LLMError}.
 */
export const streamEffect = (
  req: StreamRequest
): Effect.Effect<StreamResult, LLMError, never> =>
  Effect.tryPromise({
    try: () => stream(req),
    catch: (e) =>
      new LLMError({
        message: "stream failed",
        ...(e === undefined ? {} : { cause: e }),
      }),
  });

/**
 * Effect-native variant of {@link complete}.
 * Wraps the Promise-based complete in `Effect.tryPromise`, mapping any
 * rejection to {@link LLMError}.
 */
export const completeEffect = (
  req: CompleteRequest
): Effect.Effect<CompleteResult, LLMError, never> =>
  Effect.tryPromise({
    try: () => complete(req),
    catch: (e) =>
      new LLMError({
        message: "complete failed",
        ...(e === undefined ? {} : { cause: e }),
      }),
  });
