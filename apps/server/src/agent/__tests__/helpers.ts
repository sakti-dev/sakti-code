import type { SessionStorageShape } from "@sakti-code/agent";
import { Effect } from "effect";
import { vi } from "vite-plus/test";

/** Real model id that exists in pi-ai's registry so `getModel("openai", id)` resolves. */
const TEST_MODEL_ID = "gpt-4";

function sync<T>(value: T): Effect.Effect<T, never> {
  return Effect.succeed(value);
}

export function createMockStore(): SessionStorageShape {
  return {
    appendEntry: () => sync(undefined),
    createEntryId: () => sync("entry-1"),
    findEntries: (() => sync([])) as SessionStorageShape["findEntries"],
    getEntries: () => sync([]),
    getEntry: () => sync(undefined),
    getLabel: () => sync(undefined),
    getLeafId: () => sync(null),
    getMetadata: () =>
      sync({
        id: "mock",
        projectId: "proj-1",
        modelId: TEST_MODEL_ID,
        title: null,
        thinkingLevel: "off",
        createdAt: new Date(0).toISOString(),
        updatedAt: 0,
      }),
    getPathToRoot: () => sync([]),
    setLeafId: () => sync(undefined),
  };
}

export function createMockCtx(overrides?: {
  projectId?: string;
  profileId?: string | null;
}) {
  const projectId = overrides?.projectId ?? "proj-1";
  return {
    auth: {
      getApiKey: vi.fn(() => "test-key-1234567890"),
      set: vi.fn(() => true),
      delete: vi.fn(() => true),
      list: vi.fn(() => []),
    },
    profiles: {
      read: vi.fn(() => ({
        defaultProfile: "default",
        profiles: {
          default: {
            name: "Default",
            models: {
              default: {
                provider: "openai",
                model: TEST_MODEL_ID,
                thinkingLevel: "off",
              },
            },
          },
        },
      })),
      getMtimeMs: vi.fn(() => 1000),
    },
    repos: {
      sessions: {
        findById: vi.fn((id: string) =>
          id === "sess-1"
            ? {
                id: "sess-1",
                projectId,
                profileId: overrides?.profileId ?? null,
                modelId: null,
                title: null,
                thinkingLevel: "off",
                kind: "task",
                createdAt: Date.now(),
                updatedAt: Date.now(),
              }
            : null
        ),
      },
      projects: {
        findById: vi.fn((id: string) =>
          id === projectId
            ? {
                id: projectId,
                name: "test-project",
                cwd: "/tmp/test",
                createdAt: Date.now(),
                updatedAt: Date.now(),
              }
            : null
        ),
      },
      settings: {
        get: vi.fn(() => null),
        getByPrefix: vi.fn(() => []),
        set: vi.fn(async () => {}),
        delete: vi.fn(async () => {}),
        getAll: vi.fn(() => []),
      },
      turns: {
        create: vi.fn((sessionId: string, startedAt: number) => ({
          id: "turn-1",
          sessionId,
          sequence: 0,
          startedAt,
          endedAt: null,
          createdAt: Date.now(),
        })),
        finalize: vi.fn(),
        finalizeLatest: vi.fn(),
        listBySession: vi.fn(() => []),
        copyForFork: vi.fn(),
      },
    },
  } as any;
}

export function createMultiSessionCtx(
  sessionIdToProjectId: Record<string, string>
) {
  const projects: Record<
    string,
    {
      id: string;
      name: string;
      cwd: string;
      createdAt: number;
      updatedAt: number;
    }
  > = {};
  for (const pid of Object.values(sessionIdToProjectId)) {
    if (!projects[pid]) {
      projects[pid] = {
        id: pid,
        name: `project-${pid}`,
        cwd: pid === "proj-1" ? "/tmp/project-a" : "/tmp/project-b",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
    }
  }

  return {
    auth: {
      getApiKey: vi.fn(() => "test-key-1234567890"),
      set: vi.fn(() => true),
      delete: vi.fn(() => true),
      list: vi.fn(() => []),
    },
    db: {},
    profiles: {
      read: vi.fn(() => ({
        defaultProfile: "default",
        profiles: {
          default: {
            name: "Default",
            models: {
              default: {
                provider: "openai",
                model: TEST_MODEL_ID,
                thinkingLevel: "off",
              },
            },
          },
        },
      })),
      getMtimeMs: vi.fn(() => 1000),
    },
    repos: {
      sessions: {
        findById: vi.fn((id: string) =>
          sessionIdToProjectId[id]
            ? {
                id,
                projectId: sessionIdToProjectId[id],
                profileId: null,
                modelId: null,
                title: null,
                thinkingLevel: "off",
                kind: "task",
                createdAt: Date.now(),
                updatedAt: Date.now(),
              }
            : null
        ),
      },
      projects: {
        findById: vi.fn((id: string) => projects[id] ?? null),
      },
      settings: {
        get: vi.fn(() => null),
        getByPrefix: vi.fn(() => []),
        set: vi.fn(async () => {}),
        delete: vi.fn(async () => {}),
        getAll: vi.fn(() => []),
      },
      turns: {
        create: vi.fn((sessionId: string, startedAt: number) => ({
          id: "turn-1",
          sessionId,
          sequence: 0,
          startedAt,
          endedAt: null,
          createdAt: Date.now(),
        })),
        finalize: vi.fn(),
        finalizeLatest: vi.fn(),
        listBySession: vi.fn(() => []),
        copyForFork: vi.fn(),
      },
    },
  } as any;
}
