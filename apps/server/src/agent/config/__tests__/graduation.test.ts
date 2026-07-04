import { describe, expect, it, vi, beforeEach } from "vite-plus/test";

// Hoist the engine's instance spy so the module mock (which must be hoisted
// above imports) can reference it. Constructors use regular function
// declarations returning a plain object (arrow fns can't be `new`-ed).
const mocks = vi.hoisted(() => ({
  forceObserve: vi.fn().mockResolvedValue({}),
  forceReflect: vi.fn().mockResolvedValue({ reflected: true }),
  omStorageCtor: vi.fn(function () {
    return {};
  }),
  engineCtor: vi.fn(function () {
    return { forceObserve: mocks.forceObserve, forceReflect: mocks.forceReflect };
  }),
}));

vi.mock("@sakti-code/agent", () => ({ ObservationalMemoryEngine: mocks.engineCtor }));
vi.mock("@sakti-code/db", () => ({ SqliteObservationalMemoryStorage: mocks.omStorageCtor }));
vi.mock("../index.ts", () => ({ resolveOmConfig: vi.fn().mockReturnValue(undefined) }));
vi.mock("../../../context.ts", () => ({
  createSessionStorage: vi.fn().mockReturnValue({}),
}));

import { ObservationalMemoryEngine } from "@sakti-code/agent";
import { SqliteObservationalMemoryStorage } from "@sakti-code/db";
import { resolveOmConfig } from "../index.ts";
import { createSessionStorage } from "../../../context.ts";
import { buildGraduation } from "../graduation.ts";

const childSession = { id: "child-1", kind: "intake", projectId: "proj-1", profileId: null };
const ctx = { db: {} } as unknown as Parameters<typeof buildGraduation>[0];

describe("buildGraduation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("OM configured → builds a resource-scope engine, observes then reflects", async () => {
    vi.mocked(resolveOmConfig).mockReturnValue({
      observeModel: "m",
      reflectModel: "m",
      scope: "thread",
      config: {},
    } as unknown as ReturnType<typeof resolveOmConfig>);

    await buildGraduation(ctx, childSession)("child-1");

    expect(ObservationalMemoryEngine).toHaveBeenCalledOnce();
    const call = vi.mocked(ObservationalMemoryEngine).mock.calls[0]![0] as {
      deps: { scope: string; sessionId: string; projectId: string };
    };
    // The engine must be resource-scope so it keys at (threadId=null, resourceId=projectId).
    expect(call.deps.scope).toBe("resource");
    expect(call.deps.sessionId).toBe("child-1");
    expect(call.deps.projectId).toBe("proj-1");
    expect(mocks.forceObserve).toHaveBeenCalledOnce();
    expect(mocks.forceReflect).toHaveBeenCalledOnce();
    expect(SqliteObservationalMemoryStorage).toHaveBeenCalledWith(ctx.db);
    expect(createSessionStorage).toHaveBeenCalledWith(ctx, "child-1");
  });

  it("OM not configured → skips graduation (best-effort, never strands)", async () => {
    vi.mocked(resolveOmConfig).mockReturnValue(undefined);

    await buildGraduation(ctx, childSession)("child-1");

    expect(ObservationalMemoryEngine).not.toHaveBeenCalled();
    expect(mocks.forceObserve).not.toHaveBeenCalled();
  });

  it("forceObserve failure is swallowed (graduation must not strand the mission)", async () => {
    vi.mocked(resolveOmConfig).mockReturnValue({
      observeModel: "m",
      reflectModel: "m",
      scope: "thread",
      config: {},
    } as unknown as ReturnType<typeof resolveOmConfig>);
    mocks.forceObserve.mockRejectedValueOnce(new Error("boom"));

    await expect(buildGraduation(ctx, childSession)("child-1")).resolves.toBeUndefined();
  });
});
