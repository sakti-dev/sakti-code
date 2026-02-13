import { runWithFrameBudget } from "@/core/shared/utils/frame-budget-scheduler";
import { describe, expect, it } from "vitest";

describe("frame-budget-scheduler", () => {
  it("yields across batches when workload exceeds frame budget", async () => {
    let steps = 0;
    const result = await runWithFrameBudget(
      () => {
        steps += 1;
        const start = performance.now();
        while (performance.now() - start < 2) {
          // busy work
        }
        return steps >= 8;
      },
      { frameBudgetMs: 1 }
    );

    expect(steps).toBeGreaterThanOrEqual(8);
    expect(result.batches).toBeGreaterThan(1);
    expect(result.yields).toBeGreaterThan(0);
    expect(result.totalMs).toBeGreaterThan(0);
  });
});
