import { vi } from "bun:test";
import type { SessionStorage } from "@sakti-code/agent";

export const piAiMock = {
  streamSimple: vi.fn() as unknown as ReturnType<typeof vi.fn>,
  getModel: vi.fn() as unknown as ReturnType<typeof vi.fn>,
};

export class MockStream<T> implements AsyncIterable<T> {
  private readonly items: T[] = [];
  private _hangPromise: Promise<void> | null = null;
  private _hangResolve: (() => void) | null = null;
  push(item: T) {
    this.items.push(item);
  }
  hang(): void {
    if (!this._hangPromise) {
      this._hangPromise = new Promise<void>((resolve) => {
        this._hangResolve = resolve;
      });
    }
  }
  unhang(): void {
    if (this._hangResolve) {
      this._hangResolve();
      this._hangResolve = null;
      this._hangPromise = null;
    }
  }
  async *[Symbol.asyncIterator]() {
    for (const item of this.items) {
      yield item;
    }
    if (this._hangPromise) {
      await this._hangPromise;
    }
  }
}

export function createTestModel() {
  return {
    id: "test-model",
    name: "Test",
    api: "openai-completions" as const,
    provider: "openai",
    baseUrl: "https://api.openai.com",
    reasoning: false,
    input: ["text"] as ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200_000,
    maxTokens: 4096,
  };
}

export function createTextStream(text: string) {
  const stream = new MockStream<any>();
  const now = Date.now();
  stream.push({
    type: "start",
    partial: {
      role: "assistant",
      content: [],
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      api: "openai-completions",
      provider: "openai",
      model: "test",
      timestamp: now,
    },
  });
  stream.push({ type: "text_start", contentIndex: 0, partial: {} });
  stream.push({
    type: "text_delta",
    contentIndex: 0,
    delta: text,
    partial: {},
  });
  stream.push({
    type: "text_end",
    contentIndex: 0,
    content: text,
    partial: {},
  });
  stream.push({
    type: "done",
    reason: "stop",
    message: {
      role: "assistant",
      content: [{ type: "text", text }],
      usage: {
        input: 10,
        output: text.length,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 10 + text.length,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      api: "openai-completions",
      provider: "openai",
      model: "test",
      timestamp: now,
    },
  });
  return stream;
}

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
      modelId: "test-model",
      title: null,
      thinkingLevel: "off",
      createdAt: 0,
      updatedAt: 0,
    })),
    getPathToRoot: vi.fn(async () => []),
    setLeafId: vi.fn(),
  };
}

export function createMockCtx(overrides?: {
  projectId?: string;
  modelConfig?: any;
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
                modelId: "test-model",
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
              modelId: "test-model",
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
                modelId: "test-model",
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
          modelId: "test-model",
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
