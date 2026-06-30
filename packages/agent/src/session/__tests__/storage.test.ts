import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { SessionStorage } from "../../harness-types";
import {
  createAssistantMessage,
  createUserMessage,
} from "../../session/__tests__/session-test-utils";
import { InMemorySessionStorageLive } from "../../session/storage";

describe("InMemorySessionStorage", () => {
  it.effect("returns configured session metadata", () =>
    Effect.gen(function* () {
      const storage = yield* SessionStorage;
      const metadata = yield* storage.getMetadata();
      expect(metadata).toEqual({
        id: "session-1",
        createdAt: "2026-01-01T00:00:00.000Z",
      });
    }).pipe(
      Effect.provide(
        InMemorySessionStorageLive({
          metadata: {
            id: "session-1",
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        }),
      ),
    ),
  );

  it.effect("copies initial entries and persists leaf changes", () =>
    Effect.gen(function* () {
      const storage = yield* SessionStorage;
      const entries = yield* storage.getEntries();
      expect(entries.map((e) => e.id)).toEqual(["entry-1"]);
      const leafId = yield* storage.getLeafId();
      expect(leafId).toBe("entry-1");
      yield* storage.setLeafId(null);
      const newLeaf = yield* storage.getLeafId();
      expect(newLeaf).toBeNull();
      const allEntries = yield* storage.getEntries();
      expect(allEntries.at(-1)).toMatchObject({
        type: "leaf",
        targetId: null,
      });
    }).pipe(
      Effect.provide(
        InMemorySessionStorageLive({
          entries: [
            {
              type: "message",
              id: "entry-1",
              parentId: null,
              timestamp: "2026-01-01T00:00:00.000Z",
              message: createUserMessage("one"),
            },
          ],
        }),
      ),
    ),
  );

  it.effect("rejects invalid leaf ids", () =>
    Effect.gen(function* () {
      const storage = yield* SessionStorage;
      const error = yield* Effect.flip(storage.setLeafId("missing"));
      expect(error._tag).toBe("SessionError");
      expect(error.code).toBe("not_found");
    }).pipe(Effect.provide(InMemorySessionStorageLive())),
  );

  it.effect("finds entries by type", () =>
    Effect.gen(function* () {
      const storage = yield* SessionStorage;
      const messages = yield* storage.findEntries("message");
      expect(messages.map((m) => m.id)).toEqual(["entry-1"]);
      const infos = yield* storage.findEntries("session_info");
      expect(infos).toEqual([]);
    }).pipe(
      Effect.provide(
        InMemorySessionStorageLive({
          entries: [
            {
              type: "message",
              id: "entry-1",
              parentId: null,
              timestamp: "2026-01-01T00:00:00.000Z",
              message: createUserMessage("one"),
            },
          ],
        }),
      ),
    ),
  );

  it.effect("maintains label lookup", () =>
    Effect.gen(function* () {
      const storage = yield* SessionStorage;
      const before = yield* storage.getLabel("entry-1");
      expect(before).toBeUndefined();
      yield* storage.appendEntry({
        type: "label",
        id: "label-1",
        parentId: "entry-1",
        timestamp: "2026-01-01T00:00:01.000Z",
        targetId: "entry-1",
        label: "checkpoint",
      });
      const set = yield* storage.getLabel("entry-1");
      expect(set).toBe("checkpoint");
      yield* storage.appendEntry({
        type: "label",
        id: "label-2",
        parentId: "label-1",
        timestamp: "2026-01-01T00:00:02.000Z",
        targetId: "entry-1",
        label: undefined,
      });
      const cleared = yield* storage.getLabel("entry-1");
      expect(cleared).toBeUndefined();
    }).pipe(
      Effect.provide(
        InMemorySessionStorageLive({
          entries: [
            {
              type: "message",
              id: "entry-1",
              parentId: null,
              timestamp: "2026-01-01T00:00:00.000Z",
              message: createUserMessage("one"),
            },
          ],
        }),
      ),
    ),
  );

  it.effect("walks paths to root", () =>
    Effect.gen(function* () {
      const storage = yield* SessionStorage;
      const path = yield* storage.getPathToRoot("child");
      expect(path.map((e) => e.id)).toEqual(["root", "child"]);
      const empty = yield* storage.getPathToRoot(null);
      expect(empty).toEqual([]);
    }).pipe(
      Effect.provide(
        InMemorySessionStorageLive({
          entries: [
            {
              type: "message",
              id: "root",
              parentId: null,
              timestamp: "2026-01-01T00:00:00.000Z",
              message: createUserMessage("root"),
            },
            {
              type: "message",
              id: "child",
              parentId: "root",
              timestamp: "2026-01-01T00:00:00.000Z",
              message: createAssistantMessage("child"),
            },
          ],
        }),
      ),
    ),
  );
});
