import type { AgentEvent } from "../types.ts";
import { describe, expect, it } from "vite-plus/test";

describe("OM event types", () => {
  it("om_start is a valid AgentEvent", () => {
    const event: AgentEvent = {
      type: "om_start",
      cycleId: "abc-123",
      operationType: "observation",
      tokenCount: 12_500,
    };
    expect(event.type).toBe("om_start");
  });

  it("om_end is a valid AgentEvent", () => {
    const event: AgentEvent = {
      type: "om_end",
      cycleId: "abc-123",
      operationType: "observation",
      durationMs: 3500,
      tokensProcessed: 32_500,
      tokensProduced: 4100,
      observations: "<observations>\n* test\n</observations>",
    };
    expect(event.type).toBe("om_end");
  });

  it("om_failed is a valid AgentEvent", () => {
    const event: AgentEvent = {
      type: "om_failed",
      cycleId: "abc-123",
      operationType: "reflection",
      error: "LLM error",
      durationMs: 1000,
    };
    expect(event.type).toBe("om_failed");
  });

  it("om_activation is a valid AgentEvent", () => {
    const event: AgentEvent = {
      type: "om_activation",
      cycleId: "abc-123",
      operationType: "observation",
      chunksActivated: 2,
      tokensActivated: 8000,
      observationTokens: 2000,
    };
    expect(event.type).toBe("om_activation");
  });

  it("om_status is a valid AgentEvent", () => {
    const event: AgentEvent = {
      type: "om_status",
      windows: {
        messages: { tokens: 18_000, threshold: 30_000 },
        observations: { tokens: 11_000, threshold: 40_000 },
      },
      recordId: "rec-1",
    };
    expect(event.type).toBe("om_status");
  });

  it("all operationTypes are accepted", () => {
    const types: Array<"observation" | "reflection" | "buffering"> = [
      "observation",
      "reflection",
      "buffering",
    ];
    for (const operationType of types) {
      const event: AgentEvent = {
        type: "om_start",
        cycleId: "x",
        operationType,
        tokenCount: 100,
      };
      expect(event.operationType).toBe(operationType);
    }
  });

  it("om_end optional fields work with exactOptionalPropertyTypes", () => {
    const event: AgentEvent = {
      type: "om_end",
      cycleId: "c1",
      operationType: "observation",
      durationMs: 1000,
      tokensProcessed: 100,
      tokensProduced: 50,
    };
    expect(event.type).toBe("om_end");
  });
});
