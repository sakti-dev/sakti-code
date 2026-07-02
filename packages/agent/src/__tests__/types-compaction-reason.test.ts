import { describe, expectTypeOf, it } from "vite-plus/test";
import type { AgentEvent } from "../types.ts";

describe("compaction event reason union", () => {
  it("compaction_start accepts 'manual'", () => {
    const event = { type: "compaction_start", reason: "manual" } as const;
    expectTypeOf(event).toMatchTypeOf<AgentEvent>();
  });

  it("compaction_end accepts 'manual'", () => {
    const event = {
      type: "compaction_end",
      reason: "manual",
      aborted: false,
      willRetry: false,
    } as const;
    expectTypeOf(event).toMatchTypeOf<AgentEvent>();
  });

  it("compaction_start accepts 'threshold' and 'overflow'", () => {
    const threshold = { type: "compaction_start", reason: "threshold" } as const;
    const overflow = { type: "compaction_start", reason: "overflow" } as const;
    expectTypeOf(threshold).toMatchTypeOf<AgentEvent>();
    expectTypeOf(overflow).toMatchTypeOf<AgentEvent>();
  });
});
