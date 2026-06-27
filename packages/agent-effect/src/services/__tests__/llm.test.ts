import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import {
  CompletionProvider,
  CompletionProviderLive,
  StreamProvider,
  StreamProviderLive,
} from "../llm.ts";

describe("LLM services", () => {
  it.effect("StreamProvider is accessible via yield* StreamProvider", () =>
    Effect.gen(function* () {
      const provider = yield* StreamProvider;
      expect(typeof provider.stream).toBe("function");
    }).pipe(Effect.provide(StreamProviderLive))
  );

  it.effect(
    "CompletionProvider is accessible via yield* CompletionProvider",
    () =>
      Effect.gen(function* () {
        const provider = yield* CompletionProvider;
        expect(typeof provider.complete).toBe("function");
      }).pipe(Effect.provide(CompletionProviderLive))
  );

  it.effect("StreamProvider.stream returns an Effect (not a Promise)", () =>
    Effect.gen(function* () {
      const provider = yield* StreamProvider;
      const fakeReq = {} as never;
      const result = provider.stream(fakeReq);
      expect(Effect.isEffect(result)).toBe(true);
    }).pipe(Effect.provide(StreamProviderLive))
  );

  it.effect("supports test layers with stub implementations", () =>
    Effect.gen(function* () {
      const provider = yield* StreamProvider;
      const result = yield* provider.stream({} as never);
      expect(result).toBe("stubbed");
    }).pipe(
      Effect.provide(
        Layer.succeed(StreamProvider, {
          stream: () => Effect.succeed("stubbed" as never),
        })
      )
    )
  );
});
