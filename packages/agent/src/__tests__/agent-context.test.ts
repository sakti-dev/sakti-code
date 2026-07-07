import { describe, expect, it } from "vite-plus/test";
import type { AgentContext } from "../types";

describe("AgentContext.systemMessages", () => {
  it("accepts an optional array of observation chunk strings separate from systemPrompt", () => {
    const ctx: AgentContext = {
      systemPrompt: "base",
      messages: [],
      systemMessages: ["obs chunk 1", "obs chunk 2"],
    };
    expect(ctx.systemMessages).toEqual(["obs chunk 1", "obs chunk 2"]);
    expect(ctx.systemPrompt).toBe("base");
  });

  it("systemMessages is optional (undefined when no observations)", () => {
    const ctx: AgentContext = { systemPrompt: "base", messages: [] };
    expect(ctx.systemMessages).toBeUndefined();
  });
});
