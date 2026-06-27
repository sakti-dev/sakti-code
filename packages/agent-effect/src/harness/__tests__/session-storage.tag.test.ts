import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { type SessionMetadata, SessionStorage } from "../types.ts";

describe("SessionStorage (Context.Service)", () => {
  it.effect("is accessible via yield* SessionStorage", () =>
    Effect.gen(function* () {
      const storage = yield* SessionStorage;
      const id = yield* storage.createEntryId();
      expect(typeof id).toBe("string");
    }).pipe(
      Effect.provide(
        Layer.succeed(SessionStorage, {
          createEntryId: () => Effect.succeed("test-id"),
          getLeafId: () => Effect.succeed(null),
          setLeafId: () => Effect.void,
          appendEntry: () => Effect.void,
          getEntry: () => Effect.succeed(undefined),
          getEntries: () => Effect.succeed([]),
          getPathToRoot: () => Effect.succeed([]),
          getLabel: () => Effect.succeed(undefined),
          findEntries: () => Effect.succeed([]),
          getMetadata: () => Effect.succeed({} as SessionMetadata),
        })
      )
    )
  );
});
