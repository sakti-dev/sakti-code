import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { SessionError } from "../../session/entries";

describe("SessionError (Schema.TaggedErrorClass)", () => {
  it("has _tag = 'SessionError' and typed fields", () => {
    const error = new SessionError({
      code: "not_found",
      message: "missing entry",
    });
    expect(error._tag).toBe("SessionError");
    expect(error.code).toBe("not_found");
    expect(error.message).toBe("missing entry");
  });

  it("is still instanceof Error", () => {
    const error = new SessionError({ code: "storage", message: "disk full" });
    expect(error).toBeInstanceOf(Error);
  });

  it("supports optional cause", () => {
    const underlying = new Error("disk I/O");
    const error = new SessionError({
      code: "storage",
      message: "write failed",
      cause: underlying,
    });
    expect(error.cause).toBe(underlying);
  });

  it.effect("recovers via Effect.catchTag", () =>
    Effect.gen(function* () {
      const result = yield* Effect.fail(
        new SessionError({ code: "not_found", message: "x" })
      ).pipe(
        Effect.catchTag("SessionError", (e) =>
          Effect.succeed(`recovered: ${e.code}`)
        )
      );
      expect(result).toBe("recovered: not_found");
    })
  );

  it.effect(
    "flips to error channel via Effect.flip (v4 way to assert errors)",
    () =>
      Effect.gen(function* () {
        const error = yield* Effect.flip(
          Effect.fail(new SessionError({ code: "storage", message: "flipped" }))
        );
        expect(error).toBeInstanceOf(SessionError);
        expect(error._tag).toBe("SessionError");
        expect(error.code).toBe("storage");
      })
  );

  it.effect("is yieldable — return yield* new SessionError({...})", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        Effect.gen(function* () {
          return yield* new SessionError({ code: "not_found", message: "z" });
        })
      );
      expect(error).toBeInstanceOf(SessionError);
      expect(error.code).toBe("not_found");
    })
  );
});
