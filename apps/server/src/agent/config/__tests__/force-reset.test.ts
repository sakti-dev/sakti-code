import { describe, expect, it, vi, beforeEach } from "vite-plus/test";

// Hoist the engine's instance spy so the module mock (which must be hoisted
// above imports) can reference it. Constructors use regular function
// declarations returning a plain object (arrow fns can't be `new`-ed, and
// `this`-mutation trips vi.fn's overload typing).
const mocks = vi.hoisted(() => ({
  forceObserve: vi.fn().mockResolvedValue({}),
  omStorageCtor: vi.fn(function () {
    return {};
  }),
  engineCtor: vi.fn(function () {
    return { forceObserve: mocks.forceObserve };
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
import { buildForceReset } from "../force-reset.ts";

const session = { id: "s1", kind: "mission", projectId: "p1", profileId: null };
const ctx = { db: {} } as unknown as Parameters<typeof buildForceReset>[0];

describe("buildForceReset", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("OM configured → constructs the engine and calls forceObserve", async () => {
    vi.mocked(resolveOmConfig).mockReturnValue({
      observeModel: "m",
      reflectModel: "m",
      scope: "thread",
    } as unknown as ReturnType<typeof resolveOmConfig>);

    await buildForceReset(ctx, session)("s1");

    expect(ObservationalMemoryEngine).toHaveBeenCalledOnce();
    expect(mocks.forceObserve).toHaveBeenCalledOnce();
    expect(SqliteObservationalMemoryStorage).toHaveBeenCalledWith(ctx.db);
    expect(createSessionStorage).toHaveBeenCalledWith(ctx, "s1");
  });

  it("OM not configured → skips the observe (best-effort, never strands)", async () => {
    vi.mocked(resolveOmConfig).mockReturnValue(undefined);

    await buildForceReset(ctx, session)("s1");

    expect(ObservationalMemoryEngine).not.toHaveBeenCalled();
    expect(mocks.forceObserve).not.toHaveBeenCalled();
  });

  it("passes status through to resolveOmConfig", async () => {
    vi.mocked(resolveOmConfig).mockReturnValue({
      observeModel: "m",
      reflectModel: "m",
      scope: "thread",
    } as unknown as ReturnType<typeof resolveOmConfig>);

    await buildForceReset(ctx, { ...session, status: "review" })("s1");

    expect(resolveOmConfig).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({ status: "review" }),
    );
  });
});
