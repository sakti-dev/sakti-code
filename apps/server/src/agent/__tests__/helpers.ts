import { vi } from "bun:test";
import type { SessionStorage } from "@sakti-code/agent";

/** Real model id that exists in pi-ai's registry so `getModel("openai", id)` resolves. */
const TEST_MODEL_ID = "gpt-4";

export function createMockStore(): SessionStorage {
  return {
    appendEntry: vi.fn(),
    createEntryId: vi.fn(async () => "entry-1"),
    findEntries: vi.fn(),
    getEntries: vi.fn(),
    getEntry: vi.fn(),
    getLabel: vi.fn(),
    getLeafId: vi.fn(),
    getMetadata: vi.fn(async () => ({
      id: "mock",
      projectId: "proj-1",
      modelId: TEST_MODEL_ID,
      title: null,
      thinkingLevel: "off",
      createdAt: new Date(0).toISOString(),
      updatedAt: 0,
    })),
    getPathToRoot: vi.fn(async () => []),
    setLeafId: vi.fn(),
  };
}

export function createMockCtx(overrides?: {
  projectId?: string;
  modelConfig?: {
    provider: string;
    modelId: string;
    thinkingLevel?: string;
  };
}) {
  const projectId = overrides?.projectId ?? "proj-1";
  return {
    repos: {
      sessions: {
        findById: vi.fn(async (id: string) =>
          id === "sess-1"
            ? {
                id: "sess-1",
                projectId,
                modelId: TEST_MODEL_ID,
                title: null,
                thinkingLevel: "off",
                createdAt: Date.now(),
                updatedAt: Date.now(),
              }
            : null
        ),
      },
      projects: {
        findById: vi.fn(async (id: string) =>
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
      models: {
        getForProject: vi.fn(
          () =>
            overrides?.modelConfig ?? {
              id: "cfg-1",
              projectId,
              provider: "openai",
              modelId: TEST_MODEL_ID,
              thinkingLevel: "off",
              createdAt: Date.now(),
              updatedAt: Date.now(),
            }
        ),
        getGlobalDefault: vi.fn(() => null),
      },
      settings: {
        get: vi.fn(() => null),
        getByPrefix: vi.fn(() => []),
        set: vi.fn(async () => {}),
        getAll: vi.fn(() => []),
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
    db: {},
    repos: {
      sessions: {
        findById: vi.fn(async (id: string) =>
          sessionIdToProjectId[id]
            ? {
                id,
                projectId: sessionIdToProjectId[id],
                modelId: TEST_MODEL_ID,
                title: null,
                thinkingLevel: "off",
                createdAt: Date.now(),
                updatedAt: Date.now(),
              }
            : null
        ),
      },
      projects: {
        findById: vi.fn(async (id: string) => projects[id] ?? null),
      },
      models: {
        getForProject: vi.fn(() => ({
          id: "cfg-1",
          provider: "openai",
          modelId: TEST_MODEL_ID,
          thinkingLevel: "off",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        })),
        getGlobalDefault: vi.fn(() => null),
      },
      settings: {
        get: vi.fn(() => null),
        getByPrefix: vi.fn(() => []),
        set: vi.fn(async () => {}),
        getAll: vi.fn(() => []),
      },
    },
  } as any;
}
