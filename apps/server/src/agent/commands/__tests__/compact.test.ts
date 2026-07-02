import { describe, expect, it } from "vite-plus/test";
import { runCompact } from "../compact.ts";
import { createMockCtx } from "../../__tests__/helpers.ts";

describe("runCompact", () => {
  it("returns notFound for unknown session", async () => {
    const ctx = createMockCtx();
    const result = await runCompact(ctx, "nonexistent");
    expect("notFound" in result).toBe(true);
  });

  it("returns error when model resolution fails (nonexistent profile)", async () => {
    const ctxWithBadProfile = createMockCtx({ profileId: "nonexistent-profile" });
    const result = await runCompact(ctxWithBadProfile, "sess-1");
    expect("error" in result).toBe(true);
  });
});
