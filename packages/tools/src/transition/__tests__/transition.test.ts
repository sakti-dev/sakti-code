import { describe, expect, it } from "vite-plus/test";
import { createTransitionTool } from "../index.ts";

describe("transition tool", () => {
  it("accepts branchName parameter", () => {
    const tool = createTransitionTool();
    expect(tool.parameters.properties).toHaveProperty("branchName");
  });

  it("branchName is optional", () => {
    const tool = createTransitionTool();
    const required = tool.parameters.required ?? [];
    expect(required).not.toContain("branchName");
  });

  it("terminate is true (ends the turn)", async () => {
    const tool = createTransitionTool();
    const result = await tool.execute("call-1", { to: "mission", body: "brief" });
    expect(result.terminate).toBe(true);
  });
});
