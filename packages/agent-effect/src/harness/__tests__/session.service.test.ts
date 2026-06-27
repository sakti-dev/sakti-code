import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { InMemorySessionStorageLive } from "../memory-storage.ts";
import { Session, SessionLive, type SessionShape } from "../session.ts";
import {
  createAssistantMessage,
  createUserMessage,
} from "./session-test-utils.ts";

describe("Session (Context.Service)", () => {
  const TestSessionLayer = SessionLive.pipe(
    Layer.provide(InMemorySessionStorageLive())
  );

  it.effect("is accessible via yield* Session", () =>
    Effect.gen(function* () {
      const session = yield* Session;
      const metadata = yield* session.getMetadata();
      expect(typeof metadata.id).toBe("string");
    }).pipe(Effect.provide(TestSessionLayer))
  );

  it.effect("appends a message and updates leaf", () =>
    Effect.gen(function* () {
      const session = yield* Session;
      yield* session.appendMessage(createUserMessage("hello"));
      const leaf = yield* session.getLeafId();
      expect(leaf).not.toBeNull();
    }).pipe(Effect.provide(TestSessionLayer))
  );

  it.effect("reads messages back via getBranch", () =>
    Effect.gen(function* () {
      const session = yield* Session;
      yield* session.appendMessage(createUserMessage("first"));
      yield* session.appendMessage(createAssistantMessage("second"));
      const branch = yield* session.getBranch();
      expect(branch.length).toBeGreaterThanOrEqual(2);
    }).pipe(Effect.provide(TestSessionLayer))
  );

  it.effect("builds context from current branch", () =>
    Effect.gen(function* () {
      const session = yield* Session;
      yield* session.appendMessage(createUserMessage("hello"));
      const ctx = yield* session.buildContext();
      expect(ctx.messages.length).toBeGreaterThanOrEqual(1);
    }).pipe(Effect.provide(TestSessionLayer))
  );

  it.effect("supports moveTo with branch summary", () =>
    Effect.gen(function* () {
      const session = yield* Session;
      const first = yield* session.appendMessage(createUserMessage("first"));
      yield* session.appendMessage(createAssistantMessage("second"));
      const summaryId = yield* session.moveTo(first, {
        summary: "branched here",
      });
      expect(summaryId).toBeDefined();
    }).pipe(Effect.provide(TestSessionLayer))
  );

  it("satisfies SessionShape interface", () => {
    const check = (s: SessionShape): SessionShape => s;
    expect(typeof check).toBe("function");
  });
});
