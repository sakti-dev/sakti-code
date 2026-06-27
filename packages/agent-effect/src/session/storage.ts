import { Context, Effect, Layer, Ref } from "effect";
import { v7 as uuidv7 } from "uuid";
import type {
  LeafEntry,
  SessionMetadata,
  SessionTreeEntry,
} from "./entries.ts";
import { SessionError } from "./entries.ts";

export interface SessionStorageShape {
  readonly appendEntry: (
    entry: SessionTreeEntry
  ) => Effect.Effect<void, SessionError>;
  readonly createEntryId: () => Effect.Effect<string, SessionError>;
  readonly findEntries: <TType extends SessionTreeEntry["type"]>(
    type: TType
  ) => Effect.Effect<
    Array<Extract<SessionTreeEntry, { type: TType }>>,
    SessionError
  >;
  readonly getEntries: () => Effect.Effect<SessionTreeEntry[], SessionError>;
  readonly getEntry: (
    id: string
  ) => Effect.Effect<SessionTreeEntry | undefined, SessionError>;
  readonly getLabel: (
    id: string
  ) => Effect.Effect<string | undefined, SessionError>;
  readonly getLeafId: () => Effect.Effect<string | null, SessionError>;
  readonly getMetadata: () => Effect.Effect<SessionMetadata, SessionError>;
  readonly getPathToRoot: (
    leafId: string | null
  ) => Effect.Effect<SessionTreeEntry[], SessionError>;
  readonly setLeafId: (
    leafId: string | null
  ) => Effect.Effect<void, SessionError>;
}

export interface PromiseSessionStorage<
  TMetadata extends SessionMetadata = SessionMetadata,
> {
  appendEntry(entry: SessionTreeEntry): Promise<void>;
  createEntryId(): Promise<string>;
  findEntries<TType extends SessionTreeEntry["type"]>(
    type: TType
  ): Promise<Array<Extract<SessionTreeEntry, { type: TType }>>>;
  getEntries(): Promise<SessionTreeEntry[]>;
  getEntry(id: string): Promise<SessionTreeEntry | undefined>;
  getLabel(id: string): Promise<string | undefined>;
  getLeafId(): Promise<string | null>;
  getMetadata(): Promise<TMetadata>;
  getPathToRoot(leafId: string | null): Promise<SessionTreeEntry[]>;
  setLeafId(leafId: string | null): Promise<void>;
}

export class SessionStorage extends Context.Service<
  SessionStorage,
  SessionStorageShape
>()("@sakti-code/agent-effect/SessionStorage") {}

interface InMemoryState {
  byId: Map<string, SessionTreeEntry>;
  entries: SessionTreeEntry[];
  labelsById: Map<string, string>;
  leafId: string | null;
  metadata: SessionMetadata;
}

function updateLabelCache(
  labelsById: Map<string, string>,
  entry: SessionTreeEntry
): void {
  if (entry.type !== "label") {
    return;
  }
  const label = entry.label?.trim();
  if (label) {
    labelsById.set(entry.targetId, label);
  } else {
    labelsById.delete(entry.targetId);
  }
}

function buildLabelsById(entries: SessionTreeEntry[]): Map<string, string> {
  const labelsById = new Map<string, string>();
  for (const entry of entries) {
    updateLabelCache(labelsById, entry);
  }
  return labelsById;
}

function generateEntryId(byId: { has(id: string): boolean }): string {
  for (let i = 0; i < 100; i++) {
    const id = uuidv7().slice(0, 8);
    if (!byId.has(id)) {
      return id;
    }
  }
  return uuidv7();
}

function leafIdAfterEntry(entry: SessionTreeEntry): string | null {
  return entry.type === "leaf" ? entry.targetId : entry.id;
}

function computeInitialState(options?: {
  entries?: SessionTreeEntry[];
  metadata?: SessionMetadata;
}): InMemoryState {
  const entries = options?.entries ? [...options.entries] : [];
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const labelsById = buildLabelsById(entries);
  let leafId: string | null = null;
  for (const entry of entries) {
    leafId = leafIdAfterEntry(entry);
  }
  if (leafId !== null && !byId.has(leafId)) {
    throw new SessionError({
      code: "invalid_session",
      message: `Entry ${leafId} not found`,
    });
  }
  const metadata =
    options?.metadata ??
    ({ id: uuidv7(), createdAt: new Date().toISOString() } as SessionMetadata);
  return { entries, byId, labelsById, leafId, metadata };
}

