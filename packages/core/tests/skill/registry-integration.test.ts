import { describe, expect, it } from "vitest";
import { toolRegistry } from "../../src/tools/registry";

describe("skill tool in registry", () => {
  it("should include skill tool in registry", () => {
    const names = toolRegistry.getToolNames();
    expect(names).toContain("skill");
  });

  it("should have skill tool with correct structure", () => {
    const skill = (toolRegistry as Record<string, unknown>).skill;
    expect(skill).toBeDefined();
    expect(skill).toHaveProperty("description");
    expect(skill).toHaveProperty("inputSchema");
  });
});
