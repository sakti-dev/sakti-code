import {
  type CompleteRequest,
  type CompleteResult,
  completeEffect,
  type LLMError,
  type StreamRequest,
  type StreamResult,
  streamEffect,
} from "@sakti-code/llm";
import { Context, type Effect, Layer } from "effect";

/**
 * Shape for the streaming LLM provider. Each call returns an Effect that
 * streams tokens + resolves a final result. Errors are typed as
 * {@link LLMError} (catchable via `Effect.catchTag("LLMError", ...)`).
 */
export interface StreamProviderShape {
  readonly stream: (
    req: StreamRequest
  ) => Effect.Effect<StreamResult, LLMError>;
}

/**
 * Shape for the one-shot completion provider. Used by compaction and other
 * non-streaming completions.
 */
export interface CompletionProviderShape {
  readonly complete: (
    req: CompleteRequest
  ) => Effect.Effect<CompleteResult, LLMError>;
}

/**
 * Service Tag for the streaming provider. Consumers require it via
 * `yield* StreamProvider` and call `.stream(req)`.
 */
export class StreamProvider extends Context.Service<
  StreamProvider,
  StreamProviderShape
>()("@sakti-code/agent/StreamProvider") {}

/**
 * Service Tag for the completion provider. Consumers require it via
 * `yield* CompletionProvider` and call `.complete(req)`.
 */
export class CompletionProvider extends Context.Service<
  CompletionProvider,
  CompletionProviderShape
>()("@sakti-code/agent/CompletionProvider") {}

/**
 * Live Layer backed by `@sakti-code/llm`'s `streamEffect`. Provides
 * {@link StreamProvider} to any Effect that requires it.
 */
export const StreamProviderLive = Layer.succeed(StreamProvider, {
  stream: (req) => streamEffect(req),
});

/**
 * Live Layer backed by `@sakti-code/llm`'s `completeEffect`. Provides
 * {@link CompletionProvider} to any Effect that requires it.
 */
export const CompletionProviderLive = Layer.succeed(CompletionProvider, {
  complete: (req) => completeEffect(req),
});