export const InMemorySessionStorageLive = (options?: {
  entries?: SessionTreeEntry[];
  metadata?: SessionMetadata;
}): Layer.Layer<SessionStorage, SessionError, never> =>
  Layer.effect(
    SessionStorage,
    Effect.gen(function* () {
      const initial = computeInitialState(options);
      const stateRef = yield* Ref.make<InMemoryState>(initial);

      const createEntryId = Effect.fnUntraced(function* () {
        const state = yield* Ref.get(stateRef);
        return generateEntryId(state.byId);
      });

      const appendEntry = Effect.fnUntraced(function* (
        entry: SessionTreeEntry
      ) {
        yield* Ref.update(stateRef, (state) => {
          state.entries.push(entry);
          state.byId.set(entry.id, entry);
          updateLabelCache(state.labelsById, entry);
          state.leafId = leafIdAfterEntry(entry);
          return state;
        });
      });

      const getEntry = Effect.fnUntraced(function* (id: string) {
        const state = yield* Ref.get(stateRef);
        return state.byId.get(id);
      });

      const findEntries = Effect.fnUntraced(function* <
        TType extends SessionTreeEntry["type"],
      >(type: TType) {
        const state = yield* Ref.get(stateRef);
        return state.entries.filter(
          (entry): entry is Extract<SessionTreeEntry, { type: TType }> =>
            entry.type === type
        );
      });

      const getLabel = Effect.fnUntraced(function* (id: string) {
        const state = yield* Ref.get(stateRef);
        return state.labelsById.get(id);
      });

      const getMetadata = Effect.fnUntraced(function* () {
        const state = yield* Ref.get(stateRef);
        return state.metadata;
      });

      const getEntries = Effect.fnUntraced(function* () {
        const state = yield* Ref.get(stateRef);
        return [...state.entries];
      });

      const getLeafId = Effect.fnUntraced(function* () {
        const state = yield* Ref.get(stateRef);
        if (state.leafId !== null && !state.byId.has(state.leafId)) {
          return yield* new SessionError({
            code: "invalid_session",
            message: `Entry ${state.leafId} not found`,
          });
        }
        return state.leafId;
      });

      const setLeafId = Effect.fnUntraced(function* (leafId: string | null) {
        const state = yield* Ref.get(stateRef);
        if (leafId !== null && !state.byId.has(leafId)) {
          return yield* new SessionError({
            code: "not_found",
            message: `Entry ${leafId} not found`,
          });
        }
        const entry: LeafEntry = {
          type: "leaf",
          id: generateEntryId(state.byId),
          parentId: state.leafId,
          timestamp: new Date().toISOString(),
          targetId: leafId,
        };
        yield* Ref.update(stateRef, (s) => {
          s.entries.push(entry);
          s.byId.set(entry.id, entry);
          s.leafId = leafId;
          return s;
        });
      });

      const getPathToRoot = Effect.fnUntraced(function* (
        leafId: string | null
      ) {
        if (leafId === null) {
          return [];
        }
        const state = yield* Ref.get(stateRef);
        const path: SessionTreeEntry[] = [];
        let current = state.byId.get(leafId);
        if (!current) {
          return yield* new SessionError({
            code: "not_found",
            message: `Entry ${leafId} not found`,
          });
        }
        while (current) {
          path.unshift(current);
          if (!current.parentId) {
            break;
          }
          const parent = state.byId.get(current.parentId);
          if (!parent) {
            return yield* new SessionError({
              code: "invalid_session",
              message: `Entry ${current.parentId} not found`,
            });
          }
          current = parent;
        }
        return path;
      });

      const shape: SessionStorageShape = {
        appendEntry,
        createEntryId,
        findEntries,
        getEntries,
        getEntry,
        getLabel,
        getLeafId,
        getMetadata,
        getPathToRoot,
        setLeafId,
      };
      return shape;
    })
  );
