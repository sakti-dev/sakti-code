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
vi.mock("../../commands/compact.ts", () => ({ runCompact: vi.fn().mockResolvedValue({}) }));
vi.mock("../index.ts", () => ({ resolveOmConfig: vi.fn().mockReturnValue(undefined) }));
vi.mock("../../../context.ts", () => ({
  createSessionStorage: vi.fn().mockReturnValue({}),
}));

import { ObservationalMemoryEngine } from "@sakti-code/agent";
import { SqliteObservationalMemoryStorage } from "@sakti-code/db";
import { runCompact } from "../../commands/compact.ts";
import { resolveOmConfig } from "../index.ts";
import { createSessionStorage } from "../../../context.ts";
import { buildForceReset } from "../force-reset.ts";

const session = { id: "s1", kind: "mission", projectId: "p1", profileId: null };
const ctx = { db: {} } as unknown as Parameters<typeof buildForceReset>[0];

describe("buildForceReset — OM branch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("OM off → calls runCompact, does NOT construct the OM engine", async () => {
    vi.mocked(resolveOmConfig).mockReturnValue(undefined);

    await buildForceReset(ctx, session)("s1");

    expect(runCompact).toHaveBeenCalledWith(ctx, "s1");
    expect(ObservationalMemoryEngine).not.toHaveBeenCalled();
  });

  it("OM on → constructs the engine and calls forceObserve, does NOT runCompact", async () => {
    vi.mocked(resolveOmConfig).mockReturnValue({
      observeModel: "m",
      reflectModel: "m",
      config: {},
    } as unknown as ReturnType<typeof resolveOmConfig>);

    await buildForceReset(ctx, session)("s1");

    expect(ObservationalMemoryEngine).toHaveBeenCalledOnce();
    expect(mocks.forceObserve).toHaveBeenCalledOnce();
    expect(SqliteObservationalMemoryStorage).toHaveBeenCalledWith(ctx.db);
    expect(createSessionStorage).toHaveBeenCalledWith(ctx, "s1");
    expect(runCompact).not.toHaveBeenCalled();
  });
});
